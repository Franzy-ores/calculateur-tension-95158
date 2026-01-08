import { DailyProfileConfig, DailySimulationOptions, HourlyVoltageResult, HourlyProfile } from '@/types/dailyProfile';
import { Project, Node, CalculationResult, SimulationEquipment } from '@/types/network';
import { ElectricalCalculator } from './electricalCalculations';
import { SimulationCalculator } from './simulationCalculator';
import defaultProfiles from '@/data/hourlyProfiles.json';

/**
 * Service de calcul des tensions horaires sur 24h
 * Utilise le moteur de calcul électrique existant avec modulation temporelle
 * Supporte la simulation active (remplacement de câbles, SRG2, EQUI8)
 */
export class DailyProfileCalculator {
  private profiles: DailyProfileConfig;
  private project: Project;
  private options: DailySimulationOptions;
  private simulationEquipment?: SimulationEquipment;
  private isSimulationActive: boolean;
  private measuredProfile?: HourlyProfile;

  constructor(
    project: Project, 
    options: DailySimulationOptions, 
    customProfiles?: DailyProfileConfig,
    simulationEquipment?: SimulationEquipment,
    isSimulationActive: boolean = false,
    measuredProfile?: HourlyProfile
  ) {
    this.project = project;
    this.options = options;
    this.profiles = customProfiles || (defaultProfiles as DailyProfileConfig);
    this.simulationEquipment = simulationEquipment;
    this.isSimulationActive = isSimulationActive;
    this.measuredProfile = measuredProfile;
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
   * Compte les clients industriels dans le projet
   */
  private countIndustrialClients(): number {
    if (!this.project.clientsImportes) return 0;
    return this.project.clientsImportes.filter(c => c.clientType === 'industriel').length;
  }

  /**
   * Calcule le foisonnement pondéré en fonction du mix résidentiel/industriel
   */
  private calculateWeightedFoisonnement(
    residentialProfile: number,
    industrialProfile: number
  ): { 
    residential: number; 
    industrial: number; 
    weighted: number;
    residentialPower: number;
    industrialPower: number;
  } {
    const clients = this.project.clientsImportes || [];
    const links = this.project.clientLinks || [];
    
    // Calculer les puissances par type de client liés au projet
    let residentialPower = 0;
    let industrialPower = 0;
    
    clients.forEach(client => {
      // Vérifier si le client est lié à un nœud
      const isLinked = links.some(link => link.clientId === client.id);
      
      if (isLinked) {
        const power = client.puissanceContractuelle_kVA || 0;
        if (client.clientType === 'industriel') {
          industrialPower += power;
        } else {
          residentialPower += power;
        }
      }
    });
    
    const totalPower = residentialPower + industrialPower;
    
    if (totalPower === 0) {
      // Pas de clients liés, utiliser uniquement le profil résidentiel
      return { residential: residentialProfile, industrial: 0, weighted: residentialProfile, residentialPower: 0, industrialPower: 0 };
    }
    
    // Pondération par puissance
    const residentialWeight = residentialPower / totalPower;
    const industrialWeight = industrialPower / totalPower;
    
    // Foisonnement pondéré
    const weighted = (residentialProfile * residentialWeight) + (industrialProfile * industrialWeight);
    
    return {
      residential: residentialProfile,
      industrial: industrialProfile,
      weighted,
      residentialPower,
      industrialPower
    };
  }

  /**
   * Calcule la tension à une heure donnée
   * Utilise le foisonnement horaire du JSON directement dans le calcul électrique
   * Applique le profil industriel aux clients industriels automatiquement
   */
  private calculateHourlyVoltage(hour: number, nominalVoltage: number): HourlyVoltageResult {
    const seasonProfile = this.profiles.profiles[this.options.season];
    const weatherFactor = this.profiles.weatherFactors[this.options.weather];
    const hourStr = hour.toString();

    // Si profil mesuré activé, utiliser le profil mesuré pour toutes les charges
    const useMeasured = this.options.useMeasuredProfile && this.measuredProfile;

    // Profils horaires par type (directement depuis le JSON ou profil mesuré)
    const residentialProfile = useMeasured 
      ? (this.measuredProfile![hourStr] || 0)
      : (seasonProfile.residential[hourStr] || 0);
    const industrialProfile = useMeasured 
      ? (this.measuredProfile![hourStr] || 0)
      : (seasonProfile.industrial_pme[hourStr] || 0);
    
    // Récupérer les puissances transitantes (nœud sélectionné + aval)
    const nodePowers = this.getUpstreamAndNodePowers();
    
    // Foisonnement horaire par type de client (pas de pondération !)
    // Majoration VE sur résidentiel uniquement (valeurs personnalisables) :
    // - evBonusEvening de 18h à 21h (début de soirée)
    // - evBonusNight de 22h à 5h (nuit profonde)
    let evBonus = 0;
    if (this.options.enableEV) {
      const bonusEvening = this.options.evBonusEvening ?? 2.5;
      const bonusNight = this.options.evBonusNight ?? 5;
      
      if (hour >= 18 && hour <= 21) {
        evBonus = bonusEvening;
      } else if (hour >= 22 || hour <= 5) {
        evBonus = bonusNight;
      }
    }
    const residentialFoisonnementHoraire = residentialProfile + evBonus;
    const industrialFoisonnementHoraire = industrialProfile;

    // Foisonnement productions = profil PV × facteur météo (ou 0% si zeroProduction activé)
    const productionsFoisonnement = this.options.zeroProduction 
      ? 0 
      : (seasonProfile.pv[hourStr] || 0) * weatherFactor;

    // Créer un projet modifié avec les foisonnements horaires par type de client
    // Cela force electricalCalculations.ts à utiliser ces valeurs horaires
    const projectWithHourlyFoisonnement: Project = {
      ...this.project,
      foisonnementChargesResidentiel: residentialFoisonnementHoraire,
      foisonnementChargesIndustriel: industrialFoisonnementHoraire,
      foisonnementProductions: productionsFoisonnement
    };

    // Foisonnement pondéré pour affichage uniquement (pas pour le calcul)
    const totalPower = nodePowers.residentialPower + nodePowers.industrialPower;
    const chargesFoisonnementDisplay = totalPower === 0 
      ? residentialFoisonnementHoraire
      : (residentialFoisonnementHoraire * nodePowers.residentialPower + 
         industrialFoisonnementHoraire * nodePowers.industrialPower) / totalPower;

    // Si simulation active, utiliser SimulationCalculator avec équipements
    const useSimulation = this.isSimulationActive && this.simulationEquipment && 
      ((this.simulationEquipment.srg2Devices?.some(s => s.enabled)) ||
       (this.simulationEquipment.neutralCompensators?.some(c => c.enabled)) ||
       (this.simulationEquipment.cableReplacement?.enabled));

    try {
      let result: CalculationResult;
      
      if (useSimulation && this.simulationEquipment) {
        const simCalculator = new SimulationCalculator(
          this.project.cosPhi,
          this.project.cosPhiCharges,
          this.project.cosPhiProductions
        );
        
        result = simCalculator.calculateWithSimulation(
          projectWithHourlyFoisonnement,
          'MIXTE',
          this.simulationEquipment
        );
      } else {
        const calculator = new ElectricalCalculator(
          this.project.cosPhi,
          this.project.cosPhiCharges,
          this.project.cosPhiProductions
        );
        
        result = calculator.calculateScenarioWithHTConfig(
          projectWithHourlyFoisonnement,
          'MIXTE',
          residentialFoisonnementHoraire,  // Fallback pour clients manuels
          productionsFoisonnement,
          this.project.manualPhaseDistribution,  // Déséquilibre conservé
          this.project.clientsImportes,
          this.project.clientLinks
        );
      }
      return this.extractNodeVoltages(
        hour, 
        result, 
        nominalVoltage, 
        chargesFoisonnementDisplay, 
        productionsFoisonnement,
        residentialFoisonnementHoraire,
        industrialFoisonnementHoraire,
        nodePowers.residentialPower,
        nodePowers.industrialPower,
        nodePowers.productionPower,
        evBonus
      );
    } catch (error) {
      console.warn(`Erreur calcul heure ${hour}:`, error);
      return this.createDefaultHourlyResult(
        hour, 
        nominalVoltage, 
        chargesFoisonnementDisplay, 
        productionsFoisonnement,
        residentialFoisonnementHoraire,
        industrialFoisonnementHoraire,
        nodePowers.residentialPower,
        nodePowers.industrialPower,
        nodePowers.productionPower,
        evBonus
      );
    }
  }
  /**
   * Construit une map parent pour chaque nœud (BFS depuis la source)
   */
  private buildParentMap(sourceId: string): Map<string, string> {
    const parentMap = new Map<string, string>();
    const visited = new Set<string>();
    const queue: string[] = [sourceId];
    visited.add(sourceId);
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      const connectedCables = this.project.cables.filter(
        c => c.nodeAId === currentId || c.nodeBId === currentId
      );
      
      for (const cable of connectedCables) {
        const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          parentMap.set(nextNodeId, currentId);
          queue.push(nextNodeId);
        }
      }
    }
    
    return parentMap;
  }

  /**
   * Trouve tous les nœuds en aval d'un nœud donné (vers les extrémités, loin de la source)
   */
  private findDownstreamNodes(startNodeId: string): string[] {
    const source = this.project.nodes.find(n => n.isSource);
    if (!source) return [];

    const downstream: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [startNodeId];
    visited.add(startNodeId);
    
    // Construire le chemin depuis la source pour déterminer l'orientation
    const parentMap = this.buildParentMap(source.id);
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      // Trouver les câbles connectés à ce nœud
      const connectedCables = this.project.cables.filter(
        c => c.nodeAId === currentId || c.nodeBId === currentId
      );
      
      for (const cable of connectedCables) {
        const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        
        // Ne prendre que les nœuds en aval (plus loin de la source)
        if (!visited.has(nextNodeId) && parentMap.get(nextNodeId) === currentId) {
          visited.add(nextNodeId);
          downstream.push(nextNodeId);
          queue.push(nextNodeId);
        }
      }
    }
    
    return downstream;
  }

  /**
   * Calcule les puissances du nœud sélectionné + nœuds aval (puissances transitantes)
   * "Amont" au sens courant = ce qui transite par ce nœud vers l'aval
   */
  private getUpstreamAndNodePowers(): { 
    residentialPower: number; 
    industrialPower: number; 
    productionPower: number;
  } {
    const nodeId = this.options.selectedNodeId;
    const clients = this.project.clientsImportes || [];
    const links = this.project.clientLinks || [];

    // Trouver le nœud sélectionné + tous les nœuds en aval (downstream)
    const downstreamNodeIds = this.findDownstreamNodes(nodeId);
    const relevantNodeIds = new Set([nodeId, ...downstreamNodeIds]);

    let residentialPower = 0;
    let industrialPower = 0;
    let productionPower = 0;

    // Parcourir tous les nœuds concernés
    for (const nId of relevantNodeIds) {
      const node = this.project.nodes.find(n => n.id === nId);
      
      // 1. Productions configurées sur le nœud
      if (node?.productions) {
        for (const prod of node.productions) {
          productionPower += prod.S_kVA || 0;
        }
      }

      // 2. Clients liés à ce nœud
      const nodeLinks = links.filter(link => link.nodeId === nId);
      
      nodeLinks.forEach(link => {
        const client = clients.find(c => c.id === link.clientId);
        if (client) {
          const power = client.puissanceContractuelle_kVA || 0;
          if (client.clientType === 'industriel') {
            industrialPower += power;
          } else {
            residentialPower += power;
          }
          
          if (client.puissancePV_kVA) {
            productionPower += client.puissancePV_kVA;
          }
        }
      });
    }

    return { residentialPower, industrialPower, productionPower };
  }

  /**
   * Retourne les statistiques clients pour l'UI
   */
  getClientStats(): { residential: number; industrial: number; residentialPower: number; industrialPower: number } {
    const clients = this.project.clientsImportes || [];
    const links = this.project.clientLinks || [];
    
    let residentialCount = 0;
    let industrialCount = 0;
    let residentialPower = 0;
    let industrialPower = 0;
    
    clients.forEach(client => {
      const isLinked = links.some(link => link.clientId === client.id);
      
      if (isLinked) {
        if (client.clientType === 'industriel') {
          industrialCount++;
          industrialPower += client.puissanceContractuelle_kVA || 0;
        } else {
          residentialCount++;
          residentialPower += client.puissanceContractuelle_kVA || 0;
        }
      }
    });
    
    return { residential: residentialCount, industrial: industrialCount, residentialPower, industrialPower };
  }

  /**
   * Extrait les tensions du nœud sélectionné depuis les résultats de calcul
   */
  private extractNodeVoltages(
    hour: number, 
    result: CalculationResult, 
    nominalVoltage: number,
    chargesFoisonnement: number,
    productionsFoisonnement: number,
    residentialFoisonnement: number,
    industrialFoisonnement: number,
    residentialPower: number,
    industrialPower: number,
    totalProductionPower: number,
    evBonus: number
  ): HourlyVoltageResult {
    const nodeId = this.options.selectedNodeId;
    const nodeMetrics = result.nodeMetricsPerPhase?.find(n => n.nodeId === nodeId);

    if (!nodeMetrics?.voltagesPerPhase) {
      console.warn(`Heure ${hour}: Pas de métriques pour le nœud ${nodeId}`);
      return this.createDefaultHourlyResult(
        hour, nominalVoltage, chargesFoisonnement, productionsFoisonnement,
        residentialFoisonnement, industrialFoisonnement, residentialPower, industrialPower, totalProductionPower, evBonus
      );
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

    // Calcul des puissances foisonnées
    const chargesResidentialPower_kVA = residentialPower * (residentialFoisonnement / 100);
    const chargesIndustrialPower_kVA = industrialPower * (industrialFoisonnement / 100);
    const productionsPower_kVA = totalProductionPower * (productionsFoisonnement / 100);

    return {
      hour,
      voltageA_V: voltageA,
      voltageB_V: voltageB,
      voltageC_V: voltageC,
      voltageAvg_V: voltageAvg,
      voltageMin_V: voltageMin,
      voltageMax_V: voltageMax,
      deviationPercent,
      status,
      chargesFoisonnement,
      chargesResidentialFoisonnement: residentialFoisonnement,
      chargesIndustrialFoisonnement: industrialFoisonnement,
      productionsFoisonnement,
      chargesResidentialPower_kVA,
      chargesIndustrialPower_kVA,
      productionsPower_kVA,
      evBonus
    };
  }

  /**
   * Crée un résultat par défaut (tensions nominales)
   */
  private createDefaultHourlyResult(
    hour: number, 
    nominalVoltage: number,
    chargesFoisonnement: number,
    productionsFoisonnement: number,
    residentialFoisonnement: number,
    industrialFoisonnement: number,
    residentialPower: number,
    industrialPower: number,
    totalProductionPower: number,
    evBonus: number
  ): HourlyVoltageResult {
    const chargesResidentialPower_kVA = residentialPower * (residentialFoisonnement / 100);
    const chargesIndustrialPower_kVA = industrialPower * (industrialFoisonnement / 100);
    const productionsPower_kVA = totalProductionPower * (productionsFoisonnement / 100);

    return {
      hour,
      voltageA_V: nominalVoltage,
      voltageB_V: nominalVoltage,
      voltageC_V: nominalVoltage,
      voltageAvg_V: nominalVoltage,
      voltageMin_V: nominalVoltage,
      voltageMax_V: nominalVoltage,
      deviationPercent: 0,
      status: 'normal',
      chargesFoisonnement,
      chargesResidentialFoisonnement: residentialFoisonnement,
      chargesIndustrialFoisonnement: industrialFoisonnement,
      productionsFoisonnement,
      chargesResidentialPower_kVA,
      chargesIndustrialPower_kVA,
      productionsPower_kVA,
      evBonus
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
