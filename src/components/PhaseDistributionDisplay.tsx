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
  const Ia_complex = Complex.C(Ia, 0);
  const Ib_complex = Complex.fromPolar(Ib, (120 * Math.PI) / 180);
  const Ic_complex = Complex.fromPolar(Ic, (240 * Math.PI) / 180);
  
  const In_complex = Complex.add(Complex.add(Ia_complex, Ib_complex), Ic_complex);
  return Complex.abs(In_complex);
}

// Helper pour calculer toutes les données d'une phase/couplage
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
) {
  let nbMono = 0;
  let chargeMono = 0;
  let chargeMonoResidentiel = 0;
  let chargeMonoIndustriel = 0;
  let productionMono = 0;
  let chargePoly = 0;
  let chargePolyResidentiel = 0;
  let chargePolyIndustriel = 0;
  let productionPoly = 0;
  
  const linkedClientIds = new Set(clientLinks?.map(link => link.clientId) || []);
  
  clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return;
    
    if (client.connectionType === 'MONO') {
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
          chargeMonoResidentiel += client.puissanceContractuelle_kVA;
        } else {
          chargeMonoIndustriel += client.puissanceContractuelle_kVA;
        }
      }
    }
    
    if (client.connectionType === 'TRI' || client.connectionType === 'TETRA') {
      const chargeParPhase = client.puissanceContractuelle_kVA / 3;
      const isResidentiel = client.clientType !== 'industriel';
      
      if (isResidentiel) {
        chargePolyResidentiel += chargeParPhase;
      } else {
        chargePolyIndustriel += chargeParPhase;
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
  
  const totalPhysiqueCharge = chargeMono + chargePoly;
  const totalPhysiqueProduction = productionMono + productionPoly;
  
  const chargeFoisonneResidentiel = chargeMonoResidentiel * (foisonnementChargesResidentiel / 100);
  const chargeFoisonneIndustriel = chargeMonoIndustriel * (foisonnementChargesIndustriel / 100);
  
  const chargePolyFoisonne = 
    chargePolyResidentiel * (foisonnementChargesResidentiel / 100) +
    chargePolyIndustriel * (foisonnementChargesIndustriel / 100);
  
  const totalFoisonneCharge = chargeFoisonneResidentiel + chargeFoisonneIndustriel + chargePolyFoisonne;
  const totalFoisonneProduction = totalPhysiqueProduction * (foisonnementProductions / 100);
  
  const curseurCharge = manualPhaseDistribution?.charges[phase] || 33.33;
  const curseurProduction = manualPhaseDistribution?.productions[phase] || 33.33;
  
  const chargeAvecCurseur = totalFoisonneChargeGlobal * (curseurCharge / 100);
  const productionAvecCurseur = totalFoisonneProductionGlobal * (curseurProduction / 100);
  
  const ecartChargePercent = ((curseurCharge - 33.33) / 33.33) * 100;
  
  const voltage = 230;
  const courantTotal = ((chargeAvecCurseur - productionAvecCurseur) * 1000) / voltage;
  
  return {
    nbMono,
    chargeMono,
    chargePolyResidentiel,
    chargePolyIndustriel,
    productionMono,
    totalPhysiqueCharge,
    totalFoisonneCharge,
    totalFoisonneProduction,
    chargeAvecCurseur,
    ecartChargePercent,
    courantTotal
  };
}

// Helper pour calculer les totaux foisonnés globaux
function calculateGlobalFoisonne(
  nodes: Node[],
  foisonnementChargesResidentiel: number,
  foisonnementChargesIndustriel: number,
  foisonnementProductions: number,
  clientsImportes: ClientImporte[] | undefined,
  clientLinks: { clientId: string; nodeId: string }[] | undefined
) {
  let totalChargePhysiqueResidentiel = 0;
  let totalChargePhysiqueIndustriel = 0;
  let totalProductionPhysique = 0;
  let nbTotalResidentiel = 0;
  let nbTotalIndustriel = 0;
  
  let monoResidentielClients = 0;
  let monoResidentielCharge = 0;
  let polyResidentielClients = 0;
  let polyResidentielCharge = 0;
  let polyIndustrielClients = 0;
  let polyIndustrielCharge = 0;
  
  const linkedClientIds = new Set(clientLinks?.map(link => link.clientId) || []);
  
  clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return;
    
    const isResidentiel = client.clientType !== 'industriel';
    const isMono = client.connectionType === 'MONO';
    const charge = client.puissanceContractuelle_kVA;
    const prod = client.puissancePV_kVA || 0;
    
    if (isResidentiel) {
      totalChargePhysiqueResidentiel += charge;
      nbTotalResidentiel++;
      
      if (isMono) {
        monoResidentielClients++;
        monoResidentielCharge += charge;
      } else {
        polyResidentielClients++;
        polyResidentielCharge += charge;
      }
    } else {
      totalChargePhysiqueIndustriel += charge;
      nbTotalIndustriel++;
      
      polyIndustrielClients++;
      polyIndustrielCharge += charge;
    }
    
    totalProductionPhysique += prod;
  });
  
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
    nbTotalIndustriel,
    monoResidentiel: {
      nbClients: monoResidentielClients,
      charge: monoResidentielCharge,
      foisonne: monoResidentielCharge * (foisonnementChargesResidentiel / 100)
    },
    polyResidentiel: {
      nbClients: polyResidentielClients,
      charge: polyResidentielCharge,
      foisonne: polyResidentielCharge * (foisonnementChargesResidentiel / 100)
    },
    polyIndustriel: {
      nbClients: polyIndustrielClients,
      charge: polyIndustrielCharge,
      foisonne: polyIndustrielCharge * (foisonnementChargesIndustriel / 100)
    }
  };
}

interface PhaseDistributionDisplayProps {
  section?: 'table' | 'stats' | 'alerts' | 'all';
}

export const PhaseDistributionDisplay = ({ section = 'all' }: PhaseDistributionDisplayProps) => {
  const { currentProject, rebalanceAllMonoClients } = useNetworkStore();
  
  if (!currentProject || currentProject.loadModel !== 'mixte_mono_poly') {
    return null;
  }

  const foisonnementResidentiel = currentProject.foisonnementChargesResidentiel ?? 15;
  const foisonnementIndustriel = currentProject.foisonnementChargesIndustriel ?? 70;
  const foisonnementProductions = currentProject.foisonnementProductions;

  const is230V = currentProject.voltageSystem === "TRIPHASÉ_230V";

  const { unbalancePercent, status, phaseLoads } = calculateProjectUnbalance(
    currentProject.nodes
  );
  
  const linkedClientIds = new Set(currentProject.clientLinks?.map(link => link.clientId) || []);
  
  // Identifier les clients MONO à forte puissance par phase
  const highPowerClientsPerPhase: {
    A: ClientImporte[];
    B: ClientImporte[];
    C: ClientImporte[];
  } = { A: [], B: [], C: [] };

  currentProject.clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return;
    
    if (client.connectionType === 'MONO') {
      const analysis = analyzeClientPower(client, currentProject.voltageSystem);
      if (analysis.level === 'high' || analysis.level === 'critical') {
        if (client.assignedPhase) {
          highPowerClientsPerPhase[client.assignedPhase as 'A' | 'B' | 'C'].push(client);
        }
      }
    }
  });
  
  let neutralCurrent = 0;
  if (currentProject.voltageSystem === 'TÉTRAPHASÉ_400V') {
    const voltage = 230;
    const Ia = (phaseLoads.A * 1000) / voltage;
    const Ib = (phaseLoads.B * 1000) / voltage;
    const Ic = (phaseLoads.C * 1000) / voltage;
    neutralCurrent = calculateNeutralCurrent(Ia, Ib, Ic);
  }
  
  const globalFoisonne = calculateGlobalFoisonne(
    currentProject.nodes,
    foisonnementResidentiel,
    foisonnementIndustriel,
    foisonnementProductions,
    currentProject.clientsImportes,
    currentProject.clientLinks
  );

  const hasHighPowerClients = highPowerClientsPerPhase.A.length > 0 || 
    highPowerClientsPerPhase.B.length > 0 || 
    highPowerClientsPerPhase.C.length > 0;

  // Section: Tableau récapitulatif (7 colonnes essentielles)
  const renderTable = () => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={status === 'normal' ? 'default' : status === 'warning' ? 'secondary' : 'destructive'} className="text-xs">
            {status === 'normal' ? '✓' : status === 'warning' ? '⚠️' : '🔴'} {unbalancePercent.toFixed(1)}%
          </Badge>
          {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' && (
            <Badge variant="outline" className="text-xs">
              Neutre: {neutralCurrent.toFixed(1)} A
            </Badge>
          )}
        </div>
        <Button
          onClick={rebalanceAllMonoClients}
          size="sm"
          variant="outline"
          className="h-6 text-xs"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Rééquilibrer
        </Button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 px-2 text-foreground font-semibold">Couplage</th>
              <th className="text-center py-1.5 px-1 text-foreground font-semibold">MONO</th>
              <th className="text-right py-1.5 px-1 text-foreground font-semibold">Ch. MONO</th>
              <th className="text-right py-1.5 px-1 text-green-600 dark:text-green-400 font-semibold">Poly Rés.</th>
              <th className="text-right py-1.5 px-1 text-orange-600 dark:text-orange-400 font-semibold">Poly Ind.</th>
              <th className="text-right py-1.5 px-1 text-foreground font-semibold">Déséq.</th>
              <th className="text-right py-1.5 px-1 text-foreground font-semibold">I (A)</th>
            </tr>
          </thead>
          <tbody>
            {(['A', 'B', 'C'] as const).map((phase) => {
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
            
              const bgClass = phase === 'A' ? 'bg-blue-50 dark:bg-blue-500/10' : phase === 'B' ? 'bg-green-50 dark:bg-green-500/10' : 'bg-red-50 dark:bg-red-500/10';
              const ecartColor = Math.abs(data.ecartChargePercent) < 5 ? 'text-green-600' : Math.abs(data.ecartChargePercent) < 15 ? 'text-yellow-600' : 'text-red-600';
              
              return (
                <tr key={phase} className={`border-b border-border/50 ${bgClass}`}>
                  <td className="py-1.5 px-2 text-foreground font-semibold">{phaseLabel}</td>
                  <td className="text-center py-1.5 px-1 text-foreground">{data.nbMono}</td>
                  <td className="text-right py-1.5 px-1 text-foreground">{data.chargeMono.toFixed(1)}</td>
                  <td className="text-right py-1.5 px-1 text-green-700 dark:text-green-300">{data.chargePolyResidentiel.toFixed(1)}</td>
                  <td className="text-right py-1.5 px-1 text-orange-700 dark:text-orange-300">{data.chargePolyIndustriel.toFixed(1)}</td>
                  <td className={`text-right py-1.5 px-1 font-bold ${ecartColor}`}>
                    {data.ecartChargePercent > 0 ? '+' : ''}{data.ecartChargePercent.toFixed(0)}%
                  </td>
                  <td className="text-right py-1.5 px-1 text-foreground font-semibold">{Math.abs(data.courantTotal).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Section: Résumé foisonnement MONO/POLY
  const renderStats = () => (
    <div className="text-xs space-y-2">
      <div className="flex justify-between items-center">
        <span className="font-semibold text-foreground">Total foisonné:</span>
        <span className="font-bold text-primary">{globalFoisonne.totalFoisonneChargeGlobal.toFixed(1)} kVA</span>
      </div>
      
      <div className="pl-2 border-l-2 border-green-500 space-y-1">
        <div className="font-semibold text-green-600 dark:text-green-400">
          🏠 Résidentiel ({foisonnementResidentiel}%)
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>MONO: {globalFoisonne.monoResidentiel.nbClients} clients</span>
          <span className="text-foreground">{globalFoisonne.monoResidentiel.charge.toFixed(1)} → <span className="font-bold text-green-700 dark:text-green-300">{globalFoisonne.monoResidentiel.foisonne.toFixed(1)} kVA</span></span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>TRI/TÉTRA: {globalFoisonne.polyResidentiel.nbClients} clients</span>
          <span className="text-foreground">{globalFoisonne.polyResidentiel.charge.toFixed(1)} → <span className="font-bold text-green-700 dark:text-green-300">{globalFoisonne.polyResidentiel.foisonne.toFixed(1)} kVA</span></span>
        </div>
      </div>
      
      <div className="pl-2 border-l-2 border-orange-500 space-y-1">
        <div className="font-semibold text-orange-600 dark:text-orange-400">
          🏭 Industriel ({foisonnementIndustriel}%)
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>TRI/TÉTRA: {globalFoisonne.polyIndustriel.nbClients} clients</span>
          <span className="text-foreground">{globalFoisonne.polyIndustriel.charge.toFixed(1)} → <span className="font-bold text-orange-700 dark:text-orange-300">{globalFoisonne.polyIndustriel.foisonne.toFixed(1)} kVA</span></span>
        </div>
      </div>
    </div>
  );

  // Section: Alertes fortes puissances (badges compacts)
  const renderAlerts = () => {
    if (!hasHighPowerClients) {
      return (
        <div className="text-xs text-muted-foreground text-center py-2">
          Aucun client MONO à forte puissance détecté
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        {(['A', 'B', 'C'] as const).map((phase) => {
          const clients = highPowerClientsPerPhase[phase];
          const totalKVA = clients.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0);
          const phaseLabel = is230V 
            ? (phase === 'A' ? 'L1-L2' : phase === 'B' ? 'L2-L3' : 'L3-L1')
            : `L${phase === 'A' ? '1' : phase === 'B' ? '2' : '3'}`;
          
          if (clients.length === 0) {
            return (
              <Badge key={phase} variant="outline" className="text-xs">
                {phaseLabel}: 0
              </Badge>
            );
          }
          
          return (
            <Badge key={phase} variant="destructive" className="text-xs">
              ⚠️ {phaseLabel}: {clients.length} ({totalKVA.toFixed(0)} kVA)
            </Badge>
          );
        })}
      </div>
    );
  };

  // Rendu selon la section demandée
  if (section === 'table') return renderTable();
  if (section === 'stats') return renderStats();
  if (section === 'alerts') return renderAlerts();

  // Section 'all': affichage complet (legacy)
  return (
    <div className="flex flex-col gap-3">
      {renderTable()}
      {renderStats()}
      {hasHighPowerClients && renderAlerts()}
    </div>
  );
};
