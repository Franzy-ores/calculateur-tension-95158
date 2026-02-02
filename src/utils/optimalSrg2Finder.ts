/**
 * ============================================================================
 * OPTIMAL SRG2 NODE FINDER
 * ============================================================================
 * 
 * Analyse automatique du réseau pour trouver le nœud optimal de mesure
 * pour un régulateur de tension SRG2.
 * 
 * 🧠 PRINCIPE PHYSIQUE:
 * Le nœud optimal de mesure SRG2 est celui où la tension triphasée est la plus
 * homogène tout en étant représentatif électriquement du départ.
 * 
 * Le SRG2 doit mesurer la tension à un nœud :
 * - Peu déséquilibré (delta U faible entre phases)
 * - Représentatif du départ (ni trop près du poste, ni en extrémité)
 * - Position intermédiaire pour "voir" l'ensemble du départ
 * 
 * 📊 SCORE CALCULÉ (à minimiser):
 * score(node) = deltaU * Z_upstream
 * 
 * deltaU faible → tension propre (homogène entre phases)
 * Zup intermédiaire → le nœud "voit" le départ sans être dominé par les chutes
 * 
 * Le nœud optimal minimise ce score dans les bornes [Zmin, Zmax].
 * 
 * ============================================================================
 */

import { Project, Node, Cable, CableType, CalculationResult } from '@/types/network';

// Configuration des bornes d'impédance pour SRG2
const Z_MIN_RATIO_SRG2 = 0.15; // 15% de l'impédance totale du départ
const Z_MAX_RATIO_SRG2 = 0.60; // 60% de l'impédance totale du départ

// Seuil maximal de déséquilibre acceptable (V)
const MAX_DELTA_U_V = 8.0;

// Seuil minimal d'impédance pour éviter division par zéro (Ω)
const MIN_IMPEDANCE_OHM = 0.001;

export interface OptimalSRG2Result {
  /** ID du nœud optimal */
  nodeId: string;
  /** Nom du nœud */
  nodeName: string;
  /** Score calculé (deltaU * Z_up) - plus petit = meilleur */
  score: number;
  /** Écart de tension entre phases au nœud (V) */
  deltaU_V: number;
  /** Tensions par phase au nœud */
  voltages: { A: number; B: number; C: number };
  /** Tension moyenne au nœud (V) */
  Umean_V: number;
  /** Impédance amont phase (Ω) */
  upstreamImpedance_Zph_Ohm: number;
  /** Position relative sur le départ (0 = source, 1 = extrémité) */
  positionRatio: number;
  /** Justification technique */
  justification: string;
}

export interface OptimalSRG2Analysis {
  /** Nœud optimal trouvé */
  optimalNode: OptimalSRG2Result | null;
  /** Liste des candidats analysés triés par score croissant (meilleur en premier) */
  candidates: OptimalSRG2Result[];
  /** Impédance totale maximale du départ (Ω) */
  totalImpedance_Zph_Ohm: number;
  /** Bornes d'impédance appliquées */
  impedanceBounds: { Zmin: number; Zmax: number };
  /** Raison si aucun candidat trouvé */
  noResultReason?: string;
}

/**
 * Calcule l'impédance amont (Zph) entre la source et un nœud donné
 * (Réutilisation du code de optimalEqui8Finder)
 */
function computeUpstreamImpedance(
  nodeId: string,
  nodes: Node[],
  cables: Cable[],
  cableTypes: CableType[]
): { Zph_Ohm: number; pathLength_m: number } {
  const source = nodes.find(n => n.isSource);
  if (!source) {
    return { Zph_Ohm: 0, pathLength_m: 0 };
  }
  
  if (nodeId === source.id) {
    return { Zph_Ohm: 0, pathLength_m: 0 };
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
    return { Zph_Ohm: 0, pathLength_m: 0 };
  }
  
  // Remonter le chemin et sommer les impédances
  let Zph_total = 0;
  let pathLength_m = 0;
  let currentNodeId = nodeId;
  
  while (currentNodeId !== source.id) {
    const cable = parentCable.get(currentNodeId);
    if (!cable) break;
    
    const cableType = cableTypes.find(ct => ct.id === cable.typeId);
    if (!cableType) {
      currentNodeId = parent.get(currentNodeId)!;
      continue;
    }
    
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
    
    const length_km = length_m / 1000;
    pathLength_m += length_m;
    
    // Sommer les résistances selon formule GRD belge
    // Phases: R = (R0 + 2*R12) / 3 (formule ORES/RESA/Sibelga)
    const R_grd = (cableType.R0_ohm_per_km + 2 * cableType.R12_ohm_per_km) / 3;
    Zph_total += R_grd * length_km;
    
    currentNodeId = parent.get(currentNodeId)!;
  }
  
  return { Zph_Ohm: Zph_total, pathLength_m };
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
    // Mode monophasé équivalent: supposer tension équilibrée
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
 * Calcule l'impédance maximale du réseau (distance au nœud le plus éloigné)
 */
function computeMaxNetworkImpedance(
  nodes: Node[],
  cables: Cable[],
  cableTypes: CableType[]
): number {
  let maxZph = 0;
  
  for (const node of nodes) {
    if (node.isSource) continue;
    const { Zph_Ohm } = computeUpstreamImpedance(node.id, nodes, cables, cableTypes);
    if (Zph_Ohm > maxZph) {
      maxZph = Zph_Ohm;
    }
  }
  
  return maxZph;
}

/**
 * Trouve le nœud optimal pour la mesure SRG2
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
  
  // Calculer l'impédance totale maximale du départ
  const totalZph = computeMaxNetworkImpedance(nodes, cables, cableTypes);
  
  if (totalZph < MIN_IMPEDANCE_OHM) {
    return {
      optimalNode: null,
      candidates: [],
      totalImpedance_Zph_Ohm: 0,
      impedanceBounds: { Zmin: 0, Zmax: 0 },
      noResultReason: 'Impédance réseau trop faible pour analyse'
    };
  }
  
  // Calculer les bornes d'impédance
  const Zmin = totalZph * Z_MIN_RATIO_SRG2;
  const Zmax = totalZph * Z_MAX_RATIO_SRG2;
  
  console.log(`📊 Analyse optimisation SRG2:`);
  console.log(`   Z_total: ${totalZph.toFixed(4)}Ω`);
  console.log(`   Bornes: Zmin=${Zmin.toFixed(4)}Ω (${(Z_MIN_RATIO_SRG2*100).toFixed(0)}%), Zmax=${Zmax.toFixed(4)}Ω (${(Z_MAX_RATIO_SRG2*100).toFixed(0)}%)`);
  
  const candidates: OptimalSRG2Result[] = [];
  
  // Analyser chaque nœud (sauf la source)
  for (const node of nodes) {
    if (node.isSource) continue;
    
    // Calculer l'impédance amont
    const { Zph_Ohm } = computeUpstreamImpedance(node.id, nodes, cables, cableTypes);
    
    // Vérifier les bornes d'impédance
    if (Zph_Ohm < Zmin) {
      console.log(`   ⏭️ ${node.name || node.id}: Z=${Zph_Ohm.toFixed(4)}Ω < Zmin (trop proche source)`);
      continue;
    }
    if (Zph_Ohm > Zmax) {
      console.log(`   ⏭️ ${node.name || node.id}: Z=${Zph_Ohm.toFixed(4)}Ω > Zmax (trop éloigné)`);
      continue;
    }
    
    // Extraire les tensions par phase
    const voltages = extractNodeVoltages(node.id, calculationResult);
    if (!voltages) {
      console.log(`   ⏭️ ${node.name || node.id}: Pas de données de tension`);
      continue;
    }
    
    // Calculer deltaU = max(U1,U2,U3) - min(U1,U2,U3)
    const { A, B, C } = voltages;
    const deltaU = Math.max(A, B, C) - Math.min(A, B, C);
    const Umean = (A + B + C) / 3;
    
    // Filtrer les nœuds trop déséquilibrés
    if (deltaU > MAX_DELTA_U_V) {
      console.log(`   ⏭️ ${node.name || node.id}: ΔU=${deltaU.toFixed(1)}V > seuil max (trop déséquilibré)`);
      continue;
    }
    
    // Calculer le score (à minimiser)
    const score = deltaU * Zph_Ohm;
    const positionRatio = Zph_Ohm / totalZph;
    
    candidates.push({
      nodeId: node.id,
      nodeName: node.name || node.id,
      score,
      deltaU_V: deltaU,
      voltages,
      Umean_V: Umean,
      upstreamImpedance_Zph_Ohm: Zph_Ohm,
      positionRatio,
      justification: `ΔU=${deltaU.toFixed(1)}V, Z_up=${Zph_Ohm.toFixed(3)}Ω, position=${(positionRatio*100).toFixed(0)}% du départ`
    });
    
    console.log(`   ✅ ${node.name || node.id}: score=${score.toFixed(3)}, ΔU=${deltaU.toFixed(1)}V, Z=${Zph_Ohm.toFixed(3)}Ω`);
  }
  
  // Trier par score CROISSANT (plus petit = meilleur pour SRG2)
  candidates.sort((a, b) => a.score - b.score);
  
  if (candidates.length === 0) {
    return {
      optimalNode: null,
      candidates: [],
      totalImpedance_Zph_Ohm: totalZph,
      impedanceBounds: { Zmin, Zmax },
      noResultReason: 'Aucun nœud ne satisfait les critères (ΔU < 8V et impédance dans les bornes 15%-60%)'
    };
  }
  
  const optimalNode = candidates[0];
  
  console.log(`🎯 Nœud optimal SRG2: ${optimalNode.nodeName}`);
  console.log(`   Score: ${optimalNode.score.toFixed(3)} (le plus bas)`);
  console.log(`   ${optimalNode.justification}`);
  
  return {
    optimalNode,
    candidates,
    totalImpedance_Zph_Ohm: totalZph,
    impedanceBounds: { Zmin, Zmax }
  };
}

/**
 * Retourne une description textuelle du résultat pour affichage UI
 */
export function formatOptimalSRG2Result(analysis: OptimalSRG2Analysis): string {
  if (!analysis.optimalNode) {
    return analysis.noResultReason || 'Aucun nœud optimal trouvé';
  }
  
  const { optimalNode, candidates } = analysis;
  
  let text = `🎯 Nœud recommandé: ${optimalNode.nodeName}\n`;
  text += `   • Écart tension (ΔU): ${optimalNode.deltaU_V.toFixed(1)} V\n`;
  text += `   • Tension moyenne: ${optimalNode.Umean_V.toFixed(1)} V\n`;
  text += `   • Impédance amont: ${optimalNode.upstreamImpedance_Zph_Ohm.toFixed(3)} Ω\n`;
  text += `   • Position: ${(optimalNode.positionRatio * 100).toFixed(0)}% du départ\n`;
  text += `   • Score: ${optimalNode.score.toFixed(3)}\n`;
  
  if (candidates.length > 1) {
    text += `\nAutres candidats (${candidates.length - 1}):\n`;
    for (let i = 1; i < Math.min(candidates.length, 4); i++) {
      const c = candidates[i];
      text += `   ${i}. ${c.nodeName} (score: ${c.score.toFixed(3)})\n`;
    }
  }
  
  return text;
}
