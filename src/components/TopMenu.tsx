import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState } from 'react';
import { FileText, Save, FolderOpen, Settings, Zap, FileDown, FileSpreadsheet } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PDFGenerator } from "@/utils/pdfGenerator";
import { PhaseDistributionDisplay } from "@/components/PhaseDistributionDisplay";
import { PhaseDistributionSliders } from "@/components/PhaseDistributionSliders";
import { toast } from "sonner";
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ExcelImporter } from '@/components/ExcelImporter';
import { calculateTotalPowersForNodes } from '@/utils/clientsUtils';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import type { LoadModel } from '@/types/network';
interface TopMenuProps {
  onNewNetwork: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
  onSimulation: () => void;
}
export const TopMenu = ({
  onNewNetwork,
  onSave,
  onLoad,
  onSettings,
  onSimulation
}: TopMenuProps) => {
  const [showImporter, setShowImporter] = useState(false);
  
  const {
    currentProject,
    showVoltages,
    setShowVoltages,
    selectedScenario,
    setSelectedScenario,
    changeVoltageSystem,
    calculationResults,
    simulationResults,
    updateCableTypes,
    updateProjectConfig,
    setFoisonnementCharges,
    setFoisonnementProductions,
    simulationPreview,
    editTarget,
    simulationEquipment,
    isSimulationActive,
    toggleSimulationActive,
    clientColorMode,
    setClientColorMode,
  } = useNetworkStore();

  // Calcul des puissances totales et foisonnées (manuel + clients importés)
  const connectedNodes = currentProject?.cables && currentProject?.nodes 
    ? getConnectedNodes(currentProject.nodes, currentProject.cables)
    : new Set<string>();
  const connectedNodesData = currentProject?.nodes.filter(node => connectedNodes.has(node.id)) || [];

  const { totalChargesContractuelles, totalProductionsContractuelles } = currentProject
    ? calculateTotalPowersForNodes(
        connectedNodesData,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      )
    : { totalChargesContractuelles: 0, totalProductionsContractuelles: 0 };

  const totalChargesNonFoisonnees = totalChargesContractuelles;
  const totalProductionsNonFoisonnees = totalProductionsContractuelles;

  const chargesFoisonnees = totalChargesNonFoisonnees * (
    (simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined 
      ? simulationPreview.foisonnementCharges 
      : currentProject?.foisonnementCharges || 0) / 100
  );

  const productionsFoisonnees = totalProductionsNonFoisonnees * (
    (currentProject?.foisonnementProductions || 0) / 100
  );

  const handleExportPDF = async () => {
    if (!currentProject || !selectedScenario) {
      toast.error("Aucun projet ou scénario sélectionné.");
      return;
    }
    
    // Appliquer la même logique que Index.tsx pour déterminer les résultats à utiliser
    const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                                 simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
    
    const resultsToUse = (isSimulationActive && activeEquipmentCount > 0) 
      ? simulationResults 
      : calculationResults;
    
    const generatePDF = async () => {
      const pdfGenerator = new PDFGenerator();
      await pdfGenerator.generateReport({
        project: currentProject,
        results: resultsToUse,
        selectedScenario,
        simulationResults: (isSimulationActive && activeEquipmentCount > 0) 
          ? simulationResults[selectedScenario] 
          : undefined
      });
    };
    toast.promise(generatePDF(), {
      loading: "Génération du rapport PDF en cours...",
      success: "Rapport PDF généré avec succès !",
      error: "Erreur lors de la génération du rapport PDF."
    });
  };
  return <div className="bg-gradient-primary shadow-lg border-b border-primary/20">
      {/* ROW 1 - Header Compact (~40px) */}
      <div className="flex items-center justify-between px-4 py-1.5 gap-2">
        {/* Left: Title + Simulation Badge */}
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white/10 rounded">
            <Zap className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white drop-shadow-sm">Calcul Chute de Tension BT</h1>
          </div>
          {editTarget === 'simulation' && (
            <Badge variant="default" className="animate-pulse bg-orange-500 text-white text-xs px-2 py-0">
              🔬 Mode Simulation
            </Badge>
          )}
        </div>

        {/* Center: System Info Badges (compact, opaque) */}
        {currentProject && (
          <div className="flex items-center gap-1.5 flex-1 justify-center">
            {/* Voltage Badge */}
            <Badge className={`${currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 'bg-fuchsia-600/90' : 'bg-cyan-600/90'} text-white text-xs px-2 py-0.5 shadow-sm`}>
              {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V' : '230V'} · φCh={currentProject.cosPhiCharges ?? currentProject.cosPhi} · φPr={currentProject.cosPhiProductions ?? 1.00}
            </Badge>
            
            {/* Transformer Badge */}
            <Badge className="bg-white/90 text-gray-900 text-xs px-2 py-0.5 shadow-sm">
              Transfo: {currentProject.transformerConfig.rating} ({currentProject.transformerConfig.nominalPower_kVA}kVA)
            </Badge>

            {/* Busbar Badge (if exists) */}
            {calculationResults[selectedScenario]?.virtualBusbar && (
              <Badge className="bg-white/90 text-gray-900 text-xs px-2 py-0.5 shadow-sm">
                {(() => {
                  const result = calculationResults[selectedScenario]!;
                  const busbar = result.virtualBusbar!;
                  const sourceNode = currentProject.nodes.find(node => node.isSource);
                  const sourceMetrics = sourceNode && result.nodeMetricsPerPhase?.find(m => m.nodeId === sourceNode.id);

                  if (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' && currentProject.loadModel === 'monophase_reparti' && sourceMetrics) {
                    // ✅ voltagesPerPhase.A est déjà en phase-neutre (230V) pour un réseau 400V
                    const phaseNeutralA = sourceMetrics.voltagesPerPhase.A;
                    return <>VA: {phaseNeutralA.toFixed(0)}V · {typeof busbar.current_A === 'number' ? Math.abs(busbar.current_A).toFixed(0) : '0'}A · ΔU: {typeof busbar.deltaU_V === 'number' ? (busbar.deltaU_V >= 0 ? '+' : '') + busbar.deltaU_V.toFixed(1) : '0.0'}V</>;
                  }

                  return <>
                    {busbar.voltage_V.toFixed(0)}V · {typeof busbar.current_A === 'number' ? Math.abs(busbar.current_A).toFixed(0) : '0'}A · ΔU: {typeof busbar.deltaU_V === 'number' ? (busbar.deltaU_V >= 0 ? '+' : '') + busbar.deltaU_V.toFixed(1) : '0.0'}V
                  </>;
                })()}
              </Badge>
            )}

            {/* Simulation Toggle (if equipment exists) */}
            {((simulationEquipment.srg2Devices?.length || 0) > 0 || simulationEquipment.neutralCompensators.length > 0) && (
              <div className="flex items-center gap-1.5 ml-2">
                <Switch 
                  checked={isSimulationActive} 
                  onCheckedChange={toggleSimulationActive}
                  className="data-[state=checked]:bg-green-500 scale-75"
                />
                <Label className="text-xs font-medium text-white drop-shadow-sm cursor-pointer">
                  Simulation
                </Label>
                <Badge variant={isSimulationActive ? "default" : "secondary"} className={`text-xs px-1.5 py-0 ${isSimulationActive ? 'bg-green-600 text-white' : ''}`}>
                  {isSimulationActive ? '✓' : '✗'}
                </Badge>
              </div>
            )}
          </div>
        )}

        {/* Model and Scenario Selectors */}
        {currentProject && (
          <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded ml-2">
            <Label className="text-xs font-medium text-white drop-shadow-sm">Modèle:</Label>
            <Select value={currentProject.loadModel || 'polyphase_equilibre'} onValueChange={(value: LoadModel) => updateProjectConfig({ loadModel: value })}>
              <SelectTrigger className="w-[130px] bg-white/10 border-white/20 text-white text-xs h-6">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border z-[10000]">
                <SelectItem value="polyphase_equilibre">Polyphasé équilibré</SelectItem>
                <SelectItem value="monophase_reparti">Monophasé réparti</SelectItem>
                <SelectItem value="mixte_mono_poly">Mixte mono/poly ✨</SelectItem>
              </SelectContent>
            </Select>

            <Label className="text-xs font-medium text-white drop-shadow-sm ml-2">Scénario:</Label>
            <Select value={selectedScenario || 'PRÉLÈVEMENT'} onValueChange={setSelectedScenario}>
              <SelectTrigger className="w-[110px] bg-white/10 border-white/20 text-white text-xs h-6">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border z-[10000]">
                <SelectItem value="PRÉLÈVEMENT">Prélèvement</SelectItem>
                <SelectItem value="MIXTE">Mixte</SelectItem>
                <SelectItem value="PRODUCTION">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Right: Actions Buttons (compact) */}
        <TooltipProvider>
          <div className="flex items-center gap-0.5">
            {/* Node Voltage Display Button */}
            {currentProject && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={() => setShowVoltages(!showVoltages)} 
                    variant={showVoltages ? "secondary" : "ghost"}
                    size="sm" 
                    className={`h-7 px-2 text-xs mr-1 ${showVoltages 
                      ? 'bg-white/20 text-white font-semibold border border-white/30' 
                      : 'text-white hover:bg-white/20'
                    }`}
                  >
                    Noeud
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Afficher/Masquer les tensions des nœuds</p>
                </TooltipContent>
              </Tooltip>
            )}
            
            {/* Voltage System Switch */}
            {currentProject && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={changeVoltageSystem} variant="ghost" size="sm" className="text-white hover:bg-white/20 h-7 px-2 text-xs mr-1">
                    {currentProject.voltageSystem === 'TRIPHASÉ_230V' ? '230→400V' : '400→230V'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Changer le système de tension</p>
                </TooltipContent>
              </Tooltip>
            )}
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={handleExportPDF} disabled={!currentProject || !calculationResults[selectedScenario]} className="text-white hover:bg-white/20 disabled:opacity-50 h-7 px-2 text-xs">
                  <FileDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Exporter le rapport PDF</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => setShowImporter(true)} disabled={!currentProject} className="text-white hover:bg-white/20 disabled:opacity-50 h-7 px-2 text-xs">
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                  Import
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Importer clients depuis Excel</p>
              </TooltipContent>
            </Tooltip>
          
          {currentProject && currentProject.clientsImportes && currentProject.clientsImportes.length > 0 && (
            <Select value={clientColorMode} onValueChange={(value: any) => setClientColorMode(value)}>
              <SelectTrigger className="w-[100px] bg-white/10 border-white/20 text-white text-xs h-7 px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border z-[10000]">
                <SelectItem value="couplage">Couplage</SelectItem>
                <SelectItem value="circuit">Circuit</SelectItem>
                <SelectItem value="tension">Tension</SelectItem>
                <SelectItem value="lien">Lien</SelectItem>
                <SelectItem value="gps">GPS</SelectItem>
              </SelectContent>
            </Select>
          )}
          
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onNewNetwork} className="text-white hover:bg-white/20 h-7 px-2 text-xs">
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Nouveau réseau</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onSave} className="text-white hover:bg-white/20 h-7 px-2 text-xs">
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Sauvegarder le projet</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onLoad} className="text-white hover:bg-white/20 h-7 px-2 text-xs">
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Charger un projet</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={updateCableTypes} disabled={!currentProject} className="text-white hover:bg-white/20 disabled:opacity-50 h-7 px-2 text-xs">
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Gérer les types de câbles</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant={editTarget === 'simulation' ? 'secondary' : 'ghost'} 
                  size="sm" 
                  onClick={onSimulation} 
                  className={`h-7 px-2 text-xs ${editTarget === 'simulation' 
                    ? 'bg-white/20 text-white font-semibold border border-white/30' 
                    : 'text-white hover:bg-white/20'
                  }`}
                >
                  <Zap className={`h-3.5 w-3.5 ${editTarget === 'simulation' ? 'text-orange-400' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Mode simulation</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onSettings} className="text-white hover:bg-white/20 h-7 px-2 text-xs">
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Paramètres du projet</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => window.open('/manuel-utilisateur.html', '_blank')} className="text-white hover:bg-white/20 h-7 px-2 text-xs">
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Manuel utilisateur</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* ROW 2 - Controls (~50px, visible if project exists) */}
      {currentProject && (
        <div className="flex items-center px-4 py-2 gap-1 border-t border-white/10">
          {/* Groupe 1: Foisonnement Sliders */}
          <div className="flex items-center gap-4 bg-white/5 px-3 py-2 rounded border-r border-white/20">
            {/* Charges Slider */}
            <div className="flex flex-col items-center gap-1">
              <Label className={`text-xs font-medium text-center text-white drop-shadow-sm ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-orange-300' : ''}`}>
                Charges
              </Label>
              <div className="relative flex flex-col items-center">
                <div className="relative w-5 h-24 bg-muted rounded-md border">
                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-blue-500 to-blue-300 rounded-md transition-all duration-200" style={{
                    height: `${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? simulationPreview.foisonnementCharges : currentProject.foisonnementCharges}%`
                  }} />
                  <Slider value={[currentProject.foisonnementCharges]} onValueChange={value => setFoisonnementCharges(value[0])} max={100} min={0} step={1} orientation="vertical" className="absolute inset-0 h-24 slider-charges opacity-80" disabled={simulationPreview.isActive} />
                </div>
                <span className={`text-xs mt-0.5 font-medium text-white drop-shadow-sm ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-orange-300' : ''}`}>
                  {simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? simulationPreview.foisonnementCharges : currentProject.foisonnementCharges}%
                </span>
                <span className="text-xs text-white/70 drop-shadow-sm">
                  {chargesFoisonnees.toFixed(1)}kVA
                </span>
              </div>
            </div>

            {/* Productions Slider */}
            <div className="flex flex-col items-center gap-1">
              <Label className="text-xs font-medium text-center text-white drop-shadow-sm">Prod.</Label>
              <div className="relative flex flex-col items-center">
                <div className="relative w-5 h-24 bg-muted rounded-md border">
                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 to-green-300 rounded-md transition-all duration-200" style={{
                    height: `${currentProject.foisonnementProductions}%`
                  }} />
                  <Slider value={[currentProject.foisonnementProductions]} onValueChange={value => setFoisonnementProductions(value[0])} max={100} min={0} step={1} orientation="vertical" className="absolute inset-0 h-24 slider-productions opacity-80" disabled={simulationPreview.isActive} />
                </div>
                <span className="text-xs mt-0.5 font-medium text-white drop-shadow-sm">
                  {currentProject.foisonnementProductions}%
                </span>
                <span className="text-xs text-white/70 drop-shadow-sm">
                  {productionsFoisonnees.toFixed(1)}kVA
                </span>
              </div>
            </div>
          </div>

          {/* Groupe 4: Phase Distribution (if applicable) */}
          {(currentProject.loadModel === 'monophase_reparti' || currentProject.loadModel === 'mixte_mono_poly') && (
            <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded">
              <PhaseDistributionSliders type="charges" title="Charges" />
              <PhaseDistributionSliders type="productions" title="Prod." />
              <PhaseDistributionDisplay />
            </div>
          )}
        </div>
      )}
      
      {/* Dialog for Excel Importer */}
      <Dialog open={showImporter} onOpenChange={setShowImporter}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <ExcelImporter onClose={() => setShowImporter(false)} />
        </DialogContent>
      </Dialog>
    </div>;
};