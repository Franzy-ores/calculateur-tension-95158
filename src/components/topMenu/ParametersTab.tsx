import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Percent, BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PhaseDistributionSliders } from "@/components/PhaseDistributionSliders";
import { PhaseDistributionDisplay } from "@/components/PhaseDistributionDisplay";
import { calculateTotalPowersForNodes } from '@/utils/clientsUtils';
import { getConnectedNodes } from '@/utils/networkConnectivity';
import { useState } from 'react';

export const ParametersTab = () => {
  const [phaseOpen, setPhaseOpen] = useState(true);
  
  const {
    currentProject,
    setFoisonnementCharges,
    setFoisonnementProductions,
    simulationPreview,
  } = useNetworkStore();

  if (!currentProject) return null;

  // Calcul des puissances totales
  const connectedNodes = currentProject?.cables && currentProject?.nodes 
    ? getConnectedNodes(currentProject.nodes, currentProject.cables)
    : new Set<string>();
  const connectedNodesData = currentProject?.nodes.filter(node => connectedNodes.has(node.id)) || [];

  const { totalChargesContractuelles, totalProductionsContractuelles } = 
    calculateTotalPowersForNodes(
      connectedNodesData,
      currentProject.clientsImportes || [],
      currentProject.clientLinks || []
    );

  const foisonnementChargesValue = simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined 
    ? simulationPreview.foisonnementCharges 
    : currentProject.foisonnementCharges;
    
  const chargesFoisonnees = totalChargesContractuelles * (foisonnementChargesValue / 100);
  const productionsFoisonnees = totalProductionsContractuelles * (currentProject.foisonnementProductions / 100);

  const showPhaseDistribution = currentProject.loadModel === 'monophase_reparti' || currentProject.loadModel === 'mixte_mono_poly';

  return (
    <div className="flex flex-wrap gap-3 p-3">
      {/* Card 1: Foisonnement - compact */}
      <Card className="bg-card/80 backdrop-blur border-border/50 flex-1 min-w-[280px] max-w-[400px]">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5">
            <Percent className="h-3 w-3 text-primary" />
            Coefficients de foisonnement
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 space-y-2">
          {/* Charges - compact */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className={`text-xs ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-accent' : ''}`}>
                Charges
              </Label>
              <span className={`text-xs font-mono font-medium ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-accent' : 'text-primary'}`}>
                {foisonnementChargesValue}%
              </span>
            </div>
            <Slider
              value={[currentProject.foisonnementCharges]}
              onValueChange={(value) => setFoisonnementCharges(value[0])}
              max={100}
              min={0}
              step={1}
              disabled={simulationPreview.isActive}
              className="h-4"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{totalChargesContractuelles.toFixed(1)} kVA</span>
              <span className="font-medium text-primary">{chargesFoisonnees.toFixed(1)} kVA</span>
            </div>
          </div>

          {/* Productions - compact */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Productions</Label>
              <span className="text-xs font-mono font-medium text-secondary">
                {currentProject.foisonnementProductions}%
              </span>
            </div>
            <Slider
              value={[currentProject.foisonnementProductions]}
              onValueChange={(value) => setFoisonnementProductions(value[0])}
              max={100}
              min={0}
              step={1}
              disabled={simulationPreview.isActive}
              className="h-4"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{totalProductionsContractuelles.toFixed(1)} kVA</span>
              <span className="font-medium text-secondary">{productionsFoisonnees.toFixed(1)} kVA</span>
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
