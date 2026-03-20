/**
 * Test E2E : curseurs de déséquilibre en 230V Triangle → tensions nodales
 */
import { describe, it, expect } from 'vitest';
import { ElectricalCalculator } from '../electricalCalculations';
import { calculateNodeAutoPhaseDistribution } from '../phaseDistributionCalculator';
import { Node, Cable, CableType, TransformerConfig, ClientImporte, ClientLink } from '@/types/network';

const cableType: CableType = {
  id: 'alu150', label: 'ALU 150',
  R12_ohm_per_km: 0.206, X12_ohm_per_km: 0.08,
  R0_ohm_per_km: 0.41, X0_ohm_per_km: 0.16,
  matiere: 'ALUMINIUM', posesPermises: ['SOUTERRAIN'], maxCurrent_A: 280,
};

const transformer: TransformerConfig = {
  rating: '250kVA', nominalPower_kVA: 250, nominalVoltage_V: 230,
  shortCircuitVoltage_percent: 4, cosPhi: 0.9, xOverR: 4,
};

const mkNode = (id: string, name: string, isSource: boolean): Node => ({
  id, name, lat: 50, lng: 4, connectionType: 'TRI_230V_3F',
  clients: [], productions: [], isSource,
});

const degPerMeter = 1 / 111320;
const mkCable = (a: string, b: string, m: number): Cable => ({
  id: 'c1', name: 'Cable 1', nodeAId: a, nodeBId: b, typeId: cableType.id,
  pose: 'SOUTERRAIN',
  coordinates: [{ lat: 50, lng: 4 }, { lat: 50 + m * degPerMeter, lng: 4 }],
});

const mkMono = (id: string, kVA: number, coupling: 'A-B'|'B-C'|'A-C', phase: 'A'|'B'|'C'): ClientImporte => ({
  id, identifiantCircuit: `CIR_${id}`, nomCircuit: `Client ${id}`,
  lat: 50, lng: 4, puissanceContractuelle_kVA: kVA, puissancePV_kVA: 0,
  couplage: 'MONO', connectionType: 'MONO', phaseCoupling: coupling, assignedPhase: phase,
});

function runWithSliders(sliders: { A: number; B: number; C: number }) {
  const source = mkNode('src', 'Source', true);
  const load = mkNode('ld', 'Load', false);
  const cable = mkCable('src', 'ld', 200);

  const clients: ClientImporte[] = [
    mkMono('m1', 12, 'A-B', 'A'),
    mkMono('m2', 12, 'B-C', 'B'),
    mkMono('m3', 12, 'A-C', 'C'),
  ];
  const clientLinks: ClientLink[] = clients.map(c => ({
    id: `link-${c.id}`, clientId: c.id, nodeId: 'ld',
  }));

  const coupling = {
    'A-B': sliders.A, 'B-C': sliders.B, 'A-C': sliders.C,
  } as Record<'A-B'|'B-C'|'A-C', number>;

  const dist = calculateNodeAutoPhaseDistribution(
    load, clients, sliders,
    { A: 33.33, B: 33.33, C: 33.34 },
    'TRIPHASÉ_230V', 15, 70, 100,
    coupling,
    { 'A-B': 33.33, 'B-C': 33.33, 'A-C': 33.34 },
    false,
  );
  load.autoPhaseDistribution = dist;

  const manualPD = {
    charges: sliders,
    productions: { A: 33.33, B: 33.33, C: 33.34 },
    constraints: { min: 0, max: 100, total: 100 },
  };

  const calc = new ElectricalCalculator(0.95);
  return calc.calculateScenario(
    [source, load], [cable], [cableType],
    'MIXTE', 15, 100, transformer,
    'mixte_mono_poly', 0, manualPD,
    clients, clientLinks, 15, 70,
  );
}

describe('230V Triangle – curseurs déséquilibre → tensions', () => {
  it('33/33/34 (équilibré) : phases proches', () => {
    const r = runWithSliders({ A: 33.33, B: 33.33, C: 33.34 });
    expect(r.success).toBe(true);
    const m = r.nodeMetricsPerPhase?.find(x => x.nodeId === 'ld');
    expect(m).toBeDefined();
    expect(Math.abs(m!.voltageA_V - m!.voltageB_V)).toBeLessThan(1);
    expect(Math.abs(m!.voltageB_V - m!.voltageC_V)).toBeLessThan(1);
  });

  it('60/20/20 (déséquilibré) : phases divergent', () => {
    const r = runWithSliders({ A: 60, B: 20, C: 20 });
    expect(r.success).toBe(true);
    const m = r.nodeMetricsPerPhase?.find(x => x.nodeId === 'ld');
    expect(m).toBeDefined();
    const maxDiff = Math.max(
      Math.abs(m!.voltageA_V - m!.voltageB_V),
      Math.abs(m!.voltageB_V - m!.voltageC_V),
      Math.abs(m!.voltageA_V - m!.voltageC_V),
    );
    expect(maxDiff).toBeGreaterThan(0.3);
  });

  it('60/20/20 produit des tensions ≠ de 33/33/34', () => {
    const bal = runWithSliders({ A: 33.33, B: 33.33, C: 33.34 });
    const unb = runWithSliders({ A: 60, B: 20, C: 20 });
    const bm = bal.nodeMetricsPerPhase?.find(x => x.nodeId === 'ld')!;
    const um = unb.nodeMetricsPerPhase?.find(x => x.nodeId === 'ld')!;
    const totalDiff =
      Math.abs(bm.voltageA_V - um.voltageA_V) +
      Math.abs(bm.voltageB_V - um.voltageB_V) +
      Math.abs(bm.voltageC_V - um.voltageC_V);
    expect(totalDiff).toBeGreaterThan(0.5);
  });
});
