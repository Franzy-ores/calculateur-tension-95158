import { DailyProfileConfig, DailySimulationOptions, HourlyVoltageResult, HourlyProfile, SRG2HourlyActivation } from '@/types/dailyProfile';
import { Project, CalculationResult, SimulationEquipment, NeutralCompensator } from '@/types/network';
import { SRG2Config, SRG2SwitchState } from '@/types/srg2';
import { ElectricalCalculator } from './electricalCalculations';
import { SRG2Regulator } from './srg2Regulator';
import { SimulationCalculator } from './simulationCalculator';
import defaultProfiles from '@/data/hourlyProfiles.json';
import { calculateAdaptiveFoisonnement } from './foisonnementCalculator';

// ── Paramètres Kaufmann VE — g(n) = g_inf + (1−g_inf) × e^(−q×(n−1)) ──────
// Source : Rolink, Tabelle 4.1
const KAUFMANN_EV: Record<number, { g_inf: number; q: number }> = {
  3.7: { g_inf: 0.056, q: 0.2793 },
  11:  { g_inf: 0.0585, q: 0.4953 },
  22:  { g_inf: 0.032,  q: 0.5875 },
};

const KAUFMANN_PAC = { g_inf: 0.065, q: 0.25 };

const VE_PROFILE_WINTER: Record<number, number> = {
  0:2, 1:3, 2:4, 3:4, 4:4, 5:3,
  6:2, 7:5, 8:8, 9:5, 10:3, 11:2,
  12:2, 13:2, 14:3, 15:5, 16:10, 17:25,
  18:55, 19:80, 20:75, 21:60, 22:40, 23:20
};

const VE_PROFILE_SUMMER: Record<number, number> = {
  0:2, 1:2, 2:3, 3:3, 4:3, 5:4,
  6:5, 7:8, 8:10, 9:8, 10:6, 11:5,
  12:5, 13:5, 14:6, 15:8, 16:12, 17:20,
  18:40, 19:55, 20:50, 21:38, 22:25, 23:12
};

const PAC_PROFILE_WINTER: Record<number, number> = {
  0:60, 1:65, 2:70, 3:75, 4:75, 5:72,
  6:65, 7:55, 8:45, 9:35, 10:30, 11:28,
  12:28, 13:30, 14:32, 15:38, 16:50, 17:65,
  18:72, 19:75, 20:72, 21:68, 22:65, 23:62
};

const PAC_PROFILE_SUMMER: Record<number, number> = {
  0:5, 1:5, 2:5, 3:5, 4:5, 5:5,
  6:5, 7:5, 8:5, 9:5, 10:5, 11:5,
  12:5, 13:5, 14:5, 15:5, 16:5, 17:5,
  18:5, 19:5, 20:5, 21:5, 22:5, 23:5
};

function kaufmannCoeff(
  n: number,
  params: { g_inf: number; q: number },
  N_ref: number = 150
): number {
  if (n <= 0) return 1;
  const g = params.g_inf + (1 - params.g_inf) * Math.exp(-params.q * (n - 1));
  const g_ref = params.g_inf + (1 - params.g_inf) * Math.exp(-params.q * (N_ref - 1));
  return g_ref > 0 ? g / g_ref : 1;
}

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
  private _rawResults: CalculationResult[] = [];

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
   * 
   * 🔑 RÈGLE IMPORTANTE: Le SRG2 possède une mémoire mécanique.
   * Sa position de prise doit être conservée entre les pas de simulation journalière.
   * 
   * - SRG2: Conserve son état (prise) entre les heures (temps long, inertie mécanique)
   * - EQUI8: Peut être recalculé librement à chaque heure (temps réel, réponse rapide)
   */
  calculateDailyVoltages(): HourlyVoltageResult[] {
    this._rawResults = [];
    const results: HourlyVoltageResult[] = [];
    const nominalVoltage = 230;

    // 🔑 Mémoire mécanique SRG2 via SRG2Regulator (conserve état entre les heures)
    const srg2Regulators: Map<string, SRG2Regulator> = new Map();
    
    if (this.isSimulationActive && this.simulationEquipment?.srg2Devices) {
      for (const srg2 of this.simulationEquipment.srg2Devices.filter(s => s.enabled)) {
        const reg = new SRG2Regulator(srg2);
        // Restaurer la position initiale si disponible
        if (srg2.etatCommutateur) {
          reg.setTaps(srg2.etatCommutateur as Record<'A' | 'B' | 'C', SRG2SwitchState>);
        }
        srg2Regulators.set(srg2.id, reg);
      }
    }

    for (let hour = 0; hour < 24; hour++) {
      const hourlyResult = this.calculateHourlyVoltage(hour, nominalVoltage, srg2Regulators);
      results.push(hourlyResult);
      // SRG2Regulator instances conservent leur état interne automatiquement
    }

    return results;
  }

  /**
   * Retourne les CalculationResult bruts de la dernière exécution de calculateDailyVoltages()
   * Contient nodeMetricsPerPhase avec les tensions de TOUS les nœuds pour chaque heure
   */
  getLastRawResults(): CalculationResult[] {
    return this._rawResults;
  }

  /**
   * Compte les clients industriels dans le projet
   */
  private countIndustrialClients(): number {
    if (!this.project.clientsImportes) return 0;
    return this.project.clientsImportes.filter(c => c.clientType === 'industriel').length;
  }

  /**
   * Compte les clients résidentiels liés dans le projet
   */
  private countResidentialClients(): number {
    if (!this.project.clientsImportes || !this.project.clientLinks) return 0;
    const linkedIds = new Set(this.project.clientLinks.map(l => l.clientId));
    return this.project.clientsImportes.filter(c => c.clientType !== 'industriel' && linkedIds.has(c.id)).length;
  }

  /**
   * Compte les clients résidentiels transitant par le nœud sélectionné
   * (nœud lui-même + tous ses nœuds aval dans l'arbre réseau)
   */
  private countResidentialClientsTransitant(): number {
    const nodeId = this.options.selectedNodeId;
    if (!nodeId) return this.countResidentialClients();
    const clients = this.project.clientsImportes || [];
    const links = this.project.clientLinks || [];
    if (clients.length === 0 || links.length === 0) return 0;
    const downstreamIds = this.findDownstreamNodes(nodeId);
    const relevantIds = new Set([nodeId, ...downstreamIds]);
    let count = 0;
    for (const nId of relevantIds) {
      const nodeLinks = links.filter(l => l.nodeId === nId);
      for (const l of nodeLinks) {
        const client = clients.find(c => c.id === l.clientId);
        if (client && client.clientType !== 'industriel') count++;
      }
    }
    return count;
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
   * 
   * ARCHITECTURE SRG2 HEURE PAR HEURE:
   * - Passe 1: Calcul naturel (sans SRG2) pour obtenir les tensions au nœud SRG2
   * - Évaluation des seuils SRG2 pour déterminer l'état (BYP, LO1, LO2, BO1, BO2)
   * - Passe 2: Si SRG2 actif, recalcul avec régulation appliquée
   * 
   * 🔑 MÉMOIRE MÉCANIQUE SRG2:
   * - currentSRG2TapPositions contient l'état de prise de l'heure précédente
   * - Les seuils d'hystérésis empêchent les oscillations
   * - Le SRG2 ne change de prise que si la tension sort de la zone d'hystérésis
   */
  private calculateHourlyVoltage(
    hour: number, 
    nominalVoltage: number,
    srg2Regulators: Map<string, SRG2Regulator>
  ): HourlyVoltageResult {
    const seasonProfile = this.profiles.profiles[this.options.season];
    const weatherFactor = this.profiles.weatherFactors[this.options.weather];
    const hourStr = hour.toString();

    // 🔧 Clusters et foisonnement adaptatif désactivés dans le Profil 24H
    // Le profil P90 est déjà calibré sur la mesure réelle — pas de correction supplémentaire
    const facteurConso = 1.0;
    const facteurVE = 1.0;

    // Nombre de clients résidentiels connectés (pour foisonnement adaptatif)
    const nResidentialClients = this.countResidentialClients();

    // Si profil mesuré activé, utiliser le profil mesuré pour toutes les charges
    const useMeasured = this.options.useMeasuredProfile && this.measuredProfile;

    // Profils horaires par type — valeurs BRUTES (sans cluster)
    const baseResidentialProfile = useMeasured 
      ? (this.measuredProfile![hourStr] || 0)
      : (seasonProfile.residential[hourStr] || 0);
    const industrialProfile = useMeasured 
      ? (this.measuredProfile![hourStr] || 0)
      : (seasonProfile.industrial_pme[hourStr] || 0);
    
    // Récupérer les puissances transitantes (nœud sélectionné + aval)
    const nodePowers = this.getUpstreamAndNodePowers();
    
    // Bonus VE brut (sans facteurVE) — sera multiplié par facteurVE après Velander
    let baseEvBonus = 0;
    if (this.options.enableEV) {
      const bonusEvening = this.options.evBonusEvening ?? 2.5;
      const bonusNight = this.options.evBonusNight ?? 5;
      
      if (hour >= 18 && hour <= 21) {
        baseEvBonus = bonusEvening;
      } else if (hour >= 22 || hour <= 5) {
        baseEvBonus = bonusNight;
      }
    }
    
    // Foisonnement adaptatif sur le profil physique de BASE (sans cluster)
    let baseFoisonne = baseResidentialProfile;
    let evFoisonne = baseEvBonus;
    
    // zeroConsumption : production seule, pas de charges
    if (this.options.zeroConsumption) {
      baseFoisonne = 0;
      evFoisonne = 0;
    } else if (this.options.customDiversityCoeff !== undefined && nResidentialClients > 1) {
      // Override par coefficient de diversité continu f(N) = a + (1-a)/√N
      baseFoisonne = baseResidentialProfile * this.options.customDiversityCoeff;
      if (baseEvBonus > 0) {
        evFoisonne = baseEvBonus * this.options.customDiversityCoeff;
      }
    }
    // Foisonnement adaptatif (Velander) désactivé — le profil P90 brut est utilisé directement
    
    // 🔧 FIX GRD -- Cluster appliqué comme multiplicateur PUR après Velander
    // Le plancher de diversité reste basé sur le profil physique
    const residentialFoisonnementHoraire = this.options.zeroConsumption ? 0 : baseFoisonne * facteurConso + evFoisonne * facteurVE;
    
    const industrialFoisonnementHoraire = this.options.zeroConsumption ? 0 : industrialProfile;

    // ── Calcul VE (Kaufmann) ──────────────────────────────────────────
    const N_total = this.options.nResidential ?? this.countResidentialClients();
    const evRate = this.options.evPenetrationRate ?? 0;
    const evPowerKW = this.options.evChargingPower_kW ?? 3.7;
    const N_EV = Math.round(N_total * evRate);
    let S_EV_kVA = 0;

    if (N_EV > 0 && !this.options.zeroConsumption) {
      const evProfile = this.options.season === 'winter' ? VE_PROFILE_WINTER : VE_PROFILE_SUMMER;
      const evFactor = (evProfile[hour] ?? 0) / 100;
      const evParams = KAUFMANN_EV[evPowerKW as 3.7 | 11 | 22] || KAUFMANN_EV[3.7];
      const K_EV = kaufmannCoeff(N_EV, evParams, 150);
      S_EV_kVA = N_EV * evPowerKW * evFactor * K_EV;
    }

    // ── Calcul PAC (Kaufmann) ─────────────────────────────────────────
    const pacRate = this.options.pacPenetrationRate ?? 0;
    const pacPowerKW = this.options.pacPower_kW ?? 3;
    const N_PAC = Math.round(N_total * pacRate);
    let S_PAC_kVA = 0;

    if (N_PAC > 0 && !this.options.zeroConsumption) {
      const pacProfile = this.options.season === 'winter' ? PAC_PROFILE_WINTER : PAC_PROFILE_SUMMER;
      const pacFactor = (pacProfile[hour] ?? 0) / 100;
      const K_PAC = kaufmannCoeff(N_PAC, KAUFMANN_PAC, 150);
      S_PAC_kVA = N_PAC * pacPowerKW * pacFactor * K_PAC;
    }

    // Foisonnement productions = profil PV × facteur météo (ou 0% si zeroProduction activé)
    const productionsFoisonnement = this.options.zeroProduction 
      ? 0 
      : (seasonProfile.pv[hourStr] || 0) * weatherFactor;

    // Créer un projet modifié avec les foisonnements horaires par type de client
    const projectWithHourlyFoisonnement: Project = {
      ...this.project,
      foisonnementChargesResidentiel: residentialFoisonnementHoraire,
      foisonnementChargesIndustriel: industrialFoisonnementHoraire,
      foisonnementProductions: productionsFoisonnement,
      // Propager la saison choisie dans le profil 24h pour la correction thermique
      season: this.options.season
    };

    // Foisonnement pondéré pour affichage uniquement (pas pour le calcul)
    const totalPower = nodePowers.residentialPower + nodePowers.industrialPower;
    const chargesFoisonnementDisplay = totalPower === 0 
      ? residentialFoisonnementHoraire
      : (residentialFoisonnementHoraire * nodePowers.residentialPower + 
         industrialFoisonnementHoraire * nodePowers.industrialPower) / totalPower;

    // Déterminer si on doit évaluer SRG2 heure par heure
    const hasSRG2 = this.isSimulationActive && this.simulationEquipment && 
      this.simulationEquipment.srg2Devices?.some(s => s.enabled);
    
    // Autres équipements de simulation (câbles, EQUI8)
    const hasOtherEquipment = this.isSimulationActive && this.simulationEquipment && 
      ((this.simulationEquipment.neutralCompensators?.some(c => c.enabled)) ||
       (this.simulationEquipment.cableReplacement?.enabled));

    try {
      let result: CalculationResult;
      let srg2States: SRG2HourlyActivation[] | undefined;
      
      if (hasSRG2 && this.simulationEquipment?.srg2Devices) {
        // === CALCUL SRG2 HEURE PAR HEURE AVEC MÉMOIRE MÉCANIQUE ===
        const srg2Result = this.calculateWithHourlySRG2Evaluation(
          projectWithHourlyFoisonnement,
          this.simulationEquipment.srg2Devices.filter(s => s.enabled),
          this.simulationEquipment.neutralCompensators?.filter(c => c.enabled),
          this.simulationEquipment.cableReplacement,
          srg2Regulators
        );
        result = srg2Result.result;
        srg2States = srg2Result.srg2States;
      } else if (hasOtherEquipment && this.simulationEquipment) {
        // Simulation sans SRG2 (câbles ou EQUI8 uniquement)
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
        // Pas de simulation active
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
      
      // Stocker le résultat brut pour accès via getLastRawResults()
      this._rawResults.push(result);
      
      const hourlyResult = this.extractNodeVoltages(
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
        evFoisonne * facteurVE,
        S_EV_kVA,
        S_PAC_kVA
      );
      
      // Ajouter l'état SRG2 au résultat
      if (srg2States) {
        hourlyResult.srg2States = srg2States;
      }
      
      return hourlyResult;
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
        evFoisonne * facteurVE,
        S_EV_kVA,
        S_PAC_kVA
      );
    }
  }

  /**
   * Calcul en deux passes pour évaluation SRG2 heure par heure
   * 
   * 🔑 MÉMOIRE MÉCANIQUE SRG2:
   * Le SRG2 possède une mémoire mécanique. Sa position de prise doit être
   * conservée entre les pas de simulation journalière.
   * 
   * PASSE 1: Calcul naturel (sans régulation SRG2)
   *   → Obtenir les tensions "naturelles" au nœud où le SRG2 est installé
   * 
   * ÉVALUATION: Pour chaque SRG2, déterminer si un changement de prise est nécessaire
   *   → Comparer tensions naturelles aux seuils LO2/LO1/BO1/BO2 AVEC HYSTÉRÉSIS
   *   → Le SRG2 ne change de prise QUE si la tension sort de la zone d'hystérésis
   * 
   * PASSE 2: Si au moins un SRG2 est actif (pas en bypass)
   *   → Recalculer le réseau avec les régulations appliquées
   */
  private calculateWithHourlySRG2Evaluation(
    projectWithHourlyFoisonnement: Project,
    srg2Devices: SRG2Config[],
    neutralCompensators?: NeutralCompensator[],
    cableReplacement?: { enabled: boolean; targetCableTypeId: string; affectedCableIds: string[] },
    srg2Regulators?: Map<string, SRG2Regulator>
  ): { result: CalculationResult; srg2States: SRG2HourlyActivation[] } {
    
    // Appliquer le remplacement de câbles si actif
    let projectToUse = projectWithHourlyFoisonnement;
    if (cableReplacement?.enabled && cableReplacement.affectedCableIds.length > 0) {
      projectToUse = this.applyProjectCableReplacement(projectWithHourlyFoisonnement, cableReplacement);
    }
    
    // === PASSE 1: Calcul naturel sans SRG2 ===
    const calculator = new ElectricalCalculator(
      this.project.cosPhi,
      this.project.cosPhiCharges,
      this.project.cosPhiProductions
    );
    
    const naturalResult = calculator.calculateScenarioWithHTConfig(
      projectToUse,
      'MIXTE',
      projectToUse.foisonnementChargesResidentiel ?? projectToUse.foisonnementCharges,
      projectToUse.foisonnementProductions,
      projectToUse.manualPhaseDistribution,
      projectToUse.clientsImportes,
      projectToUse.clientLinks
    );
    
    // === ÉVALUATION DES SRG2 VIA SRG2Regulator.update() ===
    const srg2States: SRG2HourlyActivation[] = [];
    let anySRG2Active = false;
    
    for (const srg2 of srg2Devices) {
      const reg = srg2Regulators?.get(srg2.id);
      
      // Récupérer les tensions naturelles au nœud SRG2
      const nodeMetrics = naturalResult.nodeMetricsPerPhase?.find(
        nm => nm.nodeId === srg2.nodeId
      );
      
      if (!nodeMetrics?.voltagesPerPhase || !reg) {
        // Nœud non trouvé ou pas de régulateur → conserver l'état précédent
        const currentTaps = reg?.getCurrentTaps() || { A: 'BYP' as SRG2SwitchState, B: 'BYP' as SRG2SwitchState, C: 'BYP' as SRG2SwitchState };
        const isActive = currentTaps.A !== 'BYP' || currentTaps.B !== 'BYP' || currentTaps.C !== 'BYP';
        srg2States.push({
          srg2Id: srg2.id,
          nodeId: srg2.nodeId,
          isActive,
          switchStates: currentTaps,
          tensionEntree: { A: 230, B: 230, C: 230 }
        });
        if (isActive) anySRG2Active = true;
        continue;
      }
      
      const tensions: Record<'A' | 'B' | 'C', number> = {
        A: nodeMetrics.voltagesPerPhase.A,
        B: nodeMetrics.voltagesPerPhase.B,
        C: nodeMetrics.voltagesPerPhase.C
      };
      
      // 🔑 Appel centralisé : SRG2Regulator gère hystérésis, temporisation, contraintes
      // dt=3600s (1 heure) >> 7s temporisation → commutation immédiate si seuil franchi
      const regResult = reg.update(tensions, 3600);
      
      // Convertir le résultat SRG2Regulator → SRG2HourlyActivation
      const switchStates = {
        A: regResult.phases.A.state,
        B: regResult.phases.B.state,
        C: regResult.phases.C.state
      };
      
      const tensionSortie = regResult.isActive ? {
        A: regResult.phases.A.Vout,
        B: regResult.phases.B.Vout,
        C: regResult.phases.C.Vout
      } : undefined;
      
      srg2States.push({
        srg2Id: srg2.id,
        nodeId: srg2.nodeId,
        isActive: regResult.isActive,
        switchStates,
        tensionEntree: tensions,
        tensionSortie
      });
      
      if (regResult.isActive) anySRG2Active = true;
      
      // Log pour debug
      if (regResult.log.length > 0) {
        regResult.log.forEach(msg => console.log(`[24H] ${msg}`));
      }
    }
    
    // === PASSE 2: Recalcul avec SRG2 si actif ===
    if (anySRG2Active) {
      const activatedSRG2Devices = srg2Devices.map((srg2, index) => {
        const state = srg2States[index];
        if (!state.isActive) {
          return { ...srg2, enabled: false };
        }
        return {
          ...srg2,
          tensionEntree: state.tensionEntree,
          etatCommutateur: state.switchStates,
          tensionSortie: state.tensionSortie
        };
      });
      
      const simulationEquipment: SimulationEquipment = {
        srg2Devices: activatedSRG2Devices.filter(s => s.enabled),
        neutralCompensators: neutralCompensators || [],
        cableUpgrades: [],
        cableReplacement: this.simulationEquipment?.cableReplacement
      };
      
      if (simulationEquipment.srg2Devices && simulationEquipment.srg2Devices.length > 0) {
        const simCalculator = new SimulationCalculator(
          this.project.cosPhi,
          this.project.cosPhiCharges,
          this.project.cosPhiProductions
        );
        
        const fakeCalcResults = { 'MIXTE': naturalResult };
        
        const simulatedResult = simCalculator.calculateWithSimulation(
          projectToUse,
          'MIXTE',
          simulationEquipment,
          fakeCalcResults
        );
        
        // Mettre à jour les tensions de sortie depuis le résultat simulé
        for (let i = 0; i < srg2States.length; i++) {
          const state = srg2States[i];
          if (state.isActive) {
            const nodeMetrics = simulatedResult.nodeMetricsPerPhase?.find(
              nm => nm.nodeId === state.nodeId
            );
            if (nodeMetrics?.voltagesPerPhase) {
              state.tensionSortie = {
                A: nodeMetrics.voltagesPerPhase.A,
                B: nodeMetrics.voltagesPerPhase.B,
                C: nodeMetrics.voltagesPerPhase.C
              };
            }
          }
        }
        
        return { result: simulatedResult, srg2States };
      }
    }
    
    // Pas de SRG2 actif → appliquer EQUI8 si présent
    if (neutralCompensators && neutralCompensators.length > 0) {
      const simCalculator = new SimulationCalculator(
        this.project.cosPhi,
        this.project.cosPhiCharges,
        this.project.cosPhiProductions
      );
      
      const equipmentWithoutSRG2: SimulationEquipment = {
        srg2Devices: [],
        neutralCompensators,
        cableUpgrades: [],
        cableReplacement: this.simulationEquipment?.cableReplacement
      };
      
      const result = simCalculator.calculateWithSimulation(
        projectToUse,
        'MIXTE',
        equipmentWithoutSRG2
      );
      
      return { result, srg2States };
    }
    
    return { result: naturalResult, srg2States };
  }
  
  /**
   * Applique le remplacement de câbles au projet
   */
  private applyProjectCableReplacement(
    project: Project,
    cableReplacement: { targetCableTypeId: string; affectedCableIds: string[] }
  ): Project {
    const modifiedCables = project.cables.map(cable => {
      if (cableReplacement.affectedCableIds.includes(cable.id)) {
        return { ...cable, typeId: cableReplacement.targetCableTypeId };
      }
      return cable;
    });
    
    return { ...project, cables: modifiedCables };
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
    evBonus: number,
    evPower_kVA: number = 0,
    pacPower_kVA: number = 0
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

    // Température maximale estimée des conducteurs
    const maxCableTemp_C = result.cableTemperatures?.length 
      ? Math.max(...result.cableTemperatures.map(ct => ct.temperature_C))
      : undefined;

    // Synthèse thermique globale du circuit
    let circuitThermal: HourlyVoltageResult['circuitThermal'] = undefined;
    if (result.cableTemperatures && result.cableTemperatures.length > 0) {
      const temps = result.cableTemperatures;
      const allTemps = temps.map(ct => ct.temperature_C);
      const minTemp = Math.min(...allTemps);
      const maxTemp = Math.max(...allTemps);
      const avgTemp = allTemps.reduce((s, t) => s + t, 0) / allTemps.length;
      const hotCablesCount = allTemps.filter(t => t > 50).length;
      
      // Identifier le câble le plus chaud
      const hottestEntry = temps.reduce((best, ct) => ct.temperature_C > best.temperature_C ? ct : best, temps[0]);
      const hottestCable = this.project.cables.find(c => c.id === hottestEntry.cableId);

      circuitThermal = {
        minTemp_C: minTemp,
        maxTemp_C: maxTemp,
        avgTemp_C: avgTemp,
        hotCablesCount,
        totalCables: temps.length,
        hottestCableId: hottestEntry.cableId,
        hottestCableName: hottestCable?.name
      };
    }

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
      evBonus,
      evPower_kVA: +evPower_kVA.toFixed(2),
      pacPower_kVA: +pacPower_kVA.toFixed(2),
      maxCableTemp_C,
      circuitThermal
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
    evBonus: number,
    evPower_kVA: number = 0,
    pacPower_kVA: number = 0
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
      evBonus,
      evPower_kVA: +evPower_kVA.toFixed(2),
      pacPower_kVA: +pacPower_kVA.toFixed(2),
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
