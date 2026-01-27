/**
 * ============================================================================
 * EQUI8 LOAD SHIFT CALCULATOR - @deprecated
 * ============================================================================
 * 
 * ⚠️ CE MODULE EST DÉPRÉCIÉ ET NE DOIT PLUS ÊTRE UTILISÉ EN PRODUCTION.
 * 
 * Remplacé par: src/utils/equi8CME.ts (Mode CME - Injection de courant)
 * 
 * Le mode CME (source de courant shunt) est maintenant la seule méthode
 * de simulation EQUI8 supportée en production. Ce module est conservé
 * uniquement pour référence historique et tests de non-régression.
 * 
 * 🔑 ANCIEN PRINCIPE (OBSOLÈTE):
 * L'ancien modèle modifiait les charges mono entre phases pour réduire
 * le déséquilibre de courant. Cette approche ne respectait pas le 
 * comportement physique réel de l'EQUI8 (compensateur de neutre).
 * 
 * 🔧 NOUVEAU PRINCIPE (MODE CME):
 * EQUI8 agit comme une SOURCE DE COURANT shunt au nœud:
 * - +I_EQUI8 injecté sur le NEUTRE
 * - -I_EQUI8/3 soutiré sur chaque PHASE (A, B, C)
 * Les tensions résultent du recalcul BFS complet après injection.
 * 
 * ============================================================================
 * @deprecated Utiliser equi8CME.ts à la place. Ce module sera supprimé dans
 * une version future.
 * ============================================================================
 */

import { Node, NeutralCompensator, Project, CalculationResult, ClientImporte } from '@/types/network';
import { Complex, C, add, abs, fromPolar } from '@/utils/complex';

// ============================================================================
// EXPORTS DÉPRÉCIÉS - NE PAS UTILISER EN PRODUCTION
// ============================================================================

/**
 * @deprecated Utiliser analyzeCurrentImbalance depuis equi8CME.ts ou le mode CME.
 */
export interface CurrentImbalanceAnalysis {
  currents: { A: number; B: number; C: number };
  maxPhase: 'A' | 'B' | 'C';
  minPhase: 'A' | 'B' | 'C';
  imbalance_A: number;
  imbalancePercent: number;
  neutralCurrent_A: number;
}

/**
 * @deprecated Non utilisé en mode CME.
 */
export interface EQUI8LoadShiftResult {
  initialImbalance: CurrentImbalanceAnalysis;
  finalImbalance: CurrentImbalanceAnalysis;
  loadShift_kVA: number;
  fromPhase: 'A' | 'B' | 'C';
  toPhase: 'A' | 'B' | 'C';
  reductionPercent: number;
  neutralReduction_A: number;
  adjustedMonoDistribution: {
    charges: { A: number; B: number; C: number };
    productions: { A: number; B: number; C: number };
  };
  converged: boolean;
  iterations: number;
  isLimited: boolean;
}

/**
 * @deprecated Utiliser le mode CME à la place.
 * Analyse le déséquilibre de courant à partir des courants de phase.
 * Cette fonction est conservée pour compatibilité arrière uniquement.
 */
export function analyzeCurrentImbalance(
  I_A_complex: Complex,
  I_B_complex: Complex,
  I_C_complex: Complex
): CurrentImbalanceAnalysis {
  console.warn('⚠️ analyzeCurrentImbalance() est déprécié. Utiliser le mode CME.');
  
  const I_A = abs(I_A_complex);
  const I_B = abs(I_B_complex);
  const I_C = abs(I_C_complex);
  
  const currents = { A: I_A, B: I_B, C: I_C };
  
  let maxPhase: 'A' | 'B' | 'C' = 'A';
  let minPhase: 'A' | 'B' | 'C' = 'A';
  let I_max = I_A;
  let I_min = I_A;
  
  if (I_B > I_max) { I_max = I_B; maxPhase = 'B'; }
  if (I_C > I_max) { I_max = I_C; maxPhase = 'C'; }
  if (I_B < I_min) { I_min = I_B; minPhase = 'B'; }
  if (I_C < I_min) { I_min = I_C; minPhase = 'C'; }
  
  const imbalance_A = I_max - I_min;
  const I_mean = (I_A + I_B + I_C) / 3;
  const imbalancePercent = I_mean > 0 ? (imbalance_A / I_mean) * 100 : 0;
  
  const I_N = add(add(I_A_complex, I_B_complex), I_C_complex);
  const neutralCurrent_A = abs(I_N);
  
  return {
    currents,
    maxPhase,
    minPhase,
    imbalance_A,
    imbalancePercent,
    neutralCurrent_A
  };
}

/**
 * @deprecated Non utilisé en mode CME.
 */
export function calculateLoadShiftFraction(
  Zph_Ohm: number,
  Zn_Ohm: number
): number {
  console.warn('⚠️ calculateLoadShiftFraction() est déprécié. Utiliser le mode CME.');
  
  const Zph = Math.max(0.15, Zph_Ohm);
  const Zn = Math.max(0.15, Zn_Ohm);
  
  const lnZph = Math.log(Zph);
  const denominateur = 0.9119 * lnZph + 3.8654;
  const facteur_impedance = (2 * Zph) / (Zph + Zn);
  
  const fraction = (1 / denominateur) * facteur_impedance;
  
  return Math.min(0.5, Math.max(0, fraction));
}

/**
 * @deprecated Non utilisé en mode CME.
 */
export function calculateLoadRedistribution(
  currentDistribution: { A: number; B: number; C: number },
  imbalanceAnalysis: CurrentImbalanceAnalysis,
  compensator: NeutralCompensator
): {
  newDistribution: { A: number; B: number; C: number };
  loadShifted_kVA: number;
  fromPhase: 'A' | 'B' | 'C';
  toPhase: 'A' | 'B' | 'C';
  isLimited: boolean;
} {
  console.warn('⚠️ calculateLoadRedistribution() est déprécié. Utiliser le mode CME.');
  
  const { maxPhase, minPhase, neutralCurrent_A } = imbalanceAnalysis;
  
  if (neutralCurrent_A <= compensator.tolerance_A) {
    return {
      newDistribution: { ...currentDistribution },
      loadShifted_kVA: 0,
      fromPhase: maxPhase,
      toPhase: minPhase,
      isLimited: false
    };
  }
  
  const shiftFraction = calculateLoadShiftFraction(
    compensator.Zph_Ohm,
    compensator.Zn_Ohm
  );
  
  const chargeOnMaxPhase = currentDistribution[maxPhase];
  let loadToShift_kVA = chargeOnMaxPhase * shiftFraction;
  
  const maxPowerCapacity_kVA = compensator.maxPower_kVA;
  
  let isLimited = false;
  if (loadToShift_kVA > maxPowerCapacity_kVA) {
    loadToShift_kVA = maxPowerCapacity_kVA;
    isLimited = true;
  }
  
  loadToShift_kVA = Math.min(loadToShift_kVA, chargeOnMaxPhase * 0.9);
  
  const newDistribution = { ...currentDistribution };
  newDistribution[maxPhase] -= loadToShift_kVA;
  newDistribution[minPhase] += loadToShift_kVA;
  
  return {
    newDistribution,
    loadShifted_kVA: loadToShift_kVA,
    fromPhase: maxPhase,
    toPhase: minPhase,
    isLimited
  };
}

/**
 * @deprecated Utiliser calculateWithEQUI8_CME() depuis simulationCalculator.ts.
 * Cette fonction implémentait l'ancien modèle de redistribution des charges.
 * En mode CME, l'EQUI8 agit via injection de courant shunt, pas via
 * modification des charges.
 */
export function calculateEQUI8LoadShift(
  nodeId: string,
  currentsPerPhase: { A: Complex; B: Complex; C: Complex },
  currentMonoDistribution: { 
    charges: { A: number; B: number; C: number };
    productions: { A: number; B: number; C: number };
  },
  compensator: NeutralCompensator
): {
  shouldRedistribute: boolean;
  imbalanceAnalysis: CurrentImbalanceAnalysis;
  adjustedDistribution: {
    charges: { A: number; B: number; C: number };
    productions: { A: number; B: number; C: number };
  };
  loadShifted_kVA: number;
  fromPhase: 'A' | 'B' | 'C';
  toPhase: 'A' | 'B' | 'C';
  isLimited: boolean;
} {
  console.warn('⚠️ calculateEQUI8LoadShift() est déprécié. Utiliser calculateWithEQUI8_CME().');
  
  const imbalanceAnalysis = analyzeCurrentImbalance(
    currentsPerPhase.A,
    currentsPerPhase.B,
    currentsPerPhase.C
  );
  
  if (imbalanceAnalysis.neutralCurrent_A <= compensator.tolerance_A) {
    return {
      shouldRedistribute: false,
      imbalanceAnalysis,
      adjustedDistribution: currentMonoDistribution,
      loadShifted_kVA: 0,
      fromPhase: imbalanceAnalysis.maxPhase,
      toPhase: imbalanceAnalysis.minPhase,
      isLimited: false
    };
  }
  
  const chargeRedistribution = calculateLoadRedistribution(
    currentMonoDistribution.charges,
    imbalanceAnalysis,
    compensator
  );
  
  const productionRedistribution = calculateLoadRedistribution(
    currentMonoDistribution.productions,
    imbalanceAnalysis,
    compensator
  );
  
  const totalLoadShifted = chargeRedistribution.loadShifted_kVA + productionRedistribution.loadShifted_kVA;
  
  return {
    shouldRedistribute: totalLoadShifted > 0.01,
    imbalanceAnalysis,
    adjustedDistribution: {
      charges: chargeRedistribution.newDistribution,
      productions: productionRedistribution.newDistribution
    },
    loadShifted_kVA: totalLoadShifted,
    fromPhase: imbalanceAnalysis.maxPhase,
    toPhase: imbalanceAnalysis.minPhase,
    isLimited: chargeRedistribution.isLimited || productionRedistribution.isLimited
  };
}

/**
 * @deprecated Utiliser extractNodeCurrents depuis equi8CME.ts si nécessaire.
 */
export function extractNodeCurrents(
  result: CalculationResult,
  project: Project,
  nodeId: string
): { A: Complex; B: Complex; C: Complex } | null {
  console.warn('⚠️ extractNodeCurrents() est déprécié.');
  
  const parentCables = project.cables.filter(c => c.nodeBId === nodeId);
  if (parentCables.length === 0) return null;
  
  let I_A_total = C(0, 0);
  let I_B_total = C(0, 0);
  let I_C_total = C(0, 0);
  
  for (const cable of parentCables) {
    const cableResult = result.cables.find(cr => cr.id === cable.id);
    if (!cableResult?.currentsPerPhase_A) continue;
    
    const I_A_mag = cableResult.currentsPerPhase_A.A || 0;
    const I_B_mag = cableResult.currentsPerPhase_A.B || 0;
    const I_C_mag = cableResult.currentsPerPhase_A.C || 0;
    
    I_A_total = add(I_A_total, fromPolar(I_A_mag, 0));
    I_B_total = add(I_B_total, fromPolar(I_B_mag, -2*Math.PI/3));
    I_C_total = add(I_C_total, fromPolar(I_C_mag, 2*Math.PI/3));
  }
  
  return { A: I_A_total, B: I_B_total, C: I_C_total };
}

/**
 * @deprecated Non utilisé en mode CME.
 */
export function extractNodeMonoDistribution(
  project: Project,
  nodeId: string
): { charges: { A: number; B: number; C: number }; productions: { A: number; B: number; C: number } } {
  console.warn('⚠️ extractNodeMonoDistribution() est déprécié.');
  
  const node = project.nodes.find(n => n.id === nodeId);
  
  if (node?.autoPhaseDistribution) {
    const dist = node.autoPhaseDistribution;
    return {
      charges: dist.charges?.mono || { A: 0, B: 0, C: 0 },
      productions: dist.productions?.mono || { A: 0, B: 0, C: 0 }
    };
  }
  
  return {
    charges: { A: 0, B: 0, C: 0 },
    productions: { A: 0, B: 0, C: 0 }
  };
}
