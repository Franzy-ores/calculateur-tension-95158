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
import { HourlyVoltageResult } from '@/types/dailyProfile';
import { Clock, Sun, Cloud, Car, Factory, Edit3, AlertTriangle, Percent, Home, Zap } from 'lucide-react';
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
    isSimulationActive
  } = useNetworkStore();

  const [editorOpen, setEditorOpen] = useState(false);

  // Résultats du calcul
  const [results, setResults] = useState<HourlyVoltageResult[]>([]);

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

  // Vérifier si la simulation est active avec équipements
  const hasActiveSimulation = isSimulationActive && (
    (simulationEquipment.srg2Devices?.some(s => s.enabled)) ||
    (simulationEquipment.neutralCompensators?.some(c => c.enabled)) ||
    (simulationEquipment.cableReplacement?.enabled)
  );

  // Calcul des tensions quand les options changent
  useEffect(() => {
    if (!currentProject || !dailyProfileOptions.selectedNodeId) {
      setResults([]);
      return;
    }

    const calculator = new DailyProfileCalculator(
      currentProject, 
      dailyProfileOptions, 
      dailyProfileCustomProfiles,
      hasActiveSimulation ? simulationEquipment : undefined,
      hasActiveSimulation
    );
    const hourlyResults = calculator.calculateDailyVoltages();
    setResults(hourlyResults);
  }, [currentProject, dailyProfileOptions, dailyProfileCustomProfiles, simulationEquipment, isSimulationActive, hasActiveSimulation]);

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
            <Select
              value={dailyProfileOptions.selectedNodeId}
              onValueChange={(value) => setDailyProfileOptions({ selectedNodeId: value })}
            >
              <SelectTrigger className="w-full">
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

          {/* Météo */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Météo</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={dailyProfileOptions.weather === 'sunny' ? 'default' : 'outline'}
                onClick={() => setDailyProfileOptions({ weather: 'sunny' })}
                className="flex-1 gap-1"
              >
                <Sun className="h-4 w-4" />
                Ensoleillé
              </Button>
              <Button
                size="sm"
                variant={dailyProfileOptions.weather === 'gray' ? 'default' : 'outline'}
                onClick={() => setDailyProfileOptions({ weather: 'gray' })}
                className="flex-1 gap-1"
              >
                <Cloud className="h-4 w-4" />
                Gris
              </Button>
            </div>
          </div>

          {/* Options de charge */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2">
                <Car className="h-4 w-4 text-muted-foreground" />
                Charge VE ({dailyProfileCustomProfiles.evPower_kVA} kVA)
              </Label>
              <Switch
                checked={dailyProfileOptions.enableEV}
                onCheckedChange={(checked) => setDailyProfileOptions({ enableEV: checked })}
              />
            </div>
            
            {/* Statistiques clients détectés */}
            <ClientStatsDisplay project={currentProject} />
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
              <Badge variant="outline" className="text-xs">
                {nominalVoltage}V nominal
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {results.length > 0 ? (
              <DailyProfileChart
                data={results}
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
    </div>
  );
};
