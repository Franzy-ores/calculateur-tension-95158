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
import { ProfileEditor } from '@/components/ProfileEditor';
import { DailyProfileConfig, DailySimulationOptions, HourlyVoltageResult, Season, Weather } from '@/types/dailyProfile';
import { Clock, Sun, Cloud, Car, Factory, FileEdit, AlertTriangle, Percent } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import defaultProfiles from '@/data/hourlyProfiles.json';

export const DailyProfileTab = () => {
  const { currentProject } = useNetworkStore();

  // Options de simulation
  const [options, setOptions] = useState<DailySimulationOptions>({
    season: 'winter',
    weather: 'sunny',
    enableEV: true,
    enableIndustrialPME: true,
    selectedNodeId: ''
  });

  // Profils personnalisés
  const [customProfiles, setCustomProfiles] = useState<DailyProfileConfig>(defaultProfiles as DailyProfileConfig);
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
    if (nodes.length > 0 && !options.selectedNodeId) {
      setOptions(prev => ({ ...prev, selectedNodeId: nodes[0].id }));
    }
  }, [nodes, options.selectedNodeId]);

  // Calcul des tensions quand les options changent
  useEffect(() => {
    if (!currentProject || !options.selectedNodeId) {
      setResults([]);
      return;
    }

    const calculator = new DailyProfileCalculator(currentProject, options, customProfiles);
    const hourlyResults = calculator.calculateDailyVoltages();
    setResults(hourlyResults);
  }, [currentProject, options, customProfiles]);

  // Heures critiques
  const criticalHours = useMemo(() => {
    return DailyProfileCalculator.findCriticalHours(results).slice(0, 5);
  }, [results]);

  // Tension nominale : toujours 230V car on calcule en phase-neutre
  const nominalVoltage = 230;

  // Nœud sélectionné
  const selectedNode = nodes.find(n => n.id === options.selectedNodeId);

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
              value={options.selectedNodeId}
              onValueChange={(value) => setOptions(prev => ({ ...prev, selectedNodeId: value }))}
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
                variant={options.season === 'winter' ? 'default' : 'outline'}
                onClick={() => setOptions(prev => ({ ...prev, season: 'winter' }))}
                className="flex-1"
              >
                ❄️ Hiver
              </Button>
              <Button
                size="sm"
                variant={options.season === 'summer' ? 'default' : 'outline'}
                onClick={() => setOptions(prev => ({ ...prev, season: 'summer' }))}
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
                variant={options.weather === 'sunny' ? 'default' : 'outline'}
                onClick={() => setOptions(prev => ({ ...prev, weather: 'sunny' }))}
                className="flex-1 gap-1"
              >
                <Sun className="h-4 w-4" />
                Ensoleillé
              </Button>
              <Button
                size="sm"
                variant={options.weather === 'gray' ? 'default' : 'outline'}
                onClick={() => setOptions(prev => ({ ...prev, weather: 'gray' }))}
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
                Charge VE ({customProfiles.evPower_kVA} kVA)
              </Label>
              <Switch
                checked={options.enableEV}
                onCheckedChange={(checked) => setOptions(prev => ({ ...prev, enableEV: checked }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2">
                <Factory className="h-4 w-4 text-muted-foreground" />
                Industrie / PME
              </Label>
              <Switch
                checked={options.enableIndustrialPME}
                onCheckedChange={(checked) => setOptions(prev => ({ ...prev, enableIndustrialPME: checked }))}
              />
            </div>
          </div>

          {/* Bouton éditer profils */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditorOpen(true)}
            className="w-full gap-2"
          >
            <FileEdit className="h-4 w-4" />
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
                Tension au nœud {selectedNode?.name || options.selectedNodeId}
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
                Foisonnement horaire utilisé
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ScrollArea className="h-[180px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card/95">
                    <tr className="border-b border-border">
                      <th className="text-left py-1 px-2 font-medium text-muted-foreground">Heure</th>
                      <th className="text-right py-1 px-2 font-medium text-orange-400">Charges %</th>
                      <th className="text-right py-1 px-2 font-medium text-green-400">Productions %</th>
                      <th className="text-right py-1 px-2 font-medium text-blue-400">V moy</th>
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
                        <td className="py-1 px-2 font-mono">{r.hour.toString().padStart(2, '0')}h</td>
                        <td className="text-right py-1 px-2 font-mono text-orange-400">
                          {r.chargesFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-2 font-mono text-green-400">
                          {r.productionsFoisonnement.toFixed(0)}%
                        </td>
                        <td className="text-right py-1 px-2 font-mono text-blue-400">
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

      {/* Éditeur de profils */}
      <ProfileEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        profiles={customProfiles}
        onSave={setCustomProfiles}
      />
    </div>
  );
};
