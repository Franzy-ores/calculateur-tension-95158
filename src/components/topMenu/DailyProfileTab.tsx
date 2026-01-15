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
import { HourlyVoltageResult } from '@/types/dailyProfile';
import { Clock, Sun, Cloud, Car, Factory, Edit3, AlertTriangle, Percent, Home, Zap, FlaskConical, Moon, Upload, FileBarChart, X, Download, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { HourlyProfile, MeasuredProfileMetadata } from '@/types/dailyProfile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Project } from '@/types/network';

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
  } = useNetworkStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [importerOpen, setImporterOpen] = useState(false);
  const [editMeasuredOpen, setEditMeasuredOpen] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);

  // Résultats du calcul
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
      setResults([]);
      setResultsWithoutSim([]);
      return;
    }

    // Calcul AVEC simulation (si active)
    const calculatorWithSim = new DailyProfileCalculator(
      currentProject, 
      dailyProfileOptions, 
      dailyProfileCustomProfiles,
      hasActiveSimulation ? simulationEquipment : undefined,
      hasActiveSimulation,
      dailyProfileOptions.useMeasuredProfile ? measuredProfile ?? undefined : undefined
    );
    setResults(calculatorWithSim.calculateDailyVoltages());

    // Calcul SANS simulation (pour comparaison)
    if (hasActiveSimulation && comparisonMode) {
      const calculatorBase = new DailyProfileCalculator(
        currentProject, 
        dailyProfileOptions, 
        dailyProfileCustomProfiles,
        undefined,
        false,
        dailyProfileOptions.useMeasuredProfile ? measuredProfile ?? undefined : undefined
      );
      setResultsWithoutSim(calculatorBase.calculateDailyVoltages());
    } else {
      setResultsWithoutSim([]);
    }
  }, [currentProject, dailyProfileOptions, dailyProfileCustomProfiles, simulationEquipment, isSimulationActive, hasActiveSimulation, comparisonMode, measuredProfile]);

  // Heures critiques
  const criticalHours = useMemo(() => {
    return DailyProfileCalculator.findCriticalHours(results).slice(0, 5);
  }, [results]);

  // Tension nominale : toujours 230V car on calcule en phase-neutre
  const nominalVoltage = 230;

  // Nœud sélectionné
  const selectedNode = nodes.find(n => n.id === dailyProfileOptions.selectedNodeId);

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

          {/* Saison */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Saison</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={dailyProfileOptions.season === 'winter' ? 'default' : 'outline'}
                onClick={() => setDailyProfileOptions({ season: 'winter' })}
                className="flex-1"
              >
                ❄️ Hiver
              </Button>
              <Button
                size="sm"
                variant={dailyProfileOptions.season === 'summer' ? 'default' : 'outline'}
                onClick={() => setDailyProfileOptions({ season: 'summer' })}
                className="flex-1"
              >
                ☀️ Été
              </Button>
            </div>
          </div>

          {/* Météo / Production */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Météo / Production</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={dailyProfileOptions.weather === 'sunny' && !dailyProfileOptions.zeroProduction ? 'default' : 'outline'}
                onClick={() => setDailyProfileOptions({ weather: 'sunny', zeroProduction: false })}
                className="flex-1 gap-1"
              >
                <Sun className="h-4 w-4" />
                Soleil
              </Button>
              <Button
                size="sm"
                variant={dailyProfileOptions.weather === 'gray' && !dailyProfileOptions.zeroProduction ? 'default' : 'outline'}
                onClick={() => setDailyProfileOptions({ weather: 'gray', zeroProduction: false })}
                className="flex-1 gap-1"
              >
                <Cloud className="h-4 w-4" />
                Gris
              </Button>
              <Button
                size="sm"
                variant={dailyProfileOptions.zeroProduction ? 'default' : 'outline'}
                onClick={() => setDailyProfileOptions({ zeroProduction: true })}
                className="flex-1 gap-1"
              >
                <Moon className="h-4 w-4" />
                Nuit
              </Button>
            </div>
          </div>

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

      {/* Colonne centrale et droite: Graphe + Heures critiques */}
      <div className="lg:col-span-2 space-y-4">
        {/* Graphe */}
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2">
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
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {results.length > 0 ? (
              <DailyProfileChart
                data={results}
                comparisonData={comparisonMode ? resultsWithoutSim : undefined}
                nominalVoltage={nominalVoltage}
              />
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Sélectionnez un nœud pour afficher le graphe
              </div>
            )}
          </CardContent>
        </Card>

        {/* Heures critiques */}
        {criticalHours.length > 0 && (
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Heures critiques
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                {criticalHours.map((h) => (
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
            </CardContent>
          </Card>
        )}

        {/* Tableau foisonnement horaire */}
        {results.length > 0 && (
          <Card className="bg-card/50 backdrop-blur border-border/50">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Percent className="h-4 w-4 text-primary" />
                Foisonnement horaire - Nœud {selectedNode?.name || dailyProfileOptions.selectedNodeId}
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
                    {results.map((r) => (
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
    </div>
  );
};
