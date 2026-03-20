/**
 * Détecteur de Points Critiques - Analyse Réseau 24h
 * 
 * Analyse les résultats de tension horaires et détecte les violations
 * des seuils ±5% et ±10% par rapport à la tension nominale (230V).
 */

import type { HourlyVoltageResult } from '@/types/dailyProfile';

/**
 * Point critique détecté dans l'analyse
 */
export interface CriticalPoint {
  /** Heure de la violation (0-23) */
  hour: number;
  /** Tension mesurée en Volts */
  voltage: number;
  /** Déviation en pourcentage par rapport à la nominale */
  deviation: number;
  /** Sévérité de la violation */
  severity: 'warning' | 'critical';
  /** ID du nœud concerné */
  nodeId: string;
  /** Nom du nœud concerné */
  nodeName: string;
  /** Phase concernée (si applicable) */
  phase?: 'A' | 'B' | 'C';
}

/**
 * Résumé de l'analyse des points critiques
 */
export interface CriticalPointsAnalysis {
  /** Violations ±5% (warnings) */
  violations5Percent: CriticalPoint[];
  /** Violations ±10% (critical) */
  violations10Percent: CriticalPoint[];
  /** Liste des heures contenant au moins une violation */
  criticalHours: number[];
  /** Heure avec la pire violation */
  worstHour: number;
  /** Tension la plus éloignée de la nominale */
  worstVoltage: number;
  /** Déviation maximale en % */
  worstDeviation: number;
  /** Résumé statistique */
  summary: {
    /** Nombre total de violations */
    totalViolations: number;
    /** Nombre de warnings (±5%) */
    warningCount: number;
    /** Nombre de violations critiques (±10%) */
    criticalCount: number;
  };
}

/**
 * Calcule la déviation en pourcentage par rapport à la nominale
 */
function calculateDeviation(voltage: number, nominal: number): number {
  return ((voltage - nominal) / nominal) * 100;
}

/**
 * Détermine la sévérité d'une déviation
 */
function getSeverity(deviation: number): 'ok' | 'warning' | 'critical' {
  const absDeviation = Math.abs(deviation);
  if (absDeviation >= 10) return 'critical';
  if (absDeviation >= 5) return 'warning';
  return 'ok';
}

/**
 * Détecte les points critiques dans les résultats horaires
 * 
 * @param hourlyResults - Résultats de tension pour chaque heure (0-23)
 * @param nominalVoltage - Tension nominale de référence (défaut: 230V)
 * @returns Analyse complète des points critiques
 */
export function detectCriticalPoints(
  hourlyResults: HourlyVoltageResult[],
  nominalVoltage: number = 230
): CriticalPointsAnalysis {
  const violations5Percent: CriticalPoint[] = [];
  const violations10Percent: CriticalPoint[] = [];
  const criticalHoursSet = new Set<number>();
  
  let worstHour = 0;
  let worstVoltage = nominalVoltage;
  let worstDeviation = 0;

  // Analyser chaque heure
  for (let hour = 0; hour < hourlyResults.length; hour++) {
    const hourData = hourlyResults[hour];
    
    if (!hourData) continue;

    // Tension principale (moyenne ou sélectionnée)
    const mainVoltage = hourData.voltage;
    const mainDeviation = calculateDeviation(mainVoltage, nominalVoltage);
    const mainSeverity = getSeverity(mainDeviation);

    // Vérifier si c'est la pire déviation
    if (Math.abs(mainDeviation) > Math.abs(worstDeviation)) {
      worstDeviation = mainDeviation;
      worstVoltage = mainVoltage;
      worstHour = hour;
    }

    // Créer le point critique principal si nécessaire
    if (mainSeverity !== 'ok') {
      const criticalPoint: CriticalPoint = {
        hour,
        voltage: mainVoltage,
        deviation: mainDeviation,
        severity: mainSeverity,
        nodeId: hourData.nodeId || 'unknown',
        nodeName: hourData.nodeName || 'Nœud sélectionné',
      };

      if (mainSeverity === 'critical') {
        violations10Percent.push(criticalPoint);
      } else {
        violations5Percent.push(criticalPoint);
      }

      criticalHoursSet.add(hour);
    }

    // Analyser les métriques par phase si disponibles
    if (hourData.nodeMetrics) {
      const phases: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
      
      for (const phase of phases) {
        const phaseMetrics = hourData.nodeMetrics[phase];
        if (!phaseMetrics) continue;

        const phaseVoltage = phaseMetrics.voltage;
        const phaseDeviation = calculateDeviation(phaseVoltage, nominalVoltage);
        const phaseSeverity = getSeverity(phaseDeviation);

        // Vérifier si c'est la pire déviation
        if (Math.abs(phaseDeviation) > Math.abs(worstDeviation)) {
          worstDeviation = phaseDeviation;
          worstVoltage = phaseVoltage;
          worstHour = hour;
        }

        if (phaseSeverity !== 'ok') {
          const criticalPoint: CriticalPoint = {
            hour,
            voltage: phaseVoltage,
            deviation: phaseDeviation,
            severity: phaseSeverity,
            nodeId: hourData.nodeId || 'unknown',
            nodeName: `${hourData.nodeName || 'Nœud'} - Phase ${phase}`,
            phase,
          };

          if (phaseSeverity === 'critical') {
            violations10Percent.push(criticalPoint);
          } else {
            violations5Percent.push(criticalPoint);
          }

          criticalHoursSet.add(hour);
        }
      }
    }
  }

  // Convertir le Set en array trié
  const criticalHours = Array.from(criticalHoursSet).sort((a, b) => a - b);

  // Calculer le résumé
  const summary = {
    totalViolations: violations5Percent.length + violations10Percent.length,
    warningCount: violations5Percent.length,
    criticalCount: violations10Percent.length,
  };

  return {
    violations5Percent,
    violations10Percent,
    criticalHours,
    worstHour,
    worstVoltage,
    worstDeviation,
    summary,
  };
}

/**
 * Obtient une description textuelle d'une violation
 */
export function getCriticalPointDescription(point: CriticalPoint): string {
  const direction = point.deviation > 0 ? 'surtension' : 'sous-tension';
  const deviationAbs = Math.abs(point.deviation).toFixed(1);
  
  return `${point.nodeName} à ${point.hour}h : ${direction} de ${deviationAbs}% (${point.voltage.toFixed(1)}V)`;
}

/**
 * Obtient des recommandations basées sur l'analyse
 */
export function getRecommendations(analysis: CriticalPointsAnalysis): string[] {
  const recommendations: string[] = [];

  if (analysis.summary.criticalCount > 0) {
    recommendations.push(
      `⛔ ${analysis.summary.criticalCount} violation(s) critique(s) détectée(s) (±10%). Action immédiate requise.`
    );
  }

  if (analysis.summary.warningCount > 0) {
    recommendations.push(
      `⚠️ ${analysis.summary.warningCount} avertissement(s) détecté(s) (±5%). Surveillance recommandée.`
    );
  }

  if (analysis.criticalHours.length > 0) {
    const peakHours = analysis.criticalHours.filter(h => h >= 17 && h <= 21);
    if (peakHours.length > 0) {
      recommendations.push(
        `🕐 Violations concentrées en heures de pointe (${peakHours.join('h, ')}h). Envisager un régulateur SRG2 ou un renforcement.`
      );
    }
  }

  if (Math.abs(analysis.worstDeviation) >= 10) {
    recommendations.push(
      `⚡ Pire violation à ${analysis.worstHour}h avec ${Math.abs(analysis.worstDeviation).toFixed(1)}% de déviation. Analyser la charge à cette heure.`
    );
  }

  if (analysis.summary.totalViolations === 0) {
    recommendations.push(
      `✅ Aucune violation détectée. Le réseau fonctionne dans les normes sur 24h.`
    );
  }

  return recommendations;
}

/**
 * Groupe les violations par heure pour affichage condensé
 */
export function groupViolationsByHour(
  violations: CriticalPoint[]
): Map<number, CriticalPoint[]> {
  const grouped = new Map<number, CriticalPoint[]>();

  for (const violation of violations) {
    if (!grouped.has(violation.hour)) {
      grouped.set(violation.hour, []);
    }
    grouped.get(violation.hour)!.push(violation);
  }

  return grouped;
}

/**
 * Calcule des statistiques de tension pour une période
 */
export function calculateVoltageStatistics(
  hourlyResults: HourlyVoltageResult[],
  nominalVoltage: number = 230
) {
  if (hourlyResults.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      minHour: 0,
      maxHour: 0,
      avgDeviation: 0,
    };
  }

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let minHour = 0;
  let maxHour = 0;
  let deviationSum = 0;

  for (let hour = 0; hour < hourlyResults.length; hour++) {
    const voltage = hourlyResults[hour]?.voltage || nominalVoltage;
    
    if (voltage < min) {
      min = voltage;
      minHour = hour;
    }
    if (voltage > max) {
      max = voltage;
      maxHour = hour;
    }
    
    sum += voltage;
    deviationSum += Math.abs(calculateDeviation(voltage, nominalVoltage));
  }

  return {
    min,
    max,
    avg: sum / hourlyResults.length,
    minHour,
    maxHour,
    avgDeviation: deviationSum / hourlyResults.length,
  };
}
