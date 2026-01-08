export type Season = 'winter' | 'summer';
export type Weather = 'sunny' | 'gray';

export interface HourlyProfile {
  [hour: string]: number; // 0-23 → pourcentage (0-100)
}

export interface MeasuredProfileMetadata {
  name: string;
  sourceFile: string;
  importDate: string;
  measurePeriod: string;
  contractualPower_kVA: number;
  maxMeasured_VA: number;
  avgMeasured_VA: number;
  peakUsagePercent: number;
  dataPoints: number;
}

export interface SeasonProfile {
  residential: HourlyProfile;
  pv: HourlyProfile;
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
}

export interface DailySimulationOptions {
  season: Season;
  weather: Weather;
  enableEV: boolean;
  /** Bonus VE appliqué de 18h à 21h inclus (%) */
  evBonusEvening: number;
  /** Bonus VE appliqué de 22h à 5h inclus (%) */
  evBonusNight: number;
  /** @deprecated Le profil industriel est maintenant lié automatiquement aux clients industriels */
  enableIndustrialPME?: boolean;
  selectedNodeId: string;
  /** Force le profil de production à 0% pour toutes les heures */
  zeroProduction?: boolean;
  /** Utiliser le profil mesuré importé au lieu des profils théoriques */
  useMeasuredProfile?: boolean;
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
  chargesResidentialFoisonnement: number;
  chargesIndustrialFoisonnement: number;
  productionsFoisonnement: number;
  // Puissances calculées en kVA (après application du foisonnement)
  chargesResidentialPower_kVA: number;
  chargesIndustrialPower_kVA: number;
  productionsPower_kVA: number;
  // Bonus VE appliqué sur le foisonnement résidentiel (%)
  evBonus: number;
}

export const defaultDailySimulationOptions: DailySimulationOptions = {
  season: 'winter',
  weather: 'sunny',
  enableEV: true,
  evBonusEvening: 2.5,
  evBonusNight: 5,
  enableIndustrialPME: true,
  selectedNodeId: '',
  zeroProduction: false
};
