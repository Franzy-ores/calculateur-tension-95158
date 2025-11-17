import React from 'react';
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNetworkStore } from "@/store/networkStore";
import { calculateProjectUnbalance } from "@/utils/phaseDistributionCalculator";
import { RefreshCw } from "lucide-react";
import type { Node } from "@/types/network";

// Helper pour calculer les charges par phase
function calculatePhaseCharges(
  nodes: Node[], 
  phase: 'A' | 'B' | 'C'
): { monoKVA: number; polyKVA: number; totalKVA: number } {
  let monoKVA = 0;
  let polyKVA = 0;
  
  nodes.forEach(node => {
    if (node.autoPhaseDistribution) {
      monoKVA += node.autoPhaseDistribution.charges.mono[phase];
      polyKVA += node.autoPhaseDistribution.charges.poly[phase];
    }
  });
  
  return {
    monoKVA,
    polyKVA,
    totalKVA: monoKVA + polyKVA
  };
}

// Helper pour calculer les productions par phase
function calculatePhaseProductions(
  nodes: Node[], 
  phase: 'A' | 'B' | 'C'
): { monoKVA: number; polyKVA: number; totalKVA: number } {
  let monoKVA = 0;
  let polyKVA = 0;
  
  nodes.forEach(node => {
    if (node.autoPhaseDistribution) {
      monoKVA += node.autoPhaseDistribution.productions.mono[phase];
      polyKVA += node.autoPhaseDistribution.productions.poly[phase];
    }
  });
  
  return {
    monoKVA,
    polyKVA,
    totalKVA: monoKVA + polyKVA
  };
}

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
    <div className="flex flex-col gap-2 p-3 bg-white/5 rounded border border-white/10">
      {/* Ligne 1: Titre, badge et stats clients */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs font-medium text-primary-foreground">
            📊 Distribution de phase
          </Label>
          <Badge variant={statusBadge.variant} className="text-xs px-1.5 py-0">
            {statusBadge.label}
          </Badge>
          <span className="text-xs font-bold text-primary-foreground">
            {unbalancePercent.toFixed(1)}%
          </span>
        </div>
        
        {/* Statistiques clients */}
        <div className="flex items-center gap-2 text-xs ml-auto">
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

        {/* Bouton rééquilibrage */}
        <Button
          onClick={rebalanceAllMonoClients}
          size="sm"
          variant="outline"
          className="h-7 text-xs"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Rééquilibrer MONO
        </Button>
      </div>

      {/* Ligne 2: Tableau compact Charges / Productions */}
      <div className="grid grid-cols-2 gap-3">
        {/* CHARGES */}
        <div className="flex flex-col gap-1 p-2 bg-blue-500/10 rounded border border-blue-500/20">
          <div className="text-xs font-semibold text-blue-400 mb-1">⚡ CHARGES</div>
          <div className="grid grid-cols-3 gap-2">
            {['A', 'B', 'C'].map(phase => {
              const phaseName = phase as 'A' | 'B' | 'C';
              const { monoKVA, polyKVA, totalKVA } = calculatePhaseCharges(
                currentProject.nodes,
                phaseName
              );
              
              const moyenne = (phaseLoads.A + phaseLoads.B + phaseLoads.C) / 3;
              const ecart = moyenne > 0 ? ((phaseLoads[phaseName] - moyenne) / moyenne * 100) : 0;
              const ecartColor = Math.abs(ecart) < 5 ? 'text-green-400' : Math.abs(ecart) < 10 ? 'text-yellow-400' : 'text-red-400';
              
              return (
                <div key={phase} className="flex flex-col gap-0.5 text-center">
                  <span className="text-xs font-bold text-blue-300">Ph{phase}</span>
                  
                  {/* Total */}
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-primary-foreground">
                      {totalKVA.toFixed(1)}
                    </span>
                    <span className={`text-[10px] ${ecartColor}`}>
                      ({ecart > 0 ? '+' : ''}{ecart.toFixed(0)}%)
                    </span>
                  </div>
                  
                  {/* MONO */}
                  <div className="text-[10px] text-blue-300/80">
                    M: {monoKVA.toFixed(1)}
                  </div>
                  
                  {/* POLY */}
                  <div className="text-[10px] text-purple-300/80">
                    P: {polyKVA.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* PRODUCTIONS */}
        <div className="flex flex-col gap-1 p-2 bg-orange-500/10 rounded border border-orange-500/20">
          <div className="text-xs font-semibold text-orange-400 mb-1">☀️ PRODUCTIONS</div>
          <div className="grid grid-cols-3 gap-2">
            {['A', 'B', 'C'].map(phase => {
              const phaseName = phase as 'A' | 'B' | 'C';
              const { monoKVA, polyKVA, totalKVA } = calculatePhaseProductions(
                currentProject.nodes,
                phaseName
              );
              
              return (
                <div key={phase} className="flex flex-col gap-0.5 text-center">
                  <span className="text-xs font-bold text-orange-300">Ph{phase}</span>
                  
                  {/* Total */}
                  <div className="text-xs font-bold text-primary-foreground">
                    {totalKVA.toFixed(1)}
                  </div>
                  
                  {/* MONO */}
                  <div className="text-[10px] text-orange-300/80">
                    M: {monoKVA.toFixed(1)}
                  </div>
                  
                  {/* POLY */}
                  <div className="text-[10px] text-purple-300/80">
                    P: {polyKVA.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
