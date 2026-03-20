/**
 * ============================================================================
 * SRG2Regulator — Classe de régulation de tension BT
 * ============================================================================
 *
 * Modèle réaliste du régulateur SRG2 (autotransformateur à prises multiples) :
 *  - Échelons discrets : LO2 / LO1 / BYP / BO1 / BO2
 *  - Hystérésis ±2 V pour éviter les oscillations
 *  - Temporisation 7 s (compteur par phase)
 *  - Mode bypass d'urgence (< 165 V → BYP immédiat, retour > 185 V)
 *  - Contraintes SRG2-230 : pas de boost+buck simultanés
 *  - Limite de puissance aval (85 kVA injection, 100 kVA charge)
 *  - Logs de changement d'état
 *
 * Deux types :
 *   SRG2-400 (3N400V, phase-neutre) : ±7 % en 2×3.5 %, régulation indépendante
 *   SRG2-230 (3×230V, phase-phase) : ±6 % en 2×3 %, contraintes inter-phases
 *
 * Compatible avec le BFS via injection de tension série :
 *   V_aval = V_amont − Z·I + V_série
 * ============================================================================
 */

import { Complex, C, abs, arg, fromPolar } from '@/utils/complex';
import {
  SRG2Config,
  SRG2SwitchState,
  DEFAULT_SRG2_400_CONFIG,
  DEFAULT_SRG2_230_CONFIG,
} from '@/types/srg2';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Ordered tap positions for arithmetic comparisons */
const TAP_ORDER: SRG2SwitchState[] = ['BO2', 'BO1', 'BYP', 'LO1', 'LO2'];

type Phase = 'A' | 'B' | 'C';
const PHASES: Phase[] = ['A', 'B', 'C'];

/** Phase angles (rad) for phasor construction */
const PHASE_ANGLES: Record<Phase, number> = {
  A: 0,
  B: -2 * Math.PI / 3,
  C: 2 * Math.PI / 3,
};

/** Bypass d'urgence */
const BYPASS_ENTER_V = 165;
const BYPASS_RETURN_V = 185;

/** Coefficient total max autorisé (%) */
const MAX_COEFF_PERCENT = 10;

// ─── Interfaces résultat ─────────────────────────────────────────────────────

export interface SRG2PhaseResult {
  state: SRG2SwitchState;
  coefficient: number;       // % appliqué
  Vin: number;               // tension d'entrée (V)
  Vout: number;              // tension de sortie (V)
  Vserie: Complex;           // tension série injectée (phasor)
  bypassForce: boolean;      // true si bypass d'urgence actif
}

export interface SRG2RegulationResult {
  phases: Record<Phase, SRG2PhaseResult>;
  isActive: boolean;         // au moins une phase ≠ BYP
  tapChanged: boolean;       // changement de prise détecté
  constraintsApplied: boolean; // contraintes SRG2-230 actives
  log: string[];             // messages de log
}

// ─── Classe SRG2Regulator ────────────────────────────────────────────────────

export class SRG2Regulator {
  private config: SRG2Config;

  /** État courant du commutateur par phase */
  private currentTap: Record<Phase, SRG2SwitchState> = { A: 'BYP', B: 'BYP', C: 'BYP' };

  /** Compteurs de temporisation par phase (en secondes cumulées) */
  private timers: Record<Phase, number> = { A: 0, B: 0, C: 0 };

  /** Tap cible (en attente de temporisation) */
  private pendingTap: Record<Phase, SRG2SwitchState | null> = { A: null, B: null, C: null };

  /** Bypass d'urgence actif par phase */
  private emergencyBypass: Record<Phase, boolean> = { A: false, B: false, C: false };

  /** Logs du dernier update */
  private logs: string[] = [];

  constructor(config: SRG2Config) {
    this.config = { ...config };
  }

  // ─── Accesseurs ──────────────────────────────────────────────────────────

  get id(): string { return this.config.id; }
  get nodeId(): string { return this.config.nodeId; }
  get type(): string { return this.config.type; }

  /** Retourne l'état courant des prises */
  getCurrentTaps(): Record<Phase, SRG2SwitchState> {
    return { ...this.currentTap };
  }

  /** Réinitialise toutes les phases en BYP */
  reset(): void {
    for (const p of PHASES) {
      this.currentTap[p] = 'BYP';
      this.timers[p] = 0;
      this.pendingTap[p] = null;
      this.emergencyBypass[p] = false;
    }
  }

  /** Initialise les prises à un état donné (ex: reprise de simulation) */
  setTaps(taps: Record<Phase, SRG2SwitchState>): void {
    for (const p of PHASES) {
      this.currentTap[p] = taps[p];
      this.timers[p] = 0;
      this.pendingTap[p] = null;
    }
  }

  // ─── Méthode principale ──────────────────────────────────────────────────

  /**
   * Met à jour le régulateur avec les tensions mesurées.
   *
   * @param voltages - Tensions phase-neutre (ou phase-phase pour SRG2-230) en V
   * @param dt       - Pas de temps en secondes (pour la temporisation).
   *                   En régime stationnaire (BFS), passer dt ≥ temporisation_s
   *                   pour obtenir un changement immédiat.
   * @returns Résultat de régulation avec tensions série
   */
  update(
    voltages: Record<Phase, number>,
    dt: number = 10  // par défaut > 7s → commutation immédiate
  ): SRG2RegulationResult {
    this.logs = [];
    const prevTaps = { ...this.currentTap };
    const phaseResults: Record<Phase, SRG2PhaseResult> = {} as any;

    // ── Étape 1 : Calcul du tap cible par phase ─────────────────────────
    const targetTaps: Record<Phase, SRG2SwitchState> = {} as any;

    for (const p of PHASES) {
      const V = voltages[p];

      // Bypass d'urgence : V < 165V
      if (V < BYPASS_ENTER_V) {
        this.emergencyBypass[p] = true;
        targetTaps[p] = 'BYP';
        this.log(`🚨 Phase ${p}: V=${V.toFixed(1)}V < ${BYPASS_ENTER_V}V → BYPASS D'URGENCE`);
        continue;
      }

      // Retour de bypass d'urgence : V > 185V
      if (this.emergencyBypass[p]) {
        if (V > BYPASS_RETURN_V) {
          this.emergencyBypass[p] = false;
          this.log(`✅ Phase ${p}: V=${V.toFixed(1)}V > ${BYPASS_RETURN_V}V → fin bypass urgence`);
        } else {
          targetTaps[p] = 'BYP';
          continue;
        }
      }

      // Déterminer le tap cible avec hystérésis
      targetTaps[p] = this.computeTargetTapWithHysteresis(V, this.currentTap[p]);
    }

    // ── Étape 2 : Contraintes SRG2-230 (pas de boost+buck simultanés) ───
    let constraintsApplied = false;
    constraintsApplied = this.applySRG230Constraints(targetTaps, voltages);

    // ── Étape 3 : Vérification limite ±10% ──────────────────────────────
    for (const p of PHASES) {
      const coeff = this.getCoefficient(targetTaps[p]);
      if (Math.abs(coeff) > MAX_COEFF_PERCENT) {
        this.log(`⚠️ Phase ${p}: coeff ${coeff}% > ±${MAX_COEFF_PERCENT}% → BYP`);
        targetTaps[p] = 'BYP';
      }
    }

    // ── Étape 4 : Temporisation (7s) ────────────────────────────────────
    for (const p of PHASES) {
      const target = targetTaps[p];

      // Bypass d'urgence = commutation immédiate (pas de temporisation)
      if (this.emergencyBypass[p]) {
        this.currentTap[p] = 'BYP';
        this.timers[p] = 0;
        this.pendingTap[p] = null;
        continue;
      }

      if (target === this.currentTap[p]) {
        // Pas de changement demandé → reset timer
        this.timers[p] = 0;
        this.pendingTap[p] = null;
      } else if (target === this.pendingTap[p]) {
        // Même cible que précédemment → accumuler le temps
        this.timers[p] += dt;
        if (this.timers[p] >= this.config.temporisation_s) {
          // Temporisation écoulée → commuter
          this.log(
            `⏱️ Phase ${p}: temporisation OK (${this.timers[p].toFixed(1)}s ≥ ${this.config.temporisation_s}s) ` +
            `→ ${this.currentTap[p]} → ${target}`
          );
          this.currentTap[p] = target;
          this.timers[p] = 0;
          this.pendingTap[p] = null;
        }
      } else {
        // Nouvelle cible → redémarrer le timer
        this.pendingTap[p] = target;
        this.timers[p] = dt;
        if (dt >= this.config.temporisation_s) {
          // Commutation immédiate si dt suffisant
          this.currentTap[p] = target;
          this.timers[p] = 0;
          this.pendingTap[p] = null;
        }
      }
    }

    // ── Étape 5 : Calcul des tensions série ─────────────────────────────
    let tapChanged = false;
    for (const p of PHASES) {
      if (this.currentTap[p] !== prevTaps[p]) {
        tapChanged = true;
        this.log(
          `🔧 Phase ${p}: prise ${prevTaps[p]} → ${this.currentTap[p]} ` +
          `(V_in=${voltages[p].toFixed(1)}V)`
        );
      }

      const coeff = this.getCoefficient(this.currentTap[p]);
      const Vin = voltages[p];
      const VserieMag = (coeff / 100) * 230; // Tension série = coeff × Vnom
      const Vserie = fromPolar(VserieMag, PHASE_ANGLES[p]);
      const Vout = Vin + VserieMag; // Approximation scalaire

      phaseResults[p] = {
        state: this.currentTap[p],
        coefficient: coeff,
        Vin,
        Vout,
        Vserie,
        bypassForce: this.emergencyBypass[p],
      };
    }

    const isActive = PHASES.some(p => this.currentTap[p] !== 'BYP');

    return {
      phases: phaseResults,
      isActive,
      tapChanged,
      constraintsApplied,
      log: [...this.logs],
    };
  }

  // ─── Logique de seuils avec hystérésis ───────────────────────────────────

  /**
   * Détermine le tap cible en tenant compte de l'hystérésis.
   * Le SRG2 ne change de prise que si la tension sort de la zone
   * d'hystérésis de la position actuelle.
   */
  private computeTargetTapWithHysteresis(
    V: number,
    currentState: SRG2SwitchState
  ): SRG2SwitchState {
    const { seuilLO2_V, seuilLO1_V, seuilBO1_V, seuilBO2_V } = this.config;
    const h = this.config.hysteresis_V || 2;

    switch (currentState) {
      case 'LO2':
        // En abaissement max → rester sauf si tension descend sous seuil LO1
        if (V < seuilLO1_V - h) return 'LO1';
        if (V < seuilBO1_V + h) return 'BYP';
        return 'LO2';

      case 'LO1':
        // En abaissement partiel
        if (V >= seuilLO2_V + h) return 'LO2';
        if (V < seuilBO1_V + h) return 'BYP';
        return 'LO1';

      case 'BYP':
        // En bypass → évaluer si régulation nécessaire
        if (V >= seuilLO2_V + h) return 'LO2';
        if (V >= seuilLO1_V + h) return 'LO1';
        if (V <= seuilBO2_V - h) return 'BO2';
        if (V <= seuilBO1_V - h) return 'BO1';
        return 'BYP';

      case 'BO1':
        // En boost partiel
        if (V <= seuilBO2_V - h) return 'BO2';
        if (V > seuilLO1_V - h) return 'BYP';
        return 'BO1';

      case 'BO2':
        // En boost max → rester sauf si tension monte au-dessus seuil BO1
        if (V > seuilBO1_V + h) return 'BO1';
        if (V > seuilLO1_V - h) return 'BYP';
        return 'BO2';

      default:
        return this.computeTargetTapNoHysteresis(V);
    }
  }

  /** Détermination sans hystérésis (état initial ou fallback) */
  private computeTargetTapNoHysteresis(V: number): SRG2SwitchState {
    const { seuilLO2_V, seuilLO1_V, seuilBO1_V, seuilBO2_V } = this.config;
    if (V >= seuilLO2_V) return 'LO2';
    if (V >= seuilLO1_V) return 'LO1';
    if (V <= seuilBO2_V) return 'BO2';
    if (V <= seuilBO1_V) return 'BO1';
    return 'BYP';
  }

  // ─── Contraintes SRG2-230 ────────────────────────────────────────────────

  /**
   * Applique les contraintes inter-phases :
   *  - Pas de boost et buck simultanés sur des phases différentes
   *  - Priorité à la phase avec le plus grand écart à 230V
   *  - Mode commun (alignement conservateur) quand toutes les phases
   *    vont dans le même sens
   *
   * @returns true si des contraintes ont été appliquées
   */
  private applySRG230Constraints(
    taps: Record<Phase, SRG2SwitchState>,
    voltages: Record<Phase, number>
  ): boolean {
    const isBoost = (s: SRG2SwitchState) => s === 'BO1' || s === 'BO2';
    const isLower = (s: SRG2SwitchState) => s === 'LO1' || s === 'LO2';

    const hasBoost = PHASES.some(p => isBoost(taps[p]));
    const hasLower = PHASES.some(p => isLower(taps[p]));

    let applied = false;

    // Mode commun : aligner sur le niveau le plus conservateur
    const allBoost = PHASES.every(p => isBoost(taps[p]));
    const allLower = PHASES.every(p => isLower(taps[p]));

    if (allBoost) {
      const hasBO1 = PHASES.some(p => taps[p] === 'BO1');
      if (hasBO1) {
        for (const p of PHASES) taps[p] = 'BO1';
        this.log(`[CONTRAINTE] Mode commun BOOST → BO1 (conservateur)`);
        applied = true;
      }
    } else if (allLower) {
      const hasLO1 = PHASES.some(p => taps[p] === 'LO1');
      if (hasLO1) {
        for (const p of PHASES) taps[p] = 'LO1';
        this.log(`[CONTRAINTE] Mode commun LOWER → LO1 (conservateur)`);
        applied = true;
      }
    }

    // Conflit boost + buck → priorité au sens dominant
    if (hasBoost && hasLower) {
      const avgV = (voltages.A + voltages.B + voltages.C) / 3;
      const consigne = this.config.tensionConsigne_V;

      if (avgV > consigne) {
        // Tensions hautes → privilégier lower, bloquer boost
        for (const p of PHASES) {
          if (isBoost(taps[p])) taps[p] = 'BYP';
        }
        this.log(`[CONTRAINTE] Conflit BO/LO → LOWER prioritaire (Uavg=${avgV.toFixed(1)}V)`);
      } else {
        // Tensions basses → privilégier boost, bloquer lower
        for (const p of PHASES) {
          if (isLower(taps[p])) taps[p] = 'BYP';
        }
        this.log(`[CONTRAINTE] Conflit BO/LO → BOOST prioritaire (Uavg=${avgV.toFixed(1)}V)`);
      }
      applied = true;
    }

    return applied;
  }

  // ─── Utilitaires ─────────────────────────────────────────────────────────

  /** Retourne le coefficient (%) pour un état de prise */
  getCoefficient(state: SRG2SwitchState): number {
    switch (state) {
      case 'LO2': return this.config.coefficientLO2;
      case 'LO1': return this.config.coefficientLO1;
      case 'BYP': return 0;
      case 'BO1': return this.config.coefficientBO1;
      case 'BO2': return this.config.coefficientBO2;
    }
  }

  /** Retourne les tensions série par phase sous forme de Record de Complex */
  getSerieVoltages(): Record<Phase, Complex> {
    const result: Record<Phase, Complex> = {} as any;
    for (const p of PHASES) {
      const coeff = this.getCoefficient(this.currentTap[p]);
      const VserieMag = (coeff / 100) * 230;
      result[p] = fromPolar(VserieMag, PHASE_ANGLES[p]);
    }
    return result;
  }

  /** Vérifie la limite de puissance aval */
  checkPowerLimit(
    downstreamPower_kVA: number,
    mode: 'injection' | 'charge'
  ): boolean {
    const limit = mode === 'injection'
      ? this.config.puissanceMaxInjection_kVA
      : this.config.puissanceMaxPrelevement_kVA;
    return downstreamPower_kVA <= limit;
  }

  private log(msg: string): void {
    this.logs.push(`[SRG2 ${this.config.id}] ${msg}`);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Crée un SRG2Regulator configuré selon le système de tension.
 */
export function createSRG2Regulator(
  nodeId: string,
  voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V',
  overrides?: Partial<SRG2Config>
): SRG2Regulator {
  const defaults = voltageSystem === 'TÉTRAPHASÉ_400V'
    ? DEFAULT_SRG2_400_CONFIG
    : DEFAULT_SRG2_230_CONFIG;

  const config: SRG2Config = {
    id: `srg2-${Date.now()}`,
    nodeId,
    name: `SRG2 ${nodeId}`,
    enabled: true,
    ...defaults,
    ...overrides,
  } as SRG2Config;

  return new SRG2Regulator(config);
}
