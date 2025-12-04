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
import { Cable, ArrowRightLeft, CheckCircle, AlertTriangle, X } from 'lucide-react';

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
  const { currentProject, calculationResults, selectedScenario } = useNetworkStore();
  
  const [selectedTargetSection, setSelectedTargetSection] = useState<string>('baxb-95');
  const [selectedCableTypes, setSelectedCableTypes] = useState<string[]>([]);
  const [showResultsPopup, setShowResultsPopup] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationComparisonResult | null>(null);
  const [isSimulationActive, setIsSimulationActive] = useState(false);

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

  const runSimulation = () => {
    if (!currentProject || selectedCableTypes.length === 0) return;

    const currentResult = calculationResults[selectedScenario];
    
    // Get target cable type characteristics
    const targetCableType = currentProject.cableTypes.find(ct => ct.id === selectedTargetSection);
    if (!targetCableType) return;

    // Calculate current state
    const beforeMaxVoltageDrop = currentResult?.maxVoltageDropPercent ?? 0;
    const beforeLosses = currentResult?.globalLosses_kW ?? 0;
    const beforeCompliant = beforeMaxVoltageDrop <= 10; // EN50160 threshold

    // Simulate replacement - estimate improvements based on cable characteristics
    let estimatedVoltageDropReduction = 0;
    let estimatedLossesReduction = 0;
    let replacedCount = 0;

    currentProject.cables.forEach(cable => {
      if (cable.pose === 'AÉRIEN' && selectedCableTypes.includes(cable.typeId)) {
        const originalType = currentProject.cableTypes.find(ct => ct.id === cable.typeId);
        if (originalType) {
          // Calculate improvement ratio based on resistance difference
          const resistanceRatio = targetCableType.R12_ohm_per_km / originalType.R12_ohm_per_km;
          const cableLength = cable.length_m / 1000; // Convert to km
          
          // Estimate voltage drop improvement (proportional to resistance reduction)
          const voltageDropContribution = (originalType.R12_ohm_per_km * cableLength) * (1 - resistanceRatio);
          estimatedVoltageDropReduction += voltageDropContribution * 0.5; // Factor based on current flow
          
          // Estimate losses improvement (proportional to R reduction)
          estimatedLossesReduction += (1 - resistanceRatio) * 0.1 * cableLength; // Simplified estimation
          
          replacedCount++;
        }
      }
    });

    // Calculate after values
    const afterMaxVoltageDrop = Math.max(0, beforeMaxVoltageDrop - estimatedVoltageDropReduction);
    const afterLosses = Math.max(0, beforeLosses - estimatedLossesReduction);
    const afterCompliant = afterMaxVoltageDrop <= 10;

    const result: SimulationComparisonResult = {
      before: {
        maxVoltageDrop: beforeMaxVoltageDrop,
        losses: beforeLosses,
        en50160Compliant: beforeCompliant,
      },
      after: {
        maxVoltageDrop: afterMaxVoltageDrop,
        losses: afterLosses,
        en50160Compliant: afterCompliant,
      },
      gains: {
        voltageDropReduction: beforeMaxVoltageDrop > 0 
          ? ((beforeMaxVoltageDrop - afterMaxVoltageDrop) / beforeMaxVoltageDrop) * 100 
          : 0,
        lossesReduction: beforeLosses > 0 
          ? ((beforeLosses - afterLosses) / beforeLosses) * 100 
          : 0,
      },
      replacedCablesCount: replacedCount,
    };

    setSimulationResult(result);
    setShowResultsPopup(true);
    setIsSimulationActive(true);
  };

  const cancelSimulation = () => {
    setIsSimulationActive(false);
    setSimulationResult(null);
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
            disabled={isSimulationActive}
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
                disabled={isSimulationActive}
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
                      disabled={isSimulationActive}
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
        {totalCablesToReplace > 0 && (
          <div className="bg-primary/10 rounded-md p-2 text-sm">
            <span className="font-medium">{totalCablesToReplace}</span> câble{totalCablesToReplace > 1 ? 's' : ''} sera{totalCablesToReplace > 1 ? 'ont' : ''} remplacé{totalCablesToReplace > 1 ? 's' : ''} par <span className="font-medium">{TARGET_SECTIONS.find(s => s.id === selectedTargetSection)?.label}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {!isSimulationActive ? (
            <Button 
              onClick={runSimulation}
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
                Voir résultats
              </Button>
              <Button 
                variant="destructive"
                onClick={cancelSimulation}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-2" />
                Annuler simulation
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
                Comparaison avant/après remplacement de {simulationResult?.replacedCablesCount} câble(s)
              </DialogDescription>
            </DialogHeader>

            {simulationResult && (
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
                  <div className={`text-center font-mono ${simulationResult.before.maxVoltageDrop > 10 ? 'text-destructive' : 'text-foreground'}`}>
                    {simulationResult.before.maxVoltageDrop.toFixed(2)}%
                  </div>
                  <div className={`text-center font-mono ${simulationResult.after.maxVoltageDrop > 10 ? 'text-destructive' : 'text-success'}`}>
                    {simulationResult.after.maxVoltageDrop.toFixed(2)}%
                  </div>
                </div>

                {/* Losses */}
                <div className="grid grid-cols-3 gap-2 items-center bg-muted/50 rounded-md p-2">
                  <div className="text-sm">Pertes</div>
                  <div className="text-center font-mono">
                    {simulationResult.before.losses.toFixed(3)} kW
                  </div>
                  <div className="text-center font-mono text-success">
                    {simulationResult.after.losses.toFixed(3)} kW
                  </div>
                </div>

                {/* EN50160 Compliance */}
                <div className="grid grid-cols-3 gap-2 items-center bg-muted/50 rounded-md p-2">
                  <div className="text-sm">Conformité EN50160</div>
                  <div className="flex justify-center">
                    {simulationResult.before.en50160Compliant ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle className="h-3 w-3" /> Conforme
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Non conforme
                      </Badge>
                    )}
                  </div>
                  <div className="flex justify-center">
                    {simulationResult.after.en50160Compliant ? (
                      <Badge variant="success" className="gap-1">
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
                    <div className={`flex-1 text-center p-2 rounded-md ${simulationResult.gains.voltageDropReduction > 0 ? 'bg-success/20 text-success' : 'bg-muted'}`}>
                      <div className="text-lg font-bold">
                        {simulationResult.gains.voltageDropReduction > 0 ? '-' : ''}{simulationResult.gains.voltageDropReduction.toFixed(1)}%
                      </div>
                      <div className="text-xs">Chute de tension</div>
                    </div>
                    <div className={`flex-1 text-center p-2 rounded-md ${simulationResult.gains.lossesReduction > 0 ? 'bg-success/20 text-success' : 'bg-muted'}`}>
                      <div className="text-lg font-bold">
                        {simulationResult.gains.lossesReduction > 0 ? '-' : ''}{simulationResult.gains.lossesReduction.toFixed(1)}%
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
