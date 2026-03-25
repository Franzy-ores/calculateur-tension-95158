import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Home, Factory, Sun, Activity, Table, BarChart3, AlertTriangle, Snowflake, Thermometer, Car } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PhaseDistributionSliders } from "@/components/PhaseDistributionSliders";
import { PhaseDistributionDisplay } from "@/components/PhaseDistributionDisplay";
import { calculatePowersByClientType } from '@/utils/clientsUtils';
import { getConnectedNodes } from '@/utils/networkConnectivity';

export const ParametersTab = () => {
  const {
    currentProject,
    selectedScenario,
    setSelectedScenario,
    setFoisonnementChargesResidentiel,
    setFoisonnementChargesIndustriel,
    setFoisonnementBornesVE,
    setFoisonnementProductions,
    simulationPreview,
    updateProjectConfig,
    updateAllCalculations,
  } = useNetworkStore();

  if (!currentProject) return null;

  // Calcul des puissances totales (circuit = noeuds connectés)
  const connectedNodes = currentProject?.cables && currentProject?.nodes 
    ? getConnectedNodes(currentProject.nodes, currentProject.cables)
    : new Set<string>();
  const connectedNodesData = currentProject?.nodes.filter(node => connectedNodes.has(node.id)) || [];

  const { chargesResidentielles, chargesIndustrielles } = calculatePowersByClientType(
    connectedNodesData,
    currentProject.clientsImportes || [],
    currentProject.clientLinks || []
  );

  // Charges et productions manuelles sur nœuds (non-importées)
  let chargesManuelles = 0;
  let chargesBornesVE = 0;
  let productionsManuelles = 0;
  let totalProductionsContractuelles = 0;

  connectedNodesData.forEach(node => {
    node.clients.forEach(c => {
      if (c.clientCategory === 'bornesVE') {
        chargesBornesVE += c.S_kVA;
      } else {
        chargesManuelles += c.S_kVA;
      }
    });
    productionsManuelles += node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
    totalProductionsContractuelles += node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
    const linkedClients = (currentProject.clientsImportes || []).filter(c => 
      (currentProject.clientLinks || []).some(link => link.clientId === c.id && link.nodeId === node.id)
    );
    totalProductionsContractuelles += linkedClients.reduce((sum, c) => sum + c.puissancePV_kVA, 0);
  });

  const foisonnementResidentiel = currentProject.foisonnementChargesResidentiel ?? 15;
  const foisonnementIndustriel = currentProject.foisonnementChargesIndustriel ?? 70;
  const foisonnementVE = currentProject.foisonnementBornesVE ?? 50;
  const foisonnementProductions = currentProject.foisonnementProductions;
    
  const chargesResidentiellesFoisonnees = chargesResidentielles * (foisonnementResidentiel / 100);
  const chargesIndustriellesFoisonnees = chargesIndustrielles * (foisonnementIndustriel / 100);
  const chargesBornesVEFoisonnees = chargesBornesVE * (foisonnementVE / 100);
  const totalChargesFoisonnees = chargesResidentiellesFoisonnees + chargesIndustriellesFoisonnees + chargesBornesVEFoisonnees;
  const productionsFoisonnees = totalProductionsContractuelles * (foisonnementProductions / 100);

  // Ventilation foisonnée : manuelles vs importées (circuit)
  const chargesManuellesFoisonnees = chargesManuelles * (foisonnementResidentiel / 100);
  const chargesImporteesFoisonnees = totalChargesFoisonnees - chargesManuellesFoisonnees - chargesBornesVEFoisonnees;
  const productionsManuellesFoisonnees = productionsManuelles * (foisonnementProductions / 100);
  const productionsImporteesFoisonnees = productionsFoisonnees - productionsManuellesFoisonnees;

  // Calcul des totaux "Clients Cabine" (tous les clients importés, liés et non liés)
  const clientsImportes = currentProject.clientsImportes || [];
  let cabineChargesResidentielles = 0;
  let cabineChargesIndustrielles = 0;
  let cabineChargesBornesVE = 0;
  let cabineProductionsTotal = 0;
  clientsImportes.forEach(client => {
    if (client.clientType === 'bornesVE') {
      cabineChargesBornesVE += client.puissanceContractuelle_kVA;
    } else if (client.clientType === 'industriel') {
      cabineChargesIndustrielles += client.puissanceContractuelle_kVA;
    } else {
      cabineChargesResidentielles += client.puissanceContractuelle_kVA;
    }
    cabineProductionsTotal += client.puissancePV_kVA;
  });
  const cabineChargesFoisonnees = cabineChargesResidentielles * (foisonnementResidentiel / 100) + cabineChargesIndustrielles * (foisonnementIndustriel / 100) + cabineChargesBornesVE * (foisonnementVE / 100);
  const cabineProductionsFoisonnees = cabineProductionsTotal * (foisonnementProductions / 100);

  // Alerte transfo
  const transformerPower = currentProject.transformerConfig?.nominalPower_kVA || 0;
  const cabineNet = cabineChargesFoisonnees - cabineProductionsFoisonnees;
  const isSurcharge = transformerPower > 0 && cabineChargesFoisonnees > transformerPower + cabineProductionsFoisonnees;
  const isInjection = transformerPower > 0 && cabineProductionsFoisonnees > transformerPower + cabineChargesFoisonnees;

  const showPhaseDistribution = currentProject.loadModel === 'monophase_reparti' || currentProject.loadModel === 'mixte_mono_poly';

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Rangée 1: Scénario + Foisonnement (toujours visible) */}
      <div className="flex flex-wrap items-stretch gap-3 p-3 bg-card/80 backdrop-blur border border-border/50 rounded-lg">
        {/* Scénario */}
        <div className="flex flex-col gap-1 min-w-[120px]">
          <Label className="text-[10px] flex items-center gap-1 text-muted-foreground">
            <Activity className="h-3 w-3" />
            Scénario
          </Label>
          <Select 
            value={selectedScenario || 'PRÉLÈVEMENT'} 
            onValueChange={setSelectedScenario}
            disabled={simulationPreview.isActive}
          >
            <SelectTrigger className="w-full bg-background border text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-[10000]">
              <SelectItem value="PRÉLÈVEMENT">🔌 Prélèvement</SelectItem>
              <SelectItem value="MIXTE">⚡ Mixte</SelectItem>
              <SelectItem value="PRODUCTION">☀️ Production</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Séparateur */}
        <div className="w-px bg-border/50 self-stretch" />

        {/* Saison (modèle thermique) */}
        <div className="flex flex-col gap-1 min-w-[120px]">
          <Label className="text-[10px] flex items-center gap-1 text-muted-foreground">
            <Thermometer className="h-3 w-3" />
            Saison
          </Label>
          <Select 
            value={currentProject.season || 'winter'} 
            onValueChange={(value: 'winter' | 'summer') => {
              updateProjectConfig({ season: value } as any);
              updateAllCalculations();
            }}
            disabled={simulationPreview.isActive}
          >
            <SelectTrigger className="w-full bg-background border text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-[10000]">
              <SelectItem value="winter">
                <span className="flex items-center gap-1">
                  <Snowflake className="h-3 w-3 text-blue-400" />
                  Hiver
                </span>
              </SelectItem>
              <SelectItem value="summer">
                <span className="flex items-center gap-1">
                  <Sun className="h-3 w-3 text-orange-400" />
                  Été
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Séparateur */}
        <div className="w-px bg-border/50 self-stretch" />

        {/* Sliders Foisonnement inline */}
        <div className="flex flex-wrap items-center gap-4 flex-1">
          {/* Résidentiel */}
          <div className="flex items-center gap-2 min-w-[180px] flex-1 max-w-[220px]">
            <Home className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Rés.</span>
                <span className="text-xs font-mono font-medium text-blue-500">{foisonnementResidentiel}%</span>
              </div>
              <Slider
                value={[foisonnementResidentiel]}
                onValueChange={(value) => setFoisonnementChargesResidentiel(value[0])}
                max={100}
                min={0}
                step={1}
                disabled={simulationPreview.isActive}
                className="h-3"
              />
              <span className="text-[10px] text-muted-foreground">
                {chargesResidentielles.toFixed(0)}→<span className="text-blue-500 font-medium">{chargesResidentiellesFoisonnees.toFixed(1)}</span>
              </span>
            </div>
          </div>

          {/* Industriel */}
          <div className="flex items-center gap-2 min-w-[180px] flex-1 max-w-[220px]">
            <Factory className="h-4 w-4 text-orange-500 flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Ind.</span>
                <span className="text-xs font-mono font-medium text-orange-500">{foisonnementIndustriel}%</span>
              </div>
              <Slider
                value={[foisonnementIndustriel]}
                onValueChange={(value) => setFoisonnementChargesIndustriel(value[0])}
                max={100}
                min={0}
                step={1}
                disabled={simulationPreview.isActive}
                className="h-3"
              />
              <span className="text-[10px] text-muted-foreground">
                {chargesIndustrielles.toFixed(0)}→<span className="text-orange-500 font-medium">{chargesIndustriellesFoisonnees.toFixed(1)}</span>
              </span>
            </div>
          </div>

          {/* Séparateur Bornes VE */}
          {chargesBornesVE > 0 && (
            <>
              <div className="w-px bg-border/50 self-stretch" />
              <div className="flex items-center gap-2 min-w-[180px] flex-1 max-w-[220px]">
                <Car className="h-4 w-4 text-green-500 flex-shrink-0" />
                <div className="flex-1 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Bornes VE</span>
                    <span className="text-xs font-mono font-medium text-green-500">{foisonnementVE}%</span>
                  </div>
                  <Slider
                    value={[foisonnementVE]}
                    onValueChange={(value) => setFoisonnementBornesVE(value[0])}
                    max={100}
                    min={10}
                    step={5}
                    disabled={simulationPreview.isActive}
                    className="h-3"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {chargesBornesVE.toFixed(0)}→<span className="text-green-500 font-medium">{chargesBornesVEFoisonnees.toFixed(1)}</span>
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Productions */}
          <div className="flex items-center gap-2 min-w-[180px] flex-1 max-w-[220px]">
            <Sun className="h-4 w-4 text-yellow-500 flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Prod.</span>
                <span className="text-xs font-mono font-medium text-yellow-500">{foisonnementProductions}%</span>
              </div>
              <Slider
                value={[foisonnementProductions]}
                onValueChange={(value) => setFoisonnementProductions(value[0])}
                max={100}
                min={0}
                step={1}
                disabled={simulationPreview.isActive}
                className="h-3"
              />
              <span className="text-[10px] text-muted-foreground">
                {totalProductionsContractuelles.toFixed(0)}→<span className="text-yellow-500 font-medium">{productionsFoisonnees.toFixed(1)}</span>
              </span>
            </div>
          </div>

          {/* Total Circuit */}
          <div className="flex flex-col items-end justify-center px-2 border-l border-border/50">
            <span className="text-[10px] text-muted-foreground">Circuit - Charges F.</span>
            <span className="text-sm font-bold text-primary">{totalChargesFoisonnees.toFixed(1)} kVA</span>
            {(chargesManuellesFoisonnees > 0.01 || chargesImporteesFoisonnees > 0.01 || chargesBornesVEFoisonnees > 0.01) && (
              <span className="text-[9px] text-muted-foreground/70">
                ↳ Clients: {chargesImporteesFoisonnees.toFixed(1)} | Nœuds: {chargesManuellesFoisonnees.toFixed(1)}
                {chargesBornesVEFoisonnees > 0.01 && ` | VE: ${chargesBornesVEFoisonnees.toFixed(1)}`}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground mt-0.5">Circuit - Prod. F.</span>
            <span className="text-sm font-bold text-yellow-500">{productionsFoisonnees.toFixed(1)} kVA</span>
            {(productionsManuellesFoisonnees > 0.01 || productionsImporteesFoisonnees > 0.01) && (
              <span className="text-[9px] text-muted-foreground/70">
                ↳ Clients: {productionsImporteesFoisonnees.toFixed(1)} | Nœuds: {productionsManuellesFoisonnees.toFixed(1)}
              </span>
            )}
          </div>

          {/* Total Clients Cabine */}
          <div className="flex flex-col items-end justify-center px-2 border-l border-border/50">
            <span className="text-[10px] text-muted-foreground">Cabine - Charges F.</span>
            <span className="text-sm font-bold text-primary">{cabineChargesFoisonnees.toFixed(1)} kVA</span>
            <span className="text-[9px] text-muted-foreground/70 italic">Clients importés uniquement</span>
            <span className="text-[10px] text-muted-foreground mt-0.5">Cabine - Prod. F.</span>
            <span className="text-sm font-bold text-yellow-500">{cabineProductionsFoisonnees.toFixed(1)} kVA</span>
            {isSurcharge && (
              <div className="flex items-center gap-1 mt-1 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                <span className="text-[10px] font-medium">Surcharge: +{(cabineChargesFoisonnees - transformerPower - cabineProductionsFoisonnees).toFixed(1)} kVA</span>
              </div>
            )}
            {isInjection && (
              <div className="flex items-center gap-1 mt-1 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                <span className="text-[10px] font-medium">Injection: +{(cabineProductionsFoisonnees - transformerPower - cabineChargesFoisonnees).toFixed(1)} kVA</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rangée 2: Déséquilibre de phase (si mode MONO/Mixte) */}
      {showPhaseDistribution && (
        <div className="flex flex-wrap items-center gap-4 p-3 bg-card/80 backdrop-blur border border-border/50 rounded-lg">
          <Label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            Déséquilibre
          </Label>
          <PhaseDistributionSliders type="charges" title="Charges (mono+poly)" />
          <div className="w-px h-8 bg-border/50" />
          <PhaseDistributionSliders type="productions" title="Productions" />
        </div>
      )}

      {/* Rangée 3: Sections détaillées en accordéon */}
      {showPhaseDistribution && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="table" className="border border-border/50 rounded-lg bg-card/80 backdrop-blur">
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Table className="h-3.5 w-3.5 text-muted-foreground" />
                Récapitulatif par couplage
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <PhaseDistributionDisplay section="table" />
            </AccordionContent>
          </AccordionItem>
          
          <AccordionItem value="stats" className="border border-border/50 rounded-lg bg-card/80 backdrop-blur mt-1">
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex items-center gap-2 text-xs font-medium">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                Foisonnement détaillé (MONO/POLY)
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <PhaseDistributionDisplay section="stats" />
            </AccordionContent>
          </AccordionItem>
          
          <AccordionItem value="alerts" className="border border-border/50 rounded-lg bg-card/80 backdrop-blur mt-1">
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex items-center gap-2 text-xs font-medium">
                <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                Alertes fortes puissances MONO
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <PhaseDistributionDisplay section="alerts" />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Placeholder if no phase distribution */}
      {!showPhaseDistribution && (
        <div className="flex items-center justify-center p-4 text-center bg-card/80 backdrop-blur border border-border/50 rounded-lg">
          <div className="flex flex-col items-center gap-1">
            <BarChart3 className="h-5 w-5 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              Mode Monophasé ou Mixte requis pour la distribution de phase
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
