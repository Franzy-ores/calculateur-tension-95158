import { DailyProfileConfig, DailySimulationOptions, HourlyVoltageResult, HourlyProfile, SRG2HourlyActivation } from '@/types/dailyProfile';
import { Project, CalculationResult, SimulationEquipment, NeutralCompensator } from '@/types/network';
import { SRG2Config, SRG2SwitchState } from '@/types/srg2';
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
   * 
   * ARCHITECTURE SRG2 HEURE PAR HEURE:
   * - Passe 1: Calcul naturel (sans SRG2) pour obtenir les tensions au nœud SRG2
   * - Évaluation des seuils SRG2 pour déterminer l'état (BYP, LO1, LO2, BO1, BO2)
   * - Passe 2: Si SRG2 actif, recalcul avec régulation appliquée
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
        // === CALCUL SRG2 HEURE PAR HEURE ===
        const srg2Result = this.calculateWithHourlySRG2Evaluation(
          projectWithHourlyFoisonnement,
          this.simulationEquipment.srg2Devices.filter(s => s.enabled),
          this.simulationEquipment.neutralCompensators?.filter(c => c.enabled),
          this.simulationEquipment.cableReplacement
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
        evBonus
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
        evBonus
      );
    }
  }

  /**
   * Calcul en deux passes pour évaluation SRG2 heure par heure
   * 
   * PASSE 1: Calcul naturel (sans régulation SRG2)
   *   → Obtenir les tensions "naturelles" au nœud où le SRG2 est installé
   * 
   * ÉVALUATION: Pour chaque SRG2, déterminer l'état des commutateurs
   *   → Comparer tensions naturelles aux seuils LO2/LO1/BO1/BO2
   * 
   * PASSE 2: Si au moins un SRG2 est actif (pas en bypass)
   *   → Recalculer le réseau avec les régulations appliquées
   */
  private calculateWithHourlySRG2Evaluation(
    projectWithHourlyFoisonnement: Project,
    srg2Devices: SRG2Config[],
    neutralCompensators?: NeutralCompensator[],
    cableReplacement?: { enabled: boolean; targetCableTypeId: string; affectedCableIds: string[] }
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
    
    // === ÉVALUATION DES SRG2 ===
    const srg2States: SRG2HourlyActivation[] = [];
    let anySRG2Active = false;
    
    for (const srg2 of srg2Devices) {
      const activation = this.evaluateSRG2Activation(naturalResult, srg2, projectToUse.voltageSystem);
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
   * Détermine l'état du commutateur SRG2 selon la tension
   */
  private determineSRG2SwitchState(tension: number, srg2: SRG2Config): SRG2SwitchState {
    if (tension >= srg2.seuilLO2_V) return 'LO2';
    if (tension >= srg2.seuilLO1_V) return 'LO1';
    if (tension <= srg2.seuilBO2_V) return 'BO2';
    if (tension <= srg2.seuilBO1_V) return 'BO1';
    return 'BYP';
  }
  
  /**
   * Applique les contraintes SRG2-230 (pas de boost et lower simultanés sur phases différentes)
   */
  private applySRG230Constraints(
    states: { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState },
    tensions: { A: number; B: number; C: number },
    srg2: SRG2Config
  ): { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState } {
    if (srg2.type !== 'SRG2-230') return states;
    
    const hasBoost = states.A === 'BO1' || states.A === 'BO2' || 
                     states.B === 'BO1' || states.B === 'BO2' || 
                     states.C === 'BO1' || states.C === 'BO2';
    const hasLower = states.A === 'LO1' || states.A === 'LO2' || 
                     states.B === 'LO1' || states.B === 'LO2' || 
                     states.C === 'LO1' || states.C === 'LO2';
    
    if (hasBoost && hasLower) {
      // Conflit: garder le mode correspondant à l'écart le plus important
      const avgTension = (tensions.A + tensions.B + tensions.C) / 3;
      const consigne = srg2.tensionConsigne_V;
      
      if (avgTension > consigne) {
        // Privilégier LOWER (tensions trop hautes)
        return {
          A: (states.A === 'BO1' || states.A === 'BO2') ? 'BYP' : states.A,
          B: (states.B === 'BO1' || states.B === 'BO2') ? 'BYP' : states.B,
          C: (states.C === 'BO1' || states.C === 'BO2') ? 'BYP' : states.C
        };
      } else {
        // Privilégier BOOST (tensions trop basses)
        return {
          A: (states.A === 'LO1' || states.A === 'LO2') ? 'BYP' : states.A,
          B: (states.B === 'LO1' || states.B === 'LO2') ? 'BYP' : states.B,
          C: (states.C === 'LO1' || states.C === 'LO2') ? 'BYP' : states.C
        };
      }
    }
    
    return states;
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
