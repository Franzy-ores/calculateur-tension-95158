import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { toast } from "sonner";

interface PhaseDistributionSlidersProps {
  type: 'charges' | 'productions';
  title: string;
}

export const PhaseDistributionSliders = ({ type, title }: PhaseDistributionSlidersProps) => {
  const { currentProject, updateProjectConfig } = useNetworkStore();
  
  if (!currentProject || !currentProject.manualPhaseDistribution) return null;
  
  const distribution = currentProject.manualPhaseDistribution[type];
  
  // Déterminer le mode d'affichage selon le voltage
  const is230V = currentProject.voltageSystem === "TRIPHASÉ_230V";
  const phaseLabels = is230V 
    ? { A: "L1-L2", B: "L2-L3", C: "L3-L1" }
    : { A: "L1", B: "L2", C: "L3" };
  const phaseColors = {
    A: "from-red-500 to-red-600",
    B: "from-yellow-500 to-yellow-600", 
    C: "from-blue-500 to-blue-600"
  };
  
  const showResetButton = currentProject.loadModel === 'monophase_reparti' || currentProject.loadModel === 'mixte_mono_poly';
  
  // Calculer le déséquilibre en % par rapport à la moyenne (33.33%)
  const calculateUnbalancePercent = (actualPercent: number): number => {
    const average = 33.33;
    return ((actualPercent - average) / average) * 100;
  };
  
  /**
   * ✅ Calcule la distribution PHYSIQUE RÉELLE sans appliquer les curseurs (Option B)
   * - MONO 230V : contribution physique selon couplage avec facteur √3
   * - MONO 400V : 100% sur phase assignée
   * - TRI/TÉTRA : 33.33% équi-réparti
   * - Charges manuelles : 33.33% équi-réparti
   */
  const calculatePhysicalDistribution = (): { A: number; B: number; C: number } => {
    if (!currentProject?.nodes) {
      return { A: 33.33, B: 33.33, C: 33.34 };
    }
    
    const DELTA_FACTOR = 1 / Math.sqrt(3); // ≈ 0.577
    let totalA = 0, totalB = 0, totalC = 0;
    
    currentProject.nodes.forEach(node => {
      // 1. Clients importés liés à ce nœud
      const linkedClients = currentProject.clientsImportes?.filter(
        client => currentProject.clientLinks?.some(link => 
          link.clientId === client.id && link.nodeId === node.id
        )
      ) || [];
      
      linkedClients.forEach(client => {
        const value = type === 'charges' ? client.puissanceContractuelle_kVA : client.puissancePV_kVA;
        
        if (client.connectionType === 'MONO') {
          if (is230V && client.phaseCoupling) {
            // MONO 230V : contribution physique avec facteur √3
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
            // MONO 400V : 100% sur phase assignée
            if (client.assignedPhase === 'A') totalA += value;
            else if (client.assignedPhase === 'B') totalB += value;
            else if (client.assignedPhase === 'C') totalC += value;
          }
        } else {
          // TRI/TÉTRA : équi-réparti 33.33%
          const perPhase = value / 3;
          totalA += perPhase;
          totalB += perPhase;
          totalC += perPhase;
        }
      });
      
      // 2. Charges manuelles : équi-réparties 33.33%
      if (type === 'charges' && node.clients.length > 0) {
        node.clients.forEach(client => {
          const manualCharge = (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
          const perPhase = manualCharge / 3;
          totalA += perPhase;
          totalB += perPhase;
          totalC += perPhase;
        });
      } else if (type === 'productions' && node.productions.length > 0) {
        node.productions.forEach(production => {
          const manualProd = (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
          const perPhase = manualProd / 3;
          totalA += perPhase;
          totalB += perPhase;
          totalC += perPhase;
        });
      }
    });
    
    // Conversion 230V : phases → couplages
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
    
    // 400V : calcul normal par phases
    const grandTotal = totalA + totalB + totalC;
    if (grandTotal === 0) return { A: 33.33, B: 33.33, C: 33.34 };
    
    return {
      A: (totalA / grandTotal) * 100,
      B: (totalB / grandTotal) * 100,
      C: (totalC / grandTotal) * 100
    };
  };
  
  const initializeToRealDistribution = () => {
    if (!currentProject) return;
    
    // ✅ Calculer la distribution physique réelle SANS curseurs
    const realDistribution = calculatePhysicalDistribution();
    
    // Mettre à jour les curseurs
    updateProjectConfig({
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: realDistribution
      }
    });
    
    const phaseLabelsForToast = is230V 
      ? `L1-L2=${realDistribution.A.toFixed(1)}%, L2-L3=${realDistribution.B.toFixed(1)}%, L3-L1=${realDistribution.C.toFixed(1)}%`
      : `L1=${realDistribution.A.toFixed(1)}%, L2=${realDistribution.B.toFixed(1)}%, L3=${realDistribution.C.toFixed(1)}%`;
    
    toast.success(`${type === 'charges' ? 'Charges' : 'Productions'} réinitialisées à la distribution physique : ${phaseLabelsForToast}`);
  };
  
  
  // Calcul des valeurs kVA par phase (Option B: curseurs universels)
  const calculateKVAValues = () => {
    let totalValue = 0;
    
    // Calculer le total de toutes les charges/productions (MONO + POLY + manuelles)
    currentProject.nodes.forEach(node => {
      // Charges/productions manuelles
      if (type === 'charges' && node.clients && node.clients.length > 0) {
        node.clients.forEach(client => {
          totalValue += (client.S_kVA || 0) * (currentProject.foisonnementCharges / 100);
        });
      } else if (type === 'productions' && node.productions && node.productions.length > 0) {
        node.productions.forEach(production => {
          totalValue += (production.S_kVA || 0) * (currentProject.foisonnementProductions / 100);
        });
      }
      
      // Clients importés (MONO + POLY)
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
    });
    
    // Répartir selon les curseurs (Option B: universels)
    return {
      A: totalValue * (distribution.A / 100),
      B: totalValue * (distribution.B / 100),
      C: totalValue * (distribution.C / 100)
    };
  };
  
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
      <div className="flex justify-center gap-4">
        {(['A', 'B', 'C'] as const).map((phase) => (
          <div key={phase} className="flex flex-col items-center gap-2">
            <Label className="text-xs text-primary-foreground/80 font-medium">{phaseLabels[phase]}</Label>
            
            {/* Vertical Slider avec barre colorée */}
            <div className="relative flex flex-col items-center">
              <div className="relative w-6 h-20 bg-muted rounded-md border">
                {/* Ligne de référence à l'équilibre (33.33%) */}
                <div 
                  className="absolute left-0 right-0 border-t border-white/30 border-dashed"
                  style={{ bottom: '50%' }}
                />
                {/* Barre de progression colorée */}
                <div 
                  className={`absolute bottom-0 w-full bg-gradient-to-t ${colorClasses} rounded-md transition-all duration-200`}
                  style={{ 
                    height: `${(distribution[phase] / 53.33) * 100}%`,
                    opacity: Math.abs(calculateUnbalancePercent(distribution[phase])) > 15 ? 1 : 0.6
                  }}
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
            
            {/* Affichage du déséquilibre */}
            <div className="text-center">
              <div className="text-xs font-mono text-primary-foreground">
                {calculateUnbalancePercent(distribution[phase]) >= 0 ? '+' : ''}
                {calculateUnbalancePercent(distribution[phase]).toFixed(1)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};