import { CalculationResult, Project, Node, CalculationScenario, NeutralCompensator, SimulationEquipment } from '@/types/network';
import { SimulationCalculator } from '@/utils/simulationCalculator';
import { findDownstreamNodesFromNode, calculateDownstreamPower, calculateNeutralCurrent, calculateImbalance } from './networkAnalysis';

export interface EQUI8PlacementResult {
  nodeId: string | null;
  nodeName: string;
  score: number;
  simulation: {
    neutralCurrentReduction_A: number;
    neutralCurrentReductionRate_percent: number;
    avgImbalanceReduction_percent: number;
    powerDownstream_kVA: number;
    powerMargin_percent: number;
    futureProofYears: number;
    beforeMetrics: { maxNeutralCurrent_A: number; avgImbalance_percent: number };
    afterMetrics: { maxNeutralCurrent_A: number; avgImbalance_percent: number };
  };
  recommendation: 'install_equi8' | 'manual_rebalancing' | 'network_reinforcement';
  reasoning: string;
}

function isNetworkSuitableForEQUI8(
  project: Project,
  result: CalculationResult
): {
  suitable: boolean;
  reason: string;
  metrics: { maxNeutralCurrent_A: number; avgImbalance_percent: number; nodesWithHighImbalance: number; totalNodes: number };
} {
  // EQUI8 only works on 400V networks
  if (project.voltageSystem !== 'TÉTRAPHASÉ_400V') {
    return {
      suitable: false,
      reason: 'EQUI8 nécessite un réseau 400V (tétraphasé). Le réseau actuel est en 230V.',
      metrics: { maxNeutralCurrent_A: 0, avgImbalance_percent: 0, nodesWithHighImbalance: 0, totalNodes: 0 }
    };
  }

  const nodeMetrics = result.nodeMetricsPerPhase || [];
  const totalNodes = nodeMetrics.length;
  if (totalNodes === 0) {
    return {
      suitable: false,
      reason: 'Aucun nœud avec métriques de phase disponibles.',
      metrics: { maxNeutralCurrent_A: 0, avgImbalance_percent: 0, nodesWithHighImbalance: 0, totalNodes: 0 }
    };
  }

  let maxNeutralCurrent = 0;
  let totalImbalance = 0;
  let nodesWithHighImbalance = 0;

  for (const nm of nodeMetrics) {
    const I_neutral = calculateNeutralCurrent(nm as any);
    maxNeutralCurrent = Math.max(maxNeutralCurrent, I_neutral);
    const imbalance = calculateImbalance(nm as any);
    totalImbalance += imbalance;
    if (imbalance > 20) nodesWithHighImbalance++;
  }

  const avgImbalance = totalImbalance / totalNodes;

  if (avgImbalance < 10) {
    return {
      suitable: false,
      reason: `Déséquilibre moyen trop faible (${avgImbalance.toFixed(1)}% < 10%). Le réseau est déjà relativement équilibré. EQUI8 n'apporterait pas de gain significatif.`,
      metrics: { maxNeutralCurrent_A: maxNeutralCurrent, avgImbalance_percent: avgImbalance, nodesWithHighImbalance, totalNodes }
    };
  }

  const highImbalanceRatio = nodesWithHighImbalance / totalNodes;
  if (highImbalanceRatio < 0.2) {
    return {
      suitable: false,
      reason: `Seulement ${(highImbalanceRatio * 100).toFixed(0)}% des nœuds ont un déséquilibre significatif. Le problème est trop localisé. Solution recommandée : rééquilibrage manuel des phases.`,
      metrics: { maxNeutralCurrent_A: maxNeutralCurrent, avgImbalance_percent: avgImbalance, nodesWithHighImbalance, totalNodes }
    };
  }

  if (maxNeutralCurrent < 10) {
    return {
      suitable: false,
      reason: `Courant neutre maximal trop faible (${maxNeutralCurrent.toFixed(1)}A < 10A). L'impact d'un EQUI8 serait négligeable.`,
      metrics: { maxNeutralCurrent_A: maxNeutralCurrent, avgImbalance_percent: avgImbalance, nodesWithHighImbalance, totalNodes }
    };
  }

  return {
    suitable: true,
    reason: 'Réseau compatible EQUI8',
    metrics: { maxNeutralCurrent_A: maxNeutralCurrent, avgImbalance_percent: avgImbalance, nodesWithHighImbalance, totalNodes }
  };
}

function analyzeEQUI8Impact(
  baseline: CalculationResult,
  withEQUI8: CalculationResult,
  equi8Node: Node,
  project: Project,
  scenario: CalculationScenario
): EQUI8PlacementResult['simulation'] {
  const baselineMetrics = baseline.nodeMetricsPerPhase || [];
  const equi8Metrics = withEQUI8.nodeMetricsPerPhase || [];

  let beforeMaxNeutral = 0, beforeTotalImbalance = 0;
  for (const nm of baselineMetrics) {
    beforeMaxNeutral = Math.max(beforeMaxNeutral, calculateNeutralCurrent(nm as any));
    beforeTotalImbalance += calculateImbalance(nm as any);
  }
  const beforeAvgImbalance = baselineMetrics.length > 0 ? beforeTotalImbalance / baselineMetrics.length : 0;

  let afterMaxNeutral = 0, afterTotalImbalance = 0;
  for (const nm of equi8Metrics) {
    afterMaxNeutral = Math.max(afterMaxNeutral, calculateNeutralCurrent(nm as any));
    afterTotalImbalance += calculateImbalance(nm as any);
  }
  const afterAvgImbalance = equi8Metrics.length > 0 ? afterTotalImbalance / equi8Metrics.length : 0;

  const neutralReduction_A = beforeMaxNeutral - afterMaxNeutral;
  const neutralReductionRate = beforeMaxNeutral > 0 ? (neutralReduction_A / beforeMaxNeutral) * 100 : 0;
  const imbalanceReductionRate = beforeAvgImbalance > 0
    ? ((beforeAvgImbalance - afterAvgImbalance) / beforeAvgImbalance) * 100 : 0;

  const downstreamNodes = findDownstreamNodesFromNode(project, equi8Node.id);
  const totalPower_kVA = calculateDownstreamPower(downstreamNodes, project);

  const powerLimit = scenario === 'PRODUCTION' ? 85 : 110;
  const powerMargin = (1 - Math.abs(totalPower_kVA) / powerLimit) * 100;
  const yearsToSaturation = powerMargin > 0 ? Math.floor(powerMargin / 5) : 0;

  return {
    neutralCurrentReduction_A: neutralReduction_A,
    neutralCurrentReductionRate_percent: neutralReductionRate,
    avgImbalanceReduction_percent: imbalanceReductionRate,
    powerDownstream_kVA: totalPower_kVA,
    powerMargin_percent: powerMargin,
    futureProofYears: yearsToSaturation,
    beforeMetrics: { maxNeutralCurrent_A: beforeMaxNeutral, avgImbalance_percent: beforeAvgImbalance },
    afterMetrics: { maxNeutralCurrent_A: afterMaxNeutral, avgImbalance_percent: afterAvgImbalance }
  };
}

function calculateEQUI8PragmaticScore(analysis: EQUI8PlacementResult['simulation']): number {
  const neutralScore =
    analysis.neutralCurrentReductionRate_percent >= 80 ? 100 :
    analysis.neutralCurrentReductionRate_percent >= 70 ? 85 :
    analysis.neutralCurrentReductionRate_percent >= 60 ? 65 :
    analysis.neutralCurrentReductionRate_percent >= 50 ? 50 :
    Math.max(0, analysis.neutralCurrentReductionRate_percent * 0.8);

  const imbalanceScore =
    analysis.avgImbalanceReduction_percent >= 50 ? 100 :
    analysis.avgImbalanceReduction_percent >= 40 ? 80 :
    analysis.avgImbalanceReduction_percent >= 30 ? 60 :
    Math.max(0, analysis.avgImbalanceReduction_percent * 2);

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

  return neutralScore * 0.5 + imbalanceScore * 0.2 + powerScore * 0.2 + futureScore * 0.1;
}

function generateEQUI8Reasoning(analysis: EQUI8PlacementResult['simulation'], node: Node): string {
  const {
    neutralCurrentReductionRate_percent,
    avgImbalanceReduction_percent,
    powerMargin_percent,
    futureProofYears,
    beforeMetrics,
    afterMetrics
  } = analysis;

  let reasoning = `Simulation complète avec EQUI8 installé sur nœud "${node.name}":\n\n`;

  reasoning += `📊 COURANT NEUTRE:\n`;
  reasoning += `- Avant EQUI8 : ${beforeMetrics.maxNeutralCurrent_A.toFixed(1)}A\n`;
  reasoning += `- Après EQUI8 : ${afterMetrics.maxNeutralCurrent_A.toFixed(1)}A\n`;

  if (neutralCurrentReductionRate_percent >= 70) {
    reasoning += `✅ EXCELLENT : Réduction de ${neutralCurrentReductionRate_percent.toFixed(0)}% du courant neutre.\n\n`;
  } else if (neutralCurrentReductionRate_percent >= 50) {
    reasoning += `⚠️ MOYEN : Réduction de ${neutralCurrentReductionRate_percent.toFixed(0)}% seulement.\n\n`;
  } else {
    reasoning += `❌ INSUFFISANT : Réduction de ${neutralCurrentReductionRate_percent.toFixed(0)}% seulement (objectif ≥70%).\n\n`;
  }

  reasoning += `📊 DÉSÉQUILIBRE TRIPHASÉ:\n`;
  reasoning += `- Avant EQUI8 : ${beforeMetrics.avgImbalance_percent.toFixed(1)}%\n`;
  reasoning += `- Après EQUI8 : ${afterMetrics.avgImbalance_percent.toFixed(1)}%\n`;
  reasoning += `- Amélioration : ${avgImbalanceReduction_percent.toFixed(0)}%\n\n`;

  if (powerMargin_percent >= 40) {
    reasoning += `✅ Marge de puissance : ${powerMargin_percent.toFixed(0)}% (sécurisé).\n`;
  } else if (powerMargin_percent >= 30) {
    reasoning += `⚠️ Marge de puissance : ${powerMargin_percent.toFixed(0)}% (juste).\n`;
  } else {
    reasoning += `❌ Marge de puissance : ${powerMargin_percent.toFixed(0)}% (CRITIQUE).\n`;
  }

  if (futureProofYears >= 10) {
    reasoning += `✅ Viabilité estimée : ${futureProofYears} ans.\n\n`;
  } else {
    reasoning += `⚠️ Viabilité limitée : ${futureProofYears} ans.\n\n`;
  }

  if (neutralCurrentReductionRate_percent >= 70 && powerMargin_percent >= 40) {
    reasoning += `🎯 RECOMMANDATION : Installation EQUI8 viable et pérenne.`;
  } else if (neutralCurrentReductionRate_percent >= 70 && powerMargin_percent < 40) {
    reasoning += `⚠️ RECOMMANDATION : EQUI8 efficace MAIS puissance limite. Renforcement recommandé en complément.`;
  } else if (neutralCurrentReductionRate_percent < 70 && powerMargin_percent >= 40) {
    reasoning += `🤔 RECOMMANDATION : Efficacité EQUI8 limitée. Envisager rééquilibrage manuel.`;
  } else {
    reasoning += `🚫 RECOMMANDATION : EQUI8 non viable. Rééquilibrage manuel ou renforcement réseau requis.`;
  }

  return reasoning;
}

/**
 * Trouve l'emplacement optimal pour un EQUI8 via simulation exhaustive.
 */
export function findOptimalEQUI8PlacementNode(
  project: Project,
  baselineResult: CalculationResult,
  scenario: CalculationScenario,
  onProgress?: (current: number, total: number) => void
): EQUI8PlacementResult {
  console.log('🎯 === DÉBUT ANALYSE PLACEMENT OPTIMAL EQUI8 ===');

  const suitability = isNetworkSuitableForEQUI8(project, baselineResult);

  if (!suitability.suitable) {
    console.log('❌ Réseau non compatible EQUI8:', suitability.reason);
    return {
      nodeId: null,
      nodeName: 'N/A',
      score: 0,
      simulation: {
        neutralCurrentReduction_A: 0,
        neutralCurrentReductionRate_percent: 0,
        avgImbalanceReduction_percent: 0,
        powerDownstream_kVA: 0,
        powerMargin_percent: 0,
        futureProofYears: 0,
        beforeMetrics: { maxNeutralCurrent_A: suitability.metrics.maxNeutralCurrent_A, avgImbalance_percent: suitability.metrics.avgImbalance_percent },
        afterMetrics: { maxNeutralCurrent_A: suitability.metrics.maxNeutralCurrent_A, avgImbalance_percent: suitability.metrics.avgImbalance_percent }
      },
      recommendation: 'manual_rebalancing',
      reasoning: suitability.reason
    };
  }

  console.log(`✅ Réseau compatible EQUI8 (déséq moyen: ${suitability.metrics.avgImbalance_percent.toFixed(1)}%)`);

  const candidates = project.nodes.filter(n => !n.isSource);
  let bestCandidate: EQUI8PlacementResult | null = null;
  let bestScore = 0;

  const calculator = new SimulationCalculator(
    project.cosPhi,
    project.cosPhiCharges,
    project.cosPhiProductions
  );

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    onProgress?.(i + 1, candidates.length);

    console.log(`\n🔍 Test EQUI8 nœud "${candidate.name}" (${candidate.id})`);

    const equi8Config: NeutralCompensator = {
      id: `equi8-placement-${candidate.id}`,
      nodeId: candidate.id,
      enabled: true,
      mode: 'CME',
      maxPower_kVA: 20,
      tolerance_A: 2,
      Zph_Ohm: 0.5,
      Zn_Ohm: 0.2,
      thermalWindow: 'permanent',
    };

    const equipment: SimulationEquipment = {
      srg2Devices: [],
      neutralCompensators: [equi8Config],
      cableUpgrades: [],
    };

    let resultWithEQUI8: CalculationResult;
    try {
      const simResult = calculator.calculateWithSimulation(project, scenario, equipment);
      resultWithEQUI8 = simResult;
    } catch (error) {
      console.warn(`⚠️ Échec simulation EQUI8 sur nœud ${candidate.id}:`, error);
      continue;
    }

    const analysis = analyzeEQUI8Impact(baselineResult, resultWithEQUI8, candidate, project, scenario);
    const score = calculateEQUI8PragmaticScore(analysis);

    console.log(`   📊 Score : ${score.toFixed(1)}/100 (réd.neutre: ${analysis.neutralCurrentReductionRate_percent.toFixed(0)}%, réd.déséq: ${analysis.avgImbalanceReduction_percent.toFixed(0)}%)`);

    if (score > bestScore) {
      bestScore = score;

      const goodReduction = analysis.neutralCurrentReductionRate_percent >= 70;
      const goodMargin = analysis.powerMargin_percent >= 40;
      const goodViability = analysis.futureProofYears >= 10;

      let recommendation: EQUI8PlacementResult['recommendation'];
      if (goodReduction && goodMargin && goodViability) {
        recommendation = 'install_equi8';
      } else if (goodReduction && !goodMargin) {
        recommendation = 'network_reinforcement';
      } else {
        recommendation = 'manual_rebalancing';
      }

      bestCandidate = {
        nodeId: candidate.id,
        nodeName: candidate.name,
        score,
        simulation: analysis,
        recommendation,
        reasoning: generateEQUI8Reasoning(analysis, candidate)
      };
    }
  }

  if (!bestCandidate) {
    console.log('❌ Aucun nœud viable trouvé pour EQUI8');
    return {
      nodeId: null,
      nodeName: 'Aucun emplacement viable',
      score: 0,
      simulation: {
        neutralCurrentReduction_A: 0,
        neutralCurrentReductionRate_percent: 0,
        avgImbalanceReduction_percent: 0,
        powerDownstream_kVA: 0,
        powerMargin_percent: 0,
        futureProofYears: 0,
        beforeMetrics: { maxNeutralCurrent_A: suitability.metrics.maxNeutralCurrent_A, avgImbalance_percent: suitability.metrics.avgImbalance_percent },
        afterMetrics: { maxNeutralCurrent_A: suitability.metrics.maxNeutralCurrent_A, avgImbalance_percent: suitability.metrics.avgImbalance_percent }
      },
      recommendation: 'manual_rebalancing',
      reasoning: 'Aucun emplacement ne permet de réduire le courant neutre de ≥70% avec une marge de puissance ≥40%.'
    };
  }

  console.log(`\n🎯 Meilleur emplacement EQUI8 : "${bestCandidate.nodeName}" (score: ${bestCandidate.score.toFixed(0)}/100)`);
  console.log('🎯 === FIN ANALYSE PLACEMENT OPTIMAL EQUI8 ===\n');

  return bestCandidate;
}
