import { Node, Cable, Project, CalculationResult, CalculationScenario, ConnectionType, CableType, TransformerConfig, VirtualBusbar, LoadModel, ClientImporte, ClientLink, CablePose } from '@/types/network';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { Complex, C, add, sub, mul, div, conj, scale, abs, fromPolar, arg } from '@/utils/complex';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';
import { getLinkedClientsForNode, calculateNodePowersFromClients } from '@/utils/clientsUtils';
import { getThermalCorrectionFactor, ThermalSeason, getAmbientTemperature, calculateCableTemperature } from '@/utils/thermalModel';

export class ElectricalCalculator {
  private cosPhi: number; // Legacy - utilisé comme fallback
  private cosPhiCharges: number; // Cos phi des charges (consommation)
  private cosPhiProductions: number; // Cos phi des productions (PV/Cogen)

  // Constantes pour la robustesse et maintenabilité
  private static readonly CONVERGENCE_TOLERANCE = 1e-4;
  private static readonly MAX_ITERATIONS = 100;
  private static readonly VOLTAGE_400V_THRESHOLD = 350;
  private static readonly MIN_VOLTAGE_SAFETY = 1e-6;
  private static readonly SMALL_IMPEDANCE_SAFETY = 1e-12;

  constructor(cosPhi: number = 0.95, cosPhiCharges?: number, cosPhiProductions?: number) {
    this.validateCosPhi(cosPhi);
    this.cosPhi = cosPhi;
    // Utiliser les valeurs spécifiques ou le cosPhi global comme fallback
    this.cosPhiCharges = cosPhiCharges !== undefined ? cosPhiCharges : cosPhi;
    this.cosPhiProductions = cosPhiProductions !== undefined ? cosPhiProductions : 1.0;
    this.validateCosPhi(this.cosPhiCharges);
    this.validateCosPhi(this.cosPhiProductions);
  }

  private validateCosPhi(cosPhi: number): void {
    if (!isFinite(cosPhi) || cosPhi < 0 || cosPhi > 1) {
      throw new Error(`cosPhi doit être entre 0 et 1, reçu: ${cosPhi}`);
    }
  }

  setCosPhi(value: number) {
    this.validateCosPhi(value);
    this.cosPhi = value;
  }

  setCosPhiCharges(value: number) {
    this.validateCosPhi(value);
    this.cosPhiCharges = value;
  }

  setCosPhiProductions(value: number) {
    this.validateCosPhi(value);
    this.cosPhiProductions = value;
  }

  getCosPhiCharges(): number {
    return this.cosPhiCharges;
  }

  getCosPhiProductions(): number {
    return this.cosPhiProductions;
  }

  /**
   * Calcule la tension de source BT réelle basée sur la tension HT mesurée
   * et le rapport de transformation du transformateur
   * 
   * Formule: V_BT_réelle = V_HT_mesurée × (V_BT_nominale / V_HT_nominale)
   * 
   * @param transformerConfig Configuration du transformateur
   * @param htMeasuredVoltage Tension HT mesurée (V)
   * @param htNominalVoltage Tension HT nominale (V)
   * @param btNominalVoltage Tension BT nominale (V)
   * @returns Tension de source BT réelle (V)
   */
  calculateSourceVoltage(
    transformerConfig: TransformerConfig,
    htMeasuredVoltage: number,
    htNominalVoltage: number,
    btNominalVoltage: number
  ): number {
    // Validation des paramètres
    if (!isFinite(htMeasuredVoltage) || htMeasuredVoltage <= 0) {
      console.warn(`⚠️ Tension HT mesurée invalide: ${htMeasuredVoltage}V, utilisation tension nominale BT`);
      return transformerConfig.nominalVoltage_V;
    }
    
    if (!isFinite(htNominalVoltage) || htNominalVoltage <= 0) {
      console.warn(`⚠️ Tension HT nominale invalide: ${htNominalVoltage}V, utilisation tension nominale BT`);
      return transformerConfig.nominalVoltage_V;
    }
    
    if (!isFinite(btNominalVoltage) || btNominalVoltage <= 0) {
      console.warn(`⚠️ Tension BT nominale invalide: ${btNominalVoltage}V, utilisation configuration transformateur`);
      return transformerConfig.nominalVoltage_V;
    }
    
    // Calcul du rapport de transformation
    const transformationRatio = btNominalVoltage / htNominalVoltage;
    const realSourceVoltage = htMeasuredVoltage * transformationRatio;
    
    console.log(`📊 Calcul tension source réaliste:`);
    console.log(`   - Tension HT mesurée: ${htMeasuredVoltage.toFixed(1)}V`);
    console.log(`   - Tension HT nominale: ${htNominalVoltage.toFixed(1)}V`);
    console.log(`   - Tension BT nominale: ${btNominalVoltage.toFixed(1)}V`);
    console.log(`   - Rapport transformation: ${transformationRatio.toFixed(6)}`);
    console.log(`   - Tension source BT réelle: ${realSourceVoltage.toFixed(1)}V`);
    
    return realSourceVoltage;
  }

  /**
   * Détermine la tension de référence à utiliser pour les calculs
   * Priorité: tensionCible > calcul HT réaliste > tension nominale transformateur > tension base
   * 
   * @param source Nœud source
   * @param transformerConfig Configuration du transformateur
   * @param project Configuration du projet (pour config HT)
   * @param baseVoltage Tension de base par défaut
   * @returns Tension de référence (V)
   */
  private determineReferenceVoltage(
    source: Node,
    transformerConfig: TransformerConfig,
    project: Project,
    baseVoltage: number
  ): number {
    // 1. Priorité absolue: tension cible définie explicitement
    if (source.tensionCible) {
      console.log(`🎯 Utilisation tension cible explicite: ${source.tensionCible}V`);
      return source.tensionCible;
    }

    // 2. Priorité: tension source ajustée via slider (±5%)
    if (transformerConfig?.sourceVoltage) {
      console.log(`🎚️ Utilisation tension source (slider): ${transformerConfig.sourceVoltage}V`);
      return transformerConfig.sourceVoltage;
    }

    // 3. Si configuration HT disponible, calcul réaliste
    if (project.htVoltageConfig) {
      const {
        nominalVoltageHT_V,
        nominalVoltageBT_V,
        measuredVoltageHT_V
      } = project.htVoltageConfig;

      const realisticVoltage = this.calculateSourceVoltage(
        transformerConfig,
        measuredVoltageHT_V,
        nominalVoltageHT_V,
        nominalVoltageBT_V
      );
      
      console.log(`🔌 Utilisation tension HT réaliste: ${realisticVoltage.toFixed(1)}V`);
      return realisticVoltage;
    }

    // 4. Tension nominale du transformateur
    if (transformerConfig?.nominalVoltage_V) {
      console.log(`⚡ Utilisation tension nominale transformateur: ${transformerConfig.nominalVoltage_V}V`);
      return transformerConfig.nominalVoltage_V;
    }

    // 4. Tension de base par défaut
    console.log(`📋 Utilisation tension de base: ${baseVoltage}V`);
    return baseVoltage;
  }

  // ---- utilitaires ----
  private deg2rad(deg: number) { return deg * Math.PI / 180; }

  static calculateGeodeticDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  static calculateCableLength(coordinates: { lat:number; lng:number }[]): number {
    if (!coordinates || coordinates.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < coordinates.length; i++) {
      total += ElectricalCalculator.calculateGeodeticDistance(
        coordinates[i-1].lat, coordinates[i-1].lng,
        coordinates[i].lat, coordinates[i].lng
      );
    }
    return total;
  }

  calculateLengthMeters(coordinates: { lat:number; lng:number }[]): number {
    return ElectricalCalculator.calculateCableLength(coordinates);
  }

  private getVoltageConfig(connectionType: ConnectionType): { U: number; isThreePhase: boolean; useR0: boolean } {
    switch (connectionType) {
      case 'MONO_230V_PN':
        return { U: 230, isThreePhase: false, useR0: true }; // Phase-neutre = 230V
      case 'MONO_230V_PP':
        return { U: 230, isThreePhase: false, useR0: false };
      case 'TRI_230V_3F':
        return { U: 230, isThreePhase: true, useR0: false };
      case 'TÉTRA_3P+N_230_400V':
        return { U: 400, isThreePhase: true, useR0: false };
      default:
        return { U: 230, isThreePhase: true, useR0: false };
    }
  }

  private getVoltage(connectionType: ConnectionType): { U_base:number, isThreePhase:boolean } {
    const { U, isThreePhase } = this.getVoltageConfig(connectionType);
    return { U_base: U, isThreePhase };
  }

  // Conversion phase -> "tension affichée" selon le type de connexion
  // - TRI_230V_3F : tensions composées déjà à 230V (pas de facteur supplémentaire)
  // - TÉTRA_3P+N_230_400V : tensions composées à 400V, simples à 230V
  // - MONO_230V_PP: tension entre phases (mesure directe, pas de facteur)
  // - MONO_230V_PN: tension phase-neutre (mesure directe, pas de facteur)
  private getDisplayLineScale(connectionType: ConnectionType): number {
    switch (connectionType) {
      case 'TRI_230V_3F':
        return 1; // Pas de conversion, 230V direct entre phases
      case 'TÉTRA_3P+N_230_400V':
        return Math.sqrt(3); // Conversion phase → ligne pour 400V
      case 'MONO_230V_PP':
        return 1; // Tension entre phases (230V direct)
      case 'MONO_230V_PN':
        return 1; // Tension phase-neutre (230V direct)
      default:
        return 1;
    }
  }

  /**
   * Calcule l'impédance effective selon la formule GRD belge (ORES/RESA/Sibelga)
   * 
   * R = (R0 + 2*R12) / 3
   * X = (X0 + 2*X12) / 3
   * 
   * Cette formule combine les composantes de séquence directe (Z₁) et homopolaire (Z₀)
   * car le réseau de distribution BT est structurellement déséquilibré.
   * 
   * Sans cette correction, la chute de tension est sous-estimée de 40-67% sur certains câbles.
   * 
   * Référence: Modèles GRD belges (CYME, NEPLAN, PowerFactory)
   */
  private calculateGRDImpedance(cableType: CableType, thermalFactor: number = 1): { R: number, X: number } {
    // Appliquer la correction thermique sur R uniquement (X inchangé)
    const R12_corrected = cableType.R12_ohm_per_km * thermalFactor;
    const R0_corrected = cableType.R0_ohm_per_km * thermalFactor;
    const R = (R0_corrected + 2 * R12_corrected) / 3;
    const X = (cableType.X0_ohm_per_km + 2 * cableType.X12_ohm_per_km) / 3;
    return { R, X };
  }

  /**
   * Sélection des impédances R/X selon le type de réseau et le mode de calcul
   * 
   * FORMULE GRD BELGE appliquée pour les conducteurs de phase:
   * R = (R0 + 2*R12) / 3, X = (X0 + 2*X12) / 3
   * 
   * Avec correction thermique saisonnière optionnelle :
   * R(T) = R20 × (1 + α × (T - 20))
   * où T dépend de la saison, du type de pose et du courant de charge
   * 
   * @param cableType Type de câble
   * @param is400V true si réseau 400V étoile, false si 230V triangle
   * @param isUnbalanced true si calcul monophasé déséquilibré
   * @param forNeutral true si sélection pour conducteur neutre
   * @param thermalContext Contexte thermique optionnel pour correction de R
   */
  private selectRX(
    cableType: CableType, 
    is400V: boolean, 
    isUnbalanced: boolean,
    forNeutral: boolean = false,
    thermalContext?: { season: ThermalSeason; pose: CablePose; I_A?: number; Imax_A?: number }
  ): { R: number, X: number } {
    // Calcul du facteur de correction thermique
    let thermalFactor = 1;
    if (thermalContext) {
      thermalFactor = getThermalCorrectionFactor(
        thermalContext.season,
        thermalContext.pose,
        cableType.matiere,
        thermalContext.I_A || 0,
        thermalContext.Imax_A || cableType.maxCurrent_A || 0
      );
    }

    // Conducteur neutre → toujours R0/X0 (avec correction thermique)
    if (forNeutral) {
      return { 
        R: cableType.R0_ohm_per_km * thermalFactor, 
        X: cableType.X0_ohm_per_km 
      };
    }
    
    // Conducteurs de phase → formule GRD belge (R0 + 2*R12) / 3
    // Applicable en 230V triangle ET 400V étoile
    return this.calculateGRDImpedance(cableType, thermalFactor);
  }

  /**
   * Calcule le courant RMS par phase (A) à partir de la puissance apparente S_kVA.
   * ===== CONVENTIONS √3 HARMONISÉES =====
   * 
   * RÉSEAU 3×230V TRIANGLE (sans neutre) :
   * - La tension de référence pour le calcul du courant est V_LL = 230V (tension phase-phase).
   * - Les charges mono sont toujours entre deux phases (A-B, B-C, A-C).
   * - Aucun calcul ne doit utiliser une tension phase-neutre en 230V (pas de neutre physique).
   * 
   * RÉSEAU 3×400V + N ÉTOILE (avec neutre) :
   * - La tension phase-neutre est 230V, la tension ligne-ligne est 400V.
   * - Les charges mono peuvent être phase-neutre (230V) ou phase-phase (400V).
   * 
   * La conversion √3 est appliquée pour :
   * - Les charges triphasées ligne-ligne lors du calcul du courant
   * - L'affichage des tensions ligne-ligne (400V étoile)
   * 
   * Formules:
   * - Monophasé phase-phase (230V triangle): I = S / V_LL (V_LL = 230V)
   * - Monophasé phase-neutre (400V étoile): I = S / V_phase (V_phase = 230V)
   * - Triphasé équilibré: I = S / (√3 · V_LL)
   * 
   * S_kVA est la puissance apparente totale (kVA), positive en consommation, négative en injection.
   * sourceVoltage, s'il est fourni, est interprété comme V_LL (tri) ou V_phase (mono).
   */
  private calculateCurrentA(S_kVA: number, connectionType: ConnectionType, sourceVoltage?: number): number {
    let { U_base, isThreePhase } = this.getVoltage(connectionType);

    if (sourceVoltage) {
      U_base = sourceVoltage;
    }

    const Sabs_kVA = Math.abs(S_kVA);
    
    // ===== CONVENTION UNIFIÉE : √3 appliqué SEULEMENT pour triphasé ligne-ligne =====
    let denom: number;
    if (connectionType === 'MONO_230V_PN') {
      // Monophasé phase-neutre: I = S / U_phase
      denom = U_base;
    } else if (connectionType === 'MONO_230V_PP') {
      // Monophasé phase-phase: I = S / U_phase-phase
      denom = U_base;
    } else if (connectionType === 'TRI_230V_3F') {
      // Triangle 230V : I = S / (√3 × 230V)
      denom = Math.sqrt(3) * U_base;
    } else if (connectionType === 'TÉTRA_3P+N_230_400V') {
      // Étoile 400V : I = S / (√3 × 400V)
      denom = Math.sqrt(3) * U_base;
    } else {
      // Fallback générique
      denom = isThreePhase ? (Math.sqrt(3) * U_base) : U_base;
    }
    
    if (!isFinite(denom) || denom <= 0) {
      console.warn(`⚠️ Dénominateur invalide pour le calcul du courant: ${denom}, connectionType: ${connectionType}`);
      return 0;
    }
    return (Sabs_kVA * 1000) / denom;
  }

  private getComplianceStatus(voltageDropPercent: number): 'normal'|'warning'|'critical' {
    const absP = Math.abs(voltageDropPercent);
    if (absP <= 8) return 'normal';
    if (absP <= 10) return 'warning';
    return 'critical';
  }

  // [Supprimé] Ancienne formule simplifiée de ΔU transfo basée sur cosφ.
  // Les calculs transfo sont désormais exclusivement phasoriels via Ztr_phase et I_source_net.


  // Calcul du jeu de barres virtuel (phasors) avec analyse par départ
  private calculateVirtualBusbar(
    transformerConfig: TransformerConfig,
    totalLoads_kVA: number,
    totalProductions_kVA: number,
    source: Node,
    children: Map<string, string[]>,
    S_aval: Map<string, number>,
    V_node: Map<string, Complex>,
    I_source_net: Complex,
    Ztr_phase: Complex | null,
    cableIndexByPair: Map<string, Cable>,
    I_source_net_phases?: { A: Complex; B: Complex; C: Complex } // Pour I_N en mode déséquilibré
  ): VirtualBusbar {
    const { U_base: U_nom_source, isThreePhase: isSourceThree } = this.getVoltage(source.connectionType);
    const U_ref_line = source.tensionCible ?? transformerConfig.nominalVoltage_V ?? U_nom_source;

    // Tension slack de référence (phasor)
    const Vslack = C(U_ref_line / (isSourceThree ? Math.sqrt(3) : 1), 0);

    // ΔV transfo (phasor) et tension bus source (phasor)
    const dVtr = Ztr_phase ? mul(Ztr_phase, I_source_net) : C(0, 0);
    const V_bus = sub(Vslack, dVtr);

    const busVoltage_V = abs(V_bus) * (isSourceThree ? Math.sqrt(3) : 1);
    const netSkVA = totalLoads_kVA - totalProductions_kVA;
    const busCurrent_A = abs(I_source_net);

    // Courant neutre du jeu de barres (si 400V et mode déséquilibré)
    const is400V = U_ref_line >= 350;
    let current_N: number | undefined;
    if (is400V && I_source_net_phases) {
      const I_N = add(add(I_source_net_phases.A, I_source_net_phases.B), I_source_net_phases.C);
      current_N = abs(I_N);
    }

    // ΔU global appliqué au bus (en V, ligne)
    const dVtr_line = abs(dVtr) * (isSourceThree ? Math.sqrt(3) : 1);
    const sign = netSkVA > 0 ? -1 : (netSkVA < 0 ? 1 : 0);
    const dVtr_line_signed = sign * dVtr_line;

    // Récupérer les départs (voisins directs de la source)
    const sourceChildren = children.get(source.id) || [];
    const circuits: VirtualBusbar['circuits'] = [];

    const collectSubtreeNodes = (rootId: string): string[] => {
      const res: string[] = [];
      const stack2 = [rootId];
      while (stack2.length) {
        const u = stack2.pop()!;
        res.push(u);
        for (const v of children.get(u) || []) stack2.push(v);
      }
      return res;
    };

    // Calculer cosφ effectif pour Q
    const cosPhi_eff = Math.min(1, Math.max(0, this.cosPhi));
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi_eff * cosPhi_eff));

    for (const childId of sourceChildren) {
      const subtreeSkVA = S_aval.get(childId) || 0;
      const direction: 'injection' | 'prélèvement' = subtreeSkVA < 0 ? 'injection' : 'prélèvement';

      // Calcul de Q du circuit (kVAr)
      const subtreeQkVAr = Math.abs(subtreeSkVA) * sinPhi * Math.sign(subtreeSkVA);

      const cableId = cableIndexByPair.get(`${source.id}|${childId}`)?.id
        ?? cableIndexByPair.get(`${childId}|${source.id}`)?.id
        ?? 'unknown';

      // Courant du départ (approx. à partir de S et tension bus)
      const departCurrent_A = this.calculateCurrentA(subtreeSkVA, source.connectionType, busVoltage_V);

      // Part de ΔU transfo allouée proportionnellement à la puissance du sous-arbre
      const voltageShare = netSkVA !== 0 ? (dVtr_line_signed * (subtreeSkVA / netSkVA)) : 0;

      // Min/Max des tensions dans le sous-arbre à partir des phasors calculés
      const subtreeNodes = collectSubtreeNodes(childId);
      let minNodeVoltage = Number.POSITIVE_INFINITY;
      let maxNodeVoltage = Number.NEGATIVE_INFINITY;
      for (const nid of subtreeNodes) {
        const nV = V_node.get(nid);
        if (!nV) continue;
        // Conversion ligne/phase basée sur le type de connexion (fallback: type de la source)
        const nodeConnType: ConnectionType = nid === source.id
          ? source.connectionType
          : source.connectionType;
        const isThree = this.getVoltage(nodeConnType).isThreePhase;
        const scaleLine = this.getDisplayLineScale(nodeConnType);
        const U_node_line = abs(nV) * scaleLine;
        if (U_node_line < minNodeVoltage) minNodeVoltage = U_node_line;
        if (U_node_line > maxNodeVoltage) maxNodeVoltage = U_node_line;
      }
      if (subtreeNodes.length === 0 || !isFinite(minNodeVoltage)) {
        const U_node_line = abs(V_bus) * (isSourceThree ? Math.sqrt(3) : 1);
        minNodeVoltage = U_node_line;
        maxNodeVoltage = U_node_line;
      }

      circuits.push({
        circuitId: cableId,
        subtreeSkVA,
        subtreeQkVAr,
        direction,
        current_A: departCurrent_A,
        deltaU_V: voltageShare,
        voltageBus_V: busVoltage_V,
        minNodeVoltage_V: minNodeVoltage,
        maxNodeVoltage_V: maxNodeVoltage,
        nodesCount: subtreeNodes.length
      });
    }

    return {
      voltage_V: busVoltage_V,
      current_A: busCurrent_A,
      current_N,
      netSkVA,
      deltaU_V: dVtr_line_signed,
      deltaU_percent: U_ref_line ? (dVtr_line_signed / U_ref_line) * 100 : 0,
      losses_kW: (abs(I_source_net) ** 2) * (Ztr_phase?.re || 0) * (isSourceThree ? 3 : 1) / 1000,
      circuits
    };
  }

  /**
   * Version étendue de calculateScenario avec support de la configuration HT
   * @param project Projet contenant la configuration HT
   * @param scenario Scénario de calcul
   * @param foisonnementCharges Foisonnement des charges
   * @param foisonnementProductions Foisonnement des productions
   * @param manualPhaseDistribution Distribution manuelle des phases (optionnel)
   */
  calculateScenarioWithHTConfig(
    project: Project,
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} },
    clientsImportes?: ClientImporte[],
    clientLinks?: ClientLink[]
  ): CalculationResult {
    // Si configuration HT disponible, ajuster la tension de la source
    let modifiedNodes = [...project.nodes];
    
    if (project.htVoltageConfig && project.transformerConfig) {
      const {
        nominalVoltageHT_V,
        nominalVoltageBT_V,
        measuredVoltageHT_V
      } = project.htVoltageConfig;

      const sourceNode = modifiedNodes.find(n => n.isSource);
      if (sourceNode && !sourceNode.tensionCible) {
        // Calculer la tension source réaliste
        const realisticVoltage = this.calculateSourceVoltage(
          project.transformerConfig,
          measuredVoltageHT_V,
          nominalVoltageHT_V,
          nominalVoltageBT_V
        );

        // Créer une copie du nœud source avec la tension calculée
        const modifiedSourceNode = {
          ...sourceNode,
          tensionCible: realisticVoltage
        };

        // Remplacer le nœud source dans la liste
        modifiedNodes = modifiedNodes.map(n => 
          n.id === sourceNode.id ? modifiedSourceNode : n
        );

        console.log(`🔌 Application tension source HT réaliste: ${realisticVoltage.toFixed(1)}V`);
      }
    }

      // Appeler la méthode standard avec les nœuds modifiés
    return this.calculateScenario(
      modifiedNodes,
      project.cables,
      project.cableTypes,
      scenario,
      foisonnementCharges,
      foisonnementProductions,
      project.transformerConfig,
      project.loadModel ?? 'mixte_mono_poly',
      project.desequilibrePourcent ?? 0,
      manualPhaseDistribution,
      clientsImportes,
      clientLinks,
      (project as any).foisonnementChargesResidentiel,
      (project as any).foisonnementChargesIndustriel,
      undefined, // equi8CurrentInjections
      project.season as ThermalSeason | undefined
    );
  }
  calculateScenario(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    scenario: CalculationScenario,
    foisonnementCharges: number = 100,
    foisonnementProductions: number = 100,
    transformerConfig?: TransformerConfig,
    loadModel: LoadModel = 'mixte_mono_poly',
    desequilibrePourcent: number = 0,
    manualPhaseDistribution?: { charges: {A:number;B:number;C:number}; productions: {A:number;B:number;C:number} },
    clientsImportes?: ClientImporte[],
    clientLinks?: ClientLink[],
    foisonnementChargesResidentiel?: number,
    foisonnementChargesIndustriel?: number,
    // ✅ EQUI8 CME: Injections de courant shunt par nœud (source de courant)
    equi8CurrentInjections?: Map<string, { 
      I_neutral: { re: number; im: number };   // +I_EQUI8 sur neutre
      I_phaseA: { re: number; im: number };    // -I_EQUI8/3 sur phase A
      I_phaseB: { re: number; im: number };    // -I_EQUI8/3 sur phase B
      I_phaseC: { re: number; im: number };    // -I_EQUI8/3 sur phase C
      magnitude: number;                        // Magnitude de I_EQUI8
    }>,
    // Saison pour correction thermique des câbles
    season?: ThermalSeason
  ): CalculationResult {
    // Validation robuste des entrées
    this.validateInputs(nodes, cables, cableTypes, foisonnementCharges, foisonnementProductions, desequilibrePourcent);
    
    console.log('🔄 calculateScenario started for scenario:', scenario, 'with nodes:', nodes.length, 'cables:', cables.length);
    const nodeById = new Map(nodes.map(n => [n.id, n] as const));
    const cableTypeById = new Map(cableTypes.map(ct => [ct.id, ct] as const));

    const sources = nodes.filter(n => n.isSource);
    console.log('🔄 Found sources:', sources.length);
    if (sources.length !== 1) throw new Error('Le réseau doit avoir exactement une source.');
    const source = sources[0];

    const adj = new Map<string, { cableId:string; neighborId:string }[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const cable of cables) {
      if (!nodeById.has(cable.nodeAId) || !nodeById.has(cable.nodeBId)) continue;
      adj.get(cable.nodeAId)!.push({ cableId:cable.id, neighborId:cable.nodeBId });
      adj.get(cable.nodeBId)!.push({ cableId:cable.id, neighborId:cable.nodeAId });
    }

    const parent = new Map<string, string | null>();
    const visited = new Set<string>();
    const queue: string[] = [source.id];
    parent.set(source.id, null);
    visited.add(source.id);

    while (queue.length) {
      const u = queue.shift()!;
      for (const edge of adj.get(u) || []) {
        if (!visited.has(edge.neighborId)) {
          visited.add(edge.neighborId);
          parent.set(edge.neighborId, u);
          queue.push(edge.neighborId);
        }
      }
    }

    const S_eq = new Map<string, number>();
    const S_prel_map = new Map<string, number>(); // Charges brutes par nœud
    const S_pv_map = new Map<string, number>();   // Productions brutes par nœud
    
    for (const n of nodes) {
      let S_prel = 0;
      let S_pv = 0;
      
      // Si des clients importés sont disponibles, utiliser le foisonnement différencié par type
      if (clientsImportes && clientLinks) {
        const linkedClients = getLinkedClientsForNode(n.id, clientsImportes, clientLinks);
        
        // Foisonnement différencié par type de client
        const foisonnementResidentiel = foisonnementChargesResidentiel ?? foisonnementCharges;
        const foisonnementIndustriel = foisonnementChargesIndustriel ?? foisonnementCharges;
        
        for (const client of linkedClients) {
          const foisonnement = client.clientType === 'industriel' 
            ? foisonnementIndustriel 
            : foisonnementResidentiel;
          S_prel += client.puissanceContractuelle_kVA * (foisonnement / 100);
        }
        
        // Productions (foisonnement unique)
        const totalProduction_kVA = linkedClients.reduce((sum, c) => sum + c.puissancePV_kVA, 0);
        S_pv = totalProduction_kVA * (foisonnementProductions / 100);
        
        // Charges manuelles du nœud (considérées comme résidentielles)
        const manualCharges = (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0);
        S_prel += manualCharges * (foisonnementResidentiel / 100);
        
        // Productions manuelles du nœud
        const manualProductions = (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0);
        S_pv += manualProductions * (foisonnementProductions / 100);
        
        // 🔍 DIAGNOSTIC : Tracer les sources de puissance au nœud
        if (linkedClients.length > 0 || manualCharges > 0) {
          console.log(`🔍 [DEBUG] Nœud "${n.name || n.id}" - Calcul S_prel_map:`);
          console.log(`   📋 Clients liés: ${linkedClients.length}`);
          for (const client of linkedClients) {
            const foisonnement = client.clientType === 'industriel' 
              ? foisonnementIndustriel 
              : foisonnementResidentiel;
            console.log(`      - "${client.nomCircuit}": ${client.puissanceContractuelle_kVA} kVA × ${foisonnement}% = ${(client.puissanceContractuelle_kVA * foisonnement / 100).toFixed(2)} kVA (${client.clientType || 'résidentiel'}, ${client.connectionType || client.couplage})`);
          }
          console.log(`   🔧 Charges manuelles: ${manualCharges} kVA × ${foisonnementResidentiel}% = ${(manualCharges * foisonnementResidentiel / 100).toFixed(2)} kVA`);
          console.log(`   ➡️ S_prel TOTAL: ${S_prel.toFixed(2)} kVA`);
          
          // Comparer avec autoPhaseDistribution.foisonneAvecCurseurs
          if (n.autoPhaseDistribution?.charges.foisonneAvecCurseurs) {
            const fac = n.autoPhaseDistribution.charges.foisonneAvecCurseurs;
            const totalFoisonneAvecCurseurs = fac.A + fac.B + fac.C;
            console.log(`   📊 foisonneAvecCurseurs: A=${fac.A.toFixed(2)} + B=${fac.B.toFixed(2)} + C=${fac.C.toFixed(2)} = ${totalFoisonneAvecCurseurs.toFixed(2)} kVA`);
            
            // Vérification de cohérence
            if (Math.abs(S_prel - totalFoisonneAvecCurseurs) > 0.1) {
              console.warn(`   ⚠️ INCOHÉRENCE: S_prel (${S_prel.toFixed(2)}) ≠ foisonneAvecCurseurs total (${totalFoisonneAvecCurseurs.toFixed(2)})`);
              console.warn(`      Différence: ${(S_prel - totalFoisonneAvecCurseurs).toFixed(2)} kVA`);
            } else {
              console.log(`   ✅ COHÉRENT: S_prel ≈ foisonneAvecCurseurs total`);
            }
          } else {
            console.log(`   ⚠️ foisonneAvecCurseurs: NON DISPONIBLE (fallback sur charges.total)`);
            if (n.autoPhaseDistribution?.charges.total) {
              const total = n.autoPhaseDistribution.charges.total;
              console.log(`      charges.total: A=${total.A.toFixed(2)} + B=${total.B.toFixed(2)} + C=${total.C.toFixed(2)} = ${(total.A + total.B + total.C).toFixed(2)} kVA (BRUT, SANS foisonnement)`);
            }
          }
        }
      } else {
        // Fallback : charges/productions manuelles uniquement (foisonnement global)
        S_prel = (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0) * (foisonnementCharges / 100);
        S_pv = (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0) * (foisonnementProductions / 100);
      }
      
      // Sauvegarder les valeurs brutes
      S_prel_map.set(n.id, S_prel);
      S_pv_map.set(n.id, S_pv);
      
      let val = 0;
      if (scenario === 'PRÉLÈVEMENT') val = S_prel;
      else if (scenario === 'PRODUCTION') val = - S_pv;
      else val = S_prel - S_pv;
      S_eq.set(n.id, val);
    }

    const children = new Map<string, string[]>();
    for (const n of nodes) children.set(n.id, []);
    for (const [nodeId, p] of parent.entries()) {
      if (p && children.has(p)) children.get(p)!.push(nodeId);
    }

    const postOrder: string[] = [];
    const dfs = (u: string) => {
      for (const v of children.get(u) || []) dfs(v);
      postOrder.push(u);
    };
    dfs(source.id);

    const S_aval = new Map<string, number>();
    for (const nodeId of postOrder) {
      let sum = S_eq.get(nodeId) || 0;
      for (const childId of (children.get(nodeId) || [])) {
        sum += S_aval.get(childId) || 0;
      }
      S_aval.set(nodeId, sum);
    }

    const calculatedCables: Cable[] = [];
    let globalLosses = 0;
    let totalLoads = 0;
    let totalProductions = 0;

    // Calculer les nœuds connectés à une source
    const connectedNodes = getConnectedNodes(nodes, cables);
    const connectedNodesData = nodes.filter(node => connectedNodes.has(node.id));

    for (const n of connectedNodesData) {
      if (clientsImportes && clientLinks) {
        const linkedClients = getLinkedClientsForNode(n.id, clientsImportes, clientLinks);
        
        // Foisonnement différencié par type de client
        const foisonnementResidentiel = foisonnementChargesResidentiel ?? foisonnementCharges;
        const foisonnementIndustriel = foisonnementChargesIndustriel ?? foisonnementCharges;
        
        for (const client of linkedClients) {
          const foisonnement = client.clientType === 'industriel' 
            ? foisonnementIndustriel 
            : foisonnementResidentiel;
          totalLoads += client.puissanceContractuelle_kVA * (foisonnement / 100);
          totalProductions += client.puissancePV_kVA * (foisonnementProductions / 100);
        }
        
        // Charges manuelles du nœud (considérées comme résidentielles)
        totalLoads += (n.clients || []).reduce((s, c) => s + (c.S_kVA || 0), 0) * (foisonnementResidentiel / 100);
        totalProductions += (n.productions || []).reduce((s, p) => s + (p.S_kVA || 0), 0) * (foisonnementProductions / 100);
      } else {
        // Fallback : charges/productions manuelles uniquement (foisonnement global)
        totalLoads += (n.clients || []).reduce((s,c) => s + (c.S_kVA || 0), 0) * (foisonnementCharges / 100);
        totalProductions += (n.productions || []).reduce((s,p) => s + (p.S_kVA || 0), 0) * (foisonnementProductions / 100);
      }
    }

    // ---- Power Flow using Backward-Forward Sweep (complex R+jX) ----
    // Build helper indices
    const cableIndexByPair = new Map<string, (typeof cables)[number]>();
    for (const cab of cables) {
      const key1 = `${cab.nodeAId}|${cab.nodeBId}`;
      const key2 = `${cab.nodeBId}|${cab.nodeAId}`;
      cableIndexByPair.set(key1, cab);
      cableIndexByPair.set(key2, cab);
    }

    const parentCableOfChild = new Map<string, (typeof cables)[number]>();
    for (const [nodeId, p] of parent.entries()) {
      if (!p) continue;
      const cab = cableIndexByPair.get(`${p}|${nodeId}`);
      if (cab) parentCableOfChild.set(nodeId, cab);
    }

    // Node complex powers (per phase) and initial voltages
    const S_node_total_kVA = new Map<string, number>(); // signed (charges>0, productions<0)
    for (const n of nodes) {
      S_node_total_kVA.set(n.id, S_eq.get(n.id) || 0);
    }

    const VcfgSrc = this.getVoltage(source.connectionType);
    let U_line_base = VcfgSrc.U_base;
    if (transformerConfig?.nominalVoltage_V) U_line_base = transformerConfig.nominalVoltage_V;
    // ✅ U_line_base reste toujours la tension nominale (230V ou 400V)
    // tensionCible sera utilisée uniquement pour Vslack_phase
    const isSrcThree = VcfgSrc.isThreePhase;

    if (!isFinite(U_line_base) || U_line_base <= 0) {
      console.warn('⚠️ U_line incohérent pour la source, utilisation d\'une valeur par défaut.', { U_line_base, connectionType: source.connectionType });
      U_line_base = isSrcThree ? 400 : 230;
    }

    // ---- Détection des équipements SRG2 actifs et mode déséquilibré ----
    const hasSRG2Active = nodes.some(n => n.hasSRG2Device === true);
    const isUnbalanced = loadModel === 'monophase_reparti' || loadModel === 'mixte_mono_poly' || hasSRG2Active;
    
    console.log(`🔍 Mode calculation decision: loadModel=${loadModel}, hasSRG2Active=${hasSRG2Active}, isUnbalanced=${isUnbalanced}`);
    if (hasSRG2Active) {
      console.log('🎯 SRG2 devices detected - forcing per-phase calculation for proper voltage regulation');
    }

    // Per-cable per-phase impedance (Ω) - construit après U_line_base et isUnbalanced
    const cableZ_phase = new Map<string, Complex>();
    const cableChildId = new Map<string, string>();
    const cableParentId = new Map<string, string>();

    // Contexte thermique saisonnier (paramètre de calculateScenario)
    const projectSeason = season;

    for (const [childId, cab] of parentCableOfChild.entries()) {
      const parentId = parent.get(childId)!;
      const distalNode = nodeById.get(childId)!;
      const ct = cableTypeById.get(cab.typeId);
      if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);
      const length_m = this.calculateLengthMeters(cab.coordinates || []);
      const L_km = length_m / 1000;

      // Déterminer le type de réseau et le mode
      const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
      
      // Construire le contexte thermique si saison définie
      const thermalCtx = projectSeason ? {
        season: projectSeason,
        pose: cab.pose,
        I_A: 0, // Première passe : pas de courant connu
        Imax_A: ct.maxCurrent_A || 0
      } : undefined;
      
      const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, is400V, isUnbalanced, false, thermalCtx);
      // Series impedance per phase for the full segment
      const Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      cableZ_phase.set(cab.id, Z);
      cableChildId.set(cab.id, childId);
      cableParentId.set(cab.id, parentId);
    }

    // ===== TENSION DE RÉFÉRENCE POUR LES CALCULS =====
    // U_line_base : tension nominale du réseau (230V ou 400V) - utilisée pour Zbase et choix impédances
    // Vslack_phase : tension réelle mesurée aux bornes du transfo - point de départ des calculs de chute
    let Vslack_phase: number;
    
    // 1. Priorité : tensionCible explicite (tension réelle mesurée)
    if (source.tensionCible) {
      // tensionCible représente toujours la tension phase-phase mesurée
      // → Conversion basée sur le type de connexion
      if (source.connectionType === 'TÉTRA_3P+N_230_400V') {
        // Réseau tétra : tensionCible = tension phase-phase mesurée → convertir en phase-neutre
        Vslack_phase = source.tensionCible / Math.sqrt(3);
        console.log(`📐 Tétra 400V: ${source.tensionCible}V phase-phase → ${Vslack_phase.toFixed(1)}V phase-neutre`);
      } else if (source.connectionType === 'TRI_230V_3F') {
        // Réseau triangle : pas de neutre → utiliser tension phase-phase directement
        Vslack_phase = source.tensionCible;
        console.log(`📐 Triangle 230V: ${source.tensionCible}V phase-phase (utilisé directement, pas de neutre)`);
      } else {
        // Autres types (monophasé, etc.) : tensionCible est déjà en phase
        Vslack_phase = source.tensionCible;
      }
    }
    // 2. Priorité: tension source ajustée via slider (±5%)
    else if (transformerConfig?.sourceVoltage) {
      const U_line = transformerConfig.sourceVoltage;
      console.log(`🎚️ Utilisation tension source (slider): ${U_line}V`);
      if (source.connectionType === 'TÉTRA_3P+N_230_400V') {
        Vslack_phase = U_line / Math.sqrt(3);
      } else {
        Vslack_phase = U_line;
      }
    }
    // 3. Sinon : utiliser tension nominale
    else if (transformerConfig?.nominalVoltage_V) {
      const U_line = transformerConfig.nominalVoltage_V;
      // Décision basée sur le type de connexion, pas sur un seuil de tension
      if (source.connectionType === 'TÉTRA_3P+N_230_400V') {
        Vslack_phase = U_line / Math.sqrt(3); // Tétra : convertir phase-phase → phase-neutre
      } else {
        Vslack_phase = U_line; // Triangle ou mono : utiliser directement
      }
    } else {
      // 4. Fallback sur U_line_base
      if (source.connectionType === 'TÉTRA_3P+N_230_400V') {
        Vslack_phase = U_line_base / Math.sqrt(3);
      } else {
        Vslack_phase = U_line_base;
      }
    }
    
    // 3. Validation élargie : accepter 180-450V pour couvrir à la fois 230V et 400V
    if (!isFinite(Vslack_phase) || Vslack_phase < 180 || Vslack_phase > 450) {
      console.warn(`⚠️ Vslack_phase hors limites: ${Vslack_phase}V, réinitialisation basée sur type réseau`);
      // Réinitialisation intelligente basée sur le type de réseau
      Vslack_phase = source.connectionType === 'TÉTRA_3P+N_230_400V' ? 230 : U_line_base;
    }
    
    console.log(`✅ Vslack_phase: ${Vslack_phase.toFixed(1)}V | U_line_base nominal: ${U_line_base}V`);
    const Vslack = C(Vslack_phase, 0);

    // Transformer series impedance (per phase)
    let Ztr_phase: Complex | null = null;
    if (transformerConfig) {
      // Ztr (Ω/phase) à partir de Ucc% (en p.u.) et du ratio X/R si fourni
      const Zpu = transformerConfig.shortCircuitVoltage_percent / 100;
      const Sbase_VA = transformerConfig.nominalPower_kVA * 1000;
      // Zbase (Ω) par phase selon standard IEEE : Zbase = U_line² / Sbase
      const Zbase = (U_line_base * U_line_base) / Sbase_VA; // Ω
      const Zmag = Zpu * Zbase; // |Z|

      const xOverR = transformerConfig.xOverR;
      let R = 0;
      let X = 0;
      if (typeof xOverR === 'number' && isFinite(xOverR) && xOverR > 0) {
        // R = Z / sqrt(1 + (X/R)^2), X = R * (X/R)
        R = Zmag / Math.sqrt(1 + xOverR * xOverR);
        X = R * xOverR;
      } else {
        // Fallback par défaut si X/R inconnu
        R = 0.05 * Zmag;
        X = Math.sqrt(Math.max(0, Zmag * Zmag - R * R));
      }
      Ztr_phase = C(R, X);
    }

    const V_node = new Map<string, Complex>();
    for (const n of nodes) V_node.set(n.id, Vslack);

    // Sécurité: cosΦ dans [0,1] - Séparation charges/productions
    const cosPhiCharges_eff = Math.min(1, Math.max(0, this.cosPhiCharges));
    const cosPhiProductions_eff = Math.min(1, Math.max(0, this.cosPhiProductions));
    const sinPhiCharges = Math.sqrt(Math.max(0, 1 - cosPhiCharges_eff * cosPhiCharges_eff));
    const sinPhiProductions = Math.sqrt(Math.max(0, 1 - cosPhiProductions_eff * cosPhiProductions_eff));
    
    console.log(`🔌 Facteurs de puissance: cosφ_charges=${cosPhiCharges_eff}, cosφ_productions=${cosPhiProductions_eff}`);

    // ---- Power Flow using Backward-Forward Sweep (complex R+jX) ----
    
    if (hasSRG2Active) {
      console.log('🎯 SRG2 devices detected - forcing per-phase calculation for proper voltage regulation');
      const srg2Nodes = nodes.filter(n => n.hasSRG2Device).map(n => ({
        id: n.id, 
        coefficients: n.srg2RegulationCoefficients 
      }));
      console.log('🎯 SRG2 nodes:', srg2Nodes);
    }

    if (isUnbalanced) {
      // Répartition S_total -> S_A/S_B/S_C selon la répartition par nœud ou manuelle globale
      const globalAngle = 0; // Angle identique pour tous les circuits pour préserver la notion de circuit
      
      const S_A_map = new Map<string, Complex>();
      const S_B_map = new Map<string, Complex>();
      const S_C_map = new Map<string, Complex>();

      for (const n of nodes) {
        const S_kVA_tot = S_node_total_kVA.get(n.id) || 0; // signé
        const sign = Math.sign(S_kVA_tot) || 1;
        
        // ✅ PRIORITÉ À autoPhaseDistribution (mode mixte)
        let pA_charges = 1/3, pB_charges = 1/3, pC_charges = 1/3;
        let pA_productions = 1/3, pB_productions = 1/3, pC_productions = 1/3;
        
        if (n.autoPhaseDistribution) {
          // ✅ PRIORITÉ : utiliser les valeurs foisonnées avec curseurs si disponibles
          if (n.autoPhaseDistribution.charges.foisonneAvecCurseurs && 
              n.autoPhaseDistribution.productions.foisonneAvecCurseurs) {
            
            const totalCharges = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.A + 
                                n.autoPhaseDistribution.charges.foisonneAvecCurseurs.B + 
                                n.autoPhaseDistribution.charges.foisonneAvecCurseurs.C;
            const totalProds = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.A + 
                              n.autoPhaseDistribution.productions.foisonneAvecCurseurs.B + 
                              n.autoPhaseDistribution.productions.foisonneAvecCurseurs.C;
            
            if (totalCharges > 0.001) {
              pA_charges = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.A / totalCharges;
              pB_charges = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.B / totalCharges;
              pC_charges = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.C / totalCharges;
            }
            
            if (totalProds > 0.001) {
              pA_productions = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.A / totalProds;
              pB_productions = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.B / totalProds;
              pC_productions = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.C / totalProds;
            }
            
            console.log(`📊 Nœud ${n.name || n.id}: utilise foisonneAvecCurseurs (foisonnement + curseurs)`);
            console.log(`   Charges: A=${(pA_charges*100).toFixed(1)}%, B=${(pB_charges*100).toFixed(1)}%, C=${(pC_charges*100).toFixed(1)}%`);
          } else {
            // Fallback : utiliser les valeurs physiques totales
            const totalCharges = n.autoPhaseDistribution.charges.total.A + 
                                n.autoPhaseDistribution.charges.total.B + 
                                n.autoPhaseDistribution.charges.total.C;
            const totalProds = n.autoPhaseDistribution.productions.total.A + 
                               n.autoPhaseDistribution.productions.total.B + 
                               n.autoPhaseDistribution.productions.total.C;
            
            if (totalCharges > 0.001) {
              pA_charges = n.autoPhaseDistribution.charges.total.A / totalCharges;
              pB_charges = n.autoPhaseDistribution.charges.total.B / totalCharges;
              pC_charges = n.autoPhaseDistribution.charges.total.C / totalCharges;
            }
            
            if (totalProds > 0.001) {
              pA_productions = n.autoPhaseDistribution.productions.total.A / totalProds;
              pB_productions = n.autoPhaseDistribution.productions.total.B / totalProds;
              pC_productions = n.autoPhaseDistribution.productions.total.C / totalProds;
            }
            
            console.log(`📊 Nœud ${n.name || n.id}: utilise autoPhaseDistribution (physique)`);
            console.log(`   Charges: A=${(pA_charges*100).toFixed(1)}%, B=${(pB_charges*100).toFixed(1)}%, C=${(pC_charges*100).toFixed(1)}%`);
          }
        } else if (manualPhaseDistribution) {
          // Fallback : mode monophase_reparti
          pA_charges = manualPhaseDistribution.charges.A / 100;
          pB_charges = manualPhaseDistribution.charges.B / 100;
          pC_charges = manualPhaseDistribution.charges.C / 100;
          pA_productions = manualPhaseDistribution.productions.A / 100;
          pB_productions = manualPhaseDistribution.productions.B / 100;
          pC_productions = manualPhaseDistribution.productions.C / 100;
          
          console.log(`📊 Nœud ${n.name || n.id}: utilise manualPhaseDistribution`);
        }
        
        // Vérification de cohérence
        const totalCharges = pA_charges + pB_charges + pC_charges;
        const totalProductions = pA_productions + pB_productions + pC_productions;
        if (Math.abs(totalCharges - 1) > 1e-6) {
          console.warn(`⚠️ Répartition des charges incohérente pour nœud ${n.id}: total=${totalCharges}`);
        }
        if (Math.abs(totalProductions - 1) > 1e-6) {
          console.warn(`⚠️ Répartition des productions incohérente pour nœud ${n.id}: total=${totalProductions}`);
        }
        
        // Récupérer les charges et productions brutes (AVANT NET)
        const S_prel_kVA = S_prel_map.get(n.id) || 0;
        const S_pv_kVA = S_pv_map.get(n.id) || 0;
        
        // 1. Calculer les CHARGES par phase
        const S_A_charges_kVA = S_prel_kVA * pA_charges;
        const S_B_charges_kVA = S_prel_kVA * pB_charges;
        const S_C_charges_kVA = S_prel_kVA * pC_charges;
        
        // 2. Calculer les PRODUCTIONS par phase
        const S_A_prod_kVA = S_pv_kVA * pA_productions;
        const S_B_prod_kVA = S_pv_kVA * pB_productions;
        const S_C_prod_kVA = S_pv_kVA * pC_productions;
        
        // 3. Calculer le NET par phase selon le scénario
        let S_A_kVA = 0, S_B_kVA = 0, S_C_kVA = 0;
        
        if (scenario === 'PRÉLÈVEMENT') {
          // Scénario prélèvement : charges uniquement
          S_A_kVA = S_A_charges_kVA;
          S_B_kVA = S_B_charges_kVA;
          S_C_kVA = S_C_charges_kVA;
        } else if (scenario === 'PRODUCTION') {
          // Scénario production : productions uniquement (négatives)
          S_A_kVA = -S_A_prod_kVA;
          S_B_kVA = -S_B_prod_kVA;
          S_C_kVA = -S_C_prod_kVA;
        } else {
          // Scénario simultané : NET par phase
          S_A_kVA = S_A_charges_kVA - S_A_prod_kVA;
          S_B_kVA = S_B_charges_kVA - S_B_prod_kVA;
          S_C_kVA = S_C_charges_kVA - S_C_prod_kVA;
        }
        
        console.log(`📊 Nœud ${n.name || n.id} - Calcul par phase:`);
        console.log(`   Charges: A=${S_A_charges_kVA.toFixed(2)}kVA, B=${S_B_charges_kVA.toFixed(2)}kVA, C=${S_C_charges_kVA.toFixed(2)}kVA`);
        console.log(`   Prod:    A=${S_A_prod_kVA.toFixed(2)}kVA, B=${S_B_prod_kVA.toFixed(2)}kVA, C=${S_C_prod_kVA.toFixed(2)}kVA`);
        console.log(`   NET:     A=${S_A_kVA.toFixed(2)}kVA, B=${S_B_kVA.toFixed(2)}kVA, C=${S_C_kVA.toFixed(2)}kVA`);
        
        // ===== SOMME VECTORIELLE : P et Q calculés séparément pour charges et productions =====
        // CHARGES: P_load = S_charge × cos(φ_charges), Q_load = S_charge × sin(φ_charges) > 0 (consommé)
        // PRODUCTIONS: P_prod = S_prod × cos(φ_productions), Q_prod = S_prod × sin(φ_productions)
        // RÉSULTAT: P_net = P_load - P_prod, Q_net = Q_load - Q_prod
        
        // Phase A
        const P_A_load_kW = S_A_charges_kVA * cosPhiCharges_eff;
        const Q_A_load_kVAr = S_A_charges_kVA * sinPhiCharges; // Q positif (consommé)
        const P_A_prod_kW = S_A_prod_kVA * cosPhiProductions_eff;
        const Q_A_prod_kVAr = S_A_prod_kVA * sinPhiProductions; // Q selon réglage onduleur
        const P_A_net_kW = P_A_load_kW - P_A_prod_kW;
        const Q_A_net_kVAr = Q_A_load_kVAr - Q_A_prod_kVAr;
        
        // Phase B
        const P_B_load_kW = S_B_charges_kVA * cosPhiCharges_eff;
        const Q_B_load_kVAr = S_B_charges_kVA * sinPhiCharges;
        const P_B_prod_kW = S_B_prod_kVA * cosPhiProductions_eff;
        const Q_B_prod_kVAr = S_B_prod_kVA * sinPhiProductions;
        const P_B_net_kW = P_B_load_kW - P_B_prod_kW;
        const Q_B_net_kVAr = Q_B_load_kVAr - Q_B_prod_kVAr;
        
        // Phase C
        const P_C_load_kW = S_C_charges_kVA * cosPhiCharges_eff;
        const Q_C_load_kVAr = S_C_charges_kVA * sinPhiCharges;
        const P_C_prod_kW = S_C_prod_kVA * cosPhiProductions_eff;
        const Q_C_prod_kVAr = S_C_prod_kVA * sinPhiProductions;
        const P_C_net_kW = P_C_load_kW - P_C_prod_kW;
        const Q_C_net_kVAr = Q_C_load_kVAr - Q_C_prod_kVAr;
        
        // Construction des phaseurs S = P + jQ (en W et VAr)
        S_A_map.set(n.id, C(P_A_net_kW * 1000, Q_A_net_kVAr * 1000));
        S_B_map.set(n.id, C(P_B_net_kW * 1000, Q_B_net_kVAr * 1000));
        S_C_map.set(n.id, C(P_C_net_kW * 1000, Q_C_net_kVAr * 1000));

        // ===== CORRECTION MONO 230V PHASE-PHASE (Approche vectorielle) =====
        // Pour les réseaux 230V triangle, les charges MONO sont entre phases (A-B, B-C, A-C).
        // Le courant de ligne est I = S_total / U_LL, pas I = (S_total/2) / U_LL.
        // 
        // Approche vectorielle : pour un client MONO sur A-B avec puissance S_total,
        // le courant ENTRE par la phase A et SORT par la phase B.
        // On modélise : S_A = +S_total (courant entrant), S_B = -S_total (courant sortant)
        // La puissance totale est conservée car P = V_AB * I* = (V_A - V_B) * I*
        //
        // NOTE : On ne REMPLACE PAS la distribution 50/50 (qui reste pour l'affichage),
        // on AJUSTE les phaseurs pour le calcul de courant correct.
        const is230VTriangle = U_line_base < ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
        if (is230VTriangle && n.autoPhaseDistribution?.phasePhaseLoads) {
          const ppLoads = n.autoPhaseDistribution.phasePhaseLoads;
          
          // FIX: Utiliser ?? pour éviter que 0 soit traité comme falsy
          const foisChargeCoeff = (foisonnementCharges ?? 100) / 100;
          const foisProdCoeff = (foisonnementProductions ?? 100) / 100;
          
          // Appliquer les curseurs de déséquilibre aux phasePhaseLoads
          // Les curseurs définissent la répartition finale souhaitée par l'utilisateur
          // On calcule le ratio de chaque phase dans chaque couplage
          const totalChargePercent = pA_charges + pB_charges + pC_charges;
          const totalProdPercent = pA_productions + pB_productions + pC_productions;
          
          // Pour A-B: les phases A et B contribuent
          // Ratio de A dans A-B = pA / (pA + pB), Ratio de B dans A-B = pB / (pA + pB)
          const ratioAB_A_charges = (pA_charges + pB_charges) > 0 ? pA_charges / (pA_charges + pB_charges) : 0.5;
          const ratioBC_B_charges = (pB_charges + pC_charges) > 0 ? pB_charges / (pB_charges + pC_charges) : 0.5;
          const ratioAC_A_charges = (pA_charges + pC_charges) > 0 ? pA_charges / (pA_charges + pC_charges) : 0.5;
          
          const ratioAB_A_prods = (pA_productions + pB_productions) > 0 ? pA_productions / (pA_productions + pB_productions) : 0.5;
          const ratioBC_B_prods = (pB_productions + pC_productions) > 0 ? pB_productions / (pB_productions + pC_productions) : 0.5;
          const ratioAC_A_prods = (pA_productions + pC_productions) > 0 ? pA_productions / (pA_productions + pC_productions) : 0.5;
          
          // NET des charges et productions par couplage (avec foisonnement séparé)
          // Pondéré par les ratios des curseurs de déséquilibre
          const S_AB_charges = ppLoads.charges['A-B'] * foisChargeCoeff;
          const S_AB_prods = ppLoads.productions['A-B'] * foisProdCoeff;
          const S_AB_net = S_AB_charges - S_AB_prods;
          
          const S_BC_charges = ppLoads.charges['B-C'] * foisChargeCoeff;
          const S_BC_prods = ppLoads.productions['B-C'] * foisProdCoeff;
          const S_BC_net = S_BC_charges - S_BC_prods;
          
          const S_AC_charges = ppLoads.charges['A-C'] * foisChargeCoeff;
          const S_AC_prods = ppLoads.productions['A-C'] * foisProdCoeff;
          const S_AC_net = S_AC_charges - S_AC_prods;
          
          // La distribution 50/50 actuelle met S/2 sur chaque phase du couplage.
          // Pour obtenir le courant correct I = S_total / U_LL, on doit :
          // - Retirer la moitié (déjà comptée dans 50/50)
          // - Ajouter la puissance complète sur la phase "entrante" avec phaseur opposé sur "sortante"
          //
          // Simplification : la correction nette sur chaque phase est la différence
          // entre ce qu'il faut (phaseurs opposés) et ce qu'on a (50/50).
          //
          // Pour A-B: 50/50 donne S_A=S/2, S_B=S/2
          //           Phaseurs opposés: S_A=+S, S_B=-S (ou l'inverse selon convention)
          //           Différence à ajouter: S_A += +S/2, S_B += -S/2
          //
          // Pour chaque couplage, on ajoute +S/2 sur la première phase et -S/2 sur la seconde
          
          // Correction A-B : +S_AB/2 sur A, -S_AB/2 sur B
          const correction_AB_A_kVA = S_AB_net / 2;
          const correction_AB_B_kVA = -S_AB_net / 2;
          
          // Correction B-C : +S_BC/2 sur B, -S_BC/2 sur C
          const correction_BC_B_kVA = S_BC_net / 2;
          const correction_BC_C_kVA = -S_BC_net / 2;
          
          // Correction A-C : +S_AC/2 sur A, -S_AC/2 sur C
          const correction_AC_A_kVA = S_AC_net / 2;
          const correction_AC_C_kVA = -S_AC_net / 2;
          
          // Somme des corrections par phase
          const S_A_correction_kVA = correction_AB_A_kVA + correction_AC_A_kVA;
          const S_B_correction_kVA = correction_AB_B_kVA + correction_BC_B_kVA;
          const S_C_correction_kVA = correction_BC_C_kVA + correction_AC_C_kVA;
          
          // Utiliser cosPhi moyen pour les corrections (pondéré par charges vs productions)
          // Note: pour simplifier, on utilise cosPhi charges si net > 0, sinon cosPhi productions
          const applyCorrection = (correction_kVA: number) => {
            if (Math.abs(correction_kVA) < 0.001) return C(0, 0);
            const cosPhiEff = correction_kVA >= 0 ? cosPhiCharges_eff : cosPhiProductions_eff;
            const sinPhiEff = correction_kVA >= 0 ? sinPhiCharges : sinPhiProductions;
            return C(correction_kVA * cosPhiEff * 1000, correction_kVA * sinPhiEff * 1000);
          };
          
          S_A_map.set(n.id, add(S_A_map.get(n.id) || C(0,0), applyCorrection(S_A_correction_kVA)));
          S_B_map.set(n.id, add(S_B_map.get(n.id) || C(0,0), applyCorrection(S_B_correction_kVA)));
          S_C_map.set(n.id, add(S_C_map.get(n.id) || C(0,0), applyCorrection(S_C_correction_kVA)));
          
          if (Math.abs(S_AB_net) > 0.01 || Math.abs(S_BC_net) > 0.01 || Math.abs(S_AC_net) > 0.01) {
            console.log(`🔧 Correction vectorielle MONO 230V nœud ${n.name || n.id}: corrections A=${S_A_correction_kVA.toFixed(2)}kVA, B=${S_B_correction_kVA.toFixed(2)}kVA, C=${S_C_correction_kVA.toFixed(2)}kVA`);
          }
        }

        // Intégrer les contributions explicites P/Q (équipements virtuels)
        const addExtra = (items: any[], sign: 1 | -1) => {
          for (const it of items || []) {
            const P = Number((it as any).P_kW) || 0;
            const Q = Number((it as any).Q_kVAr) || 0;
            if (P === 0 && Q === 0) continue;
            const phase = (it as any).phase as 'A' | 'B' | 'C' | undefined;
            const Sextra = C(P * 1000 * sign, Q * 1000 * sign);
            if (phase === 'A') {
              S_A_map.set(n.id, add(S_A_map.get(n.id) || C(0,0), Sextra));
            } else if (phase === 'B') {
              S_B_map.set(n.id, add(S_B_map.get(n.id) || C(0,0), Sextra));
            } else if (phase === 'C') {
              S_C_map.set(n.id, add(S_C_map.get(n.id) || C(0,0), Sextra));
            } else {
              const third = scale(Sextra, 1/3);
              S_A_map.set(n.id, add(S_A_map.get(n.id) || C(0,0), third));
              S_B_map.set(n.id, add(S_B_map.get(n.id) || C(0,0), third));
              S_C_map.set(n.id, add(S_C_map.get(n.id) || C(0,0), third));
            }
          }
        };
        addExtra((n as any).clients || [], 1);
        addExtra((n as any).productions || [], -1);
      }

      const runBFSForPhase = (angleDeg: number, S_map: Map<string, Complex>, phaseLabel: 'A'|'B'|'C') => {
        const V_node_phase = new Map<string, Complex>();
        const I_branch_phase = new Map<string, Complex>();
        const I_inj_node_phase = new Map<string, Complex>();

        const Vslack_phase_ph = fromPolar(Vslack_phase, this.deg2rad(angleDeg));
        for (const n of nodes) V_node_phase.set(n.id, Vslack_phase_ph);

        let iter2 = 0;
        let converged2 = false;
        while (iter2 < ElectricalCalculator.MAX_ITERATIONS) {
          iter2++;
          const V_prev2 = new Map(V_node_phase);

          I_branch_phase.clear();
          I_inj_node_phase.clear();

          for (const n of nodes) {
            const Vn = V_node_phase.get(n.id) || Vslack_phase_ph;
            const Sph = S_map.get(n.id) || C(0, 0);
            const Vsafe = abs(Vn) > ElectricalCalculator.MIN_VOLTAGE_SAFETY ? Vn : Vslack_phase_ph;
            let Iinj = conj(div(Sph, Vsafe));
            
            // ✅ EQUI8 CME: Ajouter l'injection de courant shunt si présente
            // EQUI8 modifie les courants, JAMAIS les tensions directement.
            if (equi8CurrentInjections?.has(n.id)) {
              const injection = equi8CurrentInjections.get(n.id)!;
              let I_equi8_phase: Complex;
              
              if (phaseLabel === 'A') {
                I_equi8_phase = C(injection.I_phaseA.re, injection.I_phaseA.im);
              } else if (phaseLabel === 'B') {
                I_equi8_phase = C(injection.I_phaseB.re, injection.I_phaseB.im);
              } else {
                I_equi8_phase = C(injection.I_phaseC.re, injection.I_phaseC.im);
              }
              
              // Soustraire du courant nodal (l'injection SOUTIRE du courant des phases)
              Iinj = add(Iinj, I_equi8_phase);
              console.log(`🔌 EQUI8 CME nœud ${n.id} phase ${phaseLabel}: I_equi8=${abs(I_equi8_phase).toFixed(2)}A`);
            }
            
            I_inj_node_phase.set(n.id, Iinj);
          }

          for (const u of postOrder) {
            if (u === source.id) continue;
            const childrenIds = children.get(u) || [];
            let I_sum = C(0, 0);
            for (const v of childrenIds) {
              const cabChild = parentCableOfChild.get(v);
              if (!cabChild) continue;
              const Ichild = I_branch_phase.get(cabChild.id) || C(0, 0);
              I_sum = add(I_sum, Ichild);
            }
            I_sum = add(I_sum, I_inj_node_phase.get(u) || C(0, 0));
            const cab = parentCableOfChild.get(u);
            if (cab) I_branch_phase.set(cab.id, I_sum);
          }

          let I_source_net = C(0, 0);
          for (const v of children.get(source.id) || []) {
            const cab = parentCableOfChild.get(v);
            if (!cab) continue;
            I_source_net = add(I_source_net, I_branch_phase.get(cab.id) || C(0, 0));
          }
          I_source_net = add(I_source_net, I_inj_node_phase.get(source.id) || C(0, 0));

          const V_source_bus = Ztr_phase ? sub(Vslack_phase_ph, mul(Ztr_phase, I_source_net)) : Vslack_phase_ph;
          V_node_phase.set(source.id, V_source_bus);

          const stack2 = [source.id];
          while (stack2.length) {
            const u = stack2.pop()!;
            for (const v of children.get(u) || []) {
              const cab = parentCableOfChild.get(v);
              if (!cab) continue;
              const Z = cableZ_phase.get(cab.id) || C(0, 0);
              const Iuv = I_branch_phase.get(cab.id) || C(0, 0);
              const Vu = V_node_phase.get(u) || Vslack_phase_ph;
              
              // ============================================================================
              // Modélisation physique des régulateurs :
              // EQUI8 = injection de courant shunt au nœud (modifie I via I_inj_node_phase)
              // SRG2 = injection de tension série dans la branche (via serieVoltagePerPhase)
              // Aucun nœud n'a de tension imposée artificiellement
              // ============================================================================
              
              // Calculer tension selon Kirchhoff : V_v = V_u - Z * I_uv + V_série
              // La tension série V_série est injectée par le SRG2 (si présent sur cette branche)
              let Vv = sub(Vu, mul(Z, Iuv));
              
              // ✅ SRG2 INJECTION SÉRIE: Ajouter la tension série si présente
              if (cab.serieVoltagePerPhase) {
                let Vserie: Complex;
                if (phaseLabel === 'A') {
                  Vserie = cab.serieVoltagePerPhase.A;
                } else if (phaseLabel === 'B') {
                  Vserie = cab.serieVoltagePerPhase.B;
                } else {
                  Vserie = cab.serieVoltagePerPhase.C;
                }
                
                // Ajouter la tension série (positive = boost, négative = buck)
                if (abs(Vserie) > 0.01) {
                  const Vv_before = abs(Vv);
                  Vv = add(Vv, Vserie);
                  console.log(`🔧 SRG2 câble ${cab.id} phase ${phaseLabel}: ` +
                    `V_série=${abs(Vserie).toFixed(1)}V, ` +
                    `V=${Vv_before.toFixed(1)}V → ${abs(Vv).toFixed(1)}V`);
                }
              }
              
              // ✅ EQUI8 NOUVEAU MODÈLE: 
              // L'EQUI8 modifie les courants (via I_inj_node_phase), JAMAIS les tensions directement.
              // Les tensions résultent naturellement du BFS avec les courants modifiés.
              const vNode = nodeById.get(v);
              
              V_node_phase.set(v, Vv);
              
              // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              // [DEPRECATED] Ancienne logique SRG2 par imposition de tension
              // ============================================================================
              // L'ancien modèle SRG2 imposait directement les tensions aux nœuds via:
              //   vNode.hasSRG2Device && vNode.srg2RegulationCoefficients && vNode.srg2TensionSortie
              // 
              // NOUVEAU MODÈLE (injection série):
              // Le SRG2 agit maintenant via cab.serieVoltagePerPhase (traité ci-dessus).
              // La tension résulte naturellement de: V_v = V_u - Z*I + V_série
              // Aucune imposition directe de tension. L'amont peut peu bouger, l'aval peut
              // monter ou descendre selon l'impédance des lignes.
              // ============================================================================
              // if (vNode?.hasSRG2Device && vNode.srg2RegulationCoefficients && vNode.srg2TensionSortie) {
              //   [DÉSACTIVÉ] Remplacé par injection série via serieVoltagePerPhase
              // }
              // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              
              stack2.push(v);
            }
          }

          // Convergence per-phase
          let maxDelta = 0;
          for (const [nid, Vn] of V_node_phase.entries()) {
            const Vp = V_prev2.get(nid) || Vslack_phase_ph;
            const d = abs(sub(Vn, Vp));
            if (d > maxDelta) maxDelta = d;
          }
          if (maxDelta / (Vslack_phase || 1) < ElectricalCalculator.CONVERGENCE_TOLERANCE) { converged2 = true; break; }
        }
        if (!converged2) {
          console.warn(`⚠️ BFS phase ${angleDeg}° non convergé`);
        }
        return { V_node_phase, I_branch_phase };
      };

      // Déphasages corrects pour les phases A, B, C
      let phaseA = runBFSForPhase(0, S_A_map, 'A');      // 0°
      let phaseB = runBFSForPhase(-120, S_B_map, 'B');   // -120°
      let phaseC = runBFSForPhase(120, S_C_map, 'C');    // +120°

      // ===== MICRO-ITÉRATION THERMIQUE DYNAMIQUE (Effet Joule) =====
      // Recalcul des impédances avec les courants réels du BFS
      // T_cable(h) = T_ambient + inertie × k × (I(h)/Imax)²
      // AÉRIEN: réponse instantanée | SOUTERRAIN: réponse amortie (inertie thermique)
      const cableTempMap = new Map<string, number>();
      
      if (projectSeason) {
        let impedancesUpdated = false;
        
        for (const [childId, cab] of parentCableOfChild.entries()) {
          const ct = cableTypeById.get(cab.typeId);
          if (!ct) continue;
          const length_m = this.calculateLengthMeters(cab.coordinates || []);
          const L_km = length_m / 1000;
          
          // Courant max des 3 phases (pire cas pour échauffement)
          const IA_mag = abs(phaseA.I_branch_phase.get(cab.id) || C(0, 0));
          const IB_mag = abs(phaseB.I_branch_phase.get(cab.id) || C(0, 0));
          const IC_mag = abs(phaseC.I_branch_phase.get(cab.id) || C(0, 0));
          const I_max_phase = Math.max(IA_mag, IB_mag, IC_mag);
          
          // Température du câble avec courant réel et inertie thermique
          const T_amb = getAmbientTemperature(projectSeason, cab.pose);
          const T_cable = calculateCableTemperature(T_amb, I_max_phase, ct.maxCurrent_A || 0, cab.pose);
          cableTempMap.set(cab.id, T_cable);
          
          // Recalcul de l'impédance avec correction thermique dynamique
          const thermalCtxReal = {
            season: projectSeason,
            pose: cab.pose,
            I_A: I_max_phase,
            Imax_A: ct.maxCurrent_A || 0
          };
          
          const is400V_local = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
          const { R: R_new, X: X_new } = this.selectRX(ct, is400V_local, isUnbalanced, false, thermalCtxReal);
          const Z_new = C(R_new * L_km, X_new * L_km);
          const Z_old = cableZ_phase.get(cab.id) || C(0, 0);
          
          // Mettre à jour si R change significativement (>0.1%)
          if (Math.abs(Z_new.re - Z_old.re) / (Math.abs(Z_old.re) + 1e-12) > 0.001) {
            cableZ_phase.set(cab.id, Z_new);
            impedancesUpdated = true;
          }
        }
        
        // Relancer le BFS avec les impédances corrigées par l'effet Joule
        if (impedancesUpdated) {
          console.log('🌡️ Micro-itération thermique: recalcul BFS avec R corrigé (effet Joule dynamique)');
          phaseA = runBFSForPhase(0, S_A_map, 'A');
          phaseB = runBFSForPhase(-120, S_B_map, 'B');
          phaseC = runBFSForPhase(120, S_C_map, 'C');
        }
      }

      // Détection du système 400V pour le calcul du courant neutre
      const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
      
      // ===== CORRECTION MAJEURE : Propagation de la chute de tension du conducteur neutre =====
      // Pour les réseaux 400V phase-neutre, le courant neutre crée une chute de tension supplémentaire
      // qui doit être ajoutée aux tensions phase-neutre calculées
      if (is400V) {
        // ✅ EQUI8 CME: Identifier les nœuds avec injection de courant
        // Le courant injecté sur le neutre réduit directement le courant neutre dans les câbles amont
        const equi8CompensationByNode = new Map<string, number>();
        
        // Source 1: Injections explicites passées en paramètre (mode CME)
        if (equi8CurrentInjections) {
          for (const [nodeId, injection] of equi8CurrentInjections.entries()) {
            // Le courant injecté sur le neutre = magnitude
            equi8CompensationByNode.set(nodeId, injection.magnitude);
            console.log(`🔌 EQUI8 CME détecté sur nœud ${nodeId}: I_injection=${injection.magnitude.toFixed(1)}A`);
          }
        }
        
        // Source 2: Legacy customProps (mode LOAD_SHIFT ou ancien modèle)
        for (const n of nodes) {
          if (n.customProps?.['equi8_I_compensation'] && !equi8CompensationByNode.has(n.id)) {
            const I_comp = n.customProps['equi8_I_compensation'] as number;
            equi8CompensationByNode.set(n.id, I_comp);
            console.log(`🔌 EQUI8 legacy détecté sur nœud ${n.id}: I_compensation=${I_comp.toFixed(1)}A`);
          }
        }
        
        // ✅ EQUI8 : Calculer le courant de compensation cumulé vers l'amont pour chaque nœud
        // Un nœud en amont d'un EQUI8 voit son courant neutre réduit
        const equi8UpstreamReduction = new Map<string, number>();
        
        // Pour chaque nœud EQUI8, propager la réduction vers la source
        for (const [equi8NodeId, I_comp] of equi8CompensationByNode.entries()) {
          let currentNodeId = equi8NodeId;
          
          // Remonter vers la source
          while (parent.get(currentNodeId)) {
            const parentNodeId = parent.get(currentNodeId)!;
            const cable = parentCableOfChild.get(currentNodeId);
            
            if (cable) {
              // Accumuler la réduction sur ce câble
              const existingReduction = equi8UpstreamReduction.get(cable.id) || 0;
              equi8UpstreamReduction.set(cable.id, existingReduction + I_comp);
              console.log(`🔌 EQUI8 réduction I_N sur câble ${cable.id}: +${I_comp.toFixed(1)}A (total: ${(existingReduction + I_comp).toFixed(1)}A)`);
            }
            
            currentNodeId = parentNodeId;
          }
        }
        
        // Calculer la tension du neutre à chaque nœud en propageant la chute Z_neutre * I_N
        const V_neutral = new Map<string, Complex>();
        V_neutral.set(source.id, C(0, 0)); // Le neutre à la source est à 0V (référence)
        
        // BFS depuis la source pour propager la tension du neutre
        const stack3 = [source.id];
        const visited3 = new Set<string>();
        
        while (stack3.length) {
          const u = stack3.pop()!;
          if (visited3.has(u)) continue;
          visited3.add(u);
          
          const Vn_parent = V_neutral.get(u) || C(0, 0);
          
          for (const v of children.get(u) || []) {
            const cab = parentCableOfChild.get(v);
            if (!cab) continue;
            
            // Calcul du courant neutre sur ce segment (somme vectorielle complexe)
            const IA = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
            const IB = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
            const IC = phaseC.I_branch_phase.get(cab.id) || C(0, 0);
            let IN_phasor = add(add(IA, IB), IC); // Somme vectorielle complexe
            
            // ✅ EQUI8 : Soustraire le courant de compensation des câbles en amont
            const equi8Reduction = equi8UpstreamReduction.get(cab.id);
            if (equi8Reduction && equi8Reduction > 0) {
              // L'EQUI8 injecte un courant qui réduit le déséquilibre
              // On soustrait la magnitude de compensation du courant neutre
              const IN_mag_before = abs(IN_phasor);
              const IN_mag_after = Math.max(0, IN_mag_before - equi8Reduction);
              
              // Conserver l'angle du courant neutre, réduire la magnitude
              if (IN_mag_before > 0.01) {
                const IN_angle = arg(IN_phasor);
                IN_phasor = fromPolar(IN_mag_after, IN_angle);
                console.log(`🔌 EQUI8 câble ${cab.id}: I_N ${IN_mag_before.toFixed(1)}A → ${IN_mag_after.toFixed(1)}A (réduction ${equi8Reduction.toFixed(1)}A)`);
              }
            }
            
            // Récupérer l'impédance du conducteur neutre (R0, X0)
            const distalNode = nodeById.get(v)!;
            const ct = cableTypeById.get(cab.typeId);
            if (!ct) continue;
            const length_m = this.calculateLengthMeters(cab.coordinates || []);
            const L_km = length_m / 1000;
            
            // Utiliser R0/X0 pour le conducteur neutre (forNeutral = true)
            const is400V_local = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
            // Courant neutre réel pour correction thermique dynamique
            const IA_n = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
            const IB_n = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
            const IC_n = phaseC.I_branch_phase.get(cab.id) || C(0, 0);
            const IN_real_A = abs(add(add(IA_n, IB_n), IC_n));
            const thermalCtxNeutral = projectSeason ? {
              season: projectSeason,
              pose: cab.pose,
              I_A: IN_real_A,
              Imax_A: ct.maxCurrent_A || 0
            } : undefined;
            const { R: R0, X: X0 } = this.selectRX(ct, is400V_local, isUnbalanced, true, thermalCtxNeutral);
            const Z_neutral = C(R0 * L_km, X0 * L_km);
            
            // Chute de tension dans le neutre (phasor)
            const dVn = mul(Z_neutral, IN_phasor);
            
            // ✅ CORRECTION CRITIQUE : Le courant neutre circule en retour (opposé aux phases)
            // Dans un système déséquilibré, IN = IA + IB + IC représente le déséquilibre
            // Ce courant crée une élévation du potentiel du neutre, pas une diminution
            const Vn_child = add(Vn_parent, dVn);
            V_neutral.set(v, Vn_child);
            
            stack3.push(v);
          }
        }
        
        // Corriger les tensions phase-neutre en soustrayant la tension du neutre
        // V_phase_neutre_corrigé = V_phase - V_neutral
        // ============================================================================
        // NOTE: En mode EQUI8 CME, les tensions résultent naturellement du BFS
        // avec injection de courant. Aucune imposition directe de tensions.
        // L'ancien check "equi8_modified" qui sautait la correction neutre a été
        // supprimé car il n'est plus utilisé en mode CME.
        // ============================================================================
        for (const n of nodes) {
          if (n.id === source.id) continue; // La source n'a pas besoin de correction
          
          const Vn = V_neutral.get(n.id);
          if (!Vn) continue;
          
          // Corriger les 3 phases
          const Va = phaseA.V_node_phase.get(n.id);
          const Vb = phaseB.V_node_phase.get(n.id);
          const Vc = phaseC.V_node_phase.get(n.id);
          
          if (Va) phaseA.V_node_phase.set(n.id, sub(Va, Vn));
          if (Vb) phaseB.V_node_phase.set(n.id, sub(Vb, Vn));
          if (Vc) phaseC.V_node_phase.set(n.id, sub(Vc, Vn));
        }
      }

      // ✅ EQUI8 : Stocker la map des réductions pour l'utiliser dans les résultats des câbles
      // (La map equi8UpstreamReduction est créée dans le bloc is400V ci-dessus)
      const equi8UpstreamReductionForCables = new Map<string, number>();
      if (is400V) {
        // Recalculer ici pour avoir accès en dehors du bloc (même logique que ci-dessus)
        for (const n of nodes) {
          if (n.customProps?.['equi8_I_compensation']) {
            const I_comp = n.customProps['equi8_I_compensation'] as number;
            let currentNodeId = n.id;
            while (parent.get(currentNodeId)) {
              const parentNodeId = parent.get(currentNodeId)!;
              const cable = parentCableOfChild.get(currentNodeId);
              if (cable) {
                const existing = equi8UpstreamReductionForCables.get(cable.id) || 0;
                equi8UpstreamReductionForCables.set(cable.id, existing + I_comp);
              }
              currentNodeId = parentNodeId;
            }
          }
        }
      }

      // Compose cable results (par phase)
      calculatedCables.length = 0;
      globalLosses = 0;

      for (const cab of cables) {
        const childId = cableChildId.get(cab.id);
        const parentId = cableParentId.get(cab.id);
        const length_m = this.calculateLengthMeters(cab.coordinates || []);
        const ct = cableTypeById.get(cab.typeId);
        if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);

        const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
        const distalNode = nodeById.get(distalId)!;
        const { isThreePhase } = this.getVoltage(distalNode.connectionType);
        const Z = cableZ_phase.get(cab.id) || C(0, 0);

        const IA = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
        const IB = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
        const IC = phaseC.I_branch_phase.get(cab.id) || C(0, 0);

        const IA_mag = abs(IA);
        const IB_mag = abs(IB);
        const IC_mag = abs(IC);

        const dVA = abs(mul(Z, IA));
        const dVB = abs(mul(Z, IB));
        const dVC = abs(mul(Z, IC));

        const current_A = Math.max(IA_mag, IB_mag, IC_mag);
        // ===== CORRECTION : Appliquer √3 pour TOUS les réseaux triphasés (triangle ET étoile) =====
        // Formule officielle: ΔU = √3 × I × (R×cosφ + X×sinφ) × L
        // Le facteur √3 convertit la chute de tension par phase en chute de tension ligne-ligne
        const deltaU_line_V = isThreePhase 
          ? Math.max(dVA, dVB, dVC) * Math.sqrt(3)
          : Math.max(dVA, dVB, dVC);

        // Base voltage for percent
        let { U_base } = this.getVoltage(distalNode.connectionType);
        const srcTarget = nodes.find(n => n.isSource)?.tensionCible;
        if (srcTarget) U_base = srcTarget;
        const deltaU_percent = U_base ? (deltaU_line_V / U_base) * 100 : 0;

        // Pertes (somme des 3 phases)
        const R_total = Z.re;
        const losses_kW = ((IA_mag*IA_mag) + (IB_mag*IB_mag) + (IC_mag*IC_mag)) * R_total / 1000;
        globalLosses += losses_kW;

        // Courant de neutre (si 400V L-N)
        // ✅ EQUI8 : Appliquer la réduction du courant neutre pour les câbles en amont
        let IN_mag = is400V ? abs(add(add(IA, IB), IC)) : 0;
        const equi8Reduction = equi8UpstreamReductionForCables.get(cab.id);
        if (equi8Reduction && equi8Reduction > 0) {
          const IN_before = IN_mag;
          IN_mag = Math.max(0, IN_mag - equi8Reduction);
          console.log(`🔌 EQUI8 résultat câble ${cab.id}: I_N ${IN_before.toFixed(1)}A → ${IN_mag.toFixed(1)}A`);
        }

        calculatedCables.push({
          ...cab,
          length_m,
          current_A,
          voltageDrop_V: deltaU_line_V,
          voltageDropPercent: deltaU_percent,
          losses_kW,
          apparentPower_kVA: undefined,
          currentsPerPhase_A: { A: IA_mag, B: IB_mag, C: IC_mag, N: is400V ? IN_mag : undefined },
          voltageDropPerPhase_V: { A: dVA, B: dVB, C: dVC }
        });
      }

      // Tension nodale (pire phase) et conformité
      let worstAbsPct = 0;
      const nodeVoltageDrops: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[] = [];
      const nodePhasorsPerPhase: { nodeId: string; phase: 'A'|'B'|'C'; V_real: number; V_imag: number; V_phase_V: number; V_angle_deg: number }[] = [];

      const sourceNode = nodes.find(n => n.isSource);
      for (const n of nodes) {
        // Récupération des tensions nodales par phase avec même angle global (préservation des circuits)
        const Va = phaseA.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vb = phaseB.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vc = phaseC.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Va_mag = abs(Va);
        const Vb_mag = abs(Vb);
        const Vc_mag = abs(Vc);

        nodePhasorsPerPhase.push(
          { nodeId: n.id, phase: 'A', V_real: Va.re, V_imag: Va.im, V_phase_V: Va_mag, V_angle_deg: (Math.atan2(Va.im, Va.re)*180)/Math.PI },
          { nodeId: n.id, phase: 'B', V_real: Vb.re, V_imag: Vb.im, V_phase_V: Vb_mag, V_angle_deg: (Math.atan2(Vb.im, Vb.re)*180)/Math.PI },
          { nodeId: n.id, phase: 'C', V_real: Vc.re, V_imag: Vc.im, V_phase_V: Vc_mag, V_angle_deg: (Math.atan2(Vc.im, Vc.re)*180)/Math.PI },
        );
        
        // ✅ CORRECTION : Pour conformité EN50160, toujours prendre la PIRE phase (MIN pour chute de tension)
        let U_node_line_tension: number;
        const scaleLine = this.getDisplayLineScale(n.connectionType);
        U_node_line_tension = Math.min(Va_mag, Vb_mag, Vc_mag) * scaleLine;

        // ===== CORRECTION 2 BIS : RÉFÉRENCE DE TENSION POUR CONFORMITÉ =====
        let U_ref_display: number;
        if (n.connectionType === 'MONO_230V_PN') {
          // Référence phase-neutre EN50160
          U_ref_display = 230;
        } else if (sourceNode?.tensionCible) {
          U_ref_display = sourceNode.tensionCible;
        } else {
          const { U_base } = this.getVoltage(n.connectionType);
          U_ref_display = U_base;
        }

        const deltaU_V = U_ref_display - U_node_line_tension;
        const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

        // ===== CORRECTION 3 : CALCUL DE CONFORMITÉ EN50160 AVEC RÉFÉRENCE NOMINALE CORRECTE =====
        let U_nom: number;
        if (n.connectionType === 'MONO_230V_PN') {
          // Pour les nœuds monophasés phase-neutre : référence 230V (EN50160)
          U_nom = 230;
        } else {
          // Logique standard selon le type de connexion
          const { U_base } = this.getVoltage(n.connectionType);
          U_nom = U_base;
        }
        
        const deltaU_pct_nominal = U_nom ? ((U_nom - U_node_line_tension) / U_nom) * 100 : 0;
        const absPctNom = Math.abs(deltaU_pct_nominal);
        
        if (absPctNom > worstAbsPct) worstAbsPct = absPctNom;

        nodeVoltageDrops.push({ nodeId: n.id, deltaU_cum_V: deltaU_V, deltaU_cum_percent: deltaU_pct });
      }

      const compliance = this.getComplianceStatus(worstAbsPct);

      // Calcul du jeu de barres virtuel (préserver la notion de circuit en monophasé déséquilibré)
      let virtualBusbar: VirtualBusbar | undefined;
      if (transformerConfig) {
        // Courant net à la source par phase pour I_N
        let I_source_net_A = C(0, 0);
        let I_source_net_B = C(0, 0);
        let I_source_net_C = C(0, 0);
        
        for (const v of children.get(source.id) || []) {
          const cab = parentCableOfChild.get(v);
          if (!cab) continue;
          I_source_net_A = add(I_source_net_A, phaseA.I_branch_phase.get(cab.id) || C(0, 0));
          I_source_net_B = add(I_source_net_B, phaseB.I_branch_phase.get(cab.id) || C(0, 0));
          I_source_net_C = add(I_source_net_C, phaseC.I_branch_phase.get(cab.id) || C(0, 0));
        }
        
        const V_source_A = phaseA.V_node_phase.get(source.id) || fromPolar(Vslack_phase, this.deg2rad(0));
        const S_source_A = S_A_map.get(source.id) || C(0, 0);
        const S_source_B = S_B_map.get(source.id) || C(0, 0);
        const S_source_C = S_C_map.get(source.id) || C(0, 0);
        
        const Iinj_A = conj(div(S_source_A, V_source_A));
        const Iinj_B = conj(div(S_source_B, V_source_A)); // Même tension ref
        const Iinj_C = conj(div(S_source_C, V_source_A)); // Même tension ref
        
        I_source_net_A = add(I_source_net_A, Iinj_A);
        I_source_net_B = add(I_source_net_B, Iinj_B);
        I_source_net_C = add(I_source_net_C, Iinj_C);

        virtualBusbar = this.calculateVirtualBusbar(
          transformerConfig,
          totalLoads,
          totalProductions,
          source,
          children,
          S_aval,
          phaseA.V_node_phase,
          I_source_net_A,
          Ztr_phase,
          cableIndexByPair,
          { A: I_source_net_A, B: I_source_net_B, C: I_source_net_C }
        );
      }

      // ===== CORRECTION MAJEURE : AFFICHAGE COHÉRENT DES TENSIONS EN MODE DÉSÉQUILIBRÉ =====
      const nodeMetricsPerPhase = nodes.map(n => {
        const Va = phaseA.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vb = phaseB.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        const Vc = phaseC.V_node_phase.get(n.id) || fromPolar(Vslack_phase, globalAngle);
        
        // Tensions de phase (calculs internes)
        const Va_phase = abs(Va);
        const Vb_phase = abs(Vb);
        const Vc_phase = abs(Vc);
        
        // ===== CORRECTION 1 : AFFICHAGE DES TENSIONS SELON LE TYPE DE CONNEXION =====
        let Va_display, Vb_display, Vc_display, U_ref: number;
        
        if (n.connectionType === 'MONO_230V_PN') {
          // Monophasé phase-neutre : afficher tensions phase-neutre directement (PAS de √3 !)
          Va_display = Va_phase;
          Vb_display = Vb_phase; 
          Vc_display = Vc_phase;
          U_ref = 230; // Référence phase-neutre EN50160
          
        } else if (n.connectionType === 'TRI_230V_3F') {
          // Triphasé 230V : tensions composées = tensions de phase (système 230V)
          Va_display = Va_phase;
          Vb_display = Vb_phase;
          Vc_display = Vc_phase;
          U_ref = 230;
          
        } else if (n.connectionType === 'TÉTRA_3P+N_230_400V') {
          // Réseau 400V : afficher tensions PHASE-NEUTRE (230V)
          Va_display = Va_phase;
          Vb_display = Vb_phase;
          Vc_display = Vc_phase;
          U_ref = 230;
          
        } else {
          // Autres cas : logique avec scaling
          const scaleLine = this.getDisplayLineScale(n.connectionType);
          Va_display = Va_phase * scaleLine;
          Vb_display = Vb_phase * scaleLine;
          Vc_display = Vc_phase * scaleLine;
          
          // Référence standard
          const sourceNode = nodes.find(s => s.isSource);
          if (sourceNode?.tensionCible) {
            U_ref = sourceNode.tensionCible;
          } else {
            const { U_base } = this.getVoltage(n.connectionType);
            U_ref = U_base;
          }
        }
        
        // ===== CORRECTION 2 : CALCUL DE CONFORMITÉ EN50160 AVEC RÉFÉRENCE APPROPRIÉE =====
        
        // Calcul des déviations de tension par rapport à la référence EN50160
        // Valeur positive = surtension, négative = sous-tension
        const deviationA_percent = ((Va_display - U_ref) / U_ref) * 100;
        const deviationB_percent = ((Vb_display - U_ref) / U_ref) * 100;
        const deviationC_percent = ((Vc_display - U_ref) / U_ref) * 100;
        
        // Calcul des chutes de tension par rapport à la référence (pour compatibilité affichage)
        const dropA = U_ref - Va_display;
        const dropB = U_ref - Vb_display;
        const dropC = U_ref - Vc_display;
        
        // ===== AMÉLIORATION : CONFORMITÉ EN50160 MULTI-PHASE =====
        // Évaluation individuelle de chaque phase selon EN50160
        // Conformité basée sur la valeur absolue de la déviation
        const compliancePerPhase = {
          A: this.getComplianceStatus(Math.abs(deviationA_percent)),
          B: this.getComplianceStatus(Math.abs(deviationB_percent)),
          C: this.getComplianceStatus(Math.abs(deviationC_percent))
        };
        
        // Conformité globale du nœud = pire cas des 3 phases
        const phaseCompliances = [compliancePerPhase.A, compliancePerPhase.B, compliancePerPhase.C];
        const nodeCompliance: 'normal' | 'warning' | 'critical' = phaseCompliances.includes('critical') ? 'critical' :
                              phaseCompliances.includes('warning') ? 'warning' : 'normal';
        
        return {
          nodeId: n.id,
          voltagesPerPhase: {
            A: Va_display,
            B: Vb_display,
            C: Vc_display
          },
          voltageDropsPerPhase: {
            A: dropA,
            B: dropB,
            C: dropC
          },
          deviationsPerPhase: {
            A: deviationA_percent,
            B: deviationB_percent,
            C: deviationC_percent
          },
          compliancePerPhase,
          nodeCompliance
        };
      });

      // ===== AMÉLIORATION : CONFORMITÉ GLOBALE BASÉE SUR L'ANALYSE MULTI-PHASE =====
      // Évaluation de la conformité globale à partir de l'analyse par phase
      const globalComplianceFromPhases = nodeMetricsPerPhase.reduce((worst, node) => {
        if (node.nodeCompliance === 'critical') return 'critical';
        if (node.nodeCompliance === 'warning' && worst !== 'critical') return 'warning';
        return worst;
      }, 'normal' as 'normal' | 'warning' | 'critical');
      
      // Utiliser la conformité multi-phase si elle est plus restrictive que l'analyse globale
      const finalCompliance = globalComplianceFromPhases === 'critical' ? 'critical' :
                              globalComplianceFromPhases === 'warning' ? 'warning' : compliance;

      // Construire les températures de câble estimées
      const cableTemperatures = cableTempMap.size > 0 
        ? Array.from(cableTempMap.entries()).map(([cableId, temperature_C]) => ({ 
            cableId, 
            temperature_C: Math.round(temperature_C * 10) / 10 
          }))
        : undefined;

      const result: CalculationResult = {
        scenario,
        cables: calculatedCables,
        totalLoads_kVA: totalLoads,
        totalProductions_kVA: totalProductions,
        globalLosses_kW: Number(globalLosses.toFixed(6)),
        maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
        maxVoltageDropCircuitNumber: undefined,
        compliance: finalCompliance,
        nodeVoltageDrops,
        nodeMetrics: undefined,
        nodePhasors: undefined,
        nodePhasorsPerPhase,
        nodeMetricsPerPhase,
        cablePowerFlows: undefined,
        cableTemperatures,
        virtualBusbar
      };

      console.log(`[ElectricalCalculator] Conformité multi-phase: global=${globalComplianceFromPhases}, final=${finalCompliance}`);
      return result;
    }

    // ---- Mode équilibré (avec cos phi séparés) ----
    // Helper: per-node per-phase complex power in VA (signed)
    const S_node_phase_VA = new Map<string, Complex>();
    const computeNodeS = () => {
      S_node_phase_VA.clear();
      for (const n of nodes) {
        // Récupérer charges et productions brutes
        const S_charges_kVA = S_prel_map.get(n.id) || 0;
        const S_productions_kVA = S_pv_map.get(n.id) || 0;
        
        // ===== SOMME VECTORIELLE pour mode équilibré =====
        // CHARGES: P_load = S_charge × cos(φ_charges), Q_load = S_charge × sin(φ_charges)
        const P_load_kW = S_charges_kVA * cosPhiCharges_eff;
        const Q_load_kVAr = S_charges_kVA * sinPhiCharges;
        
        // PRODUCTIONS: P_prod = S_prod × cos(φ_productions), Q_prod = S_prod × sin(φ_productions)
        const P_prod_kW = S_productions_kVA * cosPhiProductions_eff;
        const Q_prod_kVAr = S_productions_kVA * sinPhiProductions;
        
        // NET: P_net = P_load - P_prod, Q_net = Q_load - Q_prod
        let P_net_kW = 0, Q_net_kVAr = 0;
        if (scenario === 'PRÉLÈVEMENT') {
          P_net_kW = P_load_kW;
          Q_net_kVAr = Q_load_kVAr;
        } else if (scenario === 'PRODUCTION') {
          P_net_kW = -P_prod_kW;
          Q_net_kVAr = -Q_prod_kVAr;
        } else {
          P_net_kW = P_load_kW - P_prod_kW;
          Q_net_kVAr = Q_load_kVAr - Q_prod_kVAr;
        }
        
        const S_VA_total = C(P_net_kW * 1000, Q_net_kVAr * 1000);

        // Contributions explicites P/Q (équipements virtuels)
        let S_extra_VA = C(0, 0);
        for (const it of ((n as any).clients || [])) {
          const P = Number((it as any).P_kW) || 0;
          const Q = Number((it as any).Q_kVAr) || 0;
          if (P !== 0 || Q !== 0) {
            S_extra_VA = add(S_extra_VA, C(P * 1000, Q * 1000));
          }
        }
        for (const it of ((n as any).productions || [])) {
          const P = Number((it as any).P_kW) || 0;
          const Q = Number((it as any).Q_kVAr) || 0;
          if (P !== 0 || Q !== 0) {
            S_extra_VA = sub(S_extra_VA, C(P * 1000, Q * 1000)); // injection => signe négatif
          }
        }

        const { isThreePhase } = this.getVoltage(n.connectionType);
        const divisor = isThreePhase ? 3 : 1;
        const S_total_phase = scale(add(S_VA_total, S_extra_VA), 1 / divisor);
        S_node_phase_VA.set(n.id, S_total_phase);
      }
    };
    computeNodeS();

    // Iterative BFS
    const maxIter = ElectricalCalculator.MAX_ITERATIONS;
    const tol = ElectricalCalculator.CONVERGENCE_TOLERANCE;
    let iter = 0;
    let converged = false;

    // Storage
    const I_branch = new Map<string, Complex>(); // by cable id (per phase)
    const I_inj_node = new Map<string, Complex>();

    while (iter < maxIter) {
      iter++;
      const V_prev = new Map(V_node);

      // Backward: compute injection currents then branch currents bottom-up
      I_branch.clear();
      I_inj_node.clear();

      for (const n of nodes) {
        const Vn = V_node.get(n.id) || Vslack;
        const Sph = S_node_phase_VA.get(n.id) || C(0, 0);
        const Vsafe = abs(Vn) > ElectricalCalculator.MIN_VOLTAGE_SAFETY ? Vn : Vslack;
        // I = conj(S / V)
        const Iinj = conj(div(Sph, Vsafe));
        I_inj_node.set(n.id, Iinj);
      }

      for (const u of postOrder) {
        if (u === source.id) continue;
        const childrenIds = children.get(u) || [];
        let I_sum = C(0, 0);
        for (const v of childrenIds) {
          const cabChild = parentCableOfChild.get(v);
          if (!cabChild) continue;
          const Ichild = I_branch.get(cabChild.id) || C(0, 0);
          I_sum = add(I_sum, Ichild);
        }
        I_sum = add(I_sum, I_inj_node.get(u) || C(0, 0));
        const cab = parentCableOfChild.get(u);
        if (cab) I_branch.set(cab.id, I_sum);
      }

      // Current entering the source bus from network
      let I_source_net = C(0, 0);
      for (const v of children.get(source.id) || []) {
        const cab = parentCableOfChild.get(v);
        if (!cab) continue;
        I_source_net = add(I_source_net, I_branch.get(cab.id) || C(0, 0));
      }
      I_source_net = add(I_source_net, I_inj_node.get(source.id) || C(0, 0));

      // Forward: propagate voltages from slack through transformer and along feeders
      const V_source_bus = Ztr_phase ? sub(Vslack, mul(Ztr_phase, I_source_net)) : Vslack;
      V_node.set(source.id, V_source_bus);

      const stack2 = [source.id];
      while (stack2.length) {
        const u = stack2.pop()!;
        for (const v of children.get(u) || []) {
          const cab = parentCableOfChild.get(v);
          if (!cab) continue;
          const Z = cableZ_phase.get(cab.id) || C(0, 0);
          const Iuv = I_branch.get(cab.id) || C(0, 0);
          const Vu = V_node.get(u) || Vslack;
          
          // Vérifier si le nœud de destination est une source SRG2
          const vNode = nodeById.get(v);
          if (vNode?.tensionCible) {
            // Utiliser la tension cible globale si disponible
            const Vv_target = C(vNode.tensionCible, 0);
            V_node.set(v, Vv_target);
            console.log(`🎯 Nœud ${v}: tension cible appliquée ${vNode.tensionCible.toFixed(1)}V`);
          } else {
            // Calcul normal pour les nœuds sans tension cible
            const Vv = sub(Vu, mul(Z, Iuv));
            V_node.set(v, Vv);
          }
          stack2.push(v);
        }
      }

      // Convergence check
      let maxDelta = 0;
      for (const [nid, Vn] of V_node.entries()) {
        const Vp = V_prev.get(nid) || Vslack;
        const d = abs(sub(Vn, Vp));
        if (d > maxDelta) maxDelta = d;
      }
      if (maxDelta / (Vslack_phase || 1) < tol) { converged = true; break; }
    }
    if (!converged) {
      console.warn(`⚠️ Backward–Forward Sweep non convergé (tol=${tol}, maxIter=${maxIter}). Les résultats peuvent être approximatifs.`);
    }

    // Compose cable results from final branch currents and voltages
    calculatedCables.length = 0;
    globalLosses = 0;

    for (const cab of cables) {
      const childId = cableChildId.get(cab.id);
      const parentId = cableParentId.get(cab.id);
      const length_m = this.calculateLengthMeters(cab.coordinates || []);
      const L_km = length_m / 1000;
      const ct = cableTypeById.get(cab.typeId);
      if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);

      // Determine distal node (child) for connection type
      const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
      const distalNode = nodeById.get(distalId)!;
      const { isThreePhase } = this.getVoltage(distalNode.connectionType);

      // Per-phase Z
      let Z = cableZ_phase.get(cab.id);
      if (!Z) {
        // In case edge is not in the tree (shouldn't happen in radial), compute on the fly
        const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
        const { R: R_ohm_per_km, X: X_ohm_per_km } = this.selectRX(ct, is400V, false, false);
        Z = C(R_ohm_per_km * L_km, X_ohm_per_km * L_km);
      }

      const Iph = I_branch.get(cab.id) || C(0, 0);
      const dVph = mul(Z!, Iph);
      const current_A = abs(Iph);
      // ===== CORRECTION : Appliquer √3 pour TOUS les réseaux triphasés (triangle ET étoile) =====
      // Formule officielle: ΔU = √3 × I × (R×cosφ + X×sinφ) × L
      const deltaU_line_V = isThreePhase 
        ? abs(dVph) * Math.sqrt(3)
        : abs(dVph);

      // Base voltage for percent: prefer source target voltage if provided
      let { U_base } = this.getVoltage(distalNode.connectionType);
      const srcTarget = nodes.find(n => n.isSource)?.tensionCible;
      if (srcTarget) U_base = srcTarget;
      const deltaU_percent = U_base ? (deltaU_line_V / U_base) * 100 : 0;

      // Apparent power through the branch (kVA), computed at sending end (parent)
      const parentIdForCab = parentId ?? (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeAId : cab.nodeBId);
      const Vu = V_node.get(parentIdForCab || cab.nodeAId) || Vslack;
      const S_flow_phase = mul(Vu, conj(Iph)); // VA per phase (complex)
      const phaseFactor = isThreePhase ? 3 : 1;
      const apparentPower_kVA = (abs(S_flow_phase) * phaseFactor) / 1000;

      const R_total = Z!.re; // per phase
      const losses_kW = (current_A * current_A * R_total * phaseFactor) / 1000;

      globalLosses += losses_kW;

      calculatedCables.push({
        ...cab,
        length_m,
        current_A,
        voltageDrop_V: deltaU_line_V,
        voltageDropPercent: deltaU_percent,
        losses_kW,
        apparentPower_kVA
      });
    }

    // ---- Évaluation nodale basée sur les phasors V_node ----
    // On n'additionne plus les |ΔV| câble par câble ; on compare |V_node| à une référence U_ref
    let worstAbsPct = 0;
    const nodeVoltageDrops: { nodeId: string; deltaU_cum_V: number; deltaU_cum_percent: number }[] = [];

    const sourceNode = nodes.find(n => n.isSource);
    for (const n of nodes) {
      const Vn = V_node.get(n.id) || Vslack;
      const scaleLine = this.getDisplayLineScale(n.connectionType);
      const U_node_line = abs(Vn) * scaleLine;

      // Référence d'affichage: tension cible source si fournie, sinon base de ce type de connexion
      let { U_base: U_ref_display } = this.getVoltage(n.connectionType);
      if (sourceNode?.tensionCible) U_ref_display = sourceNode.tensionCible;

      const deltaU_V = U_ref_display - U_node_line;
      const deltaU_pct = U_ref_display ? (deltaU_V / U_ref_display) * 100 : 0;

      // Référence nominale (conformité): logique spéciale pour MONO_230V_PN en système 400V
      let U_nom: number;
      if (n.connectionType === 'MONO_230V_PN' && transformerConfig?.nominalVoltage_V && transformerConfig.nominalVoltage_V >= 350) {
        // Pour les nœuds monophasés phase-neutre en système 400V : référence 230V
        U_nom = 230;
      } else {
        // Logique standard
        const { U_base } = this.getVoltage(n.connectionType);
        U_nom = U_base;
      }
      const deltaU_pct_nominal = U_nom ? ((U_nom - U_node_line) / U_nom) * 100 : 0;
      const absPctNom = Math.abs(deltaU_pct_nominal);
      if (absPctNom > worstAbsPct) worstAbsPct = absPctNom;

      nodeVoltageDrops.push({
        nodeId: n.id,
        deltaU_cum_V: deltaU_V,
        deltaU_cum_percent: deltaU_pct
      });
    }

    const compliance = this.getComplianceStatus(worstAbsPct);

    // ---- VIRTUAL BUSBAR : calcul détaillé PAR DÉPART ----
    let virtualBusbar: VirtualBusbar | undefined;
    if (transformerConfig) {
      // Recalcule du courant net source après convergence
      let I_source_net_final = C(0, 0);
      for (const v of children.get(source.id) || []) {
        const cab = parentCableOfChild.get(v);
        if (!cab) continue;
        I_source_net_final = add(I_source_net_final, I_branch.get(cab.id) || C(0, 0));
      }
      I_source_net_final = add(I_source_net_final, I_inj_node.get(source.id) || C(0, 0));

      virtualBusbar = this.calculateVirtualBusbar(
        transformerConfig,
        totalLoads,
        totalProductions,
        source,
        children,
        S_aval,
        V_node,
        I_source_net_final,
        Ztr_phase,
        cableIndexByPair
      );

      console.log('✅ Virtual busbar calculated (phasor-based, per-depart):', virtualBusbar);
    }

    // ---- Node metrics (V_phase and p.u., I_inj per node) ----
    const nodeMetrics = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const { isThreePhase, U_base: U_nom_line } = this.getVoltage(n.connectionType);
      const V_phase_V = abs(Vn);
      // Pour TRI_230V_3F, pas de conversion car travail direct en composé
      const V_nom_phase = n.connectionType === 'TRI_230V_3F' 
        ? U_nom_line // 230V composée directement
        : U_nom_line / (isThreePhase ? Math.sqrt(3) : 1);
      const V_pu = V_nom_phase ? V_phase_V / V_nom_phase : 0;
      const Iinj = I_inj_node.get(n.id) || C(0, 0);
      return { nodeId: n.id, V_phase_V, V_pu, I_inj_A: abs(Iinj) };
    });

    // ---- Export phasors nodaux pour debug/analyse ----
    const nodePhasors = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const V_angle_deg = (Math.atan2(Vn.im, Vn.re) * 180) / Math.PI;
      return {
        nodeId: n.id,
        V_real: Vn.re,
        V_imag: Vn.im,
        V_phase_V: abs(Vn),
        V_angle_deg
      };
    });

    // ---- Export flux de puissance P/Q par tronçon ----
    const cablePowerFlows = calculatedCables.map(cab => {
      const childId = cableChildId.get(cab.id);
      const parentId = cableParentId.get(cab.id);
      const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
      const distalNode = nodeById.get(distalId)!;
      const { isThreePhase } = this.getVoltage(distalNode.connectionType);

      // Courant et tension au départ du tronçon
      const Iph = I_branch.get(cab.id) || C(0, 0);
      const parentIdForCab = parentId ?? (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeAId : cab.nodeBId);
      const Vu = V_node.get(parentIdForCab || cab.nodeAId) || Vslack;
      
      // Puissance complexe par phase : S = V * I*
      const S_phase = mul(Vu, conj(Iph));
      const phaseFactor = isThreePhase ? 3 : 1;
      
      const P_kW = (S_phase.re * phaseFactor) / 1000;
      const Q_kVAr = (S_phase.im * phaseFactor) / 1000;
      const S_kVA = (abs(S_phase) * phaseFactor) / 1000;
      const pf = S_kVA > 1e-6 ? Math.abs(P_kW / S_kVA) : 1; // facteur de puissance

      return {
        cableId: cab.id,
        P_kW: Number(P_kW.toFixed(3)),
        Q_kVAr: Number(Q_kVAr.toFixed(3)),
        S_kVA: Number(S_kVA.toFixed(3)),
        pf: Number(pf.toFixed(3))
      };
    });

    // ---- Déterminer le circuit avec la chute maximale ----
    let maxVoltageDropCircuitNumber: number | undefined;
    if (virtualBusbar?.circuits) {
      let worstDropPercent = 0;
      for (const circuit of virtualBusbar.circuits) {
        const circuitNodes = new Set<string>();
        // Trouver tous les nœuds de ce circuit
        const mainCircuitCables = cables.filter(c => c.id === circuit.circuitId);
        for (const cable of mainCircuitCables) {
          circuitNodes.add(cable.nodeAId);
          circuitNodes.add(cable.nodeBId);
        }
        
        // Trouver la pire chute dans ce circuit
        for (const nodeId of circuitNodes) {
          const nodeVoltageDrop = nodeVoltageDrops.find(nvd => nvd.nodeId === nodeId);
          if (nodeVoltageDrop) {
            const absPct = Math.abs(nodeVoltageDrop.deltaU_cum_percent);
            if (absPct > worstDropPercent) {
              worstDropPercent = absPct;
              // Déterminer le numéro de circuit
              const sourceNode = nodes.find(n => n.isSource);
              if (sourceNode) {
                const mainCircuitCables = cables
                  .filter(cable => cable.nodeAId === sourceNode.id || cable.nodeBId === sourceNode.id)
                  .sort((a, b) => a.id.localeCompare(b.id));
                const circuitIndex = mainCircuitCables.findIndex(cable => cable.id === circuit.circuitId);
                maxVoltageDropCircuitNumber = circuitIndex >= 0 ? circuitIndex + 1 : undefined;
              }
            }
          }
        }
      }
    }

    // ---- Generate nodeMetricsPerPhase for balanced mode ----
    const nodeMetricsPerPhase = nodes.map(n => {
      const Vn = V_node.get(n.id) || Vslack;
      const { isThreePhase, U_base: U_nom_line } = this.getVoltage(n.connectionType);
      const V_phase_V = abs(Vn);
      
      const scaleLine = this.getDisplayLineScale(n.connectionType);
      const V_display = V_phase_V * scaleLine;
      
      let { U_base: U_ref } = this.getVoltage(n.connectionType);
      const sourceNode = nodes.find(s => s.isSource);
      if (sourceNode?.tensionCible) U_ref = sourceNode.tensionCible;
      
      console.log(`🔍 Balanced mode - Node ${n.id}: ${V_display.toFixed(1)}V (same for all phases)`);
      
      return {
        nodeId: n.id,
        voltagesPerPhase: {
          A: V_display,
          B: V_display, 
          C: V_display
        },
        voltageDropsPerPhase: {
          A: U_ref - V_display,
          B: U_ref - V_display,
          C: U_ref - V_display
        }
      };
    });

    console.log('🔄 Creating result object...');
    const result: CalculationResult = {
      scenario,
      cables: calculatedCables,
      totalLoads_kVA: totalLoads,
      totalProductions_kVA: totalProductions,
      globalLosses_kW: Number(globalLosses.toFixed(6)),
      maxVoltageDropPercent: Number(worstAbsPct.toFixed(6)),
      maxVoltageDropCircuitNumber,
      compliance,
      nodeVoltageDrops,
      nodeMetrics,
      nodePhasors,
      nodePhasorsPerPhase: undefined, // Seulement en mode déséquilibré
      nodeMetricsPerPhase, // Maintenant toujours disponible
      cablePowerFlows,
      virtualBusbar,
      manualPhaseDistribution
    };

    console.log('✅ calculateScenario completed successfully for scenario:', scenario);
    return result;
  }

  // Méthodes utilitaires pour validation et gestion d'erreurs
  private validateInputs(
    nodes: Node[],
    cables: Cable[],
    cableTypes: CableType[],
    foisonnementCharges: number,
    foisonnementProductions: number,
    desequilibrePourcent: number
  ): void {
    if (!nodes || nodes.length === 0) {
      throw new Error('Aucun nœud fourni pour le calcul');
    }
    
    if (!cables || cables.length === 0) {
      throw new Error('Aucun câble fourni pour le calcul');
    }
    
    if (!cableTypes || cableTypes.length === 0) {
      throw new Error('Aucun type de câble fourni pour le calcul');
    }
    
    if (!isFinite(foisonnementCharges) || foisonnementCharges < 0 || foisonnementCharges > 200) {
      throw new Error(`Facteur de foisonnement charges invalide: ${foisonnementCharges}% (doit être entre 0 et 200)`);
    }
    
    if (!isFinite(foisonnementProductions) || foisonnementProductions < 0 || foisonnementProductions > 200) {
      throw new Error(`Facteur de foisonnement productions invalide: ${foisonnementProductions}% (doit être entre 0 et 200)`);
    }
    
    if (!isFinite(desequilibrePourcent) || desequilibrePourcent < 0 || desequilibrePourcent > 100) {
      throw new Error(`Pourcentage de déséquilibre invalide: ${desequilibrePourcent}% (doit être entre 0 et 100)`);
    }

    // Vérifier qu'il y a exactement une source
    const sources = nodes.filter(n => n.isSource);
    if (sources.length !== 1) {
      throw new Error(`Le réseau doit avoir exactement une source, trouvé: ${sources.length}`);
    }

    // Vérifier que tous les types de câbles référencés existent
    const cableTypeIds = new Set(cableTypes.map(ct => ct.id));
    const missingTypes = cables
      .map(c => c.typeId)
      .filter(typeId => !cableTypeIds.has(typeId));
    
    if (missingTypes.length > 0) {
      throw new Error(`Types de câbles manquants: ${missingTypes.join(', ')}`);
    }

    // Vérifier que tous les nœuds référencés dans les câbles existent
    const nodeIds = new Set(nodes.map(n => n.id));
    const missingNodes: string[] = [];
    
    for (const cable of cables) {
      if (!nodeIds.has(cable.nodeAId)) missingNodes.push(cable.nodeAId);
      if (!nodeIds.has(cable.nodeBId)) missingNodes.push(cable.nodeBId);
    }
    
    if (missingNodes.length > 0) {
      throw new Error(`Nœuds manquants référencés dans les câbles: ${[...new Set(missingNodes)].join(', ')}`);
    }
  }
}
