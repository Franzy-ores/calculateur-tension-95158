import { describe, it, expect } from 'vitest';
import { calculateCableTemperature, getThermalCorrectionFactor } from '../thermalModel';
import { validateFoisonnement } from '../validationModule';

/**
 * 🔧 FIX GRD — Tests de non-régression pour les corrections GRD
 */

describe('GRD Corrections - Thermique', () => {
  it('Cable XLPE avec surcharge légère → T bloquée à 90°C', () => {
    // Câble XLPE souterrain, surcharge 1.5x Imax
    const T_amb = 20; // été souterrain
    const I_A = 300;  // courant réel
    const Imax = 200; // ampacité
    
    const T = calculateCableTemperature(T_amb, I_A, Imax, 'SOUTERRAIN', 'XLPE');
    
    // Sans borne: T = 20 + 0.6 * 35 * (1.5)² = 20 + 47.25 = 67.25°C (< 90, pas borné)
    expect(T).toBeLessThanOrEqual(90);
    expect(T).toBeGreaterThan(T_amb);
  });

  it('Cable PVC avec forte surcharge → T bloquée à 70°C', () => {
    const T_amb = 28; // été aérien
    const I_A = 400;  // forte surcharge
    const Imax = 100;
    
    const T = calculateCableTemperature(T_amb, I_A, Imax, 'AÉRIEN', 'PVC');
    
    // Sans borne: T = 28 + 1.0 * 40 * (2)² = 28 + 160 = 188°C → borné à 70°C
    expect(T).toBe(70);
  });

  it('Cable sans insulationType → fallback 90°C (XLPE)', () => {
    const T_amb = 28;
    const I_A = 400;
    const Imax = 100;
    
    const T = calculateCableTemperature(T_amb, I_A, Imax, 'AÉRIEN');
    
    // Sans insulationType, borné à 90°C par défaut
    expect(T).toBe(90);
  });

  it('Facteur de correction thermique avec insulationType', () => {
    const factor = getThermalCorrectionFactor(
      'summer', 'SOUTERRAIN', 'ALUMINIUM', 150, 200, 'XLPE'
    );
    
    // Factor doit être > 1 (température > 20°C en été)
    expect(factor).toBeGreaterThan(1);
    // Factor doit être raisonnable (< 1.3 pour XLPE borné à 90°C)
    expect(factor).toBeLessThan(1.3);
  });
});

describe('GRD Corrections - Validation', () => {
  it('Foisonnement hors limites détecté', () => {
    const project = {
      foisonnementCharges: 150, // hors limites
      foisonnementChargesResidentiel: 150,
      foisonnementChargesIndustriel: 70,
      foisonnementProductions: 50,
      nodes: [],
      cables: [],
      cableTypes: [],
    } as any;
    
    const result = validateFoisonnement(project);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('Foisonnement normal validé', () => {
    const project = {
      foisonnementCharges: 15,
      foisonnementChargesResidentiel: 15,
      foisonnementChargesIndustriel: 70,
      foisonnementProductions: 50,
      nodes: [],
      cables: [],
      cableTypes: [],
    } as any;
    
    const result = validateFoisonnement(project);
    expect(result.valid).toBe(true);
  });
});
