import {
  CalculationResult,
  Project,
  Node,
  Cable,
  CableType,
  CalculationScenario,
  TransformerConfig,
  LoadModel,
  NeutralCompensator,
  SimulationEquipment,
  SimulationResult,
  CableUpgrade,
  EQUI8Mode,
  EQUI8ThermalWindow,
} from '@/types/network';
import { SRG2Config, SRG2SimulationResult, SRG2SwitchState, DEFAULT_SRG2_400_CONFIG, DEFAULT_SRG2_230_CONFIG } from '@/types/srg2';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { Complex, C, add, sub, mul, div, abs, fromPolar, scale, normalize, arg } from '@/utils/complex';
import { SRG2Regulator, createSRG2Regulator, SRG2RegulationResult } from '@/utils/srg2Regulator';
import { getCircuitNodes } from '@/utils/networkConnectivity';
// ============================================================================
// @deprecated - Imports supprimés du module load-shift obsolète
// L'EQUI8 utilise maintenant exclusivement le mode CME (injection de courant)
// ============================================================================
import {
  computeEquivImpedancesToSource,
  computeCME_UtargetsAndI,
  buildEQUI8Injection,
  clampByThermal,
  adjustSecant,
  logEQUI8CMEMetrics,
  EQUI8_THERMAL_LIMITS,
  EQUI8CMEResult,
  EQUI8CalibrationResult,
} from '@/utils/equi8CME';

export class SimulationCalculator extends ElectricalCalculator {
  
  // Constantes de convergence séparées par type de tension
  private static readonly SIM_CONVERGENCE_TOLERANCE_PHASE_V = 0.1;  // Tension phase
  private static readonly SIM_CONVERGENCE_TOLERANCE_LINE_V = 0.17;   // Tension ligne (√3 × 0.1)
  public static readonly SIM_MAX_ITERATIONS = 100;
  private static readonly SIM_MAX_LOCAL_ITERATIONS = 50;
  private static readonly SIM_VOLTAGE_400V_THRESHOLD = 350;
  
  // Constantes pour le mode Forcé
  private static readonly PRODUCTION_DISCONNECT_VOLTAGE = 253;
  public static readonly CONVERGENCE_TOLERANCE_V = 0.01;
  
  private simCosPhi: number;
  
  // Note: L'EQUI8 recalcule dynamiquement ses ratios à chaque appel
  // à partir des tensions et courants ACTUELS du réseau (pas de stockage permanent)
  
  constructor(cosPhi: number = 0.95, cosPhiCharges?: number, cosPhiProductions?: number) {
    super(cosPhi, cosPhiCharges, cosPhiProductions);
    this.simCosPhi = Math.min(1, Math.max(0, cosPhi));
  }

  /**
   * Méthode publique pour l'algorithme de convergence du mode forcé
   * Utilise la nouvelle logique en 2 phases:
   * Phase 1: Calibration du foisonnement (mode nuit)
   * Phase 2: Convergence sur les répartitions de phases basées sur les tensions mesurées
   */
  public async runForcedModeConvergence(
    project: Project,
    measuredVoltages: { U1: number; U2: number; U3: number },
    measurementNodeId: string,
    sourceVoltage: number
  ): Promise<{ 
    result: CalculationResult | null;
    foisonnementCharges: number;
    desequilibrePourcent: number;
    voltageErrors?: { A: number; B: number; C: number };
    iterations?: number;
    convergenceStatus: 'converged' | 'not_converged';
    finalLoadDistribution?: { A: number; B: number; C: number };
    finalProductionDistribution?: { A: number; B: number; C: number };
    calibratedFoisonnementCharges?: number;
  }> {
    
    console.log('🚀 CALIBRATION ACTIVÉE - Début du mode forcé avec convergence complète');
    
    // Préparer les tensions mesurées
    const preparedVoltages = this.prepareMeasuredVoltages(measuredVoltages, project.voltageSystem);
    
    // Phase 1: Calibration du foisonnement des charges (mode nuit sans production)
    console.log('📊 Phase 1: Calibration du foisonnement des charges');
    const calibratedFoisonnement = this.calibrateFoisonnement(
      project,
      'FORCÉ',
      { targetVoltage: sourceVoltage, measuredVoltages: preparedVoltages, measurementNodeId },
      project.foisonnementCharges
    );
    
    console.log(`✅ Foisonnement calibré: ${calibratedFoisonnement.toFixed(1)}%`);
    
    // Phase 2: Convergence sur les répartitions de phases avec les tensions mesurées
    console.log('📊 Phase 2: Convergence sur les répartitions de phases');
    
    let iterations = 0;
    let converged = false;
    let currentDistribution = this.calculateImbalanceFromVoltages(preparedVoltages);
    let previousError = Infinity;
    
    while (!converged && iterations < 50) {
      iterations++;
      
      // Calculer avec les distributions actuelles
      const result = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        'FORCÉ',
        calibratedFoisonnement,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        currentDistribution,
        project.clientsImportes,
        project.clientLinks
      );
      
      // Récupérer les tensions calculées au nœud de mesure
      const measuredNode = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === measurementNodeId);
      if (!measuredNode?.voltagesPerPhase) {
        console.warn('⚠️ Impossible de trouver les tensions au nœud de mesure');
        break;
      }
      
      // Calculer les erreurs de tension par phase
      const voltageErrors = {
        A: Math.abs(measuredNode.voltagesPerPhase.A - preparedVoltages.U1),
        B: Math.abs(measuredNode.voltagesPerPhase.B - preparedVoltages.U2),
        C: Math.abs(measuredNode.voltagesPerPhase.C - preparedVoltages.U3)
      };
      
      const maxError = Math.max(voltageErrors.A, voltageErrors.B, voltageErrors.C);
      
      console.log(`🔄 Itération ${iterations}: Erreur max = ${maxError.toFixed(2)}V`);
      
      // Vérifier la convergence
      if (maxError < SimulationCalculator.CONVERGENCE_TOLERANCE_V || Math.abs(maxError - previousError) < 0.001) {
        converged = true;
        console.log('✅ Convergence atteinte');
        
        return {
          result,
          foisonnementCharges: calibratedFoisonnement,
          desequilibrePourcent: project.desequilibrePourcent || 0,
          voltageErrors,
          iterations,
          convergenceStatus: 'converged',
          finalLoadDistribution: currentDistribution.charges,
          finalProductionDistribution: currentDistribution.productions,
          calibratedFoisonnementCharges: calibratedFoisonnement
        };
      }
      
      // Ajuster les distributions basées sur les erreurs
      currentDistribution = this.calculateImbalanceFromVoltages({
        U1: measuredNode.voltagesPerPhase.A,
        U2: measuredNode.voltagesPerPhase.B,
        U3: measuredNode.voltagesPerPhase.C
      });
      previousError = maxError;
    }
    
    // Si pas de convergence après max iterations
    console.warn('⚠️ Convergence non atteinte après', iterations, 'itérations');
    
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      'FORCÉ',
      calibratedFoisonnement,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      currentDistribution
    );
    
    return {
      result: finalResult,
      foisonnementCharges: calibratedFoisonnement,
      desequilibrePourcent: project.desequilibrePourcent || 0,
      iterations,
      convergenceStatus: 'not_converged',
      finalLoadDistribution: currentDistribution.charges,
      finalProductionDistribution: currentDistribution.productions,
      calibratedFoisonnementCharges: calibratedFoisonnement
    };
  }
  
  /**
   * Calcule les pourcentages finaux de répartition par phase basés sur la distribution réelle
   */
  private calculateFinalDistribution(
    nodes: Node[], 
    type: 'charges' | 'productions',
    foisonnement: number,
    manualDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} }
  ): {A: number; B: number; C: number} {
    
    // Si une distribution manuelle est définie, l'utiliser
    if (manualDistribution) {
      const distribution = type === 'charges' ? manualDistribution.charges : manualDistribution.productions;
      return distribution;
    }
    
    // Sinon, calculer à partir de la répartition réelle des nœuds
    let totalA = 0, totalB = 0, totalC = 0;
    
    nodes.forEach(node => {
      const items = type === 'charges' ? node.clients : node.productions;
      if (!items || items.length === 0) return;
      
      const totalPower = items.reduce((sum, item) => sum + (item.S_kVA || 0), 0) * (foisonnement / 100);
      
      // Pour une vraie distribution, ici on devrait récupérer la répartition phase réelle
      // calculée par l'algorithme de flux de puissance.
      // Pour l'instant, distribution équilibrée mais cela devrait être amélioré
      // en récupérant les données des phases A, B, C calculées
      totalA += totalPower / 3;
      totalB += totalPower / 3;
      totalC += totalPower / 3;
    });
    
    const total = totalA + totalB + totalC;
    if (total === 0) return {A: 33.33, B: 33.33, C: 33.33};
    
    return {
      A: (totalA / total) * 100,
      B: (totalB / total) * 100,
      C: (totalC / total) * 100
    };
  }
  
  /**
   * Nouveau processus Mode Forcé en 2 étapes avec boucle de convergence intelligente du déséquilibre
   * Phase 1: Calibration du foisonnement (nuit)
   * Phase 2: Convergence sur déséquilibre (jour) avec ajustement des répartitions par phase
   */
  private runForcedModeSimulation(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment
  ): CalculationResult {
    const config = project.forcedModeConfig!;
    const sourceNode = project.nodes.find(n => n.isSource);
    
    // Gestion correcte de la tension de référence selon le système de tension
    let sourceVoltage = sourceNode?.tensionCible || 230;
    if (project.voltageSystem === 'TÉTRAPHASÉ_400V') {
      sourceVoltage = sourceNode?.tensionCible || 400;
      if (config.targetVoltage && config.targetVoltage <= 250) {
        // Tension cible en phase-neutre pour calibration
        sourceVoltage = config.targetVoltage;
      }
    }
    
    console.log('🚀 Mode FORCÉ ACTIVÉ: Simulation avec calibration et convergence complètes');
    
    // Phase 1: Calibration du foisonnement des charges (mode nuit sans production)
    console.log('📊 Phase 1: Calibration automatique du foisonnement');
    const calibratedFoisonnement = this.calibrateFoisonnement(
      project,
      scenario,
      config,
      project.foisonnementCharges
    );
    
    console.log(`✅ Foisonnement calibré: ${calibratedFoisonnement.toFixed(1)}%`);
    
    // Phase 2: Convergence sur les répartitions de phases avec mesures réelles
    console.log('📊 Phase 2: Ajustement des répartitions de phases');
    
    let iterations = 0;
    let converged = false;
    const preparedVoltages = this.prepareMeasuredVoltages(config.measuredVoltages, project.voltageSystem);
    let currentDistribution = this.calculateImbalanceFromVoltages(preparedVoltages);
    let previousError = Infinity;
    
    while (!converged && iterations < SimulationCalculator.SIM_MAX_LOCAL_ITERATIONS) {
      iterations++;
      
      // Calculer avec la distribution actuelle
      const result = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        calibratedFoisonnement,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        currentDistribution
      );
      
      // Vérifier les tensions au nœud de mesure
      const measuredNode = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === config.measurementNodeId);
      if (!measuredNode?.voltagesPerPhase) {
        console.warn('⚠️ Nœud de mesure non trouvé, arrêt de la convergence');
        converged = true;
        break;
      }
      
      // Calculer l'erreur de tension
      const voltageErrors = {
        A: Math.abs(measuredNode.voltagesPerPhase.A - preparedVoltages.U1),
        B: Math.abs(measuredNode.voltagesPerPhase.B - preparedVoltages.U2),
        C: Math.abs(measuredNode.voltagesPerPhase.C - preparedVoltages.U3)
      };
      
      const maxError = Math.max(voltageErrors.A, voltageErrors.B, voltageErrors.C);
      
      console.log(`🔄 Itération ${iterations}: Erreur max = ${maxError.toFixed(2)}V`);
      
      // Vérifier la convergence (erreur < 1V)
      if (maxError < 1.0 || Math.abs(maxError - previousError) < 0.01) {
        converged = true;
        console.log('✅ Convergence atteinte');
        break;
      }
      
      // Ajuster les distributions pour la prochaine itération
      currentDistribution = this.calculateImbalanceFromVoltages({
        U1: measuredNode.voltagesPerPhase.A,
        U2: measuredNode.voltagesPerPhase.B,
        U3: measuredNode.voltagesPerPhase.C
      });
      previousError = maxError;
    }
    
    // Calcul final avec les paramètres convergés
    const finalResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      calibratedFoisonnement,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      currentDistribution,
      project.clientsImportes,
      project.clientLinks
    );
    
    const convergenceResult = {
      result: finalResult,
      converged,
      finalDistribution: currentDistribution,
      iterations,
      maxError: previousError
    };
    
    // Mise à jour finale dans l'interface
    const finalUpdateEvent = new CustomEvent('updateProjectFoisonnement', { 
      detail: { 
        foisonnementCharges: calibratedFoisonnement,
        foisonnementProductions: 100,
        finalDistribution: convergenceResult.finalDistribution,
        keepSliderEnabled: true
      } 
    });
    window.dispatchEvent(finalUpdateEvent);
    
    // Retourner le résultat avec toutes les informations de convergence
    return {
      ...convergenceResult.result,
      convergenceStatus: convergenceResult.converged ? 'converged' : 'not_converged',
      finalLoadDistribution: convergenceResult.finalDistribution.charges,
      finalProductionDistribution: convergenceResult.finalDistribution.productions,
      calibratedFoisonnementCharges: calibratedFoisonnement,
      optimizedPhaseDistribution: convergenceResult.finalDistribution
    } as CalculationResult;
  }

  /**
   * Prépare les tensions mesurées selon le système de tension
   */
  private prepareMeasuredVoltages(
    measuredVoltages: { U1: number; U2: number; U3: number },
    voltageSystem: string
  ): { U1: number; U2: number; U3: number } {
    let { U1, U2, U3 } = measuredVoltages;
    
    if (voltageSystem === 'TÉTRAPHASÉ_400V') {
      // En mode 400V: les 3 tensions sont obligatoires
      if (!U1 || !U2 || !U3 || U1 <= 0 || U2 <= 0 || U3 <= 0) {
        console.warn('⚠️ En mode 400V, les trois tensions mesurées sont obligatoires');
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    } else {
      // En mode 230V: estimation de la tension manquante par la moyenne des deux autres
      const validVoltages = [U1, U2, U3].filter(v => v && v > 0);
      
      if (validVoltages.length === 2) {
        const averageVoltage = validVoltages.reduce((sum, v) => sum + v, 0) / validVoltages.length;
        
        if (!U1 || U1 <= 0) U1 = averageVoltage;
        if (!U2 || U2 <= 0) U2 = averageVoltage;
        if (!U3 || U3 <= 0) U3 = averageVoltage;
        
        console.log(`📊 Tension manquante estimée par moyenne: ${averageVoltage.toFixed(1)}V`);
      } else if (validVoltages.length < 2) {
        console.warn('⚠️ Au moins 2 tensions mesurées sont requises en mode 230V');
        U1 = U1 > 0 ? U1 : 230;
        U2 = U2 > 0 ? U2 : 230;
        U3 = U3 > 0 ? U3 : 230;
      }
    }
    
    return { U1, U2, U3 };
  }

  /**
   * Calibration du foisonnement des charges (Phase 1)
   * Utilise une recherche binaire pour trouver le foisonnement optimal basé sur la tension cible
   */
  private calibrateFoisonnement(
    project: Project,
    scenario: CalculationScenario,
    config: any,
    initialFoisonnement: number
  ): number {
    console.log('🔧 Calibration du foisonnement en cours...');
    
    const targetVoltage = config.targetVoltage || 230;
    const measurementNodeId = config.measurementNodeId;
    
    if (!measurementNodeId) {
      console.warn('⚠️ Pas de nœud de mesure défini, utilisation du foisonnement initial');
      return initialFoisonnement;
    }
    
    let bestFoisonnement = initialFoisonnement;
    let minDiff = Infinity;
    
    // Recherche du foisonnement optimal entre 50% et 150%
    const foisonnementMin = 50;
    const foisonnementMax = 150;
    const step = 5;
    
    console.log(`🎯 Recherche du foisonnement optimal pour tension cible: ${targetVoltage}V`);
    
    for (let f = foisonnementMin; f <= foisonnementMax; f += step) {
      // Calculer avec ce foisonnement
      const result = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        f,
        0, // Pas de production en mode nuit
        project.transformerConfig,
        project.loadModel,
        0, // Pas de déséquilibre en mode nuit
        { charges: { A: 33.33, B: 33.33, C: 33.33 }, productions: { A: 33.33, B: 33.33, C: 33.33 } }
      );
      
      // Récupérer la tension moyenne au nœud de mesure
      const measuredNode = result.nodeMetricsPerPhase?.find(nm => nm.nodeId === measurementNodeId);
      if (measuredNode?.voltagesPerPhase) {
        const avgVoltage = (measuredNode.voltagesPerPhase.A + measuredNode.voltagesPerPhase.B + measuredNode.voltagesPerPhase.C) / 3;
        const diff = Math.abs(avgVoltage - targetVoltage);
        
        if (diff < minDiff) {
          minDiff = diff;
          bestFoisonnement = f;
        }
        
        console.log(`  f=${f}%: tension=${avgVoltage.toFixed(1)}V, diff=${diff.toFixed(2)}V`);
      }
    }
    
    console.log(`✅ Foisonnement optimal trouvé: ${bestFoisonnement}% (erreur: ${minDiff.toFixed(2)}V)`);
    
    return bestFoisonnement;
  }

  /**
   * Calcule directement les répartitions de productions par phase à partir des tensions mesurées
   */
  private calculateImbalanceFromVoltages(
    measuredVoltages: { U1: number; U2: number; U3: number }
  ): { charges: { A: number; B: number; C: number }, productions: { A: number; B: number; C: number }, constraints: { min: number; max: number; total: number } } {
    
    const { U1, U2, U3 } = measuredVoltages;
    console.log(`📊 Phase 2: Calcul déséquilibre productions à partir des tensions U1=${U1}V, U2=${U2}V, U3=${U3}V`);
    
    // Trouver la tension minimale comme référence
    const minVoltage = Math.min(U1, U2, U3);
    
    // Calculer les surélévations de tension par rapport au minimum
    const voltageElevations = {
      A: U1 - minVoltage,
      B: U2 - minVoltage, 
      C: U3 - minVoltage
    };
    
    console.log(`  Surélévations de tension: A=${voltageElevations.A.toFixed(1)}V, B=${voltageElevations.B.toFixed(1)}V, C=${voltageElevations.C.toFixed(1)}V`);
    
    // Les phases avec plus de surélévation ont plus de production
    const totalElevations = voltageElevations.A + voltageElevations.B + voltageElevations.C;
    
    let productions = { A: 33.33, B: 33.33, C: 33.33 };
    
    if (totalElevations > 0) {
      // Répartition basée sur les surélévations de tension (plus de surélévation = plus de production)
      const basePercentage = 100 / 3; // 33.33%
      const elevationWeights = {
        A: voltageElevations.A / totalElevations,
        B: voltageElevations.B / totalElevations,
        C: voltageElevations.C / totalElevations
      };
      
      // Ajuster par rapport à la répartition équilibrée
      productions = {
        A: basePercentage + (elevationWeights.A - 1/3) * 100,
        B: basePercentage + (elevationWeights.B - 1/3) * 100, 
        C: basePercentage + (elevationWeights.C - 1/3) * 100
      };
      
      // S'assurer que ça somme à 100%
      const total = productions.A + productions.B + productions.C;
      productions.A = (productions.A / total) * 100;
      productions.B = (productions.B / total) * 100;
      productions.C = (productions.C / total) * 100;
    }
    
    console.log(`  Répartitions productions calculées: A=${productions.A.toFixed(1)}%, B=${productions.B.toFixed(1)}%, C=${productions.C.toFixed(1)}%`);
    
    return {
      charges: { A: 33.33, B: 33.33, C: 33.33 }, // Charges équilibrées
      productions,
      constraints: { min: 10, max: 80, total: 100 }
    };
  }

  /**
   * Calcule un scénario avec équipements de simulation
   * @param calculationResults - Résultats de calcul existants pour lecture des tensions naturelles (optionnel)
   */
  calculateWithSimulation(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment,
    calculationResults?: { [key: string]: CalculationResult }
  ): SimulationResult {
    // Vérifier si on a un remplacement de câbles actif
    const cableReplacement = equipment.cableReplacement;
    let projectToUse = project;
    
    if (cableReplacement?.enabled && cableReplacement.affectedCableIds.length > 0) {
      // Créer une copie du projet avec les câbles remplacés
      projectToUse = this.applyProjectCableReplacement(project, cableReplacement);
      console.log(`🔄 Remplacement de câbles appliqué: ${cableReplacement.affectedCableIds.length} câbles -> ${cableReplacement.targetCableTypeId}`);
    }
    
    // D'abord calculer le scénario de base (sans équipements)
    let baselineResult: CalculationResult;
    
    if (scenario === 'FORCÉ' && projectToUse.forcedModeConfig) {
      // Mode forcé : utiliser le nouveau processus en 2 étapes
      baselineResult = this.runForcedModeSimulation(projectToUse, scenario, equipment);
    } else {
      // Autres modes : baseline normal avec foisonnements différenciés
      baselineResult = this.calculateScenario(
        projectToUse.nodes,
        projectToUse.cables,
        projectToUse.cableTypes,
        scenario,
        projectToUse.foisonnementChargesResidentiel ?? projectToUse.foisonnementCharges,
        projectToUse.foisonnementProductions,
        projectToUse.transformerConfig,
        projectToUse.loadModel,
        projectToUse.desequilibrePourcent,
        projectToUse.manualPhaseDistribution,
        projectToUse.clientsImportes,
        projectToUse.clientLinks,
        projectToUse.foisonnementChargesResidentiel,
        projectToUse.foisonnementChargesIndustriel
      );
    }

    // Ensuite calculer avec les équipements de simulation actifs
    // Passer calculationResults pour lecture directe des tensions naturelles
    const simulationResult = this.calculateScenarioWithEquipment(
      projectToUse,
      scenario,
      equipment,
      calculationResults
    );

    console.log('🎯 SRG2 simulation terminée - nettoyage des marqueurs maintenant');
    // Nettoyage des marqueurs SRG2 après calcul final et utilisation des résultats
    this.cleanupSRG2Markers(projectToUse.nodes);

    return {
      ...simulationResult,
      isSimulation: true,
      equipment,
      baselineResult,
      convergenceStatus: (simulationResult as any).convergenceStatus || (baselineResult as any).convergenceStatus
    };
  }
  
  /**
   * Applique le remplacement de câbles à un projet (crée une copie modifiée)
   */
  private applyProjectCableReplacement(
    project: Project,
    cableReplacement: { targetCableTypeId: string; affectedCableIds: string[] }
  ): Project {
    const modifiedCables = project.cables.map(cable => {
      if (cableReplacement.affectedCableIds.includes(cable.id)) {
        return {
          ...cable,
          typeId: cableReplacement.targetCableTypeId
        };
      }
      return cable;
    });
    
    return {
      ...project,
      cables: modifiedCables
    };
  }

  /**
   * Calcule un scénario en intégrant les équipements de simulation avec mode itératif pour SRG2 et compensateurs
   * @param calculationResults - Résultats de calcul existants pour lecture des tensions naturelles (optionnel)
   */
  private calculateScenarioWithEquipment(
    project: Project,
    scenario: CalculationScenario,
    equipment: SimulationEquipment,
    calculationResults?: { [key: string]: CalculationResult }
  ): CalculationResult {
    
    // Détection des équipements actifs
    const activeSRG2 = equipment.srg2Devices?.filter(srg2 => srg2.enabled) || [];
    const activeCompensators = equipment.neutralCompensators?.filter(c => c.enabled) || [];
    
    // ✅ PROTECTION : Détecter conflit SRG2 + EQUI8 sur même nœud
    const conflictNodes = activeSRG2
      .filter(srg2 => activeCompensators.some(eq => eq.nodeId === srg2.nodeId))
      .map(srg2 => srg2.nodeId);
    
    if (conflictNodes.length > 0) {
      console.warn(`⚠️ CONFLIT: SRG2 et EQUI8 sur même(s) nœud(s): ${conflictNodes.join(', ')}`);
      console.warn(`   → EQUI8 désactivé sur ces nœuds (SRG2 prioritaire pour régulation de tension)`);
      // Filtrer les EQUI8 en conflit (SRG2 prioritaire)
      const filteredCompensators = activeCompensators.filter(
        eq => !conflictNodes.includes(eq.nodeId)
      );
      // Remplacer activeCompensators par la version filtrée
      activeCompensators.length = 0;
      activeCompensators.push(...filteredCompensators);
    }
    
    // Cas 1: Aucun équipement actif → calcul normal avec foisonnements différenciés
    if (activeSRG2.length === 0 && activeCompensators.length === 0) {
      return this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        project.foisonnementChargesResidentiel ?? project.foisonnementCharges,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        project.manualPhaseDistribution,
        project.clientsImportes,
        project.clientLinks,
        project.foisonnementChargesResidentiel,
        project.foisonnementChargesIndustriel
      );
    }
    
    // Cas 2: Uniquement SRG2 → passer calculationResults pour lecture tensions naturelles
    if (activeSRG2.length > 0 && activeCompensators.length === 0) {
      return this.calculateWithSRG2Regulation(
        project,
        scenario,
        activeSRG2,
        calculationResults
      );
    }
    
    // Cas 3: Uniquement compensateurs → choisir selon le mode
    if (activeSRG2.length === 0 && activeCompensators.length > 0) {
      // Vérifier le mode du premier compensateur (on suppose tous du même mode)
      const mode: EQUI8Mode = activeCompensators[0].mode || 'CME';
      
      if (mode === 'CME') {
        console.log(`🔧 EQUI8 Mode CME: Injection de courant shunt`);
        return this.calculateWithEQUI8_CME(
          project,
          scenario,
          activeCompensators,
          calculationResults
        );
      } else {
        // ============================================================================
        // @deprecated - Mode LOAD_SHIFT supprimé
        // En mode CME, l'EQUI8 agit comme une source de courant shunt, pas via
        // redistribution de charges. Le mode LOAD_SHIFT est désactivé.
        // ============================================================================
        console.warn(`⚠️ EQUI8 Mode LOAD_SHIFT est déprécié. Basculement vers CME.`);
        return this.calculateWithEQUI8_CME(
          project,
          scenario,
          activeCompensators,
          calculationResults
        );
      }
    }
    
    // Cas 4: Les deux actifs → boucle de convergence globale SRG2 + EQUI8
    return this.calculateWithCombinedSRG2AndEQUI8(
      project,
      scenario,
      activeSRG2,
      activeCompensators,
      calculationResults
    );
  }

  /**
   * ============================================================================
   * SIMULATION COUPLÉE SRG2 + EQUI8
   * ============================================================================
   * 
   * 🧠 PRINCIPE PHYSIQUE IMPÉRATIF:
   * L'EQUI8 agit en PERMANENCE et modifie la répartition des charges AVANT que
   * le SRG2 ne prenne sa décision. C'est une boucle fermée.
   * 
   * Le SRG2 ne doit JAMAIS être exécuté sur le réseau brut, mais uniquement
   * sur le réseau déjà équilibré par l'EQUI8.
   * 
   * 🔁 LOGIQUE DE COUPLAGE:
   * Boucle itérative qui respecte l'ordre réel:
   *   Réseau → EQUI8 → SRG2 → modification tension source → Réseau → ...
   *   jusqu'à stabilisation.
   * 
   * 🧮 CRITÈRE DE CONVERGENCE:
   * - Le SRG2 ne demande plus de changement de prise (tap_change == 0)
   * - ET la variation de tension moyenne entre deux itérations < 0.5V
   * 
   * Cette fonction reproduit l'interaction réelle observée sur un réseau BT
   * équipé des deux systèmes par une simulation itérative séquentielle.
   * ============================================================================
   */
  private calculateWithCombinedSRG2AndEQUI8(
    project: Project,
    scenario: CalculationScenario,
    srg2Devices: SRG2Config[],
    compensators: NeutralCompensator[],
    calculationResults?: { [key: string]: CalculationResult }
  ): CalculationResult {
    
    console.log(`🔧 SIMULATION COUPLÉE SRG2+EQUI8 (${srg2Devices.length} SRG2, ${compensators.length} EQUI8)`);
    console.log(`   ⚡ Principe: Réseau → EQUI8 équilibre → SRG2 décide sur réseau équilibré → itération`);
    
    const MAX_COUPLED_ITERATIONS = 10;
    let iteration = 0;
    let tapChange = true; // Force première itération
    let converged = false;
    
    // Copie de travail du projet pour les modifications de tension source
    let workingProject = JSON.parse(JSON.stringify(project)) as Project;
    let currentBaselineResults = calculationResults;
    
    // Résultats intermédiaires
    let networkEq: CalculationResult | null = null;
    let lastTapPosition: Map<string, { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }> = new Map();
    
    // Créer les instances SRG2Regulator (persistent across iterations for tap memory)
    const srg2Regulators = new Map<string, SRG2Regulator>();
    for (const srg2 of srg2Devices) {
      srg2Regulators.set(srg2.id, createSRG2Regulator(
        srg2.nodeId,
        workingProject.voltageSystem as 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V',
        srg2
      ));
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // BOUCLE PRINCIPALE : simulateCoupledSRG2Equi8
    // Principe: Le SRG2 corrige la tension d'un réseau DÉJÀ équilibré par l'EQUI8.
    // L'EQUI8 est recalculé FRAIS à chaque itération (pas de mémoire/ratios).
    // Critère d'arrêt: tap_change == 0 → stop (pas de critère tension)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    while (iteration < MAX_COUPLED_ITERATIONS) {
      iteration++;
      console.log(`\n🔄 === ITÉRATION COUPLÉE ${iteration}/${MAX_COUPLED_ITERATIONS} ===`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 1: L'EQUI8 agit en MODE CME (injection de courant shunt)
      // simulate_equi8_cme(network) → network_eq
      // L'EQUI8 équilibre les phases AVANT que le SRG2 ne prenne sa décision.
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      console.log(`  📊 Étape 1: EQUI8 CME - Injection courant shunt`);
      networkEq = this.calculateWithEQUI8_CME(
        workingProject,
        scenario,
        compensators,
        currentBaselineResults
      );
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 2: Calculer la tension moyenne vue par le SRG2 sur réseau équilibré
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let Umean = 0;
      const srg2VoltagesAfterEQUI8 = new Map<string, { A: number; B: number; C: number }>();
      
      for (const srg2 of srg2Devices) {
        const nodeMetrics = networkEq.nodeMetricsPerPhase?.find(nm =>
          String(nm.nodeId) === String(srg2.nodeId)
        );
        
        if (nodeMetrics?.voltagesPerPhase) {
          const { A, B, C } = nodeMetrics.voltagesPerPhase;
          srg2VoltagesAfterEQUI8.set(srg2.nodeId, { A, B, C });
          Umean = (A + B + C) / 3;
          console.log(`  📈 SRG2 ${srg2.nodeId} voit réseau ÉQUILIBRÉ: ` +
            `A=${A.toFixed(1)}V, B=${B.toFixed(1)}V, C=${C.toFixed(1)}V → Umean=${Umean.toFixed(1)}V`);
        }
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 3: Le SRG2 DÉCIDE sur ce réseau équilibré
      // simulate_srg2(network_eq, srg2_settings) → tap_change
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      console.log(`  📊 Étape 2: SRG2 - Décision de régulation sur réseau équilibré`);
      tapChange = false;
      
      for (const srg2 of srg2Devices) {
        const nodeVoltages = srg2VoltagesAfterEQUI8.get(srg2.nodeId) || { A: 230, B: 230, C: 230 };
        
        // Appliquer la régulation SRG2 (décision basée sur réseau équilibré)
        const regulationResult = this.applySRG2Regulation(srg2, nodeVoltages, workingProject.voltageSystem);
        
        // Détecter si le SRG2 demande un changement de prise
        const previousTap = lastTapPosition.get(srg2.nodeId);
        const currentTap = regulationResult.etatCommutateur;
        
        if (currentTap) {
          if (!previousTap ||
              previousTap.A !== currentTap.A ||
              previousTap.B !== currentTap.B ||
              previousTap.C !== currentTap.C) {
            tapChange = true;
            console.log(`  🔧 SRG2 ${srg2.nodeId} CHANGE DE PRISE: ` +
              `${previousTap ? `${previousTap.A}/${previousTap.B}/${previousTap.C}` : 'INIT'} → ` +
              `${currentTap.A}/${currentTap.B}/${currentTap.C}`);
          }
          lastTapPosition.set(srg2.nodeId, { ...currentTap });
        }
        
        // Mettre à jour les informations du SRG2
        srg2.tensionEntree = regulationResult.tensionEntree;
        srg2.etatCommutateur = regulationResult.etatCommutateur;
        srg2.coefficientsAppliques = regulationResult.coefficientsAppliques;
        srg2.tensionSortie = regulationResult.tensionSortie;
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // [M1] ÉTAPE 3b: APPLIQUER LES TENSIONS SÉRIE SRG2 AUX CÂBLES
      // Le SRG2 injecte une tension série dans la branche (V_v = V_u - Z*I + V_série)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const iterationCables = JSON.parse(JSON.stringify(workingProject.cables)) as Cable[];
      for (const srg2 of srg2Devices) {
        if (srg2.coefficientsAppliques && srg2.tensionEntree) {
          this.applySRG2SerieVoltage(iterationCables, srg2, srg2.tensionEntree, srg2.coefficientsAppliques);
          console.log(`  📌 SRG2 ${srg2.nodeId} V_série: coeffs=${JSON.stringify(srg2.coefficientsAppliques)}`);
        }
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 4: Recalculer avec EQUI8 CME + SRG2 (tension série) appliqués
      // Ce résultat sera la baseline pour l'itération suivante
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const srg2AppliedResult = this.calculateScenario(
        workingProject.nodes,
        iterationCables,
        workingProject.cableTypes,
        scenario,
        workingProject.foisonnementChargesResidentiel ?? workingProject.foisonnementCharges,
        workingProject.foisonnementProductions,
        workingProject.transformerConfig,
        workingProject.loadModel,
        workingProject.desequilibrePourcent,
        workingProject.manualPhaseDistribution,
        workingProject.clientsImportes,
        workingProject.clientLinks,
        workingProject.foisonnementChargesResidentiel,
        workingProject.foisonnementChargesIndustriel,
        networkEq.equi8Injections // Réutiliser les injections EQUI8 calibrées
      );
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 5: Vérification stabilité (automate à seuil)
      // Critère d'arrêt: tap_change == 0 → stop (pas de critère tension)
      // Le SRG2 est un automate à seuil, pas un régulateur PID
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (!tapChange) {
        console.log(`  ✅ CONVERGENCE ATTEINTE: tap_change == 0 (automate stabilisé)`);
        converged = true;
        break;
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 6: Basculer la baseline sur l'état "EQUI8 + SRG2 APPLIQUÉS"
      // La prochaine itération verra le réseau avec les effets combinés
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      currentBaselineResults = { [scenario]: srg2AppliedResult };
      workingProject = { ...workingProject, cables: iterationCables };
      console.log(`  🔄 Baseline mise à jour: EQUI8 CME + SRG2 (tension série) conjointement`);
    }
    
    if (!converged) {
      console.warn(`⚠️ COUPLAGE SRG2+EQUI8: Convergence non atteinte après ${MAX_COUPLED_ITERATIONS} itérations`);
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ÉTAPE FINALE: Calcul BFS avec EQUI8 CME + coefficients SRG2
    // Les deux effets sont appliqués SIMULTANÉMENT pour cohérence des tensions
    // ✅ CORRECTION: Injections EQUI8 passées au calculateScenario final
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`\n  📊 Étape finale: Équilibrage EQUI8 final + application coefficients SRG2`);
    
    // 1. Recalculer avec EQUI8 CME pour obtenir les injections calibrées
    const equi8FinalResult = networkEq || this.calculateWithEQUI8_CME(
      workingProject,
      scenario,
      compensators,
      currentBaselineResults
    );
    
    // 2. Récupérer les injections EQUI8 calibrées du résultat CME
    const equi8FinalInjections = equi8FinalResult.equi8Injections || new Map();
    
    console.log(`   📤 Injections EQUI8 calibrées récupérées: ${equi8FinalInjections.size} compensateur(s)`);
    if (equi8FinalInjections.size > 0) {
      for (const [nodeId, injection] of equi8FinalInjections.entries()) {
        console.log(`      - Nœud ${nodeId}: I_inj=${injection.magnitude.toFixed(2)}A`);
      }
    }
    
    // 3. Préparer les câbles avec les tensions série SRG2
    const finalCables = JSON.parse(JSON.stringify(workingProject.cables)) as Cable[];
    
    for (const srg2 of srg2Devices) {
      if (srg2.coefficientsAppliques && srg2.tensionEntree) {
        this.applySRG2SerieVoltage(finalCables, srg2, srg2.tensionEntree, srg2.coefficientsAppliques);
      }
    }
    
    // 4. Calcul final avec EQUI8 (courant shunt) + SRG2 (tension série) actifs simultanément
    // ✅ Les injections EQUI8 et tensions série SRG2 sont passées au BFS pour calcul cohérent
    const finalResult = this.calculateScenario(
      workingProject.nodes,
      finalCables,
      workingProject.cableTypes,
      scenario,
      workingProject.foisonnementChargesResidentiel ?? workingProject.foisonnementCharges,
      workingProject.foisonnementProductions,
      workingProject.transformerConfig,
      workingProject.loadModel,
      workingProject.desequilibrePourcent,
      workingProject.manualPhaseDistribution,
      workingProject.clientsImportes,
      workingProject.clientLinks,
      workingProject.foisonnementChargesResidentiel,
      workingProject.foisonnementChargesIndustriel,
      equi8FinalInjections // ✅ Injections EQUI8 CME incluses dans le calcul final
    );
    
    console.log(`\n✅ SIMULATION COUPLÉE TERMINÉE:`);
    console.log(`   - Modèle: EQUI8 (courant shunt) + SRG2 (tension série)`);
    console.log(`   - Itérations: ${iteration}`);
    console.log(`   - Convergence: ${converged ? 'OUI' : 'NON'}`);
    console.log(`   - Position prise finale: ${Array.from(lastTapPosition.entries()).map(
      ([id, tap]) => `${id}: ${tap.A}/${tap.B}/${tap.C}`
    ).join(', ')}`);
    
    // Construire le résultat final avec les métadonnées SRG2
    return {
      ...finalResult,
      // Ajouter les résultats SRG2
      srg2Results: srg2Devices.map(srg2 => ({
        srg2Id: srg2.id,
        nodeId: srg2.nodeId,
        tensionAvant_V: srg2.tensionEntree?.A || 0,
        tensionApres_V: srg2.tensionSortie?.A || 0,
        puissanceReactive_kVAr: 0,
        ameliorationTension_V: (srg2.tensionSortie?.A || 0) - (srg2.tensionEntree?.A || 0),
        erreurRésiduelle_V: Math.abs((srg2.tensionSortie?.A || 0) - 230),
        efficacite_percent: Math.min(100, Math.max(0, (1 - Math.abs((srg2.tensionSortie?.A || 0) - 230) / 230) * 100)),
        tauxCharge_percent: 0,
        regulationActive: srg2.etatCommutateur?.A !== 'BYP',
        saturePuissance: false,
        convergence: converged
      })),
      convergenceStatus: converged ? 'converged' : 'not_converged',
      iterations: iteration
    } as CalculationResult & {
      srg2Results: SRG2SimulationResult[];
      convergenceStatus: 'converged' | 'not_converged';
      iterations: number;
    };
  }

  /**
   * Variante de calculateWithSRG2Regulation pour le mode combiné SRG2+EQUI8
   * Utilise les tensions naturelles passées en paramètre pour la décision de régulation
   * au lieu de les lire depuis calculationResults (qui contient les tensions post-EQUI8)
   */
  private calculateWithSRG2RegulationCombined(
    project: Project,
    scenario: CalculationScenario,
    srg2Devices: SRG2Config[],
    calculationResults: { [key: string]: CalculationResult },
    naturalVoltagesForRegulation: Map<string, {A: number, B: number, C: number}>
  ): CalculationResult {
    console.log(`🔍 calculateWithSRG2RegulationCombined - Régulation basée sur tensions NATURELLES`);
    
    let iteration = 0;
    let converged = false;
    let previousVoltages: Map<string, {A: number, B: number, C: number}> = new Map();
    
    // Copie des nœuds pour modification itérative
    const workingNodes = JSON.parse(JSON.stringify(project.nodes)) as Node[];
    
    // ✅ Utiliser les tensions naturelles passées en paramètre (pas celles de calculationResults)
    const originalVoltages = naturalVoltagesForRegulation;
    
    console.log(`[DEBUG SRG2 Combined] Tensions naturelles utilisées:`, 
      Array.from(originalVoltages.entries()).map(([id, v]) => 
        `${id}: A=${v.A.toFixed(1)}V, B=${v.B.toFixed(1)}V, C=${v.C.toFixed(1)}V`
      )
    );
    
    while (!converged && iteration < SimulationCalculator.SIM_MAX_ITERATIONS) {
      iteration++;
      
      // Nettoyer les modifications SRG2 précédentes
      if (iteration > 1) {
        this.cleanupSRG2Markers(workingNodes);
      }
      
      // Calculer le scénario avec l'état actuel des nœuds
      const result = this.calculateScenario(
        workingNodes,
        project.cables,
        project.cableTypes,
        scenario,
        project.foisonnementCharges,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        project.manualPhaseDistribution,
        project.clientsImportes,
        project.clientLinks,
        project.foisonnementChargesResidentiel,
        project.foisonnementChargesIndustriel
      );

      // Appliquer la régulation SRG2 sur chaque dispositif
      const voltageChanges = new Map<string, {A: number, B: number, C: number}>();
      
      for (const srg2 of srg2Devices) {
        const nodeIndex = workingNodes.findIndex(n => n.id === srg2.nodeId);
        if (nodeIndex === -1) continue;
        
        const srg2Node = workingNodes.find(n => n.id === srg2.nodeId);
        if (!srg2Node) continue;

        // ✅ Utiliser les tensions NATURELLES (avant EQUI8) pour la régulation
        let nodeVoltages = originalVoltages.get(srg2.nodeId) || { A: 230, B: 230, C: 230 };
        
        console.log(`🔍 SRG2 ${srg2.nodeId} (Combined): utilisation tensions NATURELLES - ` +
          `A=${nodeVoltages.A.toFixed(1)}V, B=${nodeVoltages.B.toFixed(1)}V, C=${nodeVoltages.C.toFixed(1)}V`);

        // Appliquer la régulation SRG2 sur les tensions naturelles
        const regulationResult = this.applySRG2Regulation(srg2, nodeVoltages, project.voltageSystem);
        
        // Stocker les coefficients de régulation pour ce nœud
        if (regulationResult.coefficientsAppliques) {
          voltageChanges.set(srg2.nodeId, regulationResult.coefficientsAppliques);
          
          // Mettre à jour les informations du SRG2
          srg2.tensionEntree = regulationResult.tensionEntree;
          srg2.etatCommutateur = regulationResult.etatCommutateur;
          srg2.coefficientsAppliques = regulationResult.coefficientsAppliques;
          srg2.tensionSortie = regulationResult.tensionSortie;
        }
      }
      
      // Appliquer les coefficients et tensions de sortie SRG2 aux nœuds
      for (const srg2 of srg2Devices) {
        const coefficients = voltageChanges.get(srg2.nodeId);
        if (coefficients && srg2.tensionSortie) {
          this.applySRG2Coefficients(workingNodes, srg2, coefficients, srg2.tensionSortie);
        }
      }
      
      // Vérifier la convergence
      converged = this.checkSRG2Convergence(voltageChanges, previousVoltages);
      previousVoltages = new Map(voltageChanges);
      
      console.log(`🔄 SRG2 Combined Iteration ${iteration}: ${converged ? 'Convergé' : 'En cours...'}`);
    }
    
    // Recalculer une dernière fois avec les tensions finales
    const finalResult = this.calculateScenario(
      workingNodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      project.manualPhaseDistribution,
      project.clientsImportes,
      project.clientLinks,
      project.foisonnementChargesResidentiel,
      project.foisonnementChargesIndustriel
    );

    console.log('🎯 SRG2 Combined: calcul terminé - régulation basée sur tensions naturelles');

    return {
      ...finalResult,
      srg2Results: srg2Devices.map(srg2 => ({
        srg2Id: srg2.id,
        nodeId: srg2.nodeId,
        tensionAvant_V: srg2.tensionEntree?.A || 0,
        tensionApres_V: srg2.tensionSortie?.A || 0,
        puissanceReactive_kVAr: 0,
        ameliorationTension_V: (srg2.tensionSortie?.A || 0) - (srg2.tensionEntree?.A || 0),
        erreurRésiduelle_V: Math.abs((srg2.tensionSortie?.A || 0) - 230),
        efficacite_percent: Math.min(100, Math.max(0, (1 - Math.abs((srg2.tensionSortie?.A || 0) - 230) / 230) * 100)),
        tauxCharge_percent: 0,
        regulationActive: srg2.etatCommutateur?.A !== 'BYP',
        saturePuissance: false,
        convergence: converged
      })),
      convergenceStatus: converged ? 'converged' : 'not_converged',
      iterations: iteration
    } as CalculationResult & {
      srg2Results: SRG2SimulationResult[];
      convergenceStatus: 'converged' | 'not_converged';
      iterations: number;
    };
  }

  /**
   * Calcule les ratios de compensation EQUI8 basés sur les tensions naturelles
   * Ces ratios sont ensuite figés pour toutes les itérations
   * Conforme à la documentation officielle CME Transformateur
   * 
   * Note: L'EQUI8 injecte un courant UNIQUE dans le neutre qui modifie le
   * potentiel du neutre, affectant ainsi toutes les tensions phase-neutre.
   */
  private computeEQUI8CompensationRatio(
    Uinit_ph1: number,
    Uinit_ph2: number,
    Uinit_ph3: number,
    Zph: number,
    Zn: number
  ): {
    ratio_ph1: number;
    ratio_ph2: number;
    ratio_ph3: number;
    Umoy_init: number;
    ecart_init: number;    // ✅ NOUVEAU - écart initial stocké
    ecart_equi8: number;
    Uinit_ph1: number;     // ✅ NOUVEAU - tension initiale stockée
    Uinit_ph2: number;     // ✅ NOUVEAU
    Uinit_ph3: number;     // ✅ NOUVEAU
  } {
    // Clamper les impédances à la condition CME (≥ 0,15Ω)
    const Zph_eff = Math.max(0.15, Zph);
    const Zn_eff = Math.max(0.15, Zn);
    
    if (Zph !== Zph_eff || Zn !== Zn_eff) {
      console.warn(
        `ℹ️ EQUI8: Zph/Zn clampés à ≥0.15Ω ` +
        `(Zph_in=${Zph.toFixed(3)}Ω, Zn_in=${Zn.toFixed(3)}Ω → ` +
        `Zph=${Zph_eff.toFixed(3)}Ω, Zn=${Zn_eff.toFixed(3)}Ω)`
      );
    }
    
    // Calculer la tension moyenne et l'écart initial
    const Umoy_init = (Uinit_ph1 + Uinit_ph2 + Uinit_ph3) / 3;
    const Umax_init = Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3);
    const Umin_init = Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3);
    const ecart_init = Umax_init - Umin_init;  // (Umax-Umin)init
    
    // Calculer les ratios normalisés (avec signe conservé)
    // Ratio-phX = (Uinitphx - Umoy-3ph-init) / (Umax-3Ph-init - Umin-3Ph-init)
    const ratio_ph1 = ecart_init > 0 ? (Uinit_ph1 - Umoy_init) / ecart_init : 0;
    const ratio_ph2 = ecart_init > 0 ? (Uinit_ph2 - Umoy_init) / ecart_init : 0;
    const ratio_ph3 = ecart_init > 0 ? (Uinit_ph3 - Umoy_init) / ecart_init : 0;
    
    // ✅ FORMULE EXACTE selon documentation EQUI8 (CME Transformateur)
    // (Umax-Umin)EQUI8 = 1 / [0,9119 × Ln(Zph) + 3,8654] × (Umax-Umin)init × 2 × Zph / (Zph + Zn)
    const lnZph = Math.log(Zph_eff);
    const denominateur = 0.9119 * lnZph + 3.8654;
    const facteur_impedance = (2 * Zph_eff) / (Zph_eff + Zn_eff);
    const ecart_equi8 = (1 / denominateur) * ecart_init * facteur_impedance;
    
    // 🔬 LOG DE DIAGNOSTIC EQUI8
    console.log(`🔬 EQUI8 Calcul détaillé (formule CME):`, {
      'Zph_effectif': `${Zph_eff.toFixed(3)}Ω`,
      'Zn_effectif': `${Zn_eff.toFixed(3)}Ω`,
      'Ln(Zph)': lnZph.toFixed(3),
      'Dénominateur [0.9119×Ln(Zph)+3.8654]': denominateur.toFixed(3),
      'Facteur impédance [2×Zph/(Zph+Zn)]': facteur_impedance.toFixed(3),
      '(Umax-Umin)init': `${ecart_init.toFixed(3)}V`,
      '(Umax-Umin)EQUI8 calculé': `${ecart_equi8.toFixed(3)}V`,
      'Formule complète': `(1/${denominateur.toFixed(2)}) × ${ecart_init.toFixed(2)} × ${facteur_impedance.toFixed(2)} = ${ecart_equi8.toFixed(3)}V`
    });
    
    return { 
      ratio_ph1, ratio_ph2, ratio_ph3, 
      Umoy_init, 
      ecart_init,      // ✅ NOUVEAU - stocké pour cohérence
      ecart_equi8,
      Uinit_ph1,       // ✅ NOUVEAU - tensions initiales stockées
      Uinit_ph2,
      Uinit_ph3
    };
  }

  /**
   * Calcule le courant de neutre à partir des courants de phases
   */
  private calculateNeutralCurrent(
    I_A: Complex,
    I_B: Complex,
    I_C: Complex
  ): { magnitude: number; complex: Complex } {
    // I_N = I_A + I_B + I_C (loi de Kirchhoff)
    const I_N = add(add(I_A, I_B), I_C);
    return {
      magnitude: abs(I_N),
      complex: I_N
    };
  }

  /**
   * Applique le modèle EQUI8 (CME Transformateur) pour compensation de neutre
   * Basé sur la documentation technique EQUI8 avec formules linéarisées
   */
  private applyEQUI8Compensation(
    Uinit_ph1: number,
    Uinit_ph2: number,
    Uinit_ph3: number,
    I_A_total: Complex,
    I_B_total: Complex,
    I_C_total: Complex,
    compensator: NeutralCompensator
  ): {
    UEQUI8_ph1_mag: number;
    UEQUI8_ph2_mag: number;
    UEQUI8_ph3_mag: number;
    UEQUI8_ph1_phasor: Complex; // ✅ Phasor complet avec phase
    UEQUI8_ph2_phasor: Complex; // ✅ Phasor complet avec phase
    UEQUI8_ph3_phasor: Complex; // ✅ Phasor complet avec phase
    I_EQUI8_A: number;
    I_EQUI8_complex: Complex;
    iN_initial_complex: Complex;
    reductionPercent: number;
    iN_initial_A: number;
    iN_absorbed_A: number;
    isLimited: boolean;
    compensationQ_kVAr: { A: number; B: number; C: number };
    // Métriques intermédiaires pour debug/affichage
    umoy_init_V: number;
    umax_init_V: number;
    umin_init_V: number;
    ecart_init_V: number;
    ecart_equi8_V: number;
    // ✅ NOUVEAU : Tensions initiales par phase (avant équilibrage)
    uinit_ph1_V: number;
    uinit_ph2_V: number;
    uinit_ph3_V: number;
  } {
    // Extraire et clamper les impédances
    const Zph_raw = compensator.Zph_Ohm;
    const Zn_raw = compensator.Zn_Ohm;
    const Zph = Math.max(0.15, Zph_raw);
    const Zn = Math.max(0.15, Zn_raw);
    
    if (Zph !== Zph_raw || Zn !== Zn_raw) {
      console.warn(
        `ℹ️ EQUI8: Zph/Zn clampés à ≥0.15Ω ` +
        `(Zph_in=${Zph_raw.toFixed(3)}Ω, Zn_in=${Zn_raw.toFixed(3)}Ω → ` +
        `Zph=${Zph.toFixed(3)}Ω, Zn=${Zn.toFixed(3)}Ω)`
      );
    }
    
    // 🔧 LOG: Impédances utilisées
    console.log(`🔧 EQUI8 nœud ${compensator.nodeId} - Impédances:`, {
      'Zph_effectif': `${Zph.toFixed(3)}Ω`,
      'Zn_effectif': `${Zn.toFixed(3)}Ω`,
      'Condition CME (>0.15Ω)': '✅ Clampé si nécessaire'
    });
    
    // Calculer le courant de neutre initial (magnitude et phasor)
    const { magnitude: I_N_initial, complex: I_N_complex } = this.calculateNeutralCurrent(I_A_total, I_B_total, I_C_total);
    
    // Si en dessous du seuil de tolérance, pas de compensation
    if (I_N_initial <= compensator.tolerance_A) {
      const U_A_phasor = fromPolar(Uinit_ph1, 0);
      const U_B_phasor = fromPolar(Uinit_ph2, -2*Math.PI/3);
      const U_C_phasor = fromPolar(Uinit_ph3, 2*Math.PI/3);
      return {
        UEQUI8_ph1_mag: Uinit_ph1,
        UEQUI8_ph2_mag: Uinit_ph2,
        UEQUI8_ph3_mag: Uinit_ph3,
        UEQUI8_ph1_phasor: U_A_phasor,
        UEQUI8_ph2_phasor: U_B_phasor,
        UEQUI8_ph3_phasor: U_C_phasor,
        I_EQUI8_A: I_N_initial,
        I_EQUI8_complex: C(0, 0),
        iN_initial_complex: I_N_complex,
        reductionPercent: 0,
        iN_initial_A: I_N_initial,
        iN_absorbed_A: 0,
        isLimited: false,
        compensationQ_kVAr: { A: 0, B: 0, C: 0 },
        umoy_init_V: (Uinit_ph1 + Uinit_ph2 + Uinit_ph3) / 3,
        umax_init_V: Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3),
        umin_init_V: Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3),
        ecart_init_V: Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3) - Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3),
        ecart_equi8_V: Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3) - Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3),
        uinit_ph1_V: Uinit_ph1,
        uinit_ph2_V: Uinit_ph2,
        uinit_ph3_V: Uinit_ph3
      };
    }

    // === CALCULS DYNAMIQUES EQUI8 (recalculés à chaque appel) ===
    // L'EQUI8 recalcule les ratios à partir de l'état ACTUEL du réseau
    
    const Umoy_current = (Uinit_ph1 + Uinit_ph2 + Uinit_ph3) / 3;
    const Umax_current = Math.max(Uinit_ph1, Uinit_ph2, Uinit_ph3);
    const Umin_current = Math.min(Uinit_ph1, Uinit_ph2, Uinit_ph3);
    const ecart_current = Umax_current - Umin_current;
    
    // Si pas de déséquilibre, pas de compensation nécessaire
    if (ecart_current < 0.01) {
      console.log(`ℹ️ EQUI8 nœud ${compensator.nodeId}: Écart ${ecart_current.toFixed(3)}V < 0.01V - Pas de compensation`);
      const U_A_phasor = fromPolar(Uinit_ph1, 0);
      const U_B_phasor = fromPolar(Uinit_ph2, -2*Math.PI/3);
      const U_C_phasor = fromPolar(Uinit_ph3, 2*Math.PI/3);
      return {
        UEQUI8_ph1_mag: Uinit_ph1,
        UEQUI8_ph2_mag: Uinit_ph2,
        UEQUI8_ph3_mag: Uinit_ph3,
        UEQUI8_ph1_phasor: U_A_phasor,
        UEQUI8_ph2_phasor: U_B_phasor,
        UEQUI8_ph3_phasor: U_C_phasor,
        I_EQUI8_A: I_N_initial,
        I_EQUI8_complex: C(0, 0),
        iN_initial_complex: I_N_complex,
        reductionPercent: 0,
        iN_initial_A: I_N_initial,
        iN_absorbed_A: 0,
        isLimited: false,
        compensationQ_kVAr: { A: 0, B: 0, C: 0 },
        umoy_init_V: Umoy_current,
        umax_init_V: Umax_current,
        umin_init_V: Umin_current,
        ecart_init_V: ecart_current,
        ecart_equi8_V: ecart_current,
        uinit_ph1_V: Uinit_ph1,
        uinit_ph2_V: Uinit_ph2,
        uinit_ph3_V: Uinit_ph3
      };
    }
    
    // Calculer les ratios DYNAMIQUEMENT à partir de l'état actuel du réseau
    const ratiosData = this.computeEQUI8CompensationRatio(
      Uinit_ph1, Uinit_ph2, Uinit_ph3,
      compensator.Zph_Ohm,
      compensator.Zn_Ohm
    );
    
    console.log(`📊 EQUI8 nœud ${compensator.nodeId} - Ratios calculés dynamiquement:`, {
      'Tensions actuelles': `${Uinit_ph1.toFixed(1)}V / ${Uinit_ph2.toFixed(1)}V / ${Uinit_ph3.toFixed(1)}V`,
      'Écart actuel': `${ecart_current.toFixed(1)}V`,
      'Ratios': `${ratiosData.ratio_ph1.toFixed(3)} / ${ratiosData.ratio_ph2.toFixed(3)} / ${ratiosData.ratio_ph3.toFixed(3)}`
    });
    
    // Extraire les valeurs calculées
    const { ratio_ph1, ratio_ph2, ratio_ph3, ecart_equi8 } = ratiosData;
    
    // ✅ FORMULE EXACTE selon documentation EQUI8 (CME Transformateur)
    // UEQUI8-ph = Umoy_actuel + Ratio-ph × (Umax-Umin)EQUI8
    const UEQUI8_ph1_mag = Umoy_current + ratio_ph1 * ecart_equi8;
    const UEQUI8_ph2_mag = Umoy_current + ratio_ph2 * ecart_equi8;
    const UEQUI8_ph3_mag = Umoy_current + ratio_ph3 * ecart_equi8;
    
    // 5. Calculer les phasors complets avec les phases naturelles (pour affichage)
    // Phase A: 0°, Phase B: -120°, Phase C: +120°
    const UEQUI8_ph1_phasor = fromPolar(UEQUI8_ph1_mag, 0);
    const UEQUI8_ph2_phasor = fromPolar(UEQUI8_ph2_mag, -2*Math.PI/3);
    const UEQUI8_ph3_phasor = fromPolar(UEQUI8_ph3_mag, 2*Math.PI/3);
    
    // 6. Calculer le courant injecté EQUI8 selon formule officielle CME
    // ✅ FORMULE EXACTE: I-EQUI8 = 0,392 × Zph^(-0,8065) × (Umax-Umin)actuel × 2 × Zph / (Zph + Zn)
    const facteur_courant = 0.392 * Math.pow(Zph, -0.8065);
    const facteur_impedance_courant = (2 * Zph) / (Zph + Zn);
    // Utiliser l'écart ACTUEL pour le calcul dynamique
    let I_EQUI8_mag = facteur_courant * ecart_current * facteur_impedance_courant;
    
    // Construire le phasor de compensation: opposé à I_N_complex
    // L'EQUI8 injecte un courant qui s'oppose au courant de neutre
    const I_N_normalized = abs(I_N_complex) > 0 ? scale(I_N_complex, 1 / abs(I_N_complex)) : C(0, 0);
    let I_EQUI8_complex = scale(I_N_normalized, -I_EQUI8_mag);
    
    // 7. Calculer la réduction de courant de neutre
    // Courant résiduel dans le neutre après compensation
    let I_N_residual = Math.max(0, I_N_initial - I_EQUI8_mag);
    
    // Pourcentage de réduction réelle (0..100%)
    let reductionPercent = I_N_initial > 0 
      ? (1 - I_N_residual / I_N_initial) * 100 
      : 0;
    reductionPercent = Math.min(100, Math.max(0, reductionPercent));
    
    // 8. Vérifier la limitation par puissance
    // La puissance demandée dépend du courant INJECTÉ par l'EQUI8
    let I_EQUI8_effective = I_EQUI8_mag;
    let estimatedPower_kVA = (Math.sqrt(3) * Umoy_current * I_EQUI8_effective) / 1000;
    let isLimited = false;
    
    if (estimatedPower_kVA > compensator.maxPower_kVA) {
      isLimited = true;
      // Calculer le courant limite pour ne pas dépasser maxPower_kVA
      const I_limit = (compensator.maxPower_kVA * 1000) / (Math.sqrt(3) * Umoy_current);
      console.warn(
        `⚠️ EQUI8 limité par puissance: ${estimatedPower_kVA.toFixed(1)} kVA > ` +
        `${compensator.maxPower_kVA} kVA → I injecté borné à ${I_limit.toFixed(1)} A`
      );
      
      I_EQUI8_effective = I_limit;
      
      // Reconstruire le phasor injecté avec la magnitude limitée
      I_EQUI8_complex = scale(I_N_normalized, -I_EQUI8_effective);
      
      // Recalculer résiduel et réduction avec le courant effectif
      I_N_residual = Math.max(0, I_N_initial - I_EQUI8_effective);
      reductionPercent = I_N_initial > 0 
        ? (1 - I_N_residual / I_N_initial) * 100 
        : 0;
      reductionPercent = Math.min(100, Math.max(0, reductionPercent));
      
      estimatedPower_kVA = compensator.maxPower_kVA;
    }
    
    // Estimation des puissances réactives (pour affichage)
    const Q_per_phase = Math.min(estimatedPower_kVA, compensator.maxPower_kVA) / 3;

    // ✅ LOG DIAGNOSTIC COMPLET : Vérifier convergence des tensions
    const ecart_final_calc = Math.max(UEQUI8_ph1_mag, UEQUI8_ph2_mag, UEQUI8_ph3_mag) - 
                              Math.min(UEQUI8_ph1_mag, UEQUI8_ph2_mag, UEQUI8_ph3_mag);
    const convergenceOK = ecart_final_calc < ecart_current;
    
    console.log(`🔍 EQUI8 DIAGNOSTIC TENSIONS (nœud ${compensator.nodeId}):`, {
      '===== TENSIONS ACTUELLES =====': '',
      'Tensions actuelles': `${Uinit_ph1.toFixed(1)}V / ${Uinit_ph2.toFixed(1)}V / ${Uinit_ph3.toFixed(1)}V`,
      'Umoy_actuel': `${Umoy_current.toFixed(1)}V`,
      'Écart actuel': `${ecart_current.toFixed(1)}V`,
      '===== RATIOS CME (dynamiques) =====': '',
      'Ratios': `A=${ratio_ph1.toFixed(3)}, B=${ratio_ph2.toFixed(3)}, C=${ratio_ph3.toFixed(3)}`,
      'Somme ratios': (ratio_ph1 + ratio_ph2 + ratio_ph3).toFixed(4),
      '===== TENSIONS EQUI8 CALCULÉES =====': '',
      'Écart EQUI8 (cible)': `${ecart_equi8.toFixed(1)}V`,
      'UEQUI8 Ph1': `${UEQUI8_ph1_mag.toFixed(1)}V (Δ = ${(UEQUI8_ph1_mag - Uinit_ph1).toFixed(1)}V)`,
      'UEQUI8 Ph2': `${UEQUI8_ph2_mag.toFixed(1)}V (Δ = ${(UEQUI8_ph2_mag - Uinit_ph2).toFixed(1)}V)`,
      'UEQUI8 Ph3': `${UEQUI8_ph3_mag.toFixed(1)}V (Δ = ${(UEQUI8_ph3_mag - Uinit_ph3).toFixed(1)}V)`,
      'Écart final calculé': `${ecart_final_calc.toFixed(1)}V`,
      '===== VALIDATION =====': '',
      'Réduction écart': `${ecart_current.toFixed(1)}V → ${ecart_final_calc.toFixed(1)}V`,
      'CONVERGENCE': convergenceOK ? '✅ OK - Écart réduit' : '❌ PROBLÈME - Écart augmente!',
      'I-EQUI8': `${I_EQUI8_effective.toFixed(1)}A`,
      'I_N_initial': `${I_N_initial.toFixed(1)}A`,
      'Réduction %': `${reductionPercent.toFixed(1)}%`
    });

    return {
      UEQUI8_ph1_mag,
      UEQUI8_ph2_mag,
      UEQUI8_ph3_mag,
      UEQUI8_ph1_phasor,
      UEQUI8_ph2_phasor,
      UEQUI8_ph3_phasor,
      I_EQUI8_A: I_EQUI8_effective,
      I_EQUI8_complex,
      iN_initial_complex: I_N_complex,
      reductionPercent,
      iN_initial_A: I_N_initial,
      iN_absorbed_A: (I_N_initial - I_N_residual),
      isLimited,
      compensationQ_kVAr: { A: Q_per_phase, B: Q_per_phase, C: Q_per_phase },
      // Retourner valeurs ACTUELLES (plus de stockage permanent)
      umoy_init_V: Umoy_current,
      umax_init_V: Umax_current,
      umin_init_V: Umin_current,
      ecart_init_V: ecart_current,
      ecart_equi8_V: ecart_equi8,
      // Tensions actuelles par phase (état avant équilibrage de cette itération)
      uinit_ph1_V: Uinit_ph1,
      uinit_ph2_V: Uinit_ph2,
      uinit_ph3_V: Uinit_ph3
    };
  }

  /**
   * ============================================================================
   * @deprecated - ANCIEN MODÈLE EQUI8 : Redistribution des charges mono
   * ============================================================================
   * 
   * ⚠️ CE CODE EST DÉPRÉCIÉ ET REDIRIGE VERS LE MODE CME.
   * 
   * L'ancien modèle de redistribution des charges mono ne respectait pas
   * le comportement physique réel de l'EQUI8 (compensateur de neutre).
   * 
   * Le mode CME (injection de courant shunt) est maintenant la seule
   * méthode supportée. Cette fonction ne fait plus que rediriger vers
   * calculateWithEQUI8_CME().
   * 
   * ============================================================================
   */
  private calculateWithNeutralCompensationIterative(
    project: Project,
    scenario: CalculationScenario,
    compensators: NeutralCompensator[],
    calculationResults?: { [key: string]: CalculationResult }
  ): CalculationResult {
    // ============================================================================
    // @deprecated - Redirection vers le mode CME
    // L'EQUI8 utilise maintenant exclusivement le mode CME (injection de courant)
    // ============================================================================
    console.warn('⚠️ calculateWithNeutralCompensationIterative() est déprécié. Redirection vers CME.');
    console.log('🔧 EQUI8: Basculement automatique vers mode CME (injection courant shunt)');
    
    return this.calculateWithEQUI8_CME(
      project,
      scenario,
      compensators,
      calculationResults
    );
  }

  /**
   * ============================================================================
   * EQUI8 MODE CME - INJECTION DE COURANT SHUNT
   * ============================================================================
   * 
   * 🔑 PRINCIPE FONDAMENTAL (FOURNISSEUR):
   * EQUI8 agit comme une SOURCE DE COURANT shunt au nœud d'installation.
   * - +I_EQUI8 injecté sur le NEUTRE
   * - -I_EQUI8/3 soutiré sur chaque PHASE (A, B, C)
   * 
   * 📊 ALGORITHME:
   * 1. BFS SANS équipements → récupérer U1, U2, U3 au nœud EQUI8
   * 2. Calculer Zph, Zn équivalents depuis la source
   * 3. Appliquer formules CME → cibles U*, I_EQ_est
   * 4. Boucle de calibration:
   *    - Insérer injection de courant
   *    - Recalcul BFS complet
   *    - Vérifier ΔU_loc ≈ ΔU_EQUI8 (tolérance 0.2-0.5V)
   *    - Ajuster I_inj par méthode sécante (borné par limites thermiques)
   * 5. Retourner le résultat final avec métriques
   * 
   * CONTRAINTES FOURNISSEUR:
   * - Zph ≥ 0.15Ω, Zn ≥ 0.15Ω (sinon abort)
   * - Précision: ±2V sur tensions, ±5A sur courant
   * - Limites thermiques: 80A/15min, 60A/3h, 45A permanent
   * ============================================================================
   */
  private calculateWithEQUI8_CME(
    project: Project,
    scenario: CalculationScenario,
    compensators: NeutralCompensator[],
    calculationResults?: { [key: string]: CalculationResult }
  ): CalculationResult {
    
    console.log(`\n════════════════════════════════════════════════════════════════`);
    console.log(`🔧 EQUI8 MODE CME - Injection de courant shunt`);
    console.log(`   ${compensators.length} compensateur(s) actif(s)`);
    console.log(`════════════════════════════════════════════════════════════════\n`);
    
    const CME_CONVERGENCE_TOLERANCE_V = 0.5;
    const CME_MAX_CALIBRATION_ITERATIONS = 20;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ÉTAPE 1: BFS SANS équipements → tensions naturelles U1, U2, U3
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`📊 ÉTAPE 1: Calcul BFS sans équipements (tensions naturelles)`);
    
    const baselineResult = this.calculateScenario(
      project.nodes,
      project.cables,
      project.cableTypes,
      scenario,
      project.foisonnementChargesResidentiel ?? project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      project.manualPhaseDistribution,
      project.clientsImportes,
      project.clientLinks,
      project.foisonnementChargesResidentiel,
      project.foisonnementChargesIndustriel
    );
    
    // Collecter les données CME pour chaque compensateur
    const cmeDataMap = new Map<string, {
      cmeResult: EQUI8CMEResult;
      impedances: { Zph_ohm: number; Zn_ohm: number };
      thermalWindow: EQUI8ThermalWindow;
      initialVoltages: { A: number; B: number; C: number };
    }>();
    
    for (const compensator of compensators) {
      if (!compensator.enabled) continue;
      
      // Récupérer les tensions naturelles au nœud
      const nodeMetrics = baselineResult.nodeMetricsPerPhase?.find(nm => nm.nodeId === compensator.nodeId);
      if (!nodeMetrics?.voltagesPerPhase) {
        console.warn(`⚠️ EQUI8 CME: Nœud ${compensator.nodeId} non trouvé dans les résultats`);
        continue;
      }
      
      const U1 = nodeMetrics.voltagesPerPhase.A;
      const U2 = nodeMetrics.voltagesPerPhase.B;
      const U3 = nodeMetrics.voltagesPerPhase.C;
      
      console.log(`📍 EQUI8 ${compensator.id} @ nœud ${compensator.nodeId}:`);
      console.log(`   Tensions naturelles: A=${U1.toFixed(1)}V, B=${U2.toFixed(1)}V, C=${U3.toFixed(1)}V`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 2: Calculer Zph, Zn équivalents
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const impedances = computeEquivImpedancesToSource(compensator.nodeId, project);
      
      // Utiliser les impédances du compensateur si définies, sinon les calculées
      const Zph = compensator.Zph_Ohm > 0 ? compensator.Zph_Ohm : impedances.Zph_ohm;
      const Zn = compensator.Zn_Ohm > 0 ? compensator.Zn_Ohm : impedances.Zn_ohm;
      
      console.log(`   Impédances: Zph=${Zph.toFixed(4)}Ω, Zn=${Zn.toFixed(4)}Ω`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 3: Appliquer formules CME
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const cmeResult = computeCME_UtargetsAndI(U1, U2, U3, Zph, Zn);
      
      if (cmeResult.aborted) {
        console.error(`❌ EQUI8 CME ${compensator.id}: Calcul aborté - ${cmeResult.abortReason}`);
        continue;
      }
      
      const thermalWindow: EQUI8ThermalWindow = compensator.thermalWindow || 'permanent';
      
      cmeDataMap.set(compensator.id, {
        cmeResult,
        impedances: { Zph_ohm: Zph, Zn_ohm: Zn },
        thermalWindow,
        initialVoltages: { A: U1, B: U2, C: U3 }
      });
    }
    
    // Si aucun compensateur valide, retourner le résultat baseline
    if (cmeDataMap.size === 0) {
      console.warn(`⚠️ EQUI8 CME: Aucun compensateur valide, retour au baseline`);
      return baselineResult;
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ÉTAPE 4: Boucle de calibration BFS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`\n📊 ÉTAPE 4: Boucle de calibration BFS`);
    
    // Initialiser les courants d'injection
    const injectionCurrents = new Map<string, number>();
    const previousIinj = new Map<string, number>();
    const previousDeltaU = new Map<string, number>();
    
    for (const [compId, data] of cmeDataMap.entries()) {
      const { I_clamped } = clampByThermal(data.cmeResult.I_EQ_est, data.thermalWindow);
      injectionCurrents.set(compId, I_clamped);
      previousIinj.set(compId, 0);
      previousDeltaU.set(compId, data.cmeResult.deltaU_init);
    }
    
    let converged = false;
    let iteration = 0;
    let finalResult = baselineResult;
    const calibrationResults = new Map<string, EQUI8CalibrationResult>();
    
    while (!converged && iteration < CME_MAX_CALIBRATION_ITERATIONS) {
      iteration++;
      console.log(`\n🔄 Calibration itération ${iteration}/${CME_MAX_CALIBRATION_ITERATIONS}`);
      
      // Construire les injections de courant pour le BFS
      const equi8Injections = new Map<string, {
        I_neutral: { re: number; im: number };
        I_phaseA: { re: number; im: number };
        I_phaseB: { re: number; im: number };
        I_phaseC: { re: number; im: number };
        magnitude: number;
      }>();
      
      for (const [compId, Iinj] of injectionCurrents.entries()) {
        const compensator = compensators.find(c => c.id === compId);
        if (!compensator) continue;
        
        // Récupérer les tensions actuelles au nœud pour distribution proportionnelle
        const prevNodeMetrics = finalResult.nodeMetricsPerPhase?.find(nm => nm.nodeId === compensator.nodeId);
        const voltages = prevNodeMetrics?.voltagesPerPhase
          ? { A: prevNodeMetrics.voltagesPerPhase.A, B: prevNodeMetrics.voltagesPerPhase.B, C: prevNodeMetrics.voltagesPerPhase.C }
          : { A: 230, B: 230, C: 230 };
        
        // Approximer le phaseur neutre existant depuis le courant scalaire
        // L'angle est aligné sur la phase la plus chargée (tension la plus basse)
        const minV = Math.min(voltages.A, voltages.B, voltages.C);
        const neutralAngle = voltages.A === minV ? 0 : voltages.B === minV ? -2*Math.PI/3 : 2*Math.PI/3;
        const IN_existing = { re: Math.cos(neutralAngle), im: Math.sin(neutralAngle) };
        
        const injection = buildEQUI8Injection(compensator.nodeId, Iinj, voltages, IN_existing);
        equi8Injections.set(compensator.nodeId, {
          I_neutral: { re: injection.I_neutral.re, im: injection.I_neutral.im },
          I_phaseA: { re: injection.I_phaseA.re, im: injection.I_phaseA.im },
          I_phaseB: { re: injection.I_phaseB.re, im: injection.I_phaseB.im },
          I_phaseC: { re: injection.I_phaseC.re, im: injection.I_phaseC.im },
          magnitude: injection.magnitude
        });
        
        console.log(`   EQUI8 ${compId}: I_inj=${Iinj.toFixed(2)}A`);
      }
      
      // Recalcul BFS avec injections de courant
      finalResult = this.calculateScenario(
        project.nodes,
        project.cables,
        project.cableTypes,
        scenario,
        project.foisonnementChargesResidentiel ?? project.foisonnementCharges,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        project.manualPhaseDistribution,
        project.clientsImportes,
        project.clientLinks,
        project.foisonnementChargesResidentiel,
        project.foisonnementChargesIndustriel,
        equi8Injections // ✅ Injections EQUI8 CME
      );
      
      // Vérifier la convergence pour chaque compensateur
      let allConverged = true;
      
      for (const [compId, data] of cmeDataMap.entries()) {
        const compensator = compensators.find(c => c.id === compId);
        if (!compensator) continue;
        
        const nodeMetrics = finalResult.nodeMetricsPerPhase?.find(nm => nm.nodeId === compensator.nodeId);
        if (!nodeMetrics?.voltagesPerPhase) continue;
        
        const UA = nodeMetrics.voltagesPerPhase.A;
        const UB = nodeMetrics.voltagesPerPhase.B;
        const UC = nodeMetrics.voltagesPerPhase.C;
        const deltaU_achieved = Math.max(UA, UB, UC) - Math.min(UA, UB, UC);
        const deltaU_target = data.cmeResult.deltaU_EQUI8;
        const residual = Math.abs(deltaU_achieved - deltaU_target);
        
        console.log(`   EQUI8 ${compId}: ΔU_achieved=${deltaU_achieved.toFixed(2)}V, ΔU_target=${deltaU_target.toFixed(2)}V, résidu=${residual.toFixed(3)}V`);
        
        if (residual > CME_CONVERGENCE_TOLERANCE_V) {
          allConverged = false;
          
          // Ajuster le courant par méthode sécante
          const Iinj_current = injectionCurrents.get(compId) || 0;
          const Iinj_prev = previousIinj.get(compId) || 0;
          const deltaU_prev = previousDeltaU.get(compId) || data.cmeResult.deltaU_init;
          const thermalLimit = EQUI8_THERMAL_LIMITS[data.thermalWindow];
          
          const Iinj_next = adjustSecant(
            Iinj_current,
            deltaU_achieved,
            deltaU_target,
            Iinj_prev,
            deltaU_prev,
            thermalLimit
          );
          
          previousIinj.set(compId, Iinj_current);
          previousDeltaU.set(compId, deltaU_achieved);
          injectionCurrents.set(compId, Iinj_next);
        } else {
          // Stocker le résultat de calibration
          calibrationResults.set(compId, {
            converged: true,
            iterations: iteration,
            finalIinj: injectionCurrents.get(compId) || 0,
            deltaU_achieved,
            deltaU_target,
            residual,
            thermalLimited: (injectionCurrents.get(compId) || 0) >= EQUI8_THERMAL_LIMITS[data.thermalWindow] * 0.99,
            thermalLimit: EQUI8_THERMAL_LIMITS[data.thermalWindow],
            voltagesAchieved: { A: UA, B: UB, C: UC },
            voltagesTarget: { A: data.cmeResult.U_A_star, B: data.cmeResult.U_B_star, C: data.cmeResult.U_C_star }
          });
        }
      }
      
      converged = allConverged;
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ÉTAPE 5: Mise à jour des métriques des compensateurs
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`\n📊 ÉTAPE 5: Mise à jour des métriques`);
    
    for (const [compId, data] of cmeDataMap.entries()) {
      const compensator = compensators.find(c => c.id === compId);
      if (!compensator) continue;
      
      const calibration = calibrationResults.get(compId);
      const nodeMetrics = finalResult.nodeMetricsPerPhase?.find(nm => nm.nodeId === compensator.nodeId);
      
      // Stocker les résultats CME dans le compensateur
      compensator.cme_I_injected_A = injectionCurrents.get(compId) || 0;
      compensator.cme_deltaU_target_V = data.cmeResult.deltaU_EQUI8;
      compensator.cme_deltaU_achieved_V = calibration?.deltaU_achieved ?? 0;
      compensator.cme_converged = calibration?.converged ?? false;
      compensator.cme_iterations = iteration;
      
      // Métriques initiales
      compensator.uinit_ph1_V = data.initialVoltages.A;
      compensator.uinit_ph2_V = data.initialVoltages.B;
      compensator.uinit_ph3_V = data.initialVoltages.C;
      compensator.ecart_init_V = data.cmeResult.deltaU_init;
      
      // Tensions finales
      if (nodeMetrics?.voltagesPerPhase) {
        compensator.u1p_V = nodeMetrics.voltagesPerPhase.A;
        compensator.u2p_V = nodeMetrics.voltagesPerPhase.B;
        compensator.u3p_V = nodeMetrics.voltagesPerPhase.C;
        compensator.ecart_equi8_V = Math.max(
          nodeMetrics.voltagesPerPhase.A, nodeMetrics.voltagesPerPhase.B, nodeMetrics.voltagesPerPhase.C
        ) - Math.min(
          nodeMetrics.voltagesPerPhase.A, nodeMetrics.voltagesPerPhase.B, nodeMetrics.voltagesPerPhase.C
        );
        compensator.umoy_init_V = (nodeMetrics.voltagesPerPhase.A + nodeMetrics.voltagesPerPhase.B + nodeMetrics.voltagesPerPhase.C) / 3;
      }
      
      // Courant et réduction
      compensator.currentIN_A = compensator.cme_I_injected_A;
      compensator.isLimited = (compensator.cme_I_injected_A || 0) >= EQUI8_THERMAL_LIMITS[data.thermalWindow] * 0.99;
      
      if (data.cmeResult.deltaU_init > 0) {
        compensator.reductionPercent = ((data.cmeResult.deltaU_init - (compensator.ecart_equi8_V || 0)) / data.cmeResult.deltaU_init) * 100;
      }
      
      // Log final avec rappel des précisions
      logEQUI8CMEMetrics(
        compId,
        compensator.nodeId,
        data.cmeResult,
        calibration,
        data.thermalWindow
      );
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ÉTAPE 6: Construire les injections finales pour réutilisation externe
    // Ces injections peuvent être passées à d'autres calculs (couplage SRG2)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const finalEqui8Injections = new Map<string, {
      I_neutral: { re: number; im: number };
      I_phaseA: { re: number; im: number };
      I_phaseB: { re: number; im: number };
      I_phaseC: { re: number; im: number };
      magnitude: number;
    }>();
    
    for (const [compId, Iinj] of injectionCurrents.entries()) {
      const compensator = compensators.find(c => c.id === compId);
      if (!compensator) continue;
      
      // Récupérer les tensions finales au nœud pour distribution proportionnelle
      const finalNodeMetrics = finalResult.nodeMetricsPerPhase?.find(nm => nm.nodeId === compensator.nodeId);
      const finalVoltages = finalNodeMetrics?.voltagesPerPhase
        ? { A: finalNodeMetrics.voltagesPerPhase.A, B: finalNodeMetrics.voltagesPerPhase.B, C: finalNodeMetrics.voltagesPerPhase.C }
        : { A: 230, B: 230, C: 230 };
      const minVFinal = Math.min(finalVoltages.A, finalVoltages.B, finalVoltages.C);
      const neutralAngleFinal = finalVoltages.A === minVFinal ? 0 : finalVoltages.B === minVFinal ? -2*Math.PI/3 : 2*Math.PI/3;
      const IN_existingFinal = { re: Math.cos(neutralAngleFinal), im: Math.sin(neutralAngleFinal) };
      
      const injection = buildEQUI8Injection(compensator.nodeId, Iinj, finalVoltages, IN_existingFinal);
      finalEqui8Injections.set(compensator.nodeId, {
        I_neutral: { re: injection.I_neutral.re, im: injection.I_neutral.im },
        I_phaseA: { re: injection.I_phaseA.re, im: injection.I_phaseA.im },
        I_phaseB: { re: injection.I_phaseB.re, im: injection.I_phaseB.im },
        I_phaseC: { re: injection.I_phaseC.re, im: injection.I_phaseC.im },
        magnitude: injection.magnitude
      });
    }
    
    console.log(`\n✅ EQUI8 CME terminé: ${converged ? 'convergé' : 'non convergé'} après ${iteration} itérations`);
    console.log(`   🔑 Tensions = résultat NATUREL du BFS avec injection de courant (pas d'imposition)`);
    console.log(`   📤 ${finalEqui8Injections.size} injection(s) disponibles pour calcul final couplé`);
    
    return {
      ...finalResult,
      convergenceStatus: converged ? 'converged' : 'not_converged',
      iterations: iteration,
      equi8Injections: finalEqui8Injections // ✅ Injections calibrées pour réutilisation
    };
  }

  /**
   * Applique les compensateurs de neutre aux résultats de calcul
   */
  private applyNeutralCompensatorsToResult(
    result: CalculationResult,
    project: Project,
    compensators: NeutralCompensator[]
  ): CalculationResult {
    // 2. Appliquer chaque compensateur
    for (const compensator of compensators) {
      const node = project.nodes.find(n => n.id === compensator.nodeId);
      if (!node) {
        console.warn(`⚠️ Nœud ${compensator.nodeId} non trouvé pour compensateur`);
        continue;
      }
      
      // Récupérer les métriques du nœud (mode mixte ou monophasé réparti)
      const isMixedOrUnbalanced = project.loadModel === 'mixte_mono_poly' || project.loadModel === 'monophase_reparti';
      if (isMixedOrUnbalanced && result.nodeMetricsPerPhase) {
        const nodeMetrics = result.nodeMetricsPerPhase.find(nm => nm.nodeId === compensator.nodeId);
        if (!nodeMetrics) continue;
        
        // Récupérer les courants de phase depuis les câbles parent (PHASORS)
        const parentCables = project.cables.filter(c => c.nodeBId === compensator.nodeId);
        if (parentCables.length === 0) continue;
        
        // Pour chaque câble parent, récupérer les courants de phase (phasors)
        let I_A_total = C(0, 0);
        let I_B_total = C(0, 0);
        let I_C_total = C(0, 0);
        
        for (const cable of parentCables) {
          const cableResult = result.cables.find(cr => cr.id === cable.id);
          if (!cableResult || !cableResult.currentsPerPhase_A) continue;
          
          // Utiliser les courants par phase existants (phasors si disponibles)
          // TODO: Le calcul de base devrait fournir ces phasors
          // Pour l'instant, on reconstruit à partir des magnitudes avec approximation de phase
          const I_A_mag = cableResult.currentsPerPhase_A.A || 0;
          const I_B_mag = cableResult.currentsPerPhase_A.B || 0;
          const I_C_mag = cableResult.currentsPerPhase_A.C || 0;
          
          // Approximation: phases décalées de 120° pour système triphasé équilibré
          // Phase A: 0°, Phase B: -120°, Phase C: +120°
          I_A_total = add(I_A_total, fromPolar(I_A_mag, 0));
          I_B_total = add(I_B_total, fromPolar(I_B_mag, -2*Math.PI/3));
          I_C_total = add(I_C_total, fromPolar(I_C_mag, 2*Math.PI/3));
        }
        
        // Récupérer les tensions initiales au nœud du compensateur
        const Uinit_ph1 = nodeMetrics.voltagesPerPhase.A;
        const Uinit_ph2 = nodeMetrics.voltagesPerPhase.B;
        const Uinit_ph3 = nodeMetrics.voltagesPerPhase.C;
        
        // Appliquer le modèle EQUI8
        const equi8Result = this.applyEQUI8Compensation(
          Uinit_ph1,
          Uinit_ph2,
          Uinit_ph3,
          I_A_total,
          I_B_total,
          I_C_total,
          compensator
        );
        
        // Mettre à jour les résultats du compensateur avec les valeurs EQUI8
        compensator.iN_initial_A = equi8Result.iN_initial_A;
        compensator.iN_absorbed_A = equi8Result.iN_absorbed_A;
        compensator.currentIN_A = equi8Result.I_EQUI8_A;
        compensator.reductionPercent = equi8Result.reductionPercent;
        compensator.isLimited = equi8Result.isLimited;
        compensator.compensationQ_kVAr = equi8Result.compensationQ_kVAr;
        
        // Métriques intermédiaires EQUI8
        compensator.umoy_init_V = equi8Result.umoy_init_V;
        compensator.umax_init_V = equi8Result.umax_init_V;
        compensator.umin_init_V = equi8Result.umin_init_V;
        compensator.ecart_init_V = equi8Result.ecart_init_V;
        compensator.ecart_equi8_V = equi8Result.ecart_equi8_V;
        
        // ✅ CORRECTION : Tensions initiales par phase pour affichage avant/après
        compensator.uinit_ph1_V = equi8Result.uinit_ph1_V;
        compensator.uinit_ph2_V = equi8Result.uinit_ph2_V;
        compensator.uinit_ph3_V = equi8Result.uinit_ph3_V;
        
        // Tensions finales calculées par EQUI8
        compensator.u1p_V = equi8Result.UEQUI8_ph1_mag;
        compensator.u2p_V = equi8Result.UEQUI8_ph2_mag;
        compensator.u3p_V = equi8Result.UEQUI8_ph3_mag;
        
        // ✅ LOG DE VALIDATION FINALE : Vérifier que l'écart diminue
        const ecart_avant = Math.max(
          equi8Result.uinit_ph1_V, equi8Result.uinit_ph2_V, equi8Result.uinit_ph3_V
        ) - Math.min(
          equi8Result.uinit_ph1_V, equi8Result.uinit_ph2_V, equi8Result.uinit_ph3_V
        );
        const ecart_apres = Math.max(
          equi8Result.UEQUI8_ph1_mag, equi8Result.UEQUI8_ph2_mag, equi8Result.UEQUI8_ph3_mag
        ) - Math.min(
          equi8Result.UEQUI8_ph1_mag, equi8Result.UEQUI8_ph2_mag, equi8Result.UEQUI8_ph3_mag
        );
        
        if (ecart_apres >= ecart_avant && ecart_avant > 0.1) {
          console.error(`❌ EQUI8 ERREUR: Écart augmente! AVANT=${ecart_avant.toFixed(1)}V → APRÈS=${ecart_apres.toFixed(1)}V`);
        } else if (ecart_avant > 0.1) {
          console.log(`✅ EQUI8 OK: Écart réduit de ${ecart_avant.toFixed(1)}V → ${ecart_apres.toFixed(1)}V (${((1 - ecart_apres/ecart_avant)*100).toFixed(0)}%)`);
        }
        
        // ❌ SUPPRIMÉ: Imposition directe de tensions - Violation du principe CME
        // En mode CME, les tensions doivent résulter NATURELLEMENT du BFS avec injection de courant
        // On ne lit les tensions que pour les métadonnées d'affichage, on ne les écrit JAMAIS
        // nodeMetrics.voltagesPerPhase.A = equi8Result.UEQUI8_ph1_mag; // ← VIOLATION CME
        // nodeMetrics.voltagesPerPhase.B = equi8Result.UEQUI8_ph2_mag; // ← VIOLATION CME
        // nodeMetrics.voltagesPerPhase.C = equi8Result.UEQUI8_ph3_mag; // ← VIOLATION CME
        
        // ✅ MODE CME: Lecture seule des tensions calculées par BFS
        // Les tensions au nœud sont déjà le résultat du BFS avec injections EQUI8
        console.log(`📊 EQUI8 tensions finales au nœud ${compensator.nodeId} (résultat BFS naturel):`, {
          U1p: compensator.u1p_V.toFixed(1) + 'V',
          U2p: compensator.u2p_V.toFixed(1) + 'V',
          U3p: compensator.u3p_V.toFixed(1) + 'V',
          'I_N final': compensator.currentIN_A?.toFixed(1) + 'A',
          'Réduction': compensator.reductionPercent?.toFixed(1) + '%'
        });
      }
    }
    
    return result;
  }

  /**
   * Propage l'injection de courant EQUI8 vers les nœuds en aval avec calcul phasoriel correct
   * L'EQUI8 injecte un courant de compensation qui modifie les chutes de tension en aval
   * selon l'impédance complexe des tronçons (calculs phasors Z = R + jX)
   */
  /**
   * Calcule l'effet EQUI8 pour un nœud donné
   * Extrait les tensions et courants, applique le modèle EQUI8
   */
  private calculateEQUI8ForNode(
    result: CalculationResult,
    project: Project,
    compensator: NeutralCompensator
  ): any | null {
    if (!result.nodeMetricsPerPhase) return null;
    
    const nodeMetrics = result.nodeMetricsPerPhase.find(nm => nm.nodeId === compensator.nodeId);
    if (!nodeMetrics) {
      console.warn(`⚠️ Nœud ${compensator.nodeId} non trouvé dans les résultats`);
      return null;
    }
    
    // Récupérer les courants de phase depuis les câbles parent
    const parentCables = project.cables.filter(c => c.nodeBId === compensator.nodeId);
    if (parentCables.length === 0) {
      console.warn(`⚠️ Pas de câble parent pour le nœud ${compensator.nodeId}`);
      return null;
    }
    
    let I_A_total = C(0, 0);
    let I_B_total = C(0, 0);
    let I_C_total = C(0, 0);
    
    for (const cable of parentCables) {
      const cableResult = result.cables.find(cr => cr.id === cable.id);
      if (!cableResult || !cableResult.currentsPerPhase_A) continue;
      
      const I_A_mag = cableResult.currentsPerPhase_A.A || 0;
      const I_B_mag = cableResult.currentsPerPhase_A.B || 0;
      const I_C_mag = cableResult.currentsPerPhase_A.C || 0;
      
      // Approximation: phases décalées de 120°
      I_A_total = add(I_A_total, fromPolar(I_A_mag, 0));
      I_B_total = add(I_B_total, fromPolar(I_B_mag, -2*Math.PI/3));
      I_C_total = add(I_C_total, fromPolar(I_C_mag, 2*Math.PI/3));
    }
    
    // ✅ EQUI8 DYNAMIQUE : Utiliser les tensions ACTUELLES du réseau
    // Plus de référence aux ratios stockés - calcul basé sur l'état courant
    const Uinit_ph1 = nodeMetrics.voltagesPerPhase.A;
    const Uinit_ph2 = nodeMetrics.voltagesPerPhase.B;
    const Uinit_ph3 = nodeMetrics.voltagesPerPhase.C;
    
    console.log(`📊 EQUI8 nœud ${compensator.nodeId} - Tensions actuelles pour calcul dynamique:`, {
      'Phase A': `${Uinit_ph1.toFixed(1)}V`,
      'Phase B': `${Uinit_ph2.toFixed(1)}V`,
      'Phase C': `${Uinit_ph3.toFixed(1)}V`
    });
    
    // Appliquer le modèle EQUI8
    return this.applyEQUI8Compensation(
      Uinit_ph1,
      Uinit_ph2,
      Uinit_ph3,
      I_A_total,
      I_B_total,
      I_C_total,
      compensator
    );
  }
  
  /**
   * @deprecated - Nettoie les marqueurs EQUI8 legacy après calcul
   * En mode CME, aucun marqueur n'est plus utilisé.
   */
  private cleanupEQUI8Markers(nodes: Node[]): void {
    // ============================================================================
    // @deprecated - Cette fonction n'est plus nécessaire en mode CME
    // Les marqueurs equi8_modified, equi8_voltages, etc. ne sont plus utilisés.
    // Conservée pour compatibilité arrière uniquement.
    // ============================================================================
    for (const node of nodes) {
      if (node.customProps?.['equi8_modified']) {
        delete node.customProps['equi8_modified'];
        delete node.customProps['equi8_voltages'];
        delete node.customProps['equi8_current_neutral'];
        delete node.customProps['equi8_voltage_A'];
        delete node.customProps['equi8_voltage_B'];
        delete node.customProps['equi8_voltage_C'];
      }
    }
  }
  
  /**
   * @deprecated - Ancienne fonction d'imposition de tensions EQUI8
   * 
   * ⚠️ NE PLUS UTILISER - En mode CME, les tensions résultent naturellement
   * du BFS avec injection de courant. Aucune imposition directe de tensions.
   * 
   * Cette fonction est conservée comme NO-OP pour éviter les erreurs de build
   * si elle est encore référencée quelque part.
   */
  private applyEQUI8Voltages(
    nodes: Node[],
    compensator: NeutralCompensator,
    equi8Result: { 
      I_EQUI8_complex: Complex;
      UEQUI8_ph1_mag: number;
      UEQUI8_ph2_mag: number;
      UEQUI8_ph3_mag: number;
    }
  ): void {
    // ============================================================================
    // @deprecated - NO-OP en mode CME
    // En mode CME, les tensions ne sont JAMAIS imposées directement.
    // L'EQUI8 agit comme une source de courant shunt et les tensions résultent
    // naturellement du recalcul BFS.
    // ============================================================================
    console.warn('⚠️ applyEQUI8Voltages() est déprécié et désactivé en mode CME.');
    console.warn('   Les tensions EQUI8 résultent du BFS avec injection de courant.');
    // NO-OP: Ne rien faire
  }
  
  /**
   * Vérifie la convergence EQUI8
   */
  private checkEQUI8Convergence(
    current: Map<string, {A: number, B: number, C: number}>,
    previous: Map<string, {A: number, B: number, C: number}>
  ): boolean {
    if (previous.size === 0) return false;
    
    for (const [nodeId, voltages] of current) {
      const prev = previous.get(nodeId);
      if (!prev) return false;
      
      // Seuil de convergence: 0.1V sur chaque phase
      const tolerance = SimulationCalculator.SIM_CONVERGENCE_TOLERANCE_PHASE_V;
      if (Math.abs(voltages.A - prev.A) > tolerance ||
          Math.abs(voltages.B - prev.B) > tolerance ||
          Math.abs(voltages.C - prev.C) > tolerance) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * [OBSOLETE - Remplacée par propagateEqui8InjectionDownstream]
   * Ancienne méthode de recalcul des tensions en aval (calculs scalaires incorrects)
   */
  private recalculateDownstreamVoltages(
    result: CalculationResult,
    project: Project,
    compensator: NeutralCompensator,
    reductionFraction: number,
    I_A: Complex,
    I_B: Complex,
    I_C: Complex
  ): void {
    console.warn('⚠️ recalculateDownstreamVoltages est obsolète, utiliser propagateEqui8InjectionDownstream');
  }

  /**
   * Trouve tous les nœuds en aval d'un nœud donné
   */
  private findDownstreamNodes(project: Project, startNodeId: string): string[] {
    const downstream: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [startNodeId];
    visited.add(startNodeId);
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      // Trouver les câbles partant de ce nœud
      const outgoingCables = project.cables.filter(
        c => c.nodeAId === currentId || c.nodeBId === currentId
      );
      
      for (const cable of outgoingCables) {
        const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        
        // Éviter de remonter vers la source (vérifier si le nœud suivant est plus proche de la source)
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          downstream.push(nextNodeId);
          queue.push(nextNodeId);
        }
      }
    }
    
    return downstream;
  }

  /**
   * Trouve le chemin de câbles entre deux nœuds
   */
  private findCablePath(project: Project, fromNodeId: string, toNodeId: string): Cable[] {
    const path: Cable[] = [];
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: Cable[] }> = [{ nodeId: fromNodeId, path: [] }];
    visited.add(fromNodeId);
    
    while (queue.length > 0) {
      const { nodeId, path: currentPath } = queue.shift()!;
      
      if (nodeId === toNodeId) {
        return currentPath;
      }
      
      const outgoingCables = project.cables.filter(
        c => c.nodeAId === nodeId || c.nodeBId === nodeId
      );
      
      for (const cable of outgoingCables) {
        const nextNodeId = cable.nodeAId === nodeId ? cable.nodeBId : cable.nodeAId;
        
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          queue.push({ nodeId: nextNodeId, path: [...currentPath, cable] });
        }
      }
    }
    
    return path;
  }

  /**
   * Calcul itératif avec régulation SRG2
   * DIAGNOSTIC ID: vérifie la cohérence des IDs pendant toute la simulation
   * @param calculationResults - Résultats de calcul existants pour lecture des tensions naturelles (optionnel)
   */
  private calculateWithSRG2Regulation(
    project: Project,
    scenario: CalculationScenario,
    srg2Devices: SRG2Config[],
    calculationResults?: { [key: string]: CalculationResult }
  ): CalculationResult {
    console.log(`🔍 DIAGNOSTIC ID - Début calculateWithSRG2Regulation`);
    console.log(`📋 IDs des SRG2:`, srg2Devices.map(srg2 => `${srg2.id} -> nœud ${srg2.nodeId}`));
    console.log(`📋 IDs des nœuds du projet:`, project.nodes.map(n => `${n.id} (${n.name})`));
    
    // Vérifier que tous les SRG2 ont des nœuds correspondants
    for (const srg2 of srg2Devices) {
      const nodeExists = project.nodes.find(n => n.id === srg2.nodeId);
      if (!nodeExists) {
        console.error(`❌ SRG2 ${srg2.id} référence un nœud inexistant: ${srg2.nodeId}`);
      } else {
        console.log(`✅ SRG2 ${srg2.id} -> nœud trouvé: ${nodeExists.id} (${nodeExists.name})`);
      }
    }
    
    let iteration = 0;
    let converged = false;
    let previousVoltages: Map<string, {A: number, B: number, C: number}> = new Map();
    
    // Copie des nœuds pour modification itérative
    const workingNodes = JSON.parse(JSON.stringify(project.nodes)) as Node[];
    
    // Stocker les tensions originales avant toute modification SRG2
    const originalVoltages = new Map<string, {A: number, B: number, C: number}>();
    
    // === LECTURE TENSIONS NATURELLES depuis calculationResults (cohérence avec affichage) ===
    const existingResult = calculationResults?.[scenario];
    
    if (existingResult?.nodeMetricsPerPhase) {
      console.log('[DEBUG SRG2] === Lecture tensions depuis calculationResults (COHÉRENCE AFFICHAGE) ===');
      
      for (const srg2 of srg2Devices) {
        const nodeMetrics = existingResult.nodeMetricsPerPhase.find(nm => 
          String(nm.nodeId) === String(srg2.nodeId)
        );
        
        if (nodeMetrics?.voltagesPerPhase) {
          originalVoltages.set(srg2.nodeId, {
            A: nodeMetrics.voltagesPerPhase.A,
            B: nodeMetrics.voltagesPerPhase.B,
            C: nodeMetrics.voltagesPerPhase.C
          });
          console.log(`[DEBUG SRG2] ✅ Tensions lues depuis calculationResults pour ${srg2.nodeId}: A=${nodeMetrics.voltagesPerPhase.A.toFixed(1)}V, B=${nodeMetrics.voltagesPerPhase.B.toFixed(1)}V, C=${nodeMetrics.voltagesPerPhase.C.toFixed(1)}V`);
        } else {
          // Fallback sur les tensions moyennes triphasées si per-phase non disponible
          const nodeResult = existingResult.nodeMetrics?.find(nm => 
            String(nm.nodeId) === String(srg2.nodeId)
          );
          const fallbackVoltage = nodeResult?.V_phase_V ?? 230;
          originalVoltages.set(srg2.nodeId, {
            A: fallbackVoltage,
            B: fallbackVoltage,
            C: fallbackVoltage
          });
          console.log(`[DEBUG SRG2] ⚠️ Fallback tensions depuis calculationResults pour ${srg2.nodeId}: ${fallbackVoltage.toFixed(1)}V`);
        }
      }
    } else {
      // Fallback : calculer si calculationResults non disponible
      console.warn('[DEBUG SRG2] ⚠️ calculationResults non disponible, calcul naturel de secours');
      
      const nodesWithoutSRG2Flag = project.nodes.map(n => ({
        ...n,
        hasSRG2Device: false
      }));
      
      const naturalResult = this.calculateScenario(
        nodesWithoutSRG2Flag,
        project.cables,
        project.cableTypes,
        scenario,
        project.foisonnementCharges,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        project.manualPhaseDistribution,
        project.clientsImportes,
        project.clientLinks,
        project.foisonnementChargesResidentiel,
        project.foisonnementChargesIndustriel
      );
      
      for (const srg2 of srg2Devices) {
        const nodeMetrics = naturalResult.nodeMetricsPerPhase?.find(nm => 
          String(nm.nodeId) === String(srg2.nodeId)
        );
        
        if (nodeMetrics?.voltagesPerPhase) {
          originalVoltages.set(srg2.nodeId, {
            A: nodeMetrics.voltagesPerPhase.A,
            B: nodeMetrics.voltagesPerPhase.B,
            C: nodeMetrics.voltagesPerPhase.C
          });
        } else {
          const nodeResult = naturalResult.nodeMetrics?.find(nm => 
            String(nm.nodeId) === String(srg2.nodeId)
          );
          const fallbackVoltage = nodeResult?.V_phase_V ?? 230;
          originalVoltages.set(srg2.nodeId, {
            A: fallbackVoltage,
            B: fallbackVoltage,
            C: fallbackVoltage
          });
        }
      }
    }
    
    console.log('[DEBUG SRG2] Tensions naturelles stockées pour', originalVoltages.size, 'nœuds SRG2');
    
    // Copie des câbles pour modification itérative (injection tension série)
    let workingCables = JSON.parse(JSON.stringify(project.cables)) as Cable[];
    
    // Mémoire des états de commutateurs pour détection de stabilisation
    let previousSwitchStates = new Map<string, { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }>();
    
    while (!converged && iteration < SimulationCalculator.SIM_MAX_ITERATIONS) {
      iteration++;
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 1: Nettoyer les tensions série des câbles (itération > 1)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (iteration > 1) {
        this.cleanupSRG2SerieVoltage(workingCables);
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 2: Calculer le scénario BFS (avec tensions série des itérations précédentes)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const result = this.calculateScenario(
        workingNodes,
        workingCables,
        project.cableTypes,
        scenario,
        project.foisonnementCharges,
        project.foisonnementProductions,
        project.transformerConfig,
        project.loadModel,
        project.desequilibrePourcent,
        project.manualPhaseDistribution,
        project.clientsImportes,
        project.clientLinks,
        project.foisonnementChargesResidentiel,
        project.foisonnementChargesIndustriel
      );

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 3: Appliquer la régulation SRG2 - Calculer tensions série
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let tapChange = false;
      const currentSwitchStates = new Map<string, { A: SRG2SwitchState; B: SRG2SwitchState; C: SRG2SwitchState }>();
      
      for (const srg2 of srg2Devices) {
        // Utiliser les tensions originales stockées pour la décision de régulation
        let nodeVoltages = originalVoltages.get(srg2.nodeId) || { A: 230, B: 230, C: 230 };
        
        console.log(`🔍 SRG2 ${srg2.nodeId}: tensions originales - A=${nodeVoltages.A.toFixed(1)}V, B=${nodeVoltages.B.toFixed(1)}V, C=${nodeVoltages.C.toFixed(1)}V`);

        // Appliquer la régulation SRG2 sur les tensions lues
        const regulationResult = this.applySRG2Regulation(srg2, nodeVoltages, project.voltageSystem);
        
        // Stocker l'état du commutateur
        if (regulationResult.etatCommutateur) {
          currentSwitchStates.set(srg2.nodeId, { ...regulationResult.etatCommutateur });
          
          // Détecter si le commutateur a changé
          const prevState = previousSwitchStates.get(srg2.nodeId);
          if (!prevState || 
              prevState.A !== regulationResult.etatCommutateur.A ||
              prevState.B !== regulationResult.etatCommutateur.B ||
              prevState.C !== regulationResult.etatCommutateur.C) {
            tapChange = true;
            console.log(`🔧 SRG2 ${srg2.nodeId} changement de prise: ` +
              `${prevState ? `${prevState.A}/${prevState.B}/${prevState.C}` : 'INIT'} → ` +
              `${regulationResult.etatCommutateur.A}/${regulationResult.etatCommutateur.B}/${regulationResult.etatCommutateur.C}`);
          }
          
          // Mettre à jour les informations du SRG2 pour l'affichage
          srg2.tensionEntree = regulationResult.tensionEntree;
          srg2.etatCommutateur = regulationResult.etatCommutateur;
          srg2.coefficientsAppliques = regulationResult.coefficientsAppliques;
          srg2.tensionSortie = regulationResult.tensionSortie;
        }
        
        // ✅ NOUVEAU: Appliquer la tension série au câble (au lieu de marquer le nœud)
        if (regulationResult.coefficientsAppliques && regulationResult.tensionEntree) {
          this.applySRG2SerieVoltage(
            workingCables,
            srg2,
            regulationResult.tensionEntree,
            regulationResult.coefficientsAppliques
          );
        }
      }
      
      // Mettre à jour les états précédents
      previousSwitchStates = new Map(currentSwitchStates);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ÉTAPE 4: Vérifier la convergence (automate à seuil: tap_change == 0)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (!tapChange && iteration > 1) {
        console.log(`✅ SRG2 CONVERGENCE: Pas de changement de prise (iteration ${iteration})`);
        converged = true;
      } else {
        console.log(`🔄 SRG2 Iteration ${iteration}: tap_change=${tapChange}`);
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CALCUL FINAL: BFS avec tensions série stabilisées
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const finalResult = this.calculateScenario(
      workingNodes,
      workingCables,
      project.cableTypes,
      scenario,
      project.foisonnementCharges,
      project.foisonnementProductions,
      project.transformerConfig,
      project.loadModel,
      project.desequilibrePourcent,
      project.manualPhaseDistribution,
      project.clientsImportes,
      project.clientLinks,
      project.foisonnementChargesResidentiel,
      project.foisonnementChargesIndustriel
    );

    console.log(`🎯 SRG2 calcul final terminé (${iteration} itérations, convergé: ${converged})`);
    console.log(`   Modèle: injection tension série (V_v = V_u - Z*I + V_série)`);

    return {
      ...finalResult,
      srg2Results: srg2Devices.map(srg2 => ({
        srg2Id: srg2.id,
        nodeId: srg2.nodeId,
        tensionAvant_V: srg2.tensionEntree?.A || 0,
        tensionApres_V: srg2.tensionSortie?.A || 0,
        puissanceReactive_kVAr: 0,
        ameliorationTension_V: (srg2.tensionSortie?.A || 0) - (srg2.tensionEntree?.A || 0),
        erreurRésiduelle_V: Math.abs((srg2.tensionSortie?.A || 0) - 230),
        efficacite_percent: Math.min(100, Math.max(0, (1 - Math.abs((srg2.tensionSortie?.A || 0) - 230) / 230) * 100)),
        tauxCharge_percent: 0,
        regulationActive: srg2.etatCommutateur?.A !== 'BYP',
        saturePuissance: false,
        convergence: converged
      })),
      convergenceStatus: converged ? 'converged' : 'not_converged',
      iterations: iteration
    } as CalculationResult & {
      srg2Results: SRG2SimulationResult[];
      convergenceStatus: 'converged' | 'not_converged';
      iterations: number;
    };
  }


  /**
   * Applique la régulation SRG2 selon les seuils et contraintes
   */
  private applySRG2Regulation(
    srg2: SRG2Config, 
    nodeVoltages: {A: number, B: number, C: number}, 
    voltageSystem: string
  ): {
    tensionEntree: {A: number, B: number, C: number},
    etatCommutateur: {A: SRG2SwitchState, B: SRG2SwitchState, C: SRG2SwitchState},
    coefficientsAppliques: {A: number, B: number, C: number},
    tensionSortie: {A: number, B: number, C: number}
  } {
    
    // Tensions d'entrée lues au nœud d'installation
    const tensionEntree = { ...nodeVoltages };
    
    console.log(`🔍 SRG2 régulation: tensions d'entrée A=${tensionEntree.A.toFixed(1)}V, B=${tensionEntree.B.toFixed(1)}V, C=${tensionEntree.C.toFixed(1)}V`);

    // Déterminer l'état du commutateur pour chaque phase
    const etatCommutateur = {
      A: this.determineSwitchState(tensionEntree.A, srg2),
      B: this.determineSwitchState(tensionEntree.B, srg2),
      C: this.determineSwitchState(tensionEntree.C, srg2)
    };
    
    console.log(`⚙️ SRG2 états commutateurs: A=${etatCommutateur.A}, B=${etatCommutateur.B}, C=${etatCommutateur.C}`);

    // Appliquer les contraintes SRG2-230 si nécessaire
    if (srg2.type === 'SRG2-230') {
      this.applySRG230Constraints(etatCommutateur, tensionEntree, srg2);
    }

    // Calculer les coefficients appliqués
    const coefficientsAppliques = {
      A: this.getVoltageCoefficient(etatCommutateur.A, srg2),
      B: this.getVoltageCoefficient(etatCommutateur.B, srg2),
      C: this.getVoltageCoefficient(etatCommutateur.C, srg2)
    };

    // Calculer les tensions de sortie
    const tensionSortie = {
      A: tensionEntree.A * (1 + coefficientsAppliques.A / 100),
      B: tensionEntree.B * (1 + coefficientsAppliques.B / 100),
      C: tensionEntree.C * (1 + coefficientsAppliques.C / 100)
    };
    
    console.log(`🔧 SRG2 tensions de sortie: A=${tensionSortie.A.toFixed(1)}V, B=${tensionSortie.B.toFixed(1)}V, C=${tensionSortie.C.toFixed(1)}V`);

    return {
      tensionEntree,
      etatCommutateur,
      coefficientsAppliques,
      tensionSortie
    };
  }

  /**
   * Détermine l'état du commutateur selon les seuils de tension
   * Logique: évaluer dans l'ordre pour déterminer l'action nécessaire
   */
  private determineSwitchState(tension: number, srg2: SRG2Config): SRG2SwitchState {
    console.log(`🔍 SRG2 ${srg2.id}: Évaluation seuils pour tension=${tension.toFixed(1)}V`);
    console.log(`📋 Seuils: LO2=${srg2.seuilLO2_V}V, LO1=${srg2.seuilLO1_V}V, BO1=${srg2.seuilBO1_V}V, BO2=${srg2.seuilBO2_V}V`);
    
    // Tensions trop hautes (abaissement nécessaire)
    if (tension >= srg2.seuilLO2_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V >= ${srg2.seuilLO2_V}V → LO2 (abaissement complet)`);
      return 'LO2';
    }
    if (tension >= srg2.seuilLO1_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V >= ${srg2.seuilLO1_V}V → LO1 (abaissement partiel)`);
      return 'LO1';
    }
    
    // Tensions trop basses (boost nécessaire)  
    if (tension <= srg2.seuilBO2_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V <= ${srg2.seuilBO2_V}V → BO2 (boost complet)`);
      return 'BO2';
    }
    if (tension < srg2.seuilLO1_V && tension > srg2.seuilBO1_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V entre ${srg2.seuilBO1_V}V et ${srg2.seuilLO1_V}V → BYP (plage acceptable)`);
      return 'BYP';
    }
    if (tension <= srg2.seuilBO1_V) {
      console.log(`➡️ Tension ${tension.toFixed(1)}V <= ${srg2.seuilBO1_V}V → BO1 (boost partiel)`);
      return 'BO1';
    }
    
    // Fallback (ne devrait pas arriver)
    console.log(`⚠️ Tension ${tension.toFixed(1)}V - cas non prévu → BYP (fallback)`);
    return 'BYP';
  }

  /**
   * Applique les contraintes du SRG2-230 (si une phase monte, les autres ne peuvent descendre)
   */
  private applySRG230Constraints(
    etatCommutateur: {A: SRG2SwitchState, B: SRG2SwitchState, C: SRG2SwitchState},
    tensionEntree: {A: number, B: number, C: number},
    srg2: SRG2Config
  ): void {
    const phases = ['A', 'B', 'C'] as const;
    const etats = [etatCommutateur.A, etatCommutateur.B, etatCommutateur.C];
    
    // Vérifier s'il y a des directions opposées
    const hasBoost = etats.some(etat => etat === 'BO1' || etat === 'BO2');
    const hasLower = etats.some(etat => etat === 'LO1' || etat === 'LO2');
    
    if (hasBoost && hasLower) {
      // Trouver la phase avec le plus grand écart par rapport à 230V
      let maxDeviation = 0;
      let dominantDirection: 'boost' | 'lower' = 'boost';
      
      phases.forEach(phase => {
        const tension = tensionEntree[phase];
        const deviation = Math.abs(tension - 230);
        if (deviation > maxDeviation) {
          maxDeviation = deviation;
          dominantDirection = tension > 230 ? 'lower' : 'boost';
        }
      });
      
      // Appliquer la contrainte: bloquer la direction opposée
      phases.forEach(phase => {
        const etat = etatCommutateur[phase];
        if (dominantDirection === 'lower' && (etat === 'BO1' || etat === 'BO2')) {
          etatCommutateur[phase] = 'BYP';
        } else if (dominantDirection === 'boost' && (etat === 'LO1' || etat === 'LO2')) {
          etatCommutateur[phase] = 'BYP';
        }
      });
    }
  }

  /**
   * Retourne le coefficient de tension selon l'état du commutateur
   */
  private getVoltageCoefficient(etat: SRG2SwitchState, srg2: SRG2Config): number {
    switch (etat) {
      case 'LO2': return srg2.coefficientLO2;
      case 'LO1': return srg2.coefficientLO1;
      case 'BYP': return 0;
      case 'BO1': return srg2.coefficientBO1;
      case 'BO2': return srg2.coefficientBO2;
    }
  }

  /**
   * ============================================================================
   * NOUVEAU MODÈLE SRG2: INJECTION DE TENSION SÉRIE
   * ============================================================================
   * Le SRG2 n'impose plus les tensions aux nœuds. Au lieu de cela, il injecte une
   * tension SÉRIE dans le câble qui mène au nœud d'installation.
   * 
   * Formule BFS: V_v = V_u - Z * I_uv + V_série
   * 
   * Cette approche respecte la physique du réseau:
   * - L'amont peut peu bouger
   * - L'aval peut monter ou descendre selon l'impédance des lignes
   * - EQUI8 (injection courant shunt) et SRG2 (injection tension série) cohabitent naturellement
   * ============================================================================
   */
  private applySRG2SerieVoltage(
    cables: Cable[],
    srg2Device: SRG2Config,
    tensionEntree: { A: number; B: number; C: number },
    coefficients: { A: number; B: number; C: number }
  ): void {
    console.log(`🔧 SRG2 ${srg2Device.id}: Calcul tension série pour nœud ${srg2Device.nodeId}`);
    
    // Trouver le câble qui ARRIVE au nœud SRG2 (câble dont nodeBId === srg2.nodeId)
    const targetCable = cables.find(c => 
      c.nodeBId === srg2Device.nodeId || c.nodeAId === srg2Device.nodeId
    );
    
    if (!targetCable) {
      console.error(`❌ SRG2 ${srg2Device.id}: Aucun câble trouvé pour le nœud ${srg2Device.nodeId}`);
      return;
    }
    
    // Calculer les tensions série à injecter pour chaque phase
    // V_série = coefficient × V_entrée
    // Exemple: coefficient = +7% → V_série = 0.07 × 230 = +16.1V (boost)
    // Exemple: coefficient = -7% → V_série = -0.07 × 230 = -16.1V (buck)
    
    const Vnom = 230; // Tension nominale phase-neutre
    
    const serieVoltages = {
      A: C(coefficients.A / 100 * Vnom, 0),  // Phase A: 0°
      B: C(
        coefficients.B / 100 * Vnom * Math.cos(-2 * Math.PI / 3),
        coefficients.B / 100 * Vnom * Math.sin(-2 * Math.PI / 3)
      ),  // Phase B: -120°
      C: C(
        coefficients.C / 100 * Vnom * Math.cos(2 * Math.PI / 3),
        coefficients.C / 100 * Vnom * Math.sin(2 * Math.PI / 3)
      )   // Phase C: +120°
    };
    
    // Affecter les tensions série au câble
    targetCable.serieVoltagePerPhase = serieVoltages;
    targetCable.srg2Id = srg2Device.id;
    
    console.log(`✅ SRG2 câble ${targetCable.id}: V_série = ` +
      `A=${abs(serieVoltages.A).toFixed(1)}V, ` +
      `B=${abs(serieVoltages.B).toFixed(1)}V, ` +
      `C=${abs(serieVoltages.C).toFixed(1)}V`);
    console.log(`   Coefficients: A=${coefficients.A.toFixed(1)}%, B=${coefficients.B.toFixed(1)}%, C=${coefficients.C.toFixed(1)}%`);
  }

  /**
   * Nettoie les tensions série SRG2 des câbles après calcul
   */
  private cleanupSRG2SerieVoltage(cables: Cable[]): void {
    for (const cable of cables) {
      if (cable.serieVoltagePerPhase) {
        cable.serieVoltagePerPhase = undefined;
        cable.srg2Id = undefined;
      }
    }
  }

  /**
   * @deprecated - Remplacé par applySRG2SerieVoltage
   * Ancienne méthode qui marquait les nœuds avec hasSRG2Device
   */
  private applySRG2Coefficients(
    nodes: Node[],
    srg2Device: SRG2Config,
    coefficients: { A: number; B: number; C: number },
    tensionSortie: { A: number; B: number; C: number }
  ): void {
    // ============================================================================
    // @deprecated - Cette méthode est conservée pour compatibilité mais n'est plus
    // utilisée par le nouveau modèle d'injection série.
    // Le SRG2 agit maintenant via serieVoltagePerPhase sur les câbles.
    // ============================================================================
    console.log(`⚠️ [DEPRECATED] applySRG2Coefficients appelé - utiliser applySRG2SerieVoltage`);
    console.log(`   SRG2 ${srg2Device.id} sur nœud ${srg2Device.nodeId}`);
    console.log(`   Coefficients: A=${coefficients.A.toFixed(1)}%, B=${coefficients.B.toFixed(1)}%, C=${coefficients.C.toFixed(1)}%`);

    // Trouver le nœud correspondant (conservé pour compatibilité)
    const nodeIndex = nodes.findIndex(n => String(n.id) === String(srg2Device.nodeId));
    if (nodeIndex === -1) {
      console.error(`❌ Nœud SRG2 non trouvé: ${srg2Device.nodeId}`);
      return;
    }

    // Marquer le nœud (ancien modèle - désactivé dans le BFS)
    nodes[nodeIndex].hasSRG2Device = true;
    nodes[nodeIndex].srg2RegulationCoefficients = { ...coefficients };
    nodes[nodeIndex].srg2TensionSortie = { ...tensionSortie };
  }

  /**
   * Vérifie la convergence de la régulation SRG2
   */
  /**
   * Vérifie la convergence SRG2 basée sur l'état des prises (automate à seuil)
   * Retourne true si les positions de prise sont identiques entre deux itérations
   * (Le SRG2 est un automate à seuil, pas un régulateur PID)
   */
  private checkSRG2Convergence(
    currentTaps: Map<string, {A: number, B: number, C: number}>,
    previousTaps: Map<string, {A: number, B: number, C: number}>
  ): boolean {
    
    if (previousTaps.size === 0) return false;
    
    for (const [nodeId, current] of currentTaps) {
      const previous = previousTaps.get(nodeId);
      if (!previous) return false;
      
      // Comparaison exacte des coefficients de prise (pas de tolérance)
      // Les coefficients sont des valeurs discrètes (ex: -7, -3.5, 0, +3.5, +7)
      if (current.A !== previous.A || 
          current.B !== previous.B || 
          current.C !== previous.C) {
        return false;
      }
    }
    
    return true;
  }

  // SUPPRIMÉ - Méthodes des régulateurs
  
  /**
   * Nettoie les marqueurs SRG2 après calcul pour éviter les interférences
   * PROTECTION CONTRE MUTATION: préserve les IDs originaux
   */
  private cleanupSRG2Markers(nodes: Node[]): void {
    console.log(`🔍 DIAGNOSTIC ID - Début cleanupSRG2Markers`);
    console.log(`📋 IDs des nœuds avant nettoyage:`, nodes.map(n => `${n.id} (hasSRG2Device: ${!!n.hasSRG2Device})`));
    
    for (const node of nodes) {
      if (node.hasSRG2Device) {
        // Sauvegarder l'ID original avant nettoyage
        const originalId = node.id;
        
        // Nettoyer les marqueurs SRG2
        node.hasSRG2Device = undefined;
        node.srg2RegulationCoefficients = undefined;
        node.srg2TensionSortie = undefined;
        
        // Vérifier que l'ID n'a pas été corrompu pendant le nettoyage
        if (node.id !== originalId) {
          console.error(`🚨 CORRUPTION ID lors du nettoyage ! Original: ${originalId}, Actuel: ${node.id}`);
          node.id = originalId; // Restaurer l'ID
        }
        
        console.log(`🧹 Nettoyage marqueurs SRG2 pour nœud ${node.id} (ID préservé)`);
      }
    }
    
    console.log(`🔍 DIAGNOSTIC ID - Fin cleanupSRG2Markers`);
    console.log(`📋 IDs des nœuds après nettoyage:`, nodes.map(n => `${n.id} (hasSRG2Device: ${!!n.hasSRG2Device})`));
  }
  
  /**
   * Propose des améliorations de circuit complètes
   */
  proposeFullCircuitReinforcement(
    cables: Cable[],
    cableTypes: CableType[],
    threshold: number = 5
  ): CableUpgrade[] {
    return cables
      .filter(cable => (cable.voltageDropPercent || 0) > threshold)
      .map(cable => {
        const currentType = cableTypes.find(t => t.id === cable.typeId);
        const betterType = cableTypes.find(t => 
          t.R12_ohm_per_km < (currentType?.R12_ohm_per_km || Infinity)
        );
        
        return {
          originalCableId: cable.id,
          newCableTypeId: betterType?.id || cable.typeId,
          reason: 'voltage_drop' as const,
          before: {
            voltageDropPercent: cable.voltageDropPercent || 0,
            current_A: cable.current_A || 0,
            losses_kW: cable.losses_kW || 0
          },
          after: {
            voltageDropPercent: (cable.voltageDropPercent || 0) * 0.7,
            current_A: cable.current_A || 0,
            losses_kW: (cable.losses_kW || 0) * 0.7
          },
          improvement: {
            voltageDropReduction: (cable.voltageDropPercent || 0) * 0.3,
            lossReduction_kW: (cable.losses_kW || 0) * 0.3,
            lossReductionPercent: 30
          }
        };
      });
  }
}