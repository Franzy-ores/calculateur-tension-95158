/**
 * ============================================================================
 * SRG2 : MODÈLE D'INJECTION DE TENSION SÉRIE
 * ============================================================================
 * 
 * 🧠 PRINCIPE PHYSIQUE:
 * Le SRG2 est un autotransformateur à prises multiples qui injecte une tension
 * SÉRIE dans la branche. Contrairement à l'ancien modèle qui imposait des
 * tensions aux nœuds, ce modèle respecte la physique du réseau :
 * 
 *   V_aval = V_amont - Z × I + V_série
 * 
 * Où V_série est la tension injectée par le SRG2 (positive = boost, négative = buck).
 * 
 * 🔧 MODÉLISATION:
 * - EQUI8 = injection de courant shunt au nœud (modifie I)
 * - SRG2 = injection de tension série dans la branche (modifie V directement)
 * - Aucun nœud n'a de tension imposée artificiellement
 * 
 * 📊 ÉCHELONS DE RÉGULATION (SRG2-400):
 * - LO2: -7% (abaissement complet) → seuil 246V
 * - LO1: -3.5% (abaissement partiel) → seuil 238V
 * - BYP: 0% (bypass)
 * - BO1: +3.5% (augmentation partielle) → seuil 222V
 * - BO2: +7% (augmentation complète) → seuil 214V
 * 
 * ============================================================================
 */

import { Complex, C, abs, arg, fromPolar, scale, normalize } from '@/utils/complex';
import { SRG2Config, SRG2SwitchState, DEFAULT_SRG2_400_CONFIG, DEFAULT_SRG2_230_CONFIG } from '@/types/srg2';

/**
 * Calcule la tension série à injecter par le SRG2 pour une phase donnée.
 * 
 * @param VnodeMeasured - Tension mesurée au nœud SRG2 (phasor complexe, V)
 * @param targetVoltage - Tension cible (V, typiquement 230V)
 * @param maxStepPercent - Échelon maximum autorisé (%, typiquement ±7%)
 * @param Vnominal - Tension nominale du système (V, 230V ou 400V)
 * @returns Tension série à injecter (phasor complexe, V)
 * 
 * 🧮 FORMULE:
 *   error = target - |V_measured|
 *   step = clamp(error / V_nominal, -max%, +max%)
 *   V_série = step × V_nominal × (V_measured / |V_measured|)
 * 
 * La tension série est alignée avec la tension mesurée (même angle).
 */
export function computeSRG2SerieVoltage(
  VnodeMeasured: Complex,
  targetVoltage: number,
  maxStepPercent: number,
  Vnominal: number
): Complex {
  const Vmag = abs(VnodeMeasured);
  
  // Éviter division par zéro
  if (Vmag < 1e-6) {
    console.warn('⚠️ SRG2: Tension mesurée nulle, pas d\'injection');
    return C(0, 0);
  }
  
  // Calculer l'erreur de tension
  const error_V = targetVoltage - Vmag;
  
  // Calculer le step requis (en fraction, pas en %)
  const stepRequired = error_V / Vnominal;
  
  // Clamper au step maximum autorisé
  const maxStep = maxStepPercent / 100;
  const stepClamped = Math.max(-maxStep, Math.min(maxStep, stepRequired));
  
  // Magnitude de la tension série à injecter
  const VserieMag = stepClamped * Vnominal;
  
  // Conserver l'angle de la tension mesurée (injection en phase)
  const angleRad = arg(VnodeMeasured);
  
  const Vserie = fromPolar(VserieMag, angleRad);
  
  if (Math.abs(VserieMag) > 0.1) {
    console.log(`🔧 SRG2 computeSerieVoltage: ` +
      `V_mesuré=${Vmag.toFixed(1)}V, cible=${targetVoltage}V, ` +
      `erreur=${error_V.toFixed(1)}V, step=${(stepClamped*100).toFixed(1)}%, ` +
      `V_série=${VserieMag.toFixed(1)}V`);
  }
  
  return Vserie;
}

/**
 * Détermine l'état du commutateur SRG2 basé sur la tension mesurée et les seuils.
 * Inclut l'hystérésis pour éviter les oscillations.
 * 
 * @param Vmeasured - Tension mesurée (V)
 * @param srg2Config - Configuration du SRG2
 * @param previousState - État précédent du commutateur (pour hystérésis)
 * @returns Nouvel état du commutateur et coefficient de régulation (%)
 */
export function determineSRG2SwitchState(
  Vmeasured: number,
  srg2Config: SRG2Config,
  previousState?: SRG2SwitchState
): { state: SRG2SwitchState; coefficient: number } {
  const { seuilLO2_V, seuilLO1_V, seuilBO1_V, seuilBO2_V } = srg2Config;
  const { coefficientLO2, coefficientLO1, coefficientBO1, coefficientBO2 } = srg2Config;
  const hyst = srg2Config.hysteresis_V || 2;

  // Surtension (abaissement requis)
  // Hystérésis : pour QUITTER l'état, la tension doit redescendre de hyst sous le seuil
  if (Vmeasured >= seuilLO2_V - (previousState === 'LO2' ? hyst : 0)) {
    return { state: 'LO2', coefficient: coefficientLO2 };
  }
  if (Vmeasured >= seuilLO1_V - (previousState === 'LO1' ? hyst : 0)) {
    return { state: 'LO1', coefficient: coefficientLO1 };
  }

  // Sous-tension (augmentation requise)
  // Hystérésis : pour QUITTER l'état, la tension doit remonter de hyst au-dessus du seuil
  if (Vmeasured <= seuilBO2_V + (previousState === 'BO2' ? hyst : 0)) {
    return { state: 'BO2', coefficient: coefficientBO2 };
  }
  if (Vmeasured <= seuilBO1_V + (previousState === 'BO1' ? hyst : 0)) {
    return { state: 'BO1', coefficient: coefficientBO1 };
  }

  // Dans la plage normale → bypass
  return { state: 'BYP', coefficient: 0 };
}

/**
 * Calcule les tensions série à injecter pour les 3 phases du SRG2.
 * 
 * @param srg2Config - Configuration du SRG2
 * @param voltagesPerPhase - Tensions mesurées par phase (V)
 * @param previousStates - États précédents des commutateurs (pour hystérésis)
 * @returns Tensions série par phase et nouveaux états des commutateurs
 */
export function computeSRG2SerieVoltagesAllPhases(
  srg2Config: SRG2Config,
  voltagesPerPhase: { A: number; B: number; C: number },
  previousStates?: { A?: SRG2SwitchState; B?: SRG2SwitchState; C?: SRG2SwitchState }
): {
  serieVoltages: { A: Complex; B: Complex; C: Complex };
  switchStates: { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState };
  coefficients: { A: number; B: number; C: number };
  outputVoltages: { A: number; B: number; C: number };
} {
  const target = srg2Config.tensionConsigne_V;
  const maxStep = Math.abs(srg2Config.coefficientLO2); // ±7% pour SRG2-400, ±6% pour SRG2-230
  const Vnom = srg2Config.type === 'SRG2-400' ? 230 : 230; // Tension nominale phase-neutre
  
  // Angles des phases (0°, -120°, +120°)
  const phaseAngles = { A: 0, B: -120 * Math.PI / 180, C: 120 * Math.PI / 180 };
  
  // Calculer pour chaque phase
  const calculateForPhase = (
    Vmag: number,
    angleRad: number,
    prevState?: SRG2SwitchState
  ): { Vserie: Complex; state: SRG2SwitchState; coeff: number; Vout: number } => {
    // Déterminer l'état du commutateur
    const { state, coefficient } = determineSRG2SwitchState(Vmag, srg2Config, prevState);
    
    // Créer le phasor de tension mesurée
    const Vmeasured = fromPolar(Vmag, angleRad);
    
    // Calculer la tension série (utilise le coefficient réel, pas le max)
    const stepPercent = Math.abs(coefficient);
    const Vserie = computeSRG2SerieVoltage(Vmeasured, target, stepPercent, Vnom);
    
    // Calculer la tension de sortie
    const Vout = Vmag + abs(Vserie) * Math.sign(coefficient);
    
    return { Vserie, state, coeff: coefficient, Vout };
  };
  
  const resA = calculateForPhase(voltagesPerPhase.A, phaseAngles.A, previousStates?.A);
  const resB = calculateForPhase(voltagesPerPhase.B, phaseAngles.B, previousStates?.B);
  const resC = calculateForPhase(voltagesPerPhase.C, phaseAngles.C, previousStates?.C);
  
  return {
    serieVoltages: { A: resA.Vserie, B: resB.Vserie, C: resC.Vserie },
    switchStates: { A: resA.state, B: resB.state, C: resC.state },
    coefficients: { A: resA.coeff, B: resB.coeff, C: resC.coeff },
    outputVoltages: { A: resA.Vout, B: resB.Vout, C: resC.Vout }
  };
}

/**
 * Vérifie si le SRG2 a stabilisé (pas de changement de prise entre deux itérations).
 * 
 * @param currentStates - États actuels des commutateurs
 * @param previousStates - États précédents des commutateurs
 * @returns true si stabilisé (aucun changement)
 */
export function isSRG2Stabilized(
  currentStates: { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState },
  previousStates?: { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }
): boolean {
  if (!previousStates) return false;
  
  return (
    currentStates.A === previousStates.A &&
    currentStates.B === previousStates.B &&
    currentStates.C === previousStates.C
  );
}

/**
 * Crée une configuration SRG2 par défaut basée sur le système de tension.
 * 
 * @param nodeId - ID du nœud où installer le SRG2
 * @param voltageSystem - 'TRIPHASÉ_230V' ou 'TÉTRAPHASÉ_400V'
 * @returns Configuration SRG2 complète
 */
export function createDefaultSRG2Config(
  nodeId: string,
  voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V'
): SRG2Config {
  const defaults = voltageSystem === 'TÉTRAPHASÉ_400V'
    ? DEFAULT_SRG2_400_CONFIG
    : DEFAULT_SRG2_230_CONFIG;
  
  return {
    id: `srg2-${Date.now()}`,
    nodeId,
    name: `SRG2 ${nodeId}`,
    enabled: true,
    ...defaults
  } as SRG2Config;
}

/**
 * Log les métriques SRG2 pour débogage.
 */
export function logSRG2Metrics(
  srg2Id: string,
  phase: 'A' | 'B' | 'C',
  Vin: number,
  Vout: number,
  Vserie: number,
  state: SRG2SwitchState,
  coefficient: number
): void {
  console.log(
    `📊 SRG2 ${srg2Id} phase ${phase}: ` +
    `Vin=${Vin.toFixed(1)}V → Vout=${Vout.toFixed(1)}V ` +
    `(Vserie=${Vserie >= 0 ? '+' : ''}${Vserie.toFixed(1)}V, ` +
    `état=${state}, coeff=${coefficient >= 0 ? '+' : ''}${coefficient}%)`
  );
}
