import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Percent, BarChart3, ChevronDown, ChevronUp, Home, Factory, Sun } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PhaseDistributionSliders } from "@/components/PhaseDistributionSliders";
import { PhaseDistributionDisplay } from "@/components/PhaseDistributionDisplay";
import { calculatePowersByClientType } from '@/utils/clientsUtils';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { useState } from 'react';

export const ParametersTab = () => {
  const [phaseOpen, setPhaseOpen] = useState(true);
  
  const {
    currentProject,
    setFoisonnementChargesResidentiel,
    setFoisonnementChargesIndustriel,
    setFoisonnementProductions,
    simulationPreview,
  } = useNetworkStore();

  if (!currentProject) return null;

  // Calcul des puissances totales
  const connectedNodes = currentProject?.cables && currentProject?.nodes 
    ? getConnectedNodes(currentProject.nodes, currentProject.cables)
    : new Set<string>();
  const connectedNodesData = currentProject?.nodes.filter(node => connectedNodes.has(node.id)) || [];

  // Calcul des puissances par type de client
  const { chargesResidentielles, chargesIndustrielles } = calculatePowersByClientType(
    connectedNodesData,
    currentProject.clientsImportes || [],
    currentProject.clientLinks || []
  );

  // Calcul des productions totales
  let totalProductionsContractuelles = 0;
  connectedNodesData.forEach(node => {
    totalProductionsContractuelles += node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
    const linkedClients = (currentProject.clientsImportes || []).filter(c => 
      (currentProject.clientLinks || []).some(link => link.clientId === c.id && link.nodeId === node.id)
    );
    totalProductionsContractuelles += linkedClients.reduce((sum, c) => sum + c.puissancePV_kVA, 0);
  });

  const foisonnementResidentiel = currentProject.foisonnementChargesResidentiel ?? 15;
  const foisonnementIndustriel = currentProject.foisonnementChargesIndustriel ?? 70;
  const foisonnementProductions = currentProject.foisonnementProductions;
    
  const chargesResidentiellesFoisonnees = chargesResidentielles * (foisonnementResidentiel / 100);
  const chargesIndustriellesFoisonnees = chargesIndustrielles * (foisonnementIndustriel / 100);
  const totalChargesFoisonnees = chargesResidentiellesFoisonnees + chargesIndustriellesFoisonnees;
  const productionsFoisonnees = totalProductionsContractuelles * (foisonnementProductions / 100);

  const showPhaseDistribution = currentProject.loadModel === 'monophase_reparti' || currentProject.loadModel === 'mixte_mono_poly';

  return (
    <div className="flex flex-wrap gap-3 p-3">
      {/* Card 1: Foisonnement différencié */}
      <Card className="bg-card/80 backdrop-blur border-border/50 flex-1 min-w-[300px] max-w-[450px]">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5">
            <Percent className="h-3 w-3 text-primary" />
            Coefficients de foisonnement
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 space-y-3">
          {/* Charges Résidentielles */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1">
                <Home className="h-3 w-3 text-blue-500" />
                Résidentiel
              </Label>
              <span className="text-xs font-mono font-medium text-blue-500">
                {foisonnementResidentiel}%
              </span>
            </div>
            <Slider
              value={[foisonnementResidentiel]}
              onValueChange={(value) => setFoisonnementChargesResidentiel(value[0])}
              max={100}
              min={0}
              step={1}
              disabled={simulationPreview.isActive}
              className="h-4"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{chargesResidentielles.toFixed(1)} kVA contractuel</span>
              <span className="font-medium text-blue-500">{chargesResidentiellesFoisonnees.toFixed(1)} kVA</span>
            </div>
          </div>

          {/* Charges Industrielles */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1">
                <Factory className="h-3 w-3 text-orange-500" />
                Industriel
              </Label>
              <span className="text-xs font-mono font-medium text-orange-500">
                {foisonnementIndustriel}%
              </span>
            </div>
            <Slider
              value={[foisonnementIndustriel]}
              onValueChange={(value) => setFoisonnementChargesIndustriel(value[0])}
              max={100}
              min={0}
              step={1}
              disabled={simulationPreview.isActive}
              className="h-4"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{chargesIndustrielles.toFixed(1)} kVA contractuel</span>
              <span className="font-medium text-orange-500">{chargesIndustriellesFoisonnees.toFixed(1)} kVA</span>
            </div>
          </div>

          {/* Séparateur et Total */}
          <div className="border-t border-border/50 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Total charges foisonnées</span>
              <span className="font-medium text-primary">{totalChargesFoisonnees.toFixed(1)} kVA</span>
            </div>
            <div className="text-[10px] text-muted-foreground text-right">
              sur {(chargesResidentielles + chargesIndustrielles).toFixed(1)} kVA contractuel
            </div>
          </div>

          {/* Productions */}
          <div className="space-y-1 border-t border-border/50 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1">
                <Sun className="h-3 w-3 text-yellow-500" />
                Productions
              </Label>
              <span className="text-xs font-mono font-medium text-yellow-500">
                {foisonnementProductions}%
              </span>
            </div>
            <Slider
              value={[foisonnementProductions]}
              onValueChange={(value) => setFoisonnementProductions(value[0])}
              max={100}
              min={0}
              step={1}
              disabled={simulationPreview.isActive}
              className="h-4"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{totalProductionsContractuelles.toFixed(1)} kVA</span>
              <span className="font-medium text-yellow-500">{productionsFoisonnees.toFixed(1)} kVA</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Distribution de phase - collapsible compact */}
      {showPhaseDistribution && (
        <Card className="bg-card/80 backdrop-blur border-border/50 flex-1 min-w-[350px]">
          <Collapsible open={phaseOpen} onOpenChange={setPhaseOpen}>
            <CardHeader className="pb-1 pt-2 px-3">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between cursor-pointer hover:bg-muted/50 -mx-1 px-1 py-0.5 rounded transition-colors">
                  <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                    <BarChart3 className="h-3 w-3 text-secondary" />
                    Distribution de phase
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                    {phaseOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </div>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="px-3 pb-2 space-y-2">
                <div className="flex gap-3 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <PhaseDistributionSliders type="charges" title="Charges" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <PhaseDistributionSliders type="productions" title="Productions" />
                  </div>
                </div>
                <div className="border-t border-border/50 pt-2">
                  <PhaseDistributionDisplay />
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Placeholder if no phase distribution */}
      {!showPhaseDistribution && (
        <Card className="bg-card/80 backdrop-blur border-border/50 flex items-center justify-center min-w-[200px]">
          <CardContent className="text-center py-4">
            <BarChart3 className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">
              Mode Monophasé ou Mixte requis
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};