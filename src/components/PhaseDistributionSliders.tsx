import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { toast } from "sonner";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/network";

interface PhaseDistributionSlidersProps {
  type: 'charges' | 'productions';
  title: string;
}

export const PhaseDistributionSliders = ({ type, title }: PhaseDistributionSlidersProps) => {
  const { currentProject, updateProjectConfig } = useNetworkStore();
  const isInitialMount = useRef(true);
  
  // ✅ All hooks must be called before any conditional returns
  useEffect(() => {
    // Skip initial mount to avoid overwriting loaded project values
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    // Guard: skip if project not ready
    if (!currentProject || !currentProject.manualPhaseDistribution) {
      return;
    }
    
    const distribution = currentProject.manualPhaseDistribution[type];
    const isForced = type === 'charges' 
      ? currentProject.manualPhaseDistribution?.chargesForced 
      : currentProject.manualPhaseDistribution?.productionsForced;
    
    // Only auto-sync if not forced and in mixte mode
    if (isForced || currentProject.loadModel !== 'mixte_mono_poly') {
      return;
    }
    
    const autoValues = calculateAutoDistributionInternal(currentProject, type);
    
    // Only update if values differ significantly (avoid infinite loops)
    const threshold = 0.5;
    if (Math.abs(autoValues.A - distribution.A) > threshold ||
        Math.abs(autoValues.B - distribution.B) > threshold ||
        Math.abs(autoValues.C - distribution.C) > threshold) {
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: autoValues
        }
      });
    }
  }, [
    currentProject?.clientsImportes, 
    currentProject?.clientLinks,
    currentProject?.foisonnementChargesResidentiel,
    currentProject?.foisonnementChargesIndustriel,
    currentProject?.foisonnementProductions,
    currentProject?.manualPhaseDistribution,
    currentProject?.loadModel,
    type,
    updateProjectConfig
  ]);
  
  if (!currentProject || !currentProject.manualPhaseDistribution) return null;
  
  const distribution = currentProject.manualPhaseDistribution[type];
  const isForced = type === 'charges' 
    ? currentProject.manualPhaseDistribution?.chargesForced 
    : currentProject.manualPhaseDistribution?.productionsForced;
  
  // Déterminer le mode d'affichage selon le voltage
  const is230V = currentProject.voltageSystem === "TRIPHASÉ_230V";
  const phaseLabels = is230V 
    ? { A: "L1-L2", B: "L2-L3", C: "L3-L1" }
    : { A: "L1", B: "L2", C: "L3" };
  
  // Toujours afficher le bouton Reset en mode mixte (pour revenir en mode auto)
  const showResetButton = currentProject.loadModel === 'mixte_mono_poly';
  
  // Calculer le déséquilibre en % par rapport à la moyenne (33.33%)
  const calculateUnbalancePercent = (actualPercent: number): number => {
    const average = 33.33;
    return ((actualPercent - average) / average) * 100;
  };
  
  const initializeToRealDistribution = () => {
    if (!currentProject) return;
    
    const realDistribution = calculateAutoDistributionInternal(currentProject, type);
    
    updateProjectConfig({
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: realDistribution,
        [`${type}Forced`]: false  // Retour en mode automatique
      }
    });
    
    const phaseLabelsForToast = is230V 
      ? `L1-L2=${realDistribution.A.toFixed(1)}%, L2-L3=${realDistribution.B.toFixed(1)}%, L3-L1=${realDistribution.C.toFixed(1)}%`
      : `L1=${realDistribution.A.toFixed(1)}%, L2=${realDistribution.B.toFixed(1)}%, L3=${realDistribution.C.toFixed(1)}%`;
    
    toast.success(`${type === 'charges' ? 'Charges' : 'Productions'} synchronisées avec le tableau`);
  };
  
  const handlePhaseChange = (phase: 'A' | 'B' | 'C', newValue: number) => {
    const otherPhases = phase === 'A' ? ['B', 'C'] as const : 
                      phase === 'B' ? ['A', 'C'] as const : 
                      ['A', 'B'] as const;
    
    const remaining = 100 - newValue;
    const otherTotal = distribution[otherPhases[0]] + distribution[otherPhases[1]];
    
    let newDistribution: { A: number; B: number; C: number };
    
    if (otherTotal === 0) {
      const half = remaining / 2;
      newDistribution = {
        ...distribution,
        [phase]: newValue,
        [otherPhases[0]]: half,
        [otherPhases[1]]: remaining - half
      };
    } else {
      const ratio0 = distribution[otherPhases[0]] / otherTotal;
      const ratio1 = distribution[otherPhases[1]] / otherTotal;
      
      newDistribution = {
        ...distribution,
        [phase]: newValue,
        [otherPhases[0]]: remaining * ratio0,
        [otherPhases[1]]: remaining * ratio1
      };
    }
    
    // ✅ Marquer comme forcé lors d'une modification manuelle
    updateProjectConfig({
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: newDistribution,
        [`${type}Forced`]: true
      }
    });
  };

  // Couleur selon le type
  const getEcartColor = (ecart: number) => {
    const absEcart = Math.abs(ecart);
    if (absEcart < 5) return 'text-green-600 dark:text-green-400';
    if (absEcart < 15) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className={cn(
      "flex items-center gap-3 p-1.5 rounded-md transition-colors",
      isForced && "bg-warning/20 border border-warning"
    )}>
      <Label className="text-[10px] text-muted-foreground w-16">{title}</Label>
      
      {(['A', 'B', 'C'] as const).map((phase) => {
        const ecart = calculateUnbalancePercent(distribution[phase]);
        return (
          <div key={phase} className="flex items-center gap-1.5 min-w-[100px]">
            <span className="text-[10px] text-muted-foreground w-8">{phaseLabels[phase]}</span>
            <Slider
              value={[distribution[phase]]}
              onValueChange={(values) => handlePhaseChange(phase, values[0])}
              min={13.33}
              max={53.33}
              step={0.1}
              className="w-16 h-3"
            />
            <span className={`text-[10px] font-mono w-10 text-right ${getEcartColor(ecart)}`}>
              {ecart >= 0 ? '+' : ''}{ecart.toFixed(0)}%
            </span>
          </div>
        );
      })}
      
      {showResetButton && (
        <TooltipProvider>
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
              <p>{isForced ? "Revenir en mode automatique" : "Synchroniser avec le tableau"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

/**
 * ✅ Calcule la distribution automatique depuis les données clients (pour sync avec tableau)
 * Fonction extraite pour pouvoir être appelée dans le useEffect avant le return conditionnel
 */
function calculateAutoDistributionInternal(
  project: Project | null,
  type: 'charges' | 'productions'
): { A: number; B: number; C: number } {
  if (!project?.nodes) {
    return { A: 33.33, B: 33.33, C: 33.34 };
  }
  
  const is230V = project.voltageSystem === "TRIPHASÉ_230V";
  const DELTA_FACTOR = 1 / Math.sqrt(3);
  let totalA = 0, totalB = 0, totalC = 0;
  
  const foisonnementResidentiel = project.foisonnementChargesResidentiel ?? 15;
  const foisonnementIndustriel = project.foisonnementChargesIndustriel ?? 70;
  const foisonnementProductions = project.foisonnementProductions ?? 100;
  
  project.nodes.forEach(node => {
    const linkedClients = project.clientsImportes?.filter(
      client => project.clientLinks?.some(link => 
        link.clientId === client.id && link.nodeId === node.id
      )
    ) || [];
    
    linkedClients.forEach(client => {
      const isIndustriel = client.clientType === 'industriel';
      const foisonnement = type === 'charges' 
        ? (isIndustriel ? foisonnementIndustriel : foisonnementResidentiel)
        : foisonnementProductions;
      
      const rawValue = type === 'charges' ? client.puissanceContractuelle_kVA : (client.puissancePV_kVA || 0);
      const value = rawValue * (foisonnement / 100);
      
      if (client.connectionType === 'MONO') {
        if (is230V && client.phaseCoupling) {
          if (client.phaseCoupling === 'A-B') {
            totalA += value * DELTA_FACTOR;
            totalB += value * DELTA_FACTOR;
          } else if (client.phaseCoupling === 'B-C') {
            totalB += value * DELTA_FACTOR;
            totalC += value * DELTA_FACTOR;
          } else if (client.phaseCoupling === 'A-C') {
            totalA += value * DELTA_FACTOR;
            totalC += value * DELTA_FACTOR;
          }
        } else if (client.assignedPhase) {
          if (client.assignedPhase === 'A') totalA += value;
          else if (client.assignedPhase === 'B') totalB += value;
          else if (client.assignedPhase === 'C') totalC += value;
        }
      } else {
        const perPhase = value / 3;
        totalA += perPhase;
        totalB += perPhase;
        totalC += perPhase;
      }
    });
  });
  
  if (is230V) {
    const couplingAB = totalA + totalB - totalC;
    const couplingBC = totalB + totalC - totalA;
    const couplingAC = totalA + totalC - totalB;
    const grandTotal = couplingAB + couplingBC + couplingAC;
    
    if (grandTotal === 0) return { A: 33.33, B: 33.33, C: 33.34 };
    
    return {
      A: (couplingAB / grandTotal) * 100,
      B: (couplingBC / grandTotal) * 100,
      C: (couplingAC / grandTotal) * 100
    };
  }
  
  const grandTotal = totalA + totalB + totalC;
  if (grandTotal === 0) return { A: 33.33, B: 33.33, C: 33.34 };
  
  return {
    A: (totalA / grandTotal) * 100,
    B: (totalB / grandTotal) * 100,
    C: (totalC / grandTotal) * 100
  };
}
