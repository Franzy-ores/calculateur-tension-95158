/**
 * Profil de charge bimodal pour bornes de recharge VE
 * Usage mixte : public (jour) + domicile (nuit)
 * Valeurs normalisées 0-1 (fraction de la puissance raccordée)
 */
export const PROFIL_BIMODAL_VE: number[] = [
  0.05, // 00h
  0.05, // 01h
  0.05, // 02h
  0.05, // 03h
  0.05, // 04h
  0.05, // 05h
  0.10, // 06h
  0.20, // 07h
  0.45, // 08h  ← montée pic jour (public)
  0.55, // 09h
  0.60, // 10h
  0.55, // 11h
  0.45, // 12h
  0.40, // 13h
  0.35, // 14h
  0.30, // 15h
  0.35, // 16h
  0.50, // 17h  ← montée pic soir
  0.65, // 18h
  0.80, // 19h  ← pic nuit/domicile
  0.85, // 20h
  0.75, // 21h
  0.55, // 22h
  0.30, // 23h
];

export interface BorneVEConfig {
  puissanceParBorne_kVA: number; // 11 ou 22
  nombreBornes: number;          // 1 à 4
  cosPhi: number;                // défaut 0.95
  profil24h?: number[];          // override du profil bimodal
}

export const DEFAULT_BORNE_VE_CONFIG: BorneVEConfig = {
  puissanceParBorne_kVA: 11,
  nombreBornes: 1,
  cosPhi: 0.95,
};

export const BORNE_POWER_OPTIONS = [11, 22] as const;
export const BORNE_COUNT_MAX = 4;
