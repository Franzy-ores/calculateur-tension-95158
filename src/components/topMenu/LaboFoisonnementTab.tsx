import { useState, useMemo, useEffect } from 'react';
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
import { FlaskConical, MapPin, Sun, Cloud, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { clusterProfiles, getClusterById, DEFAULT_CLUSTER_ID } from '@/data/clusterProfiles';
import {
  simulateCircuit24h,
  diversityFactor,
} from '@/utils/circuitPowerCalculator';
import { getFoisonnementPalier } from '@/utils/foisonnementCalculator';
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
import circuitSimulationConfigData from '@/data/circuitSimulationConfig.json';
import hourlyProfilesData from '@/data/hourlyProfiles.json';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';

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

      // Add PV as separate client if present
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

  // Run simulation
  const result: CircuitSimulationResult | null = useMemo(() => {
    if (!circuit || circuit.clients.length === 0) return null;
    return simulateCircuit24h(circuit, season, weather, profiles, weatherFactors, circuitConfig);
  }, [circuit, season, weather]);

  // Comparison data: palier vs continu for each hour
  const comparisonData = useMemo(() => {
    if (!result || nResidential === 0) return [];

    const palierCoeff = getFoisonnementPalier(nResidential);
    const continuCoeff = diversityFactor(nResidential, circuitCluster, circuitConfig);
    const seasonProfiles = profiles[season];

    return result.hourly.map(h => {
      const baseProfile = seasonProfiles.residential[h.hour.toString()] ?? 0;
      const palierProfile = baseProfile * palierCoeff;
      const continuProfile = baseProfile * continuCoeff;
      const delta = palierProfile > 0 ? ((continuProfile - palierProfile) / palierProfile * 100) : 0;

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
      };
    });
  }, [result, nResidential, circuitCluster, season]);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const clusterInfo = getClusterById(selectedClusterId);
  const continuCoeff = nResidential > 0 ? diversityFactor(nResidential, circuitCluster, circuitConfig) : 0;
  const palierCoeff = nResidential > 0 ? getFoisonnementPalier(nResidential) : 0;
  const aCoeff = circuitConfig.diversityFactors[circuitCluster];

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
              <div className="font-medium text-foreground">Synthèse</div>
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
        </CardContent>
      </Card>

      {/* Col 2-3: Graphique + Tableau */}
      <div className="lg:col-span-2 space-y-4">
        {/* Graphique 24h */}
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
              <ResponsiveContainer width="100%" height={280}>
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

        {/* Tableau comparatif */}
        {comparisonData.length > 0 && (
          <Card className="bg-card/50 backdrop-blur border-violet-500/30">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium">
                Comparaison coefficients : Palier ({palierCoeff.toFixed(2)}) vs Continu ({continuCoeff.toFixed(4)})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ScrollArea className="h-[300px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Heure</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Profil base %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Palier %</th>
                      <th className="text-right py-1.5 px-2 text-violet-500 font-medium">Continu %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Δ %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">P net (kW)</th>
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
