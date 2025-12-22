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
   * Calcule les puissances totales d'un nœud depuis ses clients et productions
   */
  private getNodeTotalPowers(node: Node): { charge_kVA: number; production_kVA: number } {
    const charge_kVA = (node.clients || []).reduce((sum, c) => sum + (c.S_kVA || 0), 0);
    const production_kVA = (node.productions || []).reduce((sum, p) => sum + (p.S_kVA || 0), 0);
    return { charge_kVA, production_kVA };
  }

  /**
   * Calcule les tensions pour chaque heure (0-23)
   */
  calculateDailyVoltages(): HourlyVoltageResult[] {
    const results: HourlyVoltageResult[] = [];
    const nominalVoltage = this.project.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;

    for (let hour = 0; hour < 24; hour++) {
      const hourlyResult = this.calculateHourlyVoltage(hour, nominalVoltage);
      results.push(hourlyResult);
    }

    return results;
  }

  /**
   * Calcule la tension à une heure donnée
   */
  private calculateHourlyVoltage(hour: number, nominalVoltage: number): HourlyVoltageResult {
    const seasonProfile = this.profiles.profiles[this.options.season];
    const weatherFactor = this.profiles.weatherFactors[this.options.weather];
    const hourStr = hour.toString();

    // Récupérer les pourcentages horaires
    const residentialPercent = seasonProfile.residential[hourStr] || 0;
    const pvPercent = (seasonProfile.pv[hourStr] || 0) * weatherFactor;
    const evPercent = this.options.enableEV ? (seasonProfile.ev[hourStr] || 0) : 0;
    const industrialPercent = this.options.enableIndustrialPME ? (seasonProfile.industrial_pme[hourStr] || 0) : 0;

    // Créer une copie du projet avec les puissances modulées
    const modulatedProject = this.createModulatedProject(
      residentialPercent,
      pvPercent,
      evPercent,
      industrialPercent
    );

    // Exécuter le calcul électrique
    const calculator = new ElectricalCalculator(
      this.project.cosPhi,
      this.project.cosPhiCharges,
      this.project.cosPhiProductions
    );

    try {
      const result = calculator.calculateScenarioWithHTConfig(
        modulatedProject,
        'MIXTE',
        this.project.foisonnementCharges ?? 100,
        this.project.foisonnementProductions ?? 100,
        this.project.manualPhaseDistribution,
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
   * Crée une copie du projet avec les puissances modulées selon les profils horaires
   */
  private createModulatedProject(
    residentialPercent: number,
    pvPercent: number,
    evPercent: number,
    industrialPercent: number
  ): Project {
    const modulatedNodes = this.project.nodes.map(node => {
      const { charge_kVA, production_kVA } = this.getNodeTotalPowers(node);
      
      // Déterminer si le nœud est industriel (charge > 20 kVA)
      const isIndustrial = charge_kVA > 20;
      const chargeFactor = isIndustrial ? (industrialPercent / 100) : (residentialPercent / 100);
      
      // Ajouter la charge VE si activée
      const evCharge = evPercent > 0 ? this.profiles.evPower_kVA * (evPercent / 100) : 0;

      // Moduler les clients (charges)
      const modulatedClients = (node.clients || []).map(client => ({
        ...client,
        S_kVA: (client.S_kVA || 0) * chargeFactor + (evCharge / Math.max(1, (node.clients || []).length))
      }));

      // Moduler les productions PV
      const modulatedProductions = (node.productions || []).map(prod => ({
        ...prod,
        S_kVA: (prod.S_kVA || 0) * (pvPercent / 100)
      }));

      return {
        ...node,
        clients: modulatedClients,
        productions: modulatedProductions
      };
    });

    return {
      ...this.project,
      nodes: modulatedNodes
    };
  }

  /**
   * Extrait les tensions du nœud sélectionné depuis les résultats de calcul
   */
  private extractNodeVoltages(hour: number, result: CalculationResult, nominalVoltage: number): HourlyVoltageResult {
    const nodeId = this.options.selectedNodeId;
    const nodeMetrics = result.nodeMetricsPerPhase?.[nodeId];

    if (!nodeMetrics?.voltagesPerPhase) {
      return this.createDefaultHourlyResult(hour, nominalVoltage);
    }

    const { A, B, C } = nodeMetrics.voltagesPerPhase;
    const voltageA = A || nominalVoltage;
    const voltageB = B || nominalVoltage;
    const voltageC = C || nominalVoltage;

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
