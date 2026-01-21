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

// Interface pour les statistiques par couplage
interface CouplingStats {
  clients: ClientImporte[];
  totalKVA: number;
  totalProdKVA: number;
  totalCurrent: number;
  // NOUVEAU : Distinction résidentiel/industriel
  nbResidentiel: number;
  nbIndustriel: number;
  chargeResidentiel: number;
  chargeIndustriel: number;
  prodResidentiel: number;
  prodIndustriel: number;
}

// Helper pour regrouper les clients par couplage avec distinction résidentiel/industriel
function groupClientsByCoupling(
  clients: ClientImporte[] | undefined,
  voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V',
  clientLinks: { clientId: string; nodeId: string }[] | undefined
): Record<string, CouplingStats> {
  const groups: Record<string, CouplingStats> = {};
  
  if (!clients || !clientLinks) return groups;
  
  // Ne considérer que les clients liés à des nœuds
  const linkedClientIds = new Set(clientLinks.map(link => link.clientId));
  
  clients.forEach(client => {
    if (!linkedClientIds.has(client.id)) return; // Ignorer les clients non liés
    
    const isResidentiel = client.clientType !== 'industriel';
    const charge = client.puissanceContractuelle_kVA;
    const prod = client.puissancePV_kVA || 0;
    
    if (client.connectionType === 'MONO') {
      const coupling = client.phaseCoupling || client.assignedPhase || 'Non assigné';
      
      if (!groups[coupling]) {
        groups[coupling] = { 
          clients: [], 
          totalKVA: 0, 
          totalProdKVA: 0, 
          totalCurrent: 0,
          nbResidentiel: 0,
          nbIndustriel: 0,
          chargeResidentiel: 0,
          chargeIndustriel: 0,
          prodResidentiel: 0,
          prodIndustriel: 0
        };
      }
      
      groups[coupling].clients.push(client);
      groups[coupling].totalKVA += charge;
      groups[coupling].totalProdKVA += prod;
      
      // Comptage et charges par type de client
      if (isResidentiel) {
        groups[coupling].nbResidentiel++;
        groups[coupling].chargeResidentiel += charge;
        groups[coupling].prodResidentiel += prod;
      } else {
        groups[coupling].nbIndustriel++;
        groups[coupling].chargeIndustriel += charge;
        groups[coupling].prodIndustriel += prod;
      }
      
      // Calculer le courant (I = S / V)
      const voltage = voltageSystem === 'TRIPHASÉ_230V' ? 230 : 230; // Toujours 230V pour MONO
      groups[coupling].totalCurrent += (charge * 1000) / voltage;
      
    } else {
      // NOUVEAU : Inclure les clients TRI/TÉTRA
      const polyKey = client.connectionType === 'TRI' ? 'TRI' : 'TÉTRA';
      
      if (!groups[polyKey]) {
        groups[polyKey] = { 
          clients: [], 
          totalKVA: 0, 
          totalProdKVA: 0, 
          totalCurrent: 0,
          nbResidentiel: 0,
          nbIndustriel: 0,
          chargeResidentiel: 0,
          chargeIndustriel: 0,
          prodResidentiel: 0,
          prodIndustriel: 0
        };
      }
      
      groups[polyKey].clients.push(client);
      groups[polyKey].totalKVA += charge;
      groups[polyKey].totalProdKVA += prod;
      
      if (isResidentiel) {
        groups[polyKey].nbResidentiel++;
        groups[polyKey].chargeResidentiel += charge;
        groups[polyKey].prodResidentiel += prod;
      } else {
        groups[polyKey].nbIndustriel++;
        groups[polyKey].chargeIndustriel += charge;
        groups[polyKey].prodIndustriel += prod;
      }
      
      // Courant triphasé/tétraphasé
      const voltage = voltageSystem === 'TRIPHASÉ_230V' ? 230 : 400;
      groups[polyKey].totalCurrent += (charge * 1000) / (Math.sqrt(3) * voltage);
    }
  });
  
  return groups;
}

// Helper pour calculer toutes les données d'une phase/couplage avec foisonnement différencié
function calculatePhaseData(
  nodes: Node[], 
  phase: 'A' | 'B' | 'C',
  foisonnementChargesResidentiel: number,
  foisonnementChargesIndustriel: number,
  foisonnementProductions: number,
  totalFoisonneChargeGlobal: number,
  totalFoisonneProductionGlobal: number,
  clientsImportes: ClientImporte[] | undefined,
  clientLinks: { clientId: string; nodeId: string }[] | undefined,
  is230V: boolean,
  manualPhaseDistribution?: { charges: { A: number; B: number; C: number }; productions: { A: number; B: number; C: number } }
): {
  nbMono: number;
  nbResidentiel: number;
  nbIndustriel: number;
  chargeMono: number;
  chargeMonoResidentiel: number;
  chargeMonoIndustriel: number;
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
  let nbResidentiel = 0;
  let nbIndustriel = 0;
  let chargeMono = 0;
  let chargeMonoResidentiel = 0;
  let chargeMonoIndustriel = 0;
  let productionMono = 0;
  let chargePoly = 0;
  let productionPoly = 0;
  
  // Compter les clients MONO par phase avec distinction résidentiel/industriel
  const linkedClientIds = new Set(clientLinks?.map(link => link.clientId) || []);
  
  clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return;
    if (client.connectionType !== 'MONO') return;
    
    let matchesPhase = false;
    if (is230V) {
      const coupling = client.phaseCoupling;
      if (phase === 'A' && coupling === 'A-B') matchesPhase = true;
      if (phase === 'B' && coupling === 'B-C') matchesPhase = true;
      if (phase === 'C' && coupling === 'A-C') matchesPhase = true;
    } else {
      matchesPhase = client.assignedPhase === phase;
    }
    
    if (matchesPhase) {
      nbMono++;
      const isResidentiel = client.clientType !== 'industriel';
      if (isResidentiel) {
        nbResidentiel++;
        chargeMonoResidentiel += client.puissanceContractuelle_kVA;
      } else {
        nbIndustriel++;
        chargeMonoIndustriel += client.puissanceContractuelle_kVA;
      }
    }
  });
  
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
  
  // Total foisonné de CETTE phase avec foisonnement différencié par type de client
  // Pour MONO: appliquer foisonnement selon type client
  // Pour POLY: utiliser foisonnement industriel (généralement les clients poly sont industriels)
  const chargeFoisonneResidentiel = chargeMonoResidentiel * (foisonnementChargesResidentiel / 100);
  const chargeFoisonneIndustriel = chargeMonoIndustriel * (foisonnementChargesIndustriel / 100);
  const chargePolyFoisonne = chargePoly * (foisonnementChargesIndustriel / 100); // Poly = industriel
  
  const totalFoisonneCharge = chargeFoisonneResidentiel + chargeFoisonneIndustriel + chargePolyFoisonne;
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
    nbResidentiel,
    nbIndustriel,
    chargeMono,
    chargeMonoResidentiel,
    chargeMonoIndustriel,
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

// Helper pour calculer les totaux foisonnés globaux avec distinction résidentiel/industriel
function calculateGlobalFoisonne(
  nodes: Node[],
  foisonnementChargesResidentiel: number,
  foisonnementChargesIndustriel: number,
  foisonnementProductions: number,
  clientsImportes: ClientImporte[] | undefined,
  clientLinks: { clientId: string; nodeId: string }[] | undefined
): { 
  totalFoisonneChargeGlobal: number; 
  totalFoisonneProductionGlobal: number;
  totalChargeResidentiel: number;
  totalChargeIndustriel: number;
  totalChargeFoisonneResidentiel: number;
  totalChargeFoisonneIndustriel: number;
  nbTotalResidentiel: number;
  nbTotalIndustriel: number;
} {
  let totalChargePhysiqueResidentiel = 0;
  let totalChargePhysiqueIndustriel = 0;
  let totalProductionPhysique = 0;
  let nbTotalResidentiel = 0;
  let nbTotalIndustriel = 0;
  
  const linkedClientIds = new Set(clientLinks?.map(link => link.clientId) || []);
  
  // Calculer les charges par type de client
  clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return;
    
    const isResidentiel = client.clientType !== 'industriel';
    const charge = client.puissanceContractuelle_kVA;
    const prod = client.puissancePV_kVA || 0;
    
    if (isResidentiel) {
      totalChargePhysiqueResidentiel += charge;
      nbTotalResidentiel++;
    } else {
      totalChargePhysiqueIndustriel += charge;
      nbTotalIndustriel++;
    }
    
    totalProductionPhysique += prod;
  });
  
  // Appliquer les foisonnements différenciés
  const totalChargeFoisonneResidentiel = totalChargePhysiqueResidentiel * (foisonnementChargesResidentiel / 100);
  const totalChargeFoisonneIndustriel = totalChargePhysiqueIndustriel * (foisonnementChargesIndustriel / 100);
  
  return {
    totalFoisonneChargeGlobal: totalChargeFoisonneResidentiel + totalChargeFoisonneIndustriel,
    totalFoisonneProductionGlobal: totalProductionPhysique * (foisonnementProductions / 100),
    totalChargeResidentiel: totalChargePhysiqueResidentiel,
    totalChargeIndustriel: totalChargePhysiqueIndustriel,
    totalChargeFoisonneResidentiel,
    totalChargeFoisonneIndustriel,
    nbTotalResidentiel,
    nbTotalIndustriel
  };
}

export const PhaseDistributionDisplay = () => {
  const { currentProject, rebalanceAllMonoClients } = useNetworkStore();
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  if (!currentProject || currentProject.loadModel !== 'mixte_mono_poly') {
    return null;
  }

  // Récupérer les foisonnements différenciés
  const foisonnementResidentiel = currentProject.foisonnementChargesResidentiel ?? 15;
  const foisonnementIndustriel = currentProject.foisonnementChargesIndustriel ?? 70;
  const foisonnementProductions = currentProject.foisonnementProductions;

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
    tetra: 0,
    residentiel: 0,
    industriel: 0
  };
  
  currentProject.clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return; // Ignorer les clients non liés
    
    if (client.connectionType === 'MONO') clientStats.mono++;
    else if (client.connectionType === 'TRI') clientStats.tri++;
    else if (client.connectionType === 'TETRA') clientStats.tetra++;
    
    // Compter résidentiel/industriel
    if (client.clientType === 'industriel') {
      clientStats.industriel++;
    } else {
      clientStats.residentiel++;
    }
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
      if (analysis.level === 'high' || analysis.level === 'critical') {
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
  
  // Calculer les totaux foisonnés globaux avec distinction résidentiel/industriel
  const globalFoisonne = calculateGlobalFoisonne(
    currentProject.nodes,
    foisonnementResidentiel,
    foisonnementIndustriel,
    foisonnementProductions,
    currentProject.clientsImportes,
    currentProject.clientLinks
  );
  
  // Badge de statut avec couleurs sémantiques
  const statusBadge = {
    normal: { variant: 'default' as const, label: '✓ Normal', color: 'text-success' },
    warning: { variant: 'secondary' as const, label: '⚠️ Attention', color: 'text-accent' },
    critical: { variant: 'destructive' as const, label: '🔴 Critique', color: 'text-destructive' }
  }[status];

  return (
    <div className="flex flex-col gap-2 p-2 bg-white dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-600">
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
          <Label className="text-xs font-medium text-foreground">
            📊 Distribution de phase
          </Label>
          <Badge variant={statusBadge.variant} className="text-xs px-1.5 py-0">
            {statusBadge.label}
          </Badge>
          <span className="text-xs font-bold text-foreground">
            {unbalancePercent.toFixed(1)}%
          </span>
        </div>
        
        {/* Statistiques clients */}
        <div className="flex items-center gap-2 text-xs ml-auto">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">MONO:</span>
            <span className="font-bold text-foreground">{clientStats.mono}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">TRI:</span>
            <span className="font-bold text-foreground">{clientStats.tri}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">TÉTRA:</span>
            <span className="font-bold text-foreground">{clientStats.tetra}</span>
          </div>
          <div className="border-l border-slate-300 dark:border-slate-500 pl-2 flex items-center gap-1">
            <span className="text-green-600 dark:text-green-400">Rés:</span>
            <span className="font-bold text-green-600 dark:text-green-400">{clientStats.residentiel}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-orange-600 dark:text-orange-400">Ind:</span>
            <span className="font-bold text-orange-600 dark:text-orange-400">{clientStats.industriel}</span>
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
        <div className="p-3 bg-orange-100 dark:bg-orange-500/20 border border-orange-300 dark:border-orange-500/40 rounded">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-orange-700 dark:text-orange-600">⚠️ CLIENTS À FORTE PUISSANCE MONO</span>
          </div>
          
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* L1 */}
            <div className={`p-2 rounded ${highPowerClientsPerPhase.A.length > 0 ? 'bg-blue-100 dark:bg-blue-500/30 border border-blue-300 dark:border-blue-500/50' : 'bg-slate-100 dark:bg-slate-700/50'}`}>
              <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">L1</div>
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
            <div className={`p-2 rounded ${highPowerClientsPerPhase.B.length > 0 ? 'bg-green-100 dark:bg-green-500/30 border border-green-300 dark:border-green-500/50' : 'bg-slate-100 dark:bg-slate-700/50'}`}>
              <div className="font-medium text-green-600 dark:text-green-400 mb-1">L2</div>
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
            <div className={`p-2 rounded ${highPowerClientsPerPhase.C.length > 0 ? 'bg-red-100 dark:bg-red-500/30 border border-red-300 dark:border-red-500/50' : 'bg-slate-100 dark:bg-slate-700/50'}`}>
              <div className="font-medium text-red-600 dark:text-red-400 mb-1">L3</div>
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

      {/* Résumé foisonnement par type de client */}
      <div className="p-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-600 rounded">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-foreground">📊 Foisonnement par type :</span>
            <div className="flex items-center gap-1">
              <span className="text-green-600 dark:text-green-400">Résidentiel ({foisonnementResidentiel}%):</span>
              <span className="font-bold text-green-700 dark:text-green-300">
                {globalFoisonne.nbTotalResidentiel} clients, 
                {globalFoisonne.totalChargeResidentiel.toFixed(1)} kVA → 
                {globalFoisonne.totalChargeFoisonneResidentiel.toFixed(1)} kVA
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-orange-600 dark:text-orange-400">Industriel ({foisonnementIndustriel}%):</span>
              <span className="font-bold text-orange-700 dark:text-orange-300">
                {globalFoisonne.nbTotalIndustriel} clients, 
                {globalFoisonne.totalChargeIndustriel.toFixed(1)} kVA → 
                {globalFoisonne.totalChargeFoisonneIndustriel.toFixed(1)} kVA
              </span>
            </div>
          </div>
          <div className="text-foreground font-semibold">
            Total foisonné: {globalFoisonne.totalFoisonneChargeGlobal.toFixed(1)} kVA
          </div>
        </div>
      </div>

      {/* Tableau consolidé par couplage */}
      <div className="p-3 bg-slate-50 dark:bg-slate-700/95 border border-slate-300 dark:border-slate-600 rounded">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold text-foreground">📋 RÉCAPITULATIF PAR COUPLAGE</span>
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
              <tr className="border-b border-slate-300 dark:border-slate-500">
                <th className="text-left py-2 px-2 text-foreground font-semibold">Couplage</th>
                <th className="text-center py-2 px-1 text-foreground font-semibold">Nb<br/>Total</th>
                <th className="text-center py-2 px-1 text-green-600 dark:text-green-400 font-semibold">Nb<br/>Rés.</th>
                <th className="text-center py-2 px-1 text-orange-600 dark:text-orange-400 font-semibold">Nb<br/>Ind.</th>
                <th className="text-right py-2 px-1 text-green-600 dark:text-green-400 font-semibold">Ch. Rés.<br/>(kVA)</th>
                <th className="text-right py-2 px-1 text-orange-600 dark:text-orange-400 font-semibold">Ch. Ind.<br/>(kVA)</th>
                <th className="text-right py-2 px-1 text-foreground font-semibold">Ch. Poly<br/>33.3%</th>
                <th className="text-right py-2 px-1 text-foreground font-semibold">Prod.<br/>(kVA)</th>
                <th className="text-right py-2 px-1 text-purple-600 dark:text-purple-400 font-semibold">Prod.<br/>foisonné</th>
                <th className="text-right py-2 px-1 text-foreground font-semibold">Ch.<br/>contrat</th>
                <th className="text-right py-2 px-1 text-foreground font-semibold">Ch.<br/>foisonné</th>
                <th className="text-right py-2 px-1 text-foreground font-semibold">Ch.<br/>déséq.</th>
                <th className="text-right py-2 px-1 text-foreground font-semibold">Courant<br/>(A)</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                return (['A', 'B', 'C'] as const).map((phase) => {
                  const phaseLabel = is230V 
                    ? (phase === 'A' ? 'L1-L2' : phase === 'B' ? 'L2-L3' : 'L3-L1')
                    : `L${phase === 'A' ? '1' : phase === 'B' ? '2' : '3'}`;
                  
                  const data = calculatePhaseData(
                    currentProject.nodes,
                    phase,
                    foisonnementResidentiel,
                    foisonnementIndustriel,
                    foisonnementProductions,
                    globalFoisonne.totalFoisonneChargeGlobal,
                    globalFoisonne.totalFoisonneProductionGlobal,
                    currentProject.clientsImportes,
                    currentProject.clientLinks,
                    is230V,
                    currentProject.manualPhaseDistribution
                  );
                
                  const bgClass = phase === 'A' ? 'bg-blue-100 dark:bg-blue-500/20' : phase === 'B' ? 'bg-green-100 dark:bg-green-500/20' : 'bg-red-100 dark:bg-red-500/20';
                  const ecartChargeColor = Math.abs(data.ecartChargePercent) < 5 ? 'text-green-600 dark:text-green-400' : Math.abs(data.ecartChargePercent) < 15 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';
                  
                  return (
                    <tr key={phase} className={`border-b border-slate-300 dark:border-slate-600/50 ${bgClass}`}>
                      <td className="py-2 px-2 text-foreground font-semibold">{phaseLabel}</td>
                      <td className="text-center py-2 px-1 text-foreground">{data.nbMono}</td>
                      <td className="text-center py-2 px-1 text-green-700 dark:text-green-300">{data.nbResidentiel}</td>
                      <td className="text-center py-2 px-1 text-orange-700 dark:text-orange-300">{data.nbIndustriel}</td>
                      <td className="text-right py-2 px-1 text-green-700 dark:text-green-300">{data.chargeMonoResidentiel.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-orange-700 dark:text-orange-300">{data.chargeMonoIndustriel.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-foreground">{data.chargePoly.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-foreground">{data.productionMono.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-purple-700 dark:text-purple-300 font-semibold">{data.totalFoisonneProduction.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-foreground font-semibold">{data.totalPhysiqueCharge.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-foreground font-semibold">{data.totalFoisonneCharge.toFixed(1)}</td>
                      <td className="text-right py-2 px-1 text-foreground font-bold">
                        {data.chargeAvecCurseur.toFixed(1)}
                        <br/>
                        <span className={`${ecartChargeColor} text-[10px]`}>
                          ({data.ecartChargePercent > 0 ? '+' : ''}{data.ecartChargePercent.toFixed(1)}%)
                        </span>
                      </td>
                      <td className="text-right py-2 px-1 text-foreground font-semibold">{Math.abs(data.courantTotal).toFixed(1)}</td>
                    </tr>
                  );
                });
              })()}
              
              {/* Ligne TRI si présent */}
              {clientsByCoupling['TRI'] && (
                <tr className="border-b border-slate-300 dark:border-slate-600/50 bg-purple-100 dark:bg-purple-500/20">
                  <td className="py-2 px-2 text-foreground font-semibold">TRI</td>
                  <td className="text-center py-2 px-1 text-foreground">{clientsByCoupling['TRI'].clients.length}</td>
                  <td className="text-center py-2 px-1 text-green-700 dark:text-green-300">{clientsByCoupling['TRI'].nbResidentiel}</td>
                  <td className="text-center py-2 px-1 text-orange-700 dark:text-orange-300">{clientsByCoupling['TRI'].nbIndustriel}</td>
                  <td className="text-right py-2 px-1 text-green-700 dark:text-green-300">{clientsByCoupling['TRI'].chargeResidentiel.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-orange-700 dark:text-orange-300">{clientsByCoupling['TRI'].chargeIndustriel.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-foreground">-</td>
                  <td className="text-right py-2 px-1 text-foreground">{clientsByCoupling['TRI'].totalProdKVA.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-purple-700 dark:text-purple-300 font-semibold">{(clientsByCoupling['TRI'].totalProdKVA * foisonnementProductions / 100).toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-foreground font-semibold">{clientsByCoupling['TRI'].totalKVA.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-foreground font-semibold">
                    {((clientsByCoupling['TRI'].chargeResidentiel * foisonnementResidentiel / 100) + 
                      (clientsByCoupling['TRI'].chargeIndustriel * foisonnementIndustriel / 100)).toFixed(1)}
                  </td>
                  <td className="text-right py-2 px-1 text-foreground">-</td>
                  <td className="text-right py-2 px-1 text-foreground font-semibold">{clientsByCoupling['TRI'].totalCurrent.toFixed(1)}</td>
                </tr>
              )}
              
              {/* Ligne TÉTRA si présent */}
              {clientsByCoupling['TÉTRA'] && (
                <tr className="border-b border-slate-300 dark:border-slate-600/50 bg-cyan-100 dark:bg-cyan-500/20">
                  <td className="py-2 px-2 text-foreground font-semibold">TÉTRA</td>
                  <td className="text-center py-2 px-1 text-foreground">{clientsByCoupling['TÉTRA'].clients.length}</td>
                  <td className="text-center py-2 px-1 text-green-700 dark:text-green-300">{clientsByCoupling['TÉTRA'].nbResidentiel}</td>
                  <td className="text-center py-2 px-1 text-orange-700 dark:text-orange-300">{clientsByCoupling['TÉTRA'].nbIndustriel}</td>
                  <td className="text-right py-2 px-1 text-green-700 dark:text-green-300">{clientsByCoupling['TÉTRA'].chargeResidentiel.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-orange-700 dark:text-orange-300">{clientsByCoupling['TÉTRA'].chargeIndustriel.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-foreground">-</td>
                  <td className="text-right py-2 px-1 text-foreground">{clientsByCoupling['TÉTRA'].totalProdKVA.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-purple-700 dark:text-purple-300 font-semibold">{(clientsByCoupling['TÉTRA'].totalProdKVA * foisonnementProductions / 100).toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-foreground font-semibold">{clientsByCoupling['TÉTRA'].totalKVA.toFixed(1)}</td>
                  <td className="text-right py-2 px-1 text-foreground font-semibold">
                    {((clientsByCoupling['TÉTRA'].chargeResidentiel * foisonnementResidentiel / 100) + 
                      (clientsByCoupling['TÉTRA'].chargeIndustriel * foisonnementIndustriel / 100)).toFixed(1)}
                  </td>
                  <td className="text-right py-2 px-1 text-foreground">-</td>
                  <td className="text-right py-2 px-1 text-foreground font-semibold">{clientsByCoupling['TÉTRA'].totalCurrent.toFixed(1)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        <div className="mt-2 text-[10px] text-muted-foreground">
          {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' 
            ? `💡 Foisonnement différencié: Résidentiel ${foisonnementResidentiel}%, Industriel ${foisonnementIndustriel}%. Le courant de neutre est calculé vectoriellement.`
            : `💡 Foisonnement différencié: Résidentiel ${foisonnementResidentiel}%, Industriel ${foisonnementIndustriel}%. Réseau 230V sans neutre.`}
        </div>
      </div>
        </>
      )}
    </div>
  );
};
