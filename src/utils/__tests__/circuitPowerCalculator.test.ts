import { describe, it, expect } from 'vitest';
import {
  getClusterDelta,
  diversityFactor,
  clientHourlyPower,
  nodeHourlyPower,
  simulateCircuit24h,
} from '../circuitPowerCalculator';
import type {
  CircuitConfig,
  CircuitSimulationConfig,
  SeasonProfiles,
} from '@/types/circuitSimulation';
import defaultProfiles from '@/data/hourlyProfiles.json';

const config: CircuitSimulationConfig = {
  version: '1.0',
  diversityFactors: { A: 0.15, B: 0.13, C: 0.11, D: 0.18 },
  clusterDeltas: {
    A: {},
    B: { '18-21': 1.10 },
    C: { winter_6_9: 1.15 },
    D: { 'winter_6-9': 1.15, '22-6': 1.25 },
  },
  thresholds: { overload_kW: 100, injection_kW: -50 },
};

// Fix: clusterDeltas key for C uses underscore in JSON but dash in range
const configFixed: CircuitSimulationConfig = {
  ...config,
  clusterDeltas: {
    A: {},
    B: { '18-21': 1.10 },
    C: { 'winter_6-9': 1.15 },
    D: { 'winter_6-9': 1.15, '22-6': 1.25 },
  },
};

const profiles = {
  winter: defaultProfiles.profiles.winter as SeasonProfiles,
  summer: defaultProfiles.profiles.summer as SeasonProfiles,
};
const weatherFactors = defaultProfiles.weatherFactors;

// ─── getClusterDelta ──────────────────────────────────────────────────────────

describe('getClusterDelta', () => {
  it('cluster A returns 1.0 always', () => {
    for (let h = 0; h < 24; h++) {
      expect(getClusterDelta('A', h, 'winter', configFixed)).toBe(1.0);
    }
  });

  it('cluster B returns 1.10 at hour 19 (any season)', () => {
    expect(getClusterDelta('B', 19, 'winter', configFixed)).toBeCloseTo(1.10);
    expect(getClusterDelta('B', 19, 'summer', configFixed)).toBeCloseTo(1.10);
  });

  it('cluster B returns 1.0 at hour 12', () => {
    expect(getClusterDelta('B', 12, 'winter', configFixed)).toBe(1.0);
  });

  it('cluster C returns 1.15 at hour 7 in winter only', () => {
    expect(getClusterDelta('C', 7, 'winter', configFixed)).toBeCloseTo(1.15);
    expect(getClusterDelta('C', 7, 'summer', configFixed)).toBe(1.0);
  });

  it('cluster D wrapping range 22-6 applies at hour 2', () => {
    expect(getClusterDelta('D', 2, 'summer', configFixed)).toBeCloseTo(1.25);
  });

  it('cluster D winter hour 7 gets 1.15 (winter_6-9)', () => {
    expect(getClusterDelta('D', 7, 'winter', configFixed)).toBeCloseTo(1.15);
  });

  it('cluster D winter hour 23 gets both winter_6-9=no and 22-6=yes → 1.25', () => {
    expect(getClusterDelta('D', 23, 'winter', configFixed)).toBeCloseTo(1.25);
  });

  it('cluster D winter hour 6 gets both: winter_6-9 × 22-6 → 1.15 × 1.25', () => {
    // Hour 6 is in range 6-9 AND in wrapping range 22-6
    expect(getClusterDelta('D', 6, 'winter', configFixed)).toBeCloseTo(1.15 * 1.25);
  });
});

// ─── diversityFactor ──────────────────────────────────────────────────────────

describe('diversityFactor', () => {
  it('n=0 → 0', () => {
    expect(diversityFactor(0, 'A', configFixed)).toBe(0);
  });

  it('n=1 → 1.0', () => {
    expect(diversityFactor(1, 'B', configFixed)).toBe(1.0);
  });

  it('n=4, cluster A (a=0.15) → 0.15 + 0.85/2 = 0.575', () => {
    expect(diversityFactor(4, 'A', configFixed)).toBeCloseTo(0.575);
  });

  it('n=100, cluster D (a=0.18) → 0.18 + 0.82/10 = 0.262', () => {
    expect(diversityFactor(100, 'D', configFixed)).toBeCloseTo(0.262);
  });

  it('increases with a (higher correlation → higher factor)', () => {
    const fA = diversityFactor(25, 'A', configFixed); // a=0.15
    const fD = diversityFactor(25, 'D', configFixed); // a=0.18
    expect(fD).toBeGreaterThan(fA);
  });

  it('decreases with n', () => {
    const f5 = diversityFactor(5, 'B', configFixed);
    const f50 = diversityFactor(50, 'B', configFixed);
    expect(f50).toBeLessThan(f5);
  });
});

// ─── clientHourlyPower ────────────────────────────────────────────────────────

describe('clientHourlyPower', () => {
  it('residential client at winter hour 19 with cluster B', () => {
    const client = { id: '1', type: 'residential' as const, puissanceContrat_kW: 12 };
    const { load_kW, pv_kW } = clientHourlyPower(
      client, 19, 'winter', 'sunny', profiles, weatherFactors, 'B', configFixed,
    );
    // profile winter residential h19 = 21, delta cluster B at 19 = 1.10
    expect(load_kW).toBeCloseTo(12 * 21 / 100 * 1.10);
    expect(pv_kW).toBe(0);
  });

  it('PV client at summer hour 12 sunny', () => {
    const client = { id: '2', type: 'pv' as const, puissanceContrat_kW: 0, pvPuissance_kW: 6 };
    const { load_kW, pv_kW } = clientHourlyPower(
      client, 12, 'summer', 'sunny', profiles, weatherFactors, 'A', configFixed,
    );
    // pv summer h12 = 100, weather sunny = 1.0
    expect(pv_kW).toBeCloseTo(6 * 100 / 100 * 1.0);
    expect(load_kW).toBe(0);
  });

  it('PV client gray weather reduces output', () => {
    const client = { id: '2', type: 'pv' as const, puissanceContrat_kW: 0, pvPuissance_kW: 6 };
    const { pv_kW } = clientHourlyPower(
      client, 12, 'summer', 'gray', profiles, weatherFactors, 'A', configFixed,
    );
    expect(pv_kW).toBeCloseTo(6 * 100 / 100 * 0.3);
  });

  it('industrial_pme client is not affected by cluster delta', () => {
    const client = { id: '3', type: 'industrial_pme' as const, puissanceContrat_kW: 50 };
    const powerB = clientHourlyPower(client, 19, 'winter', 'sunny', profiles, weatherFactors, 'B', configFixed);
    const powerA = clientHourlyPower(client, 19, 'winter', 'sunny', profiles, weatherFactors, 'A', configFixed);
    expect(powerB.load_kW).toBe(powerA.load_kW);
  });

  it('public_charging uses industrial_pme profile', () => {
    const charging = { id: '4', type: 'public_charging' as const, puissanceContrat_kW: 22 };
    const indus = { id: '5', type: 'industrial_pme' as const, puissanceContrat_kW: 22 };
    const pCharge = clientHourlyPower(charging, 10, 'winter', 'sunny', profiles, weatherFactors, 'A', configFixed);
    const pIndus = clientHourlyPower(indus, 10, 'winter', 'sunny', profiles, weatherFactors, 'A', configFixed);
    expect(pCharge.load_kW).toBe(pIndus.load_kW);
  });
});

// ─── nodeHourlyPower ──────────────────────────────────────────────────────────

describe('nodeHourlyPower', () => {
  const circuit: CircuitConfig = {
    id: 'test-circuit',
    cluster: 'A',
    clients: [
      { id: '1', type: 'residential', puissanceContrat_kW: 12 },
      { id: '2', type: 'residential', puissanceContrat_kW: 9 },
      { id: '3', type: 'residential', puissanceContrat_kW: 12 },
      { id: '4', type: 'residential', puissanceContrat_kW: 9 },
      { id: 'pv1', type: 'pv', puissanceContrat_kW: 0, pvPuissance_kW: 6 },
    ],
  };

  it('winter hour 19 sunny — net load is positive (evening peak)', () => {
    const { P_charge_kW, P_pv_kW, P_net_kW } = nodeHourlyPower(
      circuit, 19, 'winter', 'sunny', profiles, weatherFactors, configFixed,
    );
    expect(P_charge_kW).toBeGreaterThan(0);
    expect(P_pv_kW).toBe(0); // winter h19 pv = 0
    expect(P_net_kW).toBe(P_charge_kW);
  });

  it('summer hour 12 sunny — PV reduces net power', () => {
    const { P_charge_kW, P_pv_kW, P_net_kW } = nodeHourlyPower(
      circuit, 12, 'summer', 'sunny', profiles, weatherFactors, configFixed,
    );
    expect(P_pv_kW).toBeGreaterThan(0);
    expect(P_net_kW).toBeLessThan(P_charge_kW);
  });

  it('diversity factor is applied to load sum, not PV', () => {
    // With 4 load clients, cluster A (a=0.15): f = 0.15 + 0.85/2 = 0.575
    const f = 0.575;
    const h = 19;
    const profile = profiles.winter.residential['19']; // 21
    const sumRaw = (12 + 9 + 12 + 9) * profile / 100; // no delta for cluster A
    const { P_charge_kW } = nodeHourlyPower(
      circuit, h, 'winter', 'sunny', profiles, weatherFactors, configFixed,
    );
    expect(P_charge_kW).toBeCloseTo(sumRaw * f, 1);
  });
});

// ─── simulateCircuit24h ───────────────────────────────────────────────────────

describe('simulateCircuit24h', () => {
  const bigCircuit: CircuitConfig = {
    id: 'big',
    cluster: 'B',
    clients: [
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `r${i}`,
        type: 'residential' as const,
        puissanceContrat_kW: 12,
      })),
      { id: 'pv1', type: 'pv' as const, puissanceContrat_kW: 0, pvPuissance_kW: 50 },
    ],
  };

  it('returns 24 hourly values', () => {
    const result = simulateCircuit24h(
      bigCircuit, 'winter', 'sunny', profiles, weatherFactors, configFixed,
    );
    expect(result.hourly).toHaveLength(24);
    expect(result.season).toBe('winter');
    expect(result.weather).toBe('sunny');
  });

  it('summer sunny midday can produce negative P_net (injection)', () => {
    const result = simulateCircuit24h(
      bigCircuit, 'summer', 'sunny', profiles, weatherFactors, configFixed,
    );
    const midday = result.hourly.find(h => h.hour === 12)!;
    // 50 kW PV at 100% summer midday vs 20 residential clients diversified
    expect(midday.P_pv_kW).toBeCloseTo(50);
    expect(midday.P_net_kW).toBeLessThan(0);
  });

  it('flags overload events correctly', () => {
    const lowThreshold: CircuitSimulationConfig = {
      ...configFixed,
      thresholds: { overload_kW: 10, injection_kW: -10 },
    };
    const result = simulateCircuit24h(
      bigCircuit, 'winter', 'sunny', profiles, weatherFactors, lowThreshold,
    );
    expect(result.nEvents_high).toBeGreaterThan(0);
  });

  it('peakLoad_kW is the maximum P_net', () => {
    const result = simulateCircuit24h(
      bigCircuit, 'winter', 'sunny', profiles, weatherFactors, configFixed,
    );
    const maxNet = Math.max(...result.hourly.map(h => h.P_net_kW));
    expect(result.peakLoad_kW).toBeCloseTo(maxNet);
  });
});
