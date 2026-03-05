import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';
import { FlaskConical, MapPin, Sun, Cloud, AlertTriangle, TrendingUp, TrendingDown, Zap, Ruler } from 'lucide-react';
import { clusterProfiles, getClusterById, DEFAULT_CLUSTER_ID } from '@/data/clusterProfiles';
import {
  simulateCircuit24h,
  diversityFactor,
} from '@/utils/circuitPowerCalculator';
import { getFoisonnementPalier } from '@/utils/foisonnementCalculator';
import { DailyProfileCalculator } from '@/utils/dailyProfileCalculator';
import type {
  CircuitConfig,
  CircuitClient,
  CircuitCluster,
  CircuitSeason,
  CircuitWeather,
  CircuitSimulationConfig,
  CircuitSimulationResult,
  SeasonProfiles,
} from '@/types/circuitSimulation';
import type { HourlyVoltageResult, DailySimulationOptions } from '@/types/dailyProfile';
import type { Node as NetworkNode, Cable, CalculationResult } from '@/types/network';
import circuitSimulationConfigData from '@/data/circuitSimulationConfig.json';
import hourlyProfilesData from '@/data/hourlyProfiles.json';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types pour les chemins réseau ──────────────────────────────────────────────
interface BranchPoint {
  nodeId: string;
  nodeName: string;
  distance_m: number;
}

interface BranchPath {
  branchId: string;
  label: string;
  points: BranchPoint[];
}

// ─── BFS pour construire les chemins depuis la source ───────────────────────────
function buildNetworkPaths(nodes: NetworkNode[], cables: Cable[]): BranchPath[] {
  const source = nodes.find(n => n.isSource);
  if (!source) return [];

  // BFS pour construire l'arbre
  const children = new Map<string, { nodeId: string; cableLength: number }[]>();
  const visited = new Set<string>();
  const queue: string[] = [source.id];
  visited.add(source.id);
  const distanceMap = new Map<string, number>();
  distanceMap.set(source.id, 0);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDist = distanceMap.get(currentId) || 0;

    const connectedCables = cables.filter(
      c => c.nodeAId === currentId || c.nodeBId === currentId
    );

    for (const cable of connectedCables) {
      const nextId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
      if (visited.has(nextId)) continue;
      visited.add(nextId);

      if (!children.has(currentId)) children.set(currentId, []);
      children.get(currentId)!.push({ nodeId: nextId, cableLength: cable.length_m || 0 });

      distanceMap.set(nextId, currentDist + (cable.length_m || 0));
      queue.push(nextId);
    }
  }

  // Trouver les feuilles (nœuds sans enfants)
  const leaves: string[] = [];
  for (const nodeId of visited) {
    if (!children.has(nodeId) || children.get(nodeId)!.length === 0) {
      leaves.push(nodeId);
    }
  }

  // Remonter de chaque feuille vers la source pour construire les branches
  const parentMap = new Map<string, string>();
  const buildParent = (nodeId: string) => {
    for (const [parent, childs] of children) {
      for (const child of childs) {
        if (child.nodeId === nodeId) return parent;
      }
    }
    return null;
  };
  for (const nodeId of visited) {
    const p = buildParent(nodeId);
    if (p) parentMap.set(nodeId, p);
  }

  const branches: BranchPath[] = [];
  const nodeNameMap = new Map(nodes.map(n => [n.id, n.name || n.id.slice(0, 6)]));

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    // Remonter jusqu'à la source
    const path: BranchPoint[] = [];
    let current: string | undefined = leaf;
    while (current) {
      path.unshift({
        nodeId: current,
        nodeName: nodeNameMap.get(current) || current.slice(0, 6),
        distance_m: distanceMap.get(current) || 0,
      });
      current = parentMap.get(current);
    }

    const leafName = nodeNameMap.get(leaf) || leaf.slice(0, 6);
    branches.push({
      branchId: `branch_${i}`,
      label: path.length > 2
        ? `${nodeNameMap.get(path[1]?.nodeId) || ''}→${leafName}`
        : leafName,
      points: path,
    });
  }

  return branches;
}

// Couleurs pour les branches
const BRANCH_COLORS = [
  'hsl(217, 91%, 60%)',    // blue
  'hsl(142, 76%, 36%)',    // green
  'hsl(25, 95%, 53%)',     // orange
  'hsl(330, 81%, 60%)',    // pink
  'hsl(48, 96%, 53%)',     // yellow
  'hsl(270, 70%, 60%)',    // purple
  'hsl(190, 90%, 50%)',    // cyan
];

// ─── Mapping cluster existant → circuit ────────────────────────────────────────
const CLUSTER_MAP: Record<string, CircuitCluster> = {
  cluster_1: 'A',
  cluster_2: 'B',
  cluster_3: 'C',
  cluster_4: 'D',
};

// ─── Config typée ──────────────────────────────────────────────────────────────
const circuitConfig: CircuitSimulationConfig = {
  version: circuitSimulationConfigData.version,
  diversityFactors: circuitSimulationConfigData.diversityFactors as any,
  clusterDeltas: circuitSimulationConfigData.clusterDeltas as any,
  thresholds: circuitSimulationConfigData.thresholds,
};

// ─── Profils typés ─────────────────────────────────────────────────────────────
const profiles: { winter: SeasonProfiles; summer: SeasonProfiles } = {
  winter: hourlyProfilesData.profiles.winter as SeasonProfiles,
  summer: hourlyProfilesData.profiles.summer as SeasonProfiles,
};

const weatherFactors = hourlyProfilesData.weatherFactors as { sunny: number; gray: number };

export const LaboFoisonnementTab = () => {
  const {
    currentProject,
    dailyProfileOptions,
    setDailyProfileOptions,
    startNodeSelection,
    nodeSelectionMode,
    simulationEquipment,
    isSimulationActive,
  } = useNetworkStore();

  const [season, setSeason] = useState<CircuitSeason>('winter');
  const [weather, setWeather] = useState<CircuitWeather>('sunny');

  const nodes = useMemo(() => {
    if (!currentProject) return [];
    return currentProject.nodes.filter(n => !n.isSource);
  }, [currentProject]);

  const selectedNodeId = dailyProfileOptions.selectedNodeId;
  const selectedClusterId = dailyProfileOptions.selectedClusterId || DEFAULT_CLUSTER_ID;
  const circuitCluster = CLUSTER_MAP[selectedClusterId] || 'B';

  // Auto-select first node
  useEffect(() => {
    if (nodes.length > 0 && !selectedNodeId) {
      setDailyProfileOptions({ selectedNodeId: nodes[0].id });
    }
  }, [nodes, selectedNodeId, setDailyProfileOptions]);

  // Build CircuitConfig from project data
  const { circuit, nResidential } = useMemo(() => {
    if (!currentProject || !selectedNodeId) return { circuit: null, nResidential: 0 };

    const links = currentProject.clientLinks || [];
    const clients = currentProject.clientsImportes || [];
    const linkedClientIds = links.filter(l => l.nodeId === selectedNodeId).map(l => l.clientId);
    const linkedClients = clients.filter(c => linkedClientIds.includes(c.id));

    const cosPhi = currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95;

    let nRes = 0;
    const circuitClients: CircuitClient[] = linkedClients.map(c => {
      const isIndustrial = c.clientType === 'industriel';
      if (!isIndustrial) nRes++;
      
      const cc: CircuitClient = {
        id: c.id,
        type: isIndustrial ? 'industrial_pme' : 'residential',
        puissanceContrat_kW: c.puissanceContractuelle_kVA * cosPhi,
      };

      return cc;
    });

    // Add PV clients separately
    linkedClients.forEach(c => {
      if (c.puissancePV_kVA > 0) {
        circuitClients.push({
          id: `${c.id}_pv`,
          type: 'pv',
          puissanceContrat_kW: 0,
          pvPuissance_kW: c.puissancePV_kVA,
        });
      }
    });

    const cfg: CircuitConfig = {
      id: selectedNodeId,
      cluster: circuitCluster,
      clients: circuitClients,
    };
    return { circuit: cfg, nResidential: nRes };
  }, [currentProject, selectedNodeId, circuitCluster]);

  // Run power simulation (moteur continu)
  const result: CircuitSimulationResult | null = useMemo(() => {
    if (!circuit || circuit.clients.length === 0) return null;
    return simulateCircuit24h(circuit, season, weather, profiles, weatherFactors, circuitConfig);
  }, [circuit, season, weather]);

  // ─── Voltage simulations: Palier vs Continu ──────────────────────────────────
  const continuCoeff = nResidential > 0 ? diversityFactor(nResidential, circuitCluster, circuitConfig) : 0;
  const palierCoeff = nResidential > 0 ? getFoisonnementPalier(nResidential) : 0;

  const { voltagePalier, voltageContinu } = useMemo(() => {
    if (!currentProject || !selectedNodeId || nResidential === 0) {
      return { voltagePalier: [] as HourlyVoltageResult[], voltageContinu: [] as HourlyVoltageResult[] };
    }

    const baseOptions: DailySimulationOptions = {
      season: season as 'winter' | 'summer',
      weather: weather as 'sunny' | 'gray',
      enableEV: dailyProfileOptions.enableEV ?? true,
      evBonusEvening: dailyProfileOptions.evBonusEvening ?? 2.5,
      evBonusNight: dailyProfileOptions.evBonusNight ?? 5,
      selectedNodeId,
      selectedClusterId,
      zeroProduction: dailyProfileOptions.zeroProduction ?? false,
      adaptiveFoisonnement: true,
    };

    // Run 1: Palier (standard)
    const calcPalier = new DailyProfileCalculator(
      currentProject,
      baseOptions,
      undefined,
      simulationEquipment,
      isSimulationActive
    );
    const resPalier = calcPalier.calculateDailyVoltages();

    // Run 2: Continu (customDiversityCoeff)
    const calcContinu = new DailyProfileCalculator(
      currentProject,
      {
        ...baseOptions,
        adaptiveFoisonnement: false,
        customDiversityCoeff: continuCoeff,
      },
      undefined,
      simulationEquipment,
      isSimulationActive
    );
    const resContinu = calcContinu.calculateDailyVoltages();

    return { voltagePalier: resPalier, voltageContinu: resContinu };
  }, [currentProject, selectedNodeId, season, weather, selectedClusterId, nResidential, continuCoeff, dailyProfileOptions, simulationEquipment, isSimulationActive]);

  // Comparison data: palier vs continu for each hour (power + voltage)
  const comparisonData = useMemo(() => {
    if (!result || nResidential === 0) return [];

    const seasonProfiles = profiles[season];

    return result.hourly.map((h, i) => {
      const baseProfile = seasonProfiles.residential[h.hour.toString()] ?? 0;
      const palierProfile = baseProfile * palierCoeff;
      const continuProfile = baseProfile * continuCoeff;
      const delta = palierProfile > 0 ? ((continuProfile - palierProfile) / palierProfile * 100) : 0;

      const vPalier = voltagePalier[i]?.voltageAvg_V ?? 0;
      const vContinu = voltageContinu[i]?.voltageAvg_V ?? 0;
      const deltaV = vPalier > 0 ? (vContinu - vPalier) : 0;

      return {
        hour: h.hour,
        label: `${h.hour}h`,
        P_charge: +h.P_charge_kW.toFixed(2),
        P_pv: +h.P_pv_kW.toFixed(2),
        P_net: +h.P_net_kW.toFixed(2),
        flagged: h.flagged,
        flagType: h.flagType,
        palierCoeff: +palierCoeff.toFixed(4),
        continuCoeff: +continuCoeff.toFixed(4),
        baseProfile: +baseProfile.toFixed(1),
        palierProfile: +palierProfile.toFixed(2),
        continuProfile: +continuProfile.toFixed(2),
        delta: +delta.toFixed(1),
        // Voltages
        V_palier: +vPalier.toFixed(2),
        V_continu: +vContinu.toFixed(2),
        deltaV: +deltaV.toFixed(2),
      };
    });
  }, [result, nResidential, circuitCluster, season, voltagePalier, voltageContinu, palierCoeff, continuCoeff]);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const clusterInfo = getClusterById(selectedClusterId);
  const aCoeff = circuitConfig.diversityFactors[circuitCluster];

  // Compute voltage Y-axis domain
  const voltageRange = useMemo(() => {
    if (comparisonData.length === 0) return { min: 200, max: 250 };
    const allV = comparisonData.flatMap(d => [d.V_palier, d.V_continu]).filter(v => v > 0);
    if (allV.length === 0) return { min: 200, max: 250 };
    const min = Math.min(...allV);
    const max = Math.max(...allV);
    return { min: Math.floor(min - 3), max: Math.ceil(max + 3) };
  }, [comparisonData]);

  if (!currentProject) {
    return <div className="p-4 text-center text-muted-foreground">Aucun projet chargé</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
      {/* Col 1: Paramètres */}
      <Card className="bg-card/50 backdrop-blur border-violet-500/30">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-violet-500" />
            Labo — Paramètres
            <Badge variant="outline" className="text-[10px] border-violet-500/50 text-violet-500 ml-auto">TEST</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Node selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Nœud analysé</Label>
            <div className="flex gap-2">
              <Select value={selectedNodeId || ''} onValueChange={v => setDailyProfileOptions({ selectedNodeId: v })}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Sélectionner un nœud" /></SelectTrigger>
                <SelectContent>
                  {nodes.map(n => <SelectItem key={n.id} value={n.id}>{n.name || n.id}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant={nodeSelectionMode === 'profil24h' ? 'default' : 'outline'}
                size="icon"
                onClick={() => startNodeSelection('profil24h')}
                className="shrink-0"
              >
                <MapPin className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Season */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Saison</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant={season === 'winter' ? 'default' : 'outline'} onClick={() => setSeason('winter')}>
                ❄️ Hiver
              </Button>
              <Button size="sm" variant={season === 'summer' ? 'default' : 'outline'} onClick={() => setSeason('summer')}>
                ☀️ Été
              </Button>
            </div>
          </div>

          {/* Weather */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Météo PV</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant={weather === 'sunny' ? 'default' : 'outline'} onClick={() => setWeather('sunny')}>
                <Sun className="h-3.5 w-3.5 mr-1" /> Soleil
              </Button>
              <Button size="sm" variant={weather === 'gray' ? 'default' : 'outline'} onClick={() => setWeather('gray')}>
                <Cloud className="h-3.5 w-3.5 mr-1" /> Gris
              </Button>
            </div>
          </div>

          {/* Cluster */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Cluster</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {clusterProfiles.map(cp => (
                <Button
                  key={cp.id}
                  size="sm"
                  variant={selectedClusterId === cp.id ? 'default' : 'outline'}
                  onClick={() => setDailyProfileOptions({ selectedClusterId: cp.id })}
                  className="text-xs h-auto py-1.5 px-2 flex flex-col items-start gap-0.5"
                >
                  <span className="flex items-center gap-1">
                    <span>{cp.icon}</span> {cp.name}
                  </span>
                  <span className="text-[9px] text-muted-foreground opacity-70">
                    → {CLUSTER_MAP[cp.id]} (a={circuitConfig.diversityFactors[CLUSTER_MAP[cp.id]]})
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {/* Formule */}
          <div className="bg-muted/50 rounded-md p-3 space-y-2 text-xs">
            <div className="font-medium text-foreground">Formule continue</div>
            <div className="font-mono text-muted-foreground">
              f(N) = a + (1−a)/√N
            </div>
            {nResidential > 0 && (
              <>
                <div className="text-muted-foreground">
                  N = {nResidential} résidentiels, a = {aCoeff}
                </div>
                <div className="flex justify-between">
                  <span className="text-violet-500 font-medium">Continu: {continuCoeff.toFixed(4)}</span>
                  <span className="text-muted-foreground">Palier: {palierCoeff.toFixed(2)}</span>
                </div>
                <div className={`font-medium ${continuCoeff > palierCoeff ? 'text-orange-500' : 'text-emerald-500'}`}>
                  Δ = {((continuCoeff - palierCoeff) / palierCoeff * 100).toFixed(0)}%
                </div>
              </>
            )}
          </div>

          {/* Summary */}
          {result && (
            <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-xs">
              <div className="font-medium text-foreground">Synthèse puissances</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Pic charge</span>
                <span className="font-mono">{result.peakLoad_kW.toFixed(1)} kW</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Pic injection</span>
                <span className="font-mono">{result.peakInjection_kW.toFixed(1)} kW</span>
              </div>
              {result.nEvents_high > 0 && (
                <div className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3 w-3" /> {result.nEvents_high} h surcharge (&gt;{circuitConfig.thresholds.overload_kW} kW)
                </div>
              )}
              {result.nEvents_low > 0 && (
                <div className="flex items-center gap-1 text-emerald-500">
                  <AlertTriangle className="h-3 w-3" /> {result.nEvents_low} h injection (&lt;{circuitConfig.thresholds.injection_kW} kW)
                </div>
              )}
              {result.nEvents_high === 0 && result.nEvents_low === 0 && (
                <div className="text-muted-foreground">Aucune alerte</div>
              )}
            </div>
          )}

          {/* Voltage summary */}
          {comparisonData.length > 0 && comparisonData.some(d => d.V_palier > 0) && (
            <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-xs">
              <div className="font-medium text-foreground flex items-center gap-1">
                <Zap className="h-3 w-3 text-violet-500" /> Synthèse tensions
              </div>
              {(() => {
                const vPaliers = comparisonData.map(d => d.V_palier).filter(v => v > 0);
                const vContinus = comparisonData.map(d => d.V_continu).filter(v => v > 0);
                const minP = vPaliers.length > 0 ? Math.min(...vPaliers) : 0;
                const minC = vContinus.length > 0 ? Math.min(...vContinus) : 0;
                const maxP = vPaliers.length > 0 ? Math.max(...vPaliers) : 0;
                const maxC = vContinus.length > 0 ? Math.max(...vContinus) : 0;
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">V min palier</span>
                      <span className={`font-mono ${minP < 207 ? 'text-destructive' : minP < 218.5 ? 'text-orange-500' : ''}`}>{minP.toFixed(1)} V</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-violet-500">V min continu</span>
                      <span className={`font-mono ${minC < 207 ? 'text-destructive' : minC < 218.5 ? 'text-orange-500' : ''}`}>{minC.toFixed(1)} V</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">V max palier</span>
                      <span className="font-mono">{maxP.toFixed(1)} V</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-violet-500">V max continu</span>
                      <span className="font-mono">{maxC.toFixed(1)} V</span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Col 2-3: Graphiques + Tableau */}
      <div className="lg:col-span-2 space-y-4">
        {/* Graphique Puissances 24h */}
        {comparisonData.length > 0 ? (
          <Card className="bg-card/50 backdrop-blur border-violet-500/30">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                Puissance nodale 24h — Moteur continu f(N)
                <Badge variant="outline" className="text-[10px]">
                  {selectedNode?.name || selectedNodeId} • {season === 'winter' ? '❄️ Hiver' : '☀️ Été'} • {weather === 'sunny' ? '☀️' : '☁️'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit=" kW" />
                  <Tooltip
                    contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    formatter={(value: number, name: string) => [`${value.toFixed(2)} kW`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={circuitConfig.thresholds.overload_kW} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: 'Surcharge', fontSize: 9, fill: 'hsl(var(--destructive))' }} />
                  <ReferenceLine y={circuitConfig.thresholds.injection_kW} stroke="hsl(142, 76%, 36%)" strokeDasharray="5 5" label={{ value: 'Injection', fontSize: 9, fill: 'hsl(142, 76%, 36%)' }} />
                  <Line type="monotone" dataKey="P_charge" name="P charge" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="P_pv" name="P PV" stroke="hsl(142, 76%, 36%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="P_net" name="P net" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-card/50 backdrop-blur border-violet-500/30">
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              {!selectedNodeId ? 'Sélectionnez un nœud pour lancer la simulation' :
                'Aucun client lié à ce nœud. Liez des clients dans l\'onglet Raccordements.'}
            </CardContent>
          </Card>
        )}

        {/* Graphique Tensions 24h — Palier vs Continu */}
        {comparisonData.length > 0 && comparisonData.some(d => d.V_palier > 0) && (
          <Card className="bg-card/50 backdrop-blur border-violet-500/30">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-violet-500" />
                Tension nodale 24h — Palier vs Continu
                <Badge variant="outline" className="text-[10px] border-violet-500/50 text-violet-500">
                  ΔV = {comparisonData.reduce((max, d) => Math.max(max, Math.abs(d.deltaV)), 0).toFixed(1)} V max
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis 
                    domain={[voltageRange.min, voltageRange.max]} 
                    tick={{ fontSize: 10 }} 
                    unit=" V"
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    formatter={(value: number, name: string) => [`${value.toFixed(1)} V`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {/* Zone ±5% (218.5V — 241.5V) */}
                  <ReferenceArea y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.3} />
                  {/* Seuils ±10% */}
                  <ReferenceLine y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: '-10%', fontSize: 9, fill: 'hsl(var(--destructive))' }} />
                  <ReferenceLine y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: '+10%', fontSize: 9, fill: 'hsl(var(--destructive))' }} />
                  {/* Seuils ±5% */}
                  <ReferenceLine y={218.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={241.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                  {/* Nominale */}
                  <ReferenceLine y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} label={{ value: '230V', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                  {/* Courbes */}
                  <Line type="monotone" dataKey="V_palier" name="V palier" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="V_continu" name="V continu" stroke="hsl(270, 70%, 60%)" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Tableau comparatif étendu */}
        {comparisonData.length > 0 && (
          <Card className="bg-card/50 backdrop-blur border-violet-500/30">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium">
                Comparaison : Palier ({palierCoeff.toFixed(2)}) vs Continu ({continuCoeff.toFixed(4)})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ScrollArea className="h-[300px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Heure</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Base %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Palier %</th>
                      <th className="text-right py-1.5 px-2 text-violet-500 font-medium">Continu %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Δ %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">P net</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">V pal.</th>
                      <th className="text-right py-1.5 px-2 text-violet-500 font-medium">V cont.</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">ΔV</th>
                      <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonData.map(row => (
                      <tr
                        key={row.hour}
                        className={`border-b border-border/20 ${row.flagged ? (row.flagType === 'overload' ? 'bg-destructive/10' : 'bg-emerald-500/10') : ''}`}
                      >
                        <td className="py-1 px-2 font-mono">{row.label}</td>
                        <td className="py-1 px-2 text-right font-mono">{row.baseProfile}</td>
                        <td className="py-1 px-2 text-right font-mono">{row.palierProfile}</td>
                        <td className="py-1 px-2 text-right font-mono text-violet-500">{row.continuProfile}</td>
                        <td className={`py-1 px-2 text-right font-mono ${row.delta > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>
                          {row.delta > 0 ? '+' : ''}{row.delta}%
                        </td>
                        <td className="py-1 px-2 text-right font-mono">{row.P_net}</td>
                        <td className="py-1 px-2 text-right font-mono">{row.V_palier > 0 ? row.V_palier.toFixed(1) : '—'}</td>
                        <td className="py-1 px-2 text-right font-mono text-violet-500">{row.V_continu > 0 ? row.V_continu.toFixed(1) : '—'}</td>
                        <td className={`py-1 px-2 text-right font-mono ${Math.abs(row.deltaV) > 1 ? 'text-orange-500' : ''}`}>
                          {row.V_palier > 0 ? `${row.deltaV > 0 ? '+' : ''}${row.deltaV.toFixed(1)}` : '—'}
                        </td>
                        <td className="py-1 px-2 text-center">
                          {row.flagged && (
                            <AlertTriangle className={`h-3 w-3 inline ${row.flagType === 'overload' ? 'text-destructive' : 'text-emerald-500'}`} />
                          )}
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
    </div>
  );
};
