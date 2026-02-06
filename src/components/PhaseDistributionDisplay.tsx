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
  // Variables MONO (toujours résidentiel)
  let nbMono = 0;
  let chargeMono = 0;
  let productionMono = 0;
  
  // Variables Poly Résidentiel
  let nbPolyRes = 0;
  let chargePolyRes = 0;
  let productionPolyRes = 0;
  
  // Variables Poly Industriel
  let nbPolyInd = 0;
  let chargePolyInd = 0;
  let productionPolyInd = 0;
  
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
        chargeMono += client.puissanceContractuelle_kVA;
        productionMono += client.puissancePV_kVA || 0;
      }
    }
    
    if (client.connectionType === 'TRI' || client.connectionType === 'TETRA') {
      const isResidentiel = client.clientType !== 'industriel';
      const chargeParPhase = client.puissanceContractuelle_kVA / 3;
      const prodParPhase = (client.puissancePV_kVA || 0) / 3;
      
      if (isResidentiel) {
        nbPolyRes += 1/3; // Comptage fractionnel
        chargePolyRes += chargeParPhase;
        productionPolyRes += prodParPhase;
      } else {
        nbPolyInd += 1/3;
        chargePolyInd += chargeParPhase;
        productionPolyInd += prodParPhase;
      }
    }
  });
  
  // Calculs foisonnés par catégorie
  const chargeMonoFoisonne = chargeMono * (foisonnementChargesResidentiel / 100);
  const prodMonoFoisonne = productionMono * (foisonnementProductions / 100);
  
  const chargePolyResFoisonne = chargePolyRes * (foisonnementChargesResidentiel / 100);
  const prodPolyResFoisonne = productionPolyRes * (foisonnementProductions / 100);
  
  const chargePolyIndFoisonne = chargePolyInd * (foisonnementChargesIndustriel / 100);
  const prodPolyIndFoisonne = productionPolyInd * (foisonnementProductions / 100);
  
  // Totaux foisonnés pour cette phase
  const totalChargeFoisonne = chargeMonoFoisonne + chargePolyResFoisonne + chargePolyIndFoisonne;
  const totalProdFoisonne = prodMonoFoisonne + prodPolyResFoisonne + prodPolyIndFoisonne;
  
  // Calcul déséquilibre via curseurs
  const curseurCharge = manualPhaseDistribution?.charges[phase] || 33.33;
  const ecartChargePercent = ((curseurCharge - 33.33) / 33.33) * 100;
  
  // Intensité : (Charges - Productions) foisonnées / 230V
  const voltage = 230;
  const courantTotal = ((totalChargeFoisonne - totalProdFoisonne) * 1000) / voltage;
  
  return {
    // MONO
    nbMono,
    chargeMono,
    prodMono: productionMono,
    chargeMonoFoisonne,
    prodMonoFoisonne,
    
    // Poly Résidentiel
    nbPolyRes,
    chargePolyRes,
    prodPolyRes: productionPolyRes,
    chargePolyResFoisonne,
    prodPolyResFoisonne,
    
    // Poly Industriel
    nbPolyInd,
    chargePolyInd,
    prodPolyInd: productionPolyInd,
    chargePolyIndFoisonne,
    prodPolyIndFoisonne,
    
    // Totaux
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

  // Section: Tableau récapitulatif (17 colonnes avec charges et productions)
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
        <table className="w-full text-[10px] border-collapse">
          <thead>
            {/* Ligne de regroupement */}
            <tr className="border-b border-border">
              <th rowSpan={2} className="text-left py-1.5 px-1 text-foreground font-semibold align-bottom">Coupl.</th>
              <th colSpan={5} className="text-center py-1 px-0.5 font-semibold bg-primary/10 text-primary border-x border-border">MONO (Rés.)</th>
              <th colSpan={5} className="text-center py-1 px-0.5 font-semibold bg-green-500/10 text-green-700 dark:text-green-400 border-x border-border">Poly Rés.</th>
              <th colSpan={5} className="text-center py-1 px-0.5 font-semibold bg-orange-500/10 text-orange-700 dark:text-orange-400 border-x border-border">Poly Ind.</th>
              <th rowSpan={2} className="text-right py-1.5 px-1 text-foreground font-semibold align-bottom">Déséq.</th>
              <th rowSpan={2} className="text-right py-1.5 px-1 text-foreground font-semibold align-bottom">I (A)</th>
            </tr>
            {/* Ligne des sous-colonnes */}
            <tr className="border-b border-border text-[9px] text-muted-foreground">
              {/* MONO */}
              <th className="py-1 px-0.5 text-center bg-primary/5">Nb</th>
              <th className="py-1 px-0.5 text-right bg-primary/5">Ch.</th>
              <th className="py-1 px-0.5 text-right bg-primary/5">Pr.</th>
              <th className="py-1 px-0.5 text-right bg-primary/5">Ch.F</th>
              <th className="py-1 px-0.5 text-right bg-primary/5 border-r border-border">Pr.F</th>
              {/* Poly Rés. */}
              <th className="py-1 px-0.5 text-center bg-green-500/5">Nb</th>
              <th className="py-1 px-0.5 text-right bg-green-500/5">Ch.</th>
              <th className="py-1 px-0.5 text-right bg-green-500/5">Pr.</th>
              <th className="py-1 px-0.5 text-right bg-green-500/5">Ch.F</th>
              <th className="py-1 px-0.5 text-right bg-green-500/5 border-r border-border">Pr.F</th>
              {/* Poly Ind. */}
              <th className="py-1 px-0.5 text-center bg-orange-500/5">Nb</th>
              <th className="py-1 px-0.5 text-right bg-orange-500/5">Ch.</th>
              <th className="py-1 px-0.5 text-right bg-orange-500/5">Pr.</th>
              <th className="py-1 px-0.5 text-right bg-orange-500/5">Ch.F</th>
              <th className="py-1 px-0.5 text-right bg-orange-500/5 border-r border-border">Pr.F</th>
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
            
              const bgClass = phase === 'A' ? 'bg-blue-50/50 dark:bg-blue-500/5' : phase === 'B' ? 'bg-green-50/50 dark:bg-green-500/5' : 'bg-red-50/50 dark:bg-red-500/5';
              const ecartColor = Math.abs(data.ecartChargePercent) < 5 ? 'text-green-600' : Math.abs(data.ecartChargePercent) < 15 ? 'text-yellow-600' : 'text-red-600';
              
              return (
                <tr key={phase} className={`border-b border-border/50 ${bgClass}`}>
                  <td className="py-1 px-1 text-foreground font-semibold">{phaseLabel}</td>
                  {/* MONO */}
                  <td className="text-center py-1 px-0.5 text-foreground">{data.nbMono}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{data.chargeMono.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{data.prodMono.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-primary font-medium">{data.chargeMonoFoisonne.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-primary font-medium border-r border-border/50">{data.prodMonoFoisonne.toFixed(1)}</td>
                  {/* Poly Rés. */}
                  <td className="text-center py-1 px-0.5 text-foreground">{Math.round(data.nbPolyRes)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{data.chargePolyRes.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{data.prodPolyRes.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-green-700 dark:text-green-400 font-medium">{data.chargePolyResFoisonne.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-green-700 dark:text-green-400 font-medium border-r border-border/50">{data.prodPolyResFoisonne.toFixed(1)}</td>
                  {/* Poly Ind. */}
                  <td className="text-center py-1 px-0.5 text-foreground">{Math.round(data.nbPolyInd)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{data.chargePolyInd.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{data.prodPolyInd.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-orange-700 dark:text-orange-400 font-medium">{data.chargePolyIndFoisonne.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-orange-700 dark:text-orange-400 font-medium border-r border-border/50">{data.prodPolyIndFoisonne.toFixed(1)}</td>
                  {/* Totaux */}
                  <td className={`text-right py-1 px-1 font-bold ${ecartColor}`}>
                    {data.ecartChargePercent > 0 ? '+' : ''}{data.ecartChargePercent.toFixed(0)}%
                  </td>
                  <td className="text-right py-1 px-1 text-foreground font-semibold">{Math.abs(data.courantTotal).toFixed(1)}</td>
                </tr>
              );
            })}
            {/* LIGNE TOTAL */}
            {(() => {
              // Calculer les totaux globaux pour toutes les phases
              const totals = { 
                nbMono: 0, chargeMono: 0, prodMono: 0, chargeMonoFoisonne: 0, prodMonoFoisonne: 0,
                nbPolyRes: 0, chargePolyRes: 0, prodPolyRes: 0, chargePolyResFoisonne: 0, prodPolyResFoisonne: 0,
                nbPolyInd: 0, chargePolyInd: 0, prodPolyInd: 0, chargePolyIndFoisonne: 0, prodPolyIndFoisonne: 0,
                courantTotal: 0
              };
              
              (['A', 'B', 'C'] as const).forEach(phase => {
                const data = calculatePhaseData(
                  currentProject.nodes, phase, foisonnementResidentiel, foisonnementIndustriel,
                  foisonnementProductions, globalFoisonne.totalFoisonneChargeGlobal,
                  globalFoisonne.totalFoisonneProductionGlobal, currentProject.clientsImportes,
                  currentProject.clientLinks, is230V, currentProject.manualPhaseDistribution
                );
                totals.nbMono += data.nbMono;
                totals.chargeMono += data.chargeMono;
                totals.prodMono += data.prodMono;
                totals.chargeMonoFoisonne += data.chargeMonoFoisonne;
                totals.prodMonoFoisonne += data.prodMonoFoisonne;
                totals.nbPolyRes += data.nbPolyRes;
                totals.chargePolyRes += data.chargePolyRes;
                totals.prodPolyRes += data.prodPolyRes;
                totals.chargePolyResFoisonne += data.chargePolyResFoisonne;
                totals.prodPolyResFoisonne += data.prodPolyResFoisonne;
                totals.nbPolyInd += data.nbPolyInd;
                totals.chargePolyInd += data.chargePolyInd;
                totals.prodPolyInd += data.prodPolyInd;
                totals.chargePolyIndFoisonne += data.chargePolyIndFoisonne;
                totals.prodPolyIndFoisonne += data.prodPolyIndFoisonne;
                totals.courantTotal += Math.abs(data.courantTotal);
              });

              return (
                <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                  <td className="py-1.5 px-1 text-foreground">TOTAL</td>
                  {/* MONO */}
                  <td className="text-center py-1 px-0.5 text-foreground">{totals.nbMono}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{totals.chargeMono.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{totals.prodMono.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-primary font-bold">{totals.chargeMonoFoisonne.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-primary font-bold border-r border-border/50">{totals.prodMonoFoisonne.toFixed(1)}</td>
                  {/* Poly Rés. */}
                  <td className="text-center py-1 px-0.5 text-foreground">{Math.round(totals.nbPolyRes)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{totals.chargePolyRes.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{totals.prodPolyRes.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-green-700 dark:text-green-400 font-bold">{totals.chargePolyResFoisonne.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-green-700 dark:text-green-400 font-bold border-r border-border/50">{totals.prodPolyResFoisonne.toFixed(1)}</td>
                  {/* Poly Ind. */}
                  <td className="text-center py-1 px-0.5 text-foreground">{Math.round(totals.nbPolyInd)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{totals.chargePolyInd.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-foreground">{totals.prodPolyInd.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-orange-700 dark:text-orange-400 font-bold">{totals.chargePolyIndFoisonne.toFixed(1)}</td>
                  <td className="text-right py-1 px-0.5 text-orange-700 dark:text-orange-400 font-bold border-r border-border/50">{totals.prodPolyIndFoisonne.toFixed(1)}</td>
                  {/* Pas de déséquilibre pour la ligne totale */}
                  <td className="text-right py-1 px-1 text-muted-foreground">—</td>
                  <td className="text-right py-1 px-1 text-foreground font-bold">{totals.courantTotal.toFixed(1)}</td>
                </tr>
              );
            })()}
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
