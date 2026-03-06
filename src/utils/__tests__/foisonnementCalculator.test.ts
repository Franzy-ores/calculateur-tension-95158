/**
 * Tests unitaires pour le foisonnement par paliers terrain et diversité normalisée
 */
import { describe, it, expect } from 'vitest';
import {
  calculateAdaptiveFoisonnement,
  getFoisonnementPalier,
  calculateNormalizedDiversity,
  F_REF,
} from '../foisonnementCalculator';

describe('getFoisonnementPalier', () => {
  it('n=1 → 100%', () => expect(getFoisonnementPalier(1)).toBe(1.0));
  it('n=2 → 30%', () => expect(getFoisonnementPalier(2)).toBe(0.30));
  it('n=10 → 30%', () => expect(getFoisonnementPalier(10)).toBe(0.30));
  it('n=11 → 15%', () => expect(getFoisonnementPalier(11)).toBe(0.15));
  it('n=20 → 15%', () => expect(getFoisonnementPalier(20)).toBe(0.15));
  it('n=21 → 8%', () => expect(getFoisonnementPalier(21)).toBe(0.08));
  it('n=50 → 8%', () => expect(getFoisonnementPalier(50)).toBe(0.08));
  it('n=100 → 8%', () => expect(getFoisonnementPalier(100)).toBe(0.08));
});

describe('calculateAdaptiveFoisonnement', () => {
  it('n=0 → 0', () => expect(calculateAdaptiveFoisonnement(0, 50)).toBe(0));
  it('n=1 → baseProfile inchangé', () => expect(calculateAdaptiveFoisonnement(1, 42)).toBe(42));
  
  it('n=5, profil 100% → 30%', () => {
    expect(calculateAdaptiveFoisonnement(5, 100)).toBe(30);
  });
  
  it('n=15, profil 100% → 15%', () => {
    expect(calculateAdaptiveFoisonnement(15, 100)).toBe(15);
  });
  
  it('n=30, profil 100% → 8%', () => {
    expect(calculateAdaptiveFoisonnement(30, 100)).toBe(8);
  });

  it('n=5, profil 50% → 15%', () => {
    // 50 * 0.30 = 15
    expect(calculateAdaptiveFoisonnement(5, 50)).toBe(15);
  });

  it('n=15, profil 20% → 3%', () => {
    // 20 * 0.15 = 3
    expect(calculateAdaptiveFoisonnement(15, 20)).toBe(3);
  });
});

describe('calculateNormalizedDiversity (K(N, cluster))', () => {
  it('F_REF ≈ 0.2010', () => {
    expect(F_REF).toBeCloseTo(0.13 + 0.87 / Math.sqrt(150), 6);
  });

  it('N=150, urbain_residentiel (a=0.13) → exactement 1.0', () => {
    expect(calculateNormalizedDiversity(150, 0.13)).toBeCloseTo(1.0, 6);
  });

  it('N=0 → 0', () => {
    expect(calculateNormalizedDiversity(0, 0.13)).toBe(0);
  });

  it('N=50, rural (a=0.18) → ~1.472', () => {
    const expected = (0.18 + 0.82 / Math.sqrt(50)) / F_REF;
    expect(calculateNormalizedDiversity(50, 0.18)).toBeCloseTo(expected, 4);
  });

  it('N=300, péri-urbain (a=0.11) → ~0.802', () => {
    const expected = (0.11 + 0.89 / Math.sqrt(300)) / F_REF;
    expect(calculateNormalizedDiversity(300, 0.11)).toBeCloseTo(expected, 4);
  });

  it('N=10, rural (a=0.18) → ~2.027', () => {
    const expected = (0.18 + 0.82 / Math.sqrt(10)) / F_REF;
    expect(calculateNormalizedDiversity(10, 0.18)).toBeCloseTo(expected, 3);
  });

  it('N < N_ref → K > 1 (moins de diversité)', () => {
    expect(calculateNormalizedDiversity(50, 0.13)).toBeGreaterThan(1.0);
  });

  it('N > N_ref → K < 1 (plus de diversité)', () => {
    expect(calculateNormalizedDiversity(300, 0.13)).toBeLessThan(1.0);
  });
});
