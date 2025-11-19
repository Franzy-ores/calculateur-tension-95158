import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { calculateRealMonoDistributionPercents, calculateRealMonoProductionDistributionPercents } from "@/utils/phaseDistributionCalculator";
import { toast } from "sonner";

interface PhaseDistributionSlidersProps {
  type: 'charges' | 'productions';
  title: string;
}

export const PhaseDistributionSliders = ({ type, title }: PhaseDistributionSlidersProps) => {
  const { currentProject, updateProjectConfig } = useNetworkStore();
  
  if (!currentProject || !currentProject.manualPhaseDistribution) return null;
  
  const distribution = currentProject.manualPhaseDistribution[type];
  const showResetButton = currentProject.loadModel === 'monophase_reparti' || currentProject.loadModel === 'mixte_mono_poly';
  
  // ✅ Obtenir le mode actuel pour ce type (charges ou productions)
  const currentMode = type === 'charges' 
    ? (currentProject.phaseDistributionModeCharges || 'mono_only')
    : (currentProject.phaseDistributionModeProductions || 'mono_only');
  
  // Nouvelle fonction pour calculer la répartition en mode "Tous les clients"
  // MONO : gardent leur répartition selon assignedPhase
  // POLY (TRI + TETRA) : équilibrés à 33.3% par phase
  const calculateBalancedPolyPlusRealMono = (): { A: number; B: number; C: number } => {
    if (!currentProject.clientsImportes || !currentProject.clientLinks) {
      return { A: 33.33, B: 33.33, C: 33.34 };
    }

    let monoA = 0, monoB = 0, monoC = 0;
    let polyTotal = 0;

    // Parcourir tous les clients liés
    currentProject.clientLinks.forEach(link => {
      const client = currentProject.clientsImportes?.find(c => c.id === link.clientId);
      if (!client) return;

      const power = type === 'charges' 
        ? client.puissanceContractuelle_kVA 
        : client.puissancePV_kVA;

      if (client.connectionType === 'MONO' && client.assignedPhase) {
        // MONO : additionner sur la phase assignée
        if (client.assignedPhase === 'A') monoA += power;
        else if (client.assignedPhase === 'B') monoB += power;
        else if (client.assignedPhase === 'C') monoC += power;
      } else if (client.connectionType === 'TRI' || client.connectionType === 'TETRA') {
        // POLY : accumuler pour répartition équilibrée
        polyTotal += power;
      }
    });

    // Répartir les POLY équitablement à 33.3% par phase
    const polyPerPhase = polyTotal / 3;

    // Totaux par phase : MONO + POLY équilibré
    const totalA = monoA + polyPerPhase;
    const totalB = monoB + polyPerPhase;
    const totalC = monoC + polyPerPhase;
    const grandTotal = totalA + totalB + totalC;

    // Éviter division par zéro
    if (grandTotal === 0) {
      return { A: 33.33, B: 33.33, C: 33.34 };
    }

    return {
      A: (totalA / grandTotal) * 100,
      B: (totalB / grandTotal) * 100,
      C: (totalC / grandTotal) * 100
    };
  };
  
  const initializeToRealDistribution = () => {
    if (!currentProject) return;
    
    // FORCER le mode MONO uniquement
    let realDistribution: { A: number; B: number; C: number };
    
    // Calculer la répartition réelle des MONO
    if (type === 'charges') {
      realDistribution = calculateRealMonoDistributionPercents(
        currentProject.nodes,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      );
    } else {
      realDistribution = calculateRealMonoProductionDistributionPercents(
        currentProject.nodes,
        currentProject.clientsImportes || [],
        currentProject.clientLinks || []
      );
    }
    
    // Mettre à jour les curseurs ET forcer le mode mono_only
    const updatedConfig: any = {
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: realDistribution
      }
    };
    
    // Forcer le passage en mode MONO uniquement
    if (type === 'charges') {
      updatedConfig.phaseDistributionModeCharges = 'mono_only';
    } else {
      updatedConfig.phaseDistributionModeProductions = 'mono_only';
    }
    
    updateProjectConfig(updatedConfig);
    
    toast.success(`${type === 'charges' ? 'Charges' : 'Productions'} réinitialisées en mode MONO uniquement : A=${realDistribution.A.toFixed(1)}%, B=${realDistribution.B.toFixed(1)}%, C=${realDistribution.C.toFixed(1)}%`);
  };
  
  const handleModeChange = (newMode: 'mono_only' | 'all_clients') => {
    // ✅ 1. Mettre à jour le mode SEULEMENT pour le type concerné
    if (type === 'charges') {
      updateProjectConfig({
        phaseDistributionModeCharges: newMode
      });
    } else {
      updateProjectConfig({
        phaseDistributionModeProductions: newMode
      });
    }
    
    // 2. Recalculer automatiquement les pourcentages en fonction du mode
    if (newMode === 'all_clients') {
      // Passer en mode "tous les clients" : POLY équilibrés + MONO répartition réelle
      const realDistribution = calculateBalancedPolyPlusRealMono();
      
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: realDistribution  // ✅ Seulement le type actuel
        }
      });
      
      const typeLabel = type === 'charges' ? 'charges' : 'productions';
      toast.success(`Répartition ${typeLabel} appliquée à TOUS les clients (poly équilibrés + mono répartition réelle) : A=${realDistribution.A.toFixed(1)}%, B=${realDistribution.B.toFixed(1)}%, C=${realDistribution.C.toFixed(1)}%`);
      
    } else {
      // Revenir en mode "mono uniquement" : recalculer avec MONO seulement
      let realDistribution: { A: number; B: number; C: number };
      
      if (type === 'charges') {
        realDistribution = calculateRealMonoDistributionPercents(
          currentProject.nodes,
          currentProject.clientsImportes || [],
          currentProject.clientLinks || []
        );
      } else {
        realDistribution = calculateRealMonoProductionDistributionPercents(
          currentProject.nodes,
          currentProject.clientsImportes || [],
          currentProject.clientLinks || []
        );
      }
      
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: realDistribution  // ✅ Seulement le type actuel
        }
      });
      
      const typeLabel = type === 'charges' ? 'charges' : 'productions';
      toast.success(`Répartition ${typeLabel} appliquée aux MONO uniquement : A=${realDistribution.A.toFixed(1)}%, B=${realDistribution.B.toFixed(1)}%, C=${realDistribution.C.toFixed(1)}%`);
    }
  };
  
  // Calcul des valeurs kVA par phase
  const calculateKVAValues = () => {
    let totalValue = 0;
    
    if (currentProject.loadModel === 'mixte_mono_poly') {
      // ✅ Déterminer quel mode est actif pour ce type
      const mode = type === 'charges' 
        ? (currentProject.phaseDistributionModeCharges || 'mono_only')
        : (currentProject.phaseDistributionModeProductions || 'mono_only');
      
      currentProject.nodes.forEach(node => {
        if (mode === 'mono_only') {
          // MODE MONO UNIQUEMENT : ne compter que les charges/productions MONO
          
          // Charges manuelles MONO
          if (type === 'charges' && node.manualLoadType === 'MONO' && node.clients.length > 0) {
            node.clients.forEach(client => {
              totalValue += (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
            });
          } else if (type === 'productions' && node.manualLoadType === 'MONO' && node.productions.length > 0) {
            node.productions.forEach(production => {
              totalValue += (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
            });
          }
          
          // Clients importés MONO
          if (node.autoPhaseDistribution) {
            if (type === 'charges') {
              totalValue += node.autoPhaseDistribution.charges.mono.A + 
                           node.autoPhaseDistribution.charges.mono.B + 
                           node.autoPhaseDistribution.charges.mono.C;
            } else {
              totalValue += node.autoPhaseDistribution.productions.mono.A + 
                           node.autoPhaseDistribution.productions.mono.B + 
                           node.autoPhaseDistribution.productions.mono.C;
            }
          }
          
        } else {
          // MODE TOUS LES CLIENTS : compter MONO + POLY
          
          // Toutes les charges manuelles (MONO + POLY/TETRA)
          if (type === 'charges' && node.clients.length > 0) {
            node.clients.forEach(client => {
              totalValue += (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
            });
          } else if (type === 'productions' && node.productions.length > 0) {
            node.productions.forEach(production => {
              totalValue += (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
            });
          }
          
          // Tous les clients importés (MONO + POLY)
          if (node.autoPhaseDistribution) {
            if (type === 'charges') {
              totalValue += node.autoPhaseDistribution.charges.mono.A + 
                           node.autoPhaseDistribution.charges.mono.B + 
                           node.autoPhaseDistribution.charges.mono.C +
                           node.autoPhaseDistribution.charges.poly.A + 
                           node.autoPhaseDistribution.charges.poly.B + 
                           node.autoPhaseDistribution.charges.poly.C;
            } else {
              totalValue += node.autoPhaseDistribution.productions.mono.A + 
                           node.autoPhaseDistribution.productions.mono.B + 
                           node.autoPhaseDistribution.productions.mono.C +
                           node.autoPhaseDistribution.productions.poly.A + 
                           node.autoPhaseDistribution.productions.poly.B + 
                           node.autoPhaseDistribution.productions.poly.C;
            }
          }
        }
      });
    } else {
      // MODE MONOPHASE_REPARTI : compter toutes les charges comme avant
      currentProject.nodes.forEach(node => {
        if (type === 'charges' && node.clients && node.clients.length > 0) {
          node.clients.forEach(client => {
            totalValue += (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
          });
        } else if (type === 'productions' && node.productions && node.productions.length > 0) {
          node.productions.forEach(production => {
            totalValue += (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
          });
        }
      });
    }
    
    return {
      A: totalValue * (distribution.A / 100),
      B: totalValue * (distribution.B / 100),
      C: totalValue * (distribution.C / 100)
    };
  };

  const kvaValues = calculateKVAValues();
  
  const handlePhaseChange = (phase: 'A' | 'B' | 'C', newValue: number) => {
    const otherPhases = phase === 'A' ? ['B', 'C'] as const : 
                      phase === 'B' ? ['A', 'C'] as const : 
                      ['A', 'B'] as const;
    
    // Calculer ce qui reste à répartir sur les deux autres phases
    const remaining = 100 - newValue;
    const otherTotal = distribution[otherPhases[0]] + distribution[otherPhases[1]];
    
    // Si les autres phases sont à 0, répartir équitablement
    if (otherTotal === 0) {
      const half = remaining / 2;
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: {
            ...distribution,
            [phase]: newValue,
            [otherPhases[0]]: half,
            [otherPhases[1]]: remaining - half
          }
        }
      });
    } else {
      // Maintenir les proportions relatives entre les deux autres phases
      const ratio0 = distribution[otherPhases[0]] / otherTotal;
      const ratio1 = distribution[otherPhases[1]] / otherTotal;
      
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: {
            ...distribution,
            [phase]: newValue,
            [otherPhases[0]]: remaining * ratio0,
            [otherPhases[1]]: remaining * ratio1
          }
        }
      });
    }
  };

  const colorClasses = type === 'charges' 
    ? 'from-blue-500 to-blue-300' 
    : 'from-green-500 to-green-300';

  return (
    <div className="flex flex-col gap-3 p-3 bg-white/5 rounded border border-white/10">
      <div className="flex items-center justify-center gap-2">
        <Label className="text-xs font-medium text-primary-foreground text-center">{title}</Label>
        {showResetButton && (
          <TooltipProvider>
            {currentProject.loadModel === 'mixte_mono_poly' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={initializeToRealDistribution}
                    className="h-6 w-6"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Réinitialiser avec répartition réelle</p>
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        )}
      </div>
      {currentProject.loadModel === 'mixte_mono_poly' && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-center text-primary-foreground/80">Appliquer à :</Label>
          <RadioGroup 
            value={currentMode} 
            onValueChange={handleModeChange}
            className="flex justify-center gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="mono_only" id={`${type}-mono_only`} />
              <Label 
                htmlFor={`${type}-mono_only`} 
                className="text-xs text-primary-foreground cursor-pointer"
              >
                MONO uniquement
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="all_clients" id={`${type}-all_clients`} />
              <Label 
                htmlFor={`${type}-all_clients`} 
                className="text-xs text-primary-foreground cursor-pointer"
              >
                Tous les clients
              </Label>
            </div>
          </RadioGroup>
        </div>
      )}
      <div className="flex justify-center gap-4">
        {(['A', 'B', 'C'] as const).map((phase) => (
          <div key={phase} className="flex flex-col items-center gap-2">
            <Label className="text-xs text-primary-foreground/80 font-medium">{phase}</Label>
            
            {/* Vertical Slider avec barre colorée */}
            <div className="relative flex flex-col items-center">
              <div className="relative w-6 h-20 bg-muted rounded-md border">
                {/* Barre de progression colorée */}
                <div 
                  className={`absolute bottom-0 w-full bg-gradient-to-t ${colorClasses} rounded-md transition-all duration-200`}
                  style={{ height: `${(distribution[phase] / 53.33) * 100}%` }}
                />
                {/* Curseur traditionnel par-dessus */}
                <Slider
                  value={[distribution[phase]]}
                  onValueChange={(values) => handlePhaseChange(phase, values[0])}
                  min={13.33}
                  max={53.33}
                  step={0.1}
                  orientation="vertical"
                  className="absolute inset-0 h-20 opacity-80"
                />
              </div>
            </div>
            
            {/* Affichage des valeurs */}
            <div className="text-center">
              <div className="text-xs font-mono text-primary-foreground">
                {distribution[phase].toFixed(1)}%
              </div>
              <div className="text-xs text-primary-foreground/80">
                {kvaValues[phase].toFixed(1)}kVA
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};