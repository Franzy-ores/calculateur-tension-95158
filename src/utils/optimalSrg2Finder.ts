/**
 * ============================================================================
 * OPTIMAL SRG2 NODE FINDER - DOWNSTREAM IMPACT BASED
 * ============================================================================
 * 
 * Analyse automatique du réseau pour trouver le nœud optimal de mesure
 * pour un régulateur de tension SRG2, basée sur l'impact réseau aval.
 * 
 * 🧠 PRINCIPE PHYSIQUE:
 * Le SRG2 doit être placé sur un nœud qui maximise le nombre de nœuds
 * hors norme EN50160 qui rentrent dans la norme après régulation.
 * 
 * CRITÈRES DE SÉLECTION:
 * 1. Distance ≤ 250m de la source (placement proche du poste)
 * 2. Maximiser le taux de correction des nœuds hors norme EN50160
 * 
 * SCORE = (noeuds_corrigés / noeuds_hors_norme_aval) * 100
 * Le nœud optimal est celui qui MAXIMISE ce score.
 * 
 * ============================================================================
 */

import { Project, Node, Cable, CableType, CalculationResult } from '@/types/network';

// Distance maximale depuis la source (m)
const MAX_DISTANCE_FROM_SOURCE_M = 250;

// Limites EN50160 pour un réseau 230V
const VOLTAGE_MIN_EN50160 = 207; // -10% de 230V
const VOLTAGE_MAX_EN50160 = 253; // +10% de 230V

// Tension cible pour la régulation SRG2
const TARGET_VOLTAGE_V = 230;

// Coefficients max du SRG2 (±7% pour les positions LO2/BO2)
const MAX_SRG2_BOOST_PERCENT = 7;

export interface OptimalSRG2Result {
  /** ID du nœud optimal */
  nodeId: string;
  /** Nom du nœud */
  nodeName: string;
  /** Distance depuis la source (m) */
  distanceFromSource_m: number;
  
  /** Nombre de nœuds en aval */
  downstreamNodesCount: number;
  /** Nœuds hors norme avant SRG2 */
  nodesOutOfNormBefore: number;
  /** Nœuds hors norme après SRG2 (estimé) */
  nodesOutOfNormAfter: number;
  /** Nœuds corrigés par le SRG2 */
  nodesCorrected: number;
  /** Taux de correction (0-100%) */
  correctionRate: number;
  
  /** Score = taux de correction (plus élevé = meilleur) */
  score: number;
  
  /** Tensions estimées après SRG2 */
  estimatedVoltagesAfter: { min: number; max: number; mean: number };
  
  /** Boost estimé appliqué par le SRG2 (%) */
  estimatedBoostPercent: number;
  
  /** Tension moyenne au nœud candidat (V) */
  Umean_V: number;
  
  /** Justification technique */
  justification: string;
}

export interface OptimalSRG2Analysis {
  /** Nœud optimal trouvé */
  optimalNode: OptimalSRG2Result | null;
  /** Liste des candidats analysés triés par score décroissant (meilleur en premier) */
  candidates: OptimalSRG2Result[];
  /** Nombre total de nœuds hors norme dans le réseau */
  totalNodesOutOfNorm: number;
  /** Tous les nœuds sont déjà conformes */
  networkIsCompliant: boolean;
  /** Raison si aucun candidat trouvé */
  noResultReason?: string;
}

/**
 * Calcule la distance et l'impédance amont entre la source et un nœud donné
 */
function computeUpstreamMetrics(
  nodeId: string,
  nodes: Node[],
  cables: Cable[],
  cableTypes: CableType[]
): { pathLength_m: number; Zph_Ohm: number } {
  const source = nodes.find(n => n.isSource);
  if (!source) {
    return { pathLength_m: 0, Zph_Ohm: 0 };
  }
  
  if (nodeId === source.id) {
    return { pathLength_m: 0, Zph_Ohm: 0 };
  }
  
  // BFS pour trouver le chemin de la source au nœud
  const parent = new Map<string, string>();
  const parentCable = new Map<string, Cable>();
  const visited = new Set<string>();
  const queue: string[] = [source.id];
  visited.add(source.id);
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    for (const cable of cables) {
      let neighbor: string | null = null;
      if (cable.nodeAId === current && !visited.has(cable.nodeBId)) {
        neighbor = cable.nodeBId;
      } else if (cable.nodeBId === current && !visited.has(cable.nodeAId)) {
        neighbor = cable.nodeAId;
      }
      
      if (neighbor) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        parentCable.set(neighbor, cable);
        queue.push(neighbor);
      }
    }
  }
  
  // Si le nœud n'est pas atteignable
  if (!parent.has(nodeId)) {
    return { pathLength_m: 0, Zph_Ohm: 0 };
  }
  
  // Remonter le chemin et sommer les distances et impédances
  let Zph_total = 0;
  let pathLength_m = 0;
  let currentNodeId = nodeId;
  
  while (currentNodeId !== source.id) {
    const cable = parentCable.get(currentNodeId);
    if (!cable) break;
    
    const cableType = cableTypes.find(ct => ct.id === cable.typeId);
    
    // Calculer la longueur du câble
    let length_m = cable.length_m || 0;
    if (!length_m && cable.coordinates && cable.coordinates.length >= 2) {
      for (let i = 1; i < cable.coordinates.length; i++) {
        const c0 = cable.coordinates[i - 1];
        const c1 = cable.coordinates[i];
        const R = 6371000;
        const dLat = (c1.lat - c0.lat) * Math.PI / 180;
        const dLon = (c1.lng - c0.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(c0.lat * Math.PI/180) * Math.cos(c1.lat * Math.PI/180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        length_m += R * c;
      }
    }
    
    pathLength_m += length_m;
    
    if (cableType) {
      const length_km = length_m / 1000;
      Zph_total += cableType.R12_ohm_per_km * length_km;
    }
    
    currentNodeId = parent.get(currentNodeId)!;
  }
  
  return { pathLength_m, Zph_Ohm: Zph_total };
}

/**
 * Trouve tous les nœuds en aval d'un nœud donné (incluant le nœud lui-même)
 */
function findDownstreamNodes(
  startNodeId: string,
  nodes: Node[],
  cables: Cable[],
  sourceId: string
): string[] {
  const downstream: string[] = [startNodeId];
  const visited = new Set<string>([startNodeId, sourceId]); // Exclure la source
  const queue: string[] = [startNodeId];
  
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    
    const connectedCables = cables.filter(
      c => c.nodeAId === currentId || c.nodeBId === currentId
    );
    
    for (const cable of connectedCables) {
      const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
      
      if (!visited.has(nextNodeId)) {
        visited.add(nextNodeId);
        downstream.push(nextNodeId);
        queue.push(nextNodeId);
      }
    }
  }
  
  return downstream;
}

/**
 * Extrait les tensions par phase d'un nœud depuis les résultats de calcul
 */
function extractNodeVoltages(
  nodeId: string,
  calculationResult: CalculationResult
): { A: number; B: number; C: number } | null {
  // Chercher dans nodeMetricsPerPhase (mode triphasé détaillé)
  const nodeMetrics = calculationResult.nodeMetricsPerPhase?.find(n => n.nodeId === nodeId);
  if (nodeMetrics?.voltagesPerPhase) {
    return nodeMetrics.voltagesPerPhase;
  }
  
  // Fallback: utiliser nodeMetrics standard
  const simpleMetrics = calculationResult.nodeMetrics?.find(n => n.nodeId === nodeId);
  if (simpleMetrics?.V_phase_V) {
    return {
      A: simpleMetrics.V_phase_V,
      B: simpleMetrics.V_phase_V,
      C: simpleMetrics.V_phase_V
    };
  }
  
  // Dernier recours: utiliser nodePhasors
  const nodePhasor = calculationResult.nodePhasors?.find(n => n.nodeId === nodeId);
  if (nodePhasor?.V_phase_V) {
    return {
      A: nodePhasor.V_phase_V,
      B: nodePhasor.V_phase_V,
      C: nodePhasor.V_phase_V
    };
  }
  
  return null;
}

/**
 * Vérifie si un nœud est hors norme EN50160
 */
function isNodeOutOfNorm(voltages: { A: number; B: number; C: number }): boolean {
  const { A, B, C } = voltages;
  return [A, B, C].some(v => v < VOLTAGE_MIN_EN50160 || v > VOLTAGE_MAX_EN50160);
}

/**
 * Compte les nœuds hors norme parmi une liste de nœuds
 */
function countOutOfNormNodes(
  nodeIds: string[],
  calculationResult: CalculationResult
): { count: number; outOfNormNodeIds: string[] } {
  let count = 0;
  const outOfNormNodeIds: string[] = [];
  
  for (const nodeId of nodeIds) {
    const voltages = extractNodeVoltages(nodeId, calculationResult);
    if (!voltages) continue;
    
    if (isNodeOutOfNorm(voltages)) {
      count++;
      outOfNormNodeIds.push(nodeId);
    }
  }
  
  return { count, outOfNormNodeIds };
}

/**
 * Estime l'effet du SRG2 sur les nœuds aval
 */
function estimateSRG2Effect(
  candidateNodeId: string,
  downstreamNodes: string[],
  calculationResult: CalculationResult
): { 
  nodesOutOfNormAfter: number; 
  estimatedBoostPercent: number;
  voltagesAfter: { min: number; max: number; mean: number };
} {
  // 1. Calculer la tension moyenne au nœud candidat
  const candidateVoltages = extractNodeVoltages(candidateNodeId, calculationResult);
  if (!candidateVoltages) {
    return { nodesOutOfNormAfter: 0, estimatedBoostPercent: 0, voltagesAfter: { min: 0, max: 0, mean: 0 } };
  }
  
  const { A, B, C } = candidateVoltages;
  const Umean = (A + B + C) / 3;
  
  // 2. Estimer le coefficient SRG2 pour atteindre la tension cible (230V)
  const requiredBoost = TARGET_VOLTAGE_V - Umean;
  const boostPercent = Math.max(-MAX_SRG2_BOOST_PERCENT, Math.min(MAX_SRG2_BOOST_PERCENT, (requiredBoost / Umean) * 100));
  
  // 3. Appliquer ce boost aux nœuds aval (estimation linéaire)
  let nodesStillOutOfNorm = 0;
  let minV = Infinity;
  let maxV = -Infinity;
  let sumV = 0;
  let countV = 0;
  
  for (const nodeId of downstreamNodes) {
    const voltages = extractNodeVoltages(nodeId, calculationResult);
    if (!voltages) continue;
    
    // Estimer les tensions après boost
    const boostedVoltages = {
      A: voltages.A * (1 + boostPercent / 100),
      B: voltages.B * (1 + boostPercent / 100),
      C: voltages.C * (1 + boostPercent / 100)
    };
    
    // Tracker min/max/mean
    const valsAfter = [boostedVoltages.A, boostedVoltages.B, boostedVoltages.C];
    for (const v of valsAfter) {
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
      sumV += v;
      countV++;
    }
    
    // Vérifier si toujours hors norme
    if (isNodeOutOfNorm(boostedVoltages)) {
      nodesStillOutOfNorm++;
    }
  }
  
  const meanV = countV > 0 ? sumV / countV : TARGET_VOLTAGE_V;
  
  return { 
    nodesOutOfNormAfter: nodesStillOutOfNorm, 
    estimatedBoostPercent: boostPercent,
    voltagesAfter: { 
      min: minV === Infinity ? 0 : minV, 
      max: maxV === -Infinity ? 0 : maxV, 
      mean: meanV 
    }
  };
}

/**
 * Trouve le nœud optimal pour la mesure SRG2 basé sur l'impact réseau aval
 * 
 * @param project Configuration du projet réseau
 * @param calculationResult Résultats de calcul sans EQUI8 ni SRG2
 * @returns Analyse complète avec nœud optimal et candidats
 */
export function findOptimalSRG2Node(
  project: Project,
  calculationResult: CalculationResult
): OptimalSRG2Analysis {
  const { nodes, cables, cableTypes } = project;
  const source = nodes.find(n => n.isSource);
  
  if (!source) {
    return {
      optimalNode: null,
      candidates: [],
      totalNodesOutOfNorm: 0,
      networkIsCompliant: true,
      noResultReason: 'Aucune source trouvée dans le réseau'
    };
  }
  
  // Compter les nœuds hors norme dans tout le réseau
  const allNodeIds = nodes.filter(n => !n.isSource).map(n => n.id);
  const { count: totalOutOfNorm } = countOutOfNormNodes(allNodeIds, calculationResult);
  
  console.log(`📊 Analyse optimisation SRG2 (impact aval):`);
  console.log(`   Nœuds hors norme EN50160: ${totalOutOfNorm} / ${allNodeIds.length}`);
  
  // Si le réseau est déjà conforme
  if (totalOutOfNorm === 0) {
    // Retourner le nœud le plus proche de la source comme suggestion optionnelle
    let closestNode: OptimalSRG2Result | null = null;
    let minDistance = Infinity;
    
    for (const node of nodes) {
      if (node.isSource) continue;
      
      const { pathLength_m } = computeUpstreamMetrics(node.id, nodes, cables, cableTypes);
      if (pathLength_m <= MAX_DISTANCE_FROM_SOURCE_M && pathLength_m < minDistance) {
        minDistance = pathLength_m;
        const voltages = extractNodeVoltages(node.id, calculationResult);
        const downstreamNodes = findDownstreamNodes(node.id, nodes, cables, source.id);
        
        closestNode = {
          nodeId: node.id,
          nodeName: node.name || node.id,
          distanceFromSource_m: pathLength_m,
          downstreamNodesCount: downstreamNodes.length,
          nodesOutOfNormBefore: 0,
          nodesOutOfNormAfter: 0,
          nodesCorrected: 0,
          correctionRate: 100,
          score: 100,
          estimatedVoltagesAfter: voltages ? {
            min: Math.min(voltages.A, voltages.B, voltages.C),
            max: Math.max(voltages.A, voltages.B, voltages.C),
            mean: (voltages.A + voltages.B + voltages.C) / 3
          } : { min: 230, max: 230, mean: 230 },
          estimatedBoostPercent: 0,
          Umean_V: voltages ? (voltages.A + voltages.B + voltages.C) / 3 : 230,
          justification: 'Réseau conforme EN50160 - SRG2 optionnel pour stabilisation'
        };
      }
    }
    
    return {
      optimalNode: closestNode,
      candidates: closestNode ? [closestNode] : [],
      totalNodesOutOfNorm: 0,
      networkIsCompliant: true,
      noResultReason: closestNode ? undefined : 'Aucun nœud dans la zone 250m'
    };
  }
  
  const candidates: OptimalSRG2Result[] = [];
  
  // Analyser chaque nœud (sauf la source) dans la zone 250m
  for (const node of nodes) {
    if (node.isSource) continue;
    
    // Calculer la distance depuis la source
    const { pathLength_m } = computeUpstreamMetrics(node.id, nodes, cables, cableTypes);
    
    // Filtrer par distance max
    if (pathLength_m > MAX_DISTANCE_FROM_SOURCE_M) {
      console.log(`   ⏭️ ${node.name || node.id}: distance=${pathLength_m.toFixed(0)}m > ${MAX_DISTANCE_FROM_SOURCE_M}m`);
      continue;
    }
    
    // Trouver les nœuds en aval
    const downstreamNodes = findDownstreamNodes(node.id, nodes, cables, source.id);
    
    // Compter les nœuds hors norme AVANT
    const { count: nodesOutOfNormBefore } = countOutOfNormNodes(downstreamNodes, calculationResult);
    
    // Estimer l'effet du SRG2
    const { nodesOutOfNormAfter, estimatedBoostPercent, voltagesAfter } = estimateSRG2Effect(
      node.id,
      downstreamNodes,
      calculationResult
    );
    
    // Calculer le score (taux de correction)
    const nodesCorrected = nodesOutOfNormBefore - nodesOutOfNormAfter;
    let correctionRate = 0;
    let score = 0;
    
    if (nodesOutOfNormBefore > 0) {
      correctionRate = (nodesCorrected / nodesOutOfNormBefore) * 100;
      score = correctionRate;
    } else {
      // Tous les nœuds aval sont conformes - score bonus basé sur la couverture
      correctionRate = 100;
      score = 50 + (downstreamNodes.length / allNodeIds.length) * 50; // 50-100 basé sur couverture
    }
    
    // Si score égal, départager par distance (plus proche = meilleur)
    // On ajoute un petit bonus inversement proportionnel à la distance
    score += (MAX_DISTANCE_FROM_SOURCE_M - pathLength_m) / MAX_DISTANCE_FROM_SOURCE_M * 0.1;
    
    const voltages = extractNodeVoltages(node.id, calculationResult);
    const Umean = voltages ? (voltages.A + voltages.B + voltages.C) / 3 : 230;
    
    candidates.push({
      nodeId: node.id,
      nodeName: node.name || node.id,
      distanceFromSource_m: pathLength_m,
      downstreamNodesCount: downstreamNodes.length,
      nodesOutOfNormBefore,
      nodesOutOfNormAfter,
      nodesCorrected,
      correctionRate,
      score,
      estimatedVoltagesAfter: voltagesAfter,
      estimatedBoostPercent,
      Umean_V: Umean,
      justification: `Corrige ${nodesCorrected}/${nodesOutOfNormBefore} nœuds (${correctionRate.toFixed(0)}%), boost ${estimatedBoostPercent > 0 ? '+' : ''}${estimatedBoostPercent.toFixed(1)}%`
    });
    
    console.log(`   ✅ ${node.name || node.id}: score=${score.toFixed(1)}, corrigés=${nodesCorrected}/${nodesOutOfNormBefore}, dist=${pathLength_m.toFixed(0)}m`);
  }
  
  // Trier par score DÉCROISSANT (plus élevé = meilleur)
  candidates.sort((a, b) => b.score - a.score);
  
  if (candidates.length === 0) {
    return {
      optimalNode: null,
      candidates: [],
      totalNodesOutOfNorm: totalOutOfNorm,
      networkIsCompliant: false,
      noResultReason: `Aucun nœud candidat dans la zone de ${MAX_DISTANCE_FROM_SOURCE_M}m depuis la source`
    };
  }
  
  const optimalNode = candidates[0];
  
  console.log(`🎯 Nœud optimal SRG2: ${optimalNode.nodeName}`);
  console.log(`   Score: ${optimalNode.score.toFixed(1)}% (taux de correction)`);
  console.log(`   ${optimalNode.justification}`);
  
  return {
    optimalNode,
    candidates,
    totalNodesOutOfNorm: totalOutOfNorm,
    networkIsCompliant: false
  };
}

/**
 * Retourne une description textuelle du résultat pour affichage UI
 */
export function formatOptimalSRG2Result(analysis: OptimalSRG2Analysis): string {
  if (!analysis.optimalNode) {
    return analysis.noResultReason || 'Aucun nœud optimal trouvé';
  }
  
  const { optimalNode, networkIsCompliant } = analysis;
  
  let text = `🎯 Nœud recommandé: ${optimalNode.nodeName}\n`;
  text += `   • Distance source: ${optimalNode.distanceFromSource_m.toFixed(0)} m\n`;
  text += `   • Nœuds en aval: ${optimalNode.downstreamNodesCount}\n`;
  
  if (networkIsCompliant) {
    text += `   • Réseau conforme EN50160 - SRG2 optionnel\n`;
  } else {
    text += `   • Nœuds hors norme: ${optimalNode.nodesOutOfNormBefore}\n`;
    text += `   • Nœuds corrigés: ${optimalNode.nodesCorrected} (${optimalNode.correctionRate.toFixed(0)}%)\n`;
    text += `   • Boost estimé: ${optimalNode.estimatedBoostPercent > 0 ? '+' : ''}${optimalNode.estimatedBoostPercent.toFixed(1)}%\n`;
  }
  
  return text;
}
