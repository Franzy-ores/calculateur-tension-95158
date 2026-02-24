/**
 * Tests unitaires pour le foisonnement par paliers terrain
 */
import { describe, it, expect } from 'vitest';
import { calculateAdaptiveFoisonnement, getFoisonnementPalier } from '../foisonnementCalculator';

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
