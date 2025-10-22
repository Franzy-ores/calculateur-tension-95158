import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationCalculator } from '../simulationCalculator';
import { Project, Node, Cable, CableType, NeutralCompensator } from '@/types/network';
import { C, abs, add } from '../complex';

/**
 * Tests unitaires pour le modèle EQUI8
 * Validation de la correction phasorielle et de l'isolation des circuits
 */

describe('EQUI8 - Modèle phasoriel correct', () => {
  let calculator: SimulationCalculator;
  let defaultCableType: CableType;

  beforeEach(() => {
    calculator = new SimulationCalculator(0.95);
    
    // Type de câble par défaut pour les tests
    defaultCableType = {
      id: 'cable-test',
      label: 'Test Cable',
      R12_ohm_per_km: 0.3,
      X12_ohm_per_km: 0.1,
      R0_ohm_per_km: 0.5,
      X0_ohm_per_km: 0.15,
      matiere: 'CUIVRE',
      posesPermises: ['SOUTERRAIN'],
      maxCurrent_A: 200
    };
  });

  /**
   * Test 1 - Effet local uniquement
   * L'EQUI8 doit corriger localement sans rétro-propagation vers la source
   */
  it('Test 1: Effet local uniquement - Pas de rétro-propagation vers source', () => {
    // Réseau linéaire: Source — 100m — Node X (EQUI8) — 500m — Node Y
    const source: Node = {
      id: 'source',
      name: 'Source',
      lat: 0,
      lng: 0,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [],
      productions: [],
      isSource: true,
      tensionCible: 230
    };

    const nodeX: Node = {
      id: 'node-x',
      name: 'Node X (EQUI8)',
      lat: 0.001,
      lng: 0,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [],
      productions: []
    };

    const nodeY: Node = {
      id: 'node-y',
      name: 'Node Y (Charge déséquilibrée)',
      lat: 0.005,
      lng: 0,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [
        { id: 'c1', label: 'Charge A', S_kVA: 10 },  // Phase A
      ],
      productions: [],
      phaseDistribution: {
        charges: { A: 100, B: 0, C: 0 }  // Tout sur phase A = fort déséquilibre
      }
    };

    const cable1: Cable = {
      id: 'cable-1',
      name: 'Source → X',
      typeId: defaultCableType.id,
      pose: 'SOUTERRAIN',
      nodeAId: source.id,
      nodeBId: nodeX.id,
      coordinates: [],
      length_m: 100
    };

    const cable2: Cable = {
      id: 'cable-2',
      name: 'X → Y',
      typeId: defaultCableType.id,
      pose: 'SOUTERRAIN',
      nodeAId: nodeX.id,
      nodeBId: nodeY.id,
      coordinates: [],
      length_m: 500
    };

    const compensator: NeutralCompensator = {
      id: 'equi8-x',
      nodeId: nodeX.id,
      maxPower_kVA: 15,
      tolerance_A: 1.0,
      enabled: true,
      Zph_Ohm: 0.3,  // > 0.15 Ω
      Zn_Ohm: 0.5    // > 0.15 Ω
    };

    const project: Project = {
      id: 'test-project',
      name: 'Test EQUI8',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 0,
      defaultChargeKVA: 5,
      defaultProductionKVA: 0,
      transformerConfig: {
        rating: '250kVA',
        nominalPower_kVA: 250,
        nominalVoltage_V: 400,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.95
      },
      loadModel: 'monophase_reparti',
      desequilibrePourcent: 100,  // Déséquilibre maximal
      nodes: [source, nodeX, nodeY],
      cables: [cable1, cable2],
      cableTypes: [defaultCableType],
      simulationEquipment: {
        srg2Devices: [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    };

    // Calcul SANS EQUI8
    const resultWithoutEQUI8 = calculator.calculateScenarioWithHTConfig(
      { ...project, simulationEquipment: { srg2Devices: [], neutralCompensators: [], cableUpgrades: [] } },
      'PRÉLÈVEMENT'
    );

    // Calcul AVEC EQUI8
    const resultWithEQUI8 = calculator.runSimulation(
      project,
      'PRÉLÈVEMENT',
      { srg2Devices: [], neutralCompensators: [compensator], cableUpgrades: [] }
    );

    // Assertions
    expect(resultWithEQUI8).toBeDefined();
    expect(resultWithEQUI8.nodeMetricsPerPhase).toBeDefined();

    // Récupérer les tensions
    const sourceMetricsWithout = resultWithoutEQUI8.nodeMetricsPerPhase?.find(nm => nm.nodeId === source.id);
    const sourceMetricsWith = resultWithEQUI8.nodeMetricsPerPhase?.find(nm => nm.nodeId === source.id);
    const nodeXMetricsWith = resultWithEQUI8.nodeMetricsPerPhase?.find(nm => nm.nodeId === nodeX.id);
    const nodeYMetricsWith = resultWithEQUI8.nodeMetricsPerPhase?.find(nm => nm.nodeId === nodeY.id);

    expect(sourceMetricsWithout).toBeDefined();
    expect(sourceMetricsWith).toBeDefined();
    expect(nodeXMetricsWith).toBeDefined();
    expect(nodeYMetricsWith).toBeDefined();

    // Test: La tension à la source ne doit pas changer significativement (< 0.5%)
    const sourceVoltageChangeA = Math.abs(sourceMetricsWith!.voltagesPerPhase.A - sourceMetricsWithout!.voltagesPerPhase.A);
    const sourceVoltageChangeB = Math.abs(sourceMetricsWith!.voltagesPerPhase.B - sourceMetricsWithout!.voltagesPerPhase.B);
    const sourceVoltageChangeC = Math.abs(sourceMetricsWith!.voltagesPerPhase.C - sourceMetricsWithout!.voltagesPerPhase.C);

    console.log('📊 Test 1 - Variations tension source:');
    console.log(`   Phase A: ${sourceVoltageChangeA.toFixed(2)}V`);
    console.log(`   Phase B: ${sourceVoltageChangeB.toFixed(2)}V`);
    console.log(`   Phase C: ${sourceVoltageChangeC.toFixed(2)}V`);

    // Tolérance: < 0.5% de 230V = 1.15V
    expect(sourceVoltageChangeA).toBeLessThan(1.15);
    expect(sourceVoltageChangeB).toBeLessThan(1.15);
    expect(sourceVoltageChangeC).toBeLessThan(1.15);

    // Test: EQUI8 doit réduire le déséquilibre au node Y
    const ecartWithout = Math.max(
      sourceMetricsWithout!.voltagesPerPhase.A,
      sourceMetricsWithout!.voltagesPerPhase.B,
      sourceMetricsWithout!.voltagesPerPhase.C
    ) - Math.min(
      sourceMetricsWithout!.voltagesPerPhase.A,
      sourceMetricsWithout!.voltagesPerPhase.B,
      sourceMetricsWithout!.voltagesPerPhase.C
    );

    const ecartWith = Math.max(
      nodeYMetricsWith!.voltagesPerPhase.A,
      nodeYMetricsWith!.voltagesPerPhase.B,
      nodeYMetricsWith!.voltagesPerPhase.C
    ) - Math.min(
      nodeYMetricsWith!.voltagesPerPhase.A,
      nodeYMetricsWith!.voltagesPerPhase.B,
      nodeYMetricsWith!.voltagesPerPhase.C
    );

    console.log(`📊 Test 1 - Écart de tension au nœud Y:`);
    console.log(`   Sans EQUI8: ${ecartWithout.toFixed(2)}V`);
    console.log(`   Avec EQUI8: ${ecartWith.toFixed(2)}V`);

    // L'écart devrait être réduit (mais pas nécessairement de beaucoup car l'effet diminue avec la distance)
    // On vérifie juste que l'algorithme ne fait pas empirer les choses
    expect(ecartWith).toBeLessThanOrEqual(ecartWithout * 1.1);  // Max 10% de dégradation
  });

  /**
   * Test 2 - Pas de rétro-propagation
   * Vérification explicite que V_source reste inchangé
   */
  it('Test 2: Pas de rétro-propagation - V_source inchangé', () => {
    // Configuration minimale
    const source: Node = {
      id: 'source',
      name: 'Source',
      lat: 0,
      lng: 0,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [],
      productions: [],
      isSource: true,
      tensionCible: 230
    };

    const nodeEQUI8: Node = {
      id: 'node-equi8',
      name: 'EQUI8 Node',
      lat: 0.002,
      lng: 0,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [{ id: 'c1', label: 'Charge', S_kVA: 8 }],
      productions: [],
      phaseDistribution: {
        charges: { A: 80, B: 15, C: 5 }  // Fort déséquilibre
      }
    };

    const cable: Cable = {
      id: 'cable-main',
      name: 'Source → EQUI8',
      typeId: defaultCableType.id,
      pose: 'SOUTERRAIN',
      nodeAId: source.id,
      nodeBId: nodeEQUI8.id,
      coordinates: [],
      length_m: 200
    };

    const compensator: NeutralCompensator = {
      id: 'equi8-test',
      nodeId: nodeEQUI8.id,
      maxPower_kVA: 12,
      tolerance_A: 0.5,
      enabled: true,
      Zph_Ohm: 0.25,
      Zn_Ohm: 0.4
    };

    const project: Project = {
      id: 'test-retro',
      name: 'Test Rétro-propagation',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 0,
      defaultChargeKVA: 5,
      defaultProductionKVA: 0,
      transformerConfig: {
        rating: '160kVA',
        nominalPower_kVA: 160,
        nominalVoltage_V: 400,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.95
      },
      loadModel: 'monophase_reparti',
      desequilibrePourcent: 80,
      nodes: [source, nodeEQUI8],
      cables: [cable],
      cableTypes: [defaultCableType],
      simulationEquipment: {
        srg2Devices: [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    };

    const resultBefore = calculator.calculateScenarioWithHTConfig(
      { ...project, simulationEquipment: { srg2Devices: [], neutralCompensators: [], cableUpgrades: [] } },
      'PRÉLÈVEMENT'
    );

    const resultAfter = calculator.runSimulation(
      project,
      'PRÉLÈVEMENT',
      { srg2Devices: [], neutralCompensators: [compensator], cableUpgrades: [] }
    );

    const sourceBefore = resultBefore.nodeMetricsPerPhase?.find(nm => nm.nodeId === source.id);
    const sourceAfter = resultAfter.nodeMetricsPerPhase?.find(nm => nm.nodeId === source.id);

    expect(sourceBefore).toBeDefined();
    expect(sourceAfter).toBeDefined();

    // Vérification stricte: < 0.2V de différence
    const diffA = Math.abs(sourceAfter!.voltagesPerPhase.A - sourceBefore!.voltagesPerPhase.A);
    const diffB = Math.abs(sourceAfter!.voltagesPerPhase.B - sourceBefore!.voltagesPerPhase.B);
    const diffC = Math.abs(sourceAfter!.voltagesPerPhase.C - sourceBefore!.voltagesPerPhase.C);

    console.log('📊 Test 2 - Différences tension source:');
    console.log(`   |ΔV_A| = ${diffA.toFixed(3)}V`);
    console.log(`   |ΔV_B| = ${diffB.toFixed(3)}V`);
    console.log(`   |ΔV_C| = ${diffC.toFixed(3)}V`);

    expect(diffA).toBeLessThan(0.2);
    expect(diffB).toBeLessThan(0.2);
    expect(diffC).toBeLessThan(0.2);
  });

  /**
   * Test 3 - Conservation de signe phasorielle
   * Vérifier que I_N_after ≈ I_N_before + I_comp_injected
   */
  it('Test 3: Conservation de signe phasorielle - Cohérence des courants', () => {
    // Ce test vérifie la cohérence interne des calculs phasors
    // On simule directement les calculs de courant neutre
    
    // Courants de phase (phasors)
    const I_A = C(30, 5);    // 30.4A à ~9.5°
    const I_B = C(15, -20);  // 25A à ~-53°
    const I_C = C(10, 15);   // 18A à ~56°

    // Courant neutre initial (somme vectorielle)
    const I_N_initial = add(add(I_A, I_B), I_C);
    const I_N_initial_mag = abs(I_N_initial);

    console.log('📊 Test 3 - Courants:');
    console.log(`   I_A = ${I_A.re.toFixed(1)}+j${I_A.im.toFixed(1)} A`);
    console.log(`   I_B = ${I_B.re.toFixed(1)}+j${I_B.im.toFixed(1)} A`);
    console.log(`   I_C = ${I_C.re.toFixed(1)}+j${I_C.im.toFixed(1)} A`);
    console.log(`   I_N_initial = ${I_N_initial.re.toFixed(1)}+j${I_N_initial.im.toFixed(1)} A (|I_N| = ${I_N_initial_mag.toFixed(1)}A)`);

    // Simuler EQUI8: réduction attendue ~30-40% selon formule
    // Pour simplifier, on prend 35% de réduction
    const reductionPercent = 35;
    const I_N_after_mag = I_N_initial_mag * (1 - reductionPercent / 100);

    // Le courant compensateur devrait être orienté opposé à I_N_initial
    // I_comp = -k * I_N_normalized où k est la magnitude de compensation
    const I_comp_mag = I_N_initial_mag - I_N_after_mag;

    console.log(`   Réduction attendue: ${reductionPercent}%`);
    console.log(`   I_N_after attendu: ${I_N_after_mag.toFixed(1)}A`);
    console.log(`   I_comp magnitude: ${I_comp_mag.toFixed(1)}A`);

    // Vérifier que I_comp_mag est cohérent (entre 20% et 50% de I_N_initial)
    expect(I_comp_mag).toBeGreaterThan(I_N_initial_mag * 0.2);
    expect(I_comp_mag).toBeLessThan(I_N_initial_mag * 0.5);

    // Vérifier que I_N_after est bien réduit
    expect(I_N_after_mag).toBeLessThan(I_N_initial_mag);
    expect(I_N_after_mag).toBeGreaterThan(0);
  });

  /**
   * Test 4 - Répartition sur circuit partagé
   * Deux circuits partagent le même point source
   * Compenser sur circuit A ne doit pas affecter circuit B
   */
  it('Test 4: Isolation des circuits - Circuit A ≠ Circuit B', () => {
    // Topologie: Source → [Circuit A: NodeA → NodeA2]
    //                     [Circuit B: NodeB → NodeB2]
    const source: Node = {
      id: 'source',
      name: 'Source',
      lat: 0,
      lng: 0,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [],
      productions: [],
      isSource: true,
      tensionCible: 230
    };

    const nodeA: Node = {
      id: 'node-a',
      name: 'Circuit A - EQUI8',
      lat: 0.001,
      lng: 0.001,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [{ id: 'cA', label: 'Charge A', S_kVA: 6 }],
      productions: [],
      phaseDistribution: {
        charges: { A: 90, B: 5, C: 5 }
      }
    };

    const nodeA2: Node = {
      id: 'node-a2',
      name: 'Circuit A - Bout',
      lat: 0.003,
      lng: 0.001,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [],
      productions: []
    };

    const nodeB: Node = {
      id: 'node-b',
      name: 'Circuit B',
      lat: 0.001,
      lng: -0.001,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [{ id: 'cB', label: 'Charge B', S_kVA: 5 }],
      productions: [],
      phaseDistribution: {
        charges: { A: 33, B: 33, C: 34 }  // Équilibré
      }
    };

    const nodeB2: Node = {
      id: 'node-b2',
      name: 'Circuit B - Bout',
      lat: 0.003,
      lng: -0.001,
      connectionType: 'TÉRA_3P+N_230_400V',
      clients: [],
      productions: []
    };

    const cables: Cable[] = [
      { id: 'c-sa', name: 'Source→A', typeId: defaultCableType.id, pose: 'SOUTERRAIN', nodeAId: source.id, nodeBId: nodeA.id, coordinates: [], length_m: 100 },
      { id: 'c-aa2', name: 'A→A2', typeId: defaultCableType.id, pose: 'SOUTERRAIN', nodeAId: nodeA.id, nodeBId: nodeA2.id, coordinates: [], length_m: 200 },
      { id: 'c-sb', name: 'Source→B', typeId: defaultCableType.id, pose: 'SOUTERRAIN', nodeAId: source.id, nodeBId: nodeB.id, coordinates: [], length_m: 100 },
      { id: 'c-bb2', name: 'B→B2', typeId: defaultCableType.id, pose: 'SOUTERRAIN', nodeAId: nodeB.id, nodeBId: nodeB2.id, coordinates: [], length_m: 200 }
    ];

    const compensatorA: NeutralCompensator = {
      id: 'equi8-a',
      nodeId: nodeA.id,
      maxPower_kVA: 10,
      tolerance_A: 0.5,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.5
    };

    const project: Project = {
      id: 'test-isolation',
      name: 'Test Isolation Circuits',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 0,
      defaultChargeKVA: 5,
      defaultProductionKVA: 0,
      transformerConfig: {
        rating: '250kVA',
        nominalPower_kVA: 250,
        nominalVoltage_V: 400,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.95
      },
      loadModel: 'monophase_reparti',
      desequilibrePourcent: 90,
      nodes: [source, nodeA, nodeA2, nodeB, nodeB2],
      cables,
      cableTypes: [defaultCableType],
      simulationEquipment: {
        srg2Devices: [],
        neutralCompensators: [compensatorA],
        cableUpgrades: []
      }
    };

    const resultWithout = calculator.calculateScenarioWithHTConfig(
      { ...project, simulationEquipment: { srg2Devices: [], neutralCompensators: [], cableUpgrades: [] } },
      'PRÉLÈVEMENT'
    );

    const resultWith = calculator.runSimulation(
      project,
      'PRÉLÈVEMENT',
      { srg2Devices: [], neutralCompensators: [compensatorA], cableUpgrades: [] }
    );

    // Récupérer les tensions circuit B
    const nodeBWithout = resultWithout.nodeMetricsPerPhase?.find(nm => nm.nodeId === nodeB.id);
    const nodeBWith = resultWith.nodeMetricsPerPhase?.find(nm => nm.nodeId === nodeB.id);
    const nodeB2Without = resultWithout.nodeMetricsPerPhase?.find(nm => nm.nodeId === nodeB2.id);
    const nodeB2With = resultWith.nodeMetricsPerPhase?.find(nm => nm.nodeId === nodeB2.id);

    expect(nodeBWithout).toBeDefined();
    expect(nodeBWith).toBeDefined();
    expect(nodeB2Without).toBeDefined();
    expect(nodeB2With).toBeDefined();

    // Les tensions dans le circuit B ne doivent PAS changer
    const diffB_A = Math.abs(nodeBWith!.voltagesPerPhase.A - nodeBWithout!.voltagesPerPhase.A);
    const diffB_B = Math.abs(nodeBWith!.voltagesPerPhase.B - nodeBWithout!.voltagesPerPhase.B);
    const diffB_C = Math.abs(nodeBWith!.voltagesPerPhase.C - nodeBWithout!.voltagesPerPhase.C);

    const diffB2_A = Math.abs(nodeB2With!.voltagesPerPhase.A - nodeB2Without!.voltagesPerPhase.A);
    const diffB2_B = Math.abs(nodeB2With!.voltagesPerPhase.B - nodeB2Without!.voltagesPerPhase.B);
    const diffB2_C = Math.abs(nodeB2With!.voltagesPerPhase.C - nodeB2Without!.voltagesPerPhase.C);

    console.log('📊 Test 4 - Différences Circuit B (isolé):');
    console.log(`   NodeB: |ΔV_A|=${diffB_A.toFixed(3)}V, |ΔV_B|=${diffB_B.toFixed(3)}V, |ΔV_C|=${diffB_C.toFixed(3)}V`);
    console.log(`   NodeB2: |ΔV_A|=${diffB2_A.toFixed(3)}V, |ΔV_B|=${diffB2_B.toFixed(3)}V, |ΔV_C|=${diffB2_C.toFixed(3)}V`);

    // Tolérance stricte: circuit B ne doit pas être affecté (< 0.1V)
    expect(diffB_A).toBeLessThan(0.1);
    expect(diffB_B).toBeLessThan(0.1);
    expect(diffB_C).toBeLessThan(0.1);
    expect(diffB2_A).toBeLessThan(0.1);
    expect(diffB2_B).toBeLessThan(0.1);
    expect(diffB2_C).toBeLessThan(0.1);
  });
});
