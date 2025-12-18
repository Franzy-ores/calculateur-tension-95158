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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
      {/* Card 1: Foisonnement */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" />
            Coefficients de foisonnement
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Charges */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className={`text-sm font-medium ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-accent' : ''}`}>
                Charges
              </Label>
              <span className={`text-sm font-mono font-medium ${simulationPreview.isActive && simulationPreview.foisonnementCharges !== undefined ? 'text-accent' : 'text-primary'}`}>
                {foisonnementChargesValue}%
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Slider
                value={[currentProject.foisonnementCharges]}
                onValueChange={(value) => setFoisonnementCharges(value[0])}
                max={100}
                min={0}
                step={1}
                disabled={simulationPreview.isActive}
                className="flex-1"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Contractuel: {totalChargesContractuelles.toFixed(1)} kVA</span>
              <span>Foisonné: <span className="font-medium text-primary">{chargesFoisonnees.toFixed(1)} kVA</span></span>
            </div>
            <Progress value={foisonnementChargesValue} className="h-2 bg-muted" />
          </div>

          {/* Productions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Productions</Label>
              <span className="text-sm font-mono font-medium text-secondary">
                {currentProject.foisonnementProductions}%
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Slider
                value={[currentProject.foisonnementProductions]}
                onValueChange={(value) => setFoisonnementProductions(value[0])}
                max={100}
                min={0}
                step={1}
                disabled={simulationPreview.isActive}
                className="flex-1"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Contractuel: {totalProductionsContractuelles.toFixed(1)} kVA</span>
              <span>Foisonné: <span className="font-medium text-secondary">{productionsFoisonnees.toFixed(1)} kVA</span></span>
            </div>
            <Progress value={currentProject.foisonnementProductions} className="h-2 bg-muted [&>div]:bg-secondary" />
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Distribution de phase (collapsible) */}
      {showPhaseDistribution && (
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <Collapsible open={phaseOpen} onOpenChange={setPhaseOpen}>
            <CardHeader className="pb-2 pt-3 px-4">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded transition-colors">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-secondary" />
                    Distribution de phase
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    {phaseOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="px-4 pb-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <PhaseDistributionSliders type="charges" title="Charges" />
                  <PhaseDistributionSliders type="productions" title="Productions" />
                </div>
                <div className="border-t border-border/50 pt-3">
                  <PhaseDistributionDisplay />
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Placeholder if no phase distribution */}
      {!showPhaseDistribution && (
        <Card className="bg-card/50 backdrop-blur border-border/50 flex items-center justify-center">
          <CardContent className="text-center py-8">
            <BarChart3 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Distribution de phase disponible en mode<br />
              <span className="font-medium">Monophasé réparti</span> ou <span className="font-medium">Mixte</span>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
