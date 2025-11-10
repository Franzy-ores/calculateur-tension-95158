import React from 'react';
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useNetworkStore } from "@/store/networkStore";
import { calculateProjectUnbalance } from "@/utils/phaseDistributionCalculator";

export const PhaseDistributionDisplay = () => {
  const { currentProject } = useNetworkStore();
  
  if (!currentProject || currentProject.loadModel !== 'mixte_mono_poly') {
    return null;
  }

  // Calculer le déséquilibre global du projet
  const { unbalancePercent, status, phaseLoads } = calculateProjectUnbalance(
    currentProject.nodes
  );
  
  // Compter les clients par type
  const clientStats = {
    mono: 0,
    tri: 0,
    tetra: 0
  };
  
  currentProject.clientsImportes?.forEach(client => {
    if (client.connectionType === 'MONO') clientStats.mono++;
    else if (client.connectionType === 'TRI') clientStats.tri++;
    else if (client.connectionType === 'TETRA') clientStats.tetra++;
  });
  
  // Badge de statut
  const statusBadge = {
    normal: { variant: 'default' as const, label: '✓ Normal', color: 'text-green-600' },
    warning: { variant: 'secondary' as const, label: '⚠️ Attention', color: 'text-yellow-600' },
    critical: { variant: 'destructive' as const, label: '🔴 Critique', color: 'text-red-600' }
  }[status];

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">
          📊 Distribution de phase (mode mixte)
        </Label>
        <Badge variant={statusBadge.variant}>
          {statusBadge.label}
        </Badge>
      </div>
      
      {/* Statistiques clients */}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="p-2 bg-background rounded border">
          <div className="text-xs text-muted-foreground">Clients MONO</div>
          <div className="text-lg font-bold">{clientStats.mono}</div>
        </div>
        <div className="p-2 bg-background rounded border">
          <div className="text-xs text-muted-foreground">Clients TRI</div>
          <div className="text-lg font-bold">{clientStats.tri}</div>
        </div>
        <div className="p-2 bg-background rounded border">
          <div className="text-xs text-muted-foreground">Clients TÉTRA</div>
          <div className="text-lg font-bold">{clientStats.tetra}</div>
        </div>
      </div>
      
      {/* Distribution par phase */}
      <div className="space-y-2">
        <Label className="text-sm">Charges totales par phase</Label>
        
        {['A', 'B', 'C'].map(phase => {
          const load = phaseLoads[phase as 'A' | 'B' | 'C'];
          const moyenne = (phaseLoads.A + phaseLoads.B + phaseLoads.C) / 3;
          const ecart = moyenne > 0 ? ((load - moyenne) / moyenne * 100) : 0;
          
          return (
            <div key={phase} className="flex items-center justify-between p-2 bg-background rounded border">
              <span className="font-medium">Phase {phase}</span>
              <div className="text-right">
                <div className="font-bold">{load.toFixed(1)} kVA</div>
                <div className={`text-xs ${
                  Math.abs(ecart) < 10 ? 'text-green-600' : 
                  Math.abs(ecart) < 20 ? 'text-yellow-600' : 
                  'text-red-600'
                }`}>
                  {ecart > 0 ? '+' : ''}{ecart.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Déséquilibre global */}
      <div className="pt-2 border-t">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Déséquilibre maximal</span>
          <span className={`text-lg font-bold ${statusBadge.color}`}>
            {unbalancePercent.toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Seuils : Normal &lt;10%, Attention 10-20%, Critique &gt;20%
        </p>
      </div>
    </div>
  );
};
