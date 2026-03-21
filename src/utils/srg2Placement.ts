import { CalculationResult, Project, Node, CalculationScenario, SimulationEquipment } from '@/types/network';
import { SRG2Config, DEFAULT_SRG2_400_CONFIG, DEFAULT_SRG2_230_CONFIG } from '@/types/srg2';
import { SimulationCalculator } from '@/utils/simulationCalculator';
import { findDownstreamNodesFromNode, calculateDownstreamPower } from './networkAnalysis';

export interface SRG2PlacementResult {
  nodeId: string | null;
  nodeName: string;
  score: number;
  simulation: {
    correctedNodesCount: number;
    remainingIssuesCount: number;
    correctionRate_percent: number;
    powerDownstream_kVA: number;
    powerMargin_percent: number;
    futureProofYears: number;
  };
  scenarioDetails?: {
    midiSolaire: SRG2PlacementResult['simulation'] & { score: number };
    pointeSansPV: SRG2PlacementResult['simulation'] & { score: number };
  };
  recommendation: 'install_srg2' | 'reinforce_network';
  reasoning: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCÉNARIOS DE PLACEMENT
// Un SRG2 doit fonctionner dans les 2 cas extrêmes :
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PlacementScenario {
  name: string;
  foisonnementCharges: number;
  foisonnementProductions: number;
  calculationScenario: CalculationScenario;
  description: string;
}

const PLACEMENT_SCENARIOS: PlacementScenario[] = [
  {
    name: 'midi_solaire',
    foisonnementCharges: 0,
    foisonnementProductions: 100,
    calculationScenario: 'PRODUCTION',
    description: 'Midi solaire (0% charge, 100% production) → surtensions'
  },
  {
    name: 'pointe_sans_pv',
    foisonnementCharges: 12,
    foisonnementProductions: 0,
    calculationScenario: 'PRÉLÈVEMENT',
    description: 'Pointe sans production (12% charge, 0% production) → sous-tensions'
  }
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QUALIFICATION RÉSEAU
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isNetworkSuitableForSRG2(
  project: Project,
  result: CalculationResult
): {
  suitable: boolean;
  reason: string;
  metrics: { nonCompliantNodes: number; totalNodes: number; maxVoltageDeviation_V: number };
} {
  const nodeMetrics = result.nodeMetricsPerPhase || [];
  const totalNodes = nodeMetrics.length;

  let nonCompliantCount = 0;
  let maxVoltageDeviation = 0;

  for (const nm of nodeMetrics) {
    const phases = [nm.voltagesPerPhase.A, nm.voltagesPerPhase.B, nm.voltagesPerPhase.C];
    const hasIssue = phases.some(V => V < 207 || V > 253);
    if (hasIssue) {
      nonCompliantCount++;
      const maxDeviation = Math.max(...phases.map(V => Math.abs(V - 230)));
      maxVoltageDeviation = Math.max(maxVoltageDeviation, maxDeviation);
    }
  }

  if (maxVoltageDeviation > 30) {
    return {
      suitable: false,
      reason: `Écart de tension trop important (${maxVoltageDeviation.toFixed(1)}V > 30V). Un SRG2 ±7% (±16.1V) ne peut corriger cet écart. Solution requise : renforcement câbles ou alimentation supplémentaire.`,
      metrics: { nonCompliantNodes: nonCompliantCount, totalNodes, maxVoltageDeviation_V: maxVoltageDeviation }
    };
  }

  const nonCompliantRatio = totalNodes > 0 ? nonCompliantCount / totalNodes : 0;
  if (nonCompliantRatio > 0.7) {
    return {
      suitable: false,
      reason: `${(nonCompliantRatio * 100).toFixed(0)}% des nœuds hors norme. Le problème est structurel (sous-dimensionnement réseau). Solution requise : refonte complète ou découpage en plusieurs départs.`,
      metrics: { nonCompliantNodes: nonCompliantCount, totalNodes, maxVoltageDeviation_V: maxVoltageDeviation }
    };
  }

  return {
    suitable: true,
    reason: 'Réseau compatible SRG2',
    metrics: { nonCompliantNodes: nonCompliantCount, totalNodes, maxVoltageDeviation_V: maxVoltageDeviation }
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ANALYSE D'IMPACT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function analyzeSRG2Impact(
  baseline: CalculationResult,
  withSRG2: CalculationResult,
  srg2Node: Node,
  project: Project,
  scenario: CalculationScenario
): SRG2PlacementResult['simulation'] {
  const baselineMetrics = baseline.nodeMetricsPerPhase || [];
  const srg2Metrics = withSRG2.nodeMetricsPerPhase || [];

  let beforeIssues = 0;
  const beforeIssuesList: string[] = [];
  for (const nm of baselineMetrics) {
    const phases = [
      { name: 'A', V: nm.voltagesPerPhase.A },
      { name: 'B', V: nm.voltagesPerPhase.B },
      { name: 'C', V: nm.voltagesPerPhase.C }
    ];
    const phasesHorsNorme = phases.filter(p => p.V < 207 || p.V > 253);
    if (phasesHorsNorme.length > 0) {
      beforeIssues++;
      beforeIssuesList.push(
        `${nm.nodeId}: ${phasesHorsNorme.map(p => `${p.name}=${p.V.toFixed(1)}V`).join(', ')}`
      );
    }
  }

  let afterIssues = 0;
  const afterIssuesList: string[] = [];
  for (const nm of srg2Metrics) {
    const phases = [
      { name: 'A', V: nm.voltagesPerPhase.A },
      { name: 'B', V: nm.voltagesPerPhase.B },
      { name: 'C', V: nm.voltagesPerPhase.C }
    ];
    const phasesHorsNorme = phases.filter(p => p.V < 207 || p.V > 253);
    if (phasesHorsNorme.length > 0) {
      afterIssues++;
      afterIssuesList.push(
        `${nm.nodeId}: ${phasesHorsNorme.map(p => `${p.name}=${p.V.toFixed(1)}V`).join(', ')}`
      );
    }
  }

  console.log(`   🔴 AVANT SRG2 : ${beforeIssues} nœud(s) hors norme [207-253V]`);
  beforeIssuesList.forEach(s => console.log(`      - ${s}`));
  console.log(`   🟢 APRÈS SRG2 : ${afterIssues} nœud(s) hors norme`);
  afterIssuesList.forEach(s => console.log(`      - ${s}`));

  const correctedCount = beforeIssues - afterIssues;
  
  let correctionRate: number;
  if (beforeIssues > 0) {
    correctionRate = (correctedCount / beforeIssues) * 100;
  } else {
    let baselineMaxDev = 0;
    let srg2MaxDev = 0;
    for (const nm of baselineMetrics) {
      const phases = [nm.voltagesPerPhase.A, nm.voltagesPerPhase.B, nm.voltagesPerPhase.C];
      baselineMaxDev = Math.max(baselineMaxDev, ...phases.map(V => Math.abs(V - 230)));
    }
    for (const nm of srg2Metrics) {
      const phases = [nm.voltagesPerPhase.A, nm.voltagesPerPhase.B, nm.voltagesPerPhase.C];
      srg2MaxDev = Math.max(srg2MaxDev, ...phases.map(V => Math.abs(V - 230)));
    }
    correctionRate = baselineMaxDev > 0.1 
      ? Math.min(100, ((baselineMaxDev - srg2MaxDev) / baselineMaxDev) * 100)
      : 50;
  }

  const downstreamNodes = findDownstreamNodesFromNode(project, srg2Node.id);
  const totalPower_kVA = calculateDownstreamPower(downstreamNodes, project);

  const powerLimit = scenario === 'PRODUCTION' ? 85 : 110;
  const powerMargin = (1 - Math.abs(totalPower_kVA) / powerLimit) * 100;
  const yearsToSaturation = powerMargin > 0 ? Math.floor(powerMargin / 5) : 0;

  return {
    correctedNodesCount: correctedCount,
    remainingIssuesCount: afterIssues,
    correctionRate_percent: correctionRate,
    powerDownstream_kVA: totalPower_kVA,
    powerMargin_percent: powerMargin,
    futureProofYears: yearsToSaturation
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCORING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function calculateSRG2PragmaticScore(analysis: SRG2PlacementResult['simulation'], downstreamNodeCount: number): number {
  if (analysis.powerMargin_percent < 0) {
    return 0;
  }
  
  if (downstreamNodeCount < 3) {
    return Math.min(20, analysis.correctionRate_percent * 0.2);
  }

  const correctionScore =
    analysis.correctionRate_percent >= 95 ? 100 :
    analysis.correctionRate_percent >= 90 ? 80 :
    analysis.correctionRate_percent >= 80 ? 60 :
    analysis.correctionRate_percent;

  const powerScore =
    analysis.powerMargin_percent >= 50 ? 100 :
    analysis.powerMargin_percent >= 40 ? 80 :
    analysis.powerMargin_percent >= 30 ? 50 :
    Math.max(0, analysis.powerMargin_percent * 1.5);

  const futureScore =
    analysis.futureProofYears >= 20 ? 100 :
    analysis.futureProofYears >= 10 ? 70 :
    analysis.futureProofYears >= 5 ? 40 :
    analysis.futureProofYears * 5;

  return correctionScore * 0.6 + powerScore * 0.3 + futureScore * 0.1;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RAISONNEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function generateSRG2Reasoning(
  analysis: SRG2PlacementResult['simulation'],
  node: Node,
  scenarioDetails?: SRG2PlacementResult['scenarioDetails']
): string {
  const { correctionRate_percent, remainingIssuesCount, powerMargin_percent, futureProofYears } = analysis;

  let reasoning = `Simulation multi-scénarios avec SRG2 installé sur nœud "${node.name}":\n\n`;

  // Détails par scénario si disponibles
  if (scenarioDetails) {
    reasoning += `📊 SCÉNARIO 1 — Midi solaire (0% charge, 100% PV):\n`;
    reasoning += `   Score: ${scenarioDetails.midiSolaire.score.toFixed(0)}/100`;
    reasoning += ` | Correction: ${scenarioDetails.midiSolaire.correctionRate_percent.toFixed(0)}%`;
    reasoning += ` | Marge: ${scenarioDetails.midiSolaire.powerMargin_percent.toFixed(0)}%\n`;
    reasoning += `   Nœuds restants hors norme: ${scenarioDetails.midiSolaire.remainingIssuesCount}\n\n`;

    reasoning += `📊 SCÉNARIO 2 — Pointe sans PV (12% charge, 0% PV):\n`;
    reasoning += `   Score: ${scenarioDetails.pointeSansPV.score.toFixed(0)}/100`;
    reasoning += ` | Correction: ${scenarioDetails.pointeSansPV.correctionRate_percent.toFixed(0)}%`;
    reasoning += ` | Marge: ${scenarioDetails.pointeSansPV.powerMargin_percent.toFixed(0)}%\n`;
    reasoning += `   Nœuds restants hors norme: ${scenarioDetails.pointeSansPV.remainingIssuesCount}\n\n`;

    reasoning += `🎯 SCORE FINAL (pire cas): ${analysis.correctionRate_percent.toFixed(0)}% correction, ${powerMargin_percent.toFixed(0)}% marge\n\n`;
  }

  if (correctionRate_percent >= 95) {
    reasoning += `✅ EXCELLENT : ${correctionRate_percent.toFixed(0)}% des problèmes de tension sont corrigés.\n`;
  } else if (correctionRate_percent >= 80) {
    reasoning += `⚠️ BON : ${correctionRate_percent.toFixed(0)}% des problèmes corrigés, mais ${remainingIssuesCount} nœuds restent hors norme.\n`;
  } else {
    reasoning += `❌ INSUFFISANT : Seulement ${correctionRate_percent.toFixed(0)}% des problèmes corrigés. ${remainingIssuesCount} nœuds restent hors norme.\n`;
  }

  if (powerMargin_percent >= 40) {
    reasoning += `✅ Marge de puissance : ${powerMargin_percent.toFixed(0)}% (sécurisé pour évolution future).\n`;
  } else if (powerMargin_percent >= 30) {
    reasoning += `⚠️ Marge de puissance : ${powerMargin_percent.toFixed(0)}% (juste, risque de saturation à moyen terme).\n`;
  } else {
    reasoning += `❌ Marge de puissance : ${powerMargin_percent.toFixed(0)}% (CRITIQUE : saturation imminente).\n`;
  }

  if (futureProofYears >= 10) {
    reasoning += `✅ Viabilité estimée : ${futureProofYears} ans avant saturation (croissance 5%/an).\n\n`;
  } else {
    reasoning += `⚠️ Viabilité limitée : ${futureProofYears} ans avant saturation. Risque de remplacement prématuré.\n\n`;
  }

  if (correctionRate_percent >= 95 && powerMargin_percent >= 40) {
    reasoning += `🎯 RECOMMANDATION : Installation SRG2 sur ce nœud est viable et pérenne.`;
  } else if (correctionRate_percent >= 90 && powerMargin_percent >= 30) {
    reasoning += `🤔 RECOMMANDATION : Installation SRG2 possible, mais avec réserves. Surveiller l'évolution.`;
  } else {
    reasoning += `🚫 RECOMMANDATION : SRG2 insuffisant. Solution requise : renforcement câbles ou alimentation supplémentaire.`;
  }

  return reasoning;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITAIRES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Crée une copie du projet avec des foisonnements modifiés pour un scénario de placement.
 */
function createProjectForScenario(project: Project, scenario: PlacementScenario): Project {
  return {
    ...project,
    foisonnementCharges: scenario.foisonnementCharges,
    foisonnementChargesResidentiel: scenario.foisonnementCharges,
    foisonnementChargesIndustriel: scenario.foisonnementCharges,
    foisonnementProductions: scenario.foisonnementProductions,
  };
}

/**
 * Simule un SRG2 sur un nœud pour un scénario donné et retourne le résultat + score.
 */
function simulateNodeForScenario(
  calculator: SimulationCalculator,
  project: Project,
  candidate: Node,
  placementScenario: PlacementScenario,
  srg2Config: SRG2Config,
): { baseline: CalculationResult; withSRG2: CalculationResult; analysis: SRG2PlacementResult['simulation']; score: number } | null {
  const scenarioProject = createProjectForScenario(project, placementScenario);
  const scenario = placementScenario.calculationScenario;

  // Baseline sans SRG2
  const baselineCalc = new SimulationCalculator(
    project.cosPhi,
    project.cosPhiCharges,
    project.cosPhiProductions
  );
  const emptyEquipment: SimulationEquipment = {
    srg2Devices: [],
    neutralCompensators: [],
    cableUpgrades: [],
  };
  let baseline: CalculationResult;
  try {
    baseline = baselineCalc.calculateWithSimulation(scenarioProject, scenario, emptyEquipment);
  } catch (error) {
    console.warn(`   ⚠️ Échec baseline ${placementScenario.name}:`, error);
    return null;
  }

  // Avec SRG2
  const equipment: SimulationEquipment = {
    srg2Devices: [srg2Config],
    neutralCompensators: [],
    cableUpgrades: [],
  };
  let withSRG2: CalculationResult;
  try {
    withSRG2 = calculator.calculateWithSimulation(scenarioProject, scenario, equipment);
  } catch (error) {
    console.warn(`   ⚠️ Échec simulation SRG2 ${placementScenario.name}:`, error);
    return null;
  }

  const analysis = analyzeSRG2Impact(baseline, withSRG2, candidate, scenarioProject, scenario);
  const downstreamNodes = findDownstreamNodesFromNode(project, candidate.id);
  const score = calculateSRG2PragmaticScore(analysis, downstreamNodes.length);

  return { baseline, withSRG2, analysis, score };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ALGORITHME PRINCIPAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Trouve l'emplacement optimal pour un SRG2 via simulation exhaustive MULTI-SCÉNARIOS.
 * 
 * Chaque nœud candidat est testé contre 2 scénarios extrêmes :
 * 1. Midi solaire (0% charge, 100% PV) → détecte les surtensions
 * 2. Pointe sans PV (12% charge, 0% PV) → détecte les sous-tensions
 * 
 * Le score final est le MINIMUM des 2 scénarios (pire cas).
 * Un SRG2 doit fonctionner dans les deux cas pour être recommandé.
 */
export function findOptimalSRG2Node(
  project: Project,
  baselineResult: CalculationResult,
  scenario: CalculationScenario,
  onProgress?: (current: number, total: number) => void
): SRG2PlacementResult {
  console.log('🎯 === DÉBUT ANALYSE PLACEMENT OPTIMAL SRG2 (MULTI-SCÉNARIOS) ===');
  console.log(`   Scénarios testés:`);
  PLACEMENT_SCENARIOS.forEach(s => console.log(`   - ${s.description}`));

  // Qualification réseau sur le scénario le plus critique
  // On teste les 2 scénarios pour la qualification
  let worstSuitability: ReturnType<typeof isNetworkSuitableForSRG2> | null = null;

  for (const ps of PLACEMENT_SCENARIOS) {
    const scenarioProject = createProjectForScenario(project, ps);
    const calc = new SimulationCalculator(project.cosPhi, project.cosPhiCharges, project.cosPhiProductions);
    const emptyEquipment: SimulationEquipment = { srg2Devices: [], neutralCompensators: [], cableUpgrades: [] };
    
    let scenarioBaseline: CalculationResult;
    try {
      scenarioBaseline = calc.calculateWithSimulation(scenarioProject, ps.calculationScenario, emptyEquipment);
    } catch {
      console.warn(`   ⚠️ Échec baseline qualification pour ${ps.name}`);
      continue;
    }

    const suitability = isNetworkSuitableForSRG2(scenarioProject, scenarioBaseline);
    console.log(`   📋 Qualification ${ps.name}: ${suitability.suitable ? '✅' : '❌'} (${suitability.metrics.nonCompliantNodes} nœuds hors norme, max déviation ${suitability.metrics.maxVoltageDeviation_V.toFixed(1)}V)`);

    // Si un scénario dit "non compatible" avec écart > 30V, c'est éliminatoire
    if (!suitability.suitable && suitability.metrics.maxVoltageDeviation_V > 30) {
      console.log(`❌ Réseau non compatible SRG2 (${ps.name}):`, suitability.reason);
      return {
        nodeId: null,
        nodeName: 'N/A',
        score: 0,
        simulation: {
          correctedNodesCount: 0,
          remainingIssuesCount: suitability.metrics.nonCompliantNodes,
          correctionRate_percent: 0,
          powerDownstream_kVA: 0,
          powerMargin_percent: 0,
          futureProofYears: 0
        },
        recommendation: 'reinforce_network',
        reasoning: `[${ps.description}] ${suitability.reason}`
      };
    }

    if (!worstSuitability || suitability.metrics.nonCompliantNodes > worstSuitability.metrics.nonCompliantNodes) {
      worstSuitability = suitability;
    }
  }

  if (worstSuitability && !worstSuitability.suitable) {
    console.log('❌ Réseau non compatible SRG2:', worstSuitability.reason);
    return {
      nodeId: null,
      nodeName: 'N/A',
      score: 0,
      simulation: {
        correctedNodesCount: 0,
        remainingIssuesCount: worstSuitability.metrics.nonCompliantNodes,
        correctionRate_percent: 0,
        powerDownstream_kVA: 0,
        powerMargin_percent: 0,
        futureProofYears: 0
      },
      recommendation: 'reinforce_network',
      reasoning: worstSuitability.reason
    };
  }

  console.log(`✅ Réseau compatible SRG2 sur les 2 scénarios`);

  const candidates = project.nodes.filter(n => !n.isSource);

  // === DIAGNOSTIC: Top 10 candidats ===
  console.log('\n📊 DIAGNOSTIC PLACEMENT SRG2: Top 10 candidats\n');
  for (const candidate of candidates.slice(0, 10)) {
    const downstreamNodes = findDownstreamNodesFromNode(project, candidate.id);
    const downstreamPower = calculateDownstreamPower(downstreamNodes, project);
    console.log(`  ${candidate.name}: ${downstreamNodes.length} nœuds aval, ${downstreamPower.toFixed(1)} kVA`);
  }
  console.log('');

  let bestCandidate: SRG2PlacementResult | null = null;
  let bestScore = 0;

  const calculator = new SimulationCalculator(
    project.cosPhi,
    project.cosPhiCharges,
    project.cosPhiProductions
  );

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    onProgress?.(i + 1, candidates.length);

    console.log(`\n🔍 [SRG2 PLACEMENT] Test nœud "${candidate.name}" (ID: ${candidate.id})`);

    const defaultConfig = project.voltageSystem === 'TÉTRAPHASÉ_400V'
      ? DEFAULT_SRG2_400_CONFIG
      : DEFAULT_SRG2_230_CONFIG;

    const srg2Config: SRG2Config = {
      ...defaultConfig,
      id: `srg2-placement-${candidate.id}`,
      nodeId: candidate.id,
      name: `SRG2 Test ${candidate.name}`,
      enabled: true,
    } as SRG2Config;

    // ━━━ Simuler les 2 scénarios ━━━
    const scenarioResults: Array<{
      name: string;
      analysis: SRG2PlacementResult['simulation'];
      score: number;
    }> = [];

    let allScenariosOK = true;

    for (const ps of PLACEMENT_SCENARIOS) {
      console.log(`   📋 Scénario: ${ps.description}`);
      
      const result = simulateNodeForScenario(calculator, project, candidate, ps, srg2Config);
      
      if (!result) {
        allScenariosOK = false;
        break;
      }

      console.log(`      Score: ${result.score.toFixed(1)}/100 | Correction: ${result.analysis.correctionRate_percent.toFixed(0)}% | Marge: ${result.analysis.powerMargin_percent.toFixed(0)}%`);

      scenarioResults.push({
        name: ps.name,
        analysis: result.analysis,
        score: result.score,
      });
    }

    if (!allScenariosOK || scenarioResults.length < 2) {
      console.warn(`   ⚠️ Nœud ${candidate.name} : un scénario a échoué, ignoré`);
      continue;
    }

    // Score final = MINIMUM des 2 scénarios (pire cas)
    const midiResult = scenarioResults.find(r => r.name === 'midi_solaire')!;
    const pointeResult = scenarioResults.find(r => r.name === 'pointe_sans_pv')!;
    const worstScore = Math.min(midiResult.score, pointeResult.score);
    const worstAnalysis = midiResult.score <= pointeResult.score ? midiResult.analysis : pointeResult.analysis;

    console.log(`   🎯 Score final (pire cas): ${worstScore.toFixed(1)}/100`);
    console.log(`      - Midi solaire: ${midiResult.score.toFixed(1)}/100`);
    console.log(`      - Pointe sans PV: ${pointeResult.score.toFixed(1)}/100`);

    if (worstScore > bestScore) {
      bestScore = worstScore;

      const scenarioDetails = {
        midiSolaire: { ...midiResult.analysis, score: midiResult.score },
        pointeSansPV: { ...pointeResult.analysis, score: pointeResult.score },
      };

      bestCandidate = {
        nodeId: candidate.id,
        nodeName: candidate.name,
        score: worstScore,
        simulation: worstAnalysis,
        scenarioDetails,
        recommendation: (worstAnalysis.correctionRate_percent >= 95 && worstAnalysis.powerMargin_percent >= 40)
          ? 'install_srg2'
          : 'reinforce_network',
        reasoning: generateSRG2Reasoning(worstAnalysis, candidate, scenarioDetails)
      };
    }
  }

  if (!bestCandidate) {
    console.log('❌ Aucun nœud viable trouvé pour SRG2');
    return {
      nodeId: null,
      nodeName: 'Aucun emplacement viable',
      score: 0,
      simulation: {
        correctedNodesCount: 0,
        remainingIssuesCount: 0,
        correctionRate_percent: 0,
        powerDownstream_kVA: 0,
        powerMargin_percent: 0,
        futureProofYears: 0
      },
      recommendation: 'reinforce_network',
      reasoning: 'Aucun emplacement ne permet de corriger ≥95% des problèmes dans les 2 scénarios (midi solaire + pointe sans PV).'
    };
  }

  console.log(`\n🎯 === RÉSULTAT FINAL PLACEMENT SRG2 (MULTI-SCÉNARIOS) ===`);
  console.log(`   Nœud sélectionné : "${bestCandidate.nodeName}" (ID: ${bestCandidate.nodeId})`);
  console.log(`   Score (pire cas) : ${bestCandidate.score.toFixed(0)}/100`);
  console.log(`   Recommandation : ${bestCandidate.recommendation}`);
  if (bestCandidate.scenarioDetails) {
    console.log(`   Détails:`);
    console.log(`      Midi solaire : ${bestCandidate.scenarioDetails.midiSolaire.score.toFixed(0)}/100 (correction ${bestCandidate.scenarioDetails.midiSolaire.correctionRate_percent.toFixed(0)}%, marge ${bestCandidate.scenarioDetails.midiSolaire.powerMargin_percent.toFixed(0)}%)`);
    console.log(`      Pointe sans PV : ${bestCandidate.scenarioDetails.pointeSansPV.score.toFixed(0)}/100 (correction ${bestCandidate.scenarioDetails.pointeSansPV.correctionRate_percent.toFixed(0)}%, marge ${bestCandidate.scenarioDetails.pointeSansPV.powerMargin_percent.toFixed(0)}%)`);
  }
  console.log(`🎯 ================================================\n`);

  return bestCandidate;
}
