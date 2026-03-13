import { create } from 'zustand';
import { 
  NetworkState, 
  Project, 
  Node, 
  Cable, 
  ConnectionType, 
  VoltageSystem, 
  CalculationScenario, 
  CalculationResult,
  TransformerConfig,
  TransformerRating,
  VirtualBusbar,
  NeutralCompensator,
  CableUpgrade,
  SimulationEquipment,
  CableReplacementConfig,
  ClientLink,
  LoadModel,
  ClientImporte
} from '@/types/network';
import { DailySimulationOptions, DailyProfileConfig, defaultDailySimulationOptions, HourlyProfile, MeasuredProfileMetadata } from '@/types/dailyProfile';
import defaultProfilesData from '@/data/hourlyProfiles.json';

export type ClientColorMode = 'couplage' | 'circuit' | 'tension' | 'lien' | 'gps';
import { SRG2Config, DEFAULT_SRG2_400_CONFIG, DEFAULT_SRG2_230_CONFIG } from '@/types/srg2';
import { NodeWithConnectionType, getNodeConnectionType, addConnectionTypeToNodes } from '@/utils/nodeConnectionType';
import { defaultCableTypes } from '@/data/defaultCableTypes';
import { ElectricalCalculator } from '@/utils/electricalCalculations';
import { SimulationCalculator } from '@/utils/simulationCalculator';
import { toast } from 'sonner';
import {
  normalizeClientConnectionType,
  validateAndConvertConnectionType,
  autoAssignPhaseForMonoClient,
  autoAssignProductionPhaseForSmallPolyClient,
  calculateNodeAutoPhaseDistribution,
  calculateRealMonoDistributionPercents,
  calculateRealMonoProductionDistributionPercents,
  calculateProjectUnbalance
} from '@/utils/phaseDistributionCalculator';
import { getLinkedClientsForNode } from '@/utils/clientsUtils';

// Fonction pour calculer les bounds géographiques d'un projet
const calculateProjectBounds = (nodes: Node[]) => {
  if (nodes.length === 0) return undefined;

  const lats = nodes.map(n => n.lat);
  const lngs = nodes.map(n => n.lng);
  
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const east = Math.max(...lngs);
  const west = Math.min(...lngs);
  
  const center = {
    lat: (north + south) / 2,
    lng: (east + west) / 2
  };
  
  // Calculer un zoom approprié basé sur la distance
  const latDiff = north - south;
  const lngDiff = east - west;
  const maxDiff = Math.max(latDiff, lngDiff);
  
  let zoom = 15; // zoom par défaut
  if (maxDiff > 0.1) zoom = 10;
  else if (maxDiff > 0.05) zoom = 12;
  else if (maxDiff > 0.01) zoom = 14;
  else if (maxDiff > 0.005) zoom = 15;
  else zoom = 16;
  
  return {
    north,
    south,
    east,
    west,
    center,
    zoom
  };
};

interface NetworkStoreState extends NetworkState {
  selectedCableType: string;
  simulationPreview: {
    foisonnementCharges?: number;
    loadDistribution?: { A: number; B: number; C: number };
    productionDistribution?: { A: number; B: number; C: number };
    desequilibrePourcent?: number;
    isActive: boolean;
  };
  isSimulationActive: boolean;
  resultsPanelFullscreen: boolean;
  selectedClientId: string | null;
  linkingMode: boolean;
  selectedClientForLinking: string | null;
  clientColorMode: ClientColorMode;
  circuitColorMapping: Map<string, string>;
  showClientTensionLabels: boolean;
  // Câble de branchement sélectionné (partagé entre TensionClient et Profil24h)
  selectedBranchementCableId: string | null;
  // État partagé pour la création de client avec sélection sur carte
  selectingLocationForNewClient: boolean;
  pendingClientLocation: { lat: number; lng: number } | null;
  // Mode création de client (ouvre le panneau d'édition en mode création)
  isCreatingClient: boolean;
  // État profil 24h persisté
  dailyProfileOptions: DailySimulationOptions;
  dailyProfileCustomProfiles: DailyProfileConfig;
  // Profil mesuré importé
  measuredProfile: HourlyProfile | null;
  measuredProfileMetadata: MeasuredProfileMetadata | null;
  // Mode de sélection de nœud sur la carte (centralisé)
  nodeSelectionMode: 'profil24h' | 'srg2' | 'equi8' | null;
  // Highlight profil 24H sur la carte
  dailyProfileHighlightNodeId: string | null;
  dailyProfileHighlightClientId: string | null;
  // Gestion de la sauvegarde
  isDirty: boolean;
  lastSavedAt: Date | null;
  lastAutoSaveAt: Date | null;
}

interface NetworkActions {
  // Project actions
  createNewProject: (name: string, voltageSystem: VoltageSystem) => void;
  loadProject: (project: Project) => void;
  updateProjectConfig: (updates: Partial<Pick<Project, 'name' | 'voltageSystem' | 'cosPhi' | 'cosPhiCharges' | 'cosPhiProductions' | 'foisonnementCharges' | 'foisonnementProductions' | 'defaultChargeKVA' | 'defaultProductionKVA' | 'loadModel' | 'desequilibrePourcent' | 'forcedModeConfig' | 'manualPhaseDistribution' | 'phaseDistributionModeCharges' | 'phaseDistributionModeProductions' | 'transformerConfig' | 'season'>>) => void;
  
  // Node actions
  addNode: (lat: number, lng: number) => void;
  updateNode: (nodeId: string, updates: Partial<Node> & { transformerConfig?: TransformerConfig }) => void;
  deleteNode: (nodeId: string) => void;
  moveNode: (nodeId: string, lat: number, lng: number) => void;
  
  // Cable actions
  addCable: (nodeAId: string, nodeBId: string, typeId: string, coordinates: { lat: number; lng: number; }[]) => void;
  updateCable: (cableId: string, updates: Partial<Cable>) => void;
  deleteCable: (cableId: string) => void;
  
  // UI actions
  setSelectedTool: (tool: NetworkState['selectedTool']) => void;
  setSelectedScenario: (scenario: CalculationScenario) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedCable: (cableId: string | null) => void;
  setSelectedClient: (clientId: string | null) => void;
  setSelectedClientForLinking: (clientId: string | null) => void;
  setSelectedCableType: (cableTypeId: string) => void;
  openEditPanel: (target: 'node' | 'cable' | 'project' | 'simulation' | 'client') => void;
  closeEditPanel: () => void;
  
  // Client actions
  importClientsFromExcel: (clients: import('@/types/network').ClientImporte[]) => void;
  addClientManual: (clientData: {
    nomCircuit: string;
    puissanceContractuelle_kVA: number;
    puissancePV_kVA: number;
    lat: number;
    lng: number;
    clientType: import('@/types/network').ClientType;
    connectionType: import('@/types/network').ClientConnectionType;
  }) => void;
  updateClientImporte: (clientId: string, updates: Partial<import('@/types/network').ClientImporte>) => void;
  deleteClientImporte: (clientId: string) => void;
  linkClientToNode: (clientId: string, nodeId: string) => void;
  unlinkClient: (clientId: string) => void;
  updateNodePhaseDistribution: (nodeId: string) => void;
  rebalanceAllMonoClients: () => void;
  
  // Calculations
  calculateAll: () => void;
  updateAllCalculations: () => void;
  
  // Simulation actions
  toggleSimulationMode: () => void;
  toggleSimulationActive: () => void;
  updateSimulationPreview: (preview: Partial<NetworkStoreState['simulationPreview']>) => void;
  clearSimulationPreview: () => void;
  // Méthodes SRG2
  addSRG2Device: (nodeId: string) => void;
  removeSRG2Device: (srg2Id: string) => void;
  updateSRG2Device: (srg2Id: string, updates: Partial<SRG2Config>) => void;
  // Méthodes compensateur de neutre
  addNeutralCompensator: (nodeId: string) => void;
  removeNeutralCompensator: (compensatorId: string) => void;
  updateNeutralCompensator: (compensatorId: string, updates: Partial<NeutralCompensator>) => void;
  proposeCableUpgrades: (threshold?: number) => void;
  toggleCableUpgrade: (upgradeId: string) => void;
  setCableReplacementConfig: (config: CableReplacementConfig | null) => void;
  runSimulation: () => void;
  
  // Validation
  validateConnectionType: (connectionType: ConnectionType, voltageSystem: VoltageSystem) => boolean;
  
  // Display settings
  setShowVoltages: (show: boolean) => void;
  toggleResultsPanel: () => void;
  toggleResultsPanelFullscreen: () => void;
  toggleFocusMode: () => void;
  toggleClientTensionLabels: () => void;
  changeVoltageSystem: () => void;
  setFoisonnementCharges: (value: number) => void;
  setFoisonnementChargesResidentiel: (value: number) => void;
  setFoisonnementChargesIndustriel: (value: number) => void;
  setFoisonnementProductions: (value: number) => void;
  calculateWithTargetVoltage: (nodeId: string, targetVoltage: number) => void;
  updateCableTypes: () => void;
  setClientColorMode: (mode: ClientColorMode) => void;
  generateCircuitColorMapping: () => void;
  // Actions pour la création de client avec sélection sur carte
  startClientLocationSelection: () => void;
  setClientLocation: (lat: number, lng: number) => void;
  cancelClientLocationSelection: () => void;
  clearPendingClientLocation: () => void;
  // Actions pour le mode création de client
  startClientCreation: () => void;
  cancelClientCreation: () => void;
  // Actions profil 24h
  setDailyProfileOptions: (options: Partial<DailySimulationOptions>) => void;
  setDailyProfileCustomProfiles: (profiles: DailyProfileConfig) => void;
  // Actions profil mesuré
  setMeasuredProfile: (profile: HourlyProfile, metadata: MeasuredProfileMetadata) => void;
  clearMeasuredProfile: () => void;
  // Actions de sélection de nœud sur la carte
  startNodeSelection: (mode: 'profil24h' | 'srg2' | 'equi8') => void;
  cancelNodeSelection: () => void;
  handleNodeSelectionClick: (nodeId: string) => void;
  // Action câble de branchement
  setSelectedBranchementCableId: (cableId: string | null) => void;
  // Highlight profil 24H
  setDailyProfileHighlight: (nodeId: string | null, clientId: string | null) => void;
  // Actions de gestion de sauvegarde
  markAsDirty: () => void;
  markAsSaved: () => void;
  setLastSavedAt: (date: Date) => void;
  setLastAutoSaveAt: (date: Date) => void;
}

// Fonction utilitaire pour créer la configuration par défaut du transformateur
const createDefaultTransformerConfig = (voltageSystem: VoltageSystem): TransformerConfig => {
  const nominalVoltage = voltageSystem === "TRIPHASÉ_230V" ? 230 : 400;
  
  return {
    rating: "160kVA" as TransformerRating,
    nominalPower_kVA: 160,
    nominalVoltage_V: nominalVoltage,
    shortCircuitVoltage_percent: 4.0, // Valeur typique pour un transformateur 160kVA
    cosPhi: 0.95 // Facteur de puissance typique PV
  };
};

// Mapping robuste des types de connexion lors d'un changement de système de tension
const mapConnectionTypeForVoltageSystem = (
  oldType: ConnectionType,
  newVoltageSystem: VoltageSystem,
  isSource = false
): ConnectionType => {
  if (newVoltageSystem === 'TRIPHASÉ_230V') {
    // Passage 400V -> 230V
    switch (oldType) {
      case 'TÉTRA_3P+N_230_400V':
        return 'TRI_230V_3F';
      case 'MONO_230V_PN':
        return 'MONO_230V_PP';
      case 'MONO_230V_PP':
      case 'TRI_230V_3F':
        return oldType; // déjà compatibles
      default:
        return isSource ? 'TRI_230V_3F' : 'TRI_230V_3F';
    }
  } else {
    // Passage 230V -> 400V
    switch (oldType) {
      case 'TRI_230V_3F':
        return 'TÉTRA_3P+N_230_400V';
      case 'MONO_230V_PP':
        return 'MONO_230V_PN';
      case 'MONO_230V_PN':
      case 'TÉTRA_3P+N_230_400V':
        return oldType; // déjà compatibles
      default:
        return isSource ? 'TÉTRA_3P+N_230_400V' : 'TÉTRA_3P+N_230_400V';
    }
  }
};

// Mapping pour adapter les types de connexion selon le modèle de charge
const mapConnectionTypeForLoadModel = (
  voltageSystem: VoltageSystem,
  loadModel: LoadModel,
  isSource = false
): ConnectionType => {
  // Les sources gardent toujours leur type par défaut selon le système de tension
  if (isSource) {
    return voltageSystem === 'TRIPHASÉ_230V' ? 'TRI_230V_3F' : 'TÉTRA_3P+N_230_400V';
  }
  
  // Mode mixte : même logique que polyphase_equilibre (connexions poly par défaut)
  if (loadModel === 'mixte_mono_poly') {
    return voltageSystem === 'TRIPHASÉ_230V' ? 'TRI_230V_3F' : 'TÉTRA_3P+N_230_400V';
  }

  if (voltageSystem === 'TRIPHASÉ_230V') {
    return loadModel === 'monophase_reparti' ? 'MONO_230V_PP' : 'TRI_230V_3F';
  } else { // 'TÉTRAPHASÉ_400V'
    return loadModel === 'monophase_reparti' ? 'MONO_230V_PN' : 'TÉTRA_3P+N_230_400V';
  }
};

const createDefaultProject = (): Project => ({
  id: `project-${Date.now()}`,
  name: "Nouveau Projet",
  voltageSystem: "TÉTRAPHASÉ_400V",
  cosPhi: 0.95,
  cosPhiCharges: 0.95, // Charges inductives - défaut 0.95
  cosPhiProductions: 1.00, // Productions PV/Cogen - défaut 1.00
  foisonnementCharges: 100, // Legacy (calculé comme moyenne pondérée)
  foisonnementChargesResidentiel: 15, // Défaut résidentiel
  foisonnementChargesIndustriel: 70, // Défaut industriel
  foisonnementProductions: 100,
  defaultChargeKVA: 10,
  defaultProductionKVA: 5,
  transformerConfig: createDefaultTransformerConfig("TÉTRAPHASÉ_400V"), // Configuration transformateur par défaut
  loadModel: 'mixte_mono_poly', // NOUVEAU : mode mixte par défaut
  desequilibrePourcent: 0,
   season: 'summer',
  manualPhaseDistribution: {
    charges: { A: 33.33, B: 33.33, C: 33.34 },
    productions: { A: 33.33, B: 33.33, C: 33.34 },
    constraints: { min: -20, max: 20, total: 100 }
  },
  phaseDistributionModeCharges: 'mono_only', // Mode conservateur par défaut pour les charges
  phaseDistributionModeProductions: 'mono_only', // Mode conservateur par défaut pour les productions
  nodes: [],
  cables: [],
  cableTypes: defaultCableTypes
});

const createDefaultProject2 = (name: string, voltageSystem: VoltageSystem): Project => ({
  id: `project-${Date.now()}`,
  name,
  voltageSystem,
  cosPhi: 0.95,
  cosPhiCharges: 0.95, // Charges inductives - défaut 0.95
  cosPhiProductions: 1.00, // Productions PV/Cogen - défaut 1.00
  foisonnementCharges: 100, // Legacy (calculé comme moyenne pondérée)
  foisonnementChargesResidentiel: 15, // Défaut résidentiel
  foisonnementChargesIndustriel: 70, // Défaut industriel
  foisonnementProductions: 100,
  defaultChargeKVA: 10,
  defaultProductionKVA: 5,
  transformerConfig: createDefaultTransformerConfig(voltageSystem), // Configuration transformateur adaptée au système
  loadModel: 'mixte_mono_poly', // NOUVEAU : mode mixte par défaut
  desequilibrePourcent: 0,
  season: 'summer', // Saison par défaut : été (contrainte thermique dimensionnante)
  addEmptyNodeByDefault: true, // Par défaut, ajouter des nœuds vierges
  treatSmallPolyProductionsAsMono: true, // Par défaut, traiter productions TRI/TETRA ≤5kVA comme MONO
  manualPhaseDistribution: {
    charges: { A: 33.33, B: 33.33, C: 33.34 },
    productions: { A: 33.33, B: 33.33, C: 33.34 },
    constraints: { min: -20, max: 20, total: 100 }
  },
  phaseDistributionModeCharges: 'mono_only', // Mode conservateur par défaut pour les charges
  phaseDistributionModeProductions: 'mono_only', // Mode conservateur par défaut pour les productions
  nodes: [],
  cables: [],
  cableTypes: [...defaultCableTypes]
});

export const useNetworkStore = create<NetworkStoreState & NetworkActions>((set, get) => ({
  // État de preview de simulation
  simulationPreview: {
    isActive: false
  },
  isSimulationActive: false,
  // State
  currentProject: createDefaultProject(),
  selectedScenario: 'MIXTE',
  calculationResults: {
    PRÉLÈVEMENT: null,
    MIXTE: null,
    PRODUCTION: null,
    FORCÉ: null
  },
  simulationResults: {
    PRÉLÈVEMENT: null,
    MIXTE: null,
    PRODUCTION: null,
    FORCÉ: null
  },
  selectedTool: 'select',
  selectedNodeId: null,
  selectedCableId: null,
  selectedCableType: 'baxb-95', // Par défaut, câble aérien
  editPanelOpen: false,
  editTarget: null,
  showVoltages: true,
  resultsPanelOpen: true,
  resultsPanelFullscreen: false,
  focusMode: false,
  simulationMode: false,
  simulationEquipment: {
    srg2Devices: [],
    neutralCompensators: [],
    cableUpgrades: []
  },
  // État pour les clients
  selectedClientId: null,
  linkingMode: false,
  selectedClientForLinking: null,
  clientColorMode: 'couplage',
  circuitColorMapping: new Map(),
  showClientTensionLabels: false,
  // Câble de branchement sélectionné
  selectedBranchementCableId: null,
  // État partagé pour la création de client
  selectingLocationForNewClient: false,
  pendingClientLocation: null,
  // Mode création de client
  isCreatingClient: false,
  // État profil 24h persisté
  dailyProfileOptions: { ...defaultDailySimulationOptions },
  dailyProfileCustomProfiles: defaultProfilesData as DailyProfileConfig,
  // Profil mesuré importé
  measuredProfile: null,
  measuredProfileMetadata: null,
  // Mode de sélection de nœud sur la carte
  nodeSelectionMode: null,
  // Highlight profil 24H
  dailyProfileHighlightNodeId: null,
  dailyProfileHighlightClientId: null,
  // Gestion de la sauvegarde
  isDirty: false,
  lastSavedAt: null,
  lastAutoSaveAt: null,

  // Actions
  createNewProject: (name, voltageSystem) => {
    const project = createDefaultProject2(name, voltageSystem);
    set({ 
      currentProject: project,
      selectedNodeId: null,
      selectedCableId: null,
      selectedTool: 'select',
      editPanelOpen: false,
      editTarget: null,
      showVoltages: true,
      simulationMode: false,
      isSimulationActive: false,
      isDirty: false, // Nouveau projet = pas de modifications
      lastSavedAt: null,
      calculationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationEquipment: {
        srg2Devices: [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    });
  },

  loadProject: (project) => {
    console.log('🔄 Store.loadProject called with:', project.name);
    
    // Migration automatique: si pas de loadModel, définir polyphase_equilibre
    if (!project.loadModel) {
      project.loadModel = 'polyphase_equilibre';
      console.log('📦 Projet ancien migré vers loadModel: polyphase_equilibre');
    }
    
    // Migration automatique: cosPhiCharges et cosPhiProductions
    if (project.cosPhiCharges === undefined) {
      project.cosPhiCharges = project.cosPhi ?? 0.95;
      console.log('📦 Projet migré: cosPhiCharges =', project.cosPhiCharges);
    }
    if (project.cosPhiProductions === undefined) {
      project.cosPhiProductions = 1.00;
      console.log('📦 Projet migré: cosPhiProductions = 1.00');
    }
    
    // Migration automatique: foisonnement différencié résidentiel/industriel
    if (project.foisonnementChargesResidentiel === undefined) {
      project.foisonnementChargesResidentiel = project.foisonnementCharges ?? 15;
      console.log('📦 Projet migré: foisonnementChargesResidentiel =', project.foisonnementChargesResidentiel);
    }
    if (project.foisonnementChargesIndustriel === undefined) {
      project.foisonnementChargesIndustriel = 70;
      console.log('📦 Projet migré: foisonnementChargesIndustriel = 70');
    }
    
    // Vérifier que le projet a la structure minimale requise
    if (!project.transformerConfig) {
      console.log('⚠️ Projet sans transformerConfig, ajout de la config par défaut');
      project.transformerConfig = createDefaultTransformerConfig(project.voltageSystem || "TÉTRAPHASÉ_400V");
    }

    // Assurer que manualPhaseDistribution existe
    if (!project.manualPhaseDistribution) {
      console.log('⚠️ Projet sans manualPhaseDistribution, ajout de la config par défaut');
      project.manualPhaseDistribution = {
        charges: { A: 33.33, B: 33.33, C: 33.34 },
        productions: { A: 33.33, B: 33.33, C: 33.34 },
        constraints: { min: -20, max: 20, total: 100 },
        chargesForced: false,
        productionsForced: false
      };
    }
    
    // Migration automatique: chargesForced et productionsForced si absents
    if (project.manualPhaseDistribution.chargesForced === undefined) {
      project.manualPhaseDistribution.chargesForced = false;
      console.log('📦 Projet migré: chargesForced = false (mode automatique)');
    }
    if (project.manualPhaseDistribution.productionsForced === undefined) {
      project.manualPhaseDistribution.productionsForced = false;
      console.log('📦 Projet migré: productionsForced = false (mode automatique)');
    }
    
    // Valider que manualPhaseDistribution existe pour mode mixte
    if (project.loadModel === 'mixte_mono_poly' && !project.manualPhaseDistribution) {
      project.manualPhaseDistribution = {
        charges: { A: 33.33, B: 33.33, C: 33.34 },
        productions: { A: 33.33, B: 33.33, C: 33.34 },
        constraints: { min: -20, max: 20, total: 100 },
        chargesForced: false,
        productionsForced: false
      };
      console.log('📦 Configuration manualPhaseDistribution initialisée pour mode mixte');
    }

    // Initialiser les clients importés et liaisons si pas définis
    if (!project.clientsImportes) {
      project.clientsImportes = [];
    }
    if (!project.clientLinks) {
      project.clientLinks = [];
    }

    // Nettoyer les liens clients vers des nœuds inexistants (projets anciens ou nœuds supprimés)
    if (project.clientLinks.length > 0) {
      const existingNodeIds = new Set(project.nodes.map(n => n.id));
      project.clientLinks = project.clientLinks.filter(link => existingNodeIds.has(link.nodeId));
    }
    
    // Normaliser connectionType pour tous les clients importés (migration)
    if (project.clientsImportes.length > 0) {
      project.clientsImportes = project.clientsImportes.map(client => {
        if (!client.connectionType) {
          return {
            ...client,
            connectionType: normalizeClientConnectionType(client.couplage, project.voltageSystem)
          };
        }
        return client;
      });
      console.log('🔧 connectionType normalisé pour tous les clients importés');
    }
    
    console.log(`🔍 DIAGNOSTIC loadProject:`);
    console.log(`   - loadModel: ${project.loadModel}`);
    console.log(`   - clientsImportes.length: ${project.clientsImportes.length}`);
    console.log(`   - clientLinks.length: ${project.clientLinks?.length || 0}`);
    console.log(`   - Condition répartition: ${project.loadModel === 'mixte_mono_poly' && project.clientsImportes.length > 0}`);
    
    // === BASCULEMENT AUTOMATIQUE EN MODE MIXTE SI CLIENTS MONO DÉTECTÉS ===
    if (project.loadModel === 'monophase_reparti' && project.clientsImportes.length > 0) {
      const monoClientsCount = project.clientsImportes.filter(c => {
        const normalizedType = normalizeClientConnectionType(c.couplage, project.voltageSystem);
        return normalizedType === 'MONO';
      }).length;
      
      if (monoClientsCount > 0) {
        console.log(`🔄 Basculement automatique: ${monoClientsCount} clients MONO détectés, passage en mode mixte_mono_poly`);
        project.loadModel = 'mixte_mono_poly';
      }
    }
    
    // === RÉPARTITION AUTOMATIQUE DES CLIENTS MONO ===
    if (project.loadModel === 'mixte_mono_poly' && project.clientsImportes.length > 0) {
      console.log(`🔍 ===== DÉBUT RÉPARTITION AUTOMATIQUE =====`);
      console.log(`🔍 Vérification répartition MONO : ${project.clientsImportes.length} clients importés`);
      let assignedCount = 0;
      let monoClientsCount = 0;
      let monoWithoutPhaseCount = 0;
      
      // Parcourir tous les nœuds
      project.nodes.forEach(node => {
        const linkedClients = project.clientsImportes!.filter(client =>
          project.clientLinks!.some(link => link.clientId === client.id && link.nodeId === node.id)
        );
        
        console.log(`🔍 Nœud "${node.name}" : ${linkedClients.length} clients liés`);
        
        linkedClients.forEach(client => {
          if (client.connectionType === 'MONO') {
            monoClientsCount++;
            
            if (!client.assignedPhase) {
              monoWithoutPhaseCount++;
              // Récupérer UNIQUEMENT les clients MONO liés et déjà assignés (équilibrage des clients connectés)
              const alreadyAssignedClients = project.clientsImportes!.filter(c =>
                c.id !== client.id &&
                c.connectionType === 'MONO' &&
                c.assignedPhase !== undefined &&
                project.clientLinks?.some(link => link.clientId === c.id)
              );
              
              // Assigner automatiquement la phase
              const assignedPhase = autoAssignPhaseForMonoClient(client, alreadyAssignedClients, project.voltageSystem);
              client.assignedPhase = assignedPhase;
              assignedCount++;
              
              console.log(`✅ Phase ${assignedPhase} assignée au client MONO "${client.nomCircuit}" (${client.puissanceContractuelle_kVA} kVA)`);
            } else {
              console.log(`ℹ️ Client MONO "${client.nomCircuit}" déjà sur phase ${client.assignedPhase}`);
            }
          }
        });
        
        // Recalculer autoPhaseDistribution pour ce nœud (Option B: curseurs universels)
        if (linkedClients.length > 0) {
        const distribution = calculateNodeAutoPhaseDistribution(
            node,
            linkedClients,
            project.manualPhaseDistribution!.charges,
            project.manualPhaseDistribution!.productions,
            project.voltageSystem,
            project.foisonnementChargesResidentiel ?? 15,
            project.foisonnementChargesIndustriel ?? 70,
            project.foisonnementProductions ?? 100,
            undefined, // manualCouplingDistributionCharges
            undefined, // manualCouplingDistributionProductions
            project.treatSmallPolyProductionsAsMono || false
          );
          node.autoPhaseDistribution = distribution;
        }
      });
      
      console.log(`📊 Statistiques répartition :`);
      console.log(`   - Clients MONO : ${monoClientsCount}`);
      console.log(`   - MONO sans phase : ${monoWithoutPhaseCount}`);
      console.log(`   - Phases assignées : ${assignedCount}`);
      
      if (assignedCount > 0) {
        toast.success(`${assignedCount} clients MONO répartis automatiquement sur les phases`);
        
        // Initialiser manualPhaseDistribution avec répartition réelle (charges ET productions)
        const realChargesDistribution = calculateRealMonoDistributionPercents(
          project.nodes,
          project.clientsImportes,
          project.clientLinks
        );
        
        const realProductionsDistribution = calculateRealMonoProductionDistributionPercents(
          project.nodes,
          project.clientsImportes,
          project.clientLinks
        );
        
        project.manualPhaseDistribution = {
          ...project.manualPhaseDistribution,
          charges: realChargesDistribution,
          productions: realProductionsDistribution
        };
        
        console.log(`📊 Curseurs charges initialisés : A=${realChargesDistribution.A.toFixed(1)}%, B=${realChargesDistribution.B.toFixed(1)}%, C=${realChargesDistribution.C.toFixed(1)}%`);
        console.log(`📊 Curseurs productions initialisés : A=${realProductionsDistribution.A.toFixed(1)}%, B=${realProductionsDistribution.B.toFixed(1)}%, C=${realProductionsDistribution.C.toFixed(1)}%`);
      }
    }

    // Rétrocompatibilité: définir addEmptyNodeByDefault si non défini
    if (project.addEmptyNodeByDefault === undefined) {
      project.addEmptyNodeByDefault = true;
    }
    
    // Rétrocompatibilité: définir treatSmallPolyProductionsAsMono si non défini
    if (project.treatSmallPolyProductionsAsMono === undefined) {
      project.treatSmallPolyProductionsAsMono = true;
    }

    // Calculer les bounds géographiques si pas encore définis
    if (!project.geographicBounds && project.nodes.length > 0) {
      project.geographicBounds = calculateProjectBounds(project.nodes);
    }

    // Vérifier si les types de câbles sont à jour
    if (project.cableTypes.length !== defaultCableTypes.length) {
      console.log(`Mise à jour des types de câbles: ${project.cableTypes.length} -> ${defaultCableTypes.length}`);
      project.cableTypes = [...defaultCableTypes];
      toast.info(`Types de câbles mis à jour: ${defaultCableTypes.length} types disponibles`);
    }

    console.log('🔄 Setting state with project:', project.name);
    set({ 
      currentProject: project,
      selectedNodeId: null,
      selectedCableId: null,
      selectedTool: 'select',
      editPanelOpen: false,
      editTarget: null,
      showVoltages: true,
      simulationMode: false,
      isSimulationActive: false,
      isDirty: false, // Projet chargé = pas de modifications
      lastSavedAt: new Date(), // Considérer le projet chargé comme "sauvé"
      calculationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationResults: {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      simulationEquipment: project.simulationEquipment || {
        srg2Devices: [],
        neutralCompensators: [],
        cableUpgrades: []
      }
    });
    console.log('✅ State updated successfully');
    
    // Recalculer immédiatement
    console.log('🔄 Triggering calculations...');
    get().updateAllCalculations();
    console.log('✅ Calculations triggered');
    
    // Déclencher le zoom sur le projet chargé après un court délai
    setTimeout(() => {
      console.log('🔄 Triggering zoom to project bounds');
      const event = new CustomEvent('zoomToProject', { 
        detail: project.geographicBounds 
      });
      window.dispatchEvent(event);
      console.log('✅ Zoom event dispatched');
    }, 100);
    
    console.log('✅ loadProject completed successfully');
  },

  updateProjectConfig: (updates) => {
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;
    
    let updatedProject = { ...currentProject, ...updates } as Project;

    // Si passage vers mode mixte, initialiser avec répartition réelle
    if (updates.loadModel === 'mixte_mono_poly' && currentProject.loadModel !== 'mixte_mono_poly') {
      const realChargesDistribution = calculateRealMonoDistributionPercents(
        currentProject.nodes,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      );
      
      const realProductionsDistribution = calculateRealMonoProductionDistributionPercents(
        currentProject.nodes,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      );
      
      updatedProject.manualPhaseDistribution = {
        ...updatedProject.manualPhaseDistribution,
        charges: realChargesDistribution,
        productions: realProductionsDistribution
      };
      
      toast.success(`Mode mixte activé. Curseurs charges/productions initialisés avec répartition réelle.`);
    }

    // Si le système de tension change, harmoniser tout le projet
    if (updates.voltageSystem && updates.voltageSystem !== currentProject.voltageSystem) {
      const newVS: VoltageSystem = updates.voltageSystem;
      const newNominal = newVS === 'TRIPHASÉ_230V' ? 230 : 400;

      // Mettre à jour tous les nœuds avec un mapping précis (et retirer la tensionCible de la source)
      const updatedNodes = currentProject.nodes.map((n) => ({
        ...n,
        connectionType: mapConnectionTypeForVoltageSystem(n.connectionType, newVS, !!n.isSource),
        tensionCible: n.isSource ? undefined : n.tensionCible,
      }));

      // Mettre à jour la config transformateur (ou créer une valeur par défaut)
      const updatedTransformer: TransformerConfig = {
        ...(currentProject.transformerConfig || createDefaultTransformerConfig(newVS)),
        nominalVoltage_V: newNominal,
      };

      updatedProject = {
        ...updatedProject,
        voltageSystem: newVS,
        nodes: updatedNodes,
        transformerConfig: updatedTransformer,
      } as Project;
    }

    // Si le modèle de charge change, adapter tous les types de connexion des nœuds
    if (updates.loadModel && updates.loadModel !== currentProject.loadModel) {
      const newLoadModel = updates.loadModel;
      
      // Mettre à jour tous les nœuds avec le type de connexion approprié
      const updatedNodes = updatedProject.nodes.map((n) => ({
        ...n,
        connectionType: mapConnectionTypeForLoadModel(updatedProject.voltageSystem, newLoadModel, !!n.isSource)
      }));

      updatedProject = {
        ...updatedProject,
        nodes: updatedNodes,
      } as Project;
    }

    // Recalculer les bounds géographiques si les nœuds ont changé
    if (updatedProject.nodes.length > 0) {
      updatedProject.geographicBounds = calculateProjectBounds(updatedProject.nodes);
    }
    
    // Mettre à jour le state AVANT les recalculs
    set({ currentProject: updatedProject, isDirty: true });

    // Si manualPhaseDistribution ou phaseDistributionMode change en mode mixte, recalculer toutes les distributions
    if ((updates.manualPhaseDistribution || updates.phaseDistributionModeCharges || updates.phaseDistributionModeProductions) && updatedProject.loadModel === 'mixte_mono_poly') {
      updatedProject.nodes.forEach(node => {
        get().updateNodePhaseDistribution(node.id);
      });
    }

    // Recalculs après mise à jour de la config (déclenche aussi le recalcul des tensions)
    updateAllCalculations();
  },

  addNode: (lat, lng) => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Déduire le type de connexion automatiquement selon le modèle de charge
    const connectionType = mapConnectionTypeForLoadModel(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', currentProject.nodes.length === 0);

    const isSource = currentProject.nodes.length === 0;
    const shouldAddDefaults = !isSource && !currentProject.addEmptyNodeByDefault;

    const newNode: Node = {
      id: `node-${Date.now()}`,
      name: `Nœud ${currentProject.nodes.length + 1}`,
      lat,
      lng,
      connectionType,
      clients: shouldAddDefaults ? [{ 
        id: `client-${Date.now()}`, 
        label: 'Charge 1', 
        S_kVA: currentProject.defaultChargeKVA || 10 
      }] : [],
      productions: shouldAddDefaults ? [{ 
        id: `prod-${Date.now()}`, 
        label: 'PV 1', 
        S_kVA: currentProject.defaultProductionKVA || 5
      }] : [],
      isSource,
      rt_terre_ohm: 25
    };

    const updatedNodes = [...currentProject.nodes, newNode];
    const updatedProject = {
      ...currentProject,
      nodes: updatedNodes,
      geographicBounds: calculateProjectBounds(updatedNodes)
    };

    set({
      currentProject: updatedProject,
      isDirty: true
    });
  },

  updateNode: (nodeId, updates) => {
    set((state) => {
      if (!state.currentProject) return state;
      
      const nodeIndex = state.currentProject.nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) return state;
      
      const updatedNodes = [...state.currentProject.nodes];
      const nodeUpdates = { ...updates };
      
      // Si on met à jour la configuration du transformateur d'une source
      let projectUpdates = {};
      if (updates.transformerConfig && updatedNodes[nodeIndex].isSource) {
        projectUpdates = { transformerConfig: updates.transformerConfig };
        delete nodeUpdates.transformerConfig;
      }
      
      updatedNodes[nodeIndex] = { ...updatedNodes[nodeIndex], ...nodeUpdates };
      
      return {
        ...state,
        isDirty: true,
        currentProject: {
          ...state.currentProject,
          ...projectUpdates,
          nodes: updatedNodes
        }
      };
    });
    get().updateAllCalculations();
  },

  deleteNode: (nodeId) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        nodes: currentProject.nodes.filter(node => node.id !== nodeId),
        cables: currentProject.cables.filter(cable => 
          cable.nodeAId !== nodeId && cable.nodeBId !== nodeId
        ),
        clientLinks: (currentProject.clientLinks || []).filter(link => link.nodeId !== nodeId)
      },
      selectedNodeId: null,
      isDirty: true
    });

    // Recalculer les résultats après suppression du nœud et de ses liens clients
    get().updateAllCalculations();
  },

  moveNode: (nodeId, lat, lng) => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Mettre à jour la position du nœud
    const updatedNodes = currentProject.nodes.map(node =>
      node.id === nodeId ? { ...node, lat, lng } : node
    );

    // Mettre à jour les câbles connectés à ce nœud
    const updatedCables = currentProject.cables.map(cable => {
      if (cable.nodeAId === nodeId || cable.nodeBId === nodeId) {
        const newCoordinates = [...cable.coordinates];
        
        if (cable.nodeAId === nodeId) {
          // Mettre à jour le premier point (départ)
          newCoordinates[0] = { lat, lng };
        }
        
        if (cable.nodeBId === nodeId) {
          // Mettre à jour le dernier point (arrivée)
          newCoordinates[newCoordinates.length - 1] = { lat, lng };
        }
        
        return {
          ...cable,
          coordinates: newCoordinates,
          length_m: ElectricalCalculator.calculateCableLength(newCoordinates)
        };
      }
      return cable;
    });

    const updatedProject = {
      ...currentProject,
      nodes: updatedNodes,
      cables: updatedCables,
      geographicBounds: calculateProjectBounds(updatedNodes)
    };

    set({
      currentProject: updatedProject,
      isDirty: true
    });
  },

  addCable: (nodeAId, nodeBId, typeId, coordinates) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const newCable: Cable = {
      id: `cable-${Date.now()}`,
      name: `Câble ${currentProject.cables.length + 1}`,
      typeId,
      pose: currentProject.cableTypes.find(t => t.id === typeId)?.posesPermises[0] || 'AÉRIEN',
      nodeAId,
      nodeBId,
      coordinates,
      length_m: ElectricalCalculator.calculateCableLength(coordinates)
    };

    set({
      currentProject: {
        ...currentProject,
        cables: [...currentProject.cables, newCable]
      },
      isDirty: true
    });
  },

  updateCable: (cableId, updates) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        cables: currentProject.cables.map(cable => {
          if (cable.id === cableId) {
            const updatedCable = { ...cable, ...updates };
            // Recalculer la longueur si les coordonnées ont changé
            if (updates.coordinates) {
              updatedCable.length_m = ElectricalCalculator.calculateCableLength(updates.coordinates);
            }
            return updatedCable;
          }
          return cable;
        })
      },
      isDirty: true
    });
  },

  deleteCable: (cableId) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({
      currentProject: {
        ...currentProject,
        cables: currentProject.cables.filter(cable => cable.id !== cableId)
      },
      selectedCableId: null,
      isDirty: true
    });
  },

  setSelectedTool: (tool) => set({ selectedTool: tool }),
  setSelectedScenario: (scenario) => {
    const { currentProject, updateAllCalculations } = get();
    
    // Définir les valeurs de curseurs selon le scénario
    let chargesValue: number;
    let productionsValue: number;
    
    switch (scenario) {
      case 'PRODUCTION':
        chargesValue = 0;
        productionsValue = 100;
        break;
      case 'MIXTE':
        chargesValue = 30;
        productionsValue = 100;
        break;
      case 'PRÉLÈVEMENT':
      default:
        chargesValue = 30;
        productionsValue = 0;
        break;
    }
    
    // Mettre à jour le scénario et les curseurs
    set({ 
      selectedScenario: scenario,
      currentProject: currentProject ? {
        ...currentProject,
        foisonnementCharges: chargesValue,
        foisonnementProductions: productionsValue
      } : currentProject
    });
    
    // Recalculer si un projet est chargé
    if (currentProject) {
      updateAllCalculations();
    }
  },
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setSelectedCable: (cableId) => set({ selectedCableId: cableId }),
  setSelectedClient: (clientId) => set({ selectedClientId: clientId }),
  setSelectedClientForLinking: (clientId) => set({ 
    selectedClientForLinking: clientId,
    linkingMode: clientId !== null 
  }),
  setSelectedCableType: (cableTypeId) => set({ selectedCableType: cableTypeId }),

  // Actions pour les clients importés
  importClientsFromExcel: (clients) => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    // Normaliser le connectionType pour chaque client importé
    const normalizedClients = clients.map(client => {
      // Si connectionType n'est pas défini, le déduire du couplage
      if (!client.connectionType) {
        return {
          ...client,
          connectionType: normalizeClientConnectionType(client.couplage, currentProject.voltageSystem)
        };
      }
      return client;
    });
    
    const updatedProject = {
      ...currentProject,
      clientsImportes: [...(currentProject.clientsImportes || []), ...normalizedClients],
      clientLinks: currentProject.clientLinks || [],
      importCount: (currentProject.importCount ?? 0) + 1 // Incrémenter le compteur d'imports
    };
    
    set({ currentProject: updatedProject, isDirty: true });
    toast.success(`${clients.length} raccordements importés avec succès`);
    
    // Initialiser manualPhaseDistribution avec répartition réelle en mode mixte
    if (currentProject.loadModel === 'mixte_mono_poly') {
      const realChargesDistribution = calculateRealMonoDistributionPercents(
        updatedProject.nodes,
        updatedProject.clientsImportes || [],
        updatedProject.clientLinks || []
      );
      
      const realProductionsDistribution = calculateRealMonoProductionDistributionPercents(
        updatedProject.nodes,
        updatedProject.clientsImportes || [],
        updatedProject.clientLinks || []
      );
      
      updatedProject.manualPhaseDistribution = {
        ...updatedProject.manualPhaseDistribution,
        charges: realChargesDistribution,
        productions: realProductionsDistribution
      };
      
      set({ currentProject: updatedProject });
      toast.success(`Curseurs charges/productions initialisés avec répartition réelle.`);
    }
    
    // Recalculer les bounds pour inclure les nouveaux clients
    const allPoints = [
      ...currentProject.nodes.map(n => ({ lat: n.lat, lng: n.lng })),
      ...clients.map(c => ({ lat: c.lat, lng: c.lng }))
    ];
    
    if (allPoints.length > 0) {
      const lats = allPoints.map(p => p.lat);
      const lngs = allPoints.map(p => p.lng);
      const bounds = {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs),
        center: {
          lat: (Math.max(...lats) + Math.min(...lats)) / 2,
          lng: (Math.max(...lngs) + Math.min(...lngs)) / 2
        }
      };
      updatedProject.geographicBounds = bounds;
      set({ currentProject: updatedProject });
      
      // Déclencher le zoom exactement comme loadProject
      setTimeout(() => {
        const event = new CustomEvent('zoomToProject', { 
          detail: bounds 
        });
        window.dispatchEvent(event);
      }, 100);
    }
  },

  addClientManual: (clientData) => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    const newClient: ClientImporte = {
      id: `client-manual-${Date.now()}`,
      identifiantCircuit: `MANUAL-${Date.now()}`,
      nomCircuit: clientData.nomCircuit,
      lat: clientData.lat,
      lng: clientData.lng,
      puissanceContractuelle_kVA: clientData.puissanceContractuelle_kVA,
      puissancePV_kVA: clientData.puissancePV_kVA,
      couplage: clientData.connectionType, // Utiliser le connectionType comme couplage brut
      clientType: clientData.clientType,
      connectionType: clientData.connectionType,
    };
    
    const updatedProject = {
      ...currentProject,
      clientsImportes: [...(currentProject.clientsImportes || []), newClient],
    };
    
    set({ currentProject: updatedProject, isDirty: true });
    toast.success(`Client "${clientData.nomCircuit}" créé avec succès`);
  },

  updateClientImporte: (clientId, updates) => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    const updatedClients = (currentProject.clientsImportes || []).map(client =>
      client.id === clientId ? { ...client, ...updates } : client
    );
    
    const updatedProject = {
      ...currentProject,
      clientsImportes: updatedClients
    };
    
    // ✅ 1. Mettre à jour le state AVANT les recalculs
    set({ currentProject: updatedProject, isDirty: true });
    
    // ✅ 2. Recalculer distribution du nœud si client lié en mode mixte
    const clientLink = currentProject.clientLinks?.find(l => l.clientId === clientId);
    if (clientLink && currentProject.loadModel === 'mixte_mono_poly') {
      get().updateNodePhaseDistribution(clientLink.nodeId);
    }
    
    // ✅ 3. Recalculer les tensions si le client est lié
    if (clientLink) {
      get().updateAllCalculations();
    }
  },

  deleteClientImporte: (clientId) => {
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;
    
    const isLinked = currentProject.clientLinks?.some(l => l.clientId === clientId);
    
    set({
      currentProject: {
        ...currentProject,
        clientsImportes: (currentProject.clientsImportes || []).filter(c => c.id !== clientId),
        clientLinks: (currentProject.clientLinks || []).filter(l => l.clientId !== clientId)
      },
      isDirty: true
    });
    
    toast.success('Client supprimé');
    
    // Recalculer si le client était lié
    if (isLinked) {
      updateAllCalculations();
    }
  },

  linkClientToNode: (clientId, nodeId) => {
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;
    
    // Vérifier si le client existe
    const client = currentProject.clientsImportes?.find(c => c.id === clientId);
    if (!client) {
      toast.error('Client non trouvé');
      return;
    }
    
    // Vérifier si le nœud existe
    const node = currentProject.nodes.find(n => n.id === nodeId);
    if (!node) {
      toast.error('Nœud non trouvé');
      return;
    }
    
    // === NOUVEAU : Mode mixte ===
    if (currentProject.loadModel === 'mixte_mono_poly') {
      console.log('🔗 === LIAISON CLIENT (Mode Mixte) ===');
      console.log(`   Client: ${client.nomCircuit} (${client.couplage})`);
      console.log(`   Nœud: ${node.name}`);
      
      // 1. Normaliser le type de connexion
      const rawConnectionType = normalizeClientConnectionType(
        client.couplage,
        currentProject.voltageSystem
      );
      
      // 2. Valider et convertir si nécessaire
      const { correctedType, warning } = validateAndConvertConnectionType(
        rawConnectionType,
        currentProject.voltageSystem,
        client.nomCircuit
      );
      
      // Afficher l'avertissement si conversion nécessaire
      if (warning) {
        toast.warning(warning);
      }
      
      // 3. Assigner phase si MONO (équilibrage uniquement avec les clients liés)
      let assignedPhase: 'A' | 'B' | 'C' | undefined;
      let assignedProductionPhase: 'A' | 'B' | 'C' | undefined;
      let productionPhaseCoupling: 'A' | 'B' | 'C' | 'A-B' | 'B-C' | 'A-C' | undefined;
      
      if (correctedType === 'MONO') {
        // Récupérer UNIQUEMENT les clients MONO liés et déjà assignés
        const allAssignedMonoClients = currentProject.clientsImportes?.filter(c =>
          c.connectionType === 'MONO' &&
          c.assignedPhase !== undefined &&
          currentProject.clientLinks?.some(link => link.clientId === c.id)
        ) || [];
        
        assignedPhase = autoAssignPhaseForMonoClient(client, allAssignedMonoClients, currentProject.voltageSystem);
        
        console.log(`✅ Client MONO "${client.nomCircuit}" lié au nœud "${node.name}" sur phase ${assignedPhase}`);
      } else if ((correctedType === 'TRI' || correctedType === 'TETRA') && 
                 currentProject.treatSmallPolyProductionsAsMono && 
                 client.puissancePV_kVA > 0 && 
                 client.puissancePV_kVA <= 5) {
        // Client TRI/TETRA avec production ≤5kVA et option activée : assigner une phase de production
        const allLinkedClients = currentProject.clientsImportes?.filter(c =>
          currentProject.clientLinks?.some(link => link.clientId === c.id)
        ) || [];
        
        const result = autoAssignProductionPhaseForSmallPolyClient(client, allLinkedClients, currentProject.voltageSystem);
        assignedProductionPhase = result.assignedPhase;
        productionPhaseCoupling = result.phaseCoupling;
        
        console.log(`✅ Client ${correctedType} "${client.nomCircuit}" avec production ≤5kVA : phase production ${assignedProductionPhase}`);
      }
      
      console.log(`   Type final: ${correctedType}`);
      console.log('================================');
      
      // Mettre à jour le client avec connectionType, assignedPhase et assignedProductionPhase
      const updatedClientsImportes = currentProject.clientsImportes?.map(c => 
        c.id === clientId 
          ? { 
              ...c, 
              connectionType: correctedType, 
              assignedPhase,
              assignedProductionPhase,
              productionPhaseCoupling
            }
          : c
      );
      
      // Gérer les liens (nouveau ou mise à jour)
      const currentLinks = currentProject.clientLinks || [];
      const existingLink = currentLinks.find(l => l.clientId === clientId);
      let updatedLinks: ClientLink[];
      
      if (existingLink) {
        // Mettre à jour la liaison existante
        updatedLinks = currentLinks.map(l =>
          l.clientId === clientId ? { ...l, nodeId } : l
        );
      } else {
        // Créer une nouvelle liaison
        const newLink: ClientLink = {
          id: `link-${clientId}-${nodeId}`,
          clientId,
          nodeId
        };
        updatedLinks = [...currentLinks, newLink];
      }
      
      // Mettre à jour le projet
      set({
        currentProject: {
          ...currentProject,
          clientsImportes: updatedClientsImportes,
          clientLinks: updatedLinks
        },
        selectedClientForLinking: null,
        linkingMode: false,
        selectedTool: 'select',
        isDirty: true
      });
      
      // Recalculer autoPhaseDistribution pour le nœud concerné
      get().updateNodePhaseDistribution(nodeId);
      
      toast.success(`✅ Client "${client.nomCircuit}" lié au nœud "${node.name}"`);
      updateAllCalculations();
      
    } else {
      // === CODE EXISTANT pour anciens modes ===
      const currentLinks = currentProject.clientLinks || [];
      const existingLink = currentLinks.find(l => l.clientId === clientId);
      
      let updatedLinks;
      if (existingLink) {
        // Mettre à jour la liaison existante
        updatedLinks = currentLinks.map(l =>
          l.clientId === clientId ? { ...l, nodeId } : l
        );
        toast.success(`✅ Client "${client.nomCircuit}" relié à ${node.name}`);
      } else {
        // Créer une nouvelle liaison
        const newLink: ClientLink = {
          id: `link-${Date.now()}`,
          clientId,
          nodeId
        };
        updatedLinks = [...currentLinks, newLink];
        toast.success(`✅ Client "${client.nomCircuit}" lié à ${node.name}`);
      }
      
      set({
        currentProject: {
          ...currentProject,
          clientLinks: updatedLinks
        },
        selectedClientForLinking: null,
        linkingMode: false,
        selectedTool: 'select',
        isDirty: true
      });
      
      updateAllCalculations();
    }
  },

  unlinkClient: (clientId) => {
    const { currentProject, updateAllCalculations } = get();
    if (!currentProject) return;
    
    // Récupérer le nodeId avant de supprimer le lien
    const link = currentProject.clientLinks?.find(l => l.clientId === clientId);
    const nodeId = link?.nodeId;
    
    set({
      currentProject: {
        ...currentProject,
        clientLinks: (currentProject.clientLinks || []).filter(l => l.clientId !== clientId)
      },
      isDirty: true
    });
    
    // Recalculer distribution du nœud si mode mixte
    if (currentProject.loadModel === 'mixte_mono_poly' && nodeId) {
      get().updateNodePhaseDistribution(nodeId);
    }
    
    toast.success('Client délié');
    updateAllCalculations();
  },
  
  updateNodePhaseDistribution: (nodeId: string) => {
    const state = get();
    if (!state.currentProject || state.currentProject.loadModel !== 'mixte_mono_poly') {
      return;
    }
    
    const node = state.currentProject.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    // Récupérer clients liés
    const linkedClients = getLinkedClientsForNode(
      nodeId,
      state.currentProject.clientsImportes || [],
      state.currentProject.clientLinks || []
    );
    
    // Calculer distribution (Option B: curseurs toujours appliqués)
    // ✅ Correction : passer les coefficients de foisonnement pour calculer foisonneAvecCurseurs
    const distribution = calculateNodeAutoPhaseDistribution(
      node,
      linkedClients,
      state.currentProject.manualPhaseDistribution?.charges || { A: 33.33, B: 33.33, C: 33.34 },
      state.currentProject.manualPhaseDistribution?.productions || { A: 33.33, B: 33.33, C: 33.34 },
      state.currentProject.voltageSystem,
      state.currentProject.foisonnementChargesResidentiel ?? 15,
      state.currentProject.foisonnementChargesIndustriel ?? 70,
      state.currentProject.foisonnementProductions ?? 100,
      undefined, // manualCouplingDistributionCharges
      undefined, // manualCouplingDistributionProductions
      state.currentProject.treatSmallPolyProductionsAsMono || false
    );
    
    // Mettre à jour le nœud
    const updatedNodes = state.currentProject.nodes.map(n => 
      n.id === nodeId 
        ? { ...n, autoPhaseDistribution: distribution }
        : n
    );
    
    set({
      currentProject: {
        ...state.currentProject,
        nodes: updatedNodes
      }
    });
  },

  rebalanceAllMonoClients: () => {
    const { currentProject } = get();
    if (!currentProject || currentProject.loadModel !== 'mixte_mono_poly') {
      toast.error('❌ Le re-balancing n\'est disponible qu\'en mode mixte');
      return;
    }
    
    console.log('🔄 Re-balancing global des clients MONO...');
    
    // Récupérer tous les clients MONO liés
    const monoClients = currentProject.clientsImportes?.filter(c => 
      c.connectionType === 'MONO' &&
      currentProject.clientLinks?.some(link => link.clientId === c.id)
    ) || [];
    
    // Récupérer les clients TRI/TETRA avec production ≤5 kVA si l'option est activée
    const smallPolyProdClients = (currentProject.treatSmallPolyProductionsAsMono
      ? currentProject.clientsImportes?.filter(c => 
          (c.connectionType === 'TRI' || c.connectionType === 'TETRA') &&
          c.puissancePV_kVA > 0 && c.puissancePV_kVA <= 5 &&
          currentProject.clientLinks?.some(link => link.clientId === c.id)
        ) || []
      : []);
    
    if (monoClients.length === 0 && smallPolyProdClients.length === 0) {
      const msg = currentProject.treatSmallPolyProductionsAsMono
        ? 'ℹ️ Aucun client MONO ni production TRI/TETRA ≤5kVA à rééquilibrer'
        : 'ℹ️ Aucun client MONO à rééquilibrer';
      toast.info(msg);
      return;
    }
    
    // Trier clients MONO par puissance décroissante pour meilleur équilibrage
    monoClients.sort((a, b) => 
      (b.puissanceContractuelle_kVA + b.puissancePV_kVA) - 
      (a.puissanceContractuelle_kVA + a.puissancePV_kVA)
    );
    
    // Réassigner séquentiellement les clients MONO
    const alreadyAssigned: import('@/types/network').ClientImporte[] = [];
    monoClients.forEach(client => {
      client.assignedPhase = autoAssignPhaseForMonoClient(client, alreadyAssigned, currentProject.voltageSystem);
      alreadyAssigned.push(client);
    });
    
    // Réassigner les productions TRI/TETRA ≤5kVA si l'option est activée
    if (smallPolyProdClients.length > 0) {
      console.log(`🔄 Rééquilibrage de ${smallPolyProdClients.length} productions TRI/TETRA ≤5kVA...`);
      
      // Trier par puissance de production décroissante
      smallPolyProdClients.sort((a, b) => b.puissancePV_kVA - a.puissancePV_kVA);
      
      // Récupérer tous les clients déjà traités pour équilibrage des productions
      const alreadyAssignedProductions = [
        ...alreadyAssigned,
        ...currentProject.clientsImportes?.filter(c => 
          c.connectionType !== 'MONO' &&
          (c.connectionType === 'TRI' || c.connectionType === 'TETRA') &&
          c.puissancePV_kVA > 0 && c.puissancePV_kVA <= 5 &&
          currentProject.clientLinks?.some(link => link.clientId === c.id) &&
          !smallPolyProdClients.includes(c)
        ) || []
      ];
      
      smallPolyProdClients.forEach(client => {
        const assignment = autoAssignProductionPhaseForSmallPolyClient(
          client,
          alreadyAssignedProductions,
          currentProject.voltageSystem
        );
        client.assignedProductionPhase = assignment.assignedPhase;
        client.productionPhaseCoupling = assignment.phaseCoupling;
        alreadyAssignedProductions.push(client);
      });
    }
    
    // Mettre à jour le projet
    set({ 
      currentProject: { 
        ...currentProject,
        clientsImportes: currentProject.clientsImportes 
      } 
    });
    
    // Recalculer les distributions de tous les nœuds
    currentProject.nodes.forEach(node => {
      get().updateNodePhaseDistribution(node.id);
    });
    
    // Récupérer le state mis à jour après tous les updateNodePhaseDistribution
    const updatedProject = get().currentProject!;
    
    get().updateAllCalculations();
    
    // Relancer le calcul de tension
    get().calculateAll();
    
    // Mettre à jour les curseurs de distribution manuelle après rééquilibrage
    const realChargesDistribution = calculateRealMonoDistributionPercents(
      updatedProject.nodes,
      updatedProject.clientsImportes || [],
      updatedProject.clientLinks || []
    );
    
    const realProductionsDistribution = calculateRealMonoProductionDistributionPercents(
      updatedProject.nodes,
      updatedProject.clientsImportes || [],
      updatedProject.clientLinks || []
    );
    
    // Mettre à jour la configuration du projet (Option B: plus de modes)
    set({
      currentProject: {
        ...get().currentProject!,
        manualPhaseDistribution: {
          charges: realChargesDistribution,
          productions: realProductionsDistribution,
          constraints: get().currentProject!.manualPhaseDistribution.constraints
        }
      }
    });
    
    console.log(`📊 Curseurs charges mis à jour : A=${realChargesDistribution.A.toFixed(1)}%, B=${realChargesDistribution.B.toFixed(1)}%, C=${realChargesDistribution.C.toFixed(1)}%`);
    console.log(`📊 Curseurs productions mis à jour : A=${realProductionsDistribution.A.toFixed(1)}%, B=${realProductionsDistribution.B.toFixed(1)}%, C=${realProductionsDistribution.C.toFixed(1)}%`);
    
    const totalRebalanced = monoClients.length + smallPolyProdClients.length;
    const { unbalancePercent } = calculateProjectUnbalance(currentProject.nodes);
    
    const message = smallPolyProdClients.length > 0
      ? `✅ Rééquilibrage terminé : ${monoClients.length} MONO + ${smallPolyProdClients.length} prod. TRI/TETRA ≤5kVA (déséquilibre = ${unbalancePercent.toFixed(1)}%)`
      : `✅ Rééquilibrage terminé : ${monoClients.length} clients MONO (déséquilibre = ${unbalancePercent.toFixed(1)}%)`;
    
    toast.success(message);
  },

  openEditPanel: (target) => {
    console.log('🐛 openEditPanel called with target:', target);
    // Si on ouvre le panneau de simulation, activer le mode simulation
    if (target === 'simulation') {
      console.log('🐛 Opening simulation panel');
      set({ 
        editPanelOpen: true, 
        editTarget: target,
        simulationMode: true,
        selectedTool: 'simulation'
      });
    } else {
      console.log('🐛 Opening other panel:', target);
      set({ 
        editPanelOpen: true, 
        editTarget: target 
      });
    }
    console.log('🐛 Panel state after set:', get().editTarget, get().editPanelOpen);
  },

  closeEditPanel: () => set({ 
    editPanelOpen: false, 
    editTarget: null,
    // Désactiver le mode simulation si on ferme le panneau simulation
    simulationMode: get().editTarget === 'simulation' ? false : get().simulationMode,
    selectedTool: get().editTarget === 'simulation' ? 'select' : get().selectedTool
  }),

  updateAllCalculations: () => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    // Don't calculate if no cables are present
    if (!currentProject.cables || currentProject.cables.length === 0) {
      console.log('⚠️ No cables present, skipping calculations');
      return;
    }

    // Calculer autoPhaseDistribution pour chaque nœud en mode mixte AVANT les calculs
    if (currentProject.loadModel === 'mixte_mono_poly' && currentProject.clientsImportes && currentProject.clientLinks) {
      console.log('🔄 Calcul autoPhaseDistribution pour mode mixte avec foisonnement');
      currentProject.nodes.forEach(node => {
        const linkedClients = currentProject.clientLinks
          ?.filter(link => link.nodeId === node.id)
          .map(link => currentProject.clientsImportes?.find(c => c.id === link.clientId))
          .filter(c => c !== undefined) as ClientImporte[] || [];
        
        if (linkedClients.length > 0 || node.clients.length > 0 || node.productions.length > 0) {
          const autoPhaseDistribution = calculateNodeAutoPhaseDistribution(
            node,
            linkedClients,
            currentProject.manualPhaseDistribution?.charges || { A: 33.33, B: 33.33, C: 33.33 },
            currentProject.manualPhaseDistribution?.productions || { A: 33.33, B: 33.33, C: 33.33 },
            currentProject.voltageSystem,
            currentProject.foisonnementChargesResidentiel ?? 15, // Foisonnement résidentiel
            currentProject.foisonnementChargesIndustriel ?? 70, // Foisonnement industriel
            currentProject.foisonnementProductions, // Foisonnement productions
            currentProject.treatSmallPolyProductionsAsMono || false
          );
          node.autoPhaseDistribution = autoPhaseDistribution;
        }
      });
    }

    const calculator = new ElectricalCalculator(
      currentProject.cosPhi,
      currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95,
      currentProject.cosPhiProductions ?? 1.00
    );
    
    const results = {
      PRÉLÈVEMENT: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRÉLÈVEMENT',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      ),
      MIXTE: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'MIXTE',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      ),
      PRODUCTION: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRODUCTION',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      ),
      FORCÉ: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'FORCÉ',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      )
    };

    set({ calculationResults: results });

    // Si mode simulation actif avec équipements actifs, recalculer aussi la simulation
    const { simulationMode, simulationEquipment } = get();
    const hasActiveEquipment = simulationMode && (
      (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
      simulationEquipment.neutralCompensators.some(c => c.enabled)
    );

    if (hasActiveEquipment) {
      get().runSimulation();
    }
  },

  calculateAll: () => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Renuméroter les câbles depuis la source vers les nœuds les plus éloignés
    const renumberCables = () => {
      // Trouver la source
      const sourceNode = currentProject.nodes.find(node => node.isSource);
      if (!sourceNode || currentProject.cables.length === 0) return;

      // Construire un graphe des connexions
      const connections = new Map<string, string[]>();
      const cableMap = new Map<string, any>(); // Pour retrouver les câbles par connexion

      currentProject.cables.forEach(cable => {
        // Ajouter les connexions bidirectionnelles
        if (!connections.has(cable.nodeAId)) connections.set(cable.nodeAId, []);
        if (!connections.has(cable.nodeBId)) connections.set(cable.nodeBId, []);
        
        connections.get(cable.nodeAId)!.push(cable.nodeBId);
        connections.get(cable.nodeBId)!.push(cable.nodeAId);
        
        // Mapper les connexions aux câbles
        const key1 = `${cable.nodeAId}-${cable.nodeBId}`;
        const key2 = `${cable.nodeBId}-${cable.nodeAId}`;
        cableMap.set(key1, cable);
        cableMap.set(key2, cable);
      });

      // Parcours BFS depuis la source pour renuméroter
      const visited = new Set<string>();
      const cableOrder: any[] = [];
      const queue = [sourceNode.id];
      visited.add(sourceNode.id);

      while (queue.length > 0) {
        const currentNodeId = queue.shift()!;
        const neighbors = connections.get(currentNodeId) || [];

        neighbors.forEach(neighborId => {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
            
            // Trouver le câble correspondant
            const cableKey = `${currentNodeId}-${neighborId}`;
            const cable = cableMap.get(cableKey);
            if (cable && !cableOrder.find(c => c.id === cable.id)) {
              cableOrder.push(cable);
            }
          }
        });
      }

      // Renuméroter les câbles trouvés
      cableOrder.forEach((cable, index) => {
        cable.name = `Câble ${index + 1}`;
      });

      console.log(`Câbles renumérotés: ${cableOrder.length} câbles depuis la source`);
    };

    // Appliquer la renumérotation
    renumberCables();

    const calculator = new ElectricalCalculator(
      currentProject.cosPhi,
      currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95,
      currentProject.cosPhiProductions ?? 1.00
    );
    
    const results = {
      PRÉLÈVEMENT: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRÉLÈVEMENT',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      ),
      MIXTE: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'MIXTE',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      ),
      PRODUCTION: calculator.calculateScenarioWithHTConfig(
        currentProject,
        'PRODUCTION',
        currentProject.foisonnementCharges,
        currentProject.foisonnementProductions,
        currentProject.manualPhaseDistribution,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      ),
      FORCÉ: (() => {
        // Pour le mode FORCÉ, utiliser la simulation avec convergence
        if (currentProject.forcedModeConfig) {
          try {
            const simCalculator = new SimulationCalculator(
              currentProject.cosPhi,
              currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95,
              currentProject.cosPhiProductions ?? 1.00
            );
            const simResult = simCalculator.calculateWithSimulation(
              currentProject,
              'FORCÉ',
              { srg2Devices: [], neutralCompensators: [], cableUpgrades: [] }
            );
            return simResult.baselineResult || simResult;
          } catch (error) {
            console.error('Erreur simulation mode FORCÉ:', error);
            // Fallback vers calcul standard
            return calculator.calculateScenarioWithHTConfig(
              currentProject,
              'FORCÉ',
              currentProject.foisonnementCharges,
              currentProject.foisonnementProductions,
              currentProject.manualPhaseDistribution,
              currentProject.clientsImportes || [],
              currentProject.clientLinks || []
            );
          }
        } else {
          return calculator.calculateScenarioWithHTConfig(
            currentProject,
            'FORCÉ',
            currentProject.foisonnementCharges,
            currentProject.foisonnementProductions,
            currentProject.manualPhaseDistribution,
            currentProject.clientsImportes || [],
            currentProject.clientLinks || []
          );
        }
      })()
    };

    set({ calculationResults: results });
  },

  validateConnectionType: (connectionType, voltageSystem) => {
    const validCombinations = {
      'TRIPHASÉ_230V': ['MONO_230V_PP', 'TRI_230V_3F'],
      'TÉTRAPHASÉ_400V': ['MONO_230V_PN', 'TÉTRA_3P+N_230_400V']
    };
    
    return validCombinations[voltageSystem].includes(connectionType);
  },

  setShowVoltages: (show) => set({ showVoltages: show }),

  changeVoltageSystem: () => {
    const { currentProject, updateAllCalculations, simulationEquipment, rebalanceAllMonoClients } = get();
    if (!currentProject) return;

    const newVoltageSystem: VoltageSystem = 
      currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 'TÉTRAPHASÉ_400V' : 'TRIPHASÉ_230V';
    
    const newNominal = newVoltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
    const is400V = newVoltageSystem === 'TÉTRAPHASÉ_400V';

    const updatedNodes = currentProject.nodes.map(node => ({
      ...node,
      connectionType: mapConnectionTypeForVoltageSystem(node.connectionType, newVoltageSystem, !!node.isSource),
      tensionCible: node.isSource ? undefined : node.tensionCible,
    }));

    const updatedTransformer: TransformerConfig = {
      ...(currentProject.transformerConfig || createDefaultTransformerConfig(newVoltageSystem)),
      nominalVoltage_V: newNominal,
      sourceVoltage: newNominal,
    };

    // Adapter les SRG2 selon le nouveau système de tension
    const updatedSRG2Devices = (simulationEquipment.srg2Devices || []).map(srg2 => {
      const defaultConfig = is400V ? DEFAULT_SRG2_400_CONFIG : DEFAULT_SRG2_230_CONFIG;
      return {
        ...srg2,
        type: is400V ? 'SRG2-400' as const : 'SRG2-230' as const,
        seuilLO2_V: defaultConfig.seuilLO2_V!,
        seuilLO1_V: defaultConfig.seuilLO1_V!,
        seuilBO1_V: defaultConfig.seuilBO1_V!,
        seuilBO2_V: defaultConfig.seuilBO2_V!,
        coefficientLO2: defaultConfig.coefficientLO2!,
        coefficientLO1: defaultConfig.coefficientLO1!,
        coefficientBO1: defaultConfig.coefficientBO1!,
        coefficientBO2: defaultConfig.coefficientBO2!,
      };
    });

    // Désactiver les EQUI8 en 230V (pas de neutre en triphasé phase-phase)
    const updatedNeutralCompensators = simulationEquipment.neutralCompensators.map(comp => ({
      ...comp,
      enabled: is400V ? comp.enabled : false
    }));

    const updatedProject = {
      ...currentProject,
      voltageSystem: newVoltageSystem,
      nodes: updatedNodes,
      transformerConfig: updatedTransformer,
    };

    set({ 
      currentProject: updatedProject,
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: updatedSRG2Devices,
        neutralCompensators: updatedNeutralCompensators
      }
    });

    // Rééquilibrage automatique des clients MONO
    if (currentProject.loadModel === 'mixte_mono_poly') {
      rebalanceAllMonoClients();
      toast.success(`Rééquilibrage MONO automatique effectué pour le réseau ${newVoltageSystem === 'TRIPHASÉ_230V' ? '230V' : '400V'}`);
    }

    // Recalcul automatique
    updateAllCalculations();
    
    // Relancer la simulation si des équipements sont actifs
    const hasActiveEquipment = updatedSRG2Devices.some(s => s.enabled) || 
                               updatedNeutralCompensators.some(c => c.enabled);
    if (hasActiveEquipment) {
      get().runSimulation();
    }
    
    // Toast informatif
    const srg2Count = updatedSRG2Devices.length;
    const equi8Count = updatedNeutralCompensators.length;
    
    if (srg2Count > 0 || equi8Count > 0) {
      const messages: string[] = [];
      if (srg2Count > 0) {
        messages.push(`${srg2Count} SRG2 adapté(s) en ${is400V ? 'SRG2-400' : 'SRG2-230'}`);
      }
      if (equi8Count > 0 && !is400V) {
        messages.push(`${equi8Count} EQUI8 désactivé(s) (pas de neutre en 230V)`);
      }
      toast.info(messages.join(' | '));
    }
  },

  setFoisonnementCharges: (value: number) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const updatedProject = {
      ...currentProject,
      foisonnementCharges: Math.max(0, Math.min(100, value))
    };
    
    set({ currentProject: updatedProject });
    
    // Recalculer après mise à jour du state
    get().updateAllCalculations();

    // Si mode simulation actif avec équipements actifs, recalculer aussi la simulation
    const { simulationMode, simulationEquipment } = get();
    const hasActiveEquipment = simulationMode && (
      (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
      simulationEquipment.neutralCompensators.some(c => c.enabled)
    );

    if (hasActiveEquipment) {
      get().runSimulation();
    }
  },

  setFoisonnementChargesResidentiel: (value: number) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const updatedProject = {
      ...currentProject,
      foisonnementChargesResidentiel: Math.max(0, Math.min(100, value))
    };
    
    set({ currentProject: updatedProject });
    get().updateAllCalculations();

    const { simulationMode, simulationEquipment } = get();
    const hasActiveEquipment = simulationMode && (
      (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
      simulationEquipment.neutralCompensators.some(c => c.enabled)
    );

    if (hasActiveEquipment) {
      get().runSimulation();
    }
  },

  setFoisonnementChargesIndustriel: (value: number) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const updatedProject = {
      ...currentProject,
      foisonnementChargesIndustriel: Math.max(0, Math.min(100, value))
    };
    
    set({ currentProject: updatedProject });
    get().updateAllCalculations();

    const { simulationMode, simulationEquipment } = get();
    const hasActiveEquipment = simulationMode && (
      (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
      simulationEquipment.neutralCompensators.some(c => c.enabled)
    );

    if (hasActiveEquipment) {
      get().runSimulation();
    }
  },

  setFoisonnementProductions: (value: number) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const updatedProject = {
      ...currentProject,
      foisonnementProductions: Math.max(0, Math.min(100, value))
    };
    
    set({ currentProject: updatedProject });
    
    // Recalculer après mise à jour du state
    get().updateAllCalculations();

    // Si mode simulation actif avec équipements actifs, recalculer aussi la simulation
    const { simulationMode, simulationEquipment } = get();
    const hasActiveEquipment = simulationMode && (
      (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
      simulationEquipment.neutralCompensators.some(c => c.enabled)
    );

    if (hasActiveEquipment) {
      get().runSimulation();
    }
  },

  calculateWithTargetVoltage: (nodeId: string, targetVoltage: number) => {
    const { currentProject, selectedScenario } = get();
    if (!currentProject) return;

    const calculator = new ElectricalCalculator(
      currentProject.cosPhi,
      currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95,
      currentProject.cosPhiProductions ?? 1.00
    );
    let bestFoisonnement = 100;
    let bestVoltage = 0;
    let minDiff = Infinity;

    // Dichotomie pour trouver le foisonnement optimal
    let low = 0;
    let high = 100;
    
    for (let iteration = 0; iteration < 20; iteration++) {
      const testFoisonnement = (low + high) / 2;
      
      // Créer un projet temporaire avec ce foisonnement
      const tempProject = {
        ...currentProject,
        foisonnementCharges: testFoisonnement,
        foisonnementProductions: 0 // Ignorer les productions pour tension cible
      };

      const result = calculator.calculateScenarioWithHTConfig(
        tempProject,
        selectedScenario,
        testFoisonnement,
        0, // Ignorer les productions pour tension cible
        tempProject.manualPhaseDistribution
      );

      const nodeData = result.nodeVoltageDrops?.find(n => n.nodeId === nodeId);
      if (!nodeData) break;

      // Calculer la tension du nœud
      let baseVoltage = 230;
      const node = tempProject.nodes.find(n => n.id === nodeId);
      if (node?.connectionType === 'TÉTRA_3P+N_230_400V') {
        baseVoltage = 400;
      }
      
      const actualVoltage = baseVoltage - nodeData.deltaU_cum_V;
      const diff = Math.abs(actualVoltage - targetVoltage);
      
      if (diff < minDiff) {
        minDiff = diff;
        bestFoisonnement = testFoisonnement;
        bestVoltage = actualVoltage;
      }

      if (actualVoltage < targetVoltage) {
        // Tension trop basse → réduire le foisonnement → chercher dans la partie basse
        high = testFoisonnement;
      } else {
        // Tension trop haute → augmenter le foisonnement → chercher dans la partie haute
        low = testFoisonnement;
      }

      if (high - low < 0.1) break;
    }

    // Appliquer le meilleur foisonnement trouvé
    set({
      currentProject: {
        ...currentProject,
        foisonnementCharges: Math.round(bestFoisonnement * 10) / 10,
        foisonnementProductions: 0
      }
    });

    // Recalculer
    get().calculateAll();
    
    toast.success(`Foisonnement ajusté automatiquement à ${Math.round(bestFoisonnement * 10) / 10}% pour atteindre la tension cible`);
  },

  updateCableTypes: () => {
    const { currentProject } = get();
    if (!currentProject) return;
    
    set({
      currentProject: {
        ...currentProject,
        cableTypes: [...defaultCableTypes]
      }
    });
    
    console.log('Cable types updated to:', defaultCableTypes.length, 'types');
    toast.success('Types de câbles mis à jour avec succès');
  },

  // Actions de simulation
  toggleSimulationMode: () => {
    const { simulationMode, simulationEquipment } = get();
    const newSimulationMode = !simulationMode;
    
    set({ 
      simulationMode: newSimulationMode,
      selectedTool: newSimulationMode ? 'simulation' : 'select',
      // Réinitialiser les résultats de simulation quand on quitte le mode simulation
      simulationResults: newSimulationMode ? get().simulationResults : {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      },
      // Désactiver tous les équipements de simulation quand on quitte le mode simulation
      simulationEquipment: newSimulationMode ? simulationEquipment : {
        srg2Devices: simulationEquipment.srg2Devices?.map(s => ({ ...s, enabled: false })) || [],
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => ({ ...c, enabled: false })),
        cableUpgrades: simulationEquipment.cableUpgrades
      }
    });
  },

  toggleSimulationActive: () => {
    const { isSimulationActive, simulationEquipment } = get();
    const newActiveState = !isSimulationActive;
    
    // Désactiver/activer tous les équipements SRG2, EQUI8 et cable replacement
    set({ 
      isSimulationActive: newActiveState,
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: simulationEquipment.srg2Devices?.map(s => ({ ...s, enabled: newActiveState })) || [],
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => ({ ...c, enabled: newActiveState })),
        cableReplacement: simulationEquipment.cableReplacement 
          ? { ...simulationEquipment.cableReplacement, enabled: newActiveState }
          : undefined
      }
    });
    
    // Recalculer après changement
    if (newActiveState) {
      get().runSimulation();
    }
  },

  // Méthodes SRG2
  addSRG2Device: (nodeId: string) => {
    const state = get();
    if (!state.currentProject) return;
    
    // Vérifier que le nœud existe
    const nodeIndex = state.currentProject.nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) {
      toast.error(`Nœud ${nodeId} introuvable`);
      return;
    }
    
    // ✅ CORRECTION : Marquer le nœud comme ayant un SRG2
    const updatedNodes = state.currentProject.nodes.map((n, idx) => 
      idx === nodeIndex ? { ...n, hasSRG2Device: true } : n
    );
    
    console.log(`[DEBUG] addSRG2Device: Marquage nœud ${nodeId} avec hasSRG2Device=true`);
    
    // Déterminer le type de SRG2 selon le système de tension
    const is400V = state.currentProject.voltageSystem === 'TÉTRAPHASÉ_400V';
    const defaultConfig = is400V ? DEFAULT_SRG2_400_CONFIG : DEFAULT_SRG2_230_CONFIG;
    
    const newSRG2: SRG2Config = {
      id: `srg2-${Date.now()}`,
      nodeId,
      name: `SRG2-${state.simulationEquipment.srg2Devices.length + 1}`,
      enabled: true,
      ...defaultConfig
    } as SRG2Config;

    set({
      currentProject: {
        ...state.currentProject,
        nodes: updatedNodes
      },
      simulationEquipment: {
        ...state.simulationEquipment,
        srg2Devices: [...(state.simulationEquipment.srg2Devices || []), newSRG2]
      }
    });
    
    toast.success(`SRG2 ${newSRG2.name} ajouté`);
    
    // Recalculer d'abord les calculs standard puis la simulation
    get().updateAllCalculations();
    get().runSimulation();
  },

  removeSRG2Device: (srg2Id: string) => {
    const { simulationEquipment, currentProject } = get();
    const srg2 = simulationEquipment.srg2Devices?.find(s => s.id === srg2Id);
    
    if (!currentProject || !srg2) return;
    
    // ✅ CORRECTION : Retirer le flag du nœud
    const updatedNodes = currentProject.nodes.map(n => 
      n.id === srg2.nodeId ? { ...n, hasSRG2Device: false } : n
    );
    
    console.log(`[DEBUG] removeSRG2Device: Retrait flag hasSRG2Device du nœud ${srg2.nodeId}`);
    
    set({
      currentProject: {
        ...currentProject,
        nodes: updatedNodes
      },
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: (simulationEquipment.srg2Devices || []).filter(s => s.id !== srg2Id)
      }
    });
    
    toast.success(`SRG2 ${srg2?.name} supprimé`);
    get().updateAllCalculations();
    get().runSimulation();
  },

  updateSRG2Device: (srg2Id: string, updates: Partial<SRG2Config>) => {
    const { simulationEquipment, simulationMode } = get();
    
    set({
      simulationEquipment: {
        ...simulationEquipment,
        srg2Devices: (simulationEquipment.srg2Devices || []).map(s => 
          s.id === srg2Id ? { ...s, ...updates } : s
        )
      }
    });

    // Recalculer si modification pertinente
    if (typeof updates.enabled !== 'undefined' || updates.tensionConsigne_V || updates.puissanceMaxInjection_kVA) {
      if (updates.enabled === true && !simulationMode) {
        set({ simulationMode: true, selectedTool: 'simulation' });
      }
      get().runSimulation();
    } else if (simulationMode) {
      get().runSimulation();
    }
  },
  
  addNeutralCompensator: (nodeId: string) => {
    const { simulationEquipment, currentProject } = get();
    if (!currentProject) return;
    
    // Vérifier qu'il n'y a pas déjà un compensateur sur ce nœud
    const existingCompensator = simulationEquipment.neutralCompensators.find(c => c.nodeId === nodeId);
    if (existingCompensator) {
      toast.error('Un compensateur de neutre existe déjà sur ce nœud');
      return;
    }
    
    // Récupérer le nœud concerné
    const node = currentProject.nodes.find(n => n.id === nodeId);
    if (!node) {
      toast.error('Nœud introuvable');
      return;
    }
    
    // Vérifier les conditions d'éligibilité
    const is400V = currentProject.voltageSystem === 'TÉTRAPHASÉ_400V';
    
    // Déséquilibre réel basé sur clients MONO ou curseurs manuels
    const hasRealUnbalance = (node.autoPhaseDistribution?.unbalancePercent ?? 0) > 0;
    const manualCharges = currentProject.manualPhaseDistribution?.charges;
    const hasManualUnbalance = manualCharges && (
      Math.abs(manualCharges.A - 33.33) > 0.1 ||
      Math.abs(manualCharges.B - 33.33) > 0.1 ||
      Math.abs(manualCharges.C - 33.33) > 0.1
    );
    const hasDeseq = hasRealUnbalance || hasManualUnbalance;
    
    // EQUI8 éligible = réseau 400V + déséquilibre détecté (peu importe le type de nœud)
    const eligible = is400V && hasDeseq;
    
    // Créer le nouveau compensateur
    const newCompensator: NeutralCompensator = {
      id: `compensator-${nodeId}-${Date.now()}`,
      nodeId,
      maxPower_kVA: 30,
      tolerance_A: 5,
      enabled: eligible, // Actif uniquement si toutes les conditions sont remplies
      Zph_Ohm: 0.5,  // Impédance câble phase (modèle EQUI8)
      Zn_Ohm: 0.2    // Impédance câble neutre (modèle EQUI8)
    };

    set({
      simulationEquipment: {
        ...simulationEquipment,
        neutralCompensators: [...simulationEquipment.neutralCompensators, newCompensator]
      }
    });
    
    // Message adapté selon l'éligibilité
    if (eligible) {
      toast.success(`Compensateur EQUI8 ajouté sur ${node.name}`);
    } else {
      const reasons = [];
      if (!is400V) reasons.push('Réseau doit être 400V');
      if (!hasDeseq) reasons.push('Déséquilibre requis (clients MONO ou curseurs)');
      
      toast.warning(
        `Compensateur EQUI8 ajouté sur ${node.name} mais inactif`,
        { 
          description: reasons.join('. ')
        }
      );
    }
    
    // Recalculer automatiquement la simulation
    get().runSimulation();
  },

  removeNeutralCompensator: (compensatorId: string) => {
    const { simulationEquipment } = get();
    set({
      simulationEquipment: {
        ...simulationEquipment,
        neutralCompensators: simulationEquipment.neutralCompensators.filter(c => c.id !== compensatorId)
      }
    });
    toast.success('Compensateur de neutre supprimé');
  },

  updateNeutralCompensator: (compensatorId: string, updates: Partial<NeutralCompensator>) => {
    const { simulationEquipment, simulationMode, currentProject } = get();
    
    // ✅ Si on change le nodeId, gérer le transfert des equi8_ids
    if (updates.nodeId && currentProject) {
      const compensator = simulationEquipment.neutralCompensators.find(c => c.id === compensatorId);
      if (compensator && compensator.nodeId !== updates.nodeId) {
        const oldNodeId = compensator.nodeId;
        const newNodeId = updates.nodeId;
        
        // Mettre à jour les nœuds pour transférer l'equi8_id
        const updatedNodes = currentProject.nodes.map(n => {
          if (n.id === oldNodeId) {
            // Retirer l'EQUI8 de l'ancien nœud
            return {
              ...n,
              equi8_ids: (n.equi8_ids || []).filter(id => id !== compensatorId)
            };
          }
          if (n.id === newNodeId) {
            // Ajouter l'EQUI8 au nouveau nœud
            return {
              ...n,
              equi8_ids: [...(n.equi8_ids || []), compensatorId]
            };
          }
          return n;
        });
        
        set({
          currentProject: {
            ...currentProject,
            nodes: updatedNodes
          }
        });
        
        console.log(`🔄 EQUI8 ${compensatorId} déplacé: ${oldNodeId} → ${newNodeId}`);
        toast.info(`Compensateur EQUI8 déplacé vers ${currentProject.nodes.find(n => n.id === newNodeId)?.name || newNodeId}`);
      }
    }
    
    set({
      simulationEquipment: {
        ...simulationEquipment,
        neutralCompensators: simulationEquipment.neutralCompensators.map(c => 
          c.id === compensatorId ? { ...c, ...updates } : c
        )
      }
    });

    // Déclencher le calcul de simulation lors de la (ré)activation ou de toute mise à jour pertinente
    if (typeof updates.enabled !== 'undefined' || updates.nodeId) {
      if ((updates.enabled === true || updates.nodeId) && !simulationMode) {
        set({ simulationMode: true, selectedTool: 'simulation' });
      }
      get().runSimulation();
    } else if (simulationMode) {
      // Si on est déjà en mode simulation, recalculer sur tout autre paramètre
      get().runSimulation();
    }
  },

  proposeCableUpgrades: (threshold?: number) => {
    const { currentProject, calculationResults, selectedScenario, simulationEquipment } = get();
    if (!currentProject || !calculationResults[selectedScenario]) return;

    const result = calculationResults[selectedScenario]!;
    
    // Utiliser le SimulationCalculator pour proposer des améliorations basées sur la chute de tension
    const calculator = new SimulationCalculator(
      currentProject.cosPhi,
      currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95,
      currentProject.cosPhiProductions ?? 1.00
    );
    
    // Optimisation par circuit en un seul passage avec seuil paramétrable (par défaut 8%)
    const upgrades = calculator.proposeFullCircuitReinforcement(
      currentProject.cables,
      defaultCableTypes,
      threshold ?? 8.0 // Seuil paramétrable pour la chute de tension
    );

    set({
      simulationEquipment: {
        ...simulationEquipment,
        cableUpgrades: upgrades
      }
    });
    
    toast.success(`${upgrades.length} améliorations proposées (seuil: ${threshold ?? 8}%)`);
  },

  toggleCableUpgrade: (upgradeId: string) => {
    const { simulationEquipment } = get();
    // Pour la version simplifiée, nous considérons que les upgrades sont des objets avec enabled
    // Dans une version complète, il faudrait gérer l'état enabled des upgrades
    toast.info('Fonctionnalité en cours de développement');
  },

  setCableReplacementConfig: (config: CableReplacementConfig | null) => {
    const { simulationEquipment } = get();
    
    set({
      simulationEquipment: {
        ...simulationEquipment,
        cableReplacement: config || undefined
      },
      // Activer automatiquement isSimulationActive quand une config de remplacement est définie
      isSimulationActive: config?.enabled ?? get().isSimulationActive
    });
    
    if (config) {
      toast.success(`Simulation de remplacement configurée: ${config.affectedCableIds.length} câble(s)`);
    } else {
      // Vérifier s'il reste d'autres équipements actifs, sinon désactiver isSimulationActive
      const otherActiveEquipment = 
        (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
        simulationEquipment.neutralCompensators.some(c => c.enabled);
      
      if (!otherActiveEquipment) {
        set({ isSimulationActive: false });
      }
      toast.info('Simulation de remplacement annulée');
    }
  },

  runSimulation: () => {
    const { currentProject, selectedScenario, simulationEquipment, calculationResults } = get();
    if (!currentProject) return;

    try {
      const calculator = new SimulationCalculator(
        currentProject.cosPhi,
        currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95,
        currentProject.cosPhiProductions ?? 1.00
      );
      
      // Calculer pour chaque scénario avec équipements de simulation
      const newSimulationResults: { [key in CalculationScenario]: any } = {
        PRÉLÈVEMENT: null,
        MIXTE: null,
        PRODUCTION: null,
        FORCÉ: null
      };
      
      const scenarios: CalculationScenario[] = ['PRÉLÈVEMENT', 'MIXTE', 'PRODUCTION', 'FORCÉ'];
      
      for (const scenario of scenarios) {
        try {
          // Passer calculationResults pour lecture directe des tensions naturelles (cohérence avec affichage)
          const result = calculator.calculateWithSimulation(
            currentProject,
            scenario,
            simulationEquipment,
            calculationResults
          );
          newSimulationResults[scenario] = result;
        } catch (error) {
          console.error(`Erreur calcul simulation ${scenario}:`, error);
        }
      }
      
      // Mettre à jour l'état avec les résultats de simulation
      set({ simulationResults: newSimulationResults });
      
      const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                                   simulationEquipment.neutralCompensators.filter(c => c.enabled).length +
                                   (simulationEquipment.cableReplacement?.enabled ? 1 : 0);
      
      toast.success(`Simulation recalculée avec ${activeEquipmentCount} équipement(s) actif(s)`);
    } catch (error) {
      console.error('Erreur lors de la simulation:', error);
      toast.error('Erreur lors du calcul de simulation');
    }
  },

  // Actions de preview de simulation
  updateSimulationPreview: (preview) => {
    set(state => ({
      simulationPreview: {
        ...state.simulationPreview,
        ...preview,
        isActive: true
      }
    }));
  },

  clearSimulationPreview: () => {
    set({
      simulationPreview: {
        isActive: false
      }
    });
  },

  toggleResultsPanel: () => set(state => ({ resultsPanelOpen: !state.resultsPanelOpen })),
  toggleResultsPanelFullscreen: () => {
    const currentState = get().resultsPanelFullscreen;
    set(state => ({ resultsPanelFullscreen: !state.resultsPanelFullscreen }));
    
    // Si on passe de plein écran (true) à normal (false), recentrer la carte
    if (currentState === true) {
      // Dispatch l'événement zoomToProject avec un léger délai pour laisser le DOM se mettre à jour
      setTimeout(() => {
        const project = get().currentProject;
        if (project?.geographicBounds) {
          window.dispatchEvent(new CustomEvent('zoomToProject', { 
            detail: project.geographicBounds 
          }));
        }
      }, 100);
    }
  },
  toggleFocusMode: () => set(state => ({ 
    focusMode: !state.focusMode,
    resultsPanelOpen: !state.focusMode ? false : state.resultsPanelOpen
  })),

  toggleClientTensionLabels: () => set(state => ({ 
    showClientTensionLabels: !state.showClientTensionLabels 
  })),

  setClientColorMode: (mode) => set({ clientColorMode: mode }),

  generateCircuitColorMapping: () => {
    const state = get();
    const clients = state.currentProject?.clientsImportes || [];
    
    // Extraire les circuits uniques
    const uniqueCircuits = Array.from(
      new Set(clients.map(c => c.identifiantCircuit))
    ).filter(Boolean);
    
    // Palette de 6 couleurs distinctes
    const colorPalette = [
      '#ef4444', // Rouge
      '#3b82f6', // Bleu
      '#22c55e', // Vert
      '#f59e0b', // Orange
      '#8b5cf6', // Violet
      '#ec4899', // Rose
    ];
    
    // Créer le mapping
    const mapping = new Map<string, string>();
    uniqueCircuits.forEach((circuit, index) => {
      if (index < 6) {
        mapping.set(circuit, colorPalette[index]);
      } else {
        console.warn(`Plus de 6 circuits détectés. Le circuit "${circuit}" réutilise une couleur.`);
        mapping.set(circuit, colorPalette[index % 6]);
      }
    });
    
    set({ circuitColorMapping: mapping });
  },

  // Actions pour la création de client avec sélection sur carte
  startClientLocationSelection: () => {
    console.log('[DEBUG Store] startClientLocationSelection');
    set({ selectingLocationForNewClient: true, pendingClientLocation: null });
  },
  
  setClientLocation: (lat: number, lng: number) => {
    console.log('[DEBUG Store] setClientLocation:', lat, lng);
    set({ selectingLocationForNewClient: false, pendingClientLocation: { lat, lng } });
  },
  
  cancelClientLocationSelection: () => {
    console.log('[DEBUG Store] cancelClientLocationSelection');
    set({ selectingLocationForNewClient: false });
  },
  
  clearPendingClientLocation: () => {
    set({ pendingClientLocation: null });
  },

  // Actions pour le mode création de client
  startClientCreation: () => {
    console.log('[DEBUG Store] startClientCreation - Ouverture panneau en mode création');
    set({ 
      isCreatingClient: true,
      selectedClientId: null,
      editPanelOpen: true,
      editTarget: 'client'
    });
  },

  cancelClientCreation: () => {
    console.log('[DEBUG Store] cancelClientCreation');
    set({ 
      isCreatingClient: false,
      editPanelOpen: false,
      editTarget: null
    });
  },

  // Actions profil 24h
  setDailyProfileOptions: (options) => {
    set(state => ({
      dailyProfileOptions: { ...state.dailyProfileOptions, ...options }
    }));
  },

  setDailyProfileCustomProfiles: (profiles) => {
    set({ dailyProfileCustomProfiles: profiles });
  },

  // Actions profil mesuré
  setMeasuredProfile: (profile, metadata) => {
    set({ 
      measuredProfile: profile, 
      measuredProfileMetadata: metadata 
    });
  },

  clearMeasuredProfile: () => {
    set({ 
      measuredProfile: null, 
      measuredProfileMetadata: null,
      dailyProfileOptions: { ...get().dailyProfileOptions, useMeasuredProfile: false }
    });
  },

  // Actions de sélection de nœud sur la carte (centralisé)
  startNodeSelection: (mode) => {
    console.log('🗺️ Démarrage sélection nœud, mode:', mode);
    set({ nodeSelectionMode: mode });
  },

  cancelNodeSelection: () => {
    console.log('🗺️ Annulation sélection nœud');
    set({ nodeSelectionMode: null });
  },

  handleNodeSelectionClick: (nodeId) => {
    const { nodeSelectionMode, addSRG2Device, addNeutralCompensator, simulationEquipment } = get();
    console.log('🗺️ Nœud cliqué en mode sélection:', nodeId, 'mode:', nodeSelectionMode);
    
    if (!nodeSelectionMode) return;

    switch (nodeSelectionMode) {
      case 'profil24h':
        set(state => ({
          dailyProfileOptions: { ...state.dailyProfileOptions, selectedNodeId: nodeId },
          nodeSelectionMode: null
        }));
        toast.success('Nœud sélectionné pour l\'analyse 24h');
        break;
        
      case 'srg2':
        // Vérifier si un SRG2 existe déjà sur ce nœud
        const existingSRG2 = simulationEquipment.srg2Devices?.some(s => s.nodeId === nodeId);
        if (existingSRG2) {
          toast.error('Un SRG2 existe déjà sur ce nœud');
        } else {
          addSRG2Device(nodeId);
          toast.success('SRG2 ajouté sur le nœud');
        }
        set({ nodeSelectionMode: null });
        break;
        
      case 'equi8':
        // Vérifier si un EQUI8 existe déjà sur ce nœud
        const existingEQUI8 = simulationEquipment.neutralCompensators.some(c => c.nodeId === nodeId);
        if (existingEQUI8) {
          toast.error('Un compensateur EQUI8 existe déjà sur ce nœud');
        } else {
          addNeutralCompensator(nodeId);
          toast.success('Compensateur EQUI8 ajouté sur le nœud');
        }
        set({ nodeSelectionMode: null });
        break;
    }
  },
  
  setSelectedBranchementCableId: (cableId) => set({ selectedBranchementCableId: cableId }),
  
  // Highlight profil 24H
  setDailyProfileHighlight: (nodeId, clientId) => set({ dailyProfileHighlightNodeId: nodeId, dailyProfileHighlightClientId: clientId }),
  
  // Actions de gestion de sauvegarde
  markAsDirty: () => set({ isDirty: true }),
  markAsSaved: () => set({ isDirty: false, lastSavedAt: new Date() }),
  setLastSavedAt: (date) => set({ lastSavedAt: date }),
  setLastAutoSaveAt: (date) => set({ lastAutoSaveAt: date }),
}));