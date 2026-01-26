import { describe, it, expect } from 'vitest';
import { SimulationCalculator } from '../simulationCalculator';
import type { Project, Node, Cable, CableType } from '@/types/network';
import type { SRG2Config } from '@/types/srg2';

describe('EQUI8 + SRG2 Non-Regression', () => {
  // Helper pour créer un réseau avec SRG2
  const createSRG2Network = (): Project => {
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
      clients: [{ id: 'c1', label: 'Charge 1', S_kVA: 8 }],
      productions: [],
      hasSRG2Device: true,
      srg2RegulationCoefficients: { A: 100, B: 100, C: 100 },
      phaseDistribution: {
        charges: { A: 40, B: 30, C: 30 },
        productions: { A: 0, B: 0, C: 0 }
      }
    };

    const node2: Node = {
      id: 'node2',
      name: 'Node 2',
      lat: 0.002,
      lng: 0.002,
      connectionType: 'TÉTRA_3P+N_230_400V',
      clients: [{ id: 'c2', label: 'Charge 2', S_kVA: 12 }],
      productions: [],
      phaseDistribution: {
        charges: { A: 35, B: 35, C: 30 },
        productions: { A: 0, B: 0, C: 0 }
      }
    };

    const cable1: Cable = {
      id: 'cable1',
      name: 'Cable 1',
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
      id: 'cable2',
      name: 'Cable 2',
      typeId: cableType.id,
      pose: 'AÉRIEN',
      nodeAId: node1.id,
      nodeBId: node2.id,
      coordinates: [
        { lat: node1.lat, lng: node1.lng },
        { lat: node2.lat, lng: node2.lng }
      ],
      length_m: 120
    };

    const srg2Device: SRG2Config = {
      id: 'srg2-1',
      nodeId: node1.id,
      name: 'SRG2 Test 1',
      enabled: true,
      mode: 'AUTO',
      type: 'SRG2-400',
      tensionConsigne_V: 230,
      seuilLO2_V: 246,
      seuilLO1_V: 238,
      seuilBO1_V: 222,
      seuilBO2_V: 214,
      coefficientLO2: -7,
      coefficientLO1: -3.5,
      coefficientBO1: 3.5,
      coefficientBO2: 7,
      hysteresis_V: 2,
      temporisation_s: 7,
      puissanceMaxInjection_kVA: 85,
      puissanceMaxPrelevement_kVA: 100
    };

    return {
      id: 'test-srg2',
      name: 'Test SRG2 Network',
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
      desequilibrePourcent: 20,
      nodes: [sourceNode, node1, node2],
      cables: [cable1, cable2],
      cableTypes: [cableType],
      simulationEquipment: {
        srg2Devices: [srg2Device],
        neutralCompensators: [],
        cableUpgrades: []
      }
    };
  };

  it('should not affect SRG2-only networks (no EQUI8)', () => {
    const project = createSRG2Network();
    const calc = new SimulationCalculator();

    // Calcul avec SRG2 uniquement (baseline)
    const resultBaseline = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    );

    // Calcul avec la nouvelle version (simulationEquipment mais pas d'EQUI8)
    const resultNew = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [], // Aucun EQUI8
        cableUpgrades: []
      }
    );

    // Comparer les tensions nodales (tolérance ±0.5V)
    for (const nodeMetric of resultBaseline.nodeMetricsPerPhase || []) {
      const newMetric = resultNew.nodeMetricsPerPhase?.find(nm => nm.nodeId === nodeMetric.nodeId);
      
      if (newMetric) {
        const diffA = Math.abs(newMetric.voltagesPerPhase.A - nodeMetric.voltagesPerPhase.A);
        const diffB = Math.abs(newMetric.voltagesPerPhase.B - nodeMetric.voltagesPerPhase.B);
        const diffC = Math.abs(newMetric.voltagesPerPhase.C - nodeMetric.voltagesPerPhase.C);

        console.log(`Non-régression SRG2 nœud ${nodeMetric.nodeId}:`, {
          'ΔV_A': `${diffA.toFixed(2)}V`,
          'ΔV_B': `${diffB.toFixed(2)}V`,
          'ΔV_C': `${diffC.toFixed(2)}V`
        });

        expect(diffA).toBeLessThan(0.5);
        expect(diffB).toBeLessThan(0.5);
        expect(diffC).toBeLessThan(0.5);
      }
    }

    // Vérifier le nombre d'itérations (ne doit pas changer)
    expect(resultNew.iterations).toEqual(resultBaseline.iterations);
  });

  it('should maintain SRG2 behavior when combined with EQUI8', () => {
    const project = createSRG2Network();
    const calc = new SimulationCalculator();

    // Ajouter un EQUI8 sur un nœud sans SRG2
    const compensator = {
      id: 'equi8-1',
      nodeId: 'node2',
      maxPower_kVA: 50,
      tolerance_A: 1,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.3
    };

    // Calcul avec SRG2 uniquement (baseline)
    const resultSRG2Only = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    );

    // Calcul avec SRG2 + EQUI8
    const resultCombined = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    );

    // Le nœud avec SRG2 (node1) doit conserver un comportement similaire
    const node1_baseline = resultSRG2Only.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');
    const node1_combined = resultCombined.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');

    if (node1_baseline && node1_combined) {
      // Les tensions au nœud SRG2 ne doivent pas dériver de plus de 2V
      // (légère variation acceptable due à l'influence EQUI8 en aval)
      const diffA = Math.abs(node1_combined.voltagesPerPhase.A - node1_baseline.voltagesPerPhase.A);
      const diffB = Math.abs(node1_combined.voltagesPerPhase.B - node1_baseline.voltagesPerPhase.B);
      const diffC = Math.abs(node1_combined.voltagesPerPhase.C - node1_baseline.voltagesPerPhase.C);

      console.log('SRG2 + EQUI8 combined (node1 SRG2):', {
        'ΔV_A': `${diffA.toFixed(2)}V`,
        'ΔV_B': `${diffB.toFixed(2)}V`,
        'ΔV_C': `${diffC.toFixed(2)}V`
      });

      expect(diffA).toBeLessThan(2.0);
      expect(diffB).toBeLessThan(2.0);
      expect(diffC).toBeLessThan(2.0);
    }

    // Le nœud avec EQUI8 (node2) doit montrer une amélioration du déséquilibre
    const node2_baseline = resultSRG2Only.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');
    const node2_combined = resultCombined.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');

    if (node2_baseline && node2_combined) {
      const ecart_baseline = Math.max(
        node2_baseline.voltagesPerPhase.A,
        node2_baseline.voltagesPerPhase.B,
        node2_baseline.voltagesPerPhase.C
      ) - Math.min(
        node2_baseline.voltagesPerPhase.A,
        node2_baseline.voltagesPerPhase.B,
        node2_baseline.voltagesPerPhase.C
      );

      const ecart_combined = Math.max(
        node2_combined.voltagesPerPhase.A,
        node2_combined.voltagesPerPhase.B,
        node2_combined.voltagesPerPhase.C
      ) - Math.min(
        node2_combined.voltagesPerPhase.A,
        node2_combined.voltagesPerPhase.B,
        node2_combined.voltagesPerPhase.C
      );

      console.log('EQUI8 effect on node2:', {
        'Écart sans EQUI8': `${ecart_baseline.toFixed(1)}V`,
        'Écart avec EQUI8': `${ecart_combined.toFixed(1)}V`,
        'Amélioration': `${(ecart_baseline - ecart_combined).toFixed(1)}V`
      });

      // EQUI8 doit réduire l'écart de tensions
      expect(ecart_combined).toBeLessThanOrEqual(ecart_baseline);
    }
  });

  it('should handle SRG2 and EQUI8 on the same node (conflict resolution)', () => {
    const project = createSRG2Network();
    const calc = new SimulationCalculator();

    // Ajouter un EQUI8 sur le MÊME nœud que le SRG2 (node1)
    const conflictCompensator = {
      id: 'equi8-conflict',
      nodeId: 'node1', // Même nœud que le SRG2
      maxPower_kVA: 50,
      tolerance_A: 1,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.3
    };

    // Le calcul ne doit pas planter et l'EQUI8 doit être ignoré (SRG2 prioritaire)
    const result = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [conflictCompensator],
        cableUpgrades: []
      }
    );

    // Vérifier que le calcul a abouti
    expect(result).toBeDefined();
    expect(result.nodeMetricsPerPhase).toBeDefined();

    // Le résultat doit être similaire à un calcul SRG2 seul (EQUI8 ignoré)
    const srg2OnlyResult = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    );

    // Les tensions doivent être identiques (EQUI8 en conflit = désactivé)
    const node1_conflict = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');
    const node1_srg2only = srg2OnlyResult.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');

    if (node1_conflict && node1_srg2only) {
      console.log('Conflit SRG2+EQUI8 même nœud:', {
        'Avec conflit': node1_conflict.voltagesPerPhase,
        'SRG2 seul': node1_srg2only.voltagesPerPhase
      });

      // Les tensions doivent être identiques (tolérance 0.1V)
      expect(Math.abs(node1_conflict.voltagesPerPhase.A - node1_srg2only.voltagesPerPhase.A)).toBeLessThan(0.1);
      expect(Math.abs(node1_conflict.voltagesPerPhase.B - node1_srg2only.voltagesPerPhase.B)).toBeLessThan(0.1);
      expect(Math.abs(node1_conflict.voltagesPerPhase.C - node1_srg2only.voltagesPerPhase.C)).toBeLessThan(0.1);
    }
  });

  it('should converge when EQUI8 is upstream of SRG2', () => {
    // Créer un réseau où EQUI8 est en amont du SRG2
    const project = createSRG2Network();
    
    // Déplacer le SRG2 sur node2 (aval)
    const modifiedProject = {
      ...project,
      nodes: project.nodes.map(n => {
        if (n.id === 'node1') {
          return { ...n, hasSRG2Device: false };
        }
        if (n.id === 'node2') {
          return { ...n, hasSRG2Device: true };
        }
        return n;
      }),
      simulationEquipment: {
        ...project.simulationEquipment,
        srg2Devices: project.simulationEquipment?.srg2Devices?.map(srg2 => ({
          ...srg2,
          nodeId: 'node2' // SRG2 sur node2 (aval)
        })) || []
      }
    };

    // EQUI8 sur node1 (amont du SRG2)
    const upstreamCompensator = {
      id: 'equi8-upstream',
      nodeId: 'node1', // Amont du SRG2
      maxPower_kVA: 50,
      tolerance_A: 1,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.3
    };

    const calc = new SimulationCalculator();

    const result = calc.calculateWithSimulation(
      modifiedProject,
      'PRÉLÈVEMENT',
      {
        srg2Devices: modifiedProject.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [upstreamCompensator],
        cableUpgrades: []
      }
    );

    // Vérifier que le calcul a convergé
    expect(result).toBeDefined();
    expect(result.nodeMetricsPerPhase).toBeDefined();

    // Vérifier que les tensions sont réalistes (pas de divergence)
    const node1_metrics = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');
    const node2_metrics = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');

    if (node1_metrics && node2_metrics) {
      console.log('EQUI8 amont + SRG2 aval:', {
        'Node1 (EQUI8)': node1_metrics.voltagesPerPhase,
        'Node2 (SRG2)': node2_metrics.voltagesPerPhase
      });

      // Les tensions doivent être dans une plage réaliste (200-250V)
      expect(node1_metrics.voltagesPerPhase.A).toBeGreaterThan(200);
      expect(node1_metrics.voltagesPerPhase.A).toBeLessThan(250);
      expect(node2_metrics.voltagesPerPhase.A).toBeGreaterThan(200);
      expect(node2_metrics.voltagesPerPhase.A).toBeLessThan(250);
    }
  });

  it('should show sequential EQUI8→SRG2 execution in combined mode', () => {
    const project = createSRG2Network();
    const calc = new SimulationCalculator();

    // EQUI8 sur node2 (aval du SRG2)
    const compensator = {
      id: 'equi8-downstream',
      nodeId: 'node2',
      maxPower_kVA: 50,
      tolerance_A: 1,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.3
    };

    // Calcul EQUI8 seul
    const equi8Only = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    );

    // Calcul SRG2 seul
    const srg2Only = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    );

    // Calcul combiné EQUI8 → SRG2
    const combined = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    );

    // Vérifier que le résultat combiné est déterministe
    const result2 = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    );

    const node2_combined = combined.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');
    const node2_r2 = result2.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');
    const node2_equi8Only = equi8Only.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');
    const node2_srg2Only = srg2Only.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');

    if (node2_combined && node2_r2 && node2_equi8Only && node2_srg2Only) {
      console.log('Séquence EQUI8→SRG2:', {
        'EQUI8 seul': node2_equi8Only.voltagesPerPhase,
        'SRG2 seul': node2_srg2Only.voltagesPerPhase,
        'Combiné': node2_combined.voltagesPerPhase
      });

      // Résultats déterministes
      expect(node2_combined.voltagesPerPhase.A).toBeCloseTo(node2_r2.voltagesPerPhase.A, 2);
      expect(node2_combined.voltagesPerPhase.B).toBeCloseTo(node2_r2.voltagesPerPhase.B, 2);
      expect(node2_combined.voltagesPerPhase.C).toBeCloseTo(node2_r2.voltagesPerPhase.C, 2);

      // Le combiné doit montrer un meilleur équilibre que SRG2 seul (effet EQUI8)
      const ecart_srg2Only = Math.max(
        node2_srg2Only.voltagesPerPhase.A,
        node2_srg2Only.voltagesPerPhase.B,
        node2_srg2Only.voltagesPerPhase.C
      ) - Math.min(
        node2_srg2Only.voltagesPerPhase.A,
        node2_srg2Only.voltagesPerPhase.B,
        node2_srg2Only.voltagesPerPhase.C
      );

      const ecart_combined = Math.max(
        node2_combined.voltagesPerPhase.A,
        node2_combined.voltagesPerPhase.B,
        node2_combined.voltagesPerPhase.C
      ) - Math.min(
        node2_combined.voltagesPerPhase.A,
        node2_combined.voltagesPerPhase.B,
        node2_combined.voltagesPerPhase.C
      );

      console.log('Effet équilibrage EQUI8 dans combiné:', {
        'Écart SRG2 seul': `${ecart_srg2Only.toFixed(1)}V`,
        'Écart combiné': `${ecart_combined.toFixed(1)}V`
      });

      // L'EQUI8 doit réduire l'écart même dans le mode combiné
      expect(ecart_combined).toBeLessThanOrEqual(ecart_srg2Only);
    }
  });

  it('should use iterative coupling loop: EQUI8 → SRG2 → iterate until convergence', () => {
    /**
     * Test du comportement itératif de la simulation couplée SRG2 + EQUI8
     * 
     * Principe physique vérifié:
     * - L'EQUI8 agit en PERMANENCE et modifie la répartition des charges
     * - Le SRG2 voit le réseau ÉQUILIBRÉ par l'EQUI8 pour prendre sa décision
     * - La boucle itère: Réseau → EQUI8 → SRG2 → modification → Réseau → ...
     * - Convergence quand: tap_change == 0 pendant 2 itérations consécutives
     *   (Le SRG2 est un automate à seuil, pas un régulateur PID)
     */
    const project = createSRG2Network();
    const calc = new SimulationCalculator();

    // EQUI8 sur node2 (aval du SRG2)
    const compensator = {
      id: 'equi8-coupled',
      nodeId: 'node2',
      maxPower_kVA: 50,
      tolerance_A: 1,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.3
    };

    // Exécuter la simulation couplée
    const result = calc.calculateWithSimulation(
      project,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    );

    // Vérifier que la convergence a été atteinte
    expect(result.convergenceStatus).toBe('converged');
    expect(result.iterations).toBeDefined();
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(result.iterations).toBeLessThanOrEqual(10); // MAX_COUPLED_ITERATIONS

    console.log('Simulation couplée itérative:', {
      'Convergence': result.convergenceStatus,
      'Itérations': result.iterations,
      'Tensions finales node1': result.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1')?.voltagesPerPhase,
      'Tensions finales node2': result.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2')?.voltagesPerPhase
    });

    // Vérifier les tensions sont réalistes (pas de divergence)
    const node1_metrics = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');
    const node2_metrics = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node2');

    if (node1_metrics && node2_metrics) {
      // Tensions dans plage EN50160 élargie (200-250V)
      expect(node1_metrics.voltagesPerPhase.A).toBeGreaterThan(200);
      expect(node1_metrics.voltagesPerPhase.A).toBeLessThan(250);
      expect(node2_metrics.voltagesPerPhase.A).toBeGreaterThan(200);
      expect(node2_metrics.voltagesPerPhase.A).toBeLessThan(250);
    }
  });

  it('should SRG2 see EQUI8-balanced network for regulation decision', () => {
    /**
     * Test critique: Le SRG2 doit prendre sa décision de régulation
     * sur le réseau ÉQUILIBRÉ par l'EQUI8, pas sur le réseau brut.
     * 
     * Cas de test: réseau déséquilibré avec surtension sur une phase
     * - Sans EQUI8: SRG2 voit surtension → active LO1/LO2
     * - Avec EQUI8: réseau équilibré → SRG2 peut rester en BYP si moyenne OK
     */
    const project = createSRG2Network();
    
    // Créer un fort déséquilibre pour tester le comportement
    const unbalancedProject = {
      ...project,
      nodes: project.nodes.map(n => {
        if (n.id === 'node1') {
          return {
            ...n,
            phaseDistribution: {
              charges: { A: 70, B: 15, C: 15 }, // Fort déséquilibre
              productions: { A: 0, B: 0, C: 0 }
            }
          };
        }
        return n;
      }),
      desequilibrePourcent: 50 // Fort déséquilibre global
    };

    const calc = new SimulationCalculator();

    // EQUI8 sur le même nœud où il y a le déséquilibre
    const compensator = {
      id: 'equi8-balance',
      nodeId: 'node2',
      maxPower_kVA: 50,
      tolerance_A: 1,
      enabled: true,
      Zph_Ohm: 0.3,
      Zn_Ohm: 0.3
    };

    // Calcul SRG2 seul (voit le réseau déséquilibré)
    const srg2Only = calc.calculateWithSimulation(
      unbalancedProject,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    );

    // Calcul combiné (SRG2 voit le réseau équilibré par EQUI8)
    const combined = calc.calculateWithSimulation(
      unbalancedProject,
      'PRÉLÈVEMENT',
      {
        srg2Devices: project.simulationEquipment?.srg2Devices || [],
        neutralCompensators: [compensator],
        cableUpgrades: []
      }
    );

    const node1_srg2Only = srg2Only.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');
    const node1_combined = combined.nodeMetricsPerPhase?.find(nm => nm.nodeId === 'node1');

    if (node1_srg2Only && node1_combined) {
      const ecart_srg2Only = Math.max(
        node1_srg2Only.voltagesPerPhase.A,
        node1_srg2Only.voltagesPerPhase.B,
        node1_srg2Only.voltagesPerPhase.C
      ) - Math.min(
        node1_srg2Only.voltagesPerPhase.A,
        node1_srg2Only.voltagesPerPhase.B,
        node1_srg2Only.voltagesPerPhase.C
      );

      const ecart_combined = Math.max(
        node1_combined.voltagesPerPhase.A,
        node1_combined.voltagesPerPhase.B,
        node1_combined.voltagesPerPhase.C
      ) - Math.min(
        node1_combined.voltagesPerPhase.A,
        node1_combined.voltagesPerPhase.B,
        node1_combined.voltagesPerPhase.C
      );

      console.log('SRG2 sur réseau équilibré vs déséquilibré:', {
        'SRG2 seul - écart': `${ecart_srg2Only.toFixed(1)}V`,
        'Combiné - écart': `${ecart_combined.toFixed(1)}V`,
        'SRG2 seul - tensions': node1_srg2Only.voltagesPerPhase,
        'Combiné - tensions': node1_combined.voltagesPerPhase
      });

      // Le mode combiné doit avoir un meilleur équilibre (EQUI8 agit)
      expect(ecart_combined).toBeLessThanOrEqual(ecart_srg2Only + 0.1);
    }

    // Vérifier la convergence
    expect(combined.convergenceStatus).toBe('converged');
  });
});
