/**
 * ============================================================================
 * EQUI8 CME MODE - CURRENT SOURCE INJECTION MODEL
 * ============================================================================
 * 
 * 🔑 PRINCIPE FONDAMENTAL:
 * EQUI8 modifie les courants, JAMAIS les tensions directement.
 * L'EQUI8 agit comme une SOURCE DE COURANT shunt au nœud d'installation.
 * 
 * 📊 MODÈLE PHYSIQUE:
 * - +I_EQUI8 injecté sur le NEUTRE
 * - -I_EQUI8/3 soutiré sur chaque PHASE (A, B, C) avec orientation inverse
 * 
 * Les tensions résultent du recalcul BFS complet après injection.
 * 
 * 🧮 FORMULES CME (FOURNISSEUR - À RESPECTER STRICTEMENT):
 * 
 * ΔU_EQUI8 = [1/(0,9119 ln(Zph)+3,8654)] × ΔU_init × [2 Zph/(Zph+Zn)]
 * 
 * Ratio_ph = (Uinit_ph − Umoy)/ΔU_init
 * 
 * UEQUI8_ph = Umoy + Ratio_ph × ΔU_EQUI8
 * 
 * I_EQUI8 = 0,392 × Zph^(-0,8065) × ΔU_init × [2 Zph/(Zph+Zn)]
 * 
 * CONTRAINTES:
 * - Zph ≥ 0.15Ω, Zn ≥ 0.15Ω (sinon abort/alerte)
 * - Précision: ±2V sur tensions, ±5A sur courant
 * - Limites thermiques: 80A/15min, 60A/3h, 45A permanent
 * 
 * ============================================================================
 */

import { Node, Cable, Project, NeutralCompensator } from '@/types/network';
import { Complex, C, add, abs, fromPolar, arg, scale, normalize } from '@/utils/complex';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type EQUI8Mode = 'CME' | 'LOAD_SHIFT' | 'NONE';

export type EQUI8ThermalWindow = '15min' | '3h' | 'permanent';

export interface EQUI8CMEResult {
  // Cibles CME
  U_A_star: number;      // Tension cible phase A (V)
  U_B_star: number;      // Tension cible phase B (V)
  U_C_star: number;      // Tension cible phase C (V)
  
  // Métriques initiales
  Umoy: number;          // Tension moyenne initiale (V)
  deltaU_init: number;   // Écart initial Umax - Umin (V)
  deltaU_EQUI8: number;  // Écart cible après compensation (V)
  
  // Courant estimé CME
  I_EQ_est: number;      // Courant EQUI8 estimé (A)
  
  // Ratios par phase
  ratio_A: number;
  ratio_B: number;
  ratio_C: number;
  
  // Validation
  Zph_valid: boolean;
  Zn_valid: boolean;
  aborted: boolean;
  abortReason?: string;
}

export interface EQUI8Injection {
  nodeId: string;
  I_neutral: Complex;    // +I_EQUI8 sur neutre
  I_phaseA: Complex;     // -I_EQUI8/3 sur phase A
  I_phaseB: Complex;     // -I_EQUI8/3 sur phase B
  I_phaseC: Complex;     // -I_EQUI8/3 sur phase C
  magnitude: number;     // Magnitude de I_EQUI8
}

export interface EquivalentImpedances {
  Zph_ohm: number;       // Impédance équivalente phase (résistive)
  Zn_ohm: number;        // Impédance équivalente neutre (résistive)
  Zph_valid: boolean;
  Zn_valid: boolean;
}

export interface EQUI8CalibrationResult {
  converged: boolean;
  iterations: number;
  finalIinj: number;           // Courant final injecté (A)
  deltaU_achieved: number;     // Écart obtenu (V)
  deltaU_target: number;       // Écart cible (V)
  residual: number;            // |deltaU_achieved - deltaU_target| (V)
  thermalLimited: boolean;     // Limité par courant thermique
  thermalLimit: number;        // Limite thermique appliquée (A)
  voltagesAchieved: { A: number; B: number; C: number };
  voltagesTarget: { A: number; B: number; C: number };
}

// ============================================================================
// CONSTANTES
// ============================================================================

const CME_CLAMP_IMPEDANCE_MIN = 0.15; // Ω - Minimum Zph et Zn selon doc CME
const CME_TOLERANCE_V = 0.5;          // V - Tolérance de convergence
const CME_MAX_ITERATIONS = 20;        // Itérations max pour calibration

// Limites thermiques (A)
export const EQUI8_THERMAL_LIMITS: Record<EQUI8ThermalWindow, number> = {
  '15min': 80,
  '3h': 60,
  'permanent': 45
};

// ============================================================================
// CALCUL DES IMPÉDANCES ÉQUIVALENTES
// ============================================================================

/**
 * Calcule l'impédance équivalente au point d'installation EQUI8
 * en sommant les résistances des tronçons de la source jusqu'au nœud.
 * 
 * Note: Utilise uniquement R (et R0 pour neutre), pas X/X0.
 * La formule CME est basée sur les résistances résistives.
 */
export function computeEquivImpedancesToSource(
  nodeId: string,
  project: Project
): EquivalentImpedances {
  const { nodes, cables, cableTypes } = project;
  
  // Construire l'arbre de parcours
  const source = nodes.find(n => n.isSource);
  if (!source) {
    console.warn('⚠️ EQUI8 CME: Pas de nœud source trouvé');
    return { Zph_ohm: 0, Zn_ohm: 0, Zph_valid: false, Zn_valid: false };
  }
  
  // BFS pour trouver le chemin de la source au nœud
  const parent = new Map<string, string>();
  const parentCable = new Map<string, Cable>();
  const visited = new Set<string>();
  const queue: string[] = [source.id];
  visited.add(source.id);
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    // Trouver les câbles connectés
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
  if (!parent.has(nodeId) && nodeId !== source.id) {
    console.warn(`⚠️ EQUI8 CME: Nœud ${nodeId} non atteignable depuis la source`);
    return { Zph_ohm: 0, Zn_ohm: 0, Zph_valid: false, Zn_valid: false };
  }
  
  // Remonter le chemin et sommer les impédances
  let Zph_total = 0;
  let Zn_total = 0;
  let currentNodeId = nodeId;
  
  while (currentNodeId !== source.id) {
    const cable = parentCable.get(currentNodeId);
    if (!cable) break;
    
    const cableType = cableTypes.find(ct => ct.id === cable.typeId);
    if (!cableType) {
      console.warn(`⚠️ EQUI8 CME: Type de câble ${cable.typeId} non trouvé`);
      currentNodeId = parent.get(currentNodeId)!;
      continue;
    }
    
    // Calculer la longueur du câble
    let length_km = 0;
    if (cable.coordinates && cable.coordinates.length >= 2) {
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
        length_km += (R * c) / 1000;
      }
    }
    
    // Sommer les résistances selon formule GRD belge
    // Phases: R = (R0 + 2*R12) / 3 (formule ORES/RESA/Sibelga)
    // Neutre: R0 directement
    const R_grd = (cableType.R0_ohm_per_km + 2 * cableType.R12_ohm_per_km) / 3;
    Zph_total += R_grd * length_km;
    Zn_total += cableType.R0_ohm_per_km * length_km;
    
    currentNodeId = parent.get(currentNodeId)!;
  }
  
  // Vérifier les contraintes CME
  const Zph_valid = Zph_total >= CME_CLAMP_IMPEDANCE_MIN;
  const Zn_valid = Zn_total >= CME_CLAMP_IMPEDANCE_MIN;
  
  if (!Zph_valid) {
    console.warn(`⚠️ EQUI8 CME: Zph=${Zph_total.toFixed(4)}Ω < ${CME_CLAMP_IMPEDANCE_MIN}Ω (condition CME non satisfaite)`);
  }
  if (!Zn_valid) {
    console.warn(`⚠️ EQUI8 CME: Zn=${Zn_total.toFixed(4)}Ω < ${CME_CLAMP_IMPEDANCE_MIN}Ω (condition CME non satisfaite)`);
  }
  
  console.log(`📊 EQUI8 CME - Impédances équivalentes au nœud ${nodeId}:`, {
    Zph: `${Zph_total.toFixed(4)}Ω`,
    Zn: `${Zn_total.toFixed(4)}Ω`,
    Zph_valid,
    Zn_valid
  });
  
  return { Zph_ohm: Zph_total, Zn_ohm: Zn_total, Zph_valid, Zn_valid };
}

// ============================================================================
// CALCUL DES CIBLES CME
// ============================================================================

/**
 * Calcule les tensions cibles et le courant EQUI8 selon les formules CME
 * 
 * FORMULES FOURNISSEUR (EXACTES):
 * 
 * ΔU_EQUI8 = [1/(0,9119 × ln(Zph) + 3,8654)] × ΔU_init × [2 × Zph/(Zph + Zn)]
 * 
 * Ratio_ph = (Uinit_ph − Umoy) / ΔU_init
 * 
 * UEQUI8_ph = Umoy + Ratio_ph × ΔU_EQUI8
 * 
 * I_EQUI8 = 0,392 × Zph^(-0,8065) × ΔU_init × [2 × Zph/(Zph + Zn)]
 */
export function computeCME_UtargetsAndI(
  U1: number,   // Tension phase A (V)
  U2: number,   // Tension phase B (V)
  U3: number,   // Tension phase C (V)
  Zph: number,  // Impédance phase (Ω)
  Zn: number    // Impédance neutre (Ω)
): EQUI8CMEResult {
  // Vérifier et clamper les impédances
  const Zph_valid = Zph >= CME_CLAMP_IMPEDANCE_MIN;
  const Zn_valid = Zn >= CME_CLAMP_IMPEDANCE_MIN;
  
  if (!Zph_valid || !Zn_valid) {
    const reason = `Impédance insuffisante: Zph=${Zph.toFixed(4)}Ω, Zn=${Zn.toFixed(4)}Ω (min=${CME_CLAMP_IMPEDANCE_MIN}Ω)`;
    console.error(`❌ EQUI8 CME ABORT: ${reason}`);
    return {
      U_A_star: U1,
      U_B_star: U2,
      U_C_star: U3,
      Umoy: (U1 + U2 + U3) / 3,
      deltaU_init: Math.max(U1, U2, U3) - Math.min(U1, U2, U3),
      deltaU_EQUI8: 0,
      I_EQ_est: 0,
      ratio_A: 0,
      ratio_B: 0,
      ratio_C: 0,
      Zph_valid,
      Zn_valid,
      aborted: true,
      abortReason: reason
    };
  }
  
  // Clamper pour éviter les problèmes numériques
  const Zph_eff = Math.max(CME_CLAMP_IMPEDANCE_MIN, Zph);
  const Zn_eff = Math.max(CME_CLAMP_IMPEDANCE_MIN, Zn);
  
  // Métriques initiales
  const Umoy = (U1 + U2 + U3) / 3;
  const Umax = Math.max(U1, U2, U3);
  const Umin = Math.min(U1, U2, U3);
  const deltaU_init = Umax - Umin;
  
  // Si pas de déséquilibre, pas de compensation
  if (deltaU_init < 0.5) {
    console.log(`ℹ️ EQUI8 CME: Déséquilibre faible (ΔU=${deltaU_init.toFixed(2)}V < 0.5V), pas de compensation`);
    return {
      U_A_star: U1,
      U_B_star: U2,
      U_C_star: U3,
      Umoy,
      deltaU_init,
      deltaU_EQUI8: deltaU_init,
      I_EQ_est: 0,
      ratio_A: 0,
      ratio_B: 0,
      ratio_C: 0,
      Zph_valid: true,
      Zn_valid: true,
      aborted: false
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FORMULE CME: ΔU_EQUI8
  // ΔU_EQUI8 = [1/(0,9119 × ln(Zph) + 3,8654)] × ΔU_init × [2 × Zph/(Zph + Zn)]
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const lnZph = Math.log(Zph_eff);
  const denom = 0.9119 * lnZph + 3.8654;
  const facteur_impedance = (2 * Zph_eff) / (Zph_eff + Zn_eff);
  const deltaU_EQUI8 = (1 / denom) * deltaU_init * facteur_impedance;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RATIOS par phase
  // Ratio_ph = (Uinit_ph − Umoy) / ΔU_init
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const ratio_A = (U1 - Umoy) / deltaU_init;
  const ratio_B = (U2 - Umoy) / deltaU_init;
  const ratio_C = (U3 - Umoy) / deltaU_init;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TENSIONS CIBLES
  // UEQUI8_ph = Umoy + Ratio_ph × ΔU_EQUI8
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const U_A_star = Umoy + ratio_A * deltaU_EQUI8;
  const U_B_star = Umoy + ratio_B * deltaU_EQUI8;
  const U_C_star = Umoy + ratio_C * deltaU_EQUI8;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // COURANT EQUI8 ESTIMÉ
  // I_EQUI8 = 0,392 × Zph^(-0,8065) × ΔU_init × [2 × Zph/(Zph + Zn)]
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const I_EQ_est = 0.392 * Math.pow(Zph_eff, -0.8065) * deltaU_init * facteur_impedance;
  
  console.log(`📊 EQUI8 CME - Calcul formules fournisseur:`, {
    'Zph': `${Zph_eff.toFixed(4)}Ω`,
    'Zn': `${Zn_eff.toFixed(4)}Ω`,
    'ln(Zph)': lnZph.toFixed(4),
    'Dénominateur': denom.toFixed(4),
    'Facteur impédance': facteur_impedance.toFixed(4),
    'ΔU_init': `${deltaU_init.toFixed(2)}V`,
    'ΔU_EQUI8 (cible)': `${deltaU_EQUI8.toFixed(2)}V`,
    'I_EQUI8 (estimé)': `${I_EQ_est.toFixed(2)}A`,
    'U_A*': `${U_A_star.toFixed(2)}V`,
    'U_B*': `${U_B_star.toFixed(2)}V`,
    'U_C*': `${U_C_star.toFixed(2)}V`
  });
  
  return {
    U_A_star,
    U_B_star,
    U_C_star,
    Umoy,
    deltaU_init,
    deltaU_EQUI8,
    I_EQ_est,
    ratio_A,
    ratio_B,
    ratio_C,
    Zph_valid: true,
    Zn_valid: true,
    aborted: false
  };
}

// ============================================================================
// CONSTRUCTION DE L'INJECTION DE COURANT
// ============================================================================

/**
 * Construit l'injection de courant EQUI8 pour le BFS
 * 
 * Modèle physique:
 * - +I_EQUI8 sur le NEUTRE (injection)
 * - -I_EQUI8/3 sur chaque PHASE (soutirage)
 * 
 * Les phasors sont alignés sur les angles des phases respectives.
 */
export function buildEQUI8Injection(
  nodeId: string,
  Iinj_magnitude: number
): EQUI8Injection {
  // Angles de phase (radians)
  const angleA = 0;                    // 0°
  const angleB = -2 * Math.PI / 3;     // -120°
  const angleC = 2 * Math.PI / 3;      // +120°
  
  // Courant par phase (soutiré = négatif)
  const I_per_phase = -Iinj_magnitude / 3;
  
  // Phasors de courant
  const I_phaseA = fromPolar(I_per_phase, angleA);
  const I_phaseB = fromPolar(I_per_phase, angleB);
  const I_phaseC = fromPolar(I_per_phase, angleC);
  
  // Courant neutre (injecté = somme opposée des phases)
  // En pratique: I_N = -(I_A + I_B + I_C) pour équilibrer
  // Mais l'EQUI8 injecte un courant positif sur le neutre
  const I_neutral = C(Iinj_magnitude, 0); // Réel, aligné sur phase A
  
  return {
    nodeId,
    I_neutral,
    I_phaseA,
    I_phaseB,
    I_phaseC,
    magnitude: Iinj_magnitude
  };
}

// ============================================================================
// LIMITATION THERMIQUE
// ============================================================================

/**
 * Limite le courant selon la fenêtre temporelle
 */
export function clampByThermal(
  I_est: number,
  timeWindow: EQUI8ThermalWindow
): { I_clamped: number; limited: boolean; limit: number } {
  const limit = EQUI8_THERMAL_LIMITS[timeWindow];
  const limited = I_est > limit;
  const I_clamped = Math.min(I_est, limit);
  
  if (limited) {
    console.warn(`⚠️ EQUI8 CME: Courant estimé ${I_est.toFixed(1)}A limité à ${limit}A (fenêtre ${timeWindow})`);
  }
  
  return { I_clamped, limited, limit };
}

// ============================================================================
// MÉTHODE SÉCANTE POUR CALIBRATION (AVEC DAMPING)
// ============================================================================

/**
 * Facteur d'amortissement pour éviter l'oscillation lorsque SRG2 agit ensuite
 */
const SECANT_DAMPING_FACTOR = 0.7;

/**
 * Limitation de la variation de courant par itération (±20%)
 */
const SECANT_MAX_CHANGE_RATIO = 0.20;

/**
 * Ajuste le courant d'injection par méthode sécante avec damping
 * 
 * Le damping est nécessaire pour:
 * 1. Éviter l'oscillation lorsque SRG2 agit ensuite dans la boucle couplée
 * 2. Assurer une convergence stable même avec des impédances faibles
 * 3. Respecter strictement les bornes thermiques (80/60/45 A)
 * 
 * @param Iinj_current Courant d'injection actuel (A)
 * @param deltaU_achieved Écart de tension obtenu (V)
 * @param deltaU_target Écart de tension cible (V)
 * @param Iinj_prev Courant d'injection précédent (A)
 * @param deltaU_prev Écart de tension précédent (V)
 * @param thermalLimit Limite thermique (A)
 * @returns Nouveau courant d'injection (A)
 */
export function adjustSecant(
  Iinj_current: number,
  deltaU_achieved: number,
  deltaU_target: number,
  Iinj_prev: number,
  deltaU_prev: number,
  thermalLimit: number
): number {
  // Si première itération ou valeurs identiques, ajustement proportionnel amorti
  if (Iinj_prev === 0 || Math.abs(deltaU_achieved - deltaU_prev) < 1e-6) {
    const ratio = deltaU_target > 0 ? deltaU_achieved / deltaU_target : 1;
    // Ajustement proportionnel avec damping
    const rawAdjustment = Iinj_current * (1 + (1 - ratio) * 0.5);
    const dampedAdjustment = Iinj_current + (rawAdjustment - Iinj_current) * SECANT_DAMPING_FACTOR;
    return Math.min(dampedAdjustment, thermalLimit);
  }
  
  // Méthode sécante classique
  const slope = (deltaU_achieved - deltaU_prev) / (Iinj_current - Iinj_prev);
  if (Math.abs(slope) < 1e-6) {
    // Pente trop faible, petit incrément
    const smallStep = Iinj_current * 1.05;
    return Math.min(smallStep, thermalLimit);
  }
  
  const Iinj_raw = Iinj_current - (deltaU_achieved - deltaU_target) / slope;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DAMPING: Limiter la variation à ±20% par itération
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const deltaI = Iinj_raw - Iinj_current;
  const maxDelta = Math.abs(Iinj_current) * SECANT_MAX_CHANGE_RATIO;
  const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, deltaI));
  
  // Appliquer le facteur d'amortissement
  const dampedDelta = clampedDelta * SECANT_DAMPING_FACTOR;
  
  const Iinj_next = Iinj_current + dampedDelta;
  
  // Borner le résultat aux limites thermiques
  const result = Math.max(0, Math.min(Iinj_next, thermalLimit));
  
  // Log si limitation appliquée
  if (Math.abs(deltaI) > maxDelta) {
    console.log(`🔧 EQUI8 CME: ΔI_inj limité de ${deltaI.toFixed(2)}A à ${dampedDelta.toFixed(2)}A (damping ${SECANT_DAMPING_FACTOR})`);
  }
  
  return result;
}

// ============================================================================
// DIAGNOSTIC ET LOGS
// ============================================================================

/**
 * Log les métriques EQUI8 CME avec rappel des précisions
 */
export function logEQUI8CMEMetrics(
  compensatorId: string,
  nodeId: string,
  result: EQUI8CMEResult,
  calibration?: EQUI8CalibrationResult,
  thermalWindow?: EQUI8ThermalWindow
): void {
  console.log(`\n════════════════════════════════════════════════════════════════`);
  console.log(`📊 EQUI8 CME METRICS - Compensateur ${compensatorId} @ Nœud ${nodeId}`);
  console.log(`════════════════════════════════════════════════════════════════`);
  
  console.log(`📍 État initial:`);
  console.log(`   ΔU_init = ${result.deltaU_init.toFixed(2)}V`);
  console.log(`   Umoy = ${result.Umoy.toFixed(2)}V`);
  
  console.log(`🎯 Cibles CME:`);
  console.log(`   ΔU_EQUI8 (cible) = ${result.deltaU_EQUI8.toFixed(2)}V`);
  console.log(`   U_A* = ${result.U_A_star.toFixed(2)}V`);
  console.log(`   U_B* = ${result.U_B_star.toFixed(2)}V`);
  console.log(`   U_C* = ${result.U_C_star.toFixed(2)}V`);
  console.log(`   I_EQUI8 (estimé) = ${result.I_EQ_est.toFixed(2)}A`);
  
  if (calibration) {
    console.log(`🔧 Calibration BFS:`);
    console.log(`   Convergence: ${calibration.converged ? '✅ OUI' : '❌ NON'}`);
    console.log(`   Itérations: ${calibration.iterations}`);
    console.log(`   ΔU obtenu = ${calibration.deltaU_achieved.toFixed(2)}V`);
    console.log(`   Résidu = ${calibration.residual.toFixed(3)}V`);
    console.log(`   I_inj final = ${calibration.finalIinj.toFixed(2)}A`);
    console.log(`   U_A final = ${calibration.voltagesAchieved.A.toFixed(2)}V (cible: ${result.U_A_star.toFixed(2)}V)`);
    console.log(`   U_B final = ${calibration.voltagesAchieved.B.toFixed(2)}V (cible: ${result.U_B_star.toFixed(2)}V)`);
    console.log(`   U_C final = ${calibration.voltagesAchieved.C.toFixed(2)}V (cible: ${result.U_C_star.toFixed(2)}V)`);
    
    if (calibration.thermalLimited) {
      console.warn(`   ⚠️ LIMITÉ THERMIQUEMENT à ${calibration.thermalLimit}A (fenêtre: ${thermalWindow})`);
    }
  }
  
  console.log(`📋 Précisions attendues:`);
  console.log(`   Tension: ±2V`);
  console.log(`   Courant: ±5A`);
  console.log(`   Limites: 80A/15min, 60A/3h, 45A permanent`);
  console.log(`════════════════════════════════════════════════════════════════\n`);
}

// ============================================================================
// VALIDATION COHÉRENCE
// ============================================================================

/**
 * Vérifie la cohérence des résultats CME vs BFS
 */
export function validateCMECoherence(
  result: EQUI8CMEResult,
  bfsVoltages: { A: number; B: number; C: number },
  tolerance_V: number = 2.0
): { valid: boolean; errors: { A: number; B: number; C: number } } {
  const errors = {
    A: Math.abs(bfsVoltages.A - result.U_A_star),
    B: Math.abs(bfsVoltages.B - result.U_B_star),
    C: Math.abs(bfsVoltages.C - result.U_C_star)
  };
  
  const valid = errors.A <= tolerance_V && errors.B <= tolerance_V && errors.C <= tolerance_V;
  
  if (!valid) {
    console.warn(`⚠️ EQUI8 CME: Écart cible vs BFS supérieur à ${tolerance_V}V`);
    console.warn(`   Erreur A: ${errors.A.toFixed(2)}V`);
    console.warn(`   Erreur B: ${errors.B.toFixed(2)}V`);
    console.warn(`   Erreur C: ${errors.C.toFixed(2)}V`);
  }
  
  return { valid, errors };
}
