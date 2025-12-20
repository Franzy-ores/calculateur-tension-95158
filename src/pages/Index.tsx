import { useState, useMemo } from "react";
import { TopMenu } from "@/components/TopMenu";
import { MapView } from "@/components/MapView";
import { Toolbar } from "@/components/Toolbar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { EditPanel } from "@/components/EditPanel";
import { ClientsPanel } from "@/components/ClientsPanel";
import { SimulationPanel } from "@/components/SimulationPanel";
import { ClientEditPanel } from "@/components/ClientEditPanel";
import { GlobalAlertPopup } from "@/components/GlobalAlertPopup";
import DebugConsole from "@/components/DebugConsole";
import { useNetworkStore } from "@/store/networkStore";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Users, X } from "lucide-react";

const Index = () => {
  const [clientsPanelOpen, setClientsPanelOpen] = useState(false);
  
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
  } = useNetworkStore();

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

  const handleNewNetwork = () => {
    createNewProject("Nouveau Réseau", "TÉTRAPHASÉ_400V");
    handleSettings(); // Ouvrir automatiquement les paramètres après création
  };

  const handleSave = () => {
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
    }
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            console.log('🔄 Début du chargement JSON...');
            const project = JSON.parse(e.target?.result as string);
            console.log('✅ JSON parsé:', project.name, 'nodes:', project.nodes?.length, 'cables:', project.cables?.length);
            loadProject(project);
            console.log('✅ Project loaded successfully:', project.name);
          } catch (error) {
            console.error('Error loading project:', error);
            alert('Erreur lors du chargement du projet. Vérifiez le format du fichier JSON.');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleSettings = () => {
    openEditPanel('project');
  };

  const handleSimulation = () => {
    console.log('🐛 handleSimulation called');
    openEditPanel('simulation');
  };

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
          onSimulation={handleSimulation}
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
        
        {/* Bouton pour ouvrir le panneau clients */}
        {currentProject?.clientsImportes && currentProject.clientsImportes.length > 0 && !focusMode && (
          <Button
            onClick={() => setClientsPanelOpen(true)}
            className="fixed right-20 top-20 z-20 shadow-lg"
            size="sm"
          >
            <Users className="h-4 w-4 mr-2" />
            Clients ({currentProject.clientsImportes.length})
          </Button>
        )}
      </div>

      {/* Alerte globale surcharge/injection */}
      {currentProject && transformerPower > 0 && (
        <GlobalAlertPopup
          transformerPower={transformerPower}
          foisonnedCharge={foisonnedCharge}
          foisonnedProduction={foisonnedProduction}
        />
      )}

      {/* Clients Panel - Sheet latéral */}
      <Sheet open={clientsPanelOpen} onOpenChange={setClientsPanelOpen} modal={false}>
        <SheetContent side="left" className="w-96 sm:max-w-96 overflow-hidden flex flex-col">
          <SheetHeader>
            <SheetTitle>Gestion des Clients</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden mt-4">
            <ClientsPanel />
          </div>
        </SheetContent>
      </Sheet>
      
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

      {/* Console de debug visuelle (pour iOS/mobile) */}
      <DebugConsole />
    </div>
  );
};

export default Index;
