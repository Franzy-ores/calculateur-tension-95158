/**
 * ============================================================================
 * EQUI8 LOAD SHIFT CALCULATOR
 * ============================================================================
 * 
 * 🔑 PRINCIPE FONDAMENTAL:
 * EQUI8 modifie les charges, JAMAIS les tensions.
 * 
 * L'EQUI8 (compensateur de neutre) agit en redistribuant les charges mono
 * entre phases pour réduire le déséquilibre de courant. Il ne doit jamais
 * imposer artificiellement des tensions.
 * 
 * 📊 ALGORITHME:
 * 1. Lire les courants par phase: I1, I2, I3
 * 2. Calculer le déséquilibre: I_max - I_min
 * 3. Identifier la phase max (surchargée) et min (sous-chargée)
 * 4. Déplacer une fraction des charges mono de phase max → phase min
 * 5. Recalculer le réseau complet avec ElectricalCalculator
 * 6. Répéter jusqu'à déséquilibre courant < seuil
 * 
 * ============================================================================
 */

import { Node, NeutralCompensator, Project, CalculationResult, ClientImporte } from '@/types/network';
import { Complex, C, add, abs, fromPolar } from '@/utils/complex';

// Type pour les résultats de l'analyse de déséquilibre courant
export interface CurrentImbalanceAnalysis {
  currents: { A: number; B: number; C: number };
  maxPhase: 'A' | 'B' | 'C';
  minPhase: 'A' | 'B' | 'C';
  imbalance_A: number;          // I_max - I_min
  imbalancePercent: number;     // % de déséquilibre relatif
  neutralCurrent_A: number;     // Courant dans le neutre
}

// Type pour le résultat de la redistribution EQUI8
export interface EQUI8LoadShiftResult {
  // Identification du déséquilibre
  initialImbalance: CurrentImbalanceAnalysis;
  finalImbalance: CurrentImbalanceAnalysis;
  
  // Redistribution effectuée
  loadShift_kVA: number;        // Puissance déplacée (kVA)
  fromPhase: 'A' | 'B' | 'C';
  toPhase: 'A' | 'B' | 'C';
  
  // Métriques de performance
  reductionPercent: number;     // Réduction du déséquilibre (%)
  neutralReduction_A: number;   // Réduction du courant neutre (A)
  
  // Distribution modifiée des charges mono
  adjustedMonoDistribution: {
    charges: { A: number; B: number; C: number };
    productions: { A: number; B: number; C: number };
  };
  
  // État de convergence
  converged: boolean;
  iterations: number;
  
  // Limitation par puissance
  isLimited: boolean;
}

/**
 * Analyse le déséquilibre de courant à partir des courants de phase
 */
export function analyzeCurrentImbalance(
  I_A_complex: Complex,
  I_B_complex: Complex,
  I_C_complex: Complex
): CurrentImbalanceAnalysis {
  // Magnitudes des courants
  const I_A = abs(I_A_complex);
  const I_B = abs(I_B_complex);
  const I_C = abs(I_C_complex);
  
  const currents = { A: I_A, B: I_B, C: I_C };
  
  // Identifier phase max et min
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
  
  // Courant de neutre = somme vectorielle des courants de phase
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
 * Calcule la fraction de charge à déplacer selon la formule CME
 * 
 * La fraction est basée sur les impédances du réseau:
 * fraction = 1 / [0.9119 × Ln(Zph) + 3.8654] × 2 × Zph / (Zph + Zn)
 */
export function calculateLoadShiftFraction(
  Zph_Ohm: number,
  Zn_Ohm: number
): number {
  // Clamper les impédances à la condition CME (≥ 0.15Ω)
  const Zph = Math.max(0.15, Zph_Ohm);
  const Zn = Math.max(0.15, Zn_Ohm);
  
  // Formule CME
  const lnZph = Math.log(Zph);
  const denominateur = 0.9119 * lnZph + 3.8654;
  const facteur_impedance = (2 * Zph) / (Zph + Zn);
  
  // La fraction est entre 0 et 1 (typiquement 0.1 à 0.4)
  const fraction = (1 / denominateur) * facteur_impedance;
  
  // Limiter à une fraction raisonnable (max 50%)
  return Math.min(0.5, Math.max(0, fraction));
}

/**
 * Calcule la redistribution des charges mono pour équilibrer les phases
 * 
 * @param currentDistribution Distribution actuelle des charges mono par phase
 * @param imbalanceAnalysis Analyse du déséquilibre de courant
 * @param compensator Configuration du compensateur EQUI8
 * @returns Nouvelle distribution des charges mono
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
  const { maxPhase, minPhase, imbalance_A, neutralCurrent_A } = imbalanceAnalysis;
  
  // Si le déséquilibre est sous le seuil de tolérance, pas de redistribution
  if (neutralCurrent_A <= compensator.tolerance_A) {
    return {
      newDistribution: { ...currentDistribution },
      loadShifted_kVA: 0,
      fromPhase: maxPhase,
      toPhase: minPhase,
      isLimited: false
    };
  }
  
  // Calculer la fraction à déplacer selon CME
  const shiftFraction = calculateLoadShiftFraction(
    compensator.Zph_Ohm,
    compensator.Zn_Ohm
  );
  
  // Charge disponible sur la phase max
  const chargeOnMaxPhase = currentDistribution[maxPhase];
  
  // Calculer la puissance à déplacer
  // On déplace une fraction de la charge de la phase surchargée
  let loadToShift_kVA = chargeOnMaxPhase * shiftFraction;
  
  // Vérifier la limitation par puissance du compensateur
  // P = √3 × U × I_compensation
  const U_nominal = 230; // V phase-neutre
  const maxPowerCapacity_kVA = compensator.maxPower_kVA;
  const maxLoadShift_kVA = maxPowerCapacity_kVA; // Simplification
  
  let isLimited = false;
  if (loadToShift_kVA > maxLoadShift_kVA) {
    loadToShift_kVA = maxLoadShift_kVA;
    isLimited = true;
  }
  
  // Ne pas déplacer plus que ce qui est disponible
  loadToShift_kVA = Math.min(loadToShift_kVA, chargeOnMaxPhase * 0.9);
  
  // Créer la nouvelle distribution
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
 * Calcule l'effet EQUI8 via redistribution des charges mono
 * 
 * Cette fonction est appelée à chaque itération pour:
 * 1. Analyser le déséquilibre de courant
 * 2. Calculer la redistribution des charges mono
 * 3. Retourner les ajustements à appliquer
 * 
 * ⚠️ IMPORTANT: Cette fonction ne modifie PAS les tensions directement.
 * Elle retourne les ajustements de distribution qui seront appliqués
 * au projet avant un recalcul complet du réseau.
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
  // Analyser le déséquilibre de courant
  const imbalanceAnalysis = analyzeCurrentImbalance(
    currentsPerPhase.A,
    currentsPerPhase.B,
    currentsPerPhase.C
  );
  
  console.log(`📊 EQUI8 nœud ${nodeId} - Analyse courant:`, {
    'I_A': `${imbalanceAnalysis.currents.A.toFixed(1)}A`,
    'I_B': `${imbalanceAnalysis.currents.B.toFixed(1)}A`,
    'I_C': `${imbalanceAnalysis.currents.C.toFixed(1)}A`,
    'Phase max': imbalanceAnalysis.maxPhase,
    'Phase min': imbalanceAnalysis.minPhase,
    'Déséquilibre': `${imbalanceAnalysis.imbalance_A.toFixed(1)}A (${imbalanceAnalysis.imbalancePercent.toFixed(1)}%)`,
    'I_neutre': `${imbalanceAnalysis.neutralCurrent_A.toFixed(1)}A`
  });
  
  // Si le courant neutre est sous le seuil de tolérance, pas de compensation
  if (imbalanceAnalysis.neutralCurrent_A <= compensator.tolerance_A) {
    console.log(`ℹ️ EQUI8 nœud ${nodeId}: I_N=${imbalanceAnalysis.neutralCurrent_A.toFixed(1)}A ≤ ${compensator.tolerance_A}A - Pas de compensation`);
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
  
  // Calculer la redistribution des charges
  const chargeRedistribution = calculateLoadRedistribution(
    currentMonoDistribution.charges,
    imbalanceAnalysis,
    compensator
  );
  
  // Pour les productions, on applique la même logique (inversée car elles injectent)
  // Les productions sur la phase max AUGMENTENT le déséquilibre, donc on les déplace aussi
  const productionRedistribution = calculateLoadRedistribution(
    currentMonoDistribution.productions,
    imbalanceAnalysis,
    compensator
  );
  
  const totalLoadShifted = chargeRedistribution.loadShifted_kVA + productionRedistribution.loadShifted_kVA;
  
  console.log(`🔄 EQUI8 nœud ${nodeId} - Redistribution:`, {
    'Phase max → min': `${imbalanceAnalysis.maxPhase} → ${imbalanceAnalysis.minPhase}`,
    'Charges déplacées': `${chargeRedistribution.loadShifted_kVA.toFixed(2)} kVA`,
    'Productions déplacées': `${productionRedistribution.loadShifted_kVA.toFixed(2)} kVA`,
    'Total déplacé': `${totalLoadShifted.toFixed(2)} kVA`,
    'Limité par puissance': chargeRedistribution.isLimited || productionRedistribution.isLimited
  });
  
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
 * Extrait les courants de phase depuis les résultats de calcul pour un nœud
 */
export function extractNodeCurrents(
  result: CalculationResult,
  project: Project,
  nodeId: string
): { A: Complex; B: Complex; C: Complex } | null {
  // Récupérer les câbles parents de ce nœud
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
    
    // Phases décalées de 120°
    I_A_total = add(I_A_total, fromPolar(I_A_mag, 0));
    I_B_total = add(I_B_total, fromPolar(I_B_mag, -2*Math.PI/3));
    I_C_total = add(I_C_total, fromPolar(I_C_mag, 2*Math.PI/3));
  }
  
  return { A: I_A_total, B: I_B_total, C: I_C_total };
}

/**
 * Extrait la distribution actuelle des charges mono pour un nœud
 */
export function extractNodeMonoDistribution(
  project: Project,
  nodeId: string
): { charges: { A: number; B: number; C: number }; productions: { A: number; B: number; C: number } } {
  // Chercher dans les distributions manuelles ou calculées
  const node = project.nodes.find(n => n.id === nodeId);
  
  if (node?.autoPhaseDistribution) {
    const dist = node.autoPhaseDistribution;
    return {
      charges: dist.charges?.mono || { A: 0, B: 0, C: 0 },
      productions: dist.productions?.mono || { A: 0, B: 0, C: 0 }
    };
  }
  
  // Distribution par défaut équilibrée
  return {
    charges: { A: 0, B: 0, C: 0 },
    productions: { A: 0, B: 0, C: 0 }
  };
}
