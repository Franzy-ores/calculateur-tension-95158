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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Cable, ArrowRightLeft, CheckCircle, AlertTriangle, X, Eye } from 'lucide-react';
import { CableReplacementConfig } from '@/types/network';

interface SimulationComparisonResult {
  before: {
    maxVoltageDrop: number;
    losses: number;
    en50160Compliant: boolean;
  };
  after: {
    maxVoltageDrop: number;
    losses: number;
    en50160Compliant: boolean;
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
    runSimulation,
    isSimulationActive
  } = useNetworkStore();
  
  const [selectedTargetSection, setSelectedTargetSection] = useState<string>('baxb-95');
  const [selectedCableTypes, setSelectedCableTypes] = useState<string[]>([]);
  const [showResultsPopup, setShowResultsPopup] = useState(false);

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

    // Filter cable types that are aerial and used in the project
    // Exclude BAXB 95 and BAXB 150 (target sections)
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
        en50160Compliant: beforeMaxVoltageDrop <= 10,
      },
      after: {
        maxVoltageDrop: afterMaxVoltageDrop,
        losses: afterLosses,
        en50160Compliant: afterMaxVoltageDrop <= 10,
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

    // Identify affected cables
    const affectedCableIds = currentProject.cables
      .filter(cable => cable.pose === 'AÉRIEN' && selectedCableTypes.includes(cable.typeId))
      .map(cable => cable.id);
    
    if (affectedCableIds.length === 0) return;

    // Create and set the cable replacement config
    const config: CableReplacementConfig = {
      id: `cable-replacement-${Date.now()}`,
      enabled: true,
      targetCableTypeId: selectedTargetSection,
      sourceCableTypeIds: selectedCableTypes,
      affectedCableIds,
    };

    setCableReplacementConfig(config);
    
    // Run the simulation
    runSimulation();
    
    // Show results popup
    setTimeout(() => setShowResultsPopup(true), 500);
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
        
        {/* Active simulation indicator */}
        {isReplacementActive && cableReplacementConfig && (
          <div className="bg-emerald-500/20 border border-emerald-500/50 rounded-md p-2 text-sm">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle className="h-4 w-4" />
              <span>Simulation active : <span className="font-medium">{cableReplacementConfig.affectedCableIds.length}</span> câble(s) remplacé(s)</span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
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
            <>
              <Button 
                variant="outline"
                onClick={() => setShowResultsPopup(true)}
                className="flex-1"
              >
                <Eye className="h-4 w-4 mr-2" />
                Voir résultats
              </Button>
              <Button 
                variant="destructive"
                onClick={handleCancelSimulation}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-2" />
                Annuler
              </Button>
            </>
          )}
        </div>

        {/* Results Popup */}
        <Dialog open={showResultsPopup} onOpenChange={setShowResultsPopup}>
          <DialogContent className="sm:max-w-md bg-background">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Cable className="h-5 w-5" />
                Résultats de simulation
              </DialogTitle>
              <DialogDescription>
                Comparaison avant/après remplacement de {simulationComparison?.replacedCablesCount || cableReplacementConfig?.affectedCableIds.length || 0} câble(s)
              </DialogDescription>
            </DialogHeader>

            {simulationComparison && (
              <div className="space-y-4">
                {/* Voltage Drop Comparison */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="text-sm font-medium text-muted-foreground">Indicateur</div>
                  <div className="text-sm font-medium text-muted-foreground">Avant</div>
                  <div className="text-sm font-medium text-muted-foreground">Après</div>
                </div>

                {/* Max Voltage Drop */}
                <div className="grid grid-cols-3 gap-2 items-center bg-muted/50 rounded-md p-2">
                  <div className="text-sm">Chute de tension max</div>
                  <div className={`text-center font-mono ${simulationComparison.before.maxVoltageDrop > 10 ? 'text-destructive' : 'text-foreground'}`}>
                    {simulationComparison.before.maxVoltageDrop.toFixed(2)}%
                  </div>
                  <div className={`text-center font-mono ${simulationComparison.after.maxVoltageDrop > 10 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {simulationComparison.after.maxVoltageDrop.toFixed(2)}%
                  </div>
                </div>

                {/* Losses */}
                <div className="grid grid-cols-3 gap-2 items-center bg-muted/50 rounded-md p-2">
                  <div className="text-sm">Pertes</div>
                  <div className="text-center font-mono">
                    {simulationComparison.before.losses.toFixed(3)} kW
                  </div>
                  <div className="text-center font-mono text-emerald-600">
                    {simulationComparison.after.losses.toFixed(3)} kW
                  </div>
                </div>

                {/* EN50160 Compliance */}
                <div className="grid grid-cols-3 gap-2 items-center bg-muted/50 rounded-md p-2">
                  <div className="text-sm">Conformité EN50160</div>
                  <div className="flex justify-center">
                    {simulationComparison.before.en50160Compliant ? (
                      <Badge variant="default" className="gap-1 bg-emerald-600">
                        <CheckCircle className="h-3 w-3" /> Conforme
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Non conforme
                      </Badge>
                    )}
                  </div>
                  <div className="flex justify-center">
                    {simulationComparison.after.en50160Compliant ? (
                      <Badge variant="default" className="gap-1 bg-emerald-600">
                        <CheckCircle className="h-3 w-3" /> Conforme
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Non conforme
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Gains */}
                <div className="border-t pt-3 mt-3">
                  <h4 className="text-sm font-medium mb-2">Gains estimés</h4>
                  <div className="flex gap-4">
                    <div className={`flex-1 text-center p-2 rounded-md ${simulationComparison.gains.voltageDropReduction > 0 ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-muted'}`}>
                      <div className="text-lg font-bold">
                        {simulationComparison.gains.voltageDropReduction > 0 ? '-' : ''}{simulationComparison.gains.voltageDropReduction.toFixed(1)}%
                      </div>
                      <div className="text-xs">Chute de tension</div>
                    </div>
                    <div className={`flex-1 text-center p-2 rounded-md ${simulationComparison.gains.lossesReduction > 0 ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-muted'}`}>
                      <div className="text-lg font-bold">
                        {simulationComparison.gains.lossesReduction > 0 ? '-' : ''}{simulationComparison.gains.lossesReduction.toFixed(1)}%
                      </div>
                      <div className="text-xs">Pertes</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={() => setShowResultsPopup(false)}>
                Fermer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
