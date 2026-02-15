/**
 * Modèle thermique saisonnier des câbles
 * 
 * Corrige la résistance des conducteurs en fonction de :
 * - La saison (hiver / été) → température ambiante
 * - Le type de pose (aérien / souterrain) → température ambiante + échauffement
 * - Le courant de charge (I / Imax) → échauffement supplémentaire
 * - Le matériau (Cu / Al) → coefficient de température α
 * 
 * Formules :
 *   T_ambient = f(saison, pose)
 *   T_cable = T_ambient + k × (I / Imax)²
 *   R(T) = R20 × (1 + α × (T - 20))
 * 
 * Impact : R plus élevée en été → chute de tension plus forte
 *          R plus basse en hiver → chute de tension plus faible
 */

import { CablePose } from '@/types/network';

export type ThermalSeason = 'winter' | 'summer';

// Températures ambiantes de référence (°C)
const AMBIENT_TEMPERATURES: Record<string, Record<ThermalSeason, number>> = {
  'AÉRIEN':      { winter: 5,  summer: 28 },
  'SOUTERRAIN':  { winter: 12, summer: 20 },
};

// Constante d'échauffement k (°C) par type de pose
const HEATING_CONSTANTS: Record<string, number> = {
  'AÉRIEN': 40,
  'SOUTERRAIN': 35,
};

// Coefficients de température α (1/°C) par matériau
const ALPHA_COEFFICIENTS: Record<string, number> = {
  'CUIVRE': 0.00393,
  'ALUMINIUM': 0.00403,
  'Cu': 0.00393,
  'Alu': 0.00403,
};

/**
 * Retourne la température ambiante en °C selon la saison et le type de pose
 */
export function getAmbientTemperature(season: ThermalSeason, pose: CablePose): number {
  const temps = AMBIENT_TEMPERATURES[pose];
  if (!temps) return 20; // Fallback à 20°C (pas de correction)
  return temps[season];
}

/**
 * Calcule la température du câble en °C
 * T = T_ambient + k × (I / Imax)²
 * 
 * @param T_ambient Température ambiante (°C)
 * @param I_A Courant de charge actuel (A)
 * @param Imax_A Courant admissible maximal (A)
 * @param pose Type de pose du câble
 */
export function calculateCableTemperature(
  T_ambient: number,
  I_A: number,
  Imax_A: number,
  pose: CablePose
): number {
  const k = HEATING_CONSTANTS[pose] || 0;
  
  // Si Imax non défini ou nul, pas d'échauffement par surcharge
  if (!Imax_A || Imax_A <= 0 || !isFinite(Imax_A)) {
    return T_ambient;
  }
  
  const ratio = Math.min(I_A / Imax_A, 2); // Limiter le ratio à 2x pour éviter les valeurs extrêmes
  return T_ambient + k * ratio * ratio;
}

/**
 * Corrige la résistance R20 pour la température T du câble
 * R(T) = R20 × (1 + α × (T - 20))
 * 
 * @param R20 Résistance à 20°C (Ω/km)
 * @param T_cable Température du câble (°C)
 * @param matiere Matériau du conducteur
 */
export function correctResistance(
  R20: number,
  T_cable: number,
  matiere: string
): number {
  const alpha = ALPHA_COEFFICIENTS[matiere];
  if (!alpha) return R20; // Matériau inconnu → pas de correction
  
  return R20 * (1 + alpha * (T_cable - 20));
}

/**
 * Retourne le facteur de correction thermique multiplicatif pour R
 * factor = R(T) / R20 = 1 + α × (T - 20)
 * 
 * Fonction tout-en-un pour application directe sur R12 et R0
 * 
 * @param season Saison ('winter' | 'summer')
 * @param pose Type de pose ('AÉRIEN' | 'SOUTERRAIN')
 * @param matiere Matériau ('CUIVRE' | 'ALUMINIUM' | 'Cu' | 'Alu')
 * @param I_A Courant de charge actuel (A), 0 si inconnu
 * @param Imax_A Courant admissible maximal (A), 0 si non défini
 */
export function getThermalCorrectionFactor(
  season: ThermalSeason,
  pose: CablePose,
  matiere: string,
  I_A: number = 0,
  Imax_A: number = 0
): number {
  const T_ambient = getAmbientTemperature(season, pose);
  const T_cable = calculateCableTemperature(T_ambient, I_A, Imax_A, pose);
  
  const alpha = ALPHA_COEFFICIENTS[matiere];
  if (!alpha) return 1; // Pas de correction
  
  return 1 + alpha * (T_cable - 20);
}
