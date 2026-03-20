/**
 * Détecteur de Points Critiques - Analyse Réseau 24h
 */

import type { HourlyVoltageResult } from '@/types/dailyProfile';

export interface CriticalPoint {
  hour: number;
  voltage: number;
  deviation: number;
  severity: 'warning' | 'critical';
  phase?: 'A' | 'B' | 'C';
}

export interface CriticalPointsAnalysis {
  violations5Percent: CriticalPoint[];
  violations10Percent: CriticalPoint[];
  criticalHours: number[];
  worstHour: number;
  worstVoltage: number;
  worstDeviation: number;
  summary: {
    totalViolations: number;
    warningCount: number;
    criticalCount: number;
  };
}

function calculateDeviation(voltage: number, nominal: number): number {
  return ((voltage - nominal) / nominal) * 100;
}

function getSeverity(deviation: number): 'ok' | 'warning' | 'critical' {
  const abs = Math.abs(deviation);
  if (abs >= 10) return 'critical';
  if (abs >= 5) return 'warning';
  return 'ok';
}

export function detectCriticalPoints(
  hourlyResults: HourlyVoltageResult[],
  nominalVoltage: number = 230
): CriticalPointsAnalysis {
  const violations5Percent: CriticalPoint[] = [];
  const violations10Percent: CriticalPoint[] = [];
  const criticalHoursSet = new Set<number>();
  let worstHour = 0, worstVoltage = nominalVoltage, worstDeviation = 0;

  for (let hour = 0; hour < hourlyResults.length; hour++) {
    const h = hourlyResults[hour];
    if (!h) continue;

    const phases: Array<{ voltage: number; phase: 'A' | 'B' | 'C' }> = [
      { voltage: h.voltageA_V, phase: 'A' },
      { voltage: h.voltageB_V, phase: 'B' },
      { voltage: h.voltageC_V, phase: 'C' },
    ];

    for (const { voltage, phase } of phases) {
      if (voltage <= 0) continue;
      const deviation = calculateDeviation(voltage, nominalVoltage);
      const severity = getSeverity(deviation);
      if (Math.abs(deviation) > Math.abs(worstDeviation)) {
        worstDeviation = deviation; worstVoltage = voltage; worstHour = hour;
      }
      if (severity !== 'ok') {
        const point: CriticalPoint = { hour, voltage, deviation, severity, phase };
        if (severity === 'critical') violations10Percent.push(point);
        else violations5Percent.push(point);
        criticalHoursSet.add(hour);
      }
    }
  }

  return {
    violations5Percent,
    violations10Percent,
    criticalHours: Array.from(criticalHoursSet).sort((a, b) => a - b),
    worstHour, worstVoltage, worstDeviation,
    summary: {
      totalViolations: violations5Percent.length + violations10Percent.length,
      warningCount: violations5Percent.length,
      criticalCount: violations10Percent.length,
    },
  };
}

export function getCriticalPointDescription(point: CriticalPoint): string {
  const direction = point.deviation > 0 ? 'surtension' : 'sous-tension';
  const phaseLabel = point.phase ? ` Phase ${point.phase}` : '';
  return `${point.hour}h${phaseLabel} : ${direction} de ${Math.abs(point.deviation).toFixed(1)}% (${point.voltage.toFixed(1)}V)`;
}

export function getRecommendations(analysis: CriticalPointsAnalysis): string[] {
  const r: string[] = [];
  if (analysis.summary.criticalCount > 0) r.push(`⛔ ${analysis.summary.criticalCount} violation(s) critique(s) (±10%).`);
  if (analysis.summary.warningCount > 0) r.push(`⚠️ ${analysis.summary.warningCount} avertissement(s) (±5%).`);
  if (analysis.summary.totalViolations === 0) r.push(`✅ Aucune violation. Réseau conforme sur 24h.`);
  return r;
}

export function calculateVoltageStatistics(hourlyResults: HourlyVoltageResult[], nominalVoltage: number = 230) {
  if (hourlyResults.length === 0) return { min: 0, max: 0, avg: 0, minHour: 0, maxHour: 0, avgDeviation: 0 };
  let min = Infinity, max = -Infinity, sum = 0, minHour = 0, maxHour = 0, devSum = 0;
  for (let h = 0; h < hourlyResults.length; h++) {
    const v = hourlyResults[h]?.voltageAvg_V || nominalVoltage;
    if (v < min) { min = v; minHour = h; }
    if (v > max) { max = v; maxHour = h; }
    sum += v; devSum += Math.abs(calculateDeviation(v, nominalVoltage));
  }
  return { min, max, avg: sum / hourlyResults.length, minHour, maxHour, avgDeviation: devSum / hourlyResults.length };
}
