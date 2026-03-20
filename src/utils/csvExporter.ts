/**
 * Exporteur CSV - Données d'Analyse Réseau 24h
 * Compatible Excel (UTF-8 BOM, point-virgule).
 */

import type { HourlyVoltageResult } from '@/types/dailyProfile';
import type { CalculationResult } from '@/types/network';

export interface CSVExportOptions {
  includeHeader?: boolean;
  delimiter?: string;
  decimalSeparator?: string;
  includeMetadata?: boolean;
  projectName?: string;
}

function fmt(value: number, ds: string = ','): string {
  return value.toFixed(2).replace('.', ds);
}

function esc(value: string, d: string): string {
  if (value.includes(d) || value.includes('"') || value.includes('\n')) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function generateCSV(
  voltageData: HourlyVoltageResult[],
  rawData?: CalculationResult[],
  options: CSVExportOptions = {}
): string {
  const { includeHeader = true, delimiter: d = ';', decimalSeparator: ds = ',', includeMetadata = true, projectName = 'Analyse Réseau' } = options;
  const lines: string[] = [];

  if (includeMetadata) {
    lines.push(`Projet${d}${esc(projectName, d)}`);
    lines.push(`Date d'export${d}${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR')}`);
    lines.push(`Période${d}24 heures (0h-23h)`);
    lines.push('');
  }

  if (includeHeader) {
    const headers = ['Heure', 'V moy (V)', 'V_A (V)', 'V_B (V)', 'V_C (V)', 'Déviation (%)', 'État'];
    if (rawData?.length) headers.push('P charges (kVA)', 'P PV (kVA)', 'Chute max (%)');
    lines.push(headers.join(d));
  }

  for (let hour = 0; hour < voltageData.length; hour++) {
    const h = voltageData[hour];
    if (!h) continue;
    const row = [
      `${hour}h`, fmt(h.voltageAvg_V, ds), fmt(h.voltageA_V, ds), fmt(h.voltageB_V, ds), fmt(h.voltageC_V, ds),
      fmt(h.deviationPercent, ds),
      h.status === 'critical' ? 'CRITIQUE' : h.status === 'warning' ? 'AVERTISSEMENT' : 'OK',
    ];
    if (rawData?.[hour]) {
      const raw = rawData[hour];
      row.push(fmt(raw.totalLoads_kVA || 0, ds), fmt(raw.totalProductions_kVA || 0, ds), fmt(raw.maxVoltageDropPercent || 0, ds));
    }
    lines.push(row.join(d));
  }

  if (includeMetadata) {
    lines.push('');
    lines.push('STATISTIQUES');
    const voltages = voltageData.map(v => v.voltageAvg_V).filter(v => !isNaN(v));
    const minV = Math.min(...voltages), maxV = Math.max(...voltages);
    const avgV = voltages.reduce((a, b) => a + b, 0) / voltages.length;
    const v5 = voltageData.filter(v => { const dev = Math.abs(v.deviationPercent); return dev >= 5 && dev < 10; }).length;
    const v10 = voltageData.filter(v => Math.abs(v.deviationPercent) >= 10).length;
    lines.push(`Tension minimale${d}${fmt(minV, ds)} V`);
    lines.push(`Tension maximale${d}${fmt(maxV, ds)} V`);
    lines.push(`Tension moyenne${d}${fmt(avgV, ds)} V`);
    lines.push(`Violations ±5%${d}${v5}`);
    lines.push(`Violations ±10%${d}${v10}`);
  }

  return '\uFEFF' + lines.join('\n');
}

export function downloadCSV(content: string, filename?: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `analyse-reseau-${new Date().toISOString().split('T')[0]}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function exportToCSV(
  voltageData: HourlyVoltageResult[],
  rawData?: CalculationResult[],
  options: CSVExportOptions & { filename?: string } = {}
): void {
  const { filename, ...csvOptions } = options;
  downloadCSV(generateCSV(voltageData, rawData, csvOptions), filename);
}

export function generateComparisonCSV(
  scenario1: { name: string; data: HourlyVoltageResult[] },
  scenario2: { name: string; data: HourlyVoltageResult[] },
  options: CSVExportOptions = {}
): string {
  const { delimiter: d = ';', decimalSeparator: ds = ',', includeMetadata = true } = options;
  const lines: string[] = [];
  if (includeMetadata) {
    lines.push('Comparaison de Scénarios');
    lines.push(`Date${d}${new Date().toLocaleDateString('fr-FR')}`);
    lines.push(`Scénario 1${d}${scenario1.name}`);
    lines.push(`Scénario 2${d}${scenario2.name}`);
    lines.push('');
  }
  lines.push(['Heure', `${scenario1.name} (V)`, `${scenario2.name} (V)`, 'Diff (V)', 'Amélioration'].join(d));
  const max = Math.min(scenario1.data.length, scenario2.data.length);
  for (let h = 0; h < max; h++) {
    const v1 = scenario1.data[h]?.voltageAvg_V || 0;
    const v2 = scenario2.data[h]?.voltageAvg_V || 0;
    const imp = Math.abs(v2 - 230) < Math.abs(v1 - 230) ? 'OUI' : Math.abs(v2 - 230) > Math.abs(v1 - 230) ? 'NON' : '=';
    lines.push([`${h}h`, fmt(v1, ds), fmt(v2, ds), fmt(v2 - v1, ds), imp].join(d));
  }
  return '\uFEFF' + lines.join('\n');
}
