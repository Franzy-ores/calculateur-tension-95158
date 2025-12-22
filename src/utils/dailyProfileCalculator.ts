import { DailyProfileConfig, DailySimulationOptions, HourlyVoltageResult } from '@/types/dailyProfile';
import { Project, Node, CalculationResult } from '@/types/network';
import { ElectricalCalculator } from './electricalCalculations';
import defaultProfiles from '@/data/hourlyProfiles.json';

/**
 * Service de calcul des tensions horaires sur 24h
 * Utilise le moteur de calcul électrique existant avec modulation temporelle
 */
export class DailyProfileCalculator {
  private profiles: DailyProfileConfig;
  private project: Project;
  private options: DailySimulationOptions;

  constructor(project: Project, options: DailySimulationOptions, customProfiles?: DailyProfileConfig) {
    this.project = project;
    this.options = options;
    this.profiles = customProfiles || (defaultProfiles as DailyProfileConfig);
  }

  /**
   * Calcule les tensions pour chaque heure (0-23)
   */
  calculateDailyVoltages(): HourlyVoltageResult[] {
    const results: HourlyVoltageResult[] = [];
    // Toujours 230V car on calcule en phase-neutre (seuils ±5% et ±10% basés sur 230V)
    const nominalVoltage = 230;

    for (let hour = 0; hour < 24; hour++) {
      const hourlyResult = this.calculateHourlyVoltage(hour, nominalVoltage);
      results.push(hourlyResult);
    }

    return results;
  }

  /**
   * Calcule la tension à une heure donnée
   * Utilise le foisonnement horaire du JSON directement dans le calcul électrique
   */
  private calculateHourlyVoltage(hour: number, nominalVoltage: number): HourlyVoltageResult {
    const seasonProfile = this.profiles.profiles[this.options.season];
    const weatherFactor = this.profiles.weatherFactors[this.options.weather];
    const hourStr = hour.toString();

    // Foisonnement charges = profil résidentiel horaire du JSON
    let chargesFoisonnement = seasonProfile.residential[hourStr] || 0;

    // Majoration VE : +5% entre 18h et 5h si activé
    if (this.options.enableEV && (hour >= 18 || hour <= 5)) {
      chargesFoisonnement += 5;
    }

    // Foisonnement productions = profil PV × facteur météo
    const productionsFoisonnement = (seasonProfile.pv[hourStr] || 0) * weatherFactor;

    // Exécuter le calcul électrique avec le projet ORIGINAL et le foisonnement horaire
    const calculator = new ElectricalCalculator(
      this.project.cosPhi,
      this.project.cosPhiCharges,
      this.project.cosPhiProductions
    );

    try {
      const result = calculator.calculateScenarioWithHTConfig(
        this.project,              // Projet ORIGINAL (pas modulé)
        'MIXTE',
        chargesFoisonnement,       // Foisonnement horaire du JSON
        productionsFoisonnement,   // Production PV horaire avec météo
        this.project.manualPhaseDistribution,  // Déséquilibre conservé
        this.project.clientsImportes,
        this.project.clientLinks
      );
      return this.extractNodeVoltages(hour, result, nominalVoltage);
    } catch (error) {
      console.warn(`Erreur calcul heure ${hour}:`, error);
      return this.createDefaultHourlyResult(hour, nominalVoltage);
    }
  }

  /**
   * Extrait les tensions du nœud sélectionné depuis les résultats de calcul
   */
  private extractNodeVoltages(hour: number, result: CalculationResult, nominalVoltage: number): HourlyVoltageResult {
    const nodeId = this.options.selectedNodeId;
    // Correction: nodeMetricsPerPhase est un tableau, pas un objet indexé par nodeId
    const nodeMetrics = result.nodeMetricsPerPhase?.find(n => n.nodeId === nodeId);

    if (!nodeMetrics?.voltagesPerPhase) {
      console.warn(`Heure ${hour}: Pas de métriques pour le nœud ${nodeId}`);
      return this.createDefaultHourlyResult(hour, nominalVoltage);
    }

    const { A, B, C } = nodeMetrics.voltagesPerPhase;
    const voltageA = A || nominalVoltage;
    const voltageB = B || nominalVoltage;
    const voltageC = C || nominalVoltage;

    // Log de vérification des tensions phase-neutre
    console.log(`📊 Profil 24h - Heure ${hour}: VA=${voltageA.toFixed(1)}V, VB=${voltageB.toFixed(1)}V, VC=${voltageC.toFixed(1)}V (nominale: ${nominalVoltage}V)`);


    const voltageAvg = (voltageA + voltageB + voltageC) / 3;
    const voltageMin = Math.min(voltageA, voltageB, voltageC);
    const voltageMax = Math.max(voltageA, voltageB, voltageC);

    // Calculer l'écart max par rapport à la nominale
    const deviationA = ((voltageA - nominalVoltage) / nominalVoltage) * 100;
    const deviationB = ((voltageB - nominalVoltage) / nominalVoltage) * 100;
    const deviationC = ((voltageC - nominalVoltage) / nominalVoltage) * 100;
    const maxDeviation = Math.max(Math.abs(deviationA), Math.abs(deviationB), Math.abs(deviationC));
    const deviationPercent = deviationA > 0 || deviationB > 0 || deviationC > 0 
      ? maxDeviation 
      : -maxDeviation;

    // Déterminer le statut
    let status: 'normal' | 'warning' | 'critical' = 'normal';
    if (maxDeviation > 10) status = 'critical';
    else if (maxDeviation > 5) status = 'warning';

    return {
      hour,
      voltageA_V: voltageA,
      voltageB_V: voltageB,
      voltageC_V: voltageC,
      voltageAvg_V: voltageAvg,
      voltageMin_V: voltageMin,
      voltageMax_V: voltageMax,
      deviationPercent,
      status
    };
  }

  /**
   * Crée un résultat par défaut (tensions nominales)
   */
  private createDefaultHourlyResult(hour: number, nominalVoltage: number): HourlyVoltageResult {
    return {
      hour,
      voltageA_V: nominalVoltage,
      voltageB_V: nominalVoltage,
      voltageC_V: nominalVoltage,
      voltageAvg_V: nominalVoltage,
      voltageMin_V: nominalVoltage,
      voltageMax_V: nominalVoltage,
      deviationPercent: 0,
      status: 'normal'
    };
  }

  /**
   * Identifie les heures critiques
   */
  static findCriticalHours(results: HourlyVoltageResult[]): HourlyVoltageResult[] {
    return results.filter(r => r.status === 'warning' || r.status === 'critical')
      .sort((a, b) => Math.abs(b.deviationPercent) - Math.abs(a.deviationPercent));
  }
}
