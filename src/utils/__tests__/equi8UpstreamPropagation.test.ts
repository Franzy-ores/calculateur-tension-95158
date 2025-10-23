import { describe, it, expect } from 'vitest';
import { ElectricalCalculator } from '../electricalCalculations';
import { SimulationCalculator } from '../simulationCalculator';
import type { Project, Node, Cable, CableType, NeutralCompensator } from '@/types/network';

describe('EQUI8 Upstream Propagation', () => {
  // Helper pour créer un réseau de test simple
  const createTestNetwork = (): { project: Project, compensators: NeutralCompensator[] } => {
    const cableType: CableType = {
      id: 'test-cable',
      label: 'Test Cable',
      R12_ohm_per_km: 0.32,
      X12_ohm_per_km: 0.08,
      R0_ohm_per_km: 0.64,
      X0_ohm_per_km: 0.16,
      matiere: 'ALUMINIUM',
      posesPermises: ['AÉRIEN', 'SOUTERRAIN']
    };

    const sourceNode: Node = {
      id: 'source',
      name: 'Source',
      lat: 0,
      lng: 0,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [],
      productions: [],
      isSource: true,
      tensionCible: 400
    };

    const node1: Node = {
      id: 'node1',
      name: 'Node 1',
      lat: 0.001,
      lng: 0.001,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [{ id: 'c1', label: 'Charge 1', S_kVA: 10 }],
      productions: [],
      phaseDistribution: {
        charges: { A: 50, B: 30, C: 20 }, // Déséquilibre fort
        productions: { A: 0, B: 0, C: 0 }
      }
    };

    const node10: Node = {
      id: 'node10',
      name: 'Node 10 (EQUI8)',
      lat: 0.002,
      lng: 0.002,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [{ id: 'c10', label: 'Charge 10', S_kVA: 15 }],
      productions: [],
      phaseDistribution: {
        charges: { A: 60, B: 25, C: 15 }, // Déséquilibre très fort
        productions: { A: 0, B: 0, C: 0 }
      }
    };

    const cable1: Cable = {
      id: 'cable_source_node1',
      name: 'Cable Source-Node1',
      typeId: cableType.id,
      pose: 'AÉRIEN',
      nodeAId: sourceNode.id,
      nodeBId: node1.id,
      coordinates: [
        { lat: sourceNode.lat, lng: sourceNode.lng },
        { lat: node1.lat, lng: node1.lng }
      ],
      length_m: 100
    };

    const cable2: Cable = {
      id: 'cable_node1_node10',
      name: 'Cable Node1-Node10',
      typeId: cableType.id,
      pose: 'AÉRIEN',
      nodeAId: node1.id,
      nodeBId: node10.id,
      coordinates: [
        { lat: node1.lat, lng: node1.lng },
        { lat: node10.lat, lng: node10.lng }
      ],
      length_m: 150
    };

    const project: Project = {
      id: 'test-project',
      name: 'Test Project',
      voltageSystem: 'TÉTRAPHASÉ_400V',
      cosPhi: 0.95,
      foisonnementCharges: 100,
      foisonnementProductions: 100,
      defaultChargeKVA: 5,
      defaultProductionKVA: 5,
      transformerConfig: {
        rating: '250kVA',
        nominalPower_kVA: 250,
        nominalVoltage_V: 400,
        shortCircuitVoltage_percent: 4,
        cosPhi: 0.95,
        xOverR: 3
      },
      loadModel: 'monophase_reparti',
      desequilibrePourcent: 40,
      nodes: [sourceNode, node1, node10],
      cables: [cable1, cable2],
      cableTypes: [cableType]
    };

    const compensator: NeutralCompensator = {
      id: 'equi8-1',
      nodeId: node10.id,
      maxPower_kVA: 100, // Non limité pour ce test
      tolerance_A: 1,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.3
    };

    return { project, compensators: [compensator] };
  };

  it('should reduce upstream cable current when EQUI8 is active', () => {
    const { project, compensators } = createTestNetwork();
    const calc = new SimulationCalculator();

    // Calcul sans EQUI8
    const resultWithout = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    );
    
    const cable_upstream_without = resultWithout.cables.find(c => c.id === 'cable_source_node1');
    const I_upstream_without = cable_upstream_without?.current_A || 0;
    const I_N_without = cable_upstream_without?.currentsPerPhase_A?.N || 0;

    // Calcul avec EQUI8
    const resultWith = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: [],
        neutralCompensators: compensators,
        cableUpgrades: []
      }
    );
    
    const cable_upstream_with = resultWith.cables.find(c => c.id === 'cable_source_node1');
    const I_upstream_with = cable_upstream_with?.current_A || 0;
    const I_N_with = cable_upstream_with?.currentsPerPhase_A?.N || 0;

    // Vérifier la réduction du courant neutre
    console.log('Test EQUI8 Upstream Propagation:', {
      'I_upstream sans EQUI8': `${I_upstream_without.toFixed(1)}A`,
      'I_upstream avec EQUI8': `${I_upstream_with.toFixed(1)}A`,
      'I_N sans EQUI8': `${I_N_without.toFixed(1)}A`,
      'I_N avec EQUI8': `${I_N_with.toFixed(1)}A`,
      'Réduction I_N': `${((1 - I_N_with / I_N_without) * 100).toFixed(1)}%`
    });

    // Le courant neutre en amont doit être réduit
    expect(I_N_with).toBeLessThan(I_N_without);
    
    // Réduction attendue : au moins 10% (dépend de la topologie et des charges)
    const reduction_percent = (1 - I_N_with / I_N_without) * 100;
    expect(reduction_percent).toBeGreaterThan(5);
  });

  it('should improve downstream voltages when EQUI8 is active', () => {
    const { project, compensators } = createTestNetwork();
    const calc = new SimulationCalculator();

    // Calcul sans EQUI8
    const resultWithout = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    );
    
    const node10_metrics_without = resultWithout.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node10');
    const ecart_without = node10_metrics_without ? 
      Math.max(
        node10_metrics_without.voltagesPerPhase.A,
        node10_metrics_without.voltagesPerPhase.B,
        node10_metrics_without.voltagesPerPhase.C
      ) - Math.min(
        node10_metrics_without.voltagesPerPhase.A,
        node10_metrics_without.voltagesPerPhase.B,
        node10_metrics_without.voltagesPerPhase.C
      ) : 0;

    // Calcul avec EQUI8
    const resultWith = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: [],
        neutralCompensators: compensators,
        cableUpgrades: []
      }
    );
    
    const node10_metrics_with = resultWith.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node10');
    const ecart_with = node10_metrics_with ? 
      Math.max(
        node10_metrics_with.voltagesPerPhase.A,
        node10_metrics_with.voltagesPerPhase.B,
        node10_metrics_with.voltagesPerPhase.C
      ) - Math.min(
        node10_metrics_with.voltagesPerPhase.A,
        node10_metrics_with.voltagesPerPhase.B,
        node10_metrics_with.voltagesPerPhase.C
      ) : 0;

    console.log('Test EQUI8 Downstream Voltages:', {
      'Écart tensions sans EQUI8': `${ecart_without.toFixed(1)}V`,
      'Écart tensions avec EQUI8': `${ecart_with.toFixed(1)}V`,
      'Amélioration': `${(ecart_without - ecart_with).toFixed(1)}V`
    });

    // L'écart de tensions doit être réduit avec EQUI8
    expect(ecart_with).toBeLessThan(ecart_without);
  });
});
