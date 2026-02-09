import React, { useState, useMemo } from 'react';
import { useNetworkStore } from '@/store/networkStore';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Cable, ArrowRightLeft, CheckCircle, Trash2, TrendingDown } from 'lucide-react';
import { CableReplacementConfig } from '@/types/network';

interface SimulationComparisonResult {
  before: {
    maxVoltageDrop: number;
    losses: number;
  };
  after: {
    maxVoltageDrop: number;
    losses: number;
  };
  gains: {
    voltageDropReduction: number;
    lossesReduction: number;
  };
  replacedCablesCount: number;
}

const TARGET_SECTIONS = [
  { id: 'baxb-95', label: 'BAXB 95' },
  { id: 'baxb-150', label: 'BAXB 150' },
];

export const CableReplacementSimulator: React.FC = () => {
  const { 
    currentProject, 
    calculationResults, 
    simulationResults,
    selectedScenario,
    simulationEquipment,
    setCableReplacementConfig,
    runSimulation
  } = useNetworkStore();
  
  const [selectedTargetSection, setSelectedTargetSection] = useState<string>('baxb-95');
  const [selectedCableTypes, setSelectedCableTypes] = useState<string[]>([]);

  // Check if cable replacement simulation is active
  const cableReplacementConfig = simulationEquipment?.cableReplacement;
  const isReplacementActive = cableReplacementConfig?.enabled ?? false;

  // Get aerial cable types currently used in the project (excluding target sections)
  const aerialCableTypesInProject = useMemo(() => {
    if (!currentProject) return [];
    
    const usedCableTypeIds = new Set<string>();
    currentProject.cables.forEach(cable => {
      if (cable.pose === 'AÉRIEN') {
        usedCableTypeIds.add(cable.typeId);
      }
    });

    return currentProject.cableTypes.filter(ct => 
      ct.posesPermises.includes('AÉRIEN') && 
      usedCableTypeIds.has(ct.id) &&
      !['baxb-95', 'baxb-150'].includes(ct.id)
    );
  }, [currentProject]);

  // Count cables that would be replaced
  const cablesCountByType = useMemo(() => {
    if (!currentProject) return {};
    
    const counts: Record<string, number> = {};
    currentProject.cables.forEach(cable => {
      if (cable.pose === 'AÉRIEN' && selectedCableTypes.includes(cable.typeId)) {
        counts[cable.typeId] = (counts[cable.typeId] || 0) + 1;
      }
    });
    return counts;
  }, [currentProject, selectedCableTypes]);

  const totalCablesToReplace = Object.values(cablesCountByType).reduce((sum, count) => sum + count, 0);

  // Calculate total length of replaced cables
  const totalReplacedLength = useMemo(() => {
    if (!currentProject || !cableReplacementConfig) return 0;
    return currentProject.cables
      .filter(c => cableReplacementConfig.affectedCableIds.includes(c.id))
      .reduce((sum, c) => sum + (c.length_m || 0), 0);
  }, [currentProject, cableReplacementConfig]);

  // Compute simulation results comparison
  const simulationComparison = useMemo((): SimulationComparisonResult | null => {
    if (!isReplacementActive || !cableReplacementConfig) return null;
    
    const baseResult = calculationResults[selectedScenario];
    const simResult = simulationResults[selectedScenario];
    
    if (!baseResult || !simResult) return null;
    
    const beforeMaxVoltageDrop = baseResult.maxVoltageDropPercent ?? 0;
    const beforeLosses = baseResult.globalLosses_kW ?? 0;
    const afterMaxVoltageDrop = simResult.maxVoltageDropPercent ?? 0;
    const afterLosses = simResult.globalLosses_kW ?? 0;
    
    return {
      before: {
        maxVoltageDrop: beforeMaxVoltageDrop,
        losses: beforeLosses,
      },
      after: {
        maxVoltageDrop: afterMaxVoltageDrop,
        losses: afterLosses,
      },
      gains: {
        voltageDropReduction: beforeMaxVoltageDrop > 0 
          ? ((beforeMaxVoltageDrop - afterMaxVoltageDrop) / beforeMaxVoltageDrop) * 100 
          : 0,
        lossesReduction: beforeLosses > 0 
          ? ((beforeLosses - afterLosses) / beforeLosses) * 100 
          : 0,
      },
      replacedCablesCount: cableReplacementConfig.affectedCableIds.length,
    };
  }, [isReplacementActive, cableReplacementConfig, calculationResults, simulationResults, selectedScenario]);

  const handleCableTypeToggle = (typeId: string) => {
    setSelectedCableTypes(prev => 
      prev.includes(typeId) 
        ? prev.filter(id => id !== typeId)
        : [...prev, typeId]
    );
  };

  const handleSelectAll = () => {
    if (selectedCableTypes.length === aerialCableTypesInProject.length) {
      setSelectedCableTypes([]);
    } else {
      setSelectedCableTypes(aerialCableTypesInProject.map(ct => ct.id));
    }
  };

  const handleSimulate = () => {
    if (!currentProject || selectedCableTypes.length === 0) return;

    const affectedCableIds = currentProject.cables
      .filter(cable => cable.pose === 'AÉRIEN' && selectedCableTypes.includes(cable.typeId))
      .map(cable => cable.id);
    
    if (affectedCableIds.length === 0) return;

    const config: CableReplacementConfig = {
      id: `cable-replacement-${Date.now()}`,
      enabled: true,
      targetCableTypeId: selectedTargetSection,
      sourceCableTypeIds: selectedCableTypes,
      affectedCableIds,
    };

    setCableReplacementConfig(config);
    runSimulation();
  };

  const handleCancelSimulation = () => {
    setCableReplacementConfig(null);
    setSelectedCableTypes([]);
  };

  if (!currentProject) return null;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cable className="h-5 w-5 text-primary" />
          Simulation remplacement câbles aériens
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Target section selector */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Section cible</Label>
          <Select 
            value={selectedTargetSection} 
            onValueChange={setSelectedTargetSection}
            disabled={isReplacementActive}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="Choisir la section cible" />
            </SelectTrigger>
            <SelectContent className="bg-popover border border-border z-50">
              {TARGET_SECTIONS.map(section => (
                <SelectItem key={section.id} value={section.id}>
                  {section.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Cable types to replace */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Câbles à remplacer</Label>
            {aerialCableTypesInProject.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSelectAll}
                disabled={isReplacementActive}
                className="h-7 text-xs"
              >
                {selectedCableTypes.length === aerialCableTypesInProject.length 
                  ? 'Tout désélectionner' 
                  : 'Tout sélectionner'}
              </Button>
            )}
          </div>
          
          {aerialCableTypesInProject.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Aucun câble aérien remplaçable dans le projet
            </p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-2 bg-muted/30">
              {aerialCableTypesInProject.map(cableType => {
                const cablesCount = currentProject.cables.filter(
                  c => c.pose === 'AÉRIEN' && c.typeId === cableType.id
                ).length;
                
                return (
                  <div 
                    key={cableType.id} 
                    className="flex items-center space-x-2 py-1"
                  >
                    <Checkbox
                      id={`cable-${cableType.id}`}
                      checked={selectedCableTypes.includes(cableType.id)}
                      onCheckedChange={() => handleCableTypeToggle(cableType.id)}
                      disabled={isReplacementActive}
                    />
                    <Label 
                      htmlFor={`cable-${cableType.id}`}
                      className="flex-1 text-sm cursor-pointer flex items-center justify-between"
                    >
                      <span>{cableType.label}</span>
                      <Badge variant="secondary" className="text-xs">
                        {cablesCount} câble{cablesCount > 1 ? 's' : ''}
                      </Badge>
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Summary */}
        {totalCablesToReplace > 0 && !isReplacementActive && (
          <div className="bg-primary/10 rounded-md p-2 text-sm">
            <span className="font-medium">{totalCablesToReplace}</span> câble{totalCablesToReplace > 1 ? 's' : ''} sera{totalCablesToReplace > 1 ? 'ont' : ''} remplacé{totalCablesToReplace > 1 ? 's' : ''} par <span className="font-medium">{TARGET_SECTIONS.find(s => s.id === selectedTargetSection)?.label}</span>
          </div>
        )}
        
        {/* Active simulation indicator with gains */}
        {isReplacementActive && cableReplacementConfig && (
          <div className="bg-emerald-500/20 border border-emerald-500/50 rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle className="h-4 w-4" />
              <span className="font-medium">Simulation active</span>
            </div>
            <div className="text-sm space-y-1.5 text-foreground">
              <div className="flex justify-between">
                <span>Tronçons remplacés :</span>
                <span className="font-mono font-medium">{cableReplacementConfig.affectedCableIds.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Longueur totale :</span>
                <span className="font-mono font-medium">{totalReplacedLength.toFixed(0)} m</span>
              </div>
              {simulationComparison && (
                <div className="flex justify-between items-center pt-1 border-t border-emerald-500/30">
                  <span className="flex items-center gap-1">
                    <TrendingDown className="h-3.5 w-3.5 text-emerald-600" />
                    Chute de tension :
                  </span>
                  <span className="font-mono">
                    <span className="text-muted-foreground">{simulationComparison.before.maxVoltageDrop.toFixed(2)}%</span>
                    <span className="mx-1">→</span>
                    <span className="text-emerald-600 font-medium">{simulationComparison.after.maxVoltageDrop.toFixed(2)}%</span>
                    <span className="text-emerald-500 text-xs ml-1">
                      ({simulationComparison.gains.voltageDropReduction > 0 ? '-' : ''}{simulationComparison.gains.voltageDropReduction.toFixed(1)}%)
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 items-center">
          {!isReplacementActive ? (
            <Button 
              onClick={handleSimulate}
              disabled={selectedCableTypes.length === 0}
              className="flex-1"
            >
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Simuler
            </Button>
          ) : (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Switch
                  checked={cableReplacementConfig?.enabled ?? false}
                  onCheckedChange={(enabled) => {
                    if (cableReplacementConfig) {
                      setCableReplacementConfig({ ...cableReplacementConfig, enabled });
                      runSimulation();
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  {cableReplacementConfig?.enabled ? 'Actif' : 'Inactif'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelSimulation}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
