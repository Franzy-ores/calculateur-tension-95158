import { DailyProfileConfig, DailySimulationOptions, HourlyVoltageResult, HourlyProfile, SRG2HourlyActivation } from '@/types/dailyProfile';
import { Project, CalculationResult, SimulationEquipment, NeutralCompensator } from '@/types/network';
import { SRG2Config, SRG2SwitchState } from '@/types/srg2';
import { ElectricalCalculator } from './electricalCalculations';
import { SimulationCalculator } from './simulationCalculator';
import defaultProfiles from '@/data/hourlyProfiles.json';
import { getClusterById, DEFAULT_CLUSTER_ID } from '@/data/clusterProfiles';
import { calculateAdaptiveFoisonnement } from './foisonnementCalculator';

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
    // Toujours 230V car on calcule en phase-neutre (seuils ±5% et ±10% basés sur 230V)
    const nominalVoltage = 230;

    // 🔑 Mémoire mécanique SRG2: conserver l'état des commutateurs entre les heures
    // Initialisation: tous en bypass au démarrage de la journée
    let currentSRG2TapPositions: Map<string, { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }> = new Map();
    
    // Initialiser les positions de prise pour chaque SRG2 actif
    if (this.isSimulationActive && this.simulationEquipment?.srg2Devices) {
      for (const srg2 of this.simulationEquipment.srg2Devices.filter(s => s.enabled)) {
        // Position initiale: bypass (ou récupérer depuis l'état courant si disponible)
        const initialState = srg2.etatCommutateur || { A: 'BYP' as SRG2SwitchState, B: 'BYP' as SRG2SwitchState, C: 'BYP' as SRG2SwitchState };
        currentSRG2TapPositions.set(srg2.id, initialState);
      }
    }

    for (let hour = 0; hour < 24; hour++) {
      // Passer les positions de prise actuelles au calcul horaire
      const hourlyResult = this.calculateHourlyVoltage(hour, nominalVoltage, currentSRG2TapPositions);
      results.push(hourlyResult);
      
      // 🔑 Mettre à jour les positions de prise SRG2 pour l'heure suivante
      // Le SRG2 conserve sa position (mémoire mécanique) - seul un changement de seuil la modifie
      if (hourlyResult.srg2States) {
        for (const srg2State of hourlyResult.srg2States) {
          currentSRG2TapPositions.set(srg2State.srg2Id, srg2State.switchStates);
        }
      }
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
   * Compte les clients résidentiels liés dans le projet
   */
  private countResidentialClients(): number {
    if (!this.project.clientsImportes || !this.project.clientLinks) return 0;
    const linkedIds = new Set(this.project.clientLinks.map(l => l.clientId));
    return this.project.clientsImportes.filter(c => c.clientType !== 'industriel' && linkedIds.has(c.id)).length;
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
    currentSRG2TapPositions: Map<string, { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }>
  ): HourlyVoltageResult {
    const seasonProfile = this.profiles.profiles[this.options.season];
    const weatherFactor = this.profiles.weatherFactors[this.options.weather];
    const hourStr = hour.toString();

    // Cluster de circuit : modificateurs sur les profils de base
    // 🔧 FIX GRD -- Les facteurs cluster sont appliqués APRÈS le foisonnement Velander
    // pour éviter que le cluster modifie le plancher de diversité
    const cluster = getClusterById(this.options.selectedClusterId || DEFAULT_CLUSTER_ID);
    const facteurConso = this.options.customFacteurConso ?? cluster?.facteurConso ?? 1.0;
    const facteurVE = this.options.customFacteurVE ?? cluster?.facteurVE ?? 1.0;

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
    
    if (this.options.customDiversityCoeff !== undefined && nResidentialClients > 1) {
      // Override par coefficient de diversité continu f(N) = a + (1-a)/√N
      baseFoisonne = baseResidentialProfile * this.options.customDiversityCoeff;
      if (baseEvBonus > 0) {
        evFoisonne = baseEvBonus * this.options.customDiversityCoeff;
      }
    } else if (this.options.adaptiveFoisonnement !== false && nResidentialClients > 1) {
      // Velander sur le profil résidentiel brut
      baseFoisonne = calculateAdaptiveFoisonnement(nResidentialClients, baseResidentialProfile);
      // Velander sur le bonus EV brut (si non nul)
      if (baseEvBonus > 0) {
        evFoisonne = calculateAdaptiveFoisonnement(nResidentialClients, baseEvBonus);
      }
    }
    
    // 🔧 FIX GRD -- Cluster appliqué comme multiplicateur PUR après Velander
    // Le plancher de diversité reste basé sur le profil physique
    const residentialFoisonnementHoraire = baseFoisonne * facteurConso + evFoisonne * facteurVE;
    
    const industrialFoisonnementHoraire = industrialProfile;

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
          currentSRG2TapPositions  // 🔑 Positions de prise actuelles (mémoire mécanique)
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
        evFoisonne * facteurVE
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
        evFoisonne * facteurVE
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
    currentTapPositions?: Map<string, { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }>
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
    
    // === ÉVALUATION DES SRG2 AVEC MÉMOIRE MÉCANIQUE ===
    // 🔑 Le SRG2 possède une mémoire mécanique. Sa position de prise doit être
    // conservée entre les pas de simulation journalière.
    const srg2States: SRG2HourlyActivation[] = [];
    let anySRG2Active = false;
    
    for (const srg2 of srg2Devices) {
      // Récupérer la position de prise actuelle (mémoire de l'heure précédente)
      const previousTapPosition = currentTapPositions?.get(srg2.id);
      
      // Évaluer si un changement de prise est nécessaire (avec hystérésis)
      const activation = this.evaluateSRG2ActivationWithMemory(
        naturalResult, 
        srg2, 
        projectToUse.voltageSystem,
        previousTapPosition
      );
      srg2States.push(activation);
      if (activation.isActive) {
        anySRG2Active = true;
      }
    }
    
    // === PASSE 2: Recalcul avec SRG2 si actif ===
    if (anySRG2Active) {
      // Créer une copie des devices SRG2 avec les états d'activation calculés
      const activatedSRG2Devices = srg2Devices.map((srg2, index) => {
        const state = srg2States[index];
        if (!state.isActive) {
          // SRG2 en bypass - le désactiver pour ce calcul
          return { ...srg2, enabled: false };
        }
        // SRG2 actif - mettre à jour les tensions d'entrée et états commutateurs
        return {
          ...srg2,
          tensionEntree: state.tensionEntree,
          etatCommutateur: state.switchStates,
          tensionSortie: state.tensionSortie
        };
      });
      
      // Construire l'équipement de simulation avec états SRG2 pré-calculés
      const simulationEquipment: SimulationEquipment = {
        srg2Devices: activatedSRG2Devices.filter(s => s.enabled),
        neutralCompensators: neutralCompensators || [],
        cableUpgrades: [],
        cableReplacement: this.simulationEquipment?.cableReplacement
      };
      
      // Si au moins un SRG2 reste actif, calculer avec régulation
      if (simulationEquipment.srg2Devices && simulationEquipment.srg2Devices.length > 0) {
        const simCalculator = new SimulationCalculator(
          this.project.cosPhi,
          this.project.cosPhiCharges,
          this.project.cosPhiProductions
        );
        
        // Créer un "fake" calculationResults avec le résultat naturel pour que le SRG2
        // lise les bonnes tensions d'entrée
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
    
    // Pas de SRG2 actif ou tous en bypass → appliquer EQUI8 si présent
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
   * Évalue l'activation d'un SRG2 pour une heure donnée
   * Compare les tensions naturelles aux seuils de régulation
   */
  private evaluateSRG2Activation(
    naturalResult: CalculationResult,
    srg2: SRG2Config,
    voltageSystem: string
  ): SRG2HourlyActivation {
    // Récupérer les tensions naturelles au nœud SRG2
    const nodeMetrics = naturalResult.nodeMetricsPerPhase?.find(
      nm => nm.nodeId === srg2.nodeId
    );
    
    if (!nodeMetrics?.voltagesPerPhase) {
      // Nœud non trouvé → bypass par défaut
      return {
        srg2Id: srg2.id,
        nodeId: srg2.nodeId,
        isActive: false,
        switchStates: { A: 'BYP', B: 'BYP', C: 'BYP' },
        tensionEntree: { A: 230, B: 230, C: 230 }
      };
    }
    
    const tensions = {
      A: nodeMetrics.voltagesPerPhase.A,
      B: nodeMetrics.voltagesPerPhase.B,
      C: nodeMetrics.voltagesPerPhase.C
    };
    
    // Déterminer l'état de chaque phase selon les seuils
    const stateA = this.determineSRG2SwitchState(tensions.A, srg2);
    const stateB = this.determineSRG2SwitchState(tensions.B, srg2);
    const stateC = this.determineSRG2SwitchState(tensions.C, srg2);
    
    // Appliquer les contraintes SRG2-230 si nécessaire (pas de boost et lower simultanés)
    const finalStates = this.applySRG230Constraints(
      { A: stateA, B: stateB, C: stateC },
      tensions,
      srg2
    );
    
    // SRG2 actif si au moins une phase n'est pas en bypass
    const isActive = finalStates.A !== 'BYP' || finalStates.B !== 'BYP' || finalStates.C !== 'BYP';
    
    // Calculer les tensions de sortie prévisionnelles
    const tensionSortie = isActive ? {
      A: tensions.A * (1 + this.getVoltageCoefficient(finalStates.A, srg2) / 100),
      B: tensions.B * (1 + this.getVoltageCoefficient(finalStates.B, srg2) / 100),
      C: tensions.C * (1 + this.getVoltageCoefficient(finalStates.C, srg2) / 100)
    } : undefined;
    
    return {
      srg2Id: srg2.id,
      nodeId: srg2.nodeId,
      isActive,
      switchStates: finalStates,
      tensionEntree: tensions,
      tensionSortie
    };
  }
  
  /**
   * 🔑 MÉMOIRE MÉCANIQUE SRG2: Évalue l'activation avec hystérésis
   * 
   * Le SRG2 possède une mémoire mécanique. Sa position de prise doit être
   * conservée entre les pas de simulation journalière.
   * 
   * Le changement de prise ne s'effectue QUE si:
   * 1. La tension sort de la zone de tolérance de la position actuelle
   * 2. L'hystérésis (±2V par défaut) est dépassée
   * 
   * Cela évite les oscillations causées par des variations mineures de tension.
   */
  private evaluateSRG2ActivationWithMemory(
    naturalResult: CalculationResult,
    srg2: SRG2Config,
    voltageSystem: string,
    previousTapPosition?: { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }
  ): SRG2HourlyActivation {
    // Récupérer les tensions naturelles au nœud SRG2
    const nodeMetrics = naturalResult.nodeMetricsPerPhase?.find(
      nm => nm.nodeId === srg2.nodeId
    );
    
    if (!nodeMetrics?.voltagesPerPhase) {
      // Nœud non trouvé → conserver la position précédente ou bypass par défaut
      return {
        srg2Id: srg2.id,
        nodeId: srg2.nodeId,
        isActive: previousTapPosition ? 
          (previousTapPosition.A !== 'BYP' || previousTapPosition.B !== 'BYP' || previousTapPosition.C !== 'BYP') : 
          false,
        switchStates: previousTapPosition || { A: 'BYP', B: 'BYP', C: 'BYP' },
        tensionEntree: { A: 230, B: 230, C: 230 }
      };
    }
    
    const tensions = {
      A: nodeMetrics.voltagesPerPhase.A,
      B: nodeMetrics.voltagesPerPhase.B,
      C: nodeMetrics.voltagesPerPhase.C
    };
    
    // Hystérésis du SRG2 (±2V par défaut)
    const hysteresis = srg2.hysteresis_V || 2;
    
    // Pour chaque phase, déterminer si un changement de prise est nécessaire
    const stateA = this.determineSRG2SwitchStateWithHysteresis(
      tensions.A, srg2, previousTapPosition?.A || 'BYP', hysteresis
    );
    const stateB = this.determineSRG2SwitchStateWithHysteresis(
      tensions.B, srg2, previousTapPosition?.B || 'BYP', hysteresis
    );
    const stateC = this.determineSRG2SwitchStateWithHysteresis(
      tensions.C, srg2, previousTapPosition?.C || 'BYP', hysteresis
    );
    
    // Appliquer les contraintes SRG2-230 si nécessaire
    const finalStates = this.applySRG230Constraints(
      { A: stateA, B: stateB, C: stateC },
      tensions,
      srg2
    );
    
    // SRG2 actif si au moins une phase n'est pas en bypass
    const isActive = finalStates.A !== 'BYP' || finalStates.B !== 'BYP' || finalStates.C !== 'BYP';
    
    // Calculer les tensions de sortie prévisionnelles
    const tensionSortie = isActive ? {
      A: tensions.A * (1 + this.getVoltageCoefficient(finalStates.A, srg2) / 100),
      B: tensions.B * (1 + this.getVoltageCoefficient(finalStates.B, srg2) / 100),
      C: tensions.C * (1 + this.getVoltageCoefficient(finalStates.C, srg2) / 100)
    } : undefined;
    
    return {
      srg2Id: srg2.id,
      nodeId: srg2.nodeId,
      isActive,
      switchStates: finalStates,
      tensionEntree: tensions,
      tensionSortie
    };
  }
  
  /**
   * 🔑 Détermine l'état du commutateur SRG2 avec hystérésis
   * 
   * Le SRG2 ne change de prise que si la tension sort de la zone d'hystérésis
   * de la position actuelle. Cela simule l'inertie mécanique du système.
   */
  private determineSRG2SwitchStateWithHysteresis(
    tension: number, 
    srg2: SRG2Config, 
    currentState: SRG2SwitchState,
    hysteresis: number
  ): SRG2SwitchState {
    // Calculer les seuils avec hystérésis selon la position actuelle
    // Le SRG2 reste dans sa position sauf si la tension force un changement
    
    switch (currentState) {
      case 'LO2':
        // En LO2 (abaissement max), on reste sauf si tension tombe sous seuilLO1 - hystérésis
        if (tension < srg2.seuilLO1_V - hysteresis) return 'LO1';
        return 'LO2';
        
      case 'LO1':
        // En LO1 (abaissement partiel)
        if (tension >= srg2.seuilLO2_V + hysteresis) return 'LO2';
        if (tension < srg2.seuilBO1_V + hysteresis) return 'BYP'; // Zone de bypass
        return 'LO1';
        
      case 'BYP':
        // En bypass, on évalue si on doit passer en régulation
        if (tension >= srg2.seuilLO2_V + hysteresis) return 'LO2';
        if (tension >= srg2.seuilLO1_V + hysteresis) return 'LO1';
        if (tension <= srg2.seuilBO2_V - hysteresis) return 'BO2';
        if (tension <= srg2.seuilBO1_V - hysteresis) return 'BO1';
        return 'BYP';
        
      case 'BO1':
        // En BO1 (augmentation partielle)
        if (tension <= srg2.seuilBO2_V - hysteresis) return 'BO2';
        if (tension > srg2.seuilLO1_V - hysteresis) return 'BYP'; // Zone de bypass
        return 'BO1';
        
      case 'BO2':
        // En BO2 (augmentation max), on reste sauf si tension monte au-dessus seuilBO1 + hystérésis
        if (tension > srg2.seuilBO1_V + hysteresis) return 'BO1';
        return 'BO2';
        
      default:
        // État inconnu, utiliser la logique standard sans hystérésis
        return this.determineSRG2SwitchState(tension, srg2);
    }
  }
  
  /**
   * Détermine l'état du commutateur SRG2 selon la tension
   */
  private determineSRG2SwitchState(tension: number, srg2: SRG2Config): SRG2SwitchState {
    if (tension >= srg2.seuilLO2_V) return 'LO2';
    if (tension >= srg2.seuilLO1_V) return 'LO1';
    if (tension <= srg2.seuilBO2_V) return 'BO2';
    if (tension <= srg2.seuilBO1_V) return 'BO1';
    return 'BYP';
  }
  
  // 🔧 FIX GRD — Contraintes SRG2 renforcées (tous types, pas seulement SRG2-230)
  // - Interdire boost (BO) et buck (LO) simultanés
  // - Prioriser le mode commun (A=B=C) quand possible
  // - Limiter l'effet total à ±10%
  private applySRG230Constraints(
    states: { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState },
    tensions: { A: number; B: number; C: number },
    srg2: SRG2Config
  ): { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState } {
    const isBoost = (s: SRG2SwitchState) => s === 'BO1' || s === 'BO2';
    const isLower = (s: SRG2SwitchState) => s === 'LO1' || s === 'LO2';
    
    const hasBoost = isBoost(states.A) || isBoost(states.B) || isBoost(states.C);
    const hasLower = isLower(states.A) || isLower(states.B) || isLower(states.C);
    
    let result = { ...states };
    
    // 🔧 FIX GRD — Priorisation du mode commun : si les 3 phases sont dans le même sens,
    // aligner sur le niveau le plus conservateur
    const allBoost = isBoost(states.A) && isBoost(states.B) && isBoost(states.C);
    const allLower = isLower(states.A) && isLower(states.B) && isLower(states.C);
    
    if (allBoost) {
      // Aligner sur le boost le plus conservateur (BO1 < BO2)
      const hasBO1 = states.A === 'BO1' || states.B === 'BO1' || states.C === 'BO1';
      if (hasBO1) {
        result = { A: 'BO1', B: 'BO1', C: 'BO1' };
        console.log(`[GRD-FIX] SRG2 ${srg2.id}: mode commun BOOST → BO1 (conservateur)`);
      }
    } else if (allLower) {
      // Aligner sur le lower le plus conservateur (LO1 < LO2)
      const hasLO1 = states.A === 'LO1' || states.B === 'LO1' || states.C === 'LO1';
      if (hasLO1) {
        result = { A: 'LO1', B: 'LO1', C: 'LO1' };
        console.log(`[GRD-FIX] SRG2 ${srg2.id}: mode commun LOWER → LO1 (conservateur)`);
      }
    }
    
    // 🔧 FIX GRD — Interdiction boost + buck simultanés (étendu à tous les types SRG2)
    if (hasBoost && hasLower) {
      const avgTension = (tensions.A + tensions.B + tensions.C) / 3;
      const consigne = srg2.tensionConsigne_V;
      
      if (avgTension > consigne) {
        // Privilégier LOWER (tensions trop hautes)
        result = {
          A: isBoost(result.A) ? 'BYP' : result.A,
          B: isBoost(result.B) ? 'BYP' : result.B,
          C: isBoost(result.C) ? 'BYP' : result.C
        };
        console.log(`[GRD-FIX] SRG2 ${srg2.id}: conflit BO/LO → privilégie LOWER (Uavg=${avgTension.toFixed(1)}V > ${consigne}V)`);
      } else {
        // Privilégier BOOST (tensions trop basses)
        result = {
          A: isLower(result.A) ? 'BYP' : result.A,
          B: isLower(result.B) ? 'BYP' : result.B,
          C: isLower(result.C) ? 'BYP' : result.C
        };
        console.log(`[GRD-FIX] SRG2 ${srg2.id}: conflit BO/LO → privilégie BOOST (Uavg=${avgTension.toFixed(1)}V < ${consigne}V)`);
      }
    }
    
    // 🔧 FIX GRD — Vérifier que le coefficient total ne dépasse pas ±10%
    const MAX_SRG2_COEFF_PERCENT = 10;
    for (const phase of ['A', 'B', 'C'] as const) {
      const coeff = this.getVoltageCoefficient(result[phase], srg2);
      if (Math.abs(coeff) > MAX_SRG2_COEFF_PERCENT) {
        console.warn(`[GRD-FIX] SRG2 ${srg2.id} phase ${phase}: coeff ${coeff}% > ±${MAX_SRG2_COEFF_PERCENT}% → BYP`);
        result[phase] = 'BYP';
      }
    }
    
    return result;
  }
  
  /**
   * Retourne le coefficient de régulation selon l'état du commutateur
   */
  private getVoltageCoefficient(state: SRG2SwitchState, srg2: SRG2Config): number {
    switch (state) {
      case 'LO2': return srg2.coefficientLO2;
      case 'LO1': return srg2.coefficientLO1;
      case 'BO1': return srg2.coefficientBO1;
      case 'BO2': return srg2.coefficientBO2;
      default: return 0;
    }
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
