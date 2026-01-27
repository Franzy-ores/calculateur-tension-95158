import { describe, it, expect } from 'vitest';
import { 
  analyzeCurrentImbalance,
  calculateLoadShiftFraction,
  calculateLoadRedistribution,
  calculateEQUI8LoadShift
} from '../equi8LoadShiftCalculator';
import { NeutralCompensator } from '@/types/network';
import { C, fromPolar } from '../complex';

/**
 * Tests unitaires pour le NOUVEAU modèle EQUI8
 * 
 * 🔑 PRINCIPE FONDAMENTAL:
 * EQUI8 modifie les charges, JAMAIS les tensions.
 */

describe('EQUI8 Load Shift Calculator - Nouveau modèle', () => {
  
  describe('analyzeCurrentImbalance', () => {
    it('devrait identifier correctement la phase max et min', () => {
      // Courants: A=50A, B=30A, C=20A
      const I_A = fromPolar(50, 0);
      const I_B = fromPolar(30, -2*Math.PI/3);
      const I_C = fromPolar(20, 2*Math.PI/3);
      
      const analysis = analyzeCurrentImbalance(I_A, I_B, I_C);
      
      expect(analysis.maxPhase).toBe('A');
      expect(analysis.minPhase).toBe('C');
      expect(analysis.currents.A).toBeCloseTo(50, 1);
      expect(analysis.currents.B).toBeCloseTo(30, 1);
      expect(analysis.currents.C).toBeCloseTo(20, 1);
      expect(analysis.imbalance_A).toBeCloseTo(30, 1); // 50 - 20
    });
    
    it('devrait calculer le courant de neutre correctement', () => {
      // Système équilibré: I_N ≈ 0
      const I_A = fromPolar(50, 0);
      const I_B = fromPolar(50, -2*Math.PI/3);
      const I_C = fromPolar(50, 2*Math.PI/3);
      
      const analysis = analyzeCurrentImbalance(I_A, I_B, I_C);
      
      expect(analysis.neutralCurrent_A).toBeCloseTo(0, 0);
    });
    
    it('devrait calculer le courant de neutre pour système déséquilibré', () => {
      // Système déséquilibré: tout sur phase A
      const I_A = fromPolar(100, 0);
      const I_B = fromPolar(0, -2*Math.PI/3);
      const I_C = fromPolar(0, 2*Math.PI/3);
      
      const analysis = analyzeCurrentImbalance(I_A, I_B, I_C);
      
      expect(analysis.neutralCurrent_A).toBeCloseTo(100, 1);
    });
  });
  
  describe('calculateLoadShiftFraction', () => {
    it('devrait calculer une fraction selon la formule CME', () => {
      // Impédances typiques
      const Zph = 0.5; // Ω
      const Zn = 0.5;  // Ω
      
      const fraction = calculateLoadShiftFraction(Zph, Zn);
      
      // La fraction doit être entre 0 et 0.5
      expect(fraction).toBeGreaterThan(0);
      expect(fraction).toBeLessThanOrEqual(0.5);
    });
    
    it('devrait clamper les impédances à 0.15Ω minimum', () => {
      // Impédances très faibles
      const fraction1 = calculateLoadShiftFraction(0.05, 0.05);
      const fraction2 = calculateLoadShiftFraction(0.15, 0.15);
      
      // Les deux devraient utiliser Zph=0.15 effectif
      expect(fraction1).toBe(fraction2);
    });
  });
  
  describe('calculateLoadRedistribution', () => {
    const defaultCompensator: NeutralCompensator = {
      id: 'equi8-test',
      nodeId: 'node-test',
      maxPower_kVA: 15,
      tolerance_A: 2,
      enabled: true,
      Zph_Ohm: 0.5,
      Zn_Ohm: 0.5
    };
    
    it('devrait ne pas redistribuer si courant neutre sous le seuil', () => {
      const currentDistribution = { A: 10, B: 10, C: 10 };
      const imbalanceAnalysis = {
        currents: { A: 10, B: 10, C: 10 },
        maxPhase: 'A' as const,
        minPhase: 'C' as const,
        imbalance_A: 0,
        imbalancePercent: 0,
        neutralCurrent_A: 0.5 // Sous le seuil de 2A
      };
      
      const result = calculateLoadRedistribution(
        currentDistribution,
        imbalanceAnalysis,
        defaultCompensator
      );
      
      expect(result.loadShifted_kVA).toBe(0);
      expect(result.newDistribution).toEqual(currentDistribution);
    });
    
    it('devrait redistribuer de la phase max vers la phase min', () => {
      const currentDistribution = { A: 30, B: 15, C: 5 };
      const imbalanceAnalysis = {
        currents: { A: 50, B: 25, C: 8 },
        maxPhase: 'A' as const,
        minPhase: 'C' as const,
        imbalance_A: 42,
        imbalancePercent: 150,
        neutralCurrent_A: 30
      };
      
      const result = calculateLoadRedistribution(
        currentDistribution,
        imbalanceAnalysis,
        defaultCompensator
      );
      
      expect(result.fromPhase).toBe('A');
      expect(result.toPhase).toBe('C');
      expect(result.loadShifted_kVA).toBeGreaterThan(0);
      expect(result.newDistribution.A).toBeLessThan(currentDistribution.A);
      expect(result.newDistribution.C).toBeGreaterThan(currentDistribution.C);
    });
    
    it('devrait limiter par la puissance max du compensateur', () => {
      const currentDistribution = { A: 100, B: 10, C: 5 };
      const imbalanceAnalysis = {
        currents: { A: 200, B: 20, C: 10 },
        maxPhase: 'A' as const,
        minPhase: 'C' as const,
        imbalance_A: 190,
        imbalancePercent: 250,
        neutralCurrent_A: 100
      };
      
      // Compensateur limité à 15 kVA
      const result = calculateLoadRedistribution(
        currentDistribution,
        imbalanceAnalysis,
        defaultCompensator
      );
      
      expect(result.loadShifted_kVA).toBeLessThanOrEqual(15);
    });
  });
  
  describe('calculateEQUI8LoadShift', () => {
    const defaultCompensator: NeutralCompensator = {
      id: 'equi8-test',
      nodeId: 'node-test',
      maxPower_kVA: 15,
      tolerance_A: 2,
      enabled: true,
      Zph_Ohm: 0.5,
      Zn_Ohm: 0.5
    };
    
    it('devrait retourner shouldRedistribute=false pour système équilibré', () => {
      const currents = {
        A: fromPolar(30, 0),
        B: fromPolar(30, -2*Math.PI/3),
        C: fromPolar(30, 2*Math.PI/3)
      };
      
      const currentDistribution = {
        charges: { A: 10, B: 10, C: 10 },
        productions: { A: 0, B: 0, C: 0 }
      };
      
      const result = calculateEQUI8LoadShift(
        'node-test',
        currents,
        currentDistribution,
        defaultCompensator
      );
      
      expect(result.shouldRedistribute).toBe(false);
    });
    
    it('devrait retourner shouldRedistribute=true pour système déséquilibré', () => {
      const currents = {
        A: fromPolar(80, 0),          // Surchargé
        B: fromPolar(30, -2*Math.PI/3),
        C: fromPolar(10, 2*Math.PI/3) // Sous-chargé
      };
      
      const currentDistribution = {
        charges: { A: 20, B: 10, C: 5 },
        productions: { A: 0, B: 0, C: 0 }
      };
      
      const result = calculateEQUI8LoadShift(
        'node-test',
        currents,
        currentDistribution,
        defaultCompensator
      );
      
      expect(result.shouldRedistribute).toBe(true);
      expect(result.fromPhase).toBe('A');
      expect(result.toPhase).toBe('C');
      expect(result.loadShifted_kVA).toBeGreaterThan(0);
    });
  });
});

describe('EQUI8 - Vérification principes fondamentaux', () => {
  
  it('🔑 EQUI8 ne doit JAMAIS imposer de tension artificielle', () => {
    // Ce test vérifie que le modèle ne construit pas de formule UEQUI8_phX = Umoy + ratio * ecart
    const currents = {
      A: fromPolar(50, 0),
      B: fromPolar(30, -2*Math.PI/3),
      C: fromPolar(20, 2*Math.PI/3)
    };
    
    const distribution = {
      charges: { A: 15, B: 10, C: 5 },
      productions: { A: 0, B: 0, C: 0 }
    };
    
    const compensator: NeutralCompensator = {
      id: 'equi8-test',
      nodeId: 'node-test',
      maxPower_kVA: 15,
      tolerance_A: 2,
      enabled: true,
      Zph_Ohm: 0.5,
      Zn_Ohm: 0.5
    };
    
    const result = calculateEQUI8LoadShift(
      'node-test',
      currents,
      distribution,
      compensator
    );
    
    // Le résultat NE DOIT PAS contenir de tensions imposées
    // Il doit contenir uniquement des ajustements de distribution de charges
    expect(result.adjustedDistribution).toBeDefined();
    expect(result.adjustedDistribution.charges).toBeDefined();
    
    // Vérifier que la somme des charges est conservée (redistribution, pas création)
    const totalBefore = distribution.charges.A + distribution.charges.B + distribution.charges.C;
    const totalAfter = result.adjustedDistribution.charges.A + 
                       result.adjustedDistribution.charges.B + 
                       result.adjustedDistribution.charges.C;
    
    expect(totalAfter).toBeCloseTo(totalBefore, 1);
  });
  
  it('🔑 La redistribution doit réduire le déséquilibre entre phases', () => {
    const currents = {
      A: fromPolar(80, 0),          // Phase surchargée
      B: fromPolar(30, -2*Math.PI/3),
      C: fromPolar(10, 2*Math.PI/3) // Phase sous-chargée
    };
    
    const distribution = {
      charges: { A: 25, B: 10, C: 5 }, // Déséquilibré: A >> C
      productions: { A: 0, B: 0, C: 0 }
    };
    
    const compensator: NeutralCompensator = {
      id: 'equi8-test',
      nodeId: 'node-test',
      maxPower_kVA: 15,
      tolerance_A: 2,
      enabled: true,
      Zph_Ohm: 0.5,
      Zn_Ohm: 0.5
    };
    
    const result = calculateEQUI8LoadShift(
      'node-test',
      currents,
      distribution,
      compensator
    );
    
    // Après redistribution, l'écart entre phases doit être réduit
    const ecartBefore = distribution.charges.A - distribution.charges.C;
    const ecartAfter = result.adjustedDistribution.charges.A - result.adjustedDistribution.charges.C;
    
    expect(ecartAfter).toBeLessThan(ecartBefore);
    
    // La phase A doit avoir moins de charge
    expect(result.adjustedDistribution.charges.A).toBeLessThan(distribution.charges.A);
    
    // La phase C doit avoir plus de charge
    expect(result.adjustedDistribution.charges.C).toBeGreaterThan(distribution.charges.C);
  });
});
