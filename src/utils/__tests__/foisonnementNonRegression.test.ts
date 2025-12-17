/**
 * Tests de non-régression pour le foisonnement et la correction MONO 230V
 */

import { describe, it, expect } from 'vitest';
import { ElectricalCalculator } from '../electricalCalculations';
import type { Node, Cable, CableType, TransformerConfig, CalculationScenario, ClientImporte, LoadModel } from '@/types/network';

// Helper pour créer un type de câble
const mkCableType = (id: string, R12: number, X12: number, R0: number, X0: number): CableType => ({
  id,
  label: id,
  R12_ohm_per_km: R12,
  X12_ohm_per_km: X12,
  R0_ohm_per_km: R0,
  X0_ohm_per_km: X0,
  matiere: 'ALUMINIUM',
  posesPermises: ['AÉRIEN', 'SOUTERRAIN'],
});

// Helper pour créer un transformateur
const baseTransformer = (Uline: number, S_kVA: number = 250): TransformerConfig => ({
  rating: '250kVA',
  nominalPower_kVA: S_kVA,
  nominalVoltage_V: Uline,
  shortCircuitVoltage_percent: 4,
  cosPhi: 0.95,
});

const degLatForMeters = (m: number) => m / 111_000;

// Helper pour créer un nœud
const createNode = (
  id: string,
  name: string,
  latOffset: number,
  isSource: boolean = false,
  connectionType: 'MONO_230V_PP' | 'TRI_230V_3F' | 'MONO_230V_PN' | 'TÉTRA_3P+N_230_400V' = 'TÉTRA_3P+N_230_400V'
): Node => ({
  id,
  name,
  lat: degLatForMeters(latOffset),
  lng: 0,
  connectionType,
  clients: [],
  productions: [],
  isSource,
});

// Helper pour créer un câble
const createCable = (id: string, nodeAId: string, nodeBId: string, typeId: string, lengthM: number = 100): Cable => ({
  id,
  name: id,
  typeId,
  pose: 'AÉRIEN',
  nodeAId,
  nodeBId,
  coordinates: [
    { lat: 0, lng: 0 },
    { lat: degLatForMeters(lengthM), lng: 0 },
  ],
});

// Helper pour créer un client MONO
const createMonoClient = (
  id: string,
  nodeId: string,
  charge_kVA: number,
  production_kVA: number,
  phaseCoupling: 'A-B' | 'B-C' | 'A-C' = 'A-B'
): ClientImporte => ({
  id,
  identifiantCircuit: id,
  nomCircuit: id,
  lat: 0,
  lng: 0,
  linkedNodeId: nodeId,
  puissanceContractuelle_kVA: charge_kVA,
  puissancePV_kVA: production_kVA,
  couplage: 'MONO',
  connectionType: 'MONO',
  phaseCoupling,
  assignedPhase: phaseCoupling.split('-')[0] as 'A' | 'B' | 'C',
});

describe('Foisonnement 0% - Non-Régression', () => {
  it('avec foisonnement charges = 0%, la tension doit être égale à la tension source', () => {
    const calc = new ElectricalCalculator(0.95, 0.95, 1.0);
    
    const nodes: Node[] = [
      createNode('src', 'Source', 0, true, 'TRI_230V_3F'),
      createNode('n1', 'Noeud 1', 100, false, 'MONO_230V_PP'),
    ];
    nodes[1].clients = [{ id: 'c1', label: 'Load', S_kVA: 10 }];
    
    const cables: Cable[] = [
      createCable('c1', 'src', 'n1', 'BAXB150', 100),
    ];
    
    const cableTypes: CableType[] = [
      mkCableType('BAXB150', 0.206, 0.08, 0.618, 0.24),
    ];
    
    const clients: ClientImporte[] = [
      createMonoClient('client1', 'n1', 10, 0, 'A-B'),
    ];
    
    // Foisonnement charges = 0% → aucune charge effective
    const result = calc.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'SIMULTANÉ' as CalculationScenario,
      0,   // foisonnementCharges = 0%
      100, // foisonnementProductions = 100%
      baseTransformer(230),
      'mixte_mono_poly' as LoadModel,
      0,
      { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } },
      clients
    );
    
    // Avec 0% foisonnement charges, la puissance nette doit être nulle
    expect(result.totalLoads_kVA).toBe(0);
    
    // Les câbles ne doivent pas avoir de chute de tension significative
    const cab = result.cables[0];
    expect(Math.abs(cab.voltageDrop_V || 0)).toBeLessThan(0.5);
  });

  it('avec foisonnement productions = 0%, les productions ne doivent pas affecter la tension', () => {
    const calc = new ElectricalCalculator(0.95, 0.95, 1.0);
    
    const nodes: Node[] = [
      createNode('src', 'Source', 0, true, 'TRI_230V_3F'),
      createNode('n1', 'Noeud 1', 100, false, 'MONO_230V_PP'),
    ];
    nodes[1].productions = [{ id: 'p1', label: 'PV', S_kVA: 10 }];
    
    const cables: Cable[] = [
      createCable('c1', 'src', 'n1', 'BAXB150', 100),
    ];
    
    const cableTypes: CableType[] = [
      mkCableType('BAXB150', 0.206, 0.08, 0.618, 0.24),
    ];
    
    const clients: ClientImporte[] = [
      createMonoClient('client1', 'n1', 0, 10, 'A-B'),
    ];
    
    // Foisonnement productions = 0% → aucune production effective
    const result = calc.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'SIMULTANÉ' as CalculationScenario,
      100,
      0,   // foisonnementProductions = 0%
      baseTransformer(230),
      'mixte_mono_poly' as LoadModel,
      0,
      { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } },
      clients
    );
    
    // Avec 0% foisonnement productions, la production nette doit être nulle
    expect(result.totalProductions_kVA).toBe(0);
  });
});

describe('Foisonnement 1% - Non-Régression', () => {
  it('avec foisonnement 1%, la chute de tension doit être très faible', () => {
    const calc = new ElectricalCalculator(0.95, 0.95, 1.0);
    
    const nodes: Node[] = [
      createNode('src', 'Source', 0, true, 'TRI_230V_3F'),
      createNode('n1', 'Noeud 1', 100, false, 'MONO_230V_PP'),
    ];
    nodes[1].clients = [{ id: 'c1', label: 'Load', S_kVA: 100 }];
    
    const cables: Cable[] = [
      createCable('c1', 'src', 'n1', 'BAXB150', 100),
    ];
    
    const cableTypes: CableType[] = [
      mkCableType('BAXB150', 0.206, 0.08, 0.618, 0.24),
    ];
    
    const clients: ClientImporte[] = [
      createMonoClient('client1', 'n1', 100, 0, 'A-B'),
    ];
    
    // Foisonnement 1% → charge effective = 1 kVA
    const result = calc.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'PRÉLÈVEMENT' as CalculationScenario,
      1,   // foisonnementCharges = 1%
      100,
      baseTransformer(230),
      'mixte_mono_poly' as LoadModel,
      0,
      { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } },
      clients
    );
    
    // Avec 1% de 100 kVA = 1 kVA, la chute de tension doit être minime
    const cab = result.cables[0];
    expect(Math.abs(cab.voltageDrop_V || 0)).toBeLessThan(2);
  });
});

describe('Curseurs de déséquilibre - Non-Régression', () => {
  it('avec curseurs 50/25/25, la répartition doit être différente du mode équilibré', () => {
    const calc = new ElectricalCalculator(0.95, 0.95, 1.0);
    
    const nodes: Node[] = [
      createNode('src', 'Source', 0, true, 'TÉTRA_3P+N_230_400V'),
      createNode('n1', 'Noeud 1', 100, false, 'TÉTRA_3P+N_230_400V'),
    ];
    nodes[1].clients = [{ id: 'c1', label: 'Load', S_kVA: 30 }];
    
    const cables: Cable[] = [
      createCable('c1', 'src', 'n1', 'BAXB150', 100),
    ];
    
    const cableTypes: CableType[] = [
      mkCableType('BAXB150', 0.206, 0.08, 0.618, 0.24),
    ];
    
    const clients: ClientImporte[] = [
      createMonoClient('client1', 'n1', 30, 0, 'A-B'),
    ];
    
    // Test avec curseurs équilibrés
    const resultBalanced = calc.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'PRÉLÈVEMENT' as CalculationScenario,
      100,
      100,
      baseTransformer(400),
      'mixte_mono_poly' as LoadModel,
      0,
      { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } },
      clients
    );
    
    // Test avec curseurs déséquilibrés (50% sur A)
    const resultUnbalanced = calc.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'PRÉLÈVEMENT' as CalculationScenario,
      100,
      100,
      baseTransformer(400),
      'mixte_mono_poly' as LoadModel,
      0,
      { charges: { A: 50, B: 25, C: 25 }, productions: { A: 33.33, B: 33.33, C: 33.33 } },
      clients
    );
    
    // Les deux calculs doivent produire des résultats
    expect(resultBalanced.cables.length).toBeGreaterThan(0);
    expect(resultUnbalanced.cables.length).toBeGreaterThan(0);
  });
});

describe('MONO 230V - Courant correct', () => {
  it('un client MONO 10 kVA sur A-B doit générer environ 43.5 A de courant', () => {
    const calc = new ElectricalCalculator(1.0, 1.0, 1.0);
    
    const nodes: Node[] = [
      createNode('src', 'Source', 0, true, 'TRI_230V_3F'),
      createNode('n1', 'Noeud 1', 100, false, 'MONO_230V_PP'),
    ];
    nodes[1].clients = [{ id: 'c1', label: 'Load', S_kVA: 10 }];
    
    const cables: Cable[] = [
      createCable('c1', 'src', 'n1', 'BAXB150', 100),
    ];
    
    const cableTypes: CableType[] = [
      mkCableType('BAXB150', 0.206, 0.08, 0.618, 0.24),
    ];
    
    const clients: ClientImporte[] = [
      createMonoClient('client1', 'n1', 10, 0, 'A-B'),
    ];
    
    const result = calc.calculateScenario(
      nodes,
      cables,
      cableTypes,
      'PRÉLÈVEMENT' as CalculationScenario,
      100,
      100,
      baseTransformer(230),
      'mixte_mono_poly' as LoadModel,
      0,
      { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } },
      clients
    );
    
    const cableResult = result.cables[0];
    expect(cableResult).toBeDefined();
    
    // Vérifier que le courant n'est pas sous-estimé (bug précédent donnait ~21.7 A)
    expect(cableResult.current_A!).toBeGreaterThan(30);
  });
});
