import React from 'react';
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNetworkStore } from "@/store/networkStore";
import { calculateProjectUnbalance } from "@/utils/phaseDistributionCalculator";
import { RefreshCw } from "lucide-react";

export const PhaseDistributionDisplay = () => {
  const { currentProject, rebalanceAllMonoClients } = useNetworkStore();
  
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
  
  // Badge de statut avec couleurs sémantiques
  const statusBadge = {
    normal: { variant: 'default' as const, label: '✓ Normal', color: 'text-success' },
    warning: { variant: 'secondary' as const, label: '⚠️ Attention', color: 'text-accent' },
    critical: { variant: 'destructive' as const, label: '🔴 Critique', color: 'text-destructive' }
  }[status];

  return (
    <div className="flex items-center gap-3 p-2 bg-white/5 rounded border border-white/10">
      {/* Titre et badge */}
      <div className="flex items-center gap-2 min-w-[200px]">
        <Label className="text-xs font-medium text-primary-foreground">
          📊 Distribution de phase
        </Label>
        <Badge variant={statusBadge.variant} className="text-xs px-1.5 py-0">
          {statusBadge.label}
        </Badge>
      </div>
      
      {/* Statistiques clients compactes */}
      <div className="flex items-center gap-2 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-primary-foreground/60">MONO:</span>
          <span className="font-bold text-primary-foreground">{clientStats.mono}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-primary-foreground/60">TRI:</span>
          <span className="font-bold text-primary-foreground">{clientStats.tri}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-primary-foreground/60">TÉTRA:</span>
          <span className="font-bold text-primary-foreground">{clientStats.tetra}</span>
        </div>
      </div>
      
      {/* Distribution par phase compacte */}
      <div className="flex items-center gap-3 ml-auto">
        {['A', 'B', 'C'].map(phase => {
          const load = phaseLoads[phase as 'A' | 'B' | 'C'];
          const moyenne = (phaseLoads.A + phaseLoads.B + phaseLoads.C) / 3;
          const ecart = moyenne > 0 ? ((load - moyenne) / moyenne * 100) : 0;
          
          return (
            <div key={phase} className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-primary-foreground/80">Ph{phase}:</span>
              <div className="text-right">
                <span className="text-xs font-bold text-primary-foreground">{load.toFixed(1)}kVA</span>
                <span className={`text-xs ml-1 ${
                  Math.abs(ecart) < 10 ? 'text-success' : 
                  Math.abs(ecart) < 20 ? 'text-accent' : 
                  'text-destructive'
                }`}>
                  ({ecart > 0 ? '+' : ''}{ecart.toFixed(0)}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Déséquilibre global et bouton re-balance */}
      <div className="flex items-center gap-2 pl-3 border-l border-white/10">
        <span className="text-xs text-primary-foreground/60">Déséq.:</span>
        <span className={`text-sm font-bold ${statusBadge.color}`}>
          {unbalancePercent.toFixed(1)}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={rebalanceAllMonoClients}
          className="h-6 px-2 text-xs"
          title="Re-balancer les clients MONO"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Re-balancer
        </Button>
      </div>
    </div>
  );
};
