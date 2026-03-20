/**
 * Tests unitaires pour SRG2Regulator
 */
import { describe, it, expect } from 'vitest';
import { SRG2Regulator, createSRG2Regulator } from '@/utils/srg2Regulator';
import { DEFAULT_SRG2_400_CONFIG, DEFAULT_SRG2_230_CONFIG, SRG2Config } from '@/types/srg2';

function make400Config(overrides?: Partial<SRG2Config>): SRG2Config {
  return {
    id: 'test-srg2',
    nodeId: 'N1',
    name: 'Test SRG2',
    enabled: true,
    ...DEFAULT_SRG2_400_CONFIG,
    ...overrides,
  } as SRG2Config;
}

describe('SRG2Regulator', () => {
  // ── Commutation de base ────────────────────────────────────────────────
  it('reste en BYP quand tensions normales (230V)', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 230, B: 230, C: 230 });
    expect(res.phases.A.state).toBe('BYP');
    expect(res.phases.B.state).toBe('BYP');
    expect(res.phases.C.state).toBe('BYP');
    expect(res.isActive).toBe(false);
  });

  it('passe en LO2 quand surtension ≥ 246V + hystérésis', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 250, B: 250, C: 250 });
    expect(res.phases.A.state).toBe('LO2');
    expect(res.phases.A.coefficient).toBe(-7);
  });

  it('passe en BO2 quand sous-tension ≤ 214V − hystérésis', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 210, B: 210, C: 210 });
    expect(res.phases.A.state).toBe('BO2');
    expect(res.phases.A.coefficient).toBe(7);
  });

  it('passe en LO1 pour tension intermédiaire haute (240V)', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 242, B: 242, C: 242 });
    expect(res.phases.A.state).toBe('LO1');
    expect(res.phases.A.coefficient).toBe(-3.5);
  });

  it('passe en BO1 pour tension intermédiaire basse (218V)', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 218, B: 218, C: 218 });
    expect(res.phases.A.state).toBe('BO1');
    expect(res.phases.A.coefficient).toBe(3.5);
  });

  // ── Hystérésis ─────────────────────────────────────────────────────────
  it('hystérésis empêche oscillation autour du seuil LO1', () => {
    const reg = new SRG2Regulator(make400Config());
    // Passer en LO1
    reg.update({ A: 242, B: 230, C: 230 });
    expect(reg.getCurrentTaps().A).toBe('LO1');

    // Légère baisse → doit rester en LO1 (hystérésis)
    const res2 = reg.update({ A: 237, B: 230, C: 230 });
    expect(res2.phases.A.state).toBe('LO1');
    expect(res2.tapChanged).toBe(false);
  });

  // ── Bypass d'urgence ───────────────────────────────────────────────────
  it('bypass d\'urgence si V < 165V', () => {
    const reg = new SRG2Regulator(make400Config());
    // Mettre en BO2 d'abord
    reg.update({ A: 210, B: 230, C: 230 });
    
    // Chute brutale → bypass immédiat
    const res = reg.update({ A: 160, B: 230, C: 230 });
    expect(res.phases.A.state).toBe('BYP');
    expect(res.phases.A.bypassForce).toBe(true);
  });

  it('retour de bypass d\'urgence si V > 185V', () => {
    const reg = new SRG2Regulator(make400Config());
    // Déclencher bypass urgence
    reg.update({ A: 160, B: 230, C: 230 });
    
    // Pas encore assez haut
    let res = reg.update({ A: 180, B: 230, C: 230 });
    expect(res.phases.A.state).toBe('BYP');
    
    // Au-dessus du seuil de retour
    res = reg.update({ A: 190, B: 230, C: 230 });
    expect(res.phases.A.bypassForce).toBe(false);
  });

  // ── Temporisation ──────────────────────────────────────────────────────
  it('temporisation empêche commutation immédiate avec dt court', () => {
    const reg = new SRG2Regulator(make400Config());
    // dt=2s < 7s → pas de commutation
    const res = reg.update({ A: 250, B: 230, C: 230 }, 2);
    expect(res.phases.A.state).toBe('BYP'); // Pas encore commuté
    
    // Accumuler dt=3s → total=5s < 7s
    const res2 = reg.update({ A: 250, B: 230, C: 230 }, 3);
    expect(res2.phases.A.state).toBe('BYP');
    
    // Accumuler dt=3s → total=8s ≥ 7s → commutation
    const res3 = reg.update({ A: 250, B: 230, C: 230 }, 3);
    expect(res3.phases.A.state).toBe('LO2');
    expect(res3.tapChanged).toBe(true);
  });

  it('commutation immédiate avec dt ≥ temporisation', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 250, B: 230, C: 230 }, 10);
    expect(res.phases.A.state).toBe('LO2');
  });

  // ── Contraintes SRG2-230 ──────────────────────────────────────────────
  it('SRG2-230: pas de boost+buck simultanés', () => {
    const config = {
      id: 'test-230',
      nodeId: 'N1',
      name: 'Test SRG2-230',
      enabled: true,
      ...DEFAULT_SRG2_230_CONFIG,
    } as SRG2Config;
    
    const reg = new SRG2Regulator(config);
    // Phase A haute, phase C basse → conflit
    const res = reg.update({ A: 250, B: 230, C: 210 });
    
    // Vérifier qu'il n'y a pas de boost ET lower simultanés
    const states = [res.phases.A.state, res.phases.B.state, res.phases.C.state];
    const hasBoost = states.some(s => s === 'BO1' || s === 'BO2');
    const hasLower = states.some(s => s === 'LO1' || s === 'LO2');
    expect(hasBoost && hasLower).toBe(false);
  });

  // ── Régulation indépendante SRG2-400 ──────────────────────────────────
  it('SRG2-400: phases régulées indépendamment', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 250, B: 210, C: 230 });
    expect(res.phases.A.state).toBe('LO2'); // abaissement
    expect(res.phases.B.state).toBe('BO2'); // boost
    expect(res.phases.C.state).toBe('BYP'); // neutre
  });

  // ── Tension de sortie ─────────────────────────────────────────────────
  it('tension de sortie correcte en LO2 (-7%)', () => {
    const reg = new SRG2Regulator(make400Config());
    const res = reg.update({ A: 250, B: 230, C: 230 });
    // Vout = Vin + (-7/100 × 230) = 250 - 16.1 = 233.9
    expect(res.phases.A.Vout).toBeCloseTo(250 - 16.1, 0);
  });

  // ── Factory ───────────────────────────────────────────────────────────
  it('createSRG2Regulator crée un régulateur fonctionnel', () => {
    const reg = createSRG2Regulator('N42', 'TÉTRAPHASÉ_400V');
    expect(reg.nodeId).toBe('N42');
    expect(reg.type).toBe('SRG2-400');
    
    const res = reg.update({ A: 230, B: 230, C: 230 });
    expect(res.isActive).toBe(false);
  });

  // ── Reset ─────────────────────────────────────────────────────────────
  it('reset remet toutes les phases en BYP', () => {
    const reg = new SRG2Regulator(make400Config());
    reg.update({ A: 250, B: 250, C: 250 });
    expect(reg.getCurrentTaps().A).toBe('LO2');
    
    reg.reset();
    expect(reg.getCurrentTaps().A).toBe('BYP');
    expect(reg.getCurrentTaps().B).toBe('BYP');
    expect(reg.getCurrentTaps().C).toBe('BYP');
  });

  // ── Puissance ─────────────────────────────────────────────────────────
  it('checkPowerLimit respecte les limites', () => {
    const reg = new SRG2Regulator(make400Config());
    expect(reg.checkPowerLimit(80, 'injection')).toBe(true);
    expect(reg.checkPowerLimit(90, 'injection')).toBe(false);
    expect(reg.checkPowerLimit(100, 'charge')).toBe(true);
    expect(reg.checkPowerLimit(110, 'charge')).toBe(false);
  });
});
