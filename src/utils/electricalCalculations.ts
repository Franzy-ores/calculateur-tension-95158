import { Node, Cable, Project, CalculationResult, CalculationScenario, ConnectionType, CableType, TransformerConfig, VirtualBusbar, LoadModel, ClientImporte, ClientLink, CablePose } from '@/types/network';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { Complex, C, add, sub, mul, div, conj, scale, abs, fromPolar, arg } from '@/utils/complex';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';
import { getLinkedClientsForNode, calculateNodePowersFromClients } from '@/utils/clientsUtils';
import { getThermalCorrectionFactor, ThermalSeason, getAmbientTemperature, calculateCableTemperature, InsulationType } from '@/utils/thermalModel';

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
    thermalContext?: { season: ThermalSeason; pose: CablePose; I_A?: number; Imax_A?: number; insulationType?: InsulationType }
  ): { R: number, X: number } {
    // Calcul du facteur de correction thermique
    // 🔧 FIX GRD — Passe insulationType pour borner T_cable à T_max normative
    let thermalFactor = 1;
    if (thermalContext) {
      thermalFactor = getThermalCorrectionFactor(
        thermalContext.season,
        thermalContext.pose,
        cableType.matiere,
        thermalContext.I_A || 0,
        thermalContext.Imax_A || cableType.maxCurrent_A || 0,
        thermalContext.insulationType || cableType.insulationType as InsulationType | undefined
      );
    }

    // Conducteur neutre → toujours R0/X0 (avec correction thermique)
    if (forNeutral) {
      return { 
        R: cableType.R0_ohm_per_km * thermalFactor, 
        X: cableType.X0_ohm_per_km 
      };
    }
    
    // Conducteurs de phase
    if (isUnbalanced) {
      // Mode déséquilibré: R12/X12 direct (le neutre est modélisé séparément via R0/X0)
      return {
        R: cableType.R12_ohm_per_km * thermalFactor,
        X: cableType.X12_ohm_per_km
      };
    }
    // Mode équilibré: formule GRD belge (R0 + 2*R12) / 3
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
    nodes: Node[],
    I_source_net_phases?: { A: Complex; B: Complex; C: Complex }, // Pour I_N en mode déséquilibré
    // Phases B et C pour calcul correct des tensions ligne-à-ligne en delta 230V
    V_node_B?: Map<string, Complex>,
    V_node_C?: Map<string, Complex>
  ): VirtualBusbar {
    const { U_base: U_nom_source, isThreePhase: isSourceThree } = this.getVoltage(source.connectionType);
    const U_ref_line = source.tensionCible ?? transformerConfig.sourceVoltage ?? transformerConfig.nominalVoltage_V ?? U_nom_source;

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
        const nodeConnType: ConnectionType = nodes.find(n => n.id === nid)?.connectionType ?? source.connectionType;

        if (nodeConnType === 'TRI_230V_3F' && V_node_B && V_node_C) {
          // Delta 230V : tensions physiques = ligne-à-ligne depuis phaseurs complexes
          const Vb = V_node_B.get(nid);
          const Vc = V_node_C.get(nid);
          if (Vb && Vc) {
            const vAB = abs(sub(nV, Vb));
            const vBC = abs(sub(Vb, Vc));
            const vAC = abs(sub(nV, Vc));
            const vMin = Math.min(vAB, vBC, vAC);
            const vMax = Math.max(vAB, vBC, vAC);
            if (vMin < minNodeVoltage) minNodeVoltage = vMin;
            if (vMax > maxNodeVoltage) maxNodeVoltage = vMax;
          } else {
            // Fallback : estimation √3
            const U_node_line = abs(nV) * Math.sqrt(3);
            if (U_node_line < minNodeVoltage) minNodeVoltage = U_node_line;
            if (U_node_line > maxNodeVoltage) maxNodeVoltage = U_node_line;
          }
        } else {
          const scaleLine = this.getDisplayLineScale(nodeConnType);
          const U_node_line = abs(nV) * scaleLine;
          if (U_node_line < minNodeVoltage) minNodeVoltage = U_node_line;
          if (U_node_line > maxNodeVoltage) maxNodeVoltage = U_node_line;
        }
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
      project.season as ThermalSeason | undefined,
      project.sagFactorPercent
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
    season?: ThermalSeason,
    // Facteur de flèche câbles aériens (%), défaut 3
    sagFactorPercent?: number
  ): CalculationResult {
    // Helper: correction facteur de flèche pour câbles aériens
    const applySagCorrection = (rawLength_m: number, pose: string): number => {
      if (pose === 'AÉRIEN') {
        return rawLength_m * (1 + ((sagFactorPercent ?? 3) / 100));
      }
      return rawLength_m;
    };

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
    // Mode équilibré désactivé — le réseau est toujours traité en mixte déséquilibré.
    // Raison : seul le mode mixte_mono_poly couvre correctement :
    //   - la correction thermique saisonnière en 2 passes (été/hiver)
    //   - le conducteur neutre (R0/X0 + passes thermiques)
    //   - les charges MONO phase-phase (delta 230V) via phasePhaseLoads_map
    //   - le déséquilibre réel par nœud via autoPhaseDistribution
    if (loadModel !== 'mixte_mono_poly' && loadModel !== 'monophase_reparti') {
      console.warn(`⚠️ LoadModel "${loadModel}" désactivé — forcé en mixte_mono_poly (mode équilibré retiré)`);
      loadModel = 'mixte_mono_poly';
    }
    const isUnbalanced = true; // Toujours déséquilibré
    
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
      const length_m_raw = this.calculateLengthMeters(cab.coordinates || []);
      const length_m = applySagCorrection(length_m_raw, cab.pose);
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
    // ⚠️ SINGLE √3 CONVERSION POINT: V_LL → V_phase_internal
    // All other √3 conversions are for display only (getDisplayLineScale)
    // Delta display uses Va-Vb (no √3 needed). Do NOT add another ÷√3 elsewhere.
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
        // Réseau triangle 3-fil : V_phase_interne = V_LL / √3
        // Le BFS travaille en tensions de phase (≈133V), les tensions LL sont reconstituées à l'affichage
        Vslack_phase = source.tensionCible / Math.sqrt(3);
        console.log(`📐 Triangle 230V: ${source.tensionCible}V phase-phase → ${Vslack_phase.toFixed(1)}V phase interne (÷√3)`);
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
      } else if (source.connectionType === 'TRI_230V_3F') {
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
      } else if (source.connectionType === 'TRI_230V_3F') {
        Vslack_phase = U_line / Math.sqrt(3); // Triangle : V_phase_interne = V_LL / √3
      } else {
        Vslack_phase = U_line; // Mono : utiliser directement
      }
    } else {
      // 4. Fallback sur U_line_base
      if (source.connectionType === 'TÉTRA_3P+N_230_400V') {
        Vslack_phase = U_line_base / Math.sqrt(3);
      } else if (source.connectionType === 'TRI_230V_3F') {
        Vslack_phase = U_line_base / Math.sqrt(3);
      } else {
        Vslack_phase = U_line_base;
      }
    }
    
    // 3. Validation élargie : accepter 100-450V pour couvrir 230V/√3≈133V (triangle interne) jusqu'à 400V
    if (!isFinite(Vslack_phase) || Vslack_phase < 100 || Vslack_phase > 450) {
      console.warn(`⚠️ Vslack_phase hors limites: ${Vslack_phase}V, réinitialisation basée sur type réseau`);
      // Réinitialisation intelligente basée sur le type de réseau
      if (source.connectionType === 'TÉTRA_3P+N_230_400V') {
        Vslack_phase = 230;
      } else if (source.connectionType === 'TRI_230V_3F') {
        Vslack_phase = U_line_base / Math.sqrt(3);
      } else {
        Vslack_phase = U_line_base;
      }
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
        
        // Détecter réseau 230V delta pour exclure MONO des S_maps
        const is230VDelta = U_line_base < ElectricalCalculator.VOLTAGE_400V_THRESHOLD;

        if (is230VDelta && n.autoPhaseDistribution) {
          // ✅ 230V Delta : S_maps ne doivent contenir que les charges POLY
          // Les charges MONO sont injectées séparément via phasePhaseLoads_map dans runCoupledBFSForDelta
          const polyCharges = n.autoPhaseDistribution.charges.poly;
          const polyProds   = n.autoPhaseDistribution.productions.poly;
          const totalPolyC  = polyCharges.A + polyCharges.B + polyCharges.C;
          const totalPolyP  = polyProds.A + polyProds.B + polyProds.C;

          if (totalPolyC > 0.001) {
            pA_charges = polyCharges.A / totalPolyC;
            pB_charges = polyCharges.B / totalPolyC;
            pC_charges = polyCharges.C / totalPolyC;
          } else {
            // Aucune charge POLY : S_maps = 0 (tout sera dans phasePhaseLoads_map)
            pA_charges = 0; pB_charges = 0; pC_charges = 0;
          }

          if (totalPolyP > 0.001) {
            pA_productions = polyProds.A / totalPolyP;
            pB_productions = polyProds.B / totalPolyP;
            pC_productions = polyProds.C / totalPolyP;
          } else {
            pA_productions = 0; pB_productions = 0; pC_productions = 0;
          }

          console.log(`📊 Nœud ${n.name || n.id}: 230V Delta → S_maps POLY uniquement (MONO via phasePhaseLoads_map)`);
          console.log(`   Ratios charges POLY: A=${(pA_charges*100).toFixed(1)}%, B=${(pB_charges*100).toFixed(1)}%, C=${(pC_charges*100).toFixed(1)}%`);
        } else if (n.autoPhaseDistribution) {
          // ✅ PRIORITÉ : utiliser les valeurs foisonnées avec curseurs si disponibles
          if (n.autoPhaseDistribution.charges.foisonneAvecCurseurs && 
              n.autoPhaseDistribution.productions.foisonneAvecCurseurs) {
            
            const totalChargesFoisonne = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.A + 
                                n.autoPhaseDistribution.charges.foisonneAvecCurseurs.B + 
                                n.autoPhaseDistribution.charges.foisonneAvecCurseurs.C;
            const totalProdsFoisonne = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.A + 
                              n.autoPhaseDistribution.productions.foisonneAvecCurseurs.B + 
                              n.autoPhaseDistribution.productions.foisonneAvecCurseurs.C;
            
            if (totalChargesFoisonne > 0.001) {
              pA_charges = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.A / totalChargesFoisonne;
              pB_charges = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.B / totalChargesFoisonne;
              pC_charges = n.autoPhaseDistribution.charges.foisonneAvecCurseurs.C / totalChargesFoisonne;
            } else {
              // 🔧 FIX: Quand foisonnement=0%, les valeurs foisonnées sont nulles
              // → Fallback sur les ratios physiques bruts (.total) pour conserver le déséquilibre
              const totalChargesBrut = n.autoPhaseDistribution.charges.total.A + 
                                      n.autoPhaseDistribution.charges.total.B + 
                                      n.autoPhaseDistribution.charges.total.C;
              if (totalChargesBrut > 0.001) {
                pA_charges = n.autoPhaseDistribution.charges.total.A / totalChargesBrut;
                pB_charges = n.autoPhaseDistribution.charges.total.B / totalChargesBrut;
                pC_charges = n.autoPhaseDistribution.charges.total.C / totalChargesBrut;
                console.log(`📊 Nœud ${n.name || n.id}: foisonneAvecCurseurs=0 → fallback charges.total pour ratios`);
              }
            }
            
            if (totalProdsFoisonne > 0.001) {
              pA_productions = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.A / totalProdsFoisonne;
              pB_productions = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.B / totalProdsFoisonne;
              pC_productions = n.autoPhaseDistribution.productions.foisonneAvecCurseurs.C / totalProdsFoisonne;
            } else {
              // 🔧 FIX: Même fallback pour les productions
              const totalProdsBrut = n.autoPhaseDistribution.productions.total.A + 
                                    n.autoPhaseDistribution.productions.total.B + 
                                    n.autoPhaseDistribution.productions.total.C;
              if (totalProdsBrut > 0.001) {
                pA_productions = n.autoPhaseDistribution.productions.total.A / totalProdsBrut;
                pB_productions = n.autoPhaseDistribution.productions.total.B / totalProdsBrut;
                pC_productions = n.autoPhaseDistribution.productions.total.C / totalProdsBrut;
                console.log(`📊 Nœud ${n.name || n.id}: foisonneAvecCurseurs=0 → fallback productions.total pour ratios`);
              }
            }
            
            console.log(`📊 Nœud ${n.name || n.id}: utilise foisonneAvecCurseurs (foisonnement + curseurs)`);
            console.log(`   Charges: A=${(pA_charges*100).toFixed(1)}%, B=${(pB_charges*100).toFixed(1)}%, C=${(pC_charges*100).toFixed(1)}%`);

            // (Avertissement POLY supprimé — en 230V les curseurs redistribuent désormais les POLY)
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
        
        // Vérification de cohérence (skip pour delta MONO-only car ratios peuvent être 0)
        const totalCharges = pA_charges + pB_charges + pC_charges;
        const totalProductions = pA_productions + pB_productions + pC_productions;
        if (!is230VDelta && Math.abs(totalCharges - 1) > 1e-6) {
          console.warn(`⚠️ Répartition des charges incohérente pour nœud ${n.id}: total=${totalCharges}`);
        }
        if (!is230VDelta && Math.abs(totalProductions - 1) > 1e-6) {
          console.warn(`⚠️ Répartition des productions incohérente pour nœud ${n.id}: total=${totalProductions}`);
        }
        
        // Récupérer les charges et productions brutes (AVANT NET)
        const S_prel_kVA = S_prel_map.get(n.id) || 0;
        const S_pv_kVA = S_pv_map.get(n.id) || 0;

        // Pour 230V Delta : S_maps = puissance POLY foisonnée uniquement
        // Les charges MONO sont injectées via phasePhaseLoads_map dans le BFS couplé
        let S_charges_for_maps_kVA: number;
        let S_prods_for_maps_kVA: number;

        if (is230VDelta && n.autoPhaseDistribution) {
          const polyC = n.autoPhaseDistribution.charges.poly;
          const polyP = n.autoPhaseDistribution.productions.poly;
          const totalPolyCharges = polyC.A + polyC.B + polyC.C;
          const totalPolyProds = polyP.A + polyP.B + polyP.C;
          // Appliquer foisonnement aux charges POLY uniquement
          S_charges_for_maps_kVA = totalPolyCharges * ((foisonnementChargesResidentiel ?? foisonnementCharges) / 100);
          S_prods_for_maps_kVA = totalPolyProds * ((foisonnementProductions ?? 100) / 100);
          console.log(`📊 Nœud ${n.name || n.id}: S_maps POLY: charges=${S_charges_for_maps_kVA.toFixed(2)}kVA, prods=${S_prods_for_maps_kVA.toFixed(2)}kVA`);
        } else {
          S_charges_for_maps_kVA = S_prel_kVA;
          S_prods_for_maps_kVA = S_pv_kVA;
        }
        
        // 1. Calculer les CHARGES par phase
        const S_A_charges_kVA = S_charges_for_maps_kVA * pA_charges;
        const S_B_charges_kVA = S_charges_for_maps_kVA * pB_charges;
        const S_C_charges_kVA = S_charges_for_maps_kVA * pC_charges;
        
        // 2. Calculer les PRODUCTIONS par phase
        const S_A_prod_kVA = S_prods_for_maps_kVA * pA_productions;
        const S_B_prod_kVA = S_prods_for_maps_kVA * pB_productions;
        const S_C_prod_kVA = S_prods_for_maps_kVA * pC_productions;
        
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

        // NOTE: Pour les réseaux 230V triangle, les charges MONO phase-phase
        // sont maintenant injectées directement dans runCoupledBFSForDelta
        // via phasePhaseLoads_map (courants calculés depuis V_AB, V_BC, V_AC).
        // Les S_A/B/C_map ne contiennent que les charges POLY équilibrées.

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

      const runBFSForPhase = (angleDeg: number, S_map: Map<string, Complex>, phaseLabel: 'A'|'B'|'C', V0_shift?: Complex, I_neutral_branches?: Map<string, Complex>) => {
        const V_node_phase = new Map<string, Complex>();
        const I_branch_phase = new Map<string, Complex>();
        const I_inj_node_phase = new Map<string, Complex>();

        const Vslack_phase_ph = V0_shift
          ? sub(fromPolar(Vslack_phase, this.deg2rad(angleDeg)), V0_shift)
          : fromPolar(Vslack_phase, this.deg2rad(angleDeg));
        for (const n of nodes) V_node_phase.set(n.id, Vslack_phase_ph);

        let iter2 = 0;
        let converged2 = false;
        while (iter2 < ElectricalCalculator.MAX_ITERATIONS) {
          iter2++;
          const V_prev2 = new Map(V_node_phase);
          // Store previous branch currents for dual convergence check
          const I_prev_phase = new Map(I_branch_phase);

          I_branch_phase.clear();
          I_inj_node_phase.clear();

          for (const n of nodes) {
            const Vn = V_node_phase.get(n.id) || Vslack_phase_ph;
            const Sph = S_map.get(n.id) || C(0, 0);
            // Divergence detection: flag near-zero voltages instead of silent replacement
            if (abs(Vn) < 1.0 && abs(Vn) > 0) {
              console.warn(`⚠️ [BFS phase ${phaseLabel}] Near-zero voltage at node ${n.id}: |V|=${abs(Vn).toFixed(3)}V — possible divergence`);
            }
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
              
              // Calculer tension selon Kirchhoff : V_v = V_u - Z * I_uv - Z_coupling * I_N + V_série
              // La tension série V_série est injectée par le SRG2 (si présent sur cette branche)
              let Vv = sub(Vu, mul(Z, Iuv));
              
              // ✅ COUPLAGE MUTUEL PHASE-NEUTRE: Ajouter l'effet du courant neutre
              if (I_neutral_branches) {
                const I_N = I_neutral_branches.get(cab.id);
                if (I_N && abs(I_N) > 0.01) {
                  const ct = cableTypeById.get(cab.typeId);
                  const mutualFactor = (ct as any)?.mutualCouplingFactor ?? 0.3;
                  const length_m_raw = this.calculateLengthMeters(cab.coordinates || []);
                  const length_m = applySagCorrection(length_m_raw, cab.pose);
                  const L_km = length_m / 1000;
                  // Z_coupling = mutualFactor * Z_neutral(R0, X0) per km * length
                  const Z_coupling = C(
                    (ct?.R0_ohm_per_km || 0) * L_km * mutualFactor,
                    (ct?.X0_ohm_per_km || 0) * L_km * mutualFactor
                  );
                  Vv = sub(Vv, mul(Z_coupling, I_N));
                }
              }
              
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

          // Dual convergence: voltage AND current must both converge
          let voltageConverged = true;
          for (const [nid, Vn] of V_node_phase.entries()) {
            const Vp = V_prev2.get(nid) || Vslack_phase_ph;
            const d = abs(sub(Vn, Vp));
            const Vn_mag = abs(Vn) || 1;
            if (d / Vn_mag >= ElectricalCalculator.CONVERGENCE_TOLERANCE) {
              voltageConverged = false;
              break;
            }
          }
          let currentConverged = true;
          if (voltageConverged) {
            for (const [cabId, I] of I_branch_phase.entries()) {
              const Ip = I_prev_phase?.get(cabId);
              if (Ip && abs(I) > 0.01) {
                if (abs(sub(I, Ip)) / abs(I) >= ElectricalCalculator.CONVERGENCE_TOLERANCE) {
                  currentConverged = false;
                  break;
                }
              }
            }
          }
          if (voltageConverged && currentConverged) { converged2 = true; break; }
        }
        if (!converged2) {
          console.warn(`⚠️ BFS phase ${angleDeg}° non convergé`);
        }
        return { V_node_phase, I_branch_phase };
      };

      // ============================================================
      // COUPLED 3-PHASE BFS FOR 3-WIRE DELTA NETWORKS
      // 
      // Enforces I_A + I_B + I_C = 0 at every node and every branch
      // (no neutral conductor = no zero-sequence current path).
      //
      // Key difference from 3 independent BFS:
      // At each node in the backward sweep, the zero-sequence component
      // of injection currents is removed:
      //   I_0 = (I_A + I_B + I_C) / 3
      //   I_x_coupled = I_x - I_0
      // This is the physical coupling that independent BFS cannot model.
      //
      // Returns phaseA/B/C in the same format as runBFSForPhase
      // so all downstream code is unchanged.
      // ============================================================
      const runCoupledBFSForDelta = (
        S_A_m: Map<string, Complex>,
        S_B_m: Map<string, Complex>,
        S_C_m: Map<string, Complex>,
        phasePhaseLoads_map: Map<string, {
          charges:     { 'A-B': number; 'B-C': number; 'A-C': number };
          productions: { 'A-B': number; 'B-C': number; 'A-C': number };
        }>
      ): {
        phaseA: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> };
        phaseB: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> };
        phaseC: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> };
      } => {

        // Slack phasors for each phase (nominal, no shift)
        const Vsa = fromPolar(Vslack_phase, this.deg2rad(0));
        const Vsb = fromPolar(Vslack_phase, this.deg2rad(-120));
        const Vsc = fromPolar(Vslack_phase, this.deg2rad(120));

        // Node voltage maps (all 3 phases together)
        const V_A = new Map<string, Complex>();
        const V_B = new Map<string, Complex>();
        const V_C = new Map<string, Complex>();

        // Branch current maps (all 3 phases together)
        const I_A_branch = new Map<string, Complex>();
        const I_B_branch = new Map<string, Complex>();
        const I_C_branch = new Map<string, Complex>();

        // Initialize all nodes at slack voltage
        for (const n of nodes) {
          V_A.set(n.id, Vsa);
          V_B.set(n.id, Vsb);
          V_C.set(n.id, Vsc);
        }

        let converged = false;

        for (let iter = 0; iter < ElectricalCalculator.MAX_ITERATIONS; iter++) {

          // Save previous voltages and currents for dual convergence check
          const V_A_prev = new Map(V_A);
          const V_B_prev = new Map(V_B);
          const V_C_prev = new Map(V_C);
          const I_A_prev = new Map(I_A_branch);
          const I_B_prev = new Map(I_B_branch);
          const I_C_prev = new Map(I_C_branch);

          I_A_branch.clear();
          I_B_branch.clear();
          I_C_branch.clear();

          // ── BACKWARD SWEEP ────────────────────────────────────────
          for (const u of postOrder) {
            if (u === source.id) continue;

            const Va = V_A.get(u) || Vsa;
            const Vb = V_B.get(u) || Vsb;
            const Vc = V_C.get(u) || Vsc;

            const Sa = S_A_m.get(u) || C(0, 0);
            const Sb = S_B_m.get(u) || C(0, 0);
            const Sc = S_C_m.get(u) || C(0, 0);

            // ── POLY LOADS: PROPER DELTA REPRESENTATION ──────────────
            // Convert phase powers to delta coupling powers:
            //   S_AB = (Sa + Sb) / 2, S_BC = (Sb + Sc) / 2, S_CA = (Sc + Sa) / 2
            // Then compute currents from line-to-line voltages (physically correct).
            // Divergence detection: warn on near-zero voltages
            if (abs(Va) < 1.0 || abs(Vb) < 1.0 || abs(Vc) < 1.0) {
              console.warn(`⚠️ [Delta BFS] Near-zero voltage at node ${u}: |Va|=${abs(Va).toFixed(3)}, |Vb|=${abs(Vb).toFixed(3)}, |Vc|=${abs(Vc).toFixed(3)}`);
            }

            const V_AB_poly = sub(Va, Vb);
            const V_BC_poly = sub(Vb, Vc);
            const V_CA_poly = sub(Vc, Va);

            // Redistribute POLY S_maps into delta couplings
            const S_AB_poly = scale(add(Sa, Sb), 0.5);
            const S_BC_poly = scale(add(Sb, Sc), 0.5);
            const S_CA_poly = scale(add(Sc, Sa), 0.5);

            // Delta currents from line-to-line voltages: I_xy = conj(S_xy / V_xy)
            const I_AB_poly = abs(V_AB_poly) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
              ? conj(div(S_AB_poly, V_AB_poly)) : C(0, 0);
            const I_BC_poly = abs(V_BC_poly) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
              ? conj(div(S_BC_poly, V_BC_poly)) : C(0, 0);
            const I_CA_poly = abs(V_CA_poly) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
              ? conj(div(S_CA_poly, V_CA_poly)) : C(0, 0);

            // Kirchhoff line currents (inherently satisfy I_A+I_B+I_C=0):
            // I_A = I_AB - I_CA, I_B = I_BC - I_AB, I_C = I_CA - I_BC
            let Ia_inj = sub(I_AB_poly, I_CA_poly);
            let Ib_inj = sub(I_BC_poly, I_AB_poly);
            let Ic_inj = sub(I_CA_poly, I_BC_poly);

            // EQUI8 current injections (if present)
            if (equi8CurrentInjections?.has(u)) {
              const injection = equi8CurrentInjections.get(u)!;
              Ia_inj = add(Ia_inj, C(injection.I_phaseA.re, injection.I_phaseA.im));
              Ib_inj = add(Ib_inj, C(injection.I_phaseB.re, injection.I_phaseB.im));
              Ic_inj = add(Ic_inj, C(injection.I_phaseC.re, injection.I_phaseC.im));
            }

            // ── MONO DELTA INJECTION ──────────────────────────────────
            // Inject MONO phase-phase loads directly from V_AB, V_BC, V_AC
            // instead of going through S_maps (which only contain POLY loads).
            // This computes physically correct line currents for delta loads.
            const ppLoads = phasePhaseLoads_map.get(u);
            if (ppLoads) {
              // Net power per coupling (charges - productions), already foisonné
              const S_AB_net_kVA = ppLoads.charges['A-B'] - ppLoads.productions['A-B'];
              const S_BC_net_kVA = ppLoads.charges['B-C'] - ppLoads.productions['B-C'];
              const S_AC_net_kVA = ppLoads.charges['A-C'] - ppLoads.productions['A-C'];

              // Phase-phase voltages from current BFS iteration
              const V_AB = sub(Va, Vb);
              const V_BC = sub(Vb, Vc);
              const V_AC = sub(Va, Vc);

              // Build complex S with cosφ: S = P + jQ (in VA)
              const buildS = (net_kVA: number): Complex => {
                const cosPhiEff = net_kVA >= 0 ? cosPhiCharges_eff : cosPhiProductions_eff;
                const sinPhiEff = net_kVA >= 0 ? sinPhiCharges : sinPhiProductions;
                return C(net_kVA * cosPhiEff * 1000, net_kVA * sinPhiEff * 1000);
              };

              const S_AB = buildS(S_AB_net_kVA);
              const S_BC = buildS(S_BC_net_kVA);
              const S_AC = buildS(S_AC_net_kVA);

              // Delta load currents: I_AB = conj(S_AB / V_AB)
              const I_AB = abs(V_AB) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
                ? conj(div(S_AB, V_AB)) : C(0, 0);
              const I_BC = abs(V_BC) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
                ? conj(div(S_BC, V_BC)) : C(0, 0);
              const I_AC = abs(V_AC) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
                ? conj(div(S_AC, V_AC)) : C(0, 0);

              // Line currents from delta load currents (Kirchhoff):
              // I_A = I_AB + I_AC   (current enters A via A-B and A-C branches)
              // I_B = I_BC - I_AB   (current enters B via B-C, exits via A-B)
              // I_C = -I_BC - I_AC  (current exits C via both B-C and A-C)
              // Verify: I_A + I_B + I_C = (I_AB+I_AC) + (I_BC-I_AB) + (-I_BC-I_AC) = 0 ✓
              Ia_inj = add(Ia_inj, add(I_AB, I_AC));
              Ib_inj = add(Ib_inj, sub(I_BC, I_AB));
              Ic_inj = sub(Ic_inj, add(I_BC, I_AC));
            }
            // ─────────────────────────────────────────────────────────

            // ── SAFETY I_0 REMOVAL ─────────────────────────────────
            // Both POLY (delta representation) and MONO paths produce currents
            // that inherently satisfy I_A+I_B+I_C=0. This step removes any
            // residual numerical I_0 as a safety measure.
            const I_0 = scale(add(add(Ia_inj, Ib_inj), Ic_inj), 1 / 3);
            Ia_inj = sub(Ia_inj, I_0);
            Ib_inj = sub(Ib_inj, I_0);
            Ic_inj = sub(Ic_inj, I_0);
            // ─────────────────────────────────────────────────────────

            // Accumulate: branch current = sum of children + this node
            let Ia_sum = Ia_inj;
            let Ib_sum = Ib_inj;
            let Ic_sum = Ic_inj;

            for (const v of children.get(u) || []) {
              const cabChild = parentCableOfChild.get(v);
              if (!cabChild) continue;
              Ia_sum = add(Ia_sum, I_A_branch.get(cabChild.id) || C(0, 0));
              Ib_sum = add(Ib_sum, I_B_branch.get(cabChild.id) || C(0, 0));
              Ic_sum = add(Ic_sum, I_C_branch.get(cabChild.id) || C(0, 0));
            }

            const cab = parentCableOfChild.get(u);
            if (cab) {
              I_A_branch.set(cab.id, Ia_sum);
              I_B_branch.set(cab.id, Ib_sum);
              I_C_branch.set(cab.id, Ic_sum);
            }
          }

          // Source node: compute net current entering from feeders + source load
          let I_src_A = C(0, 0);
          let I_src_B = C(0, 0);
          let I_src_C = C(0, 0);

          for (const v of children.get(source.id) || []) {
            const cab = parentCableOfChild.get(v);
            if (!cab) continue;
            I_src_A = add(I_src_A, I_A_branch.get(cab.id) || C(0, 0));
            I_src_B = add(I_src_B, I_B_branch.get(cab.id) || C(0, 0));
            I_src_C = add(I_src_C, I_C_branch.get(cab.id) || C(0, 0));
          }

          // Source node injection (if any load/generation at source)
          const Sa_src = S_A_m.get(source.id) || C(0, 0);
          const Sb_src = S_B_m.get(source.id) || C(0, 0);
          const Sc_src = S_C_m.get(source.id) || C(0, 0);
          const Va_src_safe = abs(V_A.get(source.id) || Vsa) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
            ? (V_A.get(source.id) || Vsa) : Vsa;
          const Vb_src_safe = abs(V_B.get(source.id) || Vsb) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
            ? (V_B.get(source.id) || Vsb) : Vsb;
          const Vc_src_safe = abs(V_C.get(source.id) || Vsc) > ElectricalCalculator.MIN_VOLTAGE_SAFETY
            ? (V_C.get(source.id) || Vsc) : Vsc;
          I_src_A = add(I_src_A, conj(div(Sa_src, Va_src_safe)));
          I_src_B = add(I_src_B, conj(div(Sb_src, Vb_src_safe)));
          I_src_C = add(I_src_C, conj(div(Sc_src, Vc_src_safe)));

          // ── FORWARD SWEEP ─────────────────────────────────────────
          const VA_bus = Ztr_phase ? sub(Vsa, mul(Ztr_phase, I_src_A)) : Vsa;
          const VB_bus = Ztr_phase ? sub(Vsb, mul(Ztr_phase, I_src_B)) : Vsb;
          const VC_bus = Ztr_phase ? sub(Vsc, mul(Ztr_phase, I_src_C)) : Vsc;

          V_A.set(source.id, VA_bus);
          V_B.set(source.id, VB_bus);
          V_C.set(source.id, VC_bus);

          const stack = [source.id];
          while (stack.length) {
            const u = stack.pop()!;

            for (const v of children.get(u) || []) {
              const cab = parentCableOfChild.get(v);
              if (!cab) continue;

              const Z = cableZ_phase.get(cab.id) || C(0, 0);

              let VA_v = sub(V_A.get(u) || Vsa, mul(Z, I_A_branch.get(cab.id) || C(0, 0)));
              let VB_v = sub(V_B.get(u) || Vsb, mul(Z, I_B_branch.get(cab.id) || C(0, 0)));
              let VC_v = sub(V_C.get(u) || Vsc, mul(Z, I_C_branch.get(cab.id) || C(0, 0)));

              // SRG2 series voltage injection (if present on this cable)
              if (cab.serieVoltagePerPhase) {
                if (abs(cab.serieVoltagePerPhase.A) > 0.01) VA_v = add(VA_v, cab.serieVoltagePerPhase.A);
                if (abs(cab.serieVoltagePerPhase.B) > 0.01) VB_v = add(VB_v, cab.serieVoltagePerPhase.B);
                if (abs(cab.serieVoltagePerPhase.C) > 0.01) VC_v = add(VC_v, cab.serieVoltagePerPhase.C);
              }

              V_A.set(v, VA_v);
              V_B.set(v, VB_v);
              V_C.set(v, VC_v);

              stack.push(v);
            }
          }

          // ── CONVERGENCE CHECK ─────────────────────────────────────
          // Dual convergence: voltage AND current
          let voltageConverged = true;
          for (const n of nodes) {
            const dA = abs(sub(V_A.get(n.id) || Vsa, V_A_prev.get(n.id) || Vsa));
            const dB = abs(sub(V_B.get(n.id) || Vsb, V_B_prev.get(n.id) || Vsb));
            const dC = abs(sub(V_C.get(n.id) || Vsc, V_C_prev.get(n.id) || Vsc));
            const Vmag = abs(V_A.get(n.id) || Vsa) || 1;
            if (Math.max(dA, dB, dC) / Vmag >= ElectricalCalculator.CONVERGENCE_TOLERANCE) {
              voltageConverged = false;
              break;
            }
          }
          let currentConverged = true;
          if (voltageConverged) {
            for (const [cabId, Ia] of I_A_branch.entries()) {
              const Ia_p = I_A_prev.get(cabId);
              const Ib = I_B_branch.get(cabId) || C(0, 0);
              const Ib_p = I_B_prev.get(cabId);
              const Ic = I_C_branch.get(cabId) || C(0, 0);
              const Ic_p = I_C_prev.get(cabId);
              const Imax = Math.max(abs(Ia), abs(Ib), abs(Ic));
              if (Imax > 0.01) {
                const dIa = Ia_p ? abs(sub(Ia, Ia_p)) : 0;
                const dIb = Ib_p ? abs(sub(Ib, Ib_p)) : 0;
                const dIc = Ic_p ? abs(sub(Ic, Ic_p)) : 0;
                if (Math.max(dIa, dIb, dIc) / Imax >= ElectricalCalculator.CONVERGENCE_TOLERANCE) {
                  currentConverged = false;
                  break;
                }
              }
            }
          }
          if (voltageConverged && currentConverged) {
            converged = true;
            console.log(`✅ [3-wire coupled BFS] Converged at iter ${iter + 1}`);
            break;
          }
        }

        if (!converged) {
          console.warn('⚠️ [3-wire coupled BFS] Did not converge');
        }

        // ── POST-BFS KCL VALIDATION ─────────────────────────────
        // Verify I_A + I_B + I_C ≈ 0 on all branches (3-wire constraint)
        for (const [cabId, Ia] of I_A_branch.entries()) {
          const Ib = I_B_branch.get(cabId) || C(0, 0);
          const Ic = I_C_branch.get(cabId) || C(0, 0);
          const I_sum = abs(add(add(Ia, Ib), Ic));
          const I_max = Math.max(abs(Ia), abs(Ib), abs(Ic));
          if (I_max > 0.1 && I_sum / I_max > 0.01) {
            console.warn(`⚠️ [KCL violation] Cable ${cabId}: |I_A+I_B+I_C|=${I_sum.toFixed(2)}A (${(I_sum/I_max*100).toFixed(1)}% of max phase)`);
          }
        }
        // ─────────────────────────────────────────────────────────

        return {
          phaseA: { V_node_phase: V_A, I_branch_phase: I_A_branch },
          phaseB: { V_node_phase: V_B, I_branch_phase: I_B_branch },
          phaseC: { V_node_phase: V_C, I_branch_phase: I_C_branch }
        };
      };

      // Détection du système 400V pour le calcul du courant neutre
      const is400V = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;

      // Déphasages corrects pour les phases A, B, C
      let phaseA: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> };
      let phaseB: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> };
      let phaseC: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> };

      if (!is400V) {
        // Build phasePhaseLoads_map for MONO delta injections in coupled BFS
        // Uses foisonné values if available, otherwise raw phasePhaseLoads with foisonnement applied
        const phasePhaseLoads_map = new Map<string, {
          charges:     { 'A-B': number; 'B-C': number; 'A-C': number };
          productions: { 'A-B': number; 'B-C': number; 'A-C': number };
        }>();

        for (const n of nodes) {
          if (n.autoPhaseDistribution?.phasePhaseLoads) {
            const ppLoads = n.autoPhaseDistribution.phasePhaseLoads;
            // Prefer foisonné values (already include foisonnement + cursors)
            if (ppLoads.foisonneCharges && ppLoads.foisonneProductions) {
              phasePhaseLoads_map.set(n.id, {
                charges: { ...ppLoads.foisonneCharges },
                productions: { ...ppLoads.foisonneProductions },
              });
            } else {
              // Fallback: apply global foisonnement to raw values
              const foisChargeCoeff = (foisonnementCharges ?? 100) / 100;
              const foisProdCoeff = (foisonnementProductions ?? 100) / 100;
              phasePhaseLoads_map.set(n.id, {
                charges: {
                  'A-B': ppLoads.charges['A-B'] * foisChargeCoeff,
                  'B-C': ppLoads.charges['B-C'] * foisChargeCoeff,
                  'A-C': ppLoads.charges['A-C'] * foisChargeCoeff,
                },
                productions: {
                  'A-B': ppLoads.productions['A-B'] * foisProdCoeff,
                  'B-C': ppLoads.productions['B-C'] * foisProdCoeff,
                  'A-C': ppLoads.productions['A-C'] * foisProdCoeff,
                },
              });
            }
          }
        }

        // 3-wire delta: use coupled BFS that enforces I_A+I_B+I_C=0
        const coupled = runCoupledBFSForDelta(S_A_map, S_B_map, S_C_map, phasePhaseLoads_map);
        phaseA = coupled.phaseA;
        phaseB = coupled.phaseB;
        phaseC = coupled.phaseC;
      } else {
        // 4-wire star: use 3 independent BFS (neutral modeled separately)
        phaseA = runBFSForPhase(0,    S_A_map, 'A');
        phaseB = runBFSForPhase(-120, S_B_map, 'B');
        phaseC = runBFSForPhase(120,  S_C_map, 'C');
      }
      
      // ✅ EQUI8 : Déclaré ici pour être accessible dans la boucle neutre et les résultats câbles
      const equi8UpstreamReduction = new Map<string, Complex>();
      if (is400V) {
        // ✅ EQUI8 CME: Identifier les nœuds avec injection de courant
        const equi8CompensationByNode = new Map<string, number>();
        
        if (equi8CurrentInjections) {
          for (const [nodeId, injection] of equi8CurrentInjections.entries()) {
            equi8CompensationByNode.set(nodeId, injection.magnitude);
            console.log(`🔌 EQUI8 CME détecté sur nœud ${nodeId}: I_injection=${injection.magnitude.toFixed(1)}A`);
          }
        }
        
        for (const n of nodes) {
          if (n.customProps?.['equi8_I_compensation'] && !equi8CompensationByNode.has(n.id)) {
            const I_comp = n.customProps['equi8_I_compensation'] as number;
            equi8CompensationByNode.set(n.id, I_comp);
            console.log(`🔌 EQUI8 legacy détecté sur nœud ${n.id}: I_compensation=${I_comp.toFixed(1)}A`);
          }
        }
        
        for (const [equi8NodeId, I_comp] of equi8CompensationByNode.entries()) {
          let currentNodeId = equi8NodeId;
          
          const injection = equi8CurrentInjections?.get(equi8NodeId);
          const I_neutral_phasor: Complex = injection
            ? C(injection.I_neutral.re, injection.I_neutral.im)
            : C(I_comp, 0);
          
          while (parent.get(currentNodeId)) {
            const parentNodeId = parent.get(currentNodeId)!;
            const cable = parentCableOfChild.get(currentNodeId);
            
            if (cable) {
              const existingReduction = equi8UpstreamReduction.get(cable.id) || C(0, 0);
              equi8UpstreamReduction.set(cable.id, add(existingReduction, I_neutral_phasor));
              console.log(`🔌 EQUI8 réduction I_N sur câble ${cable.id}: +${abs(I_neutral_phasor).toFixed(1)}A phaseur (total: ${abs(add(existingReduction, I_neutral_phasor)).toFixed(1)}A)`);
            }
            
            currentNodeId = parentNodeId;
          }
        }
      }

      // ===== Boucle de couplage neutre (400V uniquement) =====
      // Itère entre BFS par phase et calcul V_neutral pour converger vers l'état couplé
      // S_*_final captures the last corrected S_maps for use in thermal passes
      let S_A_final = S_A_map;
      let S_B_final = S_B_map;
      let S_C_final = S_C_map;

      if (is400V) {
        let V_neutral_iter = new Map<string, Complex>(
          nodes.map(n => [n.id, C(0, 0)])
        );
        const MAX_NEUTRAL_PASSES = 8;
        const NEUTRAL_CONVERGENCE_V = 0.01;

        for (let neutralPass = 0; neutralPass < MAX_NEUTRAL_PASSES; neutralPass++) {
          const { V_neutral: V_neutral_new } = this.computeNeutralVoltages(
            source, children, parentCableOfChild, nodeById, cableTypeById,
            phaseA, phaseB, phaseC, U_line_base, isUnbalanced,
            equi8UpstreamReduction, projectSeason, applySagCorrection
          );

          let maxDelta = 0;
          for (const n of nodes) {
            const Vn_new = V_neutral_new.get(n.id) || C(0, 0);
            const Vn_prev = V_neutral_iter.get(n.id) || C(0, 0);
            const delta = abs(sub(Vn_new, Vn_prev));
            if (delta > maxDelta) maxDelta = delta;
          }

          V_neutral_iter = V_neutral_new;

          if (maxDelta < NEUTRAL_CONVERGENCE_V && neutralPass > 0) {
            console.log(`✅ Neutral coupling converged at pass ${neutralPass + 1}, maxΔV_n=${maxDelta.toFixed(3)}V`);
            break;
          }

          if (neutralPass < MAX_NEUTRAL_PASSES - 1) {
            const S_A_corr = this.correctSMapForNeutral(S_A_map, phaseA.V_node_phase, V_neutral_iter, nodes, source.id);
            const S_B_corr = this.correctSMapForNeutral(S_B_map, phaseB.V_node_phase, V_neutral_iter, nodes, source.id);
            const S_C_corr = this.correctSMapForNeutral(S_C_map, phaseC.V_node_phase, V_neutral_iter, nodes, source.id);

            S_A_final = S_A_corr;
            S_B_final = S_B_corr;
            S_C_final = S_C_corr;

            // ✅ COUPLAGE MUTUEL: Calculer I_neutral par câble à partir des 3 phases
            const I_neutral_branches = new Map<string, Complex>();
            for (const [childId, cab] of parentCableOfChild.entries()) {
              const Ia = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
              const Ib = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
              const Ic = phaseC.I_branch_phase.get(cab.id) || C(0, 0);
              I_neutral_branches.set(cab.id, add(add(Ia, Ib), Ic));
            }

            phaseA = runBFSForPhase(0, S_A_corr, 'A', undefined, I_neutral_branches);
            phaseB = runBFSForPhase(-120, S_B_corr, 'B', undefined, I_neutral_branches);
            phaseC = runBFSForPhase(120, S_C_corr, 'C', undefined, I_neutral_branches);

            console.log(`🔄 Neutral pass ${neutralPass + 1}/${MAX_NEUTRAL_PASSES}: maxΔV_n=${maxDelta.toFixed(3)}V`);
          }
        }
      }

      // ===== 🔧 FIX GRD — MICRO-ITÉRATION THERMIQUE 2 PASSES (Effet Joule) =====
      // Passe 1: BFS avec R à 20°C → courants I_phase
      // Passe 2: correction R(T) avec I réel → BFS final
      // Limité à 2 passes max pour stabilité
      const cableTempMap = new Map<string, number>();
      
      if (projectSeason) {
        const MAX_THERMAL_PASSES = 2;
        
        for (let thermalPass = 0; thermalPass < MAX_THERMAL_PASSES; thermalPass++) {
          let impedancesUpdated = false;
          
          for (const [childId, cab] of parentCableOfChild.entries()) {
            const ct = cableTypeById.get(cab.typeId);
            if (!ct) continue;
            const length_m_raw = this.calculateLengthMeters(cab.coordinates || []);
            const length_m = applySagCorrection(length_m_raw, cab.pose);
            const L_km = length_m / 1000;
            
            // Courant max des 3 phases (pire cas pour échauffement)
            const IA_mag = abs(phaseA.I_branch_phase.get(cab.id) || C(0, 0));
            const IB_mag = abs(phaseB.I_branch_phase.get(cab.id) || C(0, 0));
            const IC_mag = abs(phaseC.I_branch_phase.get(cab.id) || C(0, 0));
            const I_max_phase = Math.max(IA_mag, IB_mag, IC_mag);
            
            // 🔧 FIX GRD — Température bornée à T_max_insulation (IEC 60287)
            const T_amb = getAmbientTemperature(projectSeason, cab.pose);
            const T_cable = calculateCableTemperature(
              T_amb, I_max_phase, ct.maxCurrent_A || 0, cab.pose,
              ct.insulationType as InsulationType | undefined
            );
            cableTempMap.set(cab.id, T_cable);
            
            // Recalcul de l'impédance avec correction thermique dynamique
            const thermalCtxReal = {
              season: projectSeason,
              pose: cab.pose,
              I_A: I_max_phase,
              Imax_A: ct.maxCurrent_A || 0,
              insulationType: ct.insulationType as InsulationType | undefined
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
            console.log(`🌡️ [GRD-FIX] Thermique passe ${thermalPass + 1}/${MAX_THERMAL_PASSES}: recalcul BFS avec R corrigé`);
            if (!is400V) {
              // Rebuild phasePhaseLoads_map for thermal re-run
              const ppMap_thermal = new Map<string, {
                charges:     { 'A-B': number; 'B-C': number; 'A-C': number };
                productions: { 'A-B': number; 'B-C': number; 'A-C': number };
              }>();
              for (const n of nodes) {
                if (n.autoPhaseDistribution?.phasePhaseLoads) {
                  const ppLoads = n.autoPhaseDistribution.phasePhaseLoads;
                  if (ppLoads.foisonneCharges && ppLoads.foisonneProductions) {
                    ppMap_thermal.set(n.id, {
                      charges: { ...ppLoads.foisonneCharges },
                      productions: { ...ppLoads.foisonneProductions },
                    });
                  } else {
                    const foisChargeCoeff = (foisonnementCharges ?? 100) / 100;
                    const foisProdCoeff = (foisonnementProductions ?? 100) / 100;
                    ppMap_thermal.set(n.id, {
                      charges: {
                        'A-B': ppLoads.charges['A-B'] * foisChargeCoeff,
                        'B-C': ppLoads.charges['B-C'] * foisChargeCoeff,
                        'A-C': ppLoads.charges['A-C'] * foisChargeCoeff,
                      },
                      productions: {
                        'A-B': ppLoads.productions['A-B'] * foisProdCoeff,
                        'B-C': ppLoads.productions['B-C'] * foisProdCoeff,
                        'A-C': ppLoads.productions['A-C'] * foisProdCoeff,
                      },
                    });
                  }
                }
              }
              const coupled = runCoupledBFSForDelta(S_A_map, S_B_map, S_C_map, ppMap_thermal);
              phaseA = coupled.phaseA;
              phaseB = coupled.phaseB;
              phaseC = coupled.phaseC;
            } else {
              phaseA = runBFSForPhase(0,    S_A_final, 'A');
              phaseB = runBFSForPhase(-120, S_B_final, 'B');
              phaseC = runBFSForPhase(120,  S_C_final, 'C');
            }
          } else {
            // Convergence thermique atteinte
            if (thermalPass > 0) {
              console.log(`🌡️ [GRD-FIX] Convergence thermique atteinte à la passe ${thermalPass + 1}`);
            }
            break;
          }
        }
      }

      // ===== Recalcul final V_neutral après passes thermiques + correction d'affichage =====
      // Le neutre est recalculé ici car les passes thermiques ont pu modifier phaseA/B/C
      let I_neutral_cable_final: Map<string, Complex> | undefined;
      let V_neutral_refined_final: Map<string, Complex> | undefined;
      if (is400V) {
        // Passe standard
        const { V_neutral, I_neutral_cable } = this.computeNeutralVoltages(
          source, children, parentCableOfChild, nodeById, cableTypeById,
          phaseA, phaseB, phaseC, U_line_base, isUnbalanced,
          equi8UpstreamReduction, projectSeason, applySagCorrection
        );

        // Passe de raffinement terre : utilise Vn_child (calculé) au lieu de Vn_parent
        const { V_neutral: V_neutral_refined, I_neutral_cable: I_neutral_cable_refined } =
          this.computeNeutralVoltagesRefined(
            source, children, parentCableOfChild, nodeById, cableTypeById,
            phaseA, phaseB, phaseC, V_neutral, U_line_base, isUnbalanced,
            equi8UpstreamReduction, projectSeason, applySagCorrection
          );
        I_neutral_cable_final = I_neutral_cable_refined;
        V_neutral_refined_final = V_neutral_refined;
        
        // Corriger les tensions phase-neutre en soustrayant la tension du neutre
        // V_phase_neutre_corrigé = V_phase - V_neutral
        for (const n of nodes) {
          if (n.id === source.id) continue;
          
          const Vn = V_neutral_refined.get(n.id);
          if (!Vn) continue;
          
          const Va = phaseA.V_node_phase.get(n.id);
          const Vb = phaseB.V_node_phase.get(n.id);
          const Vc = phaseC.V_node_phase.get(n.id);
          
          if (Va) phaseA.V_node_phase.set(n.id, sub(Va, Vn));
          if (Vb) phaseB.V_node_phase.set(n.id, sub(Vb, Vn));
          if (Vc) phaseC.V_node_phase.set(n.id, sub(Vc, Vn));
        }
      }


      // Compose cable results (par phase)
      calculatedCables.length = 0;
      globalLosses = 0;

      for (const cab of cables) {
        const childId = cableChildId.get(cab.id);
        const parentId = cableParentId.get(cab.id);
        const length_m_raw = this.calculateLengthMeters(cab.coordinates || []);
        const length_m = applySagCorrection(length_m_raw, cab.pose);
        const ct = cableTypeById.get(cab.typeId);
        if (!ct) throw new Error(`Cable type ${cab.typeId} introuvable`);

        const distalId = childId && parentId ? childId : (parent.get(cab.nodeBId) === cab.nodeAId ? cab.nodeBId : cab.nodeAId);
        const distalNode = nodeById.get(distalId)!;
        const { isThreePhase } = this.getVoltage(distalNode.connectionType);
        const isStarNetwork = distalNode.connectionType === 'TÉTRA_3P+N_230_400V';
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

        let deltaU_line_V: number;
        if (isStarNetwork) {
          // Étoile 400V : chute phase-neutre → ligne via √3
          deltaU_line_V = Math.max(dVA, dVB, dVC) * Math.sqrt(3);
        } else if (!is400V) {
          // Delta 230V : chute ligne-à-ligne = |Z×(I_x - I_y)|, pire paire
          const dV_AB = abs(mul(Z, sub(IA, IB)));
          const dV_BC = abs(mul(Z, sub(IB, IC)));
          const dV_AC = abs(mul(Z, sub(IA, IC)));
          deltaU_line_V = Math.max(dV_AB, dV_BC, dV_AC);
        } else {
          deltaU_line_V = Math.max(dVA, dVB, dVC);
        }

        // Conformité EN50160 : toujours référence nominale (400V ou 230V), jamais tensionCible
        const { U_base: U_base_nominal } = this.getVoltage(distalNode.connectionType);
        const deltaU_percent = U_base_nominal ? (deltaU_line_V / U_base_nominal) * 100 : 0;

        // Pertes phases
        const R_phase = Z.re;
        const losses_phases_kW = ((IA_mag*IA_mag) + (IB_mag*IB_mag) + (IC_mag*IC_mag)) * R_phase / 1000;

        // Pertes neutre (400V uniquement)
        let losses_neutral_kW = 0;
        if (is400V) {
          const length_m_raw_n = this.calculateLengthMeters(cab.coordinates || []);
          const length_km_n = applySagCorrection(length_m_raw_n, cab.pose) / 1000;
          const R0_ohm = ct.R0_ohm_per_km * length_km_n;
          const IN_mag_local = abs(add(add(IA, IB), IC));
          losses_neutral_kW = (IN_mag_local * IN_mag_local) * R0_ohm / 1000;
        }

        const losses_kW = losses_phases_kW + losses_neutral_kW;
        globalLosses += losses_kW;

        // Courant de neutre (si 400V L-N)
        // ✅ EQUI8 : Appliquer la réduction phaseur du courant neutre pour les câbles en amont
        const IN_corrected = I_neutral_cable_final?.get(cab.id);
        let IN_phasor_result: Complex;
        if (is400V && IN_corrected) {
          // Utilise le courant neutre corrigé (EQUI8 + terre déjà appliqués)
          IN_phasor_result = IN_corrected;
        } else if (is400V) {
          // Fallback : somme brute + réduction EQUI8
          IN_phasor_result = add(add(IA, IB), IC);
          const equi8ReductionResult = equi8UpstreamReduction.get(cab.id);
          if (equi8ReductionResult && abs(equi8ReductionResult) > 0.01) {
            const IN_before = abs(IN_phasor_result);
            IN_phasor_result = sub(IN_phasor_result, equi8ReductionResult);
            if (abs(IN_phasor_result) > IN_before + 0.01) {
              IN_phasor_result = C(0, 0);
            }
          }
        } else {
          IN_phasor_result = C(0, 0);
        }
        let IN_mag = abs(IN_phasor_result);

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
        if (n.connectionType === 'TRI_230V_3F') {
          // Delta sans neutre : les tensions physiques sont ligne-à-ligne
          U_node_line_tension = Math.min(
            abs(sub(Va, Vb)),  // V_AB
            abs(sub(Vb, Vc)),  // V_BC
            abs(sub(Va, Vc))   // V_AC
          );
        } else {
          const scaleLine = this.getDisplayLineScale(n.connectionType);
          U_node_line_tension = Math.min(Va_mag, Vb_mag, Vc_mag) * scaleLine;
        }

        // ===== 🔧 FIX GRD — RÉFÉRENCE EN50160 : TOUJOURS U_base NOMINALE =====
        // La conformité EN50160 s'évalue par rapport à la tension nominale du réseau,
        // JAMAIS par rapport à tensionCible (qui sert uniquement au BFS).
        const { U_base: U_ref_display } = this.getVoltage(n.connectionType);

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
          nodes,
          { A: I_source_net_A, B: I_source_net_B, C: I_source_net_C },
          phaseB.V_node_phase,
          phaseC.V_node_phase
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
          // Delta sans neutre : les seules tensions physiques sont ligne-à-ligne
          Va_display = abs(sub(Va, Vb));   // V_AB
          Vb_display = abs(sub(Vb, Vc));   // V_BC
          Vc_display = abs(sub(Va, Vc));   // V_AC
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
          
          // EN50160 : conformité toujours évaluée par rapport à la tension nominale
          // (tensionCible est utilisée pour le BFS/Vslack, pas pour la conformité)
          const { U_base } = this.getVoltage(n.connectionType);
          U_ref = U_base;
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
        
        // ── Composantes de séquence (400V étoile ET 230V delta) ──────────────
        let sequenceComponents: undefined | {
          U0_mag: number; U1_mag: number; U2_mag: number;
          U0_angle_deg: number; U1_angle_deg: number; U2_angle_deg: number;
          ku_percent: number;
        };

        {
          // Construire les tensions phase équivalentes pour Fortescue
          let Va_seq: Complex, Vb_seq: Complex, Vc_seq: Complex;

          if (is400V) {
            // 400V étoile : reconstruire phaseurs phase-terre (Va + Vn)
            const Vn_seq = V_neutral_refined_final?.get(n.id) || C(0, 0);
            Va_seq = n.id === source.id ? Va : add(Va, Vn_seq);
            Vb_seq = n.id === source.id ? Vb : add(Vb, Vn_seq);
            Vc_seq = n.id === source.id ? Vc : add(Vc, Vn_seq);
          } else {
            // 230V delta : Va, Vb, Vc sont des tensions internes phase-neutre virtuel (~133V)
            // Reconstruire les tensions ligne-ligne physiques
            const Vab = sub(Va, Vb);  // V_AB
            const Vbc = sub(Vb, Vc);  // V_BC
            const Vca = sub(Vc, Va);  // V_CA

            // Convertir en tensions phase équivalentes via rotation -30° et /√3
            // Va_eq = Vab / √3 * e^(-j*π/6)
            const inv_sqrt3 = 1 / Math.sqrt(3);
            const rot_minus30 = C(Math.cos(-Math.PI / 6), Math.sin(-Math.PI / 6)); // e^(-jπ/6)

            Va_seq = mul(scale(Vab, inv_sqrt3), rot_minus30);
            Vb_seq = mul(scale(Vbc, inv_sqrt3), rot_minus30);
            Vc_seq = mul(scale(Vca, inv_sqrt3), rot_minus30);
          }

          // Transformation de Fortescue : U1, U2, U0
          const a_op  = C(Math.cos(2 * Math.PI / 3), Math.sin(2 * Math.PI / 3));   // a = e^(j2π/3)
          const a2_op = C(Math.cos(4 * Math.PI / 3), Math.sin(4 * Math.PI / 3));   // a² = e^(j4π/3)

          const aVb  = mul(a_op, Vb_seq);
          const a2Vc = mul(a2_op, Vc_seq);
          const a2Vb = mul(a2_op, Vb_seq);
          const aVc  = mul(a_op, Vc_seq);

          const U0 = scale(add(add(Va_seq, Vb_seq), Vc_seq), 1 / 3);
          const U1 = scale(add(add(Va_seq, aVb), a2Vc), 1 / 3);
          const U2 = scale(add(add(Va_seq, a2Vb), aVc), 1 / 3);

          const U0_mag = Math.hypot(U0.re, U0.im);
          const U1_mag = Math.hypot(U1.re, U1.im);
          const U2_mag = Math.hypot(U2.re, U2.im);

          const ku_percent = U1_mag > 0.1 ? +(U2_mag / U1_mag * 100).toFixed(3) : 0;

          sequenceComponents = {
            U0_mag: +U0_mag.toFixed(2),
            U1_mag: +U1_mag.toFixed(2),
            U2_mag: +U2_mag.toFixed(2),
            U0_angle_deg: +(Math.atan2(U0.im, U0.re) * 180 / Math.PI).toFixed(2),
            U1_angle_deg: +(Math.atan2(U1.im, U1.re) * 180 / Math.PI).toFixed(2),
            U2_angle_deg: +(Math.atan2(U2.im, U2.re) * 180 / Math.PI).toFixed(2),
            ku_percent
          };

          // Contrôle de cohérence : si écart max entre phases > 5%, ku doit être > 2%
          const maxPhaseV = Math.max(Va_display, Vb_display, Vc_display);
          const minPhaseV = Math.min(Va_display, Vb_display, Vc_display);
          const avgPhaseV = (Va_display + Vb_display + Vc_display) / 3;
          const phaseSpread_percent = avgPhaseV > 0 ? ((maxPhaseV - minPhaseV) / avgPhaseV) * 100 : 0;

          if (phaseSpread_percent > 5 && ku_percent < 2) {
            console.warn(
              `⚠️ [Fortescue] Incohérence nœud ${n.name || n.id}: ` +
              `écart phases=${phaseSpread_percent.toFixed(1)}% mais ku=${ku_percent}% — vérifier le modèle`
            );
          }

          console.log(
            `🔬 Séquences ${n.name || n.id}: ` +
            `|Va|=${abs(Va_seq).toFixed(1)}V |Vb|=${abs(Vb_seq).toFixed(1)}V |Vc|=${abs(Vc_seq).toFixed(1)}V ` +
            `U1=${U1_mag.toFixed(1)}V U2=${U2_mag.toFixed(1)}V U0=${U0_mag.toFixed(1)}V ` +
            `ku=${ku_percent}% ${ku_percent > 2 ? '⚠️' : '✅'}` +
            (!is400V ? ' [230V delta→phase-eq]' : '')
          );
        }

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
          nodeCompliance,
          sequenceComponents
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

      // Déséquilibre global EN 50160 = max ku% parmi tous les nœuds 400V
      const maxKu = nodeMetricsPerPhase.reduce((max, nm) => {
        const ku = nm.sequenceComponents?.ku_percent ?? 0;
        return ku > max ? ku : max;
      }, 0);

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
        virtualBusbar,
        unbalanceEN50160_percent: +maxKu.toFixed(3),
        unbalanceEN50160_status: maxKu > 2 ? 'critical' : maxKu > 1.5 ? 'warning' : 'normal'
      };

      console.log(`[ElectricalCalculator] Conformité multi-phase: global=${globalComplianceFromPhases}, final=${finalCompliance}`);
      return result;
    }

    // ---- Mode équilibré désactivé ----
    // Ce chemin n'est plus atteignable (isUnbalanced = true systématiquement).
    // Conservé en commentaire pour référence historique uniquement.
    throw new Error('Mode équilibré désactivé — ce chemin ne devrait jamais être atteint.');
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

  // ===== Méthode privée : Calcul des tensions du neutre par BFS =====
  private computeNeutralVoltages(
    source: Node,
    children: Map<string, string[]>,
    parentCableOfChild: Map<string, Cable>,
    nodeById: Map<string, Node>,
    cableTypeById: Map<string, CableType>,
    phaseA: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> },
    phaseB: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> },
    phaseC: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> },
    U_line_base: number,
    isUnbalanced: boolean,
    equi8UpstreamReduction: Map<string, Complex>,
    projectSeason?: ThermalSeason,
    applySagCorrection?: (rawLength_m: number, pose: string) => number
  ): { V_neutral: Map<string, Complex>; I_neutral_cable: Map<string, Complex> } {
    const V_neutral = new Map<string, Complex>();
    const I_neutral_cable = new Map<string, Complex>();
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
        
        // ✅ EQUI8 : Soustraction phaseur complexe (cohérente avec IN_phasor)
        const equi8ReductionPhasor = equi8UpstreamReduction.get(cab.id);
        if (equi8ReductionPhasor && abs(equi8ReductionPhasor) > 0.01) {
          const IN_mag_before = abs(IN_phasor);
          IN_phasor = sub(IN_phasor, equi8ReductionPhasor);
          
          // Sécurité : si la soustraction inverse le courant, ramener à zéro
          if (abs(IN_phasor) > IN_mag_before + 0.01) {
            IN_phasor = C(0, 0);
          }
          
          console.log(
            `🔌 EQUI8 câble ${cab.id}: I_N phaseur ${IN_mag_before.toFixed(1)}A → ${abs(IN_phasor).toFixed(1)}A`
          );
        }

        // ── Fuite vers la terre au nœud enfant v (APRÈS correction EQUI8) ──
        const distalNode = nodeById.get(v)!;
        const Rt = distalNode?.rt_terre_ohm ?? 25; // 25 Ω par défaut (NF C 11-201)
        if (Rt > 0) {
          // La fuite à la terre s'ajoute à la charge du conducteur neutre (réseau TT/TN-S)
          const I_fuite_approx = div(Vn_parent, C(Rt, 0));
          IN_phasor = add(IN_phasor, I_fuite_approx);
          console.log(
            `🌍 Terre nœud ${v}: Rt=${Rt}Ω, |I_fuite|=${abs(I_fuite_approx).toFixed(2)}A, ` +
            `|I_N| final=${abs(IN_phasor).toFixed(2)}A`
          );
        }
        // ─────────────────────────────────────────────────────────────────────

        // Récupérer l'impédance du conducteur neutre (R0, X0)
        const ct = cableTypeById.get(cab.typeId);
        if (!ct) continue;
        const length_m_raw = this.calculateLengthMeters(cab.coordinates || []);
        const length_m = applySagCorrection ? applySagCorrection(length_m_raw, cab.pose) : length_m_raw;
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
        
        // ─── Convention de signe du neutre ───────────────────────────────
        // V_neutral(v) = V_neutral(u) + Z_n · IN
        // Le courant neutre circule de l'enfant vers le parent (retour),
        // donc le potentiel neutre s'ÉLÈVE au nœud enfant.
        // ─────────────────────────────────────────────────────────────────────
        // Stocker le courant neutre corrigé pour ce câble
        I_neutral_cable.set(cab.id, IN_phasor);

        const Vn_child = add(Vn_parent, dVn);
        V_neutral.set(v, Vn_child);
        
        stack3.push(v);
      }
    }
    
    return { V_neutral, I_neutral_cable };
  }

  // ===== Méthode privée : Correction des S_maps pour le potentiel neutre =====
  private correctSMapForNeutral(
    S_map: Map<string, Complex>,
    V_phase_map: Map<string, Complex>,
    V_neutral_map: Map<string, Complex>,
    nodes: Node[],
    sourceId: string
  ): Map<string, Complex> {
    const corrected = new Map<string, Complex>();
    for (const n of nodes) {
      const S = S_map.get(n.id) || C(0, 0);
      if (n.id === sourceId) {
        corrected.set(n.id, S);
        continue;
      }
      const Vph = V_phase_map.get(n.id);
      const Vn = V_neutral_map.get(n.id) || C(0, 0);
      if (!Vph) { corrected.set(n.id, S); continue; }
      
      // Effective voltage seen by the load: V_phase - V_neutral
      const Veff = sub(Vph, Vn);
      const Veff_mag = abs(Veff);
      
      // Guard: skip correction if effective voltage < 1V (avoid division instability)
      if (Veff_mag < 1) { corrected.set(n.id, S); continue; }
      
      // S_corr = S × V_phase / (V_phase - V_neutral)
      const Vph_mag = abs(Vph);
      if (Vph_mag < ElectricalCalculator.MIN_VOLTAGE_SAFETY) {
        corrected.set(n.id, S);
        continue;
      }
      const scale_factor = div(Vph, Veff); // complex ratio
      corrected.set(n.id, mul(S, scale_factor));
    }
    return corrected;
  }

  // ===== Passe raffinée terre : utilise V_neutral_previous (Vn_child) pour I_fuite =====
  private computeNeutralVoltagesRefined(
    source: Node,
    children: Map<string, string[]>,
    parentCableOfChild: Map<string, Cable>,
    nodeById: Map<string, Node>,
    cableTypeById: Map<string, CableType>,
    phaseA: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> },
    phaseB: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> },
    phaseC: { V_node_phase: Map<string, Complex>; I_branch_phase: Map<string, Complex> },
    V_neutral_previous: Map<string, Complex>,
    U_line_base: number,
    isUnbalanced: boolean,
    equi8UpstreamReduction: Map<string, Complex>,
    projectSeason?: ThermalSeason,
    applySagCorrection?: (rawLength_m: number, pose: string) => number
  ): { V_neutral: Map<string, Complex>; I_neutral_cable: Map<string, Complex> } {
    const V_neutral = new Map<string, Complex>();
    const I_neutral_cable = new Map<string, Complex>();
    V_neutral.set(source.id, C(0, 0));

    const stack = [source.id];
    const visited = new Set<string>();

    while (stack.length) {
      const u = stack.pop()!;
      if (visited.has(u)) continue;
      visited.add(u);

      const Vn_parent = V_neutral.get(u) || C(0, 0);

      for (const v of children.get(u) || []) {
        const cab = parentCableOfChild.get(v);
        if (!cab) continue;

        const IA = phaseA.I_branch_phase.get(cab.id) || C(0, 0);
        const IB = phaseB.I_branch_phase.get(cab.id) || C(0, 0);
        const IC = phaseC.I_branch_phase.get(cab.id) || C(0, 0);
        let IN_phasor = add(add(IA, IB), IC);

        // EQUI8 reduction
        const equi8ReductionPhasor = equi8UpstreamReduction.get(cab.id);
        if (equi8ReductionPhasor && abs(equi8ReductionPhasor) > 0.01) {
          const IN_mag_before = abs(IN_phasor);
          IN_phasor = sub(IN_phasor, equi8ReductionPhasor);
          if (abs(IN_phasor) > IN_mag_before + 0.01) {
            IN_phasor = C(0, 0);
          }
        }

        // Fuite terre raffinée : utiliser V_neutral_previous du nœud enfant v
        const distalNode = nodeById.get(v)!;
        const Rt = distalNode?.rt_terre_ohm ?? 25;
        if (Rt > 0) {
          const Vn_v_prev = V_neutral_previous.get(v) || C(0, 0);
          const I_fuite = div(Vn_v_prev, C(Rt, 0));
          IN_phasor = add(IN_phasor, I_fuite);
        }

        I_neutral_cable.set(cab.id, IN_phasor);

        // Impédance neutre
        const ct = cableTypeById.get(cab.typeId);
        if (!ct) continue;
        const length_m_raw = this.calculateLengthMeters(cab.coordinates || []);
        const length_m = applySagCorrection ? applySagCorrection(length_m_raw, cab.pose) : length_m_raw;
        const L_km = length_m / 1000;

        const is400V_local = U_line_base >= ElectricalCalculator.VOLTAGE_400V_THRESHOLD;
        const IN_real_A = abs(add(add(phaseA.I_branch_phase.get(cab.id) || C(0, 0),
                                       phaseB.I_branch_phase.get(cab.id) || C(0, 0)),
                                       phaseC.I_branch_phase.get(cab.id) || C(0, 0)));
        const thermalCtxNeutral = projectSeason ? {
          season: projectSeason,
          pose: cab.pose,
          I_A: IN_real_A,
          Imax_A: ct.maxCurrent_A || 0
        } : undefined;
        const { R: R0, X: X0 } = this.selectRX(ct, is400V_local, isUnbalanced, true, thermalCtxNeutral);
        const Z_neutral = C(R0 * L_km, X0 * L_km);

        const dVn = mul(Z_neutral, IN_phasor);
        const Vn_child = add(Vn_parent, dVn);
        V_neutral.set(v, Vn_child);

        stack.push(v);
      }
    }

    return { V_neutral, I_neutral_cable };
  }
}
