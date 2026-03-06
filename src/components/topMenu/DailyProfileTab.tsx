import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';
import { DailyProfileCalculator } from '@/utils/dailyProfileCalculator';
import { DailyProfileChart } from '@/components/DailyProfileChart';
import { ProfileVisualEditor } from '@/components/ProfileVisualEditor';
import { MeasuredProfileImporter } from '@/components/MeasuredProfileImporter';
import { HourlyVoltageResult, ClientHourlyVoltageResult } from '@/types/dailyProfile';
import { Clock, Sun, Cloud, Car, Factory, Edit3, AlertTriangle, Percent, Home, Zap, FlaskConical, Moon, Upload, FileBarChart, X, Download, MapPin, User, Cable, Building2, TreePine, Wheat, Eye, EyeOff, RotateCcw, HelpCircle } from 'lucide-react';
import { clusterProfiles, getClusterById, DEFAULT_CLUSTER_ID } from '@/data/clusterProfiles';
import { toast } from 'sonner';
import { HourlyProfile, MeasuredProfileMetadata } from '@/types/dailyProfile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Project } from '@/types/network';
import { calculateClientDailyVoltages } from '@/utils/clientDailyProfileCalculator';
import { branchementCableTypes, calculateGeodeticDistance } from '@/data/branchementCableTypes';
import { CalculationInfoDialog } from '@/components/CalculationInfoDialog';

/**
 * Composant affichant les statistiques de clients résidentiels/industriels
 */
const ClientStatsDisplay = ({ project }: { project: Project }) => {
  const stats = useMemo(() => {
    const clients = project.clientsImportes || [];
    const links = project.clientLinks || [];
    
    let residentialCount = 0;
    let industrialCount = 0;
    let residentialPower = 0;
    let industrialPower = 0;
    
    clients.forEach(client => {
      const isLinked = links.some(link => link.clientId === client.id);
      
      if (isLinked) {
        if (client.clientType === 'industriel') {
          industrialCount++;
          industrialPower += client.puissanceContractuelle_kVA || 0;
        } else {
          residentialCount++;
          residentialPower += client.puissanceContractuelle_kVA || 0;
        }
      }
    });
    
    return { residentialCount, industrialCount, residentialPower, industrialPower };
  }, [project.clientsImportes, project.clientLinks]);

  return (
    <div className="space-y-2 text-xs">
      <Label className="text-xs text-muted-foreground">Clients liés (profil horaire auto)</Label>
      <div className="flex flex-col gap-1.5 pl-1">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Home className="h-3 w-3" />
            Résidentiels
          </span>
          <Badge variant="outline" className="text-xs px-2 py-0">
            {stats.residentialCount} ({stats.residentialPower.toFixed(0)} kVA)
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Factory className="h-3 w-3" />
            Industriels
          </span>
          <Badge variant="outline" className="text-xs px-2 py-0">
            {stats.industrialCount} ({stats.industrialPower.toFixed(0)} kVA)
          </Badge>
        </div>
      </div>
      {stats.industrialCount > 0 && (
        <p className="text-[10px] text-muted-foreground/70 italic pl-1">
          Le profil industriel (8h-18h) est appliqué automatiquement aux clients industriels
        </p>
      )}
    </div>
  );
};

export const DailyProfileTab = () => {
  const { 
    currentProject, 
    dailyProfileOptions, 
    dailyProfileCustomProfiles,
    setDailyProfileOptions,
    setDailyProfileCustomProfiles,
    simulationEquipment,
    isSimulationActive,
    toggleSimulationActive,
    measuredProfile,
    measuredProfileMetadata,
    clearMeasuredProfile,
    // Sélection de nœud sur carte
    startNodeSelection,
    nodeSelectionMode,
    // Client sélectionné et câble de branchement
    selectedClientId,
    setSelectedClient,
    selectedBranchementCableId,
    setSelectedBranchementCableId,
    setDailyProfileHighlight,
  } = useNetworkStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [importerOpen, setImporterOpen] = useState(false);
  const [editMeasuredOpen, setEditMeasuredOpen] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [showClientCurve, setShowClientCurve] = useState(false);
  const [clientCurveMode, setClientCurveMode] = useState<'overlay' | 'solo'>('overlay');
  const [showDetails, setShowDetails] = useState(true);
  const [showInfoDialog, setShowInfoDialog] = useState(false);

  // États météo indépendants par saison
  const [weatherWinter, setWeatherWinter] = useState<'sunny' | 'gray'>(dailyProfileOptions.weather || 'sunny');
  const [zeroProductionWinter, setZeroProductionWinter] = useState(dailyProfileOptions.zeroProduction || false);
  const [weatherSummer, setWeatherSummer] = useState<'sunny' | 'gray'>(dailyProfileOptions.weather || 'sunny');
  const [zeroProductionSummer, setZeroProductionSummer] = useState(dailyProfileOptions.zeroProduction || false);

  // Résultats du calcul (hiver + été)
  const [resultsWinter, setResultsWinter] = useState<HourlyVoltageResult[]>([]);
  const [resultsSummer, setResultsSummer] = useState<HourlyVoltageResult[]>([]);
  const [results, setResults] = useState<HourlyVoltageResult[]>([]);
  const [resultsWithoutSim, setResultsWithoutSim] = useState<HourlyVoltageResult[]>([]);

  // Liste des nœuds disponibles
  const nodes = useMemo(() => {
    if (!currentProject) return [];
    return currentProject.nodes.filter(n => !n.isSource);
  }, [currentProject]);

  // Auto-sélection du premier nœud si aucun n'est sélectionné
  useEffect(() => {
    if (nodes.length > 0 && !dailyProfileOptions.selectedNodeId) {
      setDailyProfileOptions({ selectedNodeId: nodes[0].id });
    }
  }, [nodes, dailyProfileOptions.selectedNodeId, setDailyProfileOptions]);

  // Compteur d'équipements de simulation
  const srg2Count = simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0;
  const compensatorCount = simulationEquipment.neutralCompensators?.filter(c => c.enabled).length || 0;
  const hasCableReplacement = simulationEquipment.cableReplacement?.enabled;
  const totalEquipment = srg2Count + compensatorCount + (hasCableReplacement ? 1 : 0);
  const hasAnyEquipment = totalEquipment > 0 || 
    (simulationEquipment.srg2Devices?.length || 0) > 0 || 
    simulationEquipment.neutralCompensators.length > 0;

  // Vérifier si la simulation est active avec équipements
  const hasActiveSimulation = isSimulationActive && totalEquipment > 0;

  // Calcul des tensions quand les options changent
  useEffect(() => {
    if (!currentProject || !dailyProfileOptions.selectedNodeId) {
      setResultsWinter([]);
      setResultsSummer([]);
      setResults([]);
      setResultsWithoutSim([]);
      return;
    }

    // Options hiver avec météo indépendante
    const winterOptions = { ...dailyProfileOptions, season: 'winter' as const, weather: weatherWinter, zeroProduction: zeroProductionWinter };
    const summerOptions = { ...dailyProfileOptions, season: 'summer' as const, weather: weatherSummer, zeroProduction: zeroProductionSummer };
    const measuredProfileData = dailyProfileOptions.useMeasuredProfile ? measuredProfile ?? undefined : undefined;

    // Calcul HIVER avec simulation
    const calcWinter = new DailyProfileCalculator(
      currentProject, winterOptions, dailyProfileCustomProfiles,
      hasActiveSimulation ? simulationEquipment : undefined,
      hasActiveSimulation, measuredProfileData
    );
    const rWinter = calcWinter.calculateDailyVoltages();
    setResultsWinter(rWinter);

    // Calcul ÉTÉ avec simulation
    const calcSummer = new DailyProfileCalculator(
      currentProject, summerOptions, dailyProfileCustomProfiles,
      hasActiveSimulation ? simulationEquipment : undefined,
      hasActiveSimulation, measuredProfileData
    );
    const rSummer = calcSummer.calculateDailyVoltages();
    setResultsSummer(rSummer);

    // Garder results = winter pour compatibilité (client curve etc.)
    setResults(rWinter);

    // Calcul SANS simulation (pour comparaison)
    if (hasActiveSimulation && comparisonMode) {
      const calculatorBase = new DailyProfileCalculator(
        currentProject, winterOptions, dailyProfileCustomProfiles,
        undefined, false, measuredProfileData
      );
      setResultsWithoutSim(calculatorBase.calculateDailyVoltages());
    } else {
      setResultsWithoutSim([]);
    }
  }, [currentProject, dailyProfileOptions, dailyProfileCustomProfiles, simulationEquipment, isSimulationActive, hasActiveSimulation, comparisonMode, measuredProfile, weatherWinter, zeroProductionWinter, weatherSummer, zeroProductionSummer]);

  // Synchroniser le highlight sur la carte avec la sélection profil 24H
  useEffect(() => {
    const nodeId = dailyProfileOptions.selectedNodeId || null;
    const clientId = showClientCurve ? selectedClientId : null;
    setDailyProfileHighlight(nodeId, clientId);
  }, [dailyProfileOptions.selectedNodeId, selectedClientId, showClientCurve, setDailyProfileHighlight]);

  // Cleanup au démontage : retirer le highlight
  useEffect(() => {
    return () => {
      setDailyProfileHighlight(null, null);
    };
  }, [setDailyProfileHighlight]);

  // Heures critiques
  // Heures critiques par saison
  const criticalHoursWinter = useMemo(() => {
    return DailyProfileCalculator.findCriticalHours(resultsWinter).slice(0, 5);
  }, [resultsWinter]);

  const criticalHoursSummer = useMemo(() => {
    return DailyProfileCalculator.findCriticalHours(resultsSummer).slice(0, 5);
  }, [resultsSummer]);

  // Tension nominale : toujours 230V car on calcule en phase-neutre
  const nominalVoltage = 230;

  // Nœud sélectionné
  const selectedNode = nodes.find(n => n.id === dailyProfileOptions.selectedNodeId);

  // Client sélectionné et données associées
  const selectedClient = useMemo(() => {
    if (!selectedClientId || !currentProject?.clientsImportes) return null;
    return currentProject.clientsImportes.find(c => c.id === selectedClientId) || null;
  }, [selectedClientId, currentProject?.clientsImportes]);

  const selectedCable = useMemo(() => {
    if (!selectedBranchementCableId) return null;
    return branchementCableTypes.find(c => c.id === selectedBranchementCableId) || null;
  }, [selectedBranchementCableId]);

  // Clients connectés au nœud sélectionné (pour le sélecteur dans Courbe Raccordement)
  const clientsOnSelectedNode = useMemo(() => {
    if (!dailyProfileOptions.selectedNodeId || !currentProject?.clientsImportes || !currentProject?.clientLinks) {
      return [];
    }
    
    const nodeId = dailyProfileOptions.selectedNodeId;
    const linkedClientIds = currentProject.clientLinks
      .filter(link => link.nodeId === nodeId)
      .map(link => link.clientId);
    
    return currentProject.clientsImportes.filter(c => linkedClientIds.includes(c.id));
  }, [dailyProfileOptions.selectedNodeId, currentProject?.clientsImportes, currentProject?.clientLinks]);

  // Nœud lié au client sélectionné
  const clientLinkedNode = useMemo(() => {
    if (!selectedClient || !currentProject?.clientLinks) return null;
    const link = currentProject.clientLinks.find(l => l.clientId === selectedClient.id);
    if (!link) return null;
    return currentProject.nodes.find(n => n.id === link.nodeId) || null;
  }, [selectedClient, currentProject?.clientLinks, currentProject?.nodes]);

  // Longueur du câble de branchement (distance géodésique)
  const clientCableLength = useMemo(() => {
    if (!selectedClient || !clientLinkedNode) return 0;
    return calculateGeodeticDistance(
      clientLinkedNode.lat, clientLinkedNode.lng,
      selectedClient.lat, selectedClient.lng
    );
  }, [selectedClient, clientLinkedNode]);

  // Calcul des tensions client horaires
  const clientResults = useMemo((): ClientHourlyVoltageResult[] | null => {
    if (!showClientCurve || !selectedClient || !selectedCable || !results.length) return null;
    
    return calculateClientDailyVoltages(
      results,
      selectedClient,
      selectedCable,
      clientCableLength,
      currentProject.voltageSystem,
      dailyProfileOptions,
      dailyProfileCustomProfiles,
      currentProject
    );
  }, [showClientCurve, selectedClient, selectedCable, results, clientCableLength, currentProject, dailyProfileOptions, dailyProfileCustomProfiles]);

  if (!currentProject) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Aucun projet chargé
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
      {/* Colonne gauche: Paramètres */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Paramètres de simulation
            <button
              onClick={() => setShowInfoDialog(true)}
              className="ml-auto p-0.5 rounded-full hover:bg-muted transition-colors"
              title="Note de calcul"
            >
              <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Sélection du nœud */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Nœud analysé</Label>
            <div className="flex gap-2">
              <Select
                value={dailyProfileOptions.selectedNodeId}
                onValueChange={(value) => setDailyProfileOptions({ selectedNodeId: value })}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Sélectionner un nœud" />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map(node => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name || node.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={nodeSelectionMode === 'profil24h' ? 'default' : 'outline'}
                size="icon"
                onClick={() => startNodeSelection('profil24h')}
                title="Sélectionner sur la carte"
                className="shrink-0"
              >
                <MapPin className="h-4 w-4" />
              </Button>
            </div>
          </div>


          {/* Note: Clusters et foisonnement adaptatif désactivés — le profil P90 est déjà calibré */}

          {/* Mode simulation */}
          <div className="space-y-2 border-t border-border pt-3">
            <Label className="text-xs text-muted-foreground">Mode simulation</Label>
            <div className="flex items-center justify-between">
              <Label htmlFor="simulation-toggle-profile" className="text-sm font-medium flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-accent" />
                Activer simulation
              </Label>
              <Switch
                id="simulation-toggle-profile"
                checked={isSimulationActive}
                onCheckedChange={toggleSimulationActive}
                disabled={!hasAnyEquipment}
                className="data-[state=checked]:bg-success"
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge 
                variant={isSimulationActive ? "default" : "outline"} 
                className={`text-xs ${isSimulationActive ? 'bg-success text-success-foreground' : 'border-muted-foreground/30 text-muted-foreground'}`}
              >
                {isSimulationActive ? '✓ Active' : '✗ Inactive'}
              </Badge>
              {totalEquipment > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {totalEquipment} équip.
                </Badge>
              )}
            </div>
          </div>

          {/* Options de charge VE */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2">
                <Car className="h-4 w-4 text-muted-foreground" />
                Charge VE
              </Label>
              <Switch
                checked={dailyProfileOptions.enableEV}
                onCheckedChange={(checked) => setDailyProfileOptions({ enableEV: checked })}
              />
            </div>
            
            {/* Sliders de personnalisation des bonus VE */}
            {dailyProfileOptions.enableEV && (
              <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Bonus 18h-21h (soirée)</span>
                    <span className="font-medium text-primary">+{dailyProfileOptions.evBonusEvening ?? 2.5}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="15"
                    step="0.5"
                    value={dailyProfileOptions.evBonusEvening ?? 2.5}
                    onChange={(e) => setDailyProfileOptions({ evBonusEvening: parseFloat(e.target.value) })}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Bonus 22h-5h (nuit)</span>
                    <span className="font-medium text-primary">+{dailyProfileOptions.evBonusNight ?? 5}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.5"
                    value={dailyProfileOptions.evBonusNight ?? 5}
                    onChange={(e) => setDailyProfileOptions({ evBonusNight: parseFloat(e.target.value) })}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
              </div>
            )}
            
            {/* Statistiques clients détectés */}
            <ClientStatsDisplay project={currentProject} />
          </div>

          {/* Section profil mesuré */}
          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-xs text-muted-foreground flex items-center gap-2">
              <FileBarChart className="h-3 w-3" />
              Profil mesuré (PQ-Box)
            </Label>
            
            {measuredProfile && measuredProfileMetadata ? (
              <div className="space-y-2">
                {/* Infos du profil importé */}
                <div className="bg-muted/50 rounded-lg p-2 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate flex-1">{measuredProfileMetadata.name}</span>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 w-5 p-0" 
                        onClick={() => {
                          const exportData = {
                            type: 'measured_profile',
                            version: '1.0',
                            profile: measuredProfile,
                            metadata: measuredProfileMetadata
                          };
                          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `profil-mesure-${measuredProfileMetadata.name}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                          toast.success('Profil exporté en JSON');
                        }}
                        title="Exporter en JSON"
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 w-5 p-0" 
                        onClick={() => setEditMeasuredOpen(true)}
                        title="Éditer le profil"
                      >
                        <Edit3 className="h-3 w-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-5 w-5 p-0" 
                        onClick={clearMeasuredProfile}
                        title="Supprimer le profil"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-muted-foreground space-y-0.5">
                    <p>{measuredProfileMetadata.contractualPower_kVA} kVA contractuel</p>
                    <p>Pic: {measuredProfileMetadata.peakUsagePercent.toFixed(1)}% • {measuredProfileMetadata.dataPoints} pts</p>
                  </div>
                </div>
                
                {/* Switch utilisation */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="use-measured" className="text-sm">
                    Utiliser profil mesuré
                  </Label>
                  <Switch
                    id="use-measured"
                    checked={dailyProfileOptions.useMeasuredProfile ?? false}
                    onCheckedChange={(checked) => setDailyProfileOptions({ useMeasuredProfile: checked })}
                  />
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImporterOpen(true)}
                className="w-full gap-2"
              >
                <Upload className="h-4 w-4" />
                Importer mesures PQ-Box
              </Button>
            )}
          </div>

          {/* Section Courbe Client */}
          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-xs text-muted-foreground flex items-center gap-2">
              <Cable className="h-3 w-3" />
              Courbe Raccordement
            </Label>
            
            {/* Sélecteur de client parmi ceux connectés au nœud */}
            <div className="space-y-2">
              <Select
                value={selectedClientId || ''}
                onValueChange={(value) => setSelectedClient(value || null)}
                disabled={clientsOnSelectedNode.length === 0}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={
                    clientsOnSelectedNode.length === 0 
                      ? "Aucun client sur ce nœud" 
                      : "Sélectionner un client"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {clientsOnSelectedNode.map(client => (
                    <SelectItem key={client.id} value={client.id} className="text-xs">
                      <span className="flex items-center gap-2">
                        {client.clientType === 'industriel' ? '🏭' : '🏠'}
                        {client.nomCircuit}
                        <span className="text-muted-foreground">
                          ({client.puissanceContractuelle_kVA} kVA)
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {selectedClient && (
                <>
                  {/* Sélecteur de câble de branchement */}
                  <Select
                    value={selectedBranchementCableId || ''}
                    onValueChange={(value) => setSelectedBranchementCableId(value || null)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Câble de branchement" />
                    </SelectTrigger>
                    <SelectContent>
                      {branchementCableTypes.map(cable => (
                        <SelectItem key={cable.id} value={cable.id} className="text-xs">
                          {cable.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <div className="flex items-center justify-between">
                    <Label htmlFor="client-curve-toggle" className="text-sm">
                      Afficher courbe client
                    </Label>
                    <Switch
                      id="client-curve-toggle"
                      checked={showClientCurve}
                      onCheckedChange={setShowClientCurve}
                      disabled={!selectedCable}
                    />
                  </div>
                  
                  {showClientCurve && selectedCable && (
                    <div className="text-xs bg-cyan-50 dark:bg-cyan-950/50 p-2 rounded border border-cyan-200 dark:border-cyan-800 space-y-2">
                      <div>
                        <p className="font-medium text-cyan-700 dark:text-cyan-300">{selectedClient.nomCircuit}</p>
                        <p className="text-cyan-600 dark:text-cyan-400">
                          {selectedClient.clientType === 'industriel' ? '🏭 Industriel' : '🏠 Résidentiel'}
                        </p>
                        <p className="text-muted-foreground">Câble: {selectedCable.label}</p>
                        <p className="text-muted-foreground">Longueur: {clientCableLength.toFixed(1)}m</p>
                        <p className="text-muted-foreground mt-1 italic">
                          Profil client horaire (jusqu'à 80%)
                        </p>
                      </div>
                      {/* Mode d'affichage de la courbe */}
                      <div className="flex gap-1 pt-1 border-t border-cyan-200 dark:border-cyan-800">
                        <Button
                          size="sm"
                          variant={clientCurveMode === 'overlay' ? 'default' : 'outline'}
                          onClick={() => setClientCurveMode('overlay')}
                          className="flex-1 h-6 text-[10px] px-1"
                        >
                          Superposée
                        </Button>
                        <Button
                          size="sm"
                          variant={clientCurveMode === 'solo' ? 'default' : 'outline'}
                          onClick={() => setClientCurveMode('solo')}
                          className="flex-1 h-6 text-[10px] px-1"
                        >
                          Seule
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Bouton éditer profils */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditorOpen(true)}
            className="w-full gap-2"
          >
            <Edit3 className="h-4 w-4" />
            Éditer les profils
          </Button>
        </CardContent>
      </Card>

      {/* Colonne centrale et droite: Graphes Hiver/Été */}
      <div className="lg:col-span-2 space-y-4">
        {/* En-tête avec badge + comparaison + masquage */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium flex items-center gap-2">
            Tension au nœud {selectedNode?.name || dailyProfileOptions.selectedNodeId}
            {hasActiveSimulation && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-success text-success-foreground">
                <Zap className="h-3 w-3 mr-0.5" />
                Simulation
              </Badge>
            )}
          </span>
          <div className="flex items-center gap-2">
            {hasActiveSimulation && (
              <div className="flex items-center gap-1.5">
                <Switch
                  id="comparison-mode"
                  checked={comparisonMode}
                  onCheckedChange={setComparisonMode}
                  className="scale-75"
                />
                <Label htmlFor="comparison-mode" className="text-xs text-muted-foreground cursor-pointer">
                  Comparer
                </Label>
              </div>
            )}
            <Badge variant="outline" className="text-xs">
              {nominalVoltage}V nominal
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowDetails(!showDetails)}
              title={showDetails ? 'Masquer heures critiques et foisonnement' : 'Afficher heures critiques et foisonnement'}
            >
              {showDetails ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Graphe Hiver */}
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardContent className="px-4 py-3">
            {resultsWinter.length > 0 ? (
              <DailyProfileChart
                title="❄️ Hiver"
                data={resultsWinter}
                comparisonData={comparisonMode ? resultsWithoutSim : undefined}
                clientData={clientResults || undefined}
                showNodeCurves={!(showClientCurve && clientCurveMode === 'solo')}
                nominalVoltage={nominalVoltage}
                weather={weatherWinter}
                zeroProduction={zeroProductionWinter}
                onWeatherChange={(w, zp) => { setWeatherWinter(w); setZeroProductionWinter(zp); }}
              />
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                Sélectionnez un nœud pour afficher le graphe
              </div>
            )}
          </CardContent>
        </Card>

        {/* Graphe Été */}
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardContent className="px-4 py-3">
            {resultsSummer.length > 0 ? (
              <DailyProfileChart
                title="☀️ Été"
                data={resultsSummer}
                clientData={clientResults || undefined}
                showNodeCurves={!(showClientCurve && clientCurveMode === 'solo')}
                nominalVoltage={nominalVoltage}
                weather={weatherSummer}
                zeroProduction={zeroProductionSummer}
                onWeatherChange={(w, zp) => { setWeatherSummer(w); setZeroProductionSummer(zp); }}
              />
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                Sélectionnez un nœud pour afficher le graphe
              </div>
            )}
          </CardContent>
        </Card>

        {/* Heures critiques (masquable) */}
        {showDetails && (criticalHoursWinter.length > 0 || criticalHoursSummer.length > 0) && (
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Heures critiques
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {criticalHoursWinter.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">❄️ Hiver</p>
                  <div className="flex flex-wrap gap-2">
                    {criticalHoursWinter.map((h) => (
                      <Badge
                        key={h.hour}
                        variant={h.status === 'critical' ? 'destructive' : 'secondary'}
                        className="text-xs px-3 py-1"
                      >
                        {h.hour}h: {h.deviationPercent > 0 ? '+' : ''}{h.deviationPercent.toFixed(1)}%
                        <span className="ml-1 opacity-70">
                          (A:{Math.round(h.voltageA_V)}V B:{Math.round(h.voltageB_V)}V C:{Math.round(h.voltageC_V)}V)
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {criticalHoursSummer.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">☀️ Été</p>
                  <div className="flex flex-wrap gap-2">
                    {criticalHoursSummer.map((h) => (
                      <Badge
                        key={h.hour}
                        variant={h.status === 'critical' ? 'destructive' : 'secondary'}
                        className="text-xs px-3 py-1"
                      >
                        {h.hour}h: {h.deviationPercent > 0 ? '+' : ''}{h.deviationPercent.toFixed(1)}%
                        <span className="ml-1 opacity-70">
                          (A:{Math.round(h.voltageA_V)}V B:{Math.round(h.voltageB_V)}V C:{Math.round(h.voltageC_V)}V)
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tableau foisonnement horaire (masquable) - Hiver */}
        {showDetails && resultsWinter.length > 0 && (
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Percent className="h-4 w-4 text-primary" />
                ❄️ Foisonnement horaire Hiver - {selectedNode?.name || dailyProfileOptions.selectedNodeId}
              </CardTitle>
              <p className="text-[10px] text-muted-foreground mt-1">
                Puissances transitantes (nœud sélectionné + aval)
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ScrollArea className="h-[180px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card/95">
                    <tr className="border-b border-border">
                      <th className="text-left py-1 px-1 font-medium text-muted-foreground" rowSpan={2}>Heure</th>
                      <th className="text-center py-1 px-1 font-medium text-orange-400" colSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Home className="h-3 w-3" /> Résidentiel
                        </span>
                      </th>
                      <th className="text-center py-1 px-1 font-medium text-emerald-400" rowSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Car className="h-3 w-3" /> VE
                        </span>
                      </th>
                      <th className="text-center py-1 px-1 font-medium text-amber-500" colSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Factory className="h-3 w-3" /> Industriel
                        </span>
                      </th>
                      <th className="text-center py-1 px-1 font-medium text-green-400" colSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Sun className="h-3 w-3" /> Production
                        </span>
                      </th>
                      <th className="text-right py-1 px-1 font-medium text-blue-400" rowSpan={2}>V moy</th>
                    </tr>
                    <tr className="border-b border-border text-[10px] text-muted-foreground">
                      <th className="text-right px-1">%</th>
                      <th className="text-right px-1">kVA</th>
                      <th className="text-right px-1">%</th>
                      <th className="text-right px-1">kVA</th>
                      <th className="text-right px-1">%</th>
                      <th className="text-right px-1">kVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultsWinter.map((r) => (
                      <tr 
                        key={r.hour} 
                        className={`border-b border-border/30 ${
                          r.status === 'critical' ? 'bg-destructive/10' : 
                          r.status === 'warning' ? 'bg-yellow-500/10' : ''
                        }`}
                      >
                        <td className="py-1 px-1 font-mono">{r.hour.toString().padStart(2, '0')}h</td>
                        <td className="text-right py-1 px-1 font-mono text-orange-400">
                          {r.chargesResidentialFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-orange-300">
                          {r.chargesResidentialPower_kVA.toFixed(1)}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-emerald-400">
                          {r.evBonus > 0 ? `+${r.evBonus.toFixed(1)}%` : '-'}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-amber-500">
                          {r.chargesIndustrialFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-amber-300">
                          {r.chargesIndustrialPower_kVA.toFixed(1)}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-green-400">
                          {r.productionsFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-green-300">
                          {r.productionsPower_kVA.toFixed(1)}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-blue-400">
                          {r.voltageAvg_V.toFixed(1)}V
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Tableau foisonnement horaire - Été */}
        {showDetails && resultsSummer.length > 0 && (
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Percent className="h-4 w-4 text-primary" />
                ☀️ Foisonnement horaire Été - {selectedNode?.name || dailyProfileOptions.selectedNodeId}
              </CardTitle>
              <p className="text-[10px] text-muted-foreground mt-1">
                Puissances transitantes (nœud sélectionné + aval)
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ScrollArea className="h-[180px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card/95">
                    <tr className="border-b border-border">
                      <th className="text-left py-1 px-1 font-medium text-muted-foreground" rowSpan={2}>Heure</th>
                      <th className="text-center py-1 px-1 font-medium text-orange-400" colSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Home className="h-3 w-3" /> Résidentiel
                        </span>
                      </th>
                      <th className="text-center py-1 px-1 font-medium text-emerald-400" rowSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Car className="h-3 w-3" /> VE
                        </span>
                      </th>
                      <th className="text-center py-1 px-1 font-medium text-amber-500" colSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Factory className="h-3 w-3" /> Industriel
                        </span>
                      </th>
                      <th className="text-center py-1 px-1 font-medium text-green-400" colSpan={2}>
                        <span className="flex items-center justify-center gap-1">
                          <Sun className="h-3 w-3" /> Production
                        </span>
                      </th>
                      <th className="text-right py-1 px-1 font-medium text-blue-400" rowSpan={2}>V moy</th>
                    </tr>
                    <tr className="border-b border-border text-[10px] text-muted-foreground">
                      <th className="text-right px-1">%</th>
                      <th className="text-right px-1">kVA</th>
                      <th className="text-right px-1">%</th>
                      <th className="text-right px-1">kVA</th>
                      <th className="text-right px-1">%</th>
                      <th className="text-right px-1">kVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultsSummer.map((r) => (
                      <tr 
                        key={r.hour} 
                        className={`border-b border-border/30 ${
                          r.status === 'critical' ? 'bg-destructive/10' : 
                          r.status === 'warning' ? 'bg-yellow-500/10' : ''
                        }`}
                      >
                        <td className="py-1 px-1 font-mono">{r.hour.toString().padStart(2, '0')}h</td>
                        <td className="text-right py-1 px-1 font-mono text-orange-400">
                          {r.chargesResidentialFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-orange-300">
                          {r.chargesResidentialPower_kVA.toFixed(1)}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-emerald-400">
                          {r.evBonus > 0 ? `+${r.evBonus.toFixed(1)}%` : '-'}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-amber-500">
                          {r.chargesIndustrialFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-amber-300">
                          {r.chargesIndustrialPower_kVA.toFixed(1)}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-green-400">
                          {r.productionsFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-green-300">
                          {r.productionsPower_kVA.toFixed(1)}
                        </td>
                        <td className="text-right py-1 px-1 font-mono text-blue-400">
                          {r.voltageAvg_V.toFixed(1)}V
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Éditeur visuel de profils */}
      <ProfileVisualEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        profiles={dailyProfileCustomProfiles}
        onSave={setDailyProfileCustomProfiles}
      />

      {/* Importeur de profil mesuré PQ-Box */}
      <MeasuredProfileImporter
        open={importerOpen}
        onOpenChange={setImporterOpen}
      />

      {/* Éditeur de profil mesuré existant */}
      <MeasuredProfileImporter
        open={editMeasuredOpen}
        onOpenChange={setEditMeasuredOpen}
        editMode={true}
      />

      {/* Dialog d'information sur le calcul */}
      {(() => {
        const clients = currentProject.clientsImportes || [];
        const links = currentProject.clientLinks || [];
        let nRes = 0, nInd = 0;
        clients.forEach(c => {
          if (links.some(l => l.clientId === c.id)) {
            if (c.clientType === 'industriel') nInd++; else nRes++;
          }
        });
        const cluster = getClusterById(dailyProfileOptions.selectedClusterId || DEFAULT_CLUSTER_ID);
        return (
          <CalculationInfoDialog
            open={showInfoDialog}
            onOpenChange={setShowInfoDialog}
            nResidentialClients={nRes}
            nIndustrialClients={nInd}
            selectedClusterName={cluster?.name || 'Urbain résidentiel'}
            facteurConso={dailyProfileOptions.customFacteurConso ?? cluster?.facteurConso ?? 1.0}
            facteurVE={dailyProfileOptions.customFacteurVE ?? cluster?.facteurVE ?? 1.0}
          />
        );
      })()}
    </div>
  );
};
