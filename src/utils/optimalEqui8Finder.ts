/**
 * ============================================================================
 * OPTIMAL EQUI8 NODE FINDER
 * ============================================================================
 * 
 * Analyse automatique du réseau pour trouver le nœud optimal d'implantation
 * d'un compensateur de neutre EQUI8.
 * 
 * 🧠 PRINCIPE PHYSIQUE:
 * Le positionnement optimal d'un EQUI8 correspond au nœud où le déséquilibre
 * de neutre est fort tout en conservant une impédance amont suffisamment
 * faible pour éviter une domination locale de tension par l'équilibreur.
 * 
 * L'EQUI8 doit être placé :
 * - Là où le courant de neutre est maximal
 * - Mais avant que l'impédance amont ne devienne trop élevée
 * 
 * Cela évite que l'EQUI8 devienne dominant sur la tension locale et entre
 * en conflit avec le SRG2.
 * 
 * 📊 SCORE CALCULÉ:
 * score(node) = I_neutral(node) / Z_upstream(node)
 * 
 * Le nœud optimal maximise ce score dans les bornes [Zmin, Zmax].
 * 
 * ============================================================================
 */

import { Project, Node, Cable, CableType, CalculationResult } from '@/types/network';
import { Complex, C, add, abs } from '@/utils/complex';

// Configuration des bornes d'impédance
const Z_MIN_RATIO = 0.10; // 10% de l'impédance totale du départ
const Z_MAX_RATIO = 0.70; // 70% de l'impédance totale du départ

// Seuil minimal de courant de neutre à considérer (A)
const MIN_NEUTRAL_CURRENT_A = 2.0;

// Seuil minimal d'impédance pour éviter division par zéro (Ω)
const MIN_IMPEDANCE_OHM = 0.001;

export interface OptimalEqui8Result {
  /** ID du nœud optimal */
  nodeId: string;
  /** Nom du nœud */
  nodeName: string;
  /** Score calculé (I_N / Z_up) */
  score: number;
  /** Courant de neutre au nœud (A) */
  neutralCurrent_A: number;
  /** Impédance amont phase (Ω) */
  upstreamImpedance_Zph_Ohm: number;
  /** Impédance amont neutre (Ω) */
  upstreamImpedance_Zn_Ohm: number;
  /** Position relative sur le départ (0 = source, 1 = extrémité) */
  positionRatio: number;
  /** Justification technique */
  justification: string;
}

export interface OptimalEqui8Analysis {
  /** Nœud optimal trouvé */
  optimalNode: OptimalEqui8Result | null;
  /** Liste des candidats analysés triés par score décroissant */
  candidates: OptimalEqui8Result[];
  /** Impédance totale maximale du départ (Ω) */
  totalImpedance_Zph_Ohm: number;
  /** Bornes d'impédance appliquées */
  impedanceBounds: { Zmin: number; Zmax: number };
  /** Raison si aucun candidat trouvé */
  noResultReason?: string;
}

/**
 * Calcule l'impédance amont (Zph et Zn) entre la source et un nœud donné
 */
function computeUpstreamImpedance(
  nodeId: string,
  nodes: Node[],
  cables: Cable[],
  cableTypes: CableType[]
): { Zph_Ohm: number; Zn_Ohm: number; pathLength_m: number } {
  const source = nodes.find(n => n.isSource);
  if (!source) {
    return { Zph_Ohm: 0, Zn_Ohm: 0, pathLength_m: 0 };
  }
  
  if (nodeId === source.id) {
    return { Zph_Ohm: 0, Zn_Ohm: 0, pathLength_m: 0 };
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
    return { Zph_Ohm: 0, Zn_Ohm: 0, pathLength_m: 0 };
  }
  
  // Remonter le chemin et sommer les impédances
  let Zph_total = 0;
  let Zn_total = 0;
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
    // Neutre: R0 directement
    const R_grd = (cableType.R0_ohm_per_km + 2 * cableType.R12_ohm_per_km) / 3;
    Zph_total += R_grd * length_km;
    Zn_total += cableType.R0_ohm_per_km * length_km;
    
    currentNodeId = parent.get(currentNodeId)!;
  }
  
  return { Zph_Ohm: Zph_total, Zn_Ohm: Zn_total, pathLength_m };
}

/**
 * Extrait le courant de neutre d'un nœud depuis les résultats de calcul
 * 
 * En mode per-phase, le courant de neutre peut être estimé depuis les câbles
 * connectés ou depuis le déséquilibre de tension.
 */
function extractNeutralCurrent(
  nodeId: string,
  calculationResult: CalculationResult,
  cables: Cable[]
): number {
  // Chercher les câbles connectés au nœud pour obtenir les courants
  const connectedCables = cables.filter(
    cable => cable.nodeAId === nodeId || cable.nodeBId === nodeId
  );
  
  // Si on a des courants par phase sur les câbles
  for (const cable of connectedCables) {
    const cableResult = calculationResult.cables.find(c => c.id === cable.id);
    if (cableResult?.currentsPerPhase_A) {
      const { A, B, C: C_val, N } = cableResult.currentsPerPhase_A;
      
      // Si le courant neutre est disponible directement
      if (N !== undefined) {
        return N;
      }
      
      // Sinon, calculer I_N = |I_A + I_B + I_C| avec phasors
      const I_A = C(A, 0);
      const I_B = C(
        B * Math.cos(-2 * Math.PI / 3),
        B * Math.sin(-2 * Math.PI / 3)
      );
      const I_C = C(
        C_val * Math.cos(2 * Math.PI / 3),
        C_val * Math.sin(2 * Math.PI / 3)
      );
      
      const I_N = add(add(I_A, I_B), I_C);
      return abs(I_N);
    }
    
    // Fallback: utiliser currentNeutral_A du câble
    if (cableResult?.currentNeutral_A !== undefined) {
      return cableResult.currentNeutral_A;
    }
  }
  
  // Alternative: estimer depuis le déséquilibre de tension au nœud
  const nodeMetrics = calculationResult.nodeMetricsPerPhase?.find(n => n.nodeId === nodeId);
  if (nodeMetrics) {
    const { A, B, C: C_val } = nodeMetrics.voltagesPerPhase;
    const Umoy = (A + B + C_val) / 3;
    const maxDeviation = Math.max(
      Math.abs(A - Umoy),
      Math.abs(B - Umoy),
      Math.abs(C_val - Umoy)
    );
    
    // Estimation grossière: I_N ≈ ΔU / Z_typ (avec Z_typ ≈ 0.5Ω)
    // Cette estimation est utilisée uniquement si pas de données de courant
    const Z_typ = 0.5; // Impédance typique
    return maxDeviation / Z_typ;
  }
  
  return 0;
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
 * Trouve le nœud optimal pour l'implantation d'un EQUI8
 * 
 * @param project Configuration du projet réseau
 * @param calculationResult Résultats de calcul sans EQUI8 ni SRG2
 * @returns Analyse complète avec nœud optimal et candidats
 */
export function findOptimalEqui8Node(
  project: Project,
  calculationResult: CalculationResult
): OptimalEqui8Analysis {
  const { nodes, cables, cableTypes } = project;
  
  // Vérifier que c'est un réseau 400V
  if (project.voltageSystem !== 'TÉTRAPHASÉ_400V') {
    return {
      optimalNode: null,
      candidates: [],
      totalImpedance_Zph_Ohm: 0,
      impedanceBounds: { Zmin: 0, Zmax: 0 },
      noResultReason: 'EQUI8 nécessite un réseau 400V (tétraphasé)'
    };
  }
  
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
  const Zmin = totalZph * Z_MIN_RATIO;
  const Zmax = totalZph * Z_MAX_RATIO;
  
  console.log(`📊 Analyse optimisation EQUI8:`);
  console.log(`   Z_total: ${totalZph.toFixed(4)}Ω`);
  console.log(`   Bornes: Zmin=${Zmin.toFixed(4)}Ω (${(Z_MIN_RATIO*100).toFixed(0)}%), Zmax=${Zmax.toFixed(4)}Ω (${(Z_MAX_RATIO*100).toFixed(0)}%)`);
  
  const candidates: OptimalEqui8Result[] = [];
  
  // Analyser chaque nœud (sauf la source)
  for (const node of nodes) {
    if (node.isSource) continue;
    
    // Calculer l'impédance amont
    const { Zph_Ohm, Zn_Ohm } = computeUpstreamImpedance(node.id, nodes, cables, cableTypes);
    
    // Vérifier les bornes d'impédance
    if (Zph_Ohm < Zmin) {
      console.log(`   ⏭️ ${node.name || node.id}: Z=${Zph_Ohm.toFixed(4)}Ω < Zmin (trop proche source)`);
      continue;
    }
    if (Zph_Ohm > Zmax) {
      console.log(`   ⏭️ ${node.name || node.id}: Z=${Zph_Ohm.toFixed(4)}Ω > Zmax (trop éloigné)`);
      continue;
    }
    
    // Extraire le courant de neutre
    const I_N = extractNeutralCurrent(node.id, calculationResult, cables);
    
    if (I_N < MIN_NEUTRAL_CURRENT_A) {
      console.log(`   ⏭️ ${node.name || node.id}: I_N=${I_N.toFixed(2)}A < seuil min (pas de déséquilibre)`);
      continue;
    }
    
    // Calculer le score
    const score = I_N / Math.max(Zph_Ohm, MIN_IMPEDANCE_OHM);
    const positionRatio = Zph_Ohm / totalZph;
    
    candidates.push({
      nodeId: node.id,
      nodeName: node.name || node.id,
      score,
      neutralCurrent_A: I_N,
      upstreamImpedance_Zph_Ohm: Zph_Ohm,
      upstreamImpedance_Zn_Ohm: Zn_Ohm,
      positionRatio,
      justification: `I_N=${I_N.toFixed(1)}A, Z_up=${Zph_Ohm.toFixed(3)}Ω, position=${(positionRatio*100).toFixed(0)}% du départ`
    });
    
    console.log(`   ✅ ${node.name || node.id}: score=${score.toFixed(2)}, I_N=${I_N.toFixed(1)}A, Z=${Zph_Ohm.toFixed(3)}Ω`);
  }
  
  // Trier par score décroissant
  candidates.sort((a, b) => b.score - a.score);
  
  if (candidates.length === 0) {
    return {
      optimalNode: null,
      candidates: [],
      totalImpedance_Zph_Ohm: totalZph,
      impedanceBounds: { Zmin, Zmax },
      noResultReason: 'Aucun nœud ne satisfait les critères (courant de neutre > 2A et impédance dans les bornes)'
    };
  }
  
  const optimalNode = candidates[0];
  
  console.log(`🎯 Nœud optimal EQUI8: ${optimalNode.nodeName}`);
  console.log(`   Score: ${optimalNode.score.toFixed(2)}`);
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
export function formatOptimalEqui8Result(analysis: OptimalEqui8Analysis): string {
  if (!analysis.optimalNode) {
    return analysis.noResultReason || 'Aucun nœud optimal trouvé';
  }
  
  const { optimalNode, candidates } = analysis;
  
  let text = `🎯 Nœud recommandé: ${optimalNode.nodeName}\n`;
  text += `   • Courant neutre: ${optimalNode.neutralCurrent_A.toFixed(1)} A\n`;
  text += `   • Impédance amont: ${optimalNode.upstreamImpedance_Zph_Ohm.toFixed(3)} Ω\n`;
  text += `   • Position: ${(optimalNode.positionRatio * 100).toFixed(0)}% du départ\n`;
  text += `   • Score: ${optimalNode.score.toFixed(2)}\n`;
  
  if (candidates.length > 1) {
    text += `\nAutres candidats (${candidates.length - 1}):\n`;
    for (let i = 1; i < Math.min(candidates.length, 4); i++) {
      const c = candidates[i];
      text += `   ${i}. ${c.nodeName} (score: ${c.score.toFixed(2)})\n`;
    }
  }
  
  return text;
}
