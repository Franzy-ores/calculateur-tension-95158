/**
 * Exporteur CSV - Données d'Analyse Réseau 24h
 * 
 * Génère des fichiers CSV compatibles Excel avec encodage UTF-8 BOM
 * pour l'export des résultats d'analyse de tension.
 */

import type { HourlyVoltageResult } from '@/types/dailyProfile';
import type { CalculationResult } from '@/types/network';

/**
 * Options d'export CSV
 */
export interface CSVExportOptions {
  /** Inclure l'en-tête de colonne */
  includeHeader?: boolean;
  /** Séparateur de colonnes (défaut: point-virgule pour Excel FR) */
  delimiter?: string;
  /** Séparateur décimal (défaut: virgule pour Excel FR) */
  decimalSeparator?: string;
  /** Inclure les métadonnées (date, projet, etc.) */
  includeMetadata?: boolean;
  /** Nom du projet */
  projectName?: string;
}

/**
 * Formate un nombre avec le séparateur décimal spécifié
 */
function formatNumber(value: number, decimalSeparator: string = ','): string {
  return value.toFixed(2).replace('.', decimalSeparator);
}

/**
 * Échappe une valeur pour CSV (gère les guillemets et délimiteurs)
 */
function escapeCSVValue(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Génère un CSV complet avec données de tension et puissance
 * 
 * @param voltageData - Résultats de tension horaires
 * @param rawData - Résultats bruts de calcul (optionnel, pour puissance/courant)
 * @param options - Options d'export
 * @returns Contenu CSV prêt pour téléchargement
 */
export function generateCSV(
  voltageData: HourlyVoltageResult[],
  rawData?: CalculationResult[],
  options: CSVExportOptions = {}
): string {
  const {
    includeHeader = true,
    delimiter = ';',
    decimalSeparator = ',',
    includeMetadata = true,
    projectName = 'Analyse Réseau',
  } = options;

  const lines: string[] = [];

  // UTF-8 BOM pour Excel
  const BOM = '\uFEFF';

  // Métadonnées
  if (includeMetadata) {
    lines.push(`Projet${delimiter}${escapeCSVValue(projectName, delimiter)}`);
    lines.push(`Date d'export${delimiter}${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}`);
    lines.push(`Période${delimiter}24 heures (0h-23h)`);
    lines.push(''); // Ligne vide
  }

  // En-tête
  if (includeHeader) {
    const headers = [
      'Heure',
      'Tension (V)',
      'Déviation (%)',
      'État',
    ];

    if (rawData && rawData.length > 0) {
      headers.push(
        'Puissance (kW)',
        'Courant (A)',
        'Cos φ',
        'Chute tension (V)',
        'Chute tension (%)'
      );
    }

    lines.push(headers.join(delimiter));
  }

  // Données horaires
  for (let hour = 0; hour < voltageData.length; hour++) {
    const voltageHour = voltageData[hour];
    if (!voltageHour) continue;

    const voltage = voltageHour.voltage;
    const deviation = ((voltage - 230) / 230) * 100;
    
    // Déterminer l'état
    let status = 'OK';
    if (Math.abs(deviation) >= 10) {
      status = 'CRITIQUE';
    } else if (Math.abs(deviation) >= 5) {
      status = 'AVERTISSEMENT';
    }

    const row = [
      `${hour}h`,
      formatNumber(voltage, decimalSeparator),
      formatNumber(deviation, decimalSeparator),
      status,
    ];

    // Ajouter données de puissance si disponibles
    if (rawData && rawData[hour]) {
      const raw = rawData[hour];
      const voltageDrop = 230 - voltage;
      const voltageDropPercent = (voltageDrop / 230) * 100;

      row.push(
        formatNumber(raw.totalPower_kW || 0, decimalSeparator),
        formatNumber(raw.totalCurrent_A || 0, decimalSeparator),
        formatNumber(raw.averageCosPhi || 0, decimalSeparator),
        formatNumber(voltageDrop, decimalSeparator),
        formatNumber(voltageDropPercent, decimalSeparator)
      );
    }

    lines.push(row.join(delimiter));
  }

  // Statistiques résumées
  if (includeMetadata) {
    lines.push(''); // Ligne vide
    lines.push('STATISTIQUES');
    
    const voltages = voltageData.map(v => v.voltage).filter(v => !isNaN(v));
    const minVoltage = Math.min(...voltages);
    const maxVoltage = Math.max(...voltages);
    const avgVoltage = voltages.reduce((a, b) => a + b, 0) / voltages.length;

    const violations5 = voltageData.filter(v => {
      const dev = Math.abs((v.voltage - 230) / 230 * 100);
      return dev >= 5 && dev < 10;
    }).length;

    const violations10 = voltageData.filter(v => {
      const dev = Math.abs((v.voltage - 230) / 230 * 100);
      return dev >= 10;
    }).length;

    lines.push(`Tension minimale${delimiter}${formatNumber(minVoltage, decimalSeparator)} V`);
    lines.push(`Tension maximale${delimiter}${formatNumber(maxVoltage, decimalSeparator)} V`);
    lines.push(`Tension moyenne${delimiter}${formatNumber(avgVoltage, decimalSeparator)} V`);
    lines.push(`Violations ±5%${delimiter}${violations5}`);
    lines.push(`Violations ±10%${delimiter}${violations10}`);
  }

  return BOM + lines.join('\n');
}

/**
 * Génère un CSV détaillé avec données par phase
 * 
 * @param voltageData - Résultats de tension horaires
 * @param options - Options d'export
 * @returns Contenu CSV avec détails par phase
 */
export function generateDetailedCSV(
  voltageData: HourlyVoltageResult[],
  options: CSVExportOptions = {}
): string {
  const {
    includeHeader = true,
    delimiter = ';',
    decimalSeparator = ',',
    includeMetadata = true,
    projectName = 'Analyse Réseau Détaillée',
  } = options;

  const lines: string[] = [];
  const BOM = '\uFEFF';

  // Métadonnées
  if (includeMetadata) {
    lines.push(`Projet${delimiter}${escapeCSVValue(projectName, delimiter)}`);
    lines.push(`Date d'export${delimiter}${new Date().toLocaleDateString('fr-FR')}`);
    lines.push('');
  }

  // En-tête détaillé
  if (includeHeader) {
    lines.push([
      'Heure',
      'Tension Moy (V)',
      'Phase A (V)',
      'Phase B (V)',
      'Phase C (V)',
      'Courant A (A)',
      'Courant B (A)',
      'Courant C (A)',
      'Neutre (A)',
      'Déséquilibre (%)',
      'État',
    ].join(delimiter));
  }

  // Données horaires détaillées
  for (let hour = 0; hour < voltageData.length; hour++) {
    const hourData = voltageData[hour];
    if (!hourData) continue;

    const metrics = hourData.nodeMetrics;
    if (!metrics) {
      // Données simplifiées si pas de détails par phase
      lines.push([
        `${hour}h`,
        formatNumber(hourData.voltage, decimalSeparator),
        '-', '-', '-', '-', '-', '-', '-', '-',
        hourData.voltage >= 218.5 && hourData.voltage <= 241.5 ? 'OK' : 'HORS NORME',
      ].join(delimiter));
      continue;
    }

    const voltageA = metrics.A?.voltage || 0;
    const voltageB = metrics.B?.voltage || 0;
    const voltageC = metrics.C?.voltage || 0;
    const avgVoltage = (voltageA + voltageB + voltageC) / 3;

    const currentA = metrics.A?.current || 0;
    const currentB = metrics.B?.current || 0;
    const currentC = metrics.C?.current || 0;
    const neutral = hourData.neutralCurrent || 0;

    // Calcul déséquilibre
    const maxCurrent = Math.max(currentA, currentB, currentC);
    const minCurrent = Math.min(currentA, currentB, currentC);
    const imbalance = maxCurrent > 0 ? ((maxCurrent - minCurrent) / maxCurrent * 100) : 0;

    // État global
    let status = 'OK';
    const voltages = [voltageA, voltageB, voltageC];
    const outOfRange = voltages.some(v => v < 218.5 || v > 241.5);
    if (outOfRange) status = 'HORS NORME';
    if (imbalance > 30) status = status === 'HORS NORME' ? 'CRITIQUE' : 'DÉSÉQUILIBRE';

    lines.push([
      `${hour}h`,
      formatNumber(avgVoltage, decimalSeparator),
      formatNumber(voltageA, decimalSeparator),
      formatNumber(voltageB, decimalSeparator),
      formatNumber(voltageC, decimalSeparator),
      formatNumber(currentA, decimalSeparator),
      formatNumber(currentB, decimalSeparator),
      formatNumber(currentC, decimalSeparator),
      formatNumber(neutral, decimalSeparator),
      formatNumber(imbalance, decimalSeparator),
      status,
    ].join(delimiter));
  }

  return BOM + lines.join('\n');
}

/**
 * Télécharge un fichier CSV dans le navigateur
 * 
 * @param content - Contenu CSV
 * @param filename - Nom du fichier (défaut: analyse-reseau-YYYYMMDD.csv)
 */
export function downloadCSV(content: string, filename?: string): void {
  const defaultFilename = `analyse-reseau-${new Date().toISOString().split('T')[0]}.csv`;
  const finalFilename = filename || defaultFilename;

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = finalFilename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Libérer la mémoire
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Génère et télécharge directement un CSV
 * 
 * @param voltageData - Résultats de tension
 * @param rawData - Données brutes optionnelles
 * @param options - Options d'export et nom de fichier
 */
export function exportToCSV(
  voltageData: HourlyVoltageResult[],
  rawData?: CalculationResult[],
  options: CSVExportOptions & { filename?: string } = {}
): void {
  const { filename, ...csvOptions } = options;
  const content = generateCSV(voltageData, rawData, csvOptions);
  downloadCSV(content, filename);
}

/**
 * Génère et télécharge un CSV détaillé
 */
export function exportDetailedToCSV(
  voltageData: HourlyVoltageResult[],
  options: CSVExportOptions & { filename?: string } = {}
): void {
  const { filename, ...csvOptions } = options;
  const content = generateDetailedCSV(voltageData, csvOptions);
  const defaultFilename = `analyse-reseau-detaillee-${new Date().toISOString().split('T')[0]}.csv`;
  downloadCSV(content, filename || defaultFilename);
}

/**
 * Génère un CSV comparatif entre deux scénarios
 */
export function generateComparisonCSV(
  scenario1: { name: string; data: HourlyVoltageResult[] },
  scenario2: { name: string; data: HourlyVoltageResult[] },
  options: CSVExportOptions = {}
): string {
  const {
    delimiter = ';',
    decimalSeparator = ',',
    includeMetadata = true,
  } = options;

  const lines: string[] = [];
  const BOM = '\uFEFF';

  if (includeMetadata) {
    lines.push(`Comparaison de Scénarios`);
    lines.push(`Date${delimiter}${new Date().toLocaleDateString('fr-FR')}`);
    lines.push(`Scénario 1${delimiter}${scenario1.name}`);
    lines.push(`Scénario 2${delimiter}${scenario2.name}`);
    lines.push('');
  }

  // En-tête
  lines.push([
    'Heure',
    `${scenario1.name} (V)`,
    `${scenario2.name} (V)`,
    'Différence (V)',
    'Différence (%)',
    'Amélioration',
  ].join(delimiter));

  // Comparaison heure par heure
  const maxHours = Math.min(scenario1.data.length, scenario2.data.length);
  for (let hour = 0; hour < maxHours; hour++) {
    const v1 = scenario1.data[hour]?.voltage || 0;
    const v2 = scenario2.data[hour]?.voltage || 0;
    const diff = v2 - v1;
    const diffPercent = v1 > 0 ? (diff / v1 * 100) : 0;

    // Amélioration si le scénario 2 est plus proche de 230V
    const dev1 = Math.abs(v1 - 230);
    const dev2 = Math.abs(v2 - 230);
    const improvement = dev2 < dev1 ? 'OUI' : dev2 > dev1 ? 'NON' : '=';

    lines.push([
      `${hour}h`,
      formatNumber(v1, decimalSeparator),
      formatNumber(v2, decimalSeparator),
      formatNumber(diff, decimalSeparator),
      formatNumber(diffPercent, decimalSeparator),
      improvement,
    ].join(delimiter));
  }

  return BOM + lines.join('\n');
}
