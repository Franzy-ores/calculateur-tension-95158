import { HourlyVoltageResult, ClientHourlyVoltageResult, DailySimulationOptions, DailyProfileConfig } from '@/types/dailyProfile';
import { ClientImporte, Project } from '@/types/network';
import { BranchementCableType } from '@/data/branchementCableTypes';
import defaultProfiles from '@/data/hourlyProfiles.json';

/**
 * Détermine le statut de conformité EN50160 pour une tension donnée
 */
const getVoltageStatus = (voltage: number, nominalVoltage: number): 'normal' | 'warning' | 'critical' => {
  const deviation = Math.abs(voltage - nominalVoltage) / nominalVoltage * 100;
  if (deviation > 10) return 'critical';
  if (deviation > 5) return 'warning';
  return 'normal';
};

/**
 * Calcule les tensions horaires au point de raccordement client
 * 
 * La courbe client utilise:
 * - Les tensions du nœud parent calculées par le moteur réseau (nodeVoltages)
 * - Le câble de branchement sélectionné (cable)
 * - Le profil horaire correspondant au type de client (résidentiel ou industriel)
 * - La puissance du client uniquement (pas tout le réseau)
 */
export function calculateClientDailyVoltages(
  nodeVoltages: HourlyVoltageResult[],
  client: ClientImporte,
  cable: BranchementCableType,
  length_m: number,
  voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V',
  options: DailySimulationOptions,
  customProfiles?: DailyProfileConfig,
  project?: Project
): ClientHourlyVoltageResult[] {
  const profiles = customProfiles || (defaultProfiles as DailyProfileConfig);
  const seasonProfile = profiles.profiles[options.season];
  const weatherFactor = profiles.weatherFactors[options.weather];
  
  const L_km = length_m / 1000;
  const R = cable.R_ohm_per_km;
  const X = cable.X_ohm_per_km;
  
  // cos φ du projet
  const cosPhiCharges = project?.cosPhiCharges || 0.95;
  const cosPhiProductions = project?.cosPhiProductions || 1.0;
  const sinPhiCharges = Math.sqrt(1 - cosPhiCharges ** 2);
  const sinPhiProductions = Math.sqrt(1 - cosPhiProductions ** 2);
  
  const is230V = voltageSystem === 'TRIPHASÉ_230V';
  const connectionType = client.connectionType || 'MONO';
  const isIndustrial = client.clientType === 'industriel';
  
  // Tension nominale de référence
  const nominalVoltage = 230;
  
  return nodeVoltages.map((nodeResult) => {
    const hour = nodeResult.hour;
    const hourStr = hour.toString();
    
    // Foisonnement horaire selon le type de client
    // Le profil industriel est automatiquement appliqué aux clients industriels
    let hourlyFoisonnement: number;
    if (isIndustrial) {
      hourlyFoisonnement = seasonProfile.industrial_pme[hourStr] || 0;
    } else {
      // Profil résidentiel avec bonus VE éventuel
      let baseFoisonnement = seasonProfile.residential[hourStr] || 0;
      
      // Appliquer bonus VE si activé
      if (options.enableEV) {
        const bonusEvening = options.evBonusEvening ?? 2.5;
        const bonusNight = options.evBonusNight ?? 5;
        
        if (hour >= 18 && hour <= 21) {
          baseFoisonnement += bonusEvening;
        } else if (hour >= 22 || hour <= 5) {
          baseFoisonnement += bonusNight;
        }
      }
      hourlyFoisonnement = baseFoisonnement;
    }
    
    // Profil production (PV)
    const productionProfile = options.zeroProduction ? 0 : (seasonProfile.pv[hourStr] || 0) * weatherFactor;
    
    // Puissances du client avec foisonnement horaire
    const S_charge = client.puissanceContractuelle_kVA * (hourlyFoisonnement / 100) * 1000; // VA
    const S_prod = client.puissancePV_kVA * (productionProfile / 100) * 1000; // VA
    
    // Tension au nœud (moyenne des 3 phases ou phase spécifique selon couplage)
    let V_node: number;
    if (connectionType === 'MONO') {
      // Client monophasé : utiliser la phase assignée
      if (is230V) {
        // 230V triangle : utiliser le couplage phase-phase
        const coupling = client.phaseCoupling || 'A-B';
        if (coupling.includes('A') && coupling.includes('B')) {
          V_node = nodeResult.voltageA_V;
        } else if (coupling.includes('B') && coupling.includes('C')) {
          V_node = nodeResult.voltageB_V;
        } else {
          V_node = nodeResult.voltageC_V;
        }
      } else {
        // 400V étoile : utiliser la phase assignée
        const phase = client.assignedPhase || 'A';
        if (phase === 'A') V_node = nodeResult.voltageA_V;
        else if (phase === 'B') V_node = nodeResult.voltageB_V;
        else V_node = nodeResult.voltageC_V;
      }
    } else {
      // Client triphasé/tétraphasé : utiliser la moyenne des phases
      V_node = nodeResult.voltageAvg_V;
    }
    
    // Calcul du ΔU dans le câble de branchement
    let deltaU: number;
    
    if (connectionType === 'MONO') {
      // Monophasé : formule avec facteur 2
      const U_ref = 230;
      const I_charge = S_charge / U_ref;
      const I_prod = S_prod / U_ref;
      
      const deltaU_charge = 2 * I_charge * (R * cosPhiCharges + X * sinPhiCharges) * L_km;
      const deltaU_prod = 2 * I_prod * (R * cosPhiProductions + X * sinPhiProductions) * L_km;
      deltaU = deltaU_charge - deltaU_prod;
    } else {
      // Triphasé/Tétraphasé : formule triphasée
      const U_ligne = is230V ? 230 : 400;
      const I_charge = S_charge / (Math.sqrt(3) * U_ligne);
      const I_prod = S_prod / (Math.sqrt(3) * U_ligne);
      
      const deltaU_charge = Math.sqrt(3) * I_charge * (R * cosPhiCharges + X * sinPhiCharges) * L_km;
      const deltaU_prod = Math.sqrt(3) * I_prod * (R * cosPhiProductions + X * sinPhiProductions) * L_km;
      deltaU = deltaU_charge - deltaU_prod;
    }
    
    const V_client = V_node - deltaU;
    
    return {
      hour,
      voltageClient_V: V_client,
      voltageNode_V: V_node,
      deltaU_V: deltaU,
      foisonnementApplied: hourlyFoisonnement,
      status: getVoltageStatus(V_client, nominalVoltage)
    };
  });
}
