import React from 'react';
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNetworkStore } from "@/store/networkStore";
import { calculateProjectUnbalance } from "@/utils/phaseDistributionCalculator";
import { RefreshCw } from "lucide-react";
import type { Node, ClientImporte } from "@/types/network";
import { analyzeClientPower } from "@/utils/clientsUtils";
import * as Complex from "@/utils/complex";

// Helper pour calculer le courant de neutre (400V uniquement)
function calculateNeutralCurrent(Ia: number, Ib: number, Ic: number): number {
  // Calcul vectoriel du courant de neutre avec déphasage 120°
  // In = Ia + Ib*e^(j*120°) + Ic*e^(j*240°)
  const Ia_complex = Complex.C(Ia, 0);
  const Ib_complex = Complex.fromPolar(Ib, (120 * Math.PI) / 180);
  const Ic_complex = Complex.fromPolar(Ic, (240 * Math.PI) / 180);
  
  const In_complex = Complex.add(Complex.add(Ia_complex, Ib_complex), Ic_complex);
  return Complex.abs(In_complex);
}

// Helper pour regrouper les clients par couplage
function groupClientsByCoupling(
  clients: ClientImporte[] | undefined,
  voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V'
): Record<string, { clients: ClientImporte[]; totalKVA: number; totalCurrent: number }> {
  const groups: Record<string, { clients: ClientImporte[]; totalKVA: number; totalCurrent: number }> = {};
  
  if (!clients) return groups;
  
  clients.forEach(client => {
    if (client.connectionType === 'MONO') {
      const coupling = client.phaseCoupling || client.assignedPhase || 'Non assigné';
      
      if (!groups[coupling]) {
        groups[coupling] = { clients: [], totalKVA: 0, totalCurrent: 0 };
      }
      
      groups[coupling].clients.push(client);
      groups[coupling].totalKVA += client.puissanceContractuelle_kVA;
      
      // Calculer le courant (I = S / V)
      const voltage = voltageSystem === 'TRIPHASÉ_230V' ? 230 : 230; // Toujours 230V pour MONO
      groups[coupling].totalCurrent += (client.puissanceContractuelle_kVA * 1000) / voltage;
    }
  });
  
  return groups;
}

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
  
  // Identifier les clients MONO à forte puissance par phase
  const highPowerClientsPerPhase: {
    A: ClientImporte[];
    B: ClientImporte[];
    C: ClientImporte[];
  } = { A: [], B: [], C: [] };

  currentProject.clientsImportes?.forEach(client => {
    if (client.connectionType === 'MONO') {
      const analysis = analyzeClientPower(client, currentProject.voltageSystem);
      if (analysis && (analysis.level === 'high' || analysis.level === 'critical')) {
        // Trouver la phase du client
        if (client.assignedPhase) {
          highPowerClientsPerPhase[client.assignedPhase as 'A' | 'B' | 'C'].push(client);
        }
      }
    }
  });

  // Calculer le total de puissance à risque par phase
  const riskPowerPerPhase = {
    A: highPowerClientsPerPhase.A.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0),
    B: highPowerClientsPerPhase.B.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0),
    C: highPowerClientsPerPhase.C.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0)
  };
  
  // Calculer le courant de neutre pour 400V
  let neutralCurrent = 0;
  if (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V') {
    // Calculer les courants par phase (I = S / V)
    const voltage = 230; // Phase-neutre
    const Ia = (phaseLoads.A * 1000) / voltage;
    const Ib = (phaseLoads.B * 1000) / voltage;
    const Ic = (phaseLoads.C * 1000) / voltage;
    neutralCurrent = calculateNeutralCurrent(Ia, Ib, Ic);
  }
  
  // Regrouper les clients par couplage
  const clientsByCoupling = groupClientsByCoupling(
    currentProject.clientsImportes,
    currentProject.voltageSystem
  );
  
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
          variant="warning"
          className="h-7 text-xs"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Rééquilibrer MONO
        </Button>
      </div>

      {/* Section d'alertes pour les clients à forte puissance */}
      {(highPowerClientsPerPhase.A.length > 0 || 
        highPowerClientsPerPhase.B.length > 0 || 
        highPowerClientsPerPhase.C.length > 0) && (
        <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-orange-600">⚠️ CLIENTS À FORTE PUISSANCE MONO</span>
          </div>
          
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* Phase A */}
            <div className={`p-2 rounded ${highPowerClientsPerPhase.A.length > 0 ? 'bg-blue-500/20 border border-blue-500/40' : 'bg-white/5'}`}>
              <div className="font-medium text-blue-400 mb-1">Phase A</div>
              {highPowerClientsPerPhase.A.length > 0 ? (
                <>
                  <div className="text-destructive font-bold">
                    {highPowerClientsPerPhase.A.length} client{highPowerClientsPerPhase.A.length > 1 ? 's' : ''}
                  </div>
                  <div className="text-foreground">
                    {riskPowerPerPhase.A.toFixed(1)} kVA
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {highPowerClientsPerPhase.A.slice(0, 3).map(client => {
                      const analysis = analyzeClientPower(client, currentProject.voltageSystem);
                      return (
                        <div key={client.id} className="text-[10px] truncate" title={client.nomCircuit}>
                          <span style={{ color: analysis?.color }}>{analysis?.label.split(' ')[0]}</span> {client.nomCircuit.substring(0, 15)} ({client.puissanceContractuelle_kVA.toFixed(1)}kVA)
                          {analysis?.phaseCoupling && <div className="text-muted-foreground">{analysis.phaseCoupling}</div>}
                        </div>
                      );
                    })}
                    {highPowerClientsPerPhase.A.length > 3 && (
                      <div className="text-[10px] text-muted-foreground">
                        +{highPowerClientsPerPhase.A.length - 3} autre{highPowerClientsPerPhase.A.length - 3 > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Aucun</div>
              )}
            </div>
            
            {/* Phase B */}
            <div className={`p-2 rounded ${highPowerClientsPerPhase.B.length > 0 ? 'bg-green-500/20 border border-green-500/40' : 'bg-white/5'}`}>
              <div className="font-medium text-green-400 mb-1">Phase B</div>
              {highPowerClientsPerPhase.B.length > 0 ? (
                <>
                  <div className="text-destructive font-bold">
                    {highPowerClientsPerPhase.B.length} client{highPowerClientsPerPhase.B.length > 1 ? 's' : ''}
                  </div>
                  <div className="text-foreground">
                    {riskPowerPerPhase.B.toFixed(1)} kVA
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {highPowerClientsPerPhase.B.slice(0, 3).map(client => {
                      const analysis = analyzeClientPower(client, currentProject.voltageSystem);
                      return (
                        <div key={client.id} className="text-[10px] truncate" title={client.nomCircuit}>
                          <span style={{ color: analysis?.color }}>{analysis?.label.split(' ')[0]}</span> {client.nomCircuit.substring(0, 15)} ({client.puissanceContractuelle_kVA.toFixed(1)}kVA)
                          {analysis?.phaseCoupling && <div className="text-muted-foreground">{analysis.phaseCoupling}</div>}
                        </div>
                      );
                    })}
                    {highPowerClientsPerPhase.B.length > 3 && (
                      <div className="text-[10px] text-muted-foreground">
                        +{highPowerClientsPerPhase.B.length - 3} autre{highPowerClientsPerPhase.B.length - 3 > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Aucun</div>
              )}
            </div>
            
            {/* Phase C */}
            <div className={`p-2 rounded ${highPowerClientsPerPhase.C.length > 0 ? 'bg-red-500/20 border border-red-500/40' : 'bg-white/5'}`}>
              <div className="font-medium text-red-400 mb-1">Phase C</div>
              {highPowerClientsPerPhase.C.length > 0 ? (
                <>
                  <div className="text-destructive font-bold">
                    {highPowerClientsPerPhase.C.length} client{highPowerClientsPerPhase.C.length > 1 ? 's' : ''}
                  </div>
                  <div className="text-foreground">
                    {riskPowerPerPhase.C.toFixed(1)} kVA
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {highPowerClientsPerPhase.C.slice(0, 3).map(client => {
                      const analysis = analyzeClientPower(client, currentProject.voltageSystem);
                      return (
                        <div key={client.id} className="text-[10px] truncate" title={client.nomCircuit}>
                          <span style={{ color: analysis?.color }}>{analysis?.label.split(' ')[0]}</span> {client.nomCircuit.substring(0, 15)} ({client.puissanceContractuelle_kVA.toFixed(1)}kVA)
                          {analysis?.phaseCoupling && <div className="text-muted-foreground">{analysis.phaseCoupling}</div>}
                        </div>
                      );
                    })}
                    {highPowerClientsPerPhase.C.length > 3 && (
                      <div className="text-[10px] text-muted-foreground">
                        +{highPowerClientsPerPhase.C.length - 3} autre{highPowerClientsPerPhase.C.length - 3 > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Aucun</div>
              )}
            </div>
          </div>
          
          <div className="mt-2 text-[10px] text-muted-foreground">
            💡 Cliquez sur "Rééquilibrer MONO" pour optimiser la distribution
          </div>
        </div>
      )}

      {/* Récapitulatif par couplage avec courant de neutre */}
      <div className="p-3 bg-primary/5 border border-primary/20 rounded">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-primary">📋 RÉCAPITULATIF PAR COUPLAGE</span>
          {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' && (
            <Badge variant="outline" className="text-xs">
              Courant neutre: {neutralCurrent.toFixed(1)} A
            </Badge>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* 230V Phase-à-phase */}
          {currentProject.voltageSystem === 'TRIPHASÉ_230V' && (
            <div className="col-span-2 space-y-1">
              <div className="font-medium text-primary mb-1">230V Phase-à-phase (sans neutre)</div>
              {['A-B', 'B-C', 'A-C'].map(coupling => {
                const group = clientsByCoupling[coupling];
                if (!group) return null;
                return (
                  <div key={coupling} className="flex items-center justify-between p-1.5 bg-blue-500/10 rounded">
                    <span className="font-medium text-blue-400">Phase {coupling}</span>
                    <div className="text-right">
                      <div className="font-bold text-foreground">{group.clients.length} client{group.clients.length > 1 ? 's' : ''}</div>
                      <div className="text-muted-foreground">{group.totalKVA.toFixed(1)} kVA · {group.totalCurrent.toFixed(1)} A</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* 400V Phase-neutre */}
          {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' && (
            <div className="col-span-2 space-y-1">
              <div className="font-medium text-primary mb-1">400V Phase-neutre</div>
              {['A', 'B', 'C'].map(coupling => {
                const group = clientsByCoupling[coupling];
                if (!group) return null;
                const bgClass = coupling === 'A' ? 'bg-blue-500/10' : coupling === 'B' ? 'bg-green-500/10' : 'bg-red-500/10';
                const textClass = coupling === 'A' ? 'text-blue-400' : coupling === 'B' ? 'text-green-400' : 'text-red-400';
                return (
                  <div key={coupling} className={`flex items-center justify-between p-1.5 ${bgClass} rounded`}>
                    <span className={`font-medium ${textClass}`}>Phase {coupling}</span>
                    <div className="text-right">
                      <div className="font-bold text-foreground">{group.clients.length} client{group.clients.length > 1 ? 's' : ''}</div>
                      <div className="text-muted-foreground">{group.totalKVA.toFixed(1)} kVA · {group.totalCurrent.toFixed(1)} A</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            💡 Le courant de neutre est calculé vectoriellement à partir des charges par phase
          </div>
        )}
        {currentProject.voltageSystem === 'TRIPHASÉ_230V' && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            💡 Réseau 230V sans neutre : les clients MONO sont connectés entre 2 phases
          </div>
        )}
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
              const hasRisk = highPowerClientsPerPhase[phaseName].length > 0;
              
              return (
                <div key={phase} className={`flex flex-col gap-0.5 text-center ${hasRisk ? 'bg-blue-500/10 border-l-2 border-blue-500' : ''}`}>
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-xs font-bold text-blue-300">Ph{phase}</span>
                    {hasRisk && <span className="text-orange-500 text-xs">⚠️</span>}
                  </div>
                  
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
                  <div className="text-xs text-blue-300/80">
                    M: {monoKVA.toFixed(1)}
                  </div>
                  
                  {/* POLY */}
                  <div className="text-xs text-purple-300/80">
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
                  <div className="text-xs text-orange-300/80">
                    M: {monoKVA.toFixed(1)}
                  </div>
                  
                  {/* POLY */}
                  <div className="text-xs text-purple-300/80">
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
