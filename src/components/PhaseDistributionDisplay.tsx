import React, { useState } from 'react';
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNetworkStore } from "@/store/networkStore";
import { calculateProjectUnbalance } from "@/utils/phaseDistributionCalculator";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
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
  voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V',
  clientLinks: { clientId: string; nodeId: string }[] | undefined
): Record<string, { clients: ClientImporte[]; totalKVA: number; totalProdKVA: number; totalCurrent: number }> {
  const groups: Record<string, { clients: ClientImporte[]; totalKVA: number; totalProdKVA: number; totalCurrent: number }> = {};
  
  if (!clients || !clientLinks) return groups;
  
  // Ne considérer que les clients liés à des nœuds
  const linkedClientIds = new Set(clientLinks.map(link => link.clientId));
  
  clients.forEach(client => {
    if (!linkedClientIds.has(client.id)) return; // Ignorer les clients non liés
    if (client.connectionType === 'MONO') {
      const coupling = client.phaseCoupling || client.assignedPhase || 'Non assigné';
      
      if (!groups[coupling]) {
        groups[coupling] = { clients: [], totalKVA: 0, totalProdKVA: 0, totalCurrent: 0 };
      }
      
      groups[coupling].clients.push(client);
      groups[coupling].totalKVA += client.puissanceContractuelle_kVA;
      groups[coupling].totalProdKVA += client.puissancePV_kVA || 0;
      
      // Calculer le courant (I = S / V)
      const voltage = voltageSystem === 'TRIPHASÉ_230V' ? 230 : 230; // Toujours 230V pour MONO
      groups[coupling].totalCurrent += (client.puissanceContractuelle_kVA * 1000) / voltage;
    }
  });
  
  return groups;
}

// Helper pour calculer toutes les données d'une phase/couplage
function calculatePhaseData(
  nodes: Node[], 
  phase: 'A' | 'B' | 'C',
  foisonnementCharges: number,
  foisonnementProductions: number,
  totalFoisonneChargeGlobal: number,
  totalFoisonneProductionGlobal: number,
  manualPhaseDistribution?: { charges: { A: number; B: number; C: number }; productions: { A: number; B: number; C: number } }
): {
  nbMono: number;
  chargeMono: number;
  productionMono: number;
  chargePoly: number;
  productionPoly: number;
  totalPhysiqueCharge: number;
  totalPhysiqueProduction: number;
  totalFoisonneCharge: number;
  totalFoisonneProduction: number;
  chargeAvecCurseur: number;
  productionAvecCurseur: number;
  ecartChargePercent: number;
  ecartProductionPercent: number;
  courantTotal: number;
} {
  let nbMono = 0;
  let chargeMono = 0;
  let productionMono = 0;
  let chargePoly = 0;
  let productionPoly = 0;
  
  nodes.forEach(node => {
    if (node.autoPhaseDistribution) {
      chargeMono += node.autoPhaseDistribution.charges.mono[phase];
      productionMono += node.autoPhaseDistribution.productions.mono[phase];
      chargePoly += node.autoPhaseDistribution.charges.poly[phase];
      productionPoly += node.autoPhaseDistribution.productions.poly[phase];
    }
  });
  
  // Total physique = MONO + POLY (ne change pas avec les curseurs)
  const totalPhysiqueCharge = chargeMono + chargePoly;
  const totalPhysiqueProduction = productionMono + productionPoly;
  
  // Total foisonné de CETTE phase (ne change pas avec les curseurs)
  const totalFoisonneCharge = totalPhysiqueCharge * (foisonnementCharges / 100);
  const totalFoisonneProduction = totalPhysiqueProduction * (foisonnementProductions / 100);
  
  // Curseurs : redistribution du total foisonné GLOBAL selon le %
  const curseurCharge = manualPhaseDistribution?.charges[phase] || 33.33;
  const curseurProduction = manualPhaseDistribution?.productions[phase] || 33.33;
  
  const chargeAvecCurseur = totalFoisonneChargeGlobal * (curseurCharge / 100);
  const productionAvecCurseur = totalFoisonneProductionGlobal * (curseurProduction / 100);
  
  // Écart par rapport à 33.33%
  const ecartChargePercent = ((curseurCharge - 33.33) / 33.33) * 100;
  const ecartProductionPercent = ((curseurProduction - 33.33) / 33.33) * 100;
  
  // Courant total (I = S / V)
  const voltage = 230;
  const courantTotal = ((chargeAvecCurseur - productionAvecCurseur) * 1000) / voltage;
  
  return {
    nbMono,
    chargeMono,
    productionMono,
    chargePoly,
    productionPoly,
    totalPhysiqueCharge,
    totalPhysiqueProduction,
    totalFoisonneCharge,
    totalFoisonneProduction,
    chargeAvecCurseur,
    productionAvecCurseur,
    ecartChargePercent,
    ecartProductionPercent,
    courantTotal
  };
}

// Helper pour calculer les totaux foisonnés globaux
function calculateGlobalFoisonne(
  nodes: Node[],
  foisonnementCharges: number,
  foisonnementProductions: number
): { totalFoisonneChargeGlobal: number; totalFoisonneProductionGlobal: number } {
  let totalChargePhysique = 0;
  let totalProductionPhysique = 0;
  
  (['A', 'B', 'C'] as const).forEach(phase => {
    nodes.forEach(node => {
      if (node.autoPhaseDistribution) {
        totalChargePhysique += node.autoPhaseDistribution.charges.mono[phase] + 
                               node.autoPhaseDistribution.charges.poly[phase];
        totalProductionPhysique += node.autoPhaseDistribution.productions.mono[phase] + 
                                   node.autoPhaseDistribution.productions.poly[phase];
      }
    });
  });
  
  return {
    totalFoisonneChargeGlobal: totalChargePhysique * (foisonnementCharges / 100),
    totalFoisonneProductionGlobal: totalProductionPhysique * (foisonnementProductions / 100)
  };
}

export const PhaseDistributionDisplay = () => {
  const { currentProject, rebalanceAllMonoClients } = useNetworkStore();
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  if (!currentProject || currentProject.loadModel !== 'mixte_mono_poly') {
    return null;
  }

  // Déterminer le mode d'affichage selon le voltage
  const is230V = currentProject.voltageSystem === "TRIPHASÉ_230V";
  const phaseLabels = is230V 
    ? { A: "Couplage L1-L2", B: "Couplage L2-L3", C: "Couplage L3-L1" }
    : { A: "L1", B: "L2", C: "L3" };

  // Calculer le déséquilibre global du projet
  const { unbalancePercent, status, phaseLoads } = calculateProjectUnbalance(
    currentProject.nodes
  );
  
  // Compter les clients par type (uniquement les clients liés)
  const linkedClientIds = new Set(currentProject.clientLinks?.map(link => link.clientId) || []);
  const clientStats = {
    mono: 0,
    tri: 0,
    tetra: 0
  };
  
  currentProject.clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return; // Ignorer les clients non liés
    
    if (client.connectionType === 'MONO') clientStats.mono++;
    else if (client.connectionType === 'TRI') clientStats.tri++;
    else if (client.connectionType === 'TETRA') clientStats.tetra++;
  });
  
  // Identifier les clients MONO à forte puissance par phase (uniquement les clients liés)
  const highPowerClientsPerPhase: {
    A: ClientImporte[];
    B: ClientImporte[];
    C: ClientImporte[];
  } = { A: [], B: [], C: [] };

  currentProject.clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return; // Ignorer les clients non liés
    
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
  
  // Regrouper les clients par couplage (uniquement les clients liés)
  const clientsByCoupling = groupClientsByCoupling(
    currentProject.clientsImportes,
    currentProject.voltageSystem,
    currentProject.clientLinks
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
        <Button
          onClick={() => setIsCollapsed(!isCollapsed)}
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
        >
          {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
        
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
        {!isCollapsed && (
          <Button
            onClick={rebalanceAllMonoClients}
            size="sm"
            variant="warning"
            className="h-7 text-xs"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Rééquilibrer MONO
          </Button>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* Section d'alertes pour les clients à forte puissance */}
      {(highPowerClientsPerPhase.A.length > 0 || 
        highPowerClientsPerPhase.B.length > 0 || 
        highPowerClientsPerPhase.C.length > 0) && (
        <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-orange-600">⚠️ CLIENTS À FORTE PUISSANCE MONO</span>
          </div>
          
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* L1 */}
            <div className={`p-2 rounded ${highPowerClientsPerPhase.A.length > 0 ? 'bg-blue-500/20 border border-blue-500/40' : 'bg-white/5'}`}>
              <div className="font-medium text-blue-400 mb-1">L1</div>
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
            
            {/* L2 */}
            <div className={`p-2 rounded ${highPowerClientsPerPhase.B.length > 0 ? 'bg-green-500/20 border border-green-500/40' : 'bg-white/5'}`}>
              <div className="font-medium text-green-400 mb-1">L2</div>
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
            
            {/* L3 */}
            <div className={`p-2 rounded ${highPowerClientsPerPhase.C.length > 0 ? 'bg-red-500/20 border border-red-500/40' : 'bg-white/5'}`}>
              <div className="font-medium text-red-400 mb-1">L3</div>
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

      {/* Tableau consolidé par couplage */}
      <div className="p-3 bg-primary/5 border border-primary/20 rounded">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold text-white">📋 RÉCAPITULATIF PAR COUPLAGE</span>
          {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' && (
            <Badge variant="outline" className="text-xs">
              Courant neutre: {neutralCurrent.toFixed(1)} A
            </Badge>
          )}
        </div>
        
        {/* Tableau */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/20">
                <th className="text-left py-2 px-2 text-white font-semibold">Couplage</th>
                <th className="text-center py-2 px-1 text-white font-semibold">Nb<br/>MONO</th>
                <th className="text-right py-2 px-1 text-blue-300 font-semibold">Ch<br/>MONO</th>
                <th className="text-right py-2 px-1 text-green-300 font-semibold">Pr<br/>MONO</th>
                <th className="text-right py-2 px-1 text-blue-300 font-semibold">Ch POLY<br/>33.3%</th>
                <th className="text-right py-2 px-1 text-green-300 font-semibold">Pr POLY<br/>33.3%</th>
                <th className="text-right py-2 px-1 text-blue-400 font-semibold">Total<br/>phys. Ch</th>
                <th className="text-right py-2 px-1 text-green-400 font-semibold">Total<br/>phys. Pr</th>
                <th className="text-right py-2 px-1 text-blue-500 font-semibold">Total<br/>foisonné Ch</th>
                <th className="text-right py-2 px-1 text-green-500 font-semibold">Total<br/>foisonné Pr</th>
                <th className="text-right py-2 px-1 text-blue-600 font-semibold">Ch avec<br/>curseurs</th>
                <th className="text-right py-2 px-1 text-green-600 font-semibold">Pr avec<br/>curseurs</th>
                <th className="text-right py-2 px-1 text-white font-semibold">Courant<br/>(A)</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Calculer une seule fois les totaux foisonnés globaux
                const { totalFoisonneChargeGlobal, totalFoisonneProductionGlobal } = 
                  calculateGlobalFoisonne(
                    currentProject.nodes,
                    currentProject.foisonnementCharges,
                    currentProject.foisonnementProductions
                  );
                
                return (['A', 'B', 'C'] as const).map((phase) => {
                  const phaseLabel = is230V 
                    ? (phase === 'A' ? 'L1-L2' : phase === 'B' ? 'L2-L3' : 'L3-L1')
                    : `L${phase === 'A' ? '1' : phase === 'B' ? '2' : '3'}`;
                  
                  const data = calculatePhaseData(
                    currentProject.nodes,
                    phase,
                    currentProject.foisonnementCharges,
                    currentProject.foisonnementProductions,
                    totalFoisonneChargeGlobal,
                    totalFoisonneProductionGlobal,
                    currentProject.manualPhaseDistribution
                  );
                
                  const bgClass = phase === 'A' ? 'bg-blue-500/5' : phase === 'B' ? 'bg-green-500/5' : 'bg-red-500/5';
                  const ecartChargeColor = Math.abs(data.ecartChargePercent) < 5 ? 'text-green-400' : Math.abs(data.ecartChargePercent) < 15 ? 'text-yellow-400' : 'text-red-400';
                  const ecartProdColor = Math.abs(data.ecartProductionPercent) < 5 ? 'text-green-400' : Math.abs(data.ecartProductionPercent) < 15 ? 'text-yellow-400' : 'text-red-400';
                  
                  // Compter les clients MONO réels par phase
                  const monoClients = currentProject.clientsImportes?.filter(client => {
                    if (!linkedClientIds.has(client.id)) return false;
                    if (client.connectionType !== 'MONO') return false;
                    
                    if (is230V) {
                      const coupling = client.phaseCoupling;
                      if (phase === 'A' && coupling === 'A-B') return true;
                      if (phase === 'B' && coupling === 'B-C') return true;
                      if (phase === 'C' && coupling === 'A-C') return true;
                      return false;
                    } else {
                      return client.assignedPhase === phase;
                    }
                  }) || [];
                  
                  return (
                    <tr key={phase} className={`border-b border-white/10 ${bgClass}`}>
                      <td className="py-2 px-2 text-white font-semibold">{phaseLabel}</td>
                      <td className="text-center py-2 px-1 text-white">{monoClients.length}</td>
                      <td className="text-right py-2 px-1 text-white">{data.chargeMono.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white">{data.productionMono.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white">{data.chargePoly.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white">{data.productionPoly.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white font-semibold">{data.totalPhysiqueCharge.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white font-semibold">{data.totalPhysiqueProduction.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white font-semibold">{data.totalFoisonneCharge.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white font-semibold">{data.totalFoisonneProduction.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-white font-bold">
                        {data.chargeAvecCurseur.toFixed(1)}
                        <br/>
                        <span className={`${ecartChargeColor} text-[10px]`}>
                          ({data.ecartChargePercent > 0 ? '+' : ''}{data.ecartChargePercent.toFixed(1)}%)
                        </span>
                      </td>
                      <td className="text-right py-2 px-1 text-white font-bold">
                        {data.productionAvecCurseur.toFixed(1)}
                        <br/>
                        <span className={`${ecartProdColor} text-[10px]`}>
                          ({data.ecartProductionPercent > 0 ? '+' : ''}{data.ecartProductionPercent.toFixed(1)}%)
                        </span>
                      </td>
                      <td className="text-right py-2 px-1 text-white font-semibold">{Math.abs(data.courantTotal).toFixed(1)}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        
        <div className="mt-2 text-[10px] text-white/60">
          {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' 
            ? '💡 Le courant de neutre est calculé vectoriellement. Les curseurs permettent d\'ajuster la répartition des charges et productions foisonnées.'
            : '💡 Réseau 230V sans neutre. Les curseurs permettent d\'ajuster la répartition des charges et productions foisonnées.'}
        </div>
      </div>
        </>
      )}
    </div>
  );
};
