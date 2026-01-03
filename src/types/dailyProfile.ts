export type Season = 'winter' | 'summer';
export type Weather = 'sunny' | 'gray';

export interface HourlyProfile {
  [hour: string]: number; // 0-23 → pourcentage (0-100)
}

export interface SeasonProfile {
  residential: HourlyProfile;
  pv: HourlyProfile;
  ev: HourlyProfile;
  industrial_pme: HourlyProfile;
}

export interface DailyProfileConfig {
  version: string;
  profiles: {
    winter: SeasonProfile;
    summer: SeasonProfile;
  };
  weatherFactors: {
    sunny: number;
    gray: number;
  };
  evPower_kVA: number;
}

export interface DailySimulationOptions {
  season: Season;
  weather: Weather;
  enableEV: boolean;
  enableIndustrialPME: boolean;
  selectedNodeId: string;
}

export interface HourlyVoltageResult {
  hour: number;
  voltageA_V: number;
  voltageB_V: number;
  voltageC_V: number;
  voltageAvg_V: number;
  voltageMin_V: number;
  voltageMax_V: number;
  deviationPercent: number;
  status: 'normal' | 'warning' | 'critical';
  // Foisonnement appliqué pour cette heure (%)
  chargesFoisonnement: number;
  productionsFoisonnement: number;
}

export const defaultDailySimulationOptions: DailySimulationOptions = {
  season: 'winter',
  weather: 'sunny',
  enableEV: true,
  enableIndustrialPME: true,
  selectedNodeId: ''
};
