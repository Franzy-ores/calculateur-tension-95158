import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNetworkStore } from '@/store/networkStore';
import { FlaskConical, MapPin, Sun, Cloud, AlertTriangle, TrendingUp, TrendingDown, Zap, Ruler, Users, Clock, Settings } from 'lucide-react';
import { ClockDial } from '@/components/ClockDial';
import { ProfileVisualEditor } from '@/components/ProfileVisualEditor';
import { clusterProfiles, getClusterById, DEFAULT_CLUSTER_ID } from '@/data/clusterProfiles';
import { getFoisonnementPalier, calculateNormalizedDiversity } from '@/utils/foisonnementCalculator';
import { DailyProfileCalculator } from '@/utils/dailyProfileCalculator';
import type { HourlyVoltageResult, DailySimulationOptions } from '@/types/dailyProfile';
import type { Node as NetworkNode, Cable, CalculationResult } from '@/types/network';
import circuitSimulationConfigData from '@/data/circuitSimulationConfig.json';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { branchementCableTypes, getBranchementCableById, calculateGeodeticDistance } from '@/data/branchementCableTypes';

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

  const leaves: string[] = [];
  for (const nodeId of visited) {
    if (!children.has(nodeId) || children.get(nodeId)!.length === 0) {
      leaves.push(nodeId);
    }
  }

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
  'hsl(217, 91%, 60%)',
  'hsl(142, 76%, 36%)',
  'hsl(25, 95%, 53%)',
  'hsl(330, 81%, 60%)',
  'hsl(48, 96%, 53%)',
  'hsl(270, 70%, 60%)',
  'hsl(190, 90%, 50%)',
];

// ─── Mapping cluster existant → circuit ────────────────────────────────────────
type CircuitCluster = 'A' | 'B' | 'C' | 'D';
const CLUSTER_MAP: Record<string, CircuitCluster> = {
  cluster_1: 'A',
  cluster_2: 'B',
  cluster_3: 'C',
  cluster_4: 'D',
};

export const LaboFoisonnementTab = () => {
  const {
    currentProject,
    dailyProfileOptions,
    setDailyProfileOptions,
    startNodeSelection,
    nodeSelectionMode,
    simulationEquipment,
    isSimulationActive,
    toggleSimulationActive,
    selectedBranchementCableId,
    setSelectedBranchementCableId,
    dailyProfileCustomProfiles,
    setDailyProfileCustomProfiles,
  } = useNetworkStore();

  const [editorOpen, setEditorOpen] = useState(false);

  const [season, setSeason] = useState<'winter' | 'summer'>('winter');
  const [weather, setWeather] = useState<'sunny' | 'gray'>('sunny');
  const [showPerPhaseDistance, setShowPerPhaseDistance] = useState(false);
  const [showNeutralCurrent, setShowNeutralCurrent] = useState(false);
  const [showClientPoints, setShowClientPoints] = useState(false);
  const [clockHour, setClockHour] = useState(12);

  // Simulation equipment counters
  const srg2Count = simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0;
  const compensatorCount = simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
  const hasCableReplacement = simulationEquipment.cableReplacement?.enabled;
  const totalEquipment = srg2Count + compensatorCount + (hasCableReplacement ? 1 : 0);
  const hasAnyEquipment = totalEquipment > 0 ||
    (simulationEquipment.srg2Devices?.length || 0) > 0 ||
    simulationEquipment.neutralCompensators.length > 0;

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

  // N global : tous les clients résidentiels du projet
  const nResidentialGlobal = useMemo(() => {
    if (!currentProject) return 0;
    return (currentProject.clientsImportes || []).filter(c => c.clientType !== 'industriel').length;
  }, [currentProject]);

  // nResidential for palier coeff display (linked to selected node)
  const nResidential = useMemo(() => {
    if (!currentProject || !selectedNodeId) return 0;
    const links = currentProject.clientLinks || [];
    const clients = currentProject.clientsImportes || [];
    const linkedClientIds = links.filter(l => l.nodeId === selectedNodeId).map(l => l.clientId);
    return clients.filter(c => linkedClientIds.includes(c.id) && c.clientType !== 'industriel').length;
  }, [currentProject, selectedNodeId]);

  // ─── Sliders manuels pour la formule continue ────────────────────────────────
  const diversityFactors = circuitSimulationConfigData.diversityFactors as unknown as Record<string, number>;
  const defaultA = diversityFactors[circuitCluster] ?? 0.13;
  const defaultN = nResidentialGlobal > 0 ? nResidentialGlobal : 1;

  const [customA, setCustomA] = useState<number>(defaultA);
  const [customN, setCustomN] = useState<number>(defaultN);
  const [isManualOverride, setIsManualOverride] = useState(false);

  useEffect(() => {
    if (!isManualOverride) {
      setCustomA(defaultA);
      setCustomN(defaultN);
    }
  }, [defaultA, defaultN, isManualOverride]);

  const handleResetFormula = useCallback(() => {
    setCustomA(defaultA);
    setCustomN(defaultN);
    setIsManualOverride(false);
  }, [defaultA, defaultN]);

  const continuCoeff = customN > 0 ? calculateNormalizedDiversity(customN, customA) : 0;
  const palierCoeff = nResidential > 0 ? getFoisonnementPalier(nResidential) : 0;

  // ─── 3 Runs DailyProfileCalculator ───────────────────────────────────────────
  const {
    voltageContinu,
    rawContinu,
    rawConsoPure,
    rawProdPure,
  } = useMemo(() => {
    const empty = {
      voltageContinu: [] as HourlyVoltageResult[],
      rawContinu: [] as CalculationResult[],
      rawConsoPure: [] as CalculationResult[],
      rawProdPure: [] as CalculationResult[],
    };
    if (!currentProject || !selectedNodeId || nResidentialGlobal === 0) return empty;

    const baseOptions: DailySimulationOptions = {
      season,
      weather,
      enableEV: dailyProfileOptions.enableEV ?? true,
      evBonusEvening: dailyProfileOptions.evBonusEvening ?? 2.5,
      evBonusNight: dailyProfileOptions.evBonusNight ?? 5,
      selectedNodeId,
      selectedClusterId,
      adaptiveFoisonnement: false,
      customDiversityCoeff: continuCoeff,
    };

    // Run 1: Complet (conso + prod) → puissance 24h + tension 24h
    const calcComplet = new DailyProfileCalculator(
      currentProject, baseOptions, dailyProfileCustomProfiles as any,
      simulationEquipment, isSimulationActive
    );
    const resComplet = calcComplet.calculateDailyVoltages();
    const rawC = calcComplet.getLastRawResults();

    // Run 2: Conso pure (zeroProduction) → Vmin distance
    const calcConso = new DailyProfileCalculator(
      currentProject,
      { ...baseOptions, zeroProduction: true },
      dailyProfileCustomProfiles as any, simulationEquipment, isSimulationActive
    );
    calcConso.calculateDailyVoltages();
    const rawConso = calcConso.getLastRawResults();

    // Run 3: Prod pure (zeroConsumption) → Vmax distance
    const calcProd = new DailyProfileCalculator(
      currentProject,
      { ...baseOptions, zeroConsumption: true },
      dailyProfileCustomProfiles as any, simulationEquipment, isSimulationActive
    );
    calcProd.calculateDailyVoltages();
    const rawProd = calcProd.getLastRawResults();

    return {
      voltageContinu: resComplet,
      rawContinu: rawC,
      rawConsoPure: rawConso,
      rawProdPure: rawProd,
    };
  }, [currentProject, selectedNodeId, season, weather, selectedClusterId, continuCoeff, dailyProfileOptions, simulationEquipment, isSimulationActive, nResidentialGlobal, profilesData]);

  // ─── Power chart data from engine results ────────────────────────────────────
  const powerData = useMemo(() => {
    if (voltageContinu.length === 0) return [];
    return voltageContinu.map((h) => {
      const pCharge = h.chargesResidentialPower_kVA + h.chargesIndustrialPower_kVA;
      const pPV = h.productionsPower_kVA;
      return {
        hour: h.hour,
        label: `${h.hour}h`,
        P_charge: +pCharge.toFixed(2),
        P_pv: +pPV.toFixed(2),
        P_net: +(pCharge - pPV).toFixed(2),
        foisonnement: h.chargesResidentialFoisonnement,
      };
    });
  }, [voltageContinu]);

  // ─── Voltage 24h chart data ──────────────────────────────────────────────────
  const voltage24hData = useMemo(() => {
    if (voltageContinu.length === 0) return [];
    return voltageContinu.map((h) => ({
      hour: h.hour,
      label: `${h.hour}h`,
      V_A: +h.voltageA_V.toFixed(2),
      V_B: +h.voltageB_V.toFixed(2),
      V_C: +h.voltageC_V.toFixed(2),
      V_continu: +h.voltageAvg_V.toFixed(2),
      foisonnement: +h.chargesResidentialFoisonnement.toFixed(2),
    }));
  }, [voltageContinu]);

  // ─── Voltage-Distance data ─────────────────────────────────────────────────────
  const networkPaths = useMemo(() => {
    if (!currentProject) return [];
    return buildNetworkPaths(currentProject.nodes, currentProject.cables);
  }, [currentProject]);

  const getNodeVoltage = (results: CalculationResult[], nodeId: string, hour: number): number => {
    const r = results[hour];
    if (!r?.nodeMetricsPerPhase) return 0;
    const nm = r.nodeMetricsPerPhase.find(m => m.nodeId === nodeId);
    if (!nm) return 0;
    return (nm.voltagesPerPhase.A + nm.voltagesPerPhase.B + nm.voltagesPerPhase.C) / 3;
  };

  const getNodeVoltagePerPhase = (results: CalculationResult[], nodeId: string, hour: number): { A: number; B: number; C: number; avg: number } => {
    const r = results[hour];
    if (!r?.nodeMetricsPerPhase) return { A: 0, B: 0, C: 0, avg: 0 };
    const nm = r.nodeMetricsPerPhase.find(m => m.nodeId === nodeId);
    if (!nm) return { A: 0, B: 0, C: 0, avg: 0 };
    const { A, B, C } = nm.voltagesPerPhase;
    return { A, B, C, avg: (A + B + C) / 3 };
  };

  const voltageDistanceData = useMemo(() => {
    if (networkPaths.length === 0 || rawConsoPure.length === 0 || rawProdPure.length === 0) return null;

    const allNodeIds = new Set<string>();
    networkPaths.forEach(b => b.points.forEach(p => allNodeIds.add(p.nodeId)));

    // Heure pire cas charge = pic foisonnement résidentiel (indépendant de la topologie)
    const peakConsoIndex = powerData.length > 0
      ? powerData.reduce((maxIdx, d, idx) => d.foisonnement > powerData[maxIdx].foisonnement ? idx : maxIdx, 0)
      : 0;
    const globalMinHour = powerData[peakConsoIndex]?.hour ?? 0;

    // Tension mini à cette heure (badge affichage uniquement)
    let globalMinV = Infinity;
    for (const nodeId of allNodeIds) {
      const v = getNodeVoltage(rawConsoPure, nodeId, globalMinHour);
      if (v > 0 && v < globalMinV) globalMinV = v;
    }
    if (!isFinite(globalMinV)) globalMinV = 220;

    // Heure pire cas injection = pic production PV
    const peakProdIndex = powerData.length > 0
      ? powerData.reduce((maxIdx, d, idx) => d.P_pv > powerData[maxIdx].P_pv ? idx : maxIdx, 0)
      : 0;
    const globalMaxHour = powerData[peakProdIndex]?.hour ?? 12;

    // Tension maxi à cette heure (badge affichage uniquement)
    let globalMaxV = -Infinity;
    for (const nodeId of allNodeIds) {
      const v = getNodeVoltage(rawProdPure, nodeId, globalMaxHour);
      if (v > 0 && v > globalMaxV) globalMaxV = v;
    }
    if (!isFinite(globalMaxV) || globalMaxV > 350) globalMaxV = 240;

    const getCableNeutralCurrent = (results: CalculationResult[], hour: number, nodeA: string, nodeB: string): number => {
      const r = results[hour];
      if (!r?.cables) return 0;
      const cable = r.cables.find(c =>
        (c.nodeAId === nodeA && c.nodeBId === nodeB) ||
        (c.nodeAId === nodeB && c.nodeBId === nodeA)
      );
      return cable?.currentsPerPhase_A?.N ?? 0;
    };

    const buildBranchData = (rawResults: CalculationResult[], hour: number) => {
      return networkPaths.map((branch, idx) => ({
        ...branch,
        points: branch.points.map((p, pi) => {
          const perPhase = getNodeVoltagePerPhase(rawResults, p.nodeId, hour);
          const I_neutral = pi > 0
            ? getCableNeutralCurrent(rawResults, hour, branch.points[pi - 1].nodeId, p.nodeId)
            : 0;
          return {
            ...p,
            voltage: perPhase.avg,
            voltage_A: perPhase.A,
            voltage_B: perPhase.B,
            voltage_C: perPhase.C,
            I_neutral: +I_neutral.toFixed(2),
          };
        }),
        color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
      }));
    };

    return {
      minHour: globalMinHour,
      maxHour: globalMaxHour,
      minV: globalMinV,
      maxV: globalMaxV,
      minBranches: buildBranchData(rawConsoPure, globalMinHour),
      maxBranches: buildBranchData(rawProdPure, globalMaxHour),
    };
  }, [networkPaths, rawConsoPure, rawProdPure, powerData]);

  // ─── Client raccordement points for voltage-distance charts ──────────────────
  const effectiveBranchementCableId = selectedBranchementCableId || 'exvb-4x16-cu';
  const branchementCable = useMemo(
    () => getBranchementCableById(effectiveBranchementCableId) || branchementCableTypes[0],
    [effectiveBranchementCableId]
  );

  interface ClientPoint {
    distance_m: number;
    voltage: number;
    clientName: string;
    power_kVA: number;
    couplage: string;
    nodeDistance_m: number;
    branchLength_m: number;
    nodeVoltage: number;
    isClient: true;
    phase?: string;
  }

  const clientPointsData = useMemo(() => {
    if (!voltageDistanceData || !currentProject || !branchementCable) return null;

    const clients = currentProject.clientsImportes || [];
    const links = currentProject.clientLinks || [];
    if (clients.length === 0 || links.length === 0) return null;

    const nodeMap = new Map(currentProject.nodes.map(n => [n.id, n]));
    const clientMap = new Map(clients.map(c => [c.id, c]));
    const cosPhiCharges = currentProject.cosPhiCharges || 0.95;
    const sinPhiCharges = Math.sqrt(1 - cosPhiCharges * cosPhiCharges);
    const cosPhiProd = currentProject.cosPhiProductions || 1.0;
    const sinPhiProd = Math.sqrt(1 - cosPhiProd * cosPhiProd);
    const R_per_m = branchementCable.R_ohm_per_km / 1000;
    const X_per_m = branchementCable.X_ohm_per_km / 1000;

    // Résoudre la tension nodale selon la phase du client MONO
    const getNodeVoltageForClient = (bp: any, client: any, mode: 'charge' | 'injection'): number => {
      if (client.couplage === 'TRI' || client.couplage === 'TETRA') {
        return bp.voltage; // moyenne pour polyphasé
      }
      const coupling = client.phaseCoupling || client.assignedPhase;
      if (!coupling || !bp.voltage_A) return bp.voltage; // pas de données par phase

      const voltageSystem = currentProject!.voltageSystem;
      if (voltageSystem === 'TRIPHASÉ_230V') {
        // Triangle : tension entre deux phases, prendre le pire cas
        const phaseMap: Record<string, [number, number]> = {
          'A-B': [bp.voltage_A, bp.voltage_B],
          'B-C': [bp.voltage_B, bp.voltage_C],
          'A-C': [bp.voltage_A, bp.voltage_C],
        };
        const pair = phaseMap[coupling];
        if (pair) return mode === 'charge' ? Math.min(...pair) : Math.max(...pair);
      }
      // 400V étoile : phase simple
      const singleMap: Record<string, number> = { A: bp.voltage_A, B: bp.voltage_B, C: bp.voltage_C };
      return singleMap[coupling] || bp.voltage;
    };

    const getPhaseLabel = (client: any): string | undefined => {
      if (client.couplage === 'TRI' || client.couplage === 'TETRA') return undefined;
      const coupling = client.phaseCoupling || client.assignedPhase;
      if (!coupling) return undefined;
      const voltageSystem = currentProject!.voltageSystem;
      if (voltageSystem === 'TRIPHASÉ_230V') {
        const labelMap: Record<string, string> = { 'A-B': 'L1-L2', 'B-C': 'L2-L3', 'A-C': 'L3-L1' };
        return labelMap[coupling] || coupling;
      }
      const labelMap: Record<string, string> = { A: 'L1', B: 'L2', C: 'L3' };
      return labelMap[coupling] || coupling;
    };

    const buildClientPoints = (branches: typeof voltageDistanceData.minBranches, mode: 'charge' | 'injection'): ClientPoint[] => {
      const points: ClientPoint[] = [];
      for (const branch of branches) {
        for (const bp of branch.points) {
          const node = nodeMap.get(bp.nodeId);
          if (!node) continue;
          const nodeLinks = links.filter(l => l.nodeId === bp.nodeId);
          for (const link of nodeLinks) {
            const client = clientMap.get(link.clientId);
            if (!client) continue;
            const dist_m = (client.lat && client.lng && node.lat && node.lng)
              ? calculateGeodeticDistance(node.lat, node.lng, client.lat, client.lng)
              : 15;
            const V_nom = client.couplage === 'MONO' ? 230 : 400;
            const nodeV = getNodeVoltageForClient(bp, client, mode) || 230;
            let clientV: number;

            if (mode === 'injection') {
              // Injection PV : pas de conso, production à 100%
              const pvKVA = client.puissancePV_kVA || 0;
              if (pvKVA > 0) {
                const I_pv = (pvKVA * 1000) / (V_nom * (client.couplage === 'MONO' ? 1 : Math.sqrt(3)));
                const deltaV_pv = (R_per_m * cosPhiProd + X_per_m * sinPhiProd) * I_pv * dist_m;
                clientV = nodeV + deltaV_pv;
              } else {
                clientV = nodeV;
              }
            } else {
              // Charge : conso à 80% du contractuel, pas de PV
              const I_charge = (client.puissanceContractuelle_kVA * 0.80 * 1000) / (V_nom * (client.couplage === 'MONO' ? 1 : Math.sqrt(3)));
              const deltaV = (R_per_m * cosPhiCharges + X_per_m * sinPhiCharges) * I_charge * dist_m;
              clientV = Math.max(0, nodeV - deltaV);
            }

            points.push({
              distance_m: +(bp.distance_m + dist_m).toFixed(1),
              voltage: +clientV.toFixed(1),
              clientName: client.nomCircuit || client.identifiantCircuit || client.id.slice(0, 8),
              power_kVA: mode === 'injection' ? (client.puissancePV_kVA || 0) : client.puissanceContractuelle_kVA,
              couplage: client.couplage,
              nodeDistance_m: bp.distance_m,
              branchLength_m: +dist_m.toFixed(1),
              nodeVoltage: +nodeV.toFixed(1),
              isClient: true,
              phase: getPhaseLabel(client),
            });
          }
        }
      }
      return points;
    };

    return {
      minClientPoints: buildClientPoints(voltageDistanceData.minBranches, 'charge'),
      maxClientPoints: buildClientPoints(voltageDistanceData.maxBranches, 'injection'),
    };
  }, [voltageDistanceData, currentProject, branchementCable]);

  const getClientColor = (voltage: number, mode: 'charge' | 'injection' = 'charge') => {
    if (mode === 'injection') {
      // Surtension EN50160
      if (voltage > 253) return 'hsl(0, 75%, 55%)';
      if (voltage > 241.5) return 'hsl(35, 95%, 55%)';
      return 'hsl(142, 76%, 36%)';
    }
    // Sous-tension EN50160
    if (voltage < 207) return 'hsl(0, 75%, 55%)';
    if (voltage < 218.5) return 'hsl(35, 95%, 55%)';
    return 'hsl(142, 76%, 36%)';
  };


  const voltageRange = useMemo(() => {
    if (voltage24hData.length === 0) return { min: 200, max: 250 };
    const allV = voltage24hData.flatMap(d => [d.V_A, d.V_B, d.V_C, d.V_continu]).filter(v => v > 0);
    if (allV.length === 0) return { min: 200, max: 250 };
    return { min: Math.floor(Math.min(...allV) - 3), max: Math.ceil(Math.max(...allV) + 3) };
  }, [voltage24hData]);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const clusterInfo = getClusterById(selectedClusterId);

  // Peak summary from power data
  const peakSummary = useMemo(() => {
    if (powerData.length === 0) return null;
    const peakLoad = Math.max(...powerData.map(d => d.P_charge));
    const peakInjection = Math.min(...powerData.map(d => d.P_net));
    return { peakLoad, peakInjection };
  }, [powerData]);

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

          {/* Mode simulation */}
          {hasAnyEquipment && (
            <div className="space-y-2 border-t border-border/50 pt-3">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <FlaskConical className="h-3 w-3" /> Mode simulation
              </Label>
              <div className="flex items-center justify-between">
                <span className="text-xs">Activer</span>
                <Switch
                  checked={isSimulationActive}
                  onCheckedChange={toggleSimulationActive}
                  disabled={!hasAnyEquipment}
                  className="data-[state=checked]:bg-success"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={isSimulationActive ? 'success' : 'outline'}
                  className="text-[10px]"
                >
                  {isSimulationActive ? '✓ Active' : '✗ Inactive'}
                </Badge>
                {totalEquipment > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {totalEquipment} éq.
                  </Badge>
                )}
              </div>
            </div>
          )}

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
                    → {CLUSTER_MAP[cp.id]} (a={diversityFactors[CLUSTER_MAP[cp.id]]})
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {/* Formule continue — sliders manuels */}
          <div className="bg-muted/50 rounded-md p-3 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="font-medium text-foreground">Formule continue</div>
              {isManualOverride && (
                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={handleResetFormula}>
                  Reset
                </Button>
              )}
            </div>
            <div className="font-mono text-muted-foreground">
              K(N) = [a + (1−a)/√N] / F<sub>ref</sub>
            </div>

            {/* Slider a */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <Label className="text-[10px] text-muted-foreground">Coeff. a</Label>
                <span className="font-mono text-[10px] text-foreground">{customA.toFixed(2)}</span>
              </div>
              <Slider
                min={0.05} max={0.50} step={0.01}
                value={[customA]}
                onValueChange={([v]) => { setCustomA(v); setIsManualOverride(true); }}
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>0.05</span>
                <span className="text-muted-foreground/60">défaut: {defaultA}</span>
                <span>0.50</span>
              </div>
            </div>

            {/* Slider N */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <Label className="text-[10px] text-muted-foreground">N clients résid.</Label>
                <span className="font-mono text-[10px] text-foreground">{customN}</span>
              </div>
              <Slider
                min={1} max={200} step={1}
                value={[customN]}
                onValueChange={([v]) => { setCustomN(v); setIsManualOverride(true); }}
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>1</span>
                <span className="text-muted-foreground/60">réseau: {nResidentialGlobal}</span>
                <span>200</span>
              </div>
            </div>

            {/* Résultat */}
            <div className="border-t border-border pt-2 space-y-1">
              <div className="flex justify-between">
                <span className="text-violet-500 font-medium">Continu: {continuCoeff.toFixed(4)}</span>
                <span className="text-muted-foreground">Palier: {palierCoeff.toFixed(2)}</span>
              </div>
              {palierCoeff > 0 && (
                <div className={`font-medium ${continuCoeff > palierCoeff ? 'text-orange-500' : 'text-emerald-500'}`}>
                  Δ = {((continuCoeff - palierCoeff) / palierCoeff * 100).toFixed(0)}%
                </div>
              )}
              {isManualOverride && (
                <Badge variant="outline" className="text-[9px] border-orange-500/50 text-orange-500">Manuel</Badge>
              )}
            </div>
          </div>

          {/* Summary puissances */}
          {peakSummary && (
            <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-xs">
              <div className="font-medium text-foreground">Synthèse puissances</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Pic charge</span>
                <span className="font-mono">{peakSummary.peakLoad.toFixed(1)} kVA</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Pic net min</span>
                <span className="font-mono">{peakSummary.peakInjection.toFixed(1)} kVA</span>
              </div>
            </div>
          )}

          {/* Voltage summary */}
          {voltage24hData.length > 0 && voltage24hData.some(d => d.V_continu > 0) && (
            <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-xs">
              <div className="font-medium text-foreground flex items-center gap-1">
                <Zap className="h-3 w-3 text-violet-500" /> Synthèse tensions
              </div>
              {(() => {
                const allPhaseV = voltage24hData.flatMap(d => [d.V_A, d.V_B, d.V_C]).filter(v => v > 0);
                const minV = allPhaseV.length > 0 ? Math.min(...allPhaseV) : 0;
                const maxV = allPhaseV.length > 0 ? Math.max(...allPhaseV) : 0;
                const vA = voltage24hData.map(d => d.V_A).filter(v => v > 0);
                const vB = voltage24hData.map(d => d.V_B).filter(v => v > 0);
                const vC = voltage24hData.map(d => d.V_C).filter(v => v > 0);
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-violet-500">V min (3φ)</span>
                      <span className={`font-mono ${minV < 207 ? 'text-destructive' : minV < 218.5 ? 'text-orange-500' : ''}`}>{minV.toFixed(1)} V</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-violet-500">V max (3φ)</span>
                      <span className="font-mono">{maxV.toFixed(1)} V</span>
                    </div>
                    <div className="border-t border-border/30 pt-1 mt-1 space-y-0.5">
                      <div className="flex justify-between"><span style={{ color: 'hsl(0, 75%, 55%)' }}>A</span><span className="font-mono">{vA.length > 0 ? Math.min(...vA).toFixed(1) : '—'} … {vA.length > 0 ? Math.max(...vA).toFixed(1) : '—'} V</span></div>
                      <div className="flex justify-between"><span style={{ color: 'hsl(142, 76%, 36%)' }}>B</span><span className="font-mono">{vB.length > 0 ? Math.min(...vB).toFixed(1) : '—'} … {vB.length > 0 ? Math.max(...vB).toFixed(1) : '—'} V</span></div>
                      <div className="flex justify-between"><span style={{ color: 'hsl(217, 91%, 60%)' }}>C</span><span className="font-mono">{vC.length > 0 ? Math.min(...vC).toFixed(1) : '—'} … {vC.length > 0 ? Math.max(...vC).toFixed(1) : '—'} V</span></div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Col 2-3: Graphiques */}
      <div className="lg:col-span-2 space-y-4">
        {/* Graphique Puissances 24h */}
        {powerData.length > 0 ? (
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
                <LineChart data={powerData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit=" kVA" />
                  <Tooltip
                    contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    formatter={(value: number, name: string) => [`${value.toFixed(2)} kVA`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="P_charge" name="P charge (rés.+ind.)" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} />
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
                'Aucun client lié au réseau. Importez des clients et liez-les aux nœuds.'}
            </CardContent>
          </Card>
        )}

        {/* Graphique Tensions 24h */}
        {voltage24hData.length > 0 && voltage24hData.some(d => d.V_continu > 0) && (
          <Card className="bg-card/50 backdrop-blur border-violet-500/30">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-violet-500" />
                Tension nodale 24h — Continu f(N) = {continuCoeff.toFixed(4)}
                <Badge variant="outline" className="text-[10px] border-violet-500/50 text-violet-500">
                  coeff={continuCoeff.toFixed(4)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={voltage24hData}>
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
                  <ReferenceArea y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.3} />
                  <ReferenceLine y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: '-10%', fontSize: 9, fill: 'hsl(var(--destructive))' }} />
                  <ReferenceLine y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: '+10%', fontSize: 9, fill: 'hsl(var(--destructive))' }} />
                  <ReferenceLine y={218.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={241.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} label={{ value: '230V', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                  <Line type="monotone" dataKey="V_A" name="Phase A" stroke="hsl(0, 75%, 55%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="V_B" name="Phase B" stroke="hsl(142, 76%, 36%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="V_C" name="Phase C" stroke="hsl(217, 91%, 60%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="V_continu" name="V moyen" stroke="hsl(270, 70%, 60%)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ─── Graphiques Tension vs Distance ─────────────────────────────── */}
        {voltageDistanceData && voltageDistanceData.minBranches.length > 0 && (
          <>
            {/* Toggle per-phase display */}
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                id="showPerPhaseDistance"
                checked={showPerPhaseDistance}
                onCheckedChange={(checked) => setShowPerPhaseDistance(checked === true)}
              />
              <Label htmlFor="showPerPhaseDistance" className="text-xs text-muted-foreground cursor-pointer">
                Afficher tensions par phase (A, B, C) en pointillés
              </Label>
            </div>
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                id="showNeutralCurrent"
                checked={showNeutralCurrent}
                onCheckedChange={(checked) => setShowNeutralCurrent(checked === true)}
              />
              <Label htmlFor="showNeutralCurrent" className="text-xs text-muted-foreground cursor-pointer">
                Afficher courant de neutre I<sub>N</sub> (axe droit, A)
              </Label>
            </div>
            {clientPointsData && (
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  id="showClientPoints"
                  checked={showClientPoints}
                  onCheckedChange={(checked) => setShowClientPoints(checked === true)}
                />
                <Label htmlFor="showClientPoints" className="text-xs text-muted-foreground cursor-pointer">
                  <Users className="h-3 w-3 inline mr-1" />
                  Afficher raccordements clients (plein écran)
                </Label>
              </div>
            )}


            <Card className="bg-card/50 backdrop-blur border-violet-500/30">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Ruler className="h-4 w-4 text-blue-500" />
                  Tension vs Distance — Pire cas charge (sans production)
                  <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-500">
                    {voltageDistanceData.minHour}h • {voltageDistanceData.minV.toFixed(1)}V
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }}
                      label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                    <YAxis yAxisId="left"
                      domain={[Math.floor(Math.min(200, voltageDistanceData.minV - 5)), Math.ceil(Math.max(240, voltageDistanceData.minV + 10))]}
                      tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                    {showNeutralCurrent && (
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit=" A"
                        label={{ value: 'I neutre (A)', angle: 90, position: 'insideRight', offset: 10, fontSize: 10 }} />
                    )}
                    <Tooltip
                      contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0]?.payload;
                        return (
                          <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                            <div className="font-medium mb-1">{point?.nodeName || '—'}</div>
                            <div className="text-muted-foreground">{point?.distance_m?.toFixed(1)} m</div>
                            {point?.voltage_A > 0 && (
                              <div className="space-y-0.5 mt-1">
                                <div className="flex gap-2"><span style={{ color: 'hsl(0, 75%, 55%)' }}>A:</span><span className="font-mono">{point.voltage_A.toFixed(1)} V</span></div>
                                <div className="flex gap-2"><span style={{ color: 'hsl(142, 76%, 36%)' }}>B:</span><span className="font-mono">{point.voltage_B.toFixed(1)} V</span></div>
                                <div className="flex gap-2"><span style={{ color: 'hsl(217, 91%, 60%)' }}>C:</span><span className="font-mono">{point.voltage_C.toFixed(1)} V</span></div>
                                <div className="flex gap-2 border-t border-border/30 pt-0.5"><span className="text-muted-foreground">Moy:</span><span className="font-mono font-medium">{point.voltage.toFixed(1)} V</span></div>
                              </div>
                            )}
                            {showNeutralCurrent && point?.I_neutral > 0 && (
                              <div className="flex gap-2 border-t border-border/30 pt-0.5 mt-0.5">
                                <span style={{ color: 'hsl(35, 95%, 55%)' }}>I<sub>N</sub>:</span>
                                <span className="font-mono font-medium">{point.I_neutral.toFixed(1)} A</span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceArea yAxisId="left" y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.2} />
                    <ReferenceLine yAxisId="left" y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                    <ReferenceLine yAxisId="left" y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                    <ReferenceLine yAxisId="left" y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} />
                    {voltageDistanceData.minBranches.map((branch) => (
                      <Line key={`min-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage > 0)}
                        type="monotone" dataKey="voltage" name={branch.label}
                        stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    ))}
                    {showPerPhaseDistance && voltageDistanceData.minBranches.map((branch) => (
                      <>
                        <Line key={`min-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)}
                          type="monotone" dataKey="voltage_A" name={`${branch.label} A`}
                          stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                        <Line key={`min-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)}
                          type="monotone" dataKey="voltage_B" name={`${branch.label} B`}
                          stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                        <Line key={`min-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)}
                          type="monotone" dataKey="voltage_C" name={`${branch.label} C`}
                          stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                      </>
                    ))}
                    {showNeutralCurrent && voltageDistanceData.minBranches.map((branch) => (
                      <Line key={`min-IN-${branch.branchId}`} yAxisId="right" data={branch.points}
                        type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`}
                        stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Vmax — Pire cas injection (sans consommation) */}
            <Card className="bg-card/50 backdrop-blur border-violet-500/30">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Ruler className="h-4 w-4 text-emerald-500" />
                  Tension vs Distance — Pire cas injection (sans consommation)
                  <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-500">
                    {voltageDistanceData.maxHour}h • {voltageDistanceData.maxV.toFixed(1)}V
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }}
                      label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                    <YAxis yAxisId="left"
                      domain={[Math.floor(Math.min(225, voltageDistanceData.maxV - 5)), Math.ceil(Math.max(245, voltageDistanceData.maxV + 5))]}
                      tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                    {showNeutralCurrent && (
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit=" A"
                        label={{ value: 'I neutre (A)', angle: 90, position: 'insideRight', offset: 10, fontSize: 10 }} />
                    )}
                    <Tooltip
                      contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0]?.payload;
                        return (
                          <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                            <div className="font-medium mb-1">{point?.nodeName || '—'}</div>
                            <div className="text-muted-foreground">{point?.distance_m?.toFixed(1)} m</div>
                            {point?.voltage_A > 0 && (
                              <div className="space-y-0.5 mt-1">
                                <div className="flex gap-2"><span style={{ color: 'hsl(0, 75%, 55%)' }}>A:</span><span className="font-mono">{point.voltage_A.toFixed(1)} V</span></div>
                                <div className="flex gap-2"><span style={{ color: 'hsl(142, 76%, 36%)' }}>B:</span><span className="font-mono">{point.voltage_B.toFixed(1)} V</span></div>
                                <div className="flex gap-2"><span style={{ color: 'hsl(217, 91%, 60%)' }}>C:</span><span className="font-mono">{point.voltage_C.toFixed(1)} V</span></div>
                                <div className="flex gap-2 border-t border-border/30 pt-0.5"><span className="text-muted-foreground">Moy:</span><span className="font-mono font-medium">{point.voltage.toFixed(1)} V</span></div>
                              </div>
                            )}
                            {showNeutralCurrent && point?.I_neutral > 0 && (
                              <div className="flex gap-2 border-t border-border/30 pt-0.5 mt-0.5">
                                <span style={{ color: 'hsl(35, 95%, 55%)' }}>I<sub>N</sub>:</span>
                                <span className="font-mono font-medium">{point.I_neutral.toFixed(1)} A</span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceArea yAxisId="left" y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.2} />
                    <ReferenceLine yAxisId="left" y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                    <ReferenceLine yAxisId="left" y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                    <ReferenceLine yAxisId="left" y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} />
                    {voltageDistanceData.maxBranches.map((branch) => (
                      <Line key={`max-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage > 0)}
                        type="monotone" dataKey="voltage" name={branch.label}
                        stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    ))}
                    {showPerPhaseDistance && voltageDistanceData.maxBranches.map((branch) => (
                      <>
                        <Line key={`max-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)}
                          type="monotone" dataKey="voltage_A" name={`${branch.label} A`}
                          stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                        <Line key={`max-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)}
                          type="monotone" dataKey="voltage_B" name={`${branch.label} B`}
                          stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                        <Line key={`max-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)}
                          type="monotone" dataKey="voltage_C" name={`${branch.label} C`}
                          stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                      </>
                    ))}
                    {showNeutralCurrent && voltageDistanceData.maxBranches.map((branch) => (
                      <Line key={`max-IN-${branch.branchId}`} yAxisId="right" data={branch.points}
                        type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`}
                        stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* ─── Graphe Tension vs Distance — Profil horaire ────────────── */}
            {rawContinu.length > 0 && networkPaths.length > 0 && (() => {
              // Build branch data for the selected clock hour using rawContinu (combined conso+prod)
              const getCableNeutralCurrentHourly = (results: CalculationResult[], hour: number, nodeA: string, nodeB: string): number => {
                const r = results[hour];
                if (!r?.cables) return 0;
                const cable = r.cables.find(c =>
                  (c.nodeAId === nodeA && c.nodeBId === nodeB) ||
                  (c.nodeAId === nodeB && c.nodeBId === nodeA)
                );
                return cable?.currentsPerPhase_A?.N ?? 0;
              };

              const hourlyBranches = networkPaths.map((branch, idx) => ({
                ...branch,
                points: branch.points.map((p, pi) => {
                  const perPhase = getNodeVoltagePerPhase(rawContinu, p.nodeId, clockHour);
                  const I_neutral = pi > 0
                    ? getCableNeutralCurrentHourly(rawContinu, clockHour, branch.points[pi - 1].nodeId, p.nodeId)
                    : 0;
                  return {
                    ...p,
                    voltage: perPhase.avg,
                    voltage_A: perPhase.A,
                    voltage_B: perPhase.B,
                    voltage_C: perPhase.C,
                    I_neutral: +I_neutral.toFixed(2),
                  };
                }),
                color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
              }));

              // Dynamic Y domain
              const allVoltages = hourlyBranches.flatMap(b => b.points.flatMap(p => [p.voltage, p.voltage_A, p.voltage_B, p.voltage_C])).filter(v => v > 0);
              const minV = allVoltages.length > 0 ? Math.min(...allVoltages) : 220;
              const maxV = allVoltages.length > 0 ? Math.max(...allVoltages) : 240;

              // Get foisonnement coefficient at this hour
              const hourFois = voltageContinu[clockHour]?.chargesResidentialFoisonnement;

              return (
                <Card className="bg-card/50 backdrop-blur border-amber-500/30">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-500" />
                      Tension vs Distance — Profil horaire (continu)
                      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500">
                        {clockHour}h
                      </Badge>
                      {hourFois !== undefined && (
                        <Badge variant="secondary" className="text-[10px]">
                          fois. {hourFois.toFixed(1)}%
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 flex flex-col items-center pt-4">
                        <ClockDial hour={clockHour} onChange={setClockHour} size={130} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }}
                              label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                            <YAxis yAxisId="left"
                              domain={[Math.floor(Math.min(200, minV - 5)), Math.ceil(Math.max(250, maxV + 5))]}
                              tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                            {showNeutralCurrent && (
                              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit=" A"
                                label={{ value: 'I neutre (A)', angle: 90, position: 'insideRight', offset: 10, fontSize: 10 }} />
                            )}
                            <Tooltip
                              contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const point = payload[0]?.payload;
                                return (
                                  <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                                    <div className="font-medium mb-1">{point?.nodeName || '—'}</div>
                                    <div className="text-muted-foreground">{point?.distance_m?.toFixed(1)} m</div>
                                    {point?.voltage_A > 0 && (
                                      <div className="space-y-0.5 mt-1">
                                        <div className="flex gap-2"><span style={{ color: 'hsl(0, 75%, 55%)' }}>A:</span><span className="font-mono">{point.voltage_A.toFixed(1)} V</span></div>
                                        <div className="flex gap-2"><span style={{ color: 'hsl(142, 76%, 36%)' }}>B:</span><span className="font-mono">{point.voltage_B.toFixed(1)} V</span></div>
                                        <div className="flex gap-2"><span style={{ color: 'hsl(217, 91%, 60%)' }}>C:</span><span className="font-mono">{point.voltage_C.toFixed(1)} V</span></div>
                                        <div className="flex gap-2 border-t border-border/30 pt-0.5"><span className="text-muted-foreground">Moy:</span><span className="font-mono font-medium">{point.voltage.toFixed(1)} V</span></div>
                                      </div>
                                    )}
                                    {showNeutralCurrent && point?.I_neutral > 0 && (
                                      <div className="flex gap-2 border-t border-border/30 pt-0.5 mt-0.5">
                                        <span style={{ color: 'hsl(35, 95%, 55%)' }}>I<sub>N</sub>:</span>
                                        <span className="font-mono font-medium">{point.I_neutral.toFixed(1)} A</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <ReferenceArea yAxisId="left" y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.2} />
                            <ReferenceLine yAxisId="left" y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                            <ReferenceLine yAxisId="left" y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                            <ReferenceLine yAxisId="left" y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} />
                            {hourlyBranches.map((branch) => (
                              <Line key={`hourly-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage > 0)}
                                type="monotone" dataKey="voltage" name={branch.label}
                                stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                            ))}
                            {showPerPhaseDistance && hourlyBranches.map((branch) => (
                              <>
                                <Line key={`hourly-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)}
                                  type="monotone" dataKey="voltage_A" name={`${branch.label} A`}
                                  stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                                <Line key={`hourly-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)}
                                  type="monotone" dataKey="voltage_B" name={`${branch.label} B`}
                                  stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                                <Line key={`hourly-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)}
                                  type="monotone" dataKey="voltage_C" name={`${branch.label} C`}
                                  stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />
                              </>
                            ))}
                            {showNeutralCurrent && hourlyBranches.map((branch) => (
                              <Line key={`hourly-IN-${branch.branchId}`} yAxisId="right" data={branch.points}
                                type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`}
                                stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* ─── Dialog plein écran : raccordements clients ─────────────── */}
            <Dialog open={showClientPoints} onOpenChange={setShowClientPoints}>
              <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full overflow-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-violet-500" />
                    Tension vs Distance — Raccordements clients
                    <Badge variant="outline" className="text-[10px]">
                      {branchementCable?.label}
                    </Badge>
                  </DialogTitle>
                </DialogHeader>

                {/* Sélecteur câble branchement */}
                <div className="flex items-center gap-3 mb-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Câble branchement :</Label>
                  <Select value={effectiveBranchementCableId} onValueChange={(v) => setSelectedBranchementCableId(v)}>
                    <SelectTrigger className="h-8 text-xs w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {branchementCableTypes.map(c => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.label} — R={c.R_ohm_per_km} Ω/km, {c.maxCurrent_A}A
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(142, 76%, 36%)' }} /> OK</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(35, 95%, 55%)' }} /> &lt;218.5V</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(0, 75%, 55%)' }} /> &lt;207V</span>
                  </div>
                </div>

                {/* Graphique Vmin charge + clients */}
                <div className="space-y-1">
                  <div className="text-xs font-medium flex items-center gap-2">
                    <Ruler className="h-3.5 w-3.5 text-blue-500" />
                    Pire cas charge — {voltageDistanceData?.minHour}h
                  </div>
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }}
                        label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                      <YAxis yAxisId="left"
                        domain={[
                          Math.floor(Math.min(200, (voltageDistanceData?.minV ?? 220) - 5)),
                          Math.ceil(Math.max(240, (voltageDistanceData?.minV ?? 230) + 10))
                        ]}
                        tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                      <Tooltip
                        contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const point = payload[0]?.payload;
                          if (point?.isClient) {
                            return (
                              <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                                <div className="font-medium mb-1">🏠 {point.clientName}</div>
                                <div className="text-muted-foreground">{point.couplage} — {point.power_kVA} kVA{point.phase ? ` — ${point.phase}` : ''}</div>
                                <div className="mt-1 space-y-0.5">
                                  <div className="flex gap-2"><span className="text-muted-foreground">Nœud:</span><span className="font-mono">{point.nodeVoltage} V @ {point.nodeDistance_m} m</span></div>
                                  <div className="flex gap-2"><span className="text-muted-foreground">Brcht:</span><span className="font-mono">{point.branchLength_m} m</span></div>
                                  <div className="flex gap-2 border-t border-border/30 pt-0.5 font-medium" style={{ color: getClientColor(point.voltage) }}>
                                    <span>Livraison:</span><span className="font-mono">{point.voltage} V</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                              <div className="font-medium mb-1">{point?.nodeName || '—'}</div>
                              <div className="text-muted-foreground">{point?.distance_m?.toFixed(1)} m — {point?.voltage?.toFixed(1)} V</div>
                            </div>
                          );
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceArea yAxisId="left" y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.2} />
                      <ReferenceLine yAxisId="left" y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                      <ReferenceLine yAxisId="left" y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                      <ReferenceLine yAxisId="left" y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} />
                      {voltageDistanceData?.minBranches.map((branch) => (
                        <Line key={`fs-min-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage > 0)}
                          type="monotone" dataKey="voltage" name={branch.label}
                          stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      ))}
                      {/* Client points — dots only */}
                      {clientPointsData?.minClientPoints && clientPointsData.minClientPoints.length > 0 && (
                        <Line
                          key="fs-min-clients"
                          yAxisId="left"
                          data={clientPointsData.minClientPoints}
                          type="monotone"
                          dataKey="voltage"
                          name="Clients"
                          stroke="none"
                          strokeWidth={0}
                          dot={(props: any) => {
                            const { cx, cy, payload } = props;
                            if (!cx || !cy) return null;
                            return (
                              <circle
                                cx={cx} cy={cy} r={5}
                                fill={getClientColor(payload.voltage)}
                                stroke="hsl(var(--background))"
                                strokeWidth={1.5}
                              />
                            );
                          }}
                          legendType="diamond"
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Graphique Vmax injection + clients */}
                <div className="space-y-1 mt-4">
                  <div className="text-xs font-medium flex items-center gap-2">
                    <Ruler className="h-3.5 w-3.5 text-emerald-500" />
                    Pire cas injection — {voltageDistanceData?.maxHour}h
                  </div>
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }}
                        label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                      <YAxis yAxisId="left"
                        domain={[
                          Math.floor(Math.min(225, (voltageDistanceData?.maxV ?? 230) - 5)),
                          Math.ceil(Math.max(245, (voltageDistanceData?.maxV ?? 235) + 5))
                        ]}
                        tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                      <Tooltip
                        contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const point = payload[0]?.payload;
                          if (point?.isClient) {
                            return (
                              <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                                <div className="font-medium mb-1">🏠 {point.clientName}</div>
                                <div className="text-muted-foreground">{point.couplage} — {point.power_kVA} kVA{point.phase ? ` — ${point.phase}` : ''}</div>
                                <div className="mt-1 space-y-0.5">
                                  <div className="flex gap-2"><span className="text-muted-foreground">Nœud:</span><span className="font-mono">{point.nodeVoltage} V @ {point.nodeDistance_m} m</span></div>
                                  <div className="flex gap-2"><span className="text-muted-foreground">Brcht:</span><span className="font-mono">{point.branchLength_m} m</span></div>
                                  <div className="flex gap-2 border-t border-border/30 pt-0.5 font-medium" style={{ color: getClientColor(point.voltage, 'injection') }}>
                                    <span>Livraison:</span><span className="font-mono">{point.voltage} V</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                              <div className="font-medium mb-1">{point?.nodeName || '—'}</div>
                              <div className="text-muted-foreground">{point?.distance_m?.toFixed(1)} m — {point?.voltage?.toFixed(1)} V</div>
                            </div>
                          );
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceArea yAxisId="left" y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.2} />
                      <ReferenceLine yAxisId="left" y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                      <ReferenceLine yAxisId="left" y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" />
                      <ReferenceLine yAxisId="left" y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} />
                      {voltageDistanceData?.maxBranches.map((branch) => (
                        <Line key={`fs-max-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage > 0)}
                          type="monotone" dataKey="voltage" name={branch.label}
                          stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      ))}
                      {clientPointsData?.maxClientPoints && clientPointsData.maxClientPoints.length > 0 && (
                        <Line
                          key="fs-max-clients"
                          yAxisId="left"
                          data={clientPointsData.maxClientPoints}
                          type="monotone"
                          dataKey="voltage"
                          name="Clients"
                          stroke="none"
                          strokeWidth={0}
                          dot={(props: any) => {
                            const { cx, cy, payload } = props;
                            if (!cx || !cy) return null;
                            return (
                              <circle
                                cx={cx} cy={cy} r={5}
                                fill={getClientColor(payload.voltage, 'injection')}
                                stroke="hsl(var(--background))"
                                strokeWidth={1.5}
                              />
                            );
                          }}
                          legendType="diamond"
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* Tableau horaire */}
        {powerData.length > 0 && (
          <Card className="bg-card/50 backdrop-blur border-violet-500/30">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium">
                Détail horaire — Continu (coeff={continuCoeff.toFixed(4)})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ScrollArea className="h-[300px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Heure</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Fois. %</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">P charge</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">P PV</th>
                      <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">P net</th>
                      <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'hsl(0, 75%, 55%)' }}>V_A</th>
                      <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'hsl(142, 76%, 36%)' }}>V_B</th>
                      <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'hsl(217, 91%, 60%)' }}>V_C</th>
                      <th className="text-right py-1.5 px-2 text-violet-500 font-medium">V moy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powerData.map((row, i) => {
                      const vData = voltage24hData[i];
                      const minPhase = vData ? Math.min(vData.V_A, vData.V_B, vData.V_C) : 0;
                      return (
                        <tr key={row.hour} className="border-b border-border/20">
                          <td className="py-1 px-2 font-mono">{row.label}</td>
                          <td className="py-1 px-2 text-right font-mono">{row.foisonnement.toFixed(1)}</td>
                          <td className="py-1 px-2 text-right font-mono">{row.P_charge}</td>
                          <td className="py-1 px-2 text-right font-mono">{row.P_pv}</td>
                          <td className={`py-1 px-2 text-right font-mono ${row.P_net < 0 ? 'text-emerald-500' : ''}`}>{row.P_net}</td>
                          <td className={`py-1 px-2 text-right font-mono ${vData && vData.V_A < 218.5 ? 'text-orange-500' : ''}`}>
                            {vData && vData.V_A > 0 ? vData.V_A.toFixed(1) : '—'}
                          </td>
                          <td className={`py-1 px-2 text-right font-mono ${vData && vData.V_B < 218.5 ? 'text-orange-500' : ''}`}>
                            {vData && vData.V_B > 0 ? vData.V_B.toFixed(1) : '—'}
                          </td>
                          <td className={`py-1 px-2 text-right font-mono ${vData && vData.V_C < 218.5 ? 'text-orange-500' : ''}`}>
                            {vData && vData.V_C > 0 ? vData.V_C.toFixed(1) : '—'}
                          </td>
                          <td className={`py-1 px-2 text-right font-mono text-violet-500 ${vData && minPhase < 218.5 ? 'text-orange-500' : ''}`}>
                            {vData && vData.V_continu > 0 ? vData.V_continu.toFixed(1) : '—'}
                          </td>
                        </tr>
                      );
                    })}
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
