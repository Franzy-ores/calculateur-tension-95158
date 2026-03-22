import { useState, useMemo, useEffect, useCallback } from 'react';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNetworkStore } from '@/store/networkStore';
import { FlaskConical, MapPin, Sun, Cloud, AlertTriangle, TrendingUp, TrendingDown, Zap, Ruler, Users, Clock, Settings, Maximize2, Download, Save, RotateCcw, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { ClockDial } from '@/components/ClockDial';
import { ProfileVisualEditor } from '@/components/ProfileVisualEditor';
import { clusterProfiles, getClusterById, DEFAULT_CLUSTER_ID } from '@/data/clusterProfiles';
import { getFoisonnementPalier, calculateNormalizedDiversity } from '@/utils/foisonnementCalculator';
import { DailyProfileCalculator } from '@/utils/dailyProfileCalculator';
import { detectCriticalPoints } from '@/utils/criticalPointsDetector';
import type { CriticalPointsAnalysis } from '@/utils/criticalPointsDetector';
import { exportToCSV } from '@/utils/csvExporter';
import { saveScenario, loadAllScenarios, type ScenarioConfiguration, type SavedScenario } from '@/utils/scenarioManager';
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

      const cableLen = (() => {
        if (cable.coordinates && cable.coordinates.length >= 2) {
          let len = 0;
          for (let i = 1; i < cable.coordinates.length; i++) {
            len += calculateGeodeticDistance(
              cable.coordinates[i-1].lat, cable.coordinates[i-1].lng,
              cable.coordinates[i].lat, cable.coordinates[i].lng
            );
          }
          return len;
        }
        return cable.length_m || 0;
      })();

      if (!children.has(currentId)) children.set(currentId, []);
      children.get(currentId)!.push({ nodeId: nextId, cableLength: cableLen });

      distanceMap.set(nextId, currentDist + cableLen);
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

  const [baselineResults, setBaselineResults] = useState<HourlyVoltageResult[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [season, setSeason] = useState<'winter' | 'summer'>('winter');
  const [weather, setWeather] = useState<'sunny' | 'gray'>('sunny');
  const [showPerPhaseDistance, setShowPerPhaseDistance] = useState(false);
  const [showNeutralCurrent, setShowNeutralCurrent] = useState(false);
  const [showClientPoints, setShowClientPoints] = useState(false);
  const [clockHour, setClockHour] = useState(12);
  const [fullscreenChargeOpen, setFullscreenChargeOpen] = useState(false);
  const [fullscreenInjectionOpen, setFullscreenInjectionOpen] = useState(false);
  const [fullscreenHourlyOpen, setFullscreenHourlyOpen] = useState(false);
  const [distanceTab, setDistanceTab] = useState('charge');
  const [tableOpen, setTableOpen] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);

  // VE / PAC states
  const [evPenetration, setEvPenetration] = useState(0);
  const [evPower, setEvPower] = useState<3.7 | 11 | 22>(3.7);
  const [pacPenetration, setPacPenetration] = useState(0);
  const [pacPower, setPacPower] = useState(3);

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
    // Source en premier, puis les nœuds non-source
    const sourceNodes = currentProject.nodes.filter(n => n.isSource);
    const otherNodes = currentProject.nodes.filter(n => !n.isSource);
    return [...sourceNodes, ...otherNodes];
  }, [currentProject]);

  const sourceNode = currentProject?.nodes.find(n => n.isSource);
  const busbarDisplayVoltage = useMemo(() => {
    if (!sourceNode || !currentProject) return 230;
    const nomV = currentProject.transformerConfig?.nominalVoltage_V ?? 400;
    const sv = currentProject.transformerConfig?.sourceVoltage ?? nomV;
    return nomV >= 400 ? sv / Math.sqrt(3) : sv;
  }, [sourceNode, currentProject]);

  const selectedNodeId = dailyProfileOptions.selectedNodeId;
  const selectedClusterId = dailyProfileOptions.selectedClusterId || DEFAULT_CLUSTER_ID;
  const circuitCluster = CLUSTER_MAP[selectedClusterId] || 'B';

  // Auto-select first node
  useEffect(() => {
    if (nodes.length > 0 && !selectedNodeId) {
      setDailyProfileOptions({ selectedNodeId: nodes[0].id });
    }
  }, [nodes, selectedNodeId, setDailyProfileOptions]);

  // Load saved scenarios on mount
  useEffect(() => {
    setSavedScenarios(loadAllScenarios());
  }, []);

  // N global : tous les clients résidentiels du projet
  const nResidentialGlobal = useMemo(() => {
    if (!currentProject) return 0;
    return (currentProject.clientsImportes || []).filter(c => c.clientType !== 'industriel').length;
  }, [currentProject]);

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
      evPenetrationRate: evPenetration,
      evChargingPower_kW: evPower,
      pacPenetrationRate: pacPenetration,
      pacPower_kW: pacPower,
      nResidential: nResidentialGlobal,
    };

    // Run 1: Complet (conso + prod)
    const calcComplet = new DailyProfileCalculator(
      currentProject, baseOptions, dailyProfileCustomProfiles as any,
      simulationEquipment, isSimulationActive
    );
    const resComplet = calcComplet.calculateDailyVoltages();
    const rawC = calcComplet.getLastRawResults();

    // Run 2: Conso pure (zeroProduction)
    const calcConso = new DailyProfileCalculator(
      currentProject,
      { ...baseOptions, zeroProduction: true },
      dailyProfileCustomProfiles as any, simulationEquipment, isSimulationActive
    );
    calcConso.calculateDailyVoltages();
    const rawConso = calcConso.getLastRawResults();

    // Run 3: Prod pure (zeroConsumption)
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
  }, [currentProject, selectedNodeId, season, weather, selectedClusterId, continuCoeff, dailyProfileOptions, simulationEquipment, isSimulationActive, nResidentialGlobal, nResidential, dailyProfileCustomProfiles, evPenetration, evPower, pacPenetration, pacPower]);

  // ─── Critical points detection ───────────────────────────────────────────────
  const criticalPointsAnalysis = useMemo<CriticalPointsAnalysis>(() => {
    if (voltageContinu.length === 0) {
      return {
        violations5Percent: [],
        violations10Percent: [],
        criticalHours: [],
        worstHour: 0,
        worstVoltage: 230,
        worstDeviation: 0,
        summary: { totalViolations: 0, warningCount: 0, criticalCount: 0 },
      };
    }
    return detectCriticalPoints(voltageContinu, 230);
  }, [voltageContinu]);

  // ─── Network-wide analysis (all nodes) ───────────────────────────────────────
  const networkWideAnalysis = useMemo(() => {
    const empty = {
      maxV: 0, maxVNodeId: '', maxVHour: 0,
      minV: 999, minVNodeId: '', minVHour: 0,
      nodesOverVmax: 0, nodesUnderVmin: 0,
      pvBlockedKW: 0,
    };
    if (!currentProject || rawProdPure.length === 0 || rawConsoPure.length === 0) return empty;

    const nonSourceNodes = currentProject.nodes.filter(n => !n.isSource);
    let maxV = 0, maxVNodeId = '', maxVHour = 0;
    let minV = 999, minVNodeId = '', minVHour = 0;
    let nodesOverVmax = 0, nodesUnderVmin = 0;

    // Scan injection run (surtensions)
    for (let h = 0; h < rawProdPure.length; h++) {
      const r = rawProdPure[h];
      if (!r?.nodeMetricsPerPhase) continue;
      for (const node of nonSourceNodes) {
        const nm = r.nodeMetricsPerPhase.find(m => m.nodeId === node.id);
        if (!nm?.voltagesPerPhase) continue;
        const phases = [nm.voltagesPerPhase.A, nm.voltagesPerPhase.B, nm.voltagesPerPhase.C];
        for (const V of phases) {
          if (V <= 0) continue;
          if (V > maxV) { maxV = V; maxVNodeId = node.id; maxVHour = h; }
          if (V > 253) nodesOverVmax++;
        }
      }
    }

    // Scan charge run (sous-tensions)
    for (let h = 0; h < rawConsoPure.length; h++) {
      const r = rawConsoPure[h];
      if (!r?.nodeMetricsPerPhase) continue;
      for (const node of nonSourceNodes) {
        const nm = r.nodeMetricsPerPhase.find(m => m.nodeId === node.id);
        if (!nm?.voltagesPerPhase) continue;
        const phases = [nm.voltagesPerPhase.A, nm.voltagesPerPhase.B, nm.voltagesPerPhase.C];
        for (const V of phases) {
          if (V <= 0) continue;
          if (V < minV) { minV = V; minVNodeId = node.id; minVHour = h; }
          if (V < 207) nodesUnderVmin++;
        }
      }
    }

    // PV power at maxV hour
    let pvBlockedKW = 0;
    if (maxVHour < rawProdPure.length) {
      pvBlockedKW = rawProdPure[maxVHour]?.totalProductions_kVA ?? 0;
    }

    return { maxV, maxVNodeId, maxVHour, minV, minVNodeId, minVHour, nodesOverVmax, nodesUnderVmin, pvBlockedKW };
  }, [currentProject, rawProdPure, rawConsoPure]);

  // ─── Power chart data ────────────────────────────────────────────────────────
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
        P_net: +(pCharge + h.evPower_kVA + h.pacPower_kVA - pPV).toFixed(2),
        P_ev: +h.evPower_kVA.toFixed(2),
        P_pac: +h.pacPower_kVA.toFixed(2),
        foisonnement: h.chargesResidentialFoisonnement,
      };
    });
  }, [voltageContinu]);

  // Alerte surcharge transfo
  const transformerOverload = useMemo(() => {
    if (!currentProject || !powerData.length) return null;
    const nominalPower = currentProject.transformerConfig?.nominalPower_kVA;
    if (!nominalPower) return null;
    const peakNet = Math.max(...powerData.map(d => Math.abs(d.P_net)));
    if (peakNet > nominalPower) {
      return { peak: peakNet, capacity: nominalPower, delta: peakNet - nominalPower };
    }
    return null;
  }, [currentProject, powerData]);


  const is400V = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V';
  const busbarScale = is400V ? 1 / Math.sqrt(3) : 1;

  const voltage24hData = useMemo(() => {
    if (voltageContinu.length === 0) return [];
    return voltageContinu.map((h, i) => ({
      hour: h.hour,
      label: `${h.hour}h`,
      V_A: +h.voltageA_V.toFixed(2),
      V_B: +h.voltageB_V.toFixed(2),
      V_C: +h.voltageC_V.toFixed(2),
      V_continu: +h.voltageAvg_V.toFixed(2),
      V_busbar: +((rawContinu[i]?.virtualBusbar?.voltage_V ?? 230) * busbarScale).toFixed(2),
      foisonnement: +h.chargesResidentialFoisonnement.toFixed(2),
    }));
  }, [voltageContinu, rawContinu, busbarScale]);

  // ─── Voltage-Distance data ─────────────────────────────────────────────────────
  const networkPaths = useMemo(() => {
    if (!currentProject) return [];
    return buildNetworkPaths(currentProject.nodes, currentProject.cables);
  }, [currentProject]);

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

    const globalMinHour = rawConsoPure.reduce((worstHour, r, h) => {
      const loads = r?.totalLoads_kVA ?? 0;
      const worstLoads = rawConsoPure[worstHour]?.totalLoads_kVA ?? 0;
      return loads > worstLoads ? h : worstHour;
    }, 0);

    const globalMaxHour = rawProdPure.reduce((worstHour, r, h) => {
      const prods = r?.totalProductions_kVA ?? 0;
      const worstProds = rawProdPure[worstHour]?.totalProductions_kVA ?? 0;
      return prods > worstProds ? h : worstHour;
    }, 0);

    const getWorstVoltage = (
      results: CalculationResult[],
      nodeId: string,
      hour: number,
      mode: 'min' | 'max'
    ): number => {
      const r = results[hour];
      if (!r?.nodeMetricsPerPhase) return 0;
      const nm = r.nodeMetricsPerPhase.find(m => m.nodeId === nodeId);
      if (!nm) return 0;
      const { A, B, C } = nm.voltagesPerPhase;
      const vals = [A, B, C].filter(v => v > 0);
      if (vals.length === 0) return 0;
      return mode === 'min' ? Math.min(...vals) : Math.max(...vals);
    };

    let globalMinV = Infinity;
    for (const nodeId of allNodeIds) {
      const v = getWorstVoltage(rawConsoPure, nodeId, globalMinHour, 'min');
      if (v > 0 && v < globalMinV) globalMinV = v;
    }
    if (!isFinite(globalMinV)) globalMinV = 220;

    let globalMaxV = -Infinity;
    for (const nodeId of allNodeIds) {
      const v = getWorstVoltage(rawProdPure, nodeId, globalMaxHour, 'max');
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
            voltageWorstCharge: (() => {
              const valid = [perPhase.A, perPhase.B, perPhase.C].filter(v => v > 10);
              return valid.length > 0 ? Math.min(...valid) : 0;
            })(),
            voltageWorstInjection: (() => {
              const valid = [perPhase.A, perPhase.B, perPhase.C].filter(v => v > 10);
              return valid.length > 0 ? Math.max(...valid) : 0;
            })(),
            I_neutral: +I_neutral.toFixed(2),
          };
        }),
        color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
      }));
    };

    const minBranches = buildBranchData(rawConsoPure, globalMinHour);
    const maxBranches = buildBranchData(rawProdPure, globalMaxHour);

    const allChargeVoltages = minBranches
      .flatMap(b => b.points)
      .flatMap(p => [p.voltageWorstCharge].filter(v => v > 0 && isFinite(v)));

    const allInjectionVoltages = maxBranches
      .flatMap(b => b.points)
      .flatMap(p => [p.voltageWorstInjection].filter(v => v > 0));

    const domainCharge: [number, number] = allChargeVoltages.length > 0
      ? [Math.floor(Math.min(...allChargeVoltages) - 5), Math.ceil(Math.max(...allChargeVoltages) + 5)]
      : [200, 240];

    const domainInjection: [number, number] = allInjectionVoltages.length > 0
      ? [Math.floor(Math.min(...allInjectionVoltages) - 5), Math.ceil(Math.max(...allInjectionVoltages) + 5)]
      : [225, 260];

    return {
      minHour: globalMinHour,
      maxHour: globalMaxHour,
      minV: globalMinV,
      maxV: globalMaxV,
      domainCharge,
      domainInjection,
      minBranches,
      maxBranches,
      busbarVoltageCharge: (rawConsoPure[globalMinHour]?.virtualBusbar?.voltage_V ?? 230) * busbarScale,
      busbarVoltageInjection: (rawProdPure[globalMaxHour]?.virtualBusbar?.voltage_V ?? 230) * busbarScale,
    };
  }, [networkPaths, rawConsoPure, rawProdPure, powerData, busbarScale]);

  // ─── Client raccordement points ──────────────────────────────────────────────
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

    const getNodeVoltageForClient = (bp: any, client: any, mode: 'charge' | 'injection'): number => {
      if (client.couplage === 'TRI' || client.couplage === 'TETRA') {
        return bp.voltage;
      }
      const coupling = client.phaseCoupling || client.assignedPhase;
      if (!coupling || !bp.voltage_A) return bp.voltage;

      const voltageSystem = currentProject!.voltageSystem;
      if (voltageSystem === 'TRIPHASÉ_230V') {
        const couplingVoltageMap: Record<string, number> = {
          'A-B': bp.voltage_A,
          'B-C': bp.voltage_B,
          'A-C': bp.voltage_C,
        };
        if (couplingVoltageMap[coupling] !== undefined) {
          return couplingVoltageMap[coupling];
        }
      }
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
            const facteurDV = client.couplage === 'MONO' ? 2 : Math.sqrt(3);

            if (mode === 'injection') {
              const pvKVA = client.puissancePV_kVA || 0;
              if (pvKVA > 0) {
                const I_pv = (pvKVA * 1000) / (nodeV * (client.couplage === 'MONO' ? 1 : Math.sqrt(3)));
                const deltaV_pv = facteurDV * (R_per_m * cosPhiProd + X_per_m * sinPhiProd) * I_pv * dist_m;
                clientV = nodeV + deltaV_pv;
              } else {
                clientV = nodeV;
              }
            } else {
              const rawResult = rawConsoPure[voltageDistanceData!.minHour];
              const totalLoads = rawResult?.totalLoads_kVA ?? 0;
              const totalContractuel = [...clientMap.values()]
                .reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0);
              const foisFactor = totalContractuel > 0
                ? Math.min(totalLoads / totalContractuel, 1.0)
                : 0.07;
              const I_charge = (client.puissanceContractuelle_kVA * foisFactor * 1000)
                / (V_nom * (client.couplage === 'MONO' ? 1 : Math.sqrt(3)));
              const deltaV = facteurDV * (R_per_m * cosPhiCharges + X_per_m * sinPhiCharges) * I_charge * dist_m;
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
  }, [voltageDistanceData, currentProject, branchementCable, rawConsoPure, rawProdPure]);

  const getClientColor = (voltage: number, mode: 'charge' | 'injection' = 'charge') => {
    if (mode === 'injection') {
      if (voltage > 253) return 'hsl(0, 75%, 55%)';
      if (voltage > 241.5) return 'hsl(35, 95%, 55%)';
      return 'hsl(142, 76%, 36%)';
    }
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

  const peakSummary = useMemo(() => {
    if (powerData.length === 0) return null;
    const peakLoad = Math.max(...powerData.map(d => d.P_charge));
    const peakInjection = Math.min(...powerData.map(d => d.P_net));
    return { peakLoad, peakInjection };
  }, [powerData]);

  // ─── Baseline comparison ─────────────────────────────────────────────────────
  const handleSetBaseline = useCallback(() => {
    if (voltageContinu.length > 0) {
      setBaselineResults([...voltageContinu]);
    }
  }, [voltageContinu]);

  const baselineDelta = useMemo(() => {
    if (baselineResults.length === 0 || voltageContinu.length === 0) return null;
    const baseVoltages = baselineResults.flatMap(h => [h.voltageA_V, h.voltageB_V, h.voltageC_V]).filter(v => v > 0);
    const currVoltages = voltageContinu.flatMap(h => [h.voltageA_V, h.voltageB_V, h.voltageC_V]).filter(v => v > 0);
    if (baseVoltages.length === 0 || currVoltages.length === 0) return null;

    const baseMin = Math.min(...baseVoltages);
    const currMin = Math.min(...currVoltages);
    const baseMax = Math.max(...baseVoltages);
    const currMax = Math.max(...currVoltages);

    const baseAnalysis = detectCriticalPoints(baselineResults, 230);
    const currAnalysis = criticalPointsAnalysis;

    return {
      deltaVMin: +(currMin - baseMin).toFixed(1),
      deltaVMax: +(currMax - baseMax).toFixed(1),
      deltaViolations5: currAnalysis.summary.warningCount - baseAnalysis.summary.warningCount,
      deltaViolations10: currAnalysis.summary.criticalCount - baseAnalysis.summary.criticalCount,
    };
  }, [baselineResults, voltageContinu, criticalPointsAnalysis]);

  // ─── Export / Save handlers ──────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    exportToCSV(voltageContinu, rawContinu, {
      projectName: currentProject?.name || 'Analyse Réseau',
      filename: `analyse-${season}-${weather}-${new Date().toISOString().split('T')[0]}.csv`,
    });
  }, [voltageContinu, rawContinu, currentProject, season, weather]);

  const handleSaveScenario = useCallback(() => {
    const scenarioName = prompt('Nom du scénario:', `${season === 'winter' ? 'Hiver' : 'Été'} ${weather === 'sunny' ? 'Soleil' : 'Gris'} - ${new Date().toLocaleDateString('fr-FR')}`);
    if (!scenarioName) return;

    const configuration: ScenarioConfiguration = {
      season,
      weather,
      evPenetration,
      evPower,
      pacPenetration,
      pacPower,
      customDiversityCoeff: continuCoeff,
      adaptiveFoisonnement: !isManualOverride,
      selectedNodeId,
      selectedClusterId,
    };

    saveScenario(scenarioName, configuration, voltageContinu);
    setSavedScenarios(loadAllScenarios());
  }, [season, weather, evPenetration, evPower, pacPenetration, pacPower, continuCoeff, isManualOverride, selectedNodeId, selectedClusterId, voltageContinu]);

  if (!currentProject) {
    return <div className="p-4 text-center text-muted-foreground">Aucun projet chargé</div>;
  }

  const hasData = voltage24hData.length > 0 && voltage24hData.some(d => d.V_continu > 0);

  // ═══ SHARED COMPONENTS ═══
  const VoltageDistanceTooltip = ({ active, payload }: any) => {
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
  };

  // Shared reference lines for distance charts
  const renderDistanceReferenceLines = (yAxisId: string, busbarVoltage: number) => (
    <>
      <ReferenceLine yAxisId={yAxisId} y={211.6} stroke="hsl(0, 72%, 51%)" strokeDasharray="6 4" strokeWidth={1} />
      <ReferenceLine yAxisId={yAxisId} y={248.4} stroke="hsl(0, 72%, 51%)" strokeDasharray="6 4" strokeWidth={1} />
      <ReferenceLine yAxisId={yAxisId} y={207} stroke="hsl(0, 72%, 51%)" strokeWidth={1.5} />
      <ReferenceLine yAxisId={yAxisId} y={253} stroke="hsl(0, 72%, 51%)" strokeWidth={1.5} />
      <ReferenceLine yAxisId={yAxisId} y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} label={{ value: '230V', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
      <ReferenceLine yAxisId={yAxisId} y={busbarVoltage} stroke="hsl(280, 70%, 50%)" strokeDasharray="6 3" strokeWidth={1.5}
        label={{ value: `Busbar ${busbarVoltage.toFixed(1)}V`, fontSize: 9, fill: 'hsl(280, 70%, 50%)' }} />
    </>
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // ═══ UNIFIED RENDER ═══
  // ═══════════════════════════════════════════════════════════════════════════════

  return (
    <>
      <div className="flex flex-col h-full">
        {/* ─── STICKY CONTROL BAR ─── */}
        <div className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border/50 px-3 py-2 space-y-1.5">
          {/* Row 1: Node + Season + Weather + Cluster + Simulation */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Select value={selectedNodeId || ''} onValueChange={v => setDailyProfileOptions({ selectedNodeId: v })}>
                <SelectTrigger className="h-7 text-xs w-48"><SelectValue placeholder="Nœud…" /></SelectTrigger>
                <SelectContent>
                  {nodes.map(n => (
                    <SelectItem key={n.id} value={n.id} className="text-xs">
                      {n.isSource ? (
                        <span className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-primary/50 text-primary">Source</Badge>
                          {n.name || 'Busbar'} · {busbarDisplayVoltage.toFixed(0)}V
                        </span>
                      ) : (n.name || n.id.slice(0,8))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant={nodeSelectionMode === 'profil24h' ? 'default' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => startNodeSelection('profil24h')}>
                <MapPin className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="h-4 w-px bg-border/50" />

            {/* Season toggle */}
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
              <Button size="sm" variant={season === 'winter' ? 'default' : 'ghost'} className="h-6 px-2 text-[11px]" onClick={() => setSeason('winter')}>❄️</Button>
              <Button size="sm" variant={season === 'summer' ? 'default' : 'ghost'} className="h-6 px-2 text-[11px]" onClick={() => setSeason('summer')}>☀️</Button>
            </div>

            {/* Weather toggle */}
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
              <Button size="sm" variant={weather === 'sunny' ? 'default' : 'ghost'} className="h-6 px-2 text-[11px]" onClick={() => setWeather('sunny')}><Sun className="h-3 w-3" /></Button>
              <Button size="sm" variant={weather === 'gray' ? 'default' : 'ghost'} className="h-6 px-2 text-[11px]" onClick={() => setWeather('gray')}><Cloud className="h-3 w-3" /></Button>
            </div>

            <div className="h-4 w-px bg-border/50" />

            {/* Cluster dropdown */}
            <Select value={selectedClusterId} onValueChange={v => setDailyProfileOptions({ selectedClusterId: v })}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {clusterProfiles.map(cp => (
                  <SelectItem key={cp.id} value={cp.id} className="text-xs">{cp.icon} {cp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Simulation toggle */}
            {hasAnyEquipment && (
              <>
                <div className="h-4 w-px bg-border/50" />
                <div className="flex items-center gap-1.5">
                  <Switch checked={isSimulationActive} onCheckedChange={toggleSimulationActive} className="data-[state=checked]:bg-emerald-600 scale-75" />
                  <span className="text-[10px] text-muted-foreground">Simu</span>
                  {isSimulationActive && totalEquipment > 0 && (
                    <Badge variant="secondary" className="text-[9px] h-4 px-1">{totalEquipment} éq.</Badge>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Row 2: VE + PAC + Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* VE inline — numeric inputs */}
            <div className="flex items-center gap-1 text-[10px]">
              <Zap className="h-3 w-3 text-amber-500" />
              <span className="text-muted-foreground">VE</span>
              <input type="number" min={0} max={100} step={5}
                value={Math.round(evPenetration * 100)}
                onChange={e => setEvPenetration(Math.min(100, Math.max(0, Number(e.target.value))) / 100)}
                className="w-12 h-6 text-xs text-center rounded border border-input bg-background font-mono tabular-nums px-1"
              />
              <span className="text-muted-foreground">%</span>
              <span className="text-muted-foreground mx-0.5">×</span>
              <div className="flex gap-0.5">
                {([3.7, 11, 22] as const).map(p => (
                  <Button key={p} size="sm" variant={evPower === p ? 'default' : 'ghost'} onClick={() => setEvPower(p)} className="text-[9px] h-5 px-1.5 min-w-0">{p}</Button>
                ))}
              </div>
              <span className="text-muted-foreground font-mono text-[9px]">→ {(nResidential * evPenetration * evPower).toFixed(1)}kW</span>
              <TooltipProvider delayDuration={200}>
                <UITooltip>
                  <TooltipTrigger asChild><span className="text-orange-500 cursor-help text-[9px]">⚠️</span></TooltipTrigger>
                  <TooltipContent side="top"><p className="text-xs max-w-48">Valeur non foisonnée — coefficients VE/PAC à définir</p></TooltipContent>
                </UITooltip>
              </TooltipProvider>
            </div>

            <div className="h-4 w-px bg-border/50" />

            {/* PAC inline — numeric inputs */}
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-muted-foreground">🌡️ PAC</span>
              <input type="number" min={0} max={100} step={5}
                value={Math.round(pacPenetration * 100)}
                onChange={e => setPacPenetration(Math.min(100, Math.max(0, Number(e.target.value))) / 100)}
                className="w-12 h-6 text-xs text-center rounded border border-input bg-background font-mono tabular-nums px-1"
              />
              <span className="text-muted-foreground">% ×</span>
              <input type="number" min={1} max={9} step={0.5}
                value={pacPower}
                onChange={e => setPacPower(Math.min(9, Math.max(1, Number(e.target.value))))}
                className="w-12 h-6 text-xs text-center rounded border border-input bg-background font-mono tabular-nums px-1"
              />
              <span className="text-muted-foreground">kW</span>
              <span className="text-muted-foreground font-mono text-[9px]">→ {(nResidential * pacPenetration * pacPower).toFixed(1)}kW</span>
              <TooltipProvider delayDuration={200}>
                <UITooltip>
                  <TooltipTrigger asChild><span className="text-orange-500 cursor-help text-[9px]">⚠️</span></TooltipTrigger>
                  <TooltipContent side="top"><p className="text-xs max-w-48">Valeur non foisonnée — coefficients VE/PAC à définir</p></TooltipContent>
                </UITooltip>
              </TooltipProvider>
            </div>

            <div className="flex-1" />

            {/* Actions */}
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => setEditorOpen(true)}>
                <Settings className="h-3 w-3" /> Profils
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={handleExportCSV} disabled={voltageContinu.length === 0}>
                <Download className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={handleSaveScenario} disabled={voltageContinu.length === 0}>
                <Save className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => { setBaselineResults([]); }}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* ─── ALERTS ─── */}
        {(hasData || transformerOverload) && (
          <div className="px-3 pt-2 space-y-1.5">
            {/* Alerte surcharge transfo */}
            {transformerOverload && (
              <div className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 flex items-center gap-2 text-xs">
                <Zap className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="font-medium text-destructive">Surcharge transfo</span>
                <span className="text-destructive">pic {transformerOverload.peak.toFixed(1)} kVA &gt; capacité {transformerOverload.capacity} kVA</span>
                <Badge variant="destructive" className="text-[9px] h-4">+{transformerOverload.delta.toFixed(1)} kVA</Badge>
              </div>
            )}
            {/* Alertes tension — conformité réseau global */}
            {hasData && (() => {
              const networkConform =
                criticalPointsAnalysis.summary.totalViolations === 0 &&
                networkWideAnalysis.maxV <= 253 &&
                networkWideAnalysis.minV >= 207;

              const maxVNode = currentProject?.nodes.find(n => n.id === networkWideAnalysis.maxVNodeId);
              const minVNode = currentProject?.nodes.find(n => n.id === networkWideAnalysis.minVNodeId);

              if (networkConform) {
                return (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 flex items-center gap-2 text-xs text-emerald-600">
                    ✅ Réseau conforme EN 50160 — tous nœuds vérifiés
                  </div>
                );
              }

              return (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <span className="font-medium text-destructive">Non conforme EN 50160</span>
                    {criticalPointsAnalysis.summary.warningCount > 0 && (
                      <Badge variant="outline" className="text-[9px] h-4 border-orange-500/50 text-orange-500">{criticalPointsAnalysis.summary.warningCount} ±5%</Badge>
                    )}
                    {criticalPointsAnalysis.summary.criticalCount > 0 && (
                      <Badge variant="destructive" className="text-[9px] h-4">{criticalPointsAnalysis.summary.criticalCount} ±10%</Badge>
                    )}
                  </div>
                  {networkWideAnalysis.maxV > 253 && (
                    <div className="flex items-center gap-1.5 text-destructive pl-5">
                      <TrendingUp className="h-3 w-3 shrink-0" />
                      <span>Surtension {networkWideAnalysis.maxV.toFixed(1)}V — {maxVNode?.name || networkWideAnalysis.maxVNodeId.slice(0, 8)} à {networkWideAnalysis.maxVHour}h</span>
                      <Badge variant="destructive" className="text-[8px] h-3.5 ml-1">⚡ Trip onduleur probable</Badge>
                    </div>
                  )}
                  {networkWideAnalysis.minV < 207 && (
                    <div className="flex items-center gap-1.5 text-destructive pl-5">
                      <TrendingDown className="h-3 w-3 shrink-0" />
                      <span>Sous-tension {networkWideAnalysis.minV.toFixed(1)}V — {minVNode?.name || networkWideAnalysis.minVNodeId.slice(0, 8)} à {networkWideAnalysis.minVHour}h</span>
                    </div>
                  )}
                  {networkWideAnalysis.pvBlockedKW > 0 && networkWideAnalysis.maxV > 253 && (
                    <div className="text-muted-foreground pl-5 text-[10px]">
                      Production PV concernée : ~{networkWideAnalysis.pvBlockedKW.toFixed(1)} kVA à cette heure
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ─── MAIN CONTENT: Sidebar + Charts ─── */}
        <div className="flex-1 overflow-auto px-3 pt-2 pb-4">
          {!hasData && !selectedNodeId && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Sélectionnez un nœud pour lancer l'analyse
            </div>
          )}
          {!hasData && selectedNodeId && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Aucun client lié au réseau. Importez des clients et liez-les aux nœuds.
            </div>
          )}

          {hasData && (
            <div className="flex gap-3 mt-1">
              {/* ─── SIDEBAR SYNTHESIS ─── */}
              <div className="w-56 shrink-0 space-y-2">
                {/* Puissances */}
                {peakSummary && (
                  <div className="bg-muted/40 rounded-md p-2.5 space-y-1 text-xs">
                    <div className="font-medium text-foreground text-[11px]">Puissances</div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Pic</span>
                      <span className="font-mono">{peakSummary.peakLoad.toFixed(1)} kVA</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Net min</span>
                      <span className="font-mono">{peakSummary.peakInjection.toFixed(1)} kVA</span>
                    </div>
                  </div>
                )}

                {/* Tensions */}
                {(() => {
                  const allPhaseV = voltage24hData.flatMap(d => [d.V_A, d.V_B, d.V_C]).filter(v => v > 0);
                  const minV = allPhaseV.length > 0 ? Math.min(...allPhaseV) : 0;
                  const maxV = allPhaseV.length > 0 ? Math.max(...allPhaseV) : 0;
                  const vA = voltage24hData.map(d => d.V_A).filter(v => v > 0);
                  const vB = voltage24hData.map(d => d.V_B).filter(v => v > 0);
                  const vC = voltage24hData.map(d => d.V_C).filter(v => v > 0);
                  return (
                    <div className="bg-muted/40 rounded-md p-2.5 space-y-1 text-xs">
                      <div className="font-medium text-foreground text-[11px] flex items-center gap-1">
                        <Zap className="h-3 w-3 text-violet-500" /> Tensions
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">V min</span>
                        <span className={`font-mono ${minV < 207 ? 'text-destructive' : minV < 218.5 ? 'text-orange-500' : ''}`}>{minV.toFixed(1)} V</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">V max</span>
                        <span className="font-mono">{maxV.toFixed(1)} V</span>
                      </div>
                      <div className="border-t border-border/30 pt-1 space-y-0.5">
                        <div className="flex justify-between"><span style={{ color: 'hsl(0, 75%, 55%)' }}>A</span><span className="font-mono text-[10px]">{vA.length > 0 ? Math.min(...vA).toFixed(1) : '—'}…{vA.length > 0 ? Math.max(...vA).toFixed(1) : '—'}</span></div>
                        <div className="flex justify-between"><span style={{ color: 'hsl(142, 76%, 36%)' }}>B</span><span className="font-mono text-[10px]">{vB.length > 0 ? Math.min(...vB).toFixed(1) : '—'}…{vB.length > 0 ? Math.max(...vB).toFixed(1) : '—'}</span></div>
                        <div className="flex justify-between"><span style={{ color: 'hsl(217, 91%, 60%)' }}>C</span><span className="font-mono text-[10px]">{vC.length > 0 ? Math.min(...vC).toFixed(1) : '—'}…{vC.length > 0 ? Math.max(...vC).toFixed(1) : '—'}</span></div>
                      </div>
                    </div>
                  );
                })()}

                {/* Foisonnement K(N) */}
                <div className="bg-muted/40 rounded-md p-2.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground text-[11px]">Foisonnement K(N)</span>
                    {isManualOverride && (
                      <Button variant="ghost" size="sm" className="h-4 text-[9px] px-1" onClick={handleResetFormula}><RotateCcw className="h-2.5 w-2.5" /></Button>
                    )}
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground">K = [a + (1−a)/√N] / F<sub>ref</sub></div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-muted-foreground">a</span>
                      <span className="font-mono text-[10px]">{customA.toFixed(2)}</span>
                    </div>
                    <Slider min={0.05} max={0.50} step={0.01} value={[customA]} onValueChange={([v]) => { setCustomA(v); setIsManualOverride(true); }} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-muted-foreground">N</span>
                      <span className="font-mono text-[10px]">{customN}</span>
                    </div>
                    <Slider min={1} max={200} step={1} value={[customN]} onValueChange={([v]) => { setCustomN(v); setIsManualOverride(true); }} />
                  </div>
                  <div className="border-t border-border/30 pt-1.5 space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-violet-500 font-medium">{continuCoeff.toFixed(4)}</span>
                      <span className="text-muted-foreground text-[10px]">palier: {palierCoeff.toFixed(2)}</span>
                    </div>
                    {palierCoeff > 0 && (
                      <div className={`text-[10px] font-medium ${continuCoeff > palierCoeff ? 'text-orange-500' : 'text-emerald-500'}`}>
                        Δ = {((continuCoeff - palierCoeff) / palierCoeff * 100).toFixed(0)}%
                      </div>
                    )}
                    {isManualOverride && <Badge variant="outline" className="text-[8px] border-orange-500/50 text-orange-500 h-3.5">Manuel</Badge>}
                  </div>
                </div>

                {/* Comparaison baseline */}
                {baselineDelta ? (
                  <div className="bg-muted/40 rounded-md p-2.5 space-y-1.5 text-xs">
                    <div className="font-medium text-foreground text-[11px]">Δ Baseline</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="text-center">
                        <div className="text-[9px] text-muted-foreground">ΔV min</div>
                        <div className={`font-mono text-[11px] font-medium ${baselineDelta.deltaVMin < 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                          {baselineDelta.deltaVMin > 0 ? '+' : ''}{baselineDelta.deltaVMin}V
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] text-muted-foreground">ΔV max</div>
                        <div className={`font-mono text-[11px] font-medium ${baselineDelta.deltaVMax > 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                          {baselineDelta.deltaVMax > 0 ? '+' : ''}{baselineDelta.deltaVMax}V
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] text-muted-foreground">Δ ±5%</div>
                        <div className={`font-mono text-[11px] font-medium ${baselineDelta.deltaViolations5 > 0 ? 'text-destructive' : baselineDelta.deltaViolations5 < 0 ? 'text-emerald-500' : ''}`}>
                          {baselineDelta.deltaViolations5 > 0 ? '+' : ''}{baselineDelta.deltaViolations5}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] text-muted-foreground">Δ ±10%</div>
                        <div className={`font-mono text-[11px] font-medium ${baselineDelta.deltaViolations10 > 0 ? 'text-destructive' : baselineDelta.deltaViolations10 < 0 ? 'text-emerald-500' : ''}`}>
                          {baselineDelta.deltaViolations10 > 0 ? '+' : ''}{baselineDelta.deltaViolations10}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full text-[10px] h-7 gap-1" onClick={handleSetBaseline} disabled={voltageContinu.length === 0}>
                    <SlidersHorizontal className="h-3 w-3" /> Fixer comme baseline
                  </Button>
                )}

                {/* Saved scenarios */}
                {savedScenarios.length > 0 && (
                  <Collapsible open={scenariosOpen} onOpenChange={setScenariosOpen}>
                    <CollapsibleTrigger className="flex items-center justify-between w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1">
                      <span>Scénarios ({savedScenarios.length})</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${scenariosOpen ? 'rotate-180' : ''}`} />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-0.5 mt-1">
                        {savedScenarios.slice(0, 8).map(s => (
                          <div key={s.id} className="flex items-center justify-between bg-muted/30 rounded px-2 py-1 text-[10px]">
                            <span className="truncate">{s.name}</span>
                            <span className="text-muted-foreground shrink-0 ml-1">{new Date(s.date).toLocaleDateString('fr-FR')}</span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>

              {/* ─── MAIN CHARTS AREA ─── */}
              <div className="flex-1 min-w-0 space-y-3">
                {/* Power 24h */}
                <div className="bg-card/50 backdrop-blur rounded-lg border border-border/50 p-3">
                  <div className="text-[11px] font-medium text-foreground mb-1 flex items-center gap-2">
                    Puissance nodale 24h
                    <Badge variant="outline" className="text-[9px] h-4">{selectedNode?.name || selectedNodeId?.slice(0,6)} • {season === 'winter' ? '❄️' : '☀️'} • {weather === 'sunny' ? '☀️' : '☁️'}</Badge>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={powerData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} unit=" kVA" />
                      <Tooltip contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(value: number, name: string) => [`${value.toFixed(2)} kVA`, name]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="P_charge" name="P charge" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="P_pv" name="P PV" stroke="hsl(142, 76%, 36%)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="P_ev" name="P VE" stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="P_pac" name="P PAC" stroke="hsl(330, 81%, 60%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="P_net" name="P net" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Voltage 24h */}
                <div className="bg-card/50 backdrop-blur rounded-lg border border-border/50 p-3">
                  <div className="text-[11px] font-medium text-foreground mb-1 flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-violet-500" />
                    Tension nodale 24h
                    <Badge variant="outline" className="text-[9px] h-4 border-violet-500/50 text-violet-500">K={continuCoeff.toFixed(4)}</Badge>
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={voltage24hData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis domain={[voltageRange.min, voltageRange.max]} tick={{ fontSize: 10 }} unit=" V" />
                      <Tooltip contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(value: number, name: string) => [`${value.toFixed(1)} V`, name]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceArea y1={218.5} y2={241.5} fill="hsl(var(--muted))" fillOpacity={0.3} />
                      <ReferenceLine y={207} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: '-10%', fontSize: 9, fill: 'hsl(var(--destructive))' }} />
                      <ReferenceLine y={253} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: '+10%', fontSize: 9, fill: 'hsl(var(--destructive))' }} />
                      <ReferenceLine y={218.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                      <ReferenceLine y={241.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                      <ReferenceLine y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} label={{ value: '230V', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                      <Line type="monotone" dataKey="V_busbar" name="Busbar" stroke="hsl(280, 70%, 50%)" strokeWidth={2} dot={false} strokeDasharray="6 3" />
                      <Line type="monotone" dataKey="V_A" name="Phase A" stroke="hsl(0, 75%, 55%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="V_B" name="Phase B" stroke="hsl(142, 76%, 36%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="V_C" name="Phase C" stroke="hsl(217, 91%, 60%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="V_continu" name="V moyen" stroke="hsl(270, 70%, 60%)" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Tension vs Distance — Tabbed */}
                {voltageDistanceData && voltageDistanceData.minBranches.length > 0 && (
                  <div className="bg-card/50 backdrop-blur rounded-lg border border-border/50 p-3">
                    {/* Options bar */}
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-[11px] font-medium flex items-center gap-1">
                        <Ruler className="h-3.5 w-3.5 text-blue-500" /> Tension vs Distance
                      </span>
                      <div className="flex items-center gap-3 text-[10px] ml-auto">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <Checkbox checked={showPerPhaseDistance} onCheckedChange={(c) => setShowPerPhaseDistance(c === true)} className="h-3 w-3" />
                          <span className="text-muted-foreground">Par phase</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <Checkbox checked={showNeutralCurrent} onCheckedChange={(c) => setShowNeutralCurrent(c === true)} className="h-3 w-3" />
                          <span className="text-muted-foreground">I<sub>N</sub></span>
                        </label>
                        {clientPointsData && (
                          <label className="flex items-center gap-1 cursor-pointer">
                            <Checkbox checked={showClientPoints} onCheckedChange={(c) => setShowClientPoints(c === true)} className="h-3 w-3" />
                            <span className="text-muted-foreground"><Users className="h-2.5 w-2.5 inline" /> Clients</span>
                          </label>
                        )}
                      </div>
                    </div>

                    <Tabs value={distanceTab} onValueChange={setDistanceTab}>
                      <TabsList className="h-7 bg-muted/50">
                        <TabsTrigger value="charge" className="text-[10px] h-5 px-2 data-[state=active]:text-blue-600">
                          Charge ({voltageDistanceData.minHour}h)
                        </TabsTrigger>
                        <TabsTrigger value="injection" className="text-[10px] h-5 px-2 data-[state=active]:text-emerald-600">
                          Injection ({voltageDistanceData.maxHour}h)
                        </TabsTrigger>
                        <TabsTrigger value="hourly" className="text-[10px] h-5 px-2 data-[state=active]:text-amber-600">
                          Horaire ({clockHour}h)
                        </TabsTrigger>
                      </TabsList>

                      {/* CHARGE TAB */}
                      <TabsContent value="charge" className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="outline" className="text-[9px] h-4 border-blue-500/50 text-blue-500">
                            Vmin {voltageDistanceData.minV.toFixed(1)}V • Busbar {voltageDistanceData.busbarVoltageCharge.toFixed(1)}V
                          </Badge>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setFullscreenChargeOpen(true)}><Maximize2 className="h-3 w-3" /></Button>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }} label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                            <YAxis yAxisId="left" domain={voltageDistanceData.domainCharge} tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                            {showNeutralCurrent && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit=" A" />}
                            <Tooltip content={VoltageDistanceTooltip} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            {renderDistanceReferenceLines('left', voltageDistanceData.busbarVoltageCharge)}
                            {voltageDistanceData.minBranches.map((branch) => (
                              <Line key={`min-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltageWorstCharge > 0 && isFinite(p.voltageWorstCharge))}
                                type="monotone" dataKey="voltageWorstCharge" name={branch.label}
                                stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                            ))}
                            {showPerPhaseDistance && voltageDistanceData.minBranches.flatMap((branch) => [
                              <Line key={`min-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)} type="monotone" dataKey="voltage_A" name={`${branch.label} A`} stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                              <Line key={`min-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)} type="monotone" dataKey="voltage_B" name={`${branch.label} B`} stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                              <Line key={`min-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)} type="monotone" dataKey="voltage_C" name={`${branch.label} C`} stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                            ])}
                            {showNeutralCurrent && voltageDistanceData.minBranches.map((branch) => (
                              <Line key={`min-IN-${branch.branchId}`} yAxisId="right" data={branch.points} type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`} stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </TabsContent>

                      {/* INJECTION TAB */}
                      <TabsContent value="injection" className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/50 text-emerald-500">
                            Vmax {voltageDistanceData.maxV.toFixed(1)}V • Busbar {voltageDistanceData.busbarVoltageInjection.toFixed(1)}V
                          </Badge>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setFullscreenInjectionOpen(true)}><Maximize2 className="h-3 w-3" /></Button>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }} label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                            <YAxis yAxisId="left" domain={voltageDistanceData.domainInjection} tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                            {showNeutralCurrent && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit=" A" />}
                            <Tooltip content={VoltageDistanceTooltip} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            {renderDistanceReferenceLines('left', voltageDistanceData.busbarVoltageInjection)}
                            {voltageDistanceData.maxBranches.map((branch) => (
                              <Line key={`max-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltageWorstInjection > 0)}
                                type="monotone" dataKey="voltageWorstInjection" name={branch.label}
                                stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                            ))}
                            {showPerPhaseDistance && voltageDistanceData.maxBranches.flatMap((branch) => [
                              <Line key={`max-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)} type="monotone" dataKey="voltage_A" name={`${branch.label} A`} stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                              <Line key={`max-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)} type="monotone" dataKey="voltage_B" name={`${branch.label} B`} stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                              <Line key={`max-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)} type="monotone" dataKey="voltage_C" name={`${branch.label} C`} stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                            ])}
                            {showNeutralCurrent && voltageDistanceData.maxBranches.map((branch) => (
                              <Line key={`max-IN-${branch.branchId}`} yAxisId="right" data={branch.points} type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`} stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </TabsContent>

                      {/* HOURLY TAB */}
                      <TabsContent value="hourly" className="mt-2">
                        {rawContinu.length > 0 && networkPaths.length > 0 && (() => {
                          const getCableNeutralCurrentHourly = (results: CalculationResult[], hour: number, nodeA: string, nodeB: string): number => {
                            const r = results[hour];
                            if (!r?.cables) return 0;
                            const cable = r.cables.find(c => (c.nodeAId === nodeA && c.nodeBId === nodeB) || (c.nodeAId === nodeB && c.nodeBId === nodeA));
                            return cable?.currentsPerPhase_A?.N ?? 0;
                          };

                          const hourlyBranches = networkPaths.map((branch, idx) => ({
                            ...branch,
                            points: branch.points.map((p, pi) => {
                              const perPhase = getNodeVoltagePerPhase(rawContinu, p.nodeId, clockHour);
                              const I_neutral = pi > 0 ? getCableNeutralCurrentHourly(rawContinu, clockHour, branch.points[pi - 1].nodeId, p.nodeId) : 0;
                              return { ...p, voltage: perPhase.avg, voltage_A: perPhase.A, voltage_B: perPhase.B, voltage_C: perPhase.C, I_neutral: +I_neutral.toFixed(2) };
                            }),
                            color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
                          }));

                          const allVoltages = hourlyBranches.flatMap(b => b.points.flatMap(p => [p.voltage, p.voltage_A, p.voltage_B, p.voltage_C])).filter(v => v > 0);
                          const minV = allVoltages.length > 0 ? Math.min(...allVoltages) : 220;
                          const maxV = allVoltages.length > 0 ? Math.max(...allVoltages) : 240;
                          const hourFois = voltageContinu[clockHour]?.chargesResidentialFoisonnement;
                          const busbarVoltageHourly = (rawContinu[clockHour]?.virtualBusbar?.voltage_V ?? 230) * busbarScale;

                          return (
                            <>
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[9px] h-4 border-amber-500/50 text-amber-500">{clockHour}h • Busbar {busbarVoltageHourly.toFixed(1)}V</Badge>
                                  {hourFois !== undefined && <Badge variant="secondary" className="text-[9px] h-4">fois. {hourFois.toFixed(1)}%</Badge>}
                                </div>
                                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setFullscreenHourlyOpen(true)}><Maximize2 className="h-3 w-3" /></Button>
                              </div>
                              <div className="flex items-start gap-3">
                                <div className="shrink-0 pt-2">
                                  <ClockDial hour={clockHour} onChange={setClockHour} size={110} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <ResponsiveContainer width="100%" height={250}>
                                    <LineChart>
                                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                                      <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }} label={{ value: 'Distance (m)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                                      <YAxis yAxisId="left" domain={[Math.floor(minV - 5), Math.ceil(maxV + 5)]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                                      {showNeutralCurrent && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit=" A" />}
                                      <Tooltip content={VoltageDistanceTooltip} />
                                      <Legend wrapperStyle={{ fontSize: 10 }} />
                                      {renderDistanceReferenceLines('left', busbarVoltageHourly)}
                                      {hourlyBranches.map((branch) => (
                                        <Line key={`hourly-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage > 0)}
                                          type="monotone" dataKey="voltage" name={branch.label}
                                          stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                                      ))}
                                      {showPerPhaseDistance && hourlyBranches.flatMap((branch) => [
                                        <Line key={`hourly-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)} type="monotone" dataKey="voltage_A" name={`${branch.label} A`} stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                                        <Line key={`hourly-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)} type="monotone" dataKey="voltage_B" name={`${branch.label} B`} stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                                        <Line key={`hourly-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)} type="monotone" dataKey="voltage_C" name={`${branch.label} C`} stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                                      ])}
                                      {showNeutralCurrent && hourlyBranches.map((branch) => (
                                        <Line key={`hourly-IN-${branch.branchId}`} yAxisId="right" data={branch.points} type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`} stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                                      ))}
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </TabsContent>
                    </Tabs>
                  </div>
                )}

                {/* Hourly detail table — collapsible */}
                {powerData.length > 0 && (
                  <Collapsible open={tableOpen} onOpenChange={setTableOpen}>
                    <CollapsibleTrigger className="flex items-center gap-2 w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1 px-1">
                      <ChevronDown className={`h-3 w-3 transition-transform ${tableOpen ? 'rotate-180' : ''}`} />
                      <span>Tableau horaire détaillé</span>
                      <Badge variant="outline" className="text-[8px] h-3.5">K={continuCoeff.toFixed(4)}</Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="bg-card/50 backdrop-blur rounded-lg border border-border/50 p-3 mt-1">
                        <ScrollArea className="h-[280px]">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/50">
                                <th className="text-left py-1 px-2 text-muted-foreground font-medium">H</th>
                                <th className="text-right py-1 px-2 text-muted-foreground font-medium">Fois.%</th>
                                <th className="text-right py-1 px-2 text-muted-foreground font-medium">P ch.</th>
                                <th className="text-right py-1 px-2 text-muted-foreground font-medium">P PV</th>
                                <th className="text-right py-1 px-2 text-muted-foreground font-medium">P net</th>
                                <th className="text-right py-1 px-2 font-medium" style={{ color: 'hsl(0, 75%, 55%)' }}>A</th>
                                <th className="text-right py-1 px-2 font-medium" style={{ color: 'hsl(142, 76%, 36%)' }}>B</th>
                                <th className="text-right py-1 px-2 font-medium" style={{ color: 'hsl(217, 91%, 60%)' }}>C</th>
                                <th className="text-right py-1 px-2 text-violet-500 font-medium">Moy</th>
                              </tr>
                            </thead>
                            <tbody>
                              {powerData.map((row, i) => {
                                const vData = voltage24hData[i];
                                const minPhase = vData ? Math.min(vData.V_A, vData.V_B, vData.V_C) : 0;
                                return (
                                  <tr key={row.hour} className="border-b border-border/20">
                                    <td className="py-0.5 px-2 font-mono">{row.label}</td>
                                    <td className="py-0.5 px-2 text-right font-mono">{row.foisonnement.toFixed(1)}</td>
                                    <td className="py-0.5 px-2 text-right font-mono">{row.P_charge}</td>
                                    <td className="py-0.5 px-2 text-right font-mono">{row.P_pv}</td>
                                    <td className={`py-0.5 px-2 text-right font-mono ${row.P_net < 0 ? 'text-emerald-500' : ''}`}>{row.P_net}</td>
                                    <td className={`py-0.5 px-2 text-right font-mono ${vData && vData.V_A < 218.5 ? 'text-orange-500' : ''}`}>{vData && vData.V_A > 0 ? vData.V_A.toFixed(1) : '—'}</td>
                                    <td className={`py-0.5 px-2 text-right font-mono ${vData && vData.V_B < 218.5 ? 'text-orange-500' : ''}`}>{vData && vData.V_B > 0 ? vData.V_B.toFixed(1) : '—'}</td>
                                    <td className={`py-0.5 px-2 text-right font-mono ${vData && vData.V_C < 218.5 ? 'text-orange-500' : ''}`}>{vData && vData.V_C > 0 ? vData.V_C.toFixed(1) : '—'}</td>
                                    <td className={`py-0.5 px-2 text-right font-mono text-violet-500 ${vData && minPhase < 218.5 ? 'text-orange-500' : ''}`}>{vData && vData.V_continu > 0 ? vData.V_continu.toFixed(1) : '—'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </ScrollArea>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Profile editor dialog */}
      <ProfileVisualEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        profiles={dailyProfileCustomProfiles}
        onSave={setDailyProfileCustomProfiles}
      />

      {/* Fullscreen dialogs */}
      {voltageDistanceData && (
        <>
          {/* Fullscreen charge */}
          <Dialog open={fullscreenChargeOpen} onOpenChange={setFullscreenChargeOpen}>
            <DialogContent className="max-w-[95vw] max-h-[95vh] w-full overflow-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Ruler className="h-4 w-4 text-blue-500" />
                  Tension vs Distance — Pire cas charge
                  <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-500">
                    {voltageDistanceData.minHour}h • Vmin {voltageDistanceData.minV.toFixed(1)}V • Busbar {voltageDistanceData.busbarVoltageCharge.toFixed(1)}V
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <ResponsiveContainer width="100%" height={550}>
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" domain={voltageDistanceData.domainCharge} tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                  {showNeutralCurrent && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit=" A" />}
                  <Tooltip contentStyle={{ fontSize: 12, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {renderDistanceReferenceLines('left', voltageDistanceData.busbarVoltageCharge)}
                  {voltageDistanceData.minBranches.map((branch) => (
                    <Line key={`fs-min-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltageWorstCharge > 0 && isFinite(p.voltageWorstCharge))}
                      type="monotone" dataKey="voltageWorstCharge" name={branch.label} stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                  {showPerPhaseDistance && voltageDistanceData.minBranches.flatMap((branch) => [
                    <Line key={`fs-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)} type="monotone" dataKey="voltage_A" name={`${branch.label} A`} stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                    <Line key={`fs-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)} type="monotone" dataKey="voltage_B" name={`${branch.label} B`} stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                    <Line key={`fs-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)} type="monotone" dataKey="voltage_C" name={`${branch.label} C`} stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                  ])}
                  {showNeutralCurrent && voltageDistanceData.minBranches.map((branch) => (
                    <Line key={`fs-IN-${branch.branchId}`} yAxisId="right" data={branch.points} type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`} stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </DialogContent>
          </Dialog>

          {/* Fullscreen injection */}
          <Dialog open={fullscreenInjectionOpen} onOpenChange={setFullscreenInjectionOpen}>
            <DialogContent className="max-w-[95vw] max-h-[95vh] w-full overflow-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Ruler className="h-4 w-4 text-emerald-500" />
                  Tension vs Distance — Pire cas injection
                  <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-500">
                    {voltageDistanceData.maxHour}h • Vmax {voltageDistanceData.maxV.toFixed(1)}V • Busbar {voltageDistanceData.busbarVoltageInjection.toFixed(1)}V
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <ResponsiveContainer width="100%" height={550}>
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" domain={voltageDistanceData.domainInjection} tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                  {showNeutralCurrent && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit=" A" />}
                  <Tooltip contentStyle={{ fontSize: 12, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {renderDistanceReferenceLines('left', voltageDistanceData.busbarVoltageInjection)}
                  {voltageDistanceData.maxBranches.map((branch) => (
                    <Line key={`fs-max-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltageWorstInjection > 0)}
                      type="monotone" dataKey="voltageWorstInjection" name={branch.label} stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                  {showPerPhaseDistance && voltageDistanceData.maxBranches.flatMap((branch) => [
                    <Line key={`fs-max-A-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_A > 0)} type="monotone" dataKey="voltage_A" name={`${branch.label} A`} stroke="hsl(0, 75%, 55%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                    <Line key={`fs-max-B-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_B > 0)} type="monotone" dataKey="voltage_B" name={`${branch.label} B`} stroke="hsl(142, 76%, 36%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                    <Line key={`fs-max-C-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltage_C > 0)} type="monotone" dataKey="voltage_C" name={`${branch.label} C`} stroke="hsl(217, 91%, 60%)" strokeWidth={1} dot={false} strokeDasharray="4 2" legendType="none" />,
                  ])}
                  {showNeutralCurrent && voltageDistanceData.maxBranches.map((branch) => (
                    <Line key={`fs-max-IN-${branch.branchId}`} yAxisId="right" data={branch.points} type="monotone" dataKey="I_neutral" name={`I_N ${branch.label}`} stroke="hsl(35, 95%, 55%)" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="6 3" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </DialogContent>
          </Dialog>

          {/* Fullscreen client points */}
          <Dialog open={showClientPoints} onOpenChange={setShowClientPoints}>
            <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full overflow-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-violet-500" />
                  Tension vs Distance — Raccordements clients
                  <Badge variant="outline" className="text-[10px]">{branchementCable?.label}</Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Câble :</Label>
                <Select value={effectiveBranchementCableId} onValueChange={(v) => setSelectedBranchementCableId(v)}>
                  <SelectTrigger className="h-8 text-xs w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {branchementCableTypes.map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.label} — R={c.R_ohm_per_km} Ω/km</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(142, 76%, 36%)' }} /> OK</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(35, 95%, 55%)' }} /> &lt;218.5V</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: 'hsl(0, 75%, 55%)' }} /> &lt;207V</span>
                </div>
              </div>

              {/* Charge client chart */}
              <div className="space-y-1">
                <div className="text-xs font-medium flex items-center gap-2"><Ruler className="h-3.5 w-3.5 text-blue-500" /> Pire cas charge — {voltageDistanceData?.minHour}h</div>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" domain={[Math.floor(Math.min(200, (voltageDistanceData?.minV ?? 220) - 5)), Math.ceil(Math.max(240, (voltageDistanceData?.minV ?? 230) + 10))]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                    <Tooltip contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
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
                      <Line key={`fs-min-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltageWorstCharge > 0 && isFinite(p.voltageWorstCharge))}
                        type="monotone" dataKey="voltageWorstCharge" name={branch.label} stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    ))}
                    {clientPointsData?.minClientPoints && clientPointsData.minClientPoints.length > 0 && (
                      <Line key="fs-min-clients" yAxisId="left" data={clientPointsData.minClientPoints} type="monotone" dataKey="voltage" name="Clients"
                        stroke="none" strokeWidth={0}
                        dot={(props: any) => {
                          const { cx, cy, payload } = props;
                          if (!cx || !cy) return null;
                          return <circle cx={cx} cy={cy} r={5} fill={getClientColor(payload.voltage)} stroke="hsl(var(--background))" strokeWidth={1.5} />;
                        }}
                        legendType="diamond" connectNulls={false} isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Injection client chart */}
              <div className="space-y-1 mt-4">
                <div className="text-xs font-medium flex items-center gap-2"><Ruler className="h-3.5 w-3.5 text-emerald-500" /> Pire cas injection — {voltageDistanceData?.maxHour}h</div>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" domain={[Math.floor(Math.min(225, (voltageDistanceData?.maxV ?? 230) - 5)), Math.ceil(Math.max(245, (voltageDistanceData?.maxV ?? 235) + 5))]}
                      tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                    <Tooltip contentStyle={{ fontSize: 11, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
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
                      <Line key={`fs-max-${branch.branchId}`} yAxisId="left" data={branch.points.filter(p => p.voltageWorstInjection > 0)}
                        type="monotone" dataKey="voltageWorstInjection" name={branch.label} stroke={branch.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    ))}
                    {clientPointsData?.maxClientPoints && clientPointsData.maxClientPoints.length > 0 && (
                      <Line key="fs-max-clients" yAxisId="left" data={clientPointsData.maxClientPoints} type="monotone" dataKey="voltage" name="Clients"
                        stroke="none" strokeWidth={0}
                        dot={(props: any) => {
                          const { cx, cy, payload } = props;
                          if (!cx || !cy) return null;
                          return <circle cx={cx} cy={cy} r={5} fill={getClientColor(payload.voltage, 'injection')} stroke="hsl(var(--background))" strokeWidth={1.5} />;
                        }}
                        legendType="diamond" connectNulls={false} isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Fullscreen hourly */}
      <Dialog open={fullscreenHourlyOpen} onOpenChange={setFullscreenHourlyOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] w-full overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-amber-500" />
              Tension vs Distance — Profil horaire
              <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500">{clockHour}h</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-4">
            <div className="shrink-0 flex flex-col items-center pt-4">
              <ClockDial hour={clockHour} onChange={setClockHour} size={150} />
            </div>
            <div className="flex-1 min-w-0">
              <ResponsiveContainer width="100%" height={550}>
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis type="number" dataKey="distance_m" unit=" m" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" domain={(() => { const pts = networkPaths.flatMap(b => b.points.map(p => { const ph = getNodeVoltagePerPhase(rawContinu, p.nodeId, clockHour); return [ph.A, ph.B, ph.C].filter(v => v > 0); }).flat()); return pts.length > 0 ? [Math.floor(Math.min(...pts) - 5), Math.ceil(Math.max(...pts) + 5)] : [205, 255]; })()}
                    tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} unit=" V" />
                  {showNeutralCurrent && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit=" A" />}
                  <Tooltip contentStyle={{ fontSize: 12, backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine yAxisId="left" y={211.6} stroke="hsl(0, 72%, 51%)" strokeDasharray="6 4" strokeWidth={1} />
                  <ReferenceLine yAxisId="left" y={248.4} stroke="hsl(0, 72%, 51%)" strokeDasharray="6 4" strokeWidth={1} />
                  <ReferenceLine yAxisId="left" y={207} stroke="hsl(0, 72%, 51%)" strokeWidth={1.5} />
                  <ReferenceLine yAxisId="left" y={253} stroke="hsl(0, 72%, 51%)" strokeWidth={1.5} />
                  <ReferenceLine yAxisId="left" y={230} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} label={{ value: '230V', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  {(() => {
                    if (rawContinu.length === 0 || networkPaths.length === 0) return null;
                    return networkPaths.map((branch, idx) => {
                      const pts = branch.points.map((p) => {
                        const perPhase = getNodeVoltagePerPhase(rawContinu, p.nodeId, clockHour);
                        return { ...p, voltage: perPhase.avg, voltage_A: perPhase.A, voltage_B: perPhase.B, voltage_C: perPhase.C };
                      });
                      return (
                        <Line key={`fs-hourly-${branch.branchId}`} yAxisId="left" data={pts.filter(p => p.voltage > 0)}
                          type="monotone" dataKey="voltage" name={branch.label}
                          stroke={BRANCH_COLORS[idx % BRANCH_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      );
                    });
                  })()}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
