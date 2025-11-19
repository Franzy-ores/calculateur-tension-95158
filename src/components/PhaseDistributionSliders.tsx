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
  
  // ✅ Lit la répartition réelle directement depuis le tableau général (autoPhaseDistribution)
  const calculateRealDistributionFromTable = (): { A: number; B: number; C: number } => {
    if (!currentProject?.nodes) {
      return { A: 33.33, B: 33.33, C: 33.34 };
    }
    
    let totalA = 0, totalB = 0, totalC = 0;
    
    // Parcourir tous les nodes et additionner selon le mode actif
    currentProject.nodes.forEach(node => {
      if (node.autoPhaseDistribution) {
        if (currentMode === 'mono_only') {
          // MODE MONO : lire uniquement les valeurs MONO du tableau
          if (type === 'charges') {
            totalA += node.autoPhaseDistribution.charges.mono.A;
            totalB += node.autoPhaseDistribution.charges.mono.B;
            totalC += node.autoPhaseDistribution.charges.mono.C;
          } else {
            totalA += node.autoPhaseDistribution.productions.mono.A;
            totalB += node.autoPhaseDistribution.productions.mono.B;
            totalC += node.autoPhaseDistribution.productions.mono.C;
          }
        } else {
          // MODE ALL_CLIENTS : MONO réel du tableau + POLY total réparti 1/3-1/3-1/3
          if (type === 'charges') {
            // Lire les MONO
            const monoA = node.autoPhaseDistribution.charges.mono.A;
            const monoB = node.autoPhaseDistribution.charges.mono.B;
            const monoC = node.autoPhaseDistribution.charges.mono.C;
            
            // Lire les POLY et calculer le total POLY invariant des curseurs
            const polyA = node.autoPhaseDistribution.charges.poly.A;
            const polyB = node.autoPhaseDistribution.charges.poly.B;
            const polyC = node.autoPhaseDistribution.charges.poly.C;
            const polyTotal = polyA + polyB + polyC;
            const polyPerPhase = polyTotal / 3;
            
            // Ajouter MONO + POLY équi-réparti
            totalA += monoA + polyPerPhase;
            totalB += monoB + polyPerPhase;
            totalC += monoC + polyPerPhase;
          } else {
            // Même logique pour les productions
            const monoA = node.autoPhaseDistribution.productions.mono.A;
            const monoB = node.autoPhaseDistribution.productions.mono.B;
            const monoC = node.autoPhaseDistribution.productions.mono.C;
            
            const polyA = node.autoPhaseDistribution.productions.poly.A;
            const polyB = node.autoPhaseDistribution.productions.poly.B;
            const polyC = node.autoPhaseDistribution.productions.poly.C;
            const polyTotal = polyA + polyB + polyC;
            const polyPerPhase = polyTotal / 3;
            
            totalA += monoA + polyPerPhase;
            totalB += monoB + polyPerPhase;
            totalC += monoC + polyPerPhase;
          }
        }
      }
    });
    
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
    
    // ✅ TOUJOURS lire les valeurs du tableau général
    const realDistribution = calculateRealDistributionFromTable();
    
    // Mettre à jour les curseurs SANS changer le mode
    updateProjectConfig({
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: realDistribution
      }
    });
    
    const modeLabel = currentMode === 'all_clients' ? 'TOUS les clients (MONO + POLY du tableau)' : 'MONO uniquement (du tableau)';
    toast.success(`${type === 'charges' ? 'Charges' : 'Productions'} réinitialisées (${modeLabel}) : A=${realDistribution.A.toFixed(1)}%, B=${realDistribution.B.toFixed(1)}%, C=${realDistribution.C.toFixed(1)}%`);
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
    
    // 2. Lire les valeurs du tableau général selon le nouveau mode
    // Note: On doit attendre que le mode soit mis à jour dans le store
    // donc on calcule directement avec le newMode
    let totalA = 0, totalB = 0, totalC = 0;
    
    if (currentProject?.nodes) {
      currentProject.nodes.forEach(node => {
        if (node.autoPhaseDistribution) {
          if (newMode === 'mono_only') {
            // MODE MONO : lire uniquement les valeurs MONO du tableau
            if (type === 'charges') {
              totalA += node.autoPhaseDistribution.charges.mono.A;
              totalB += node.autoPhaseDistribution.charges.mono.B;
              totalC += node.autoPhaseDistribution.charges.mono.C;
            } else {
              totalA += node.autoPhaseDistribution.productions.mono.A;
              totalB += node.autoPhaseDistribution.productions.mono.B;
              totalC += node.autoPhaseDistribution.productions.mono.C;
            }
          } else {
            // MODE ALL_CLIENTS : MONO réel du tableau + POLY total réparti 1/3-1/3-1/3
            if (type === 'charges') {
              // Lire les MONO
              const monoA = node.autoPhaseDistribution.charges.mono.A;
              const monoB = node.autoPhaseDistribution.charges.mono.B;
              const monoC = node.autoPhaseDistribution.charges.mono.C;
              
              // Lire les POLY et calculer le total POLY invariant des curseurs
              const polyA = node.autoPhaseDistribution.charges.poly.A;
              const polyB = node.autoPhaseDistribution.charges.poly.B;
              const polyC = node.autoPhaseDistribution.charges.poly.C;
              const polyTotal = polyA + polyB + polyC;
              const polyPerPhase = polyTotal / 3;
              
              // Ajouter MONO + POLY équi-réparti
              totalA += monoA + polyPerPhase;
              totalB += monoB + polyPerPhase;
              totalC += monoC + polyPerPhase;
            } else {
              // Même logique pour les productions
              const monoA = node.autoPhaseDistribution.productions.mono.A;
              const monoB = node.autoPhaseDistribution.productions.mono.B;
              const monoC = node.autoPhaseDistribution.productions.mono.C;
              
              const polyA = node.autoPhaseDistribution.productions.poly.A;
              const polyB = node.autoPhaseDistribution.productions.poly.B;
              const polyC = node.autoPhaseDistribution.productions.poly.C;
              const polyTotal = polyA + polyB + polyC;
              const polyPerPhase = polyTotal / 3;
              
              totalA += monoA + polyPerPhase;
              totalB += monoB + polyPerPhase;
              totalC += monoC + polyPerPhase;
            }
          }
        }
      });
    }
    
    const grandTotal = totalA + totalB + totalC;
    const realDistribution = grandTotal === 0 
      ? { A: 33.33, B: 33.33, C: 33.34 }
      : {
          A: (totalA / grandTotal) * 100,
          B: (totalB / grandTotal) * 100,
          C: (totalC / grandTotal) * 100
        };
    
    updateProjectConfig({
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: realDistribution
      }
    });
    
    const typeLabel = type === 'charges' ? 'charges' : 'productions';
    const modeLabel = newMode === 'all_clients' ? 'TOUS les clients (MONO + POLY du tableau)' : 'MONO uniquement (du tableau)';
    toast.success(`Répartition ${typeLabel} appliquée : ${modeLabel} - A=${realDistribution.A.toFixed(1)}%, B=${realDistribution.B.toFixed(1)}%, C=${realDistribution.C.toFixed(1)}%`);
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