import { useMemo, useState, useEffect, useCallback } from "react";
import { TopMenu } from "@/components/TopMenu";
import { MapView } from "@/components/MapView";
import { Toolbar } from "@/components/Toolbar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { EditPanel } from "@/components/EditPanel";
import { SimulationPanel } from "@/components/SimulationPanel";
import { ClientEditPanel } from "@/components/ClientEditPanel";
import { GlobalAlertPopup } from "@/components/GlobalAlertPopup";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { RecoveryDialog } from "@/components/RecoveryDialog";
import DebugConsole from "@/components/DebugConsole";
import { useNetworkStore } from "@/store/networkStore";
import { useProjectPersistence } from "@/hooks/useProjectPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const Index = () => {
  
  const { 
    currentProject, 
    calculationResults,
    simulationResults,
    simulationEquipment,
    selectedScenario,
    createNewProject,
    loadProject,
    openEditPanel,
    closeEditPanel,
    editTarget,
    resultsPanelOpen,
    resultsPanelFullscreen,
    focusMode,
    isSimulationActive,
    isDirty,
    markAsSaved,
  } = useNetworkStore();

  // Hooks de persistance
  const { saveDraft, recoverDraft, clearDraft, hasDraft, draftInfo } = useProjectPersistence();
  useUnsavedChangesGuard();

  // États pour les dialogues
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'new' | 'load' | null>(null);
  const [pendingLoadFile, setPendingLoadFile] = useState<File | null>(null);

  // Afficher le dialogue de récupération au démarrage si brouillon détecté
  useEffect(() => {
    if (hasDraft && draftInfo) {
      setShowRecoveryDialog(true);
    }
  }, [hasDraft, draftInfo]);

  // Déterminer quels résultats utiliser - simulation si équipements actifs ET isSimulationActive, sinon calculs normaux
  const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                               simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
  
  const resultsToUse = (isSimulationActive && activeEquipmentCount > 0) ? simulationResults : calculationResults;

  // Calcul des charges et productions foisonnées pour l'alerte globale
  const { foisonnedCharge, foisonnedProduction, transformerPower } = useMemo(() => {
    if (!currentProject) {
      return { foisonnedCharge: 0, foisonnedProduction: 0, transformerPower: 0 };
    }
    
    // Somme des charges et productions de TOUS les clients importés
    let totalChargeContractuelle = 0;
    let totalProductionContractuelle = 0;
    
    currentProject.clientsImportes?.forEach(client => {
      totalChargeContractuelle += client.puissanceContractuelle_kVA || 0;
      totalProductionContractuelle += client.puissancePV_kVA || 0;
    });
    
    // Application des coefficients de foisonnement (stockés en %, ex: 100 = 100%)
    const foisonnementCharges = currentProject.foisonnementCharges ?? 100;
    const foisonnementProductions = currentProject.foisonnementProductions ?? 100;
    
    return {
      foisonnedCharge: totalChargeContractuelle * (foisonnementCharges / 100),
      foisonnedProduction: totalProductionContractuelle * (foisonnementProductions / 100),
      transformerPower: currentProject.transformerConfig?.nominalPower_kVA || 0
    };
  }, [currentProject]);

  // Fonction de sauvegarde
  const performSave = useCallback(() => {
    if (currentProject) {
      // Récupérer les équipements de simulation depuis le store
      const { simulationEquipment } = useNetworkStore.getState();
      
      // Calculer et inclure les bounds géographiques avant la sauvegarde
      const projectToSave = { 
        ...currentProject,
        simulationEquipment // Inclure les équipements de simulation
      };
      if (projectToSave.nodes.length > 0) {
        // Calculer les bounds géographiques
        const lats = projectToSave.nodes.map(n => n.lat);
        const lngs = projectToSave.nodes.map(n => n.lng);
        
        const north = Math.max(...lats);
        const south = Math.min(...lats);
        const east = Math.max(...lngs);
        const west = Math.min(...lngs);
        
        const center = {
          lat: (north + south) / 2,
          lng: (east + west) / 2
        };
        
        // Calculer un zoom approprié
        const latDiff = north - south;
        const lngDiff = east - west;
        const maxDiff = Math.max(latDiff, lngDiff);
        
        let zoom = 15;
        if (maxDiff > 0.1) zoom = 10;
        else if (maxDiff > 0.05) zoom = 12;
        else if (maxDiff > 0.01) zoom = 14;
        else if (maxDiff > 0.005) zoom = 15;
        else zoom = 16;
        
        projectToSave.geographicBounds = {
          north,
          south,
          east,
          west,
          center,
          zoom
        };
      }
      
      const dataStr = JSON.stringify(projectToSave, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentProject.name}.json`;
      link.click();
      URL.revokeObjectURL(url);
      
      // Marquer comme sauvé et supprimer le brouillon
      markAsSaved();
      clearDraft();
    }
  }, [currentProject, markAsSaved, clearDraft]);

  // Fonction pour charger un fichier
  const performLoad = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        console.log('🔄 Début du chargement JSON...');
        const project = JSON.parse(e.target?.result as string);
        console.log('✅ JSON parsé:', project.name, 'nodes:', project.nodes?.length, 'cables:', project.cables?.length);
        loadProject(project);
        clearDraft(); // Supprimer le brouillon après chargement
        console.log('✅ Project loaded successfully:', project.name);
      } catch (error) {
        console.error('Error loading project:', error);
        alert('Erreur lors du chargement du projet. Vérifiez le format du fichier JSON.');
      }
    };
    reader.readAsText(file);
  }, [loadProject, clearDraft]);

  // Gestionnaire nouveau réseau
  const handleNewNetwork = useCallback(() => {
    if (isDirty) {
      setPendingAction('new');
      setShowUnsavedDialog(true);
    } else {
      createNewProject("Nouveau Réseau", "TÉTRAPHASÉ_400V");
      openEditPanel('project');
      clearDraft();
    }
  }, [isDirty, createNewProject, openEditPanel, clearDraft]);

  // Gestionnaire sauvegarde
  const handleSave = useCallback(() => {
    performSave();
  }, [performSave]);

  // Gestionnaire chargement
  const handleLoad = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        if (isDirty) {
          setPendingLoadFile(file);
          setPendingAction('load');
          setShowUnsavedDialog(true);
        } else {
          performLoad(file);
        }
      }
    };
    input.click();
  }, [isDirty, performLoad]);

  const handleSettings = () => {
    openEditPanel('project');
  };

  const handleSimulation = () => {
    console.log('🐛 handleSimulation called');
    openEditPanel('simulation');
  };

  // Gestionnaires pour le dialogue de modifications non sauvées
  const handleUnsavedSave = useCallback(() => {
    performSave();
    // Exécuter l'action en attente après sauvegarde
    if (pendingAction === 'new') {
      createNewProject("Nouveau Réseau", "TÉTRAPHASÉ_400V");
      openEditPanel('project');
    } else if (pendingAction === 'load' && pendingLoadFile) {
      performLoad(pendingLoadFile);
    }
    setPendingAction(null);
    setPendingLoadFile(null);
  }, [performSave, pendingAction, pendingLoadFile, createNewProject, openEditPanel, performLoad]);

  const handleUnsavedDiscard = useCallback(() => {
    // Exécuter l'action sans sauvegarder
    if (pendingAction === 'new') {
      createNewProject("Nouveau Réseau", "TÉTRAPHASÉ_400V");
      openEditPanel('project');
      clearDraft();
    } else if (pendingAction === 'load' && pendingLoadFile) {
      performLoad(pendingLoadFile);
    }
    setPendingAction(null);
    setPendingLoadFile(null);
  }, [pendingAction, pendingLoadFile, createNewProject, openEditPanel, performLoad, clearDraft]);

  const handleUnsavedCancel = useCallback(() => {
    setPendingAction(null);
    setPendingLoadFile(null);
  }, []);

  // Gestionnaires pour le dialogue de récupération
  const handleRecover = useCallback(() => {
    const draft = recoverDraft();
    if (draft) {
      loadProject(draft.project);
      if (draft.simulationEquipment) {
        // Restaurer les équipements de simulation si présents
        const store = useNetworkStore.getState();
        store.simulationEquipment.srg2Devices = draft.simulationEquipment.srg2Devices || [];
        store.simulationEquipment.neutralCompensators = draft.simulationEquipment.neutralCompensators || [];
        store.simulationEquipment.cableUpgrades = draft.simulationEquipment.cableUpgrades || [];
      }
      clearDraft();
    }
  }, [recoverDraft, loadProject, clearDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  // Déterminer si on doit afficher le ResultsPanel
  const shouldShowResults = resultsPanelOpen && editTarget !== 'simulation' && !focusMode;

  return (
    <div className="h-screen flex flex-col bg-background">
      {!focusMode && (
        <TopMenu 
          onNewNetwork={handleNewNetwork}
          onSave={handleSave}
          onLoad={handleLoad}
          onSettings={handleSettings}
        />
      )}
      
      <div className="flex-1 flex relative">
        {!resultsPanelFullscreen && <Toolbar />}
        {!resultsPanelFullscreen && <MapView />}
        <ResultsPanel
          results={resultsToUse}
          selectedScenario={selectedScenario}
          isCollapsed={!shouldShowResults}
        />
        
      </div>

      {/* Alerte globale surcharge/injection */}
      {currentProject && transformerPower > 0 && (
        <GlobalAlertPopup
          transformerPower={transformerPower}
          foisonnedCharge={foisonnedCharge}
          foisonnedProduction={foisonnedProduction}
        />
      )}
      
      <EditPanel />

      {/* Client Edit Panel - Panneau fixe non-modal pour permettre l'interaction avec la carte */}
      {editTarget === 'client' && (
        <div className="fixed right-4 top-24 bottom-4 w-96 bg-background border border-border rounded-lg shadow-xl z-[500] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-semibold">Propriétés du Client</h2>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => closeEditPanel()}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <ClientEditPanel />
          </div>
        </div>
      )}

      {(() => {
        console.log('🐛 Current editTarget:', editTarget);
        console.log('🐛 editTarget === simulation:', editTarget === 'simulation');
        console.log('🐛 Should render SimulationPanel:', editTarget === 'simulation');
        return editTarget === 'simulation' ? <SimulationPanel /> : null;
      })()}

      {/* Dialogue de modifications non sauvées */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        onSave={handleUnsavedSave}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
        actionDescription={pendingAction === 'new' ? 'créer un nouveau projet' : 'charger un projet'}
      />

      {/* Dialogue de récupération au démarrage */}
      <RecoveryDialog
        open={showRecoveryDialog}
        onOpenChange={setShowRecoveryDialog}
        projectName={draftInfo?.name || 'Projet inconnu'}
        savedAt={draftInfo?.savedAt || new Date().toISOString()}
        onRecover={handleRecover}
        onDiscard={handleDiscardDraft}
      />

      {/* Console de debug visuelle (pour iOS/mobile) */}
      <DebugConsole />
    </div>
  );
};

export default Index;
