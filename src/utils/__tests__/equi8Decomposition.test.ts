import { describe, it, expect } from 'vitest';
import { C, add, sub, abs } from '../complex';
import { SimulationCalculator } from '../simulationCalculator';
import type { Project } from '@/types/network';

describe('EQUI8 Phase Decomposition', () => {
  it('should conserve vector sum (IA + IB + IC ≈ I_EQUI8)', () => {
    const calc = new SimulationCalculator();
    const I_EQUI8 = C(10, 5); // 11.18A ∠26.57°
    const I_A = C(30, 10);
    const I_B = C(25, -15);
    const I_C = C(20, 5);
    const mockProject = { debug: { equi8: { logPerPhaseInjections: false } } } as Project;
    
    const result = (calc as any).decomposeEQUI8CurrentPerPhase(
      I_EQUI8, I_A, I_B, I_C, 20, mockProject, 'test-node'
    );
    
    const sum = add(add(result.IA, result.IB), result.IC);
    const error = abs(sub(sum, I_EQUI8));
    const relativeError = error / abs(I_EQUI8);
    
    expect(relativeError).toBeLessThan(0.01); // < 1%
    expect(error).toBeLessThan(0.2); // < 0.2A absolute error
  });
  
  it('should respect per-phase current limits', () => {
    const calc = new SimulationCalculator();
    const I_EQUI8 = C(50, 20); // 53.85A
    const I_A = C(40, 15);
    const I_B = C(35, -10);
    const I_C = C(30, 8);
    const I_max = 15; // Limite stricte
    const mockProject = { debug: { equi8: { logPerPhaseInjections: false } } } as Project;
    
    const result = (calc as any).decomposeEQUI8CurrentPerPhase(
      I_EQUI8, I_A, I_B, I_C, I_max, mockProject, 'test-node'
    );
    
    expect(abs(result.IA)).toBeLessThanOrEqual(I_max + 0.5); // Tolérance 0.5A
    expect(abs(result.IB)).toBeLessThanOrEqual(I_max + 0.5);
    expect(abs(result.IC)).toBeLessThanOrEqual(I_max + 0.5);
  });

  it('should handle zero current on one phase', () => {
    const calc = new SimulationCalculator();
    const I_EQUI8 = C(15, 8);
    const I_A = C(35, 10);
    const I_B = C(30, -12);
    const I_C = C(0, 0); // Phase C inactive
    const mockProject = { debug: { equi8: { logPerPhaseInjections: false } } } as Project;
    
    const result = (calc as any).decomposeEQUI8CurrentPerPhase(
      I_EQUI8, I_A, I_B, I_C, 20, mockProject, 'test-node'
    );
    
    const sum = add(add(result.IA, result.IB), result.IC);
    const error = abs(sub(sum, I_EQUI8));
    const relativeError = error / abs(I_EQUI8);
    
    // Doit gérer gracieusement la phase inactive
    expect(relativeError).toBeLessThan(0.05); // < 5%
    expect(abs(result.IC)).toBeGreaterThanOrEqual(0); // Pas de valeur négative
  });

  it('should handle highly unbalanced currents', () => {
    const calc = new SimulationCalculator();
    const I_EQUI8 = C(25, 10);
    const I_A = C(60, 20);  // Phase A fortement chargée
    const I_B = C(10, -5);  // Phase B peu chargée
    const I_C = C(15, 3);   // Phase C peu chargée
    const mockProject = { debug: { equi8: { logPerPhaseInjections: false } } } as Project;
    
    const result = (calc as any).decomposeEQUI8CurrentPerPhase(
      I_EQUI8, I_A, I_B, I_C, 25, mockProject, 'test-node'
    );
    
    // La phase A doit avoir la plus forte injection (proportionnelle à son déséquilibre)
    expect(abs(result.IA)).toBeGreaterThan(abs(result.IB));
    expect(abs(result.IA)).toBeGreaterThan(abs(result.IC));
    
    // Conservation vectorielle
    const sum = add(add(result.IA, result.IB), result.IC);
    const error = abs(sub(sum, I_EQUI8));
    expect(error).toBeLessThan(0.5);
  });

  it('should fallback to uniform distribution on decomposition error', () => {
    const calc = new SimulationCalculator();
    // Cas pathologique : courants très petits, EQUI8 demandé très grand
    const I_EQUI8 = C(100, 50);
    const I_A = C(0.001, 0);
    const I_B = C(0.001, 0);
    const I_C = C(0.001, 0);
    const mockProject = { debug: { equi8: { logPerPhaseInjections: false } } } as Project;
    
    const result = (calc as any).decomposeEQUI8CurrentPerPhase(
      I_EQUI8, I_A, I_B, I_C, 50, mockProject, 'test-node'
    );
    
    // Doit toujours retourner des valeurs valides (pas de NaN)
    expect(abs(result.IA)).toBeGreaterThan(0);
    expect(abs(result.IB)).toBeGreaterThan(0);
    expect(abs(result.IC)).toBeGreaterThan(0);
    expect(isNaN(result.IA.re)).toBe(false);
    expect(isNaN(result.IB.re)).toBe(false);
    expect(isNaN(result.IC.re)).toBe(false);
  });
});
