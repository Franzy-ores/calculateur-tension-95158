import React from 'react';
import { useNetworkStore } from "@/store/networkStore";

interface NodePhaseDisplayProps {
  nodeId: string;
}

export const NodePhaseDisplay = ({ nodeId }: NodePhaseDisplayProps) => {
  const { calculationResults, simulationResults, selectedScenario, currentProject, simulationEquipment, isSimulationActive } = useNetworkStore();
  
  if (!currentProject || (currentProject.loadModel !== 'monophase_reparti' && currentProject.loadModel !== 'mixte_mono_poly')) {
    return null;
  }

  const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                               simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
  
  const useSimulation = isSimulationActive && activeEquipmentCount > 0;
  const resultsToUse = useSimulation ? simulationResults : calculationResults;
  
  if (!resultsToUse[selectedScenario]?.nodeMetricsPerPhase) {
    return null;
  }

  const nodeMetrics = resultsToUse[selectedScenario]!.nodeMetricsPerPhase!
    .find(nm => nm.nodeId === nodeId);
    
  if (!nodeMetrics) {
    return null;
  }

  const { voltagesPerPhase, voltageDropsPerPhase, sequenceComponents } = nodeMetrics;

  const getDeviationColor = (deviation: number) => {
    const absDeviation = Math.abs(deviation);
    if (absDeviation > 10) return 'text-destructive';
    if (absDeviation > 8) return 'text-orange-500';
    return 'text-muted-foreground';
  };

  const formatDeviation = (deviation: number) => {
    return `${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%`;
  };

  const is230V = currentProject?.voltageSystem === 'TRIPHASÉ_230V';
  const phaseLabels = is230V 
    ? { A: 'L1-L2', B: 'L2-L3', C: 'L3-L1' }
    : { A: 'L1', B: 'L2', C: 'L3' };

  const getKuColor = (ku: number) => {
    if (ku > 2) return 'text-destructive';
    if (ku > 1.5) return 'text-orange-500';
    return 'text-green-600';
  };

  const getKuIcon = (ku: number) => {
    if (ku > 2) return '❌';
    if (ku > 1.5) return '⚠️';
    return '✅';
  };

  return (
    <div className="text-xs bg-background/90 border rounded px-2 py-1 space-y-1">
      <div className="font-medium text-foreground">Tensions par phase:</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="text-center">
          <div className="font-medium text-muted-foreground">{phaseLabels.A}</div>
          <div className="text-foreground">{voltagesPerPhase.A.toFixed(1)}V</div>
          <div className="text-muted-foreground text-[10px]">ΔU: {voltageDropsPerPhase.A.toFixed(1)}V</div>
          {nodeMetrics.deviationsPerPhase && (
            <div className={`text-[10px] font-medium ${getDeviationColor(nodeMetrics.deviationsPerPhase.A)}`}>
              {formatDeviation(nodeMetrics.deviationsPerPhase.A)}
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="font-medium text-muted-foreground">{phaseLabels.B}</div>
          <div className="text-foreground">{voltagesPerPhase.B.toFixed(1)}V</div>
          <div className="text-muted-foreground text-[10px]">ΔU: {voltageDropsPerPhase.B.toFixed(1)}V</div>
          {nodeMetrics.deviationsPerPhase && (
            <div className={`text-[10px] font-medium ${getDeviationColor(nodeMetrics.deviationsPerPhase.B)}`}>
              {formatDeviation(nodeMetrics.deviationsPerPhase.B)}
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="font-medium text-muted-foreground">{phaseLabels.C}</div>
          <div className="text-foreground">{voltagesPerPhase.C.toFixed(1)}V</div>
          <div className="text-muted-foreground text-[10px]">ΔU: {voltageDropsPerPhase.C.toFixed(1)}V</div>
          {nodeMetrics.deviationsPerPhase && (
            <div className={`text-[10px] font-medium ${getDeviationColor(nodeMetrics.deviationsPerPhase.C)}`}>
              {formatDeviation(nodeMetrics.deviationsPerPhase.C)}
            </div>
          )}
        </div>
      </div>

      {/* Composantes de séquence (400V et 230V) */}
      {sequenceComponents && (
        <div className="border-t border-border pt-1 mt-1 space-y-0.5">
          <div className="font-medium text-foreground">Séquences:</div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <div className="text-center">
              <div className="font-medium text-muted-foreground">U1 (dir.)</div>
              <div className="text-foreground">{sequenceComponents.U1_mag.toFixed(1)}V</div>
              <div className="text-muted-foreground">∠ {sequenceComponents.U1_angle_deg.toFixed(1)}°</div>
            </div>
            <div className="text-center">
              <div className="font-medium text-muted-foreground">U2 (inv.)</div>
              <div className="text-foreground">{sequenceComponents.U2_mag.toFixed(1)}V</div>
              <div className="text-muted-foreground">∠ {sequenceComponents.U2_angle_deg.toFixed(1)}°</div>
            </div>
            <div className="text-center">
              <div className="font-medium text-muted-foreground">U0 (homo.)</div>
              <div className="text-foreground">{sequenceComponents.U0_mag.toFixed(1)}V</div>
              <div className="text-muted-foreground">∠ {sequenceComponents.U0_angle_deg.toFixed(1)}°</div>
            </div>
          </div>
          <div className={`text-center text-[10px] font-medium ${getKuColor(sequenceComponents.ku_percent)}`}>
            ku = {sequenceComponents.ku_percent.toFixed(2)}% {getKuIcon(sequenceComponents.ku_percent)} (EN 50160 ≤ 2%)
          </div>
        </div>
      )}
    </div>
  );
};