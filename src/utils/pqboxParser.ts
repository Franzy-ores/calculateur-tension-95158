/**
 * Utilitaire de parsing de fichiers de mesures PQ-Box
 * Extrait les données de puissance apparente (S en VA) et les convertit
 * en profil 24h en pourcentage de la puissance contractuelle
 */

import { HourlyProfile } from '@/types/dailyProfile';

export interface PQBoxRawData {
  date: Date;
  hour: number;
  value_VA: number;
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

export interface PQBoxParseResult {
  success: boolean;
  rawData: PQBoxRawData[];
  errors: string[];
  measurePeriod?: string;
  dataPoints: number;
}

export interface HourlyProfileResult {
  profile: HourlyProfile;
  metadata: MeasuredProfileMetadata;
  hourlyAverages: { hour: number; avg_VA: number; avg_kVA: number; percent: number }[];
}

/**
 * Parse un fichier PQ-Box et extrait les mesures brutes
 */
export function parsePQBoxFile(content: string, fileName: string): PQBoxParseResult {
  const errors: string[] = [];
  const rawData: PQBoxRawData[] = [];
  
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length < 12) {
    return { success: false, rawData: [], errors: ['Fichier trop court'], dataPoints: 0 };
  }

  // Extraire la période de mesure depuis l'entête (ligne 9)
  let measurePeriod = '';
  const periodLine = lines.find(l => l.startsWith('Date/Heure:'));
  if (periodLine) {
    const match = periodLine.match(/Date\/Heure:(.+)/);
    if (match) {
      measurePeriod = match[1].trim();
    }
  }

  // Trouver la ligne d'entête des données (contient "Date Heure")
  let dataStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Date') && lines[i].includes('Heure') && lines[i].includes('[VA]')) {
      dataStartIndex = i + 1;
      break;
    }
  }

  if (dataStartIndex === -1) {
    return { success: false, rawData: [], errors: ['Entête de données non trouvée'], dataPoints: 0 };
  }

  // Parser les lignes de données
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    try {
      // Format: DD.MM.YYYY HH:MM:SS.sss valeur
      // Les espaces multiples peuvent séparer les colonnes
      const parts = line.split(/\s+/);
      
      if (parts.length < 3) continue;

      const dateStr = parts[0]; // DD.MM.YYYY
      const timeStr = parts[1]; // HH:MM:SS.sss
      const valueStr = parts[2]; // valeur avec virgule française

      // Parser la date
      const dateParts = dateStr.split('.');
      if (dateParts.length !== 3) continue;
      
      const day = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1; // 0-indexed
      const year = parseInt(dateParts[2], 10);

      // Parser l'heure
      const timeParts = timeStr.split(':');
      if (timeParts.length < 2) continue;
      
      const hour = parseInt(timeParts[0], 10);
      const minute = parseInt(timeParts[1], 10);

      // Parser la valeur (virgule française → point)
      const value_VA = parseFloat(valueStr.replace(',', '.'));
      
      if (isNaN(value_VA)) continue;

      const date = new Date(year, month, day, hour, minute);
      
      rawData.push({
        date,
        hour,
        value_VA
      });
    } catch (e) {
      errors.push(`Erreur ligne ${i + 1}: ${(e as Error).message}`);
    }
  }

  if (rawData.length === 0) {
    return { success: false, rawData: [], errors: ['Aucune donnée valide extraite'], dataPoints: 0 };
  }

  return {
    success: true,
    rawData,
    errors,
    measurePeriod,
    dataPoints: rawData.length
  };
}

/**
 * Calcule le profil horaire en pourcentage de la puissance contractuelle
 */
export function calculateHourlyProfile(
  rawData: PQBoxRawData[],
  contractualPower_kVA: number,
  profileName: string,
  fileName: string,
  measurePeriod: string
): HourlyProfileResult {
  const contractualPower_VA = contractualPower_kVA * 1000;

  // Grouper les mesures par heure
  const hourlyGroups: Map<number, number[]> = new Map();
  
  for (let h = 0; h < 24; h++) {
    hourlyGroups.set(h, []);
  }

  rawData.forEach(data => {
    const values = hourlyGroups.get(data.hour) || [];
    values.push(data.value_VA);
    hourlyGroups.set(data.hour, values);
  });

  // Calculer les moyennes par heure
  const hourlyAverages: { hour: number; avg_VA: number; avg_kVA: number; percent: number }[] = [];
  const profile: HourlyProfile = {};
  
  let maxMeasured_VA = 0;
  let totalMeasured_VA = 0;
  let totalPoints = 0;

  for (let hour = 0; hour < 24; hour++) {
    const values = hourlyGroups.get(hour) || [];
    
    let avg_VA = 0;
    if (values.length > 0) {
      avg_VA = values.reduce((sum, v) => sum + v, 0) / values.length;
      totalMeasured_VA += avg_VA;
      totalPoints++;
    }

    if (avg_VA > maxMeasured_VA) {
      maxMeasured_VA = avg_VA;
    }

    const avg_kVA = avg_VA / 1000;
    const percent = (avg_VA / contractualPower_VA) * 100;

    hourlyAverages.push({ hour, avg_VA, avg_kVA, percent });
    profile[hour.toString()] = Math.round(percent * 100) / 100; // Arrondi à 2 décimales
  }

  const avgMeasured_VA = totalPoints > 0 ? totalMeasured_VA / totalPoints : 0;
  const peakUsagePercent = (maxMeasured_VA / contractualPower_VA) * 100;

  const metadata: MeasuredProfileMetadata = {
    name: profileName,
    sourceFile: fileName,
    importDate: new Date().toISOString(),
    measurePeriod,
    contractualPower_kVA,
    maxMeasured_VA,
    avgMeasured_VA,
    peakUsagePercent: Math.round(peakUsagePercent * 100) / 100,
    dataPoints: rawData.length
  };

  return {
    profile,
    metadata,
    hourlyAverages
  };
}
