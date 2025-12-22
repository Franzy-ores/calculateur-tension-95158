import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Zap, Layers, Activity, Gauge } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { useState, useEffect, useRef } from 'react';
import type { LoadModel, TransformerRating } from '@/types/network';

export const NetworkTab = () => {
  const {
    currentProject,
    selectedScenario,
    setSelectedScenario,
    changeVoltageSystem,
    updateProjectConfig,
    calculationResults,
    updateAllCalculations,
  } = useNetworkStore();

  // Source voltage slider state with debounce
  const nominalVoltage = currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' ? 400 : 230;
  const minVoltage = Math.round(nominalVoltage * 0.95 * 10) / 10;
  const maxVoltage = Math.round(nominalVoltage * 1.05 * 10) / 10;
  const currentSourceVoltage = currentProject?.transformerConfig?.sourceVoltage ?? nominalVoltage;
  
  const [localSourceVoltage, setLocalSourceVoltage] = useState(currentSourceVoltage);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    setLocalSourceVoltage(currentSourceVoltage);
  }, [currentSourceVoltage]);
  
  useEffect(() => {
    if (localSourceVoltage !== currentSourceVoltage && currentProject) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateProjectConfig({
          transformerConfig: {
            ...currentProject.transformerConfig,
            sourceVoltage: localSourceVoltage
          }
        });
        updateAllCalculations();
      }, 300);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSourceVoltage]);

  if (!currentProject) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4">
      {/* Card 1: Système de tension + Transformateur */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Système de tension
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <Badge 
              variant="outline" 
              className={`${currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 'border-primary bg-primary/10 text-primary' : 'border-secondary bg-secondary/10 text-secondary'} text-sm px-3 py-1`}
            >
              {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V Triphasé' : '230V Triphasé'}
            </Badge>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={changeVoltageSystem}
              className="text-xs"
            >
              {currentProject.voltageSystem === 'TRIPHASÉ_230V' ? '→ 400V' : '→ 230V'}
            </Button>
          </div>
          
          {/* Configuration Transformateur */}
          <div className="pt-2 border-t border-border/50">
            <Label className="text-xs text-muted-foreground mb-2 block">Transformateur HT1/BT</Label>
            <Select
              value={currentProject.transformerConfig?.rating || '250kVA'}
              onValueChange={(value) => {
                const powerMap: Record<string, number> = {
                  "160kVA": 160,
                  "250kVA": 250, 
                  "400kVA": 400,
                  "630kVA": 630
                };
                const shortCircuitMap: Record<string, number> = {
                  "160kVA": 4.0,
                  "250kVA": 4.0,
                  "400kVA": 4.5,
                  "630kVA": 4.5
                };
                updateProjectConfig({
                  transformerConfig: {
                    ...currentProject.transformerConfig,
                    rating: value as TransformerRating,
                    nominalPower_kVA: powerMap[value],
                    shortCircuitVoltage_percent: shortCircuitMap[value]
                  }
                });
                updateAllCalculations();
              }}
            >
              <SelectTrigger className="w-full bg-background border text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border z-[10000]">
                <SelectItem value="160kVA">160 kVA (Ucc: 4.0%)</SelectItem>
                <SelectItem value="250kVA">250 kVA (Ucc: 4.0%)</SelectItem>
                <SelectItem value="400kVA">400 kVA (Ucc: 4.5%)</SelectItem>
                <SelectItem value="630kVA">630 kVA (Ucc: 4.5%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="text-xs text-muted-foreground">
            <div>cos φ Charges: {currentProject.cosPhiCharges ?? currentProject.cosPhi}</div>
            <div>cos φ Productions: {currentProject.cosPhiProductions ?? 1.00}</div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Tension source */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Gauge className="h-4 w-4 text-accent" />
            Tension source
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-2">
                  <Slider
                    value={[localSourceVoltage]}
                    min={minVoltage}
                    max={maxVoltage}
                    step={0.5}
                    onValueChange={(value) => setLocalSourceVoltage(value[0])}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{minVoltage}V</span>
                    <span className="font-mono font-medium text-primary">{localSourceVoltage.toFixed(1)}V</span>
                    <span className="text-muted-foreground">{maxVoltage}V</span>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Tension source ({minVoltage}V - {maxVoltage}V)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          {/* Busbar info */}
          {calculationResults[selectedScenario]?.virtualBusbar && (
            <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
              Busbar: {calculationResults[selectedScenario]?.virtualBusbar?.voltage_V.toFixed(0)}V
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 3: Modèle de charge */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4 text-secondary" />
            Modèle de charge
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <Select 
            value={currentProject.loadModel || 'polyphase_equilibre'} 
            onValueChange={(value: LoadModel) => updateProjectConfig({ loadModel: value })}
          >
            <SelectTrigger className="w-full bg-background border text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-[10000]">
              <SelectItem value="polyphase_equilibre">Polyphasé équilibré</SelectItem>
              <SelectItem value="monophase_reparti">Monophasé réparti</SelectItem>
              <SelectItem value="mixte_mono_poly">Mixte mono/poly ✨</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            {currentProject.loadModel === 'polyphase_equilibre' && "Charges équilibrées sur les 3 phases"}
            {currentProject.loadModel === 'monophase_reparti' && "Charges monophasées réparties"}
            {currentProject.loadModel === 'mixte_mono_poly' && "Mix de charges mono et polyphasées"}
          </p>
        </CardContent>
      </Card>

      {/* Card 4: Scénario */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-destructive" />
            Scénario
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <Select 
            value={selectedScenario || 'PRÉLÈVEMENT'} 
            onValueChange={setSelectedScenario}
          >
            <SelectTrigger className="w-full bg-background border text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border z-[10000]">
              <SelectItem value="PRÉLÈVEMENT">🔌 Prélèvement</SelectItem>
              <SelectItem value="MIXTE">⚡ Mixte</SelectItem>
              <SelectItem value="PRODUCTION">☀️ Production</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            {selectedScenario === 'PRÉLÈVEMENT' && "Consommation uniquement"}
            {selectedScenario === 'MIXTE' && "Conso + production solaire"}
            {selectedScenario === 'PRODUCTION' && "Injection maximale"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
