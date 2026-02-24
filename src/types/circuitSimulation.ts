/**
 * Types pour la simulation de puissance nodale par circuit BT
 */

export type CircuitCluster = 'A' | 'B' | 'C' | 'D';
export type CircuitSeason = 'winter' | 'summer';
export type CircuitWeather = 'sunny' | 'gray';
export type CircuitClientType = 'residential' | 'industrial_pme' | 'pv' | 'public_charging';

export interface CircuitClient {
  id: string;
  type: CircuitClientType;
  puissanceContrat_kW: number;
  /** Only for type = 'pv' */
  pvPuissance_kW?: number;
}

export interface CircuitConfig {
  id: string;
  cluster: CircuitCluster;
  clients: CircuitClient[];
}

/** Hourly profile: keys "0".."23" → percentage 0-100 */
export interface HourlyProfileMap {
  [hour: string]: number;
}

export interface SeasonProfiles {
  residential: HourlyProfileMap;
  industrial_pme: HourlyProfileMap;
  pv: HourlyProfileMap;
}

export interface CircuitSimulationConfig {
  version: string;
  diversityFactors: {
    A: number;
    B: number;
    C: number;
    D: number;
  };
  clusterDeltas: {
    [cluster: string]: { [rangeKey: string]: number };
  };
  thresholds: {
    overload_kW: number;
    injection_kW: number;
  };
}

export interface HourlyNodePower {
  hour: number;
  P_charge_kW: number;
  P_pv_kW: number;
  P_net_kW: number;
  flagged: boolean;
  flagType?: 'overload' | 'injection';
}

export interface CircuitSimulationResult {
  circuitId: string;
  season: CircuitSeason;
  weather: CircuitWeather;
  hourly: HourlyNodePower[];
  nEvents_high: number;
  nEvents_low: number;
  peakLoad_kW: number;
  peakInjection_kW: number;
}
