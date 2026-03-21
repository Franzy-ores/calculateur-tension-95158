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
  recommendation: 'install_srg2' | 'reinforce_network';
  reasoning: string;
}

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
    const avgV = (nm.voltagesPerPhase.A + nm.voltagesPerPhase.B + nm.voltagesPerPhase.C) / 3;
    if (avgV < 207 || avgV > 253) {
      nonCompliantCount++;
      const deviation = avgV < 230 ? (230 - avgV) : (avgV - 230);
      maxVoltageDeviation = Math.max(maxVoltageDeviation, deviation);
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
  for (const nm of baselineMetrics) {
    const avgV = (nm.voltagesPerPhase.A + nm.voltagesPerPhase.B + nm.voltagesPerPhase.C) / 3;
    if (avgV < 207 || avgV > 253) beforeIssues++;
  }

  let afterIssues = 0;
  for (const nm of srg2Metrics) {
    const avgV = (nm.voltagesPerPhase.A + nm.voltagesPerPhase.B + nm.voltagesPerPhase.C) / 3;
    if (avgV < 207 || avgV > 253) afterIssues++;
  }

  const correctedCount = beforeIssues - afterIssues;
  
  // Si pas de nœuds hors norme, évaluer par amélioration de tension (pas 100% par défaut)
  let correctionRate: number;
  if (beforeIssues > 0) {
    correctionRate = (correctedCount / beforeIssues) * 100;
  } else {
    // Calculer l'amélioration de la tension max deviation
    let baselineMaxDev = 0;
    let srg2MaxDev = 0;
    for (const nm of baselineMetrics) {
      const avgV = (nm.voltagesPerPhase.A + nm.voltagesPerPhase.B + nm.voltagesPerPhase.C) / 3;
      baselineMaxDev = Math.max(baselineMaxDev, Math.abs(avgV - 230));
    }
    for (const nm of srg2Metrics) {
      const avgV = (nm.voltagesPerPhase.A + nm.voltagesPerPhase.B + nm.voltagesPerPhase.C) / 3;
      srg2MaxDev = Math.max(srg2MaxDev, Math.abs(avgV - 230));
    }
    // Score basé sur l'amélioration relative de la déviation max
    correctionRate = baselineMaxDev > 0.1 
      ? Math.min(100, ((baselineMaxDev - srg2MaxDev) / baselineMaxDev) * 100)
      : 50; // Score neutre si tension déjà parfaite
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

function calculateSRG2PragmaticScore(analysis: SRG2PlacementResult['simulation']): number {
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

function generateSRG2Reasoning(analysis: SRG2PlacementResult['simulation'], node: Node): string {
  const { correctionRate_percent, remainingIssuesCount, powerMargin_percent, futureProofYears } = analysis;

  let reasoning = `Simulation complète avec SRG2 installé sur nœud "${node.name}":\n\n`;

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

/**
 * Trouve l'emplacement optimal pour un SRG2 via simulation exhaustive.
 */
export function findOptimalSRG2Node(
  project: Project,
  baselineResult: CalculationResult,
  scenario: CalculationScenario,
  onProgress?: (current: number, total: number) => void
): SRG2PlacementResult {
  console.log('🎯 === DÉBUT ANALYSE PLACEMENT OPTIMAL SRG2 ===');

  const suitability = isNetworkSuitableForSRG2(project, baselineResult);

  if (!suitability.suitable) {
    console.log('❌ Réseau non compatible SRG2:', suitability.reason);
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
      reasoning: suitability.reason
    };
  }

  console.log(`✅ Réseau compatible SRG2 (${suitability.metrics.nonCompliantNodes} nœuds hors norme)`);

  const candidates = project.nodes.filter(n => !n.isSource);

  // === DIAGNOSTIC: Vérifier le nombre de nœuds aval et la puissance ===
  console.log('\n📊 DIAGNOSTIC PLACEMENT SRG2: Top 10 candidats\n');
  for (const candidate of candidates.slice(0, 10)) {
    const downstreamNodes = findDownstreamNodesFromNode(project, candidate.id);
    const downstreamPower = calculateDownstreamPower(downstreamNodes, project);
    const powerLimit = scenario === 'PRODUCTION' ? 85 : 110;
    const margin = downstreamPower > 0 ? ((powerLimit - downstreamPower) / powerLimit * 100) : 100;
    console.log(`  ${candidate.name}:`);
    console.log(`    - Nœuds aval: ${downstreamNodes.length}`);
    console.log(`    - Puissance aval: ${downstreamPower.toFixed(1)} kVA`);
    console.log(`    - Marge: ${margin.toFixed(0)}% ${margin < 40 ? '⚠️ INSUFFISANT' : '✅'}`);
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

    const equipment: SimulationEquipment = {
      srg2Devices: [srg2Config],
      neutralCompensators: [],
      cableUpgrades: [],
    };

    let resultWithSRG2: CalculationResult;
    try {
      const simResult = calculator.calculateWithSimulation(project, scenario, equipment);
      resultWithSRG2 = simResult;
    } catch (error) {
      console.warn(`⚠️ Échec simulation SRG2 sur nœud ${candidate.id}:`, error);
      continue;
    }

    const analysis = analyzeSRG2Impact(baselineResult, resultWithSRG2, candidate, project, scenario);
    const score = calculateSRG2PragmaticScore(analysis);

    console.log(`   📊 Score : ${score.toFixed(1)}/100`);
    console.log(`      - Correction : ${analysis.correctionRate_percent.toFixed(0)}%`);
    console.log(`      - Marge puissance : ${analysis.powerMargin_percent.toFixed(0)}%`);
    console.log(`      - Puissance aval : ${analysis.powerDownstream_kVA.toFixed(1)} kVA`);
    console.log(`      - Viabilité : ${analysis.futureProofYears} ans`);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = {
        nodeId: candidate.id,
        nodeName: candidate.name,
        score,
        simulation: analysis,
        recommendation: (analysis.correctionRate_percent >= 95 && analysis.powerMargin_percent >= 40)
          ? 'install_srg2'
          : 'reinforce_network',
        reasoning: generateSRG2Reasoning(analysis, candidate)
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
        remainingIssuesCount: suitability.metrics.nonCompliantNodes,
        correctionRate_percent: 0,
        powerDownstream_kVA: 0,
        powerMargin_percent: 0,
        futureProofYears: 0
      },
      recommendation: 'reinforce_network',
      reasoning: 'Aucun emplacement ne permet de corriger ≥95% des problèmes de tension avec une marge de puissance ≥40%.'
    };
  }

  console.log(`\n🎯 === RÉSULTAT FINAL PLACEMENT SRG2 ===`);
  console.log(`   Nœud sélectionné : "${bestCandidate.nodeName}" (ID: ${bestCandidate.nodeId})`);
  console.log(`   Score : ${bestCandidate.score.toFixed(0)}/100`);
  console.log(`   Recommandation : ${bestCandidate.recommendation}`);
  console.log(`   Métriques:`);
  console.log(`      - Correction : ${bestCandidate.simulation.correctionRate_percent.toFixed(0)}%`);
  console.log(`      - Puissance aval : ${bestCandidate.simulation.powerDownstream_kVA.toFixed(1)} kVA`);
  console.log(`      - Marge puissance : ${bestCandidate.simulation.powerMargin_percent.toFixed(0)}%`);
  console.log(`      - Viabilité : ${bestCandidate.simulation.futureProofYears} ans`);
  console.log(`🎯 ================================================\n`);

  return bestCandidate;
}
