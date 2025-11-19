import { ClientImporte, VoltageSystem, ClientConnectionType, Node, LoadModel } from '@/types/network';

/**
 * Normalise le couplage brut du client en type de connexion standardisé
 */
export function normalizeClientConnectionType(
  couplage: string | undefined, 
  networkVoltage: VoltageSystem
): ClientConnectionType {
  const normalized = (couplage || '').trim().toUpperCase();
  
  // Cas MONO : valeurs explicites ou indéterminées
  if (normalized === 'MONO' || normalized === '?' || normalized === '' || !couplage) {
    return 'MONO';
  }
  
  // Cas TRI
  if (normalized === 'TRI' || normalized === 'TRIPHASÉ' || normalized === 'TRIPHASE') {
    return 'TRI';
  }
  
  // Cas TÉTRA
  if (normalized === 'TÉTRA' || normalized === 'TETRA' || normalized === 'TÉTRAPHASÉ' || normalized === 'TETRAPHASE') {
    return 'TETRA';
  }
  
  // Par défaut : MONO (comportement conservateur)
  console.warn(`⚠️ Couplage inconnu "${couplage}", traité comme MONO`);
  return 'MONO';
}

/**
 * Valide la cohérence entre le type de connexion du client et le réseau
 * Retourne le type corrigé si nécessaire + un message d'avertissement
 */
export function validateAndConvertConnectionType(
  connectionType: ClientConnectionType,
  networkVoltage: VoltageSystem,
  clientName: string
): { 
  correctedType: ClientConnectionType; 
  warning?: string;
} {
  // Réseau 230V : TRI autorisé, TÉTRA converti en TRI
  if (networkVoltage === 'TRIPHASÉ_230V') {
    if (connectionType === 'TETRA') {
      return {
        correctedType: 'TRI',
        warning: `⚠️ Client "${clientName}" (TÉTRA) converti en TRI pour réseau 230V`
      };
    }
  }
  
  // Réseau 400V : TÉTRA autorisé, TRI converti en TÉTRA
  if (networkVoltage === 'TÉTRAPHASÉ_400V') {
    if (connectionType === 'TRI') {
      return {
        correctedType: 'TETRA',
        warning: `⚠️ Client "${clientName}" (TRI) converti en TÉTRA pour réseau 400V`
      };
    }
  }
  
  // MONO toujours valide sur les deux réseaux
  return { correctedType: connectionType };
}

/**
 * Assigne automatiquement une phase à un client MONO
 * Algorithme : équilibrage par puissance totale (charge + production)
 */
export function autoAssignPhaseForMonoClient(
  client: ClientImporte,
  existingClients: ClientImporte[]
): 'A' | 'B' | 'C' {
  // Calculer la puissance totale par phase des clients déjà assignés
  const phaseLoads = { A: 0, B: 0, C: 0 };
  
  existingClients.forEach(c => {
    if (c.connectionType === 'MONO' && c.assignedPhase) {
      const totalPower = c.puissanceContractuelle_kVA + c.puissancePV_kVA;
      phaseLoads[c.assignedPhase] += totalPower;
    }
  });
  
  // Puissance du nouveau client
  const clientTotalPower = client.puissanceContractuelle_kVA + client.puissancePV_kVA;
  
  // Trouver la/les phase(s) avec la plus faible charge
  const phases: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
  const minLoad = Math.min(phaseLoads.A, phaseLoads.B, phaseLoads.C);
  const minPhases = phases.filter(p => phaseLoads[p] === minLoad);
  
  // Si plusieurs phases ont la même charge minimale, choisir aléatoirement
  const assignedPhase = minPhases[Math.floor(Math.random() * minPhases.length)];
  
  console.log(`📌 Client MONO "${client.nomCircuit}" assigné à phase ${assignedPhase}`);
  console.log(`   Charges avant: A=${phaseLoads.A.toFixed(1)} kVA, B=${phaseLoads.B.toFixed(1)} kVA, C=${phaseLoads.C.toFixed(1)} kVA`);
  console.log(`   Puissance client: ${clientTotalPower.toFixed(1)} kVA`);
  
  return assignedPhase;
}

interface NodePhaseDistributionResult {
  charges: {
    mono: { A: number; B: number; C: number };
    poly: { A: number; B: number; C: number };
    total: { A: number; B: number; C: number };
  };
  productions: {
    mono: { A: number; B: number; C: number };
    poly: { A: number; B: number; C: number };
    total: { A: number; B: number; C: number };
  };
  monoClientsCount: { A: number; B: number; C: number };
  polyClientsCount: number;
  unbalancePercent: number; // Déséquilibre mesuré (max écart vs moyenne)
}

/**
 * Calcule la distribution automatique de phase pour un nœud en mode mixte
 */
export function calculateNodeAutoPhaseDistribution(
  node: Node,
  linkedClients: ClientImporte[],
  manualPhaseDistributionCharges: { A: number; B: number; C: number }, // Répartition manuelle CHARGES (%)
  manualPhaseDistributionProductions: { A: number; B: number; C: number }, // Répartition manuelle PRODUCTIONS (%)
  phaseDistributionModeCharges: 'mono_only' | 'all_clients' = 'mono_only', // Mode d'application pour les charges
  phaseDistributionModeProductions: 'mono_only' | 'all_clients' = 'mono_only' // Mode d'application pour les productions
): NodePhaseDistributionResult {
  // Initialisation des résultats
  const result: NodePhaseDistributionResult = {
    charges: {
      mono: { A: 0, B: 0, C: 0 },
      poly: { A: 0, B: 0, C: 0 },
      total: { A: 0, B: 0, C: 0 }
    },
    productions: {
      mono: { A: 0, B: 0, C: 0 },
      poly: { A: 0, B: 0, C: 0 },
      total: { A: 0, B: 0, C: 0 }
    },
    monoClientsCount: { A: 0, B: 0, C: 0 },
    polyClientsCount: 0,
    unbalancePercent: 0
  };
  
  // === 1. CLIENTS IMPORTÉS ===
  let totalMonoCharges = 0;
  let totalMonoProductions = 0;

  linkedClients.forEach(client => {
    if (client.connectionType === 'MONO') {
      // ✅ CORRECTION : Utiliser assignedPhase réelle du client MONO
      if (client.assignedPhase) {
        const chargeKVA = client.puissanceContractuelle_kVA;
        const prodKVA = client.puissancePV_kVA;
        
        // ✅ CHARGES : Vérifier le mode charges
        if (phaseDistributionModeCharges === 'all_clients') {
          // Mode "TOUS LES CLIENTS" : Garder sur la phase assignée
          result.charges.mono[client.assignedPhase] += chargeKVA;
        } else {
          // Mode "MONO UNIQUEMENT" : Répartir selon les pourcentages manuels
          result.charges.mono.A += chargeKVA * (manualPhaseDistributionCharges.A / 100);
          result.charges.mono.B += chargeKVA * (manualPhaseDistributionCharges.B / 100);
          result.charges.mono.C += chargeKVA * (manualPhaseDistributionCharges.C / 100);
        }
        
        // ✅ PRODUCTIONS : Vérifier le mode productions
        if (phaseDistributionModeProductions === 'all_clients') {
          // Mode "TOUS LES CLIENTS" : Garder sur la phase assignée
          result.productions.mono[client.assignedPhase] += prodKVA;
        } else {
          // Mode "MONO UNIQUEMENT" : Répartir selon les pourcentages manuels
          result.productions.mono.A += prodKVA * (manualPhaseDistributionProductions.A / 100);
          result.productions.mono.B += prodKVA * (manualPhaseDistributionProductions.B / 100);
          result.productions.mono.C += prodKVA * (manualPhaseDistributionProductions.C / 100);
        }
        
        // Compter le client sur sa phase assignée
        result.monoClientsCount[client.assignedPhase] += 1;
      } else {
        // Fallback si pas de phase assignée (ne devrait pas arriver en mode mixte)
        console.warn(`⚠️ Client MONO ${client.nomCircuit} sans assignedPhase`);
      }
    } else {
      // Client TRI/TÉTRA : appliquer les modes séparément pour charges et productions
      const chargePerPhase = client.puissanceContractuelle_kVA / 3;
      const prodPerPhase = client.puissancePV_kVA / 3;
      
      // Charges : utiliser le mode charges
      if (phaseDistributionModeCharges === 'all_clients') {
        const totalCharge = client.puissanceContractuelle_kVA;
        result.charges.poly.A += totalCharge * (manualPhaseDistributionCharges.A / 100);
        result.charges.poly.B += totalCharge * (manualPhaseDistributionCharges.B / 100);
        result.charges.poly.C += totalCharge * (manualPhaseDistributionCharges.C / 100);
      } else {
        // MODE "MONO UNIQUEMENT" : Répartir équitablement (33.33% par phase)
        result.charges.poly.A += chargePerPhase;
        result.charges.poly.B += chargePerPhase;
        result.charges.poly.C += chargePerPhase;
      }
      
      // Productions : utiliser le mode productions
      if (phaseDistributionModeProductions === 'all_clients') {
        const totalProd = client.puissancePV_kVA;
        result.productions.poly.A += totalProd * (manualPhaseDistributionProductions.A / 100);
        result.productions.poly.B += totalProd * (manualPhaseDistributionProductions.B / 100);
        result.productions.poly.C += totalProd * (manualPhaseDistributionProductions.C / 100);
      } else {
        // MODE "MONO UNIQUEMENT" : Répartir équitablement (33.33% par phase)
        result.productions.poly.A += prodPerPhase;
        result.productions.poly.B += prodPerPhase;
        result.productions.poly.C += prodPerPhase;
      }
      
      result.polyClientsCount++;
    }
  });
  
  // === 2. CHARGES/PRODUCTIONS MANUELLES DU NŒUD ===
  const manualChargeTotal = node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
  const manualProdTotal = node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
  
  if (node.manualLoadType === 'MONO') {
    // Charges manuelles MONO : appliquer répartition manuelle (%)
    // ✅ Curseurs CHARGES pour les charges
    const ratioChargesA = manualPhaseDistributionCharges.A / 100;
    const ratioChargesB = manualPhaseDistributionCharges.B / 100;
    const ratioChargesC = manualPhaseDistributionCharges.C / 100;
    
    // ✅ Curseurs PRODUCTIONS pour les productions
    const ratioProdsA = manualPhaseDistributionProductions.A / 100;
    const ratioProdsB = manualPhaseDistributionProductions.B / 100;
    const ratioProdsC = manualPhaseDistributionProductions.C / 100;
    
    result.charges.mono.A += manualChargeTotal * ratioChargesA;
    result.charges.mono.B += manualChargeTotal * ratioChargesB;
    result.charges.mono.C += manualChargeTotal * ratioChargesC;
    
    result.productions.mono.A += manualProdTotal * ratioProdsA;
    result.productions.mono.B += manualProdTotal * ratioProdsB;
    result.productions.mono.C += manualProdTotal * ratioProdsC;
  } else {
    // Charges manuelles POLY : répartir équitablement
    result.charges.poly.A += manualChargeTotal / 3;
    result.charges.poly.B += manualChargeTotal / 3;
    result.charges.poly.C += manualChargeTotal / 3;
    
    result.productions.poly.A += manualProdTotal / 3;
    result.productions.poly.B += manualProdTotal / 3;
    result.productions.poly.C += manualProdTotal / 3;
  }
  
  // === 3. TOTAUX PAR PHASE ===
  result.charges.total.A = result.charges.mono.A + result.charges.poly.A;
  result.charges.total.B = result.charges.mono.B + result.charges.poly.B;
  result.charges.total.C = result.charges.mono.C + result.charges.poly.C;
  
  result.productions.total.A = result.productions.mono.A + result.productions.poly.A;
  result.productions.total.B = result.productions.mono.B + result.productions.poly.B;
  result.productions.total.C = result.productions.mono.C + result.productions.poly.C;
  
  // 🔍 Logs de débogage détaillés
  console.log(`🔍 Distribution nœud "${node.name}" (mode charges: ${phaseDistributionModeCharges}, mode productions: ${phaseDistributionModeProductions})`);
  console.log(`   📊 Curseurs CHARGES: A=${manualPhaseDistributionCharges.A.toFixed(1)}%, B=${manualPhaseDistributionCharges.B.toFixed(1)}%, C=${manualPhaseDistributionCharges.C.toFixed(1)}%`);
  console.log(`   📊 Curseurs PRODUCTIONS: A=${manualPhaseDistributionProductions.A.toFixed(1)}%, B=${manualPhaseDistributionProductions.B.toFixed(1)}%, C=${manualPhaseDistributionProductions.C.toFixed(1)}%`);
  console.log(`   ⚡ Charges MONO: A=${result.charges.mono.A.toFixed(1)}kVA, B=${result.charges.mono.B.toFixed(1)}kVA, C=${result.charges.mono.C.toFixed(1)}kVA`);
  console.log(`   ⚡ Charges POLY: A=${result.charges.poly.A.toFixed(1)}kVA, B=${result.charges.poly.B.toFixed(1)}kVA, C=${result.charges.poly.C.toFixed(1)}kVA`);
  console.log(`   ☀️ Productions MONO: A=${result.productions.mono.A.toFixed(1)}kVA, B=${result.productions.mono.B.toFixed(1)}kVA, C=${result.productions.mono.C.toFixed(1)}kVA`);
  console.log(`   ☀️ Productions POLY: A=${result.productions.poly.A.toFixed(1)}kVA, B=${result.productions.poly.B.toFixed(1)}kVA, C=${result.productions.poly.C.toFixed(1)}kVA`);
  console.log(`   TOTAL Charges: A=${result.charges.total.A.toFixed(1)}kVA, B=${result.charges.total.B.toFixed(1)}kVA, C=${result.charges.total.C.toFixed(1)}kVA`);
  
  // === 4. CALCUL DÉSÉQUILIBRE ===
  const totalCharges = [
    result.charges.total.A,
    result.charges.total.B,
    result.charges.total.C
  ];
  
  const moyenne = totalCharges.reduce((sum, val) => sum + val, 0) / 3;
  
  if (moyenne > 0) {
    const maxEcart = Math.max(
      ...totalCharges.map(val => Math.abs((val - moyenne) / moyenne * 100))
    );
    result.unbalancePercent = maxEcart;
  }
  
  return result;
}

/**
 * Calcule les pourcentages de répartition réelle des clients MONO
 * basé sur leur assignedPhase (ou équilibré pour charges manuelles)
 * Utilisé pour initialiser les curseurs automatiquement
 */
/**
 * Calcule la répartition réelle des CHARGES MONO par phase
 */
export function calculateRealMonoDistributionPercents(
  nodes: Node[],
  clientsImportes: ClientImporte[],
  clientLinks: { clientId: string; nodeId: string }[]
): { A: number; B: number; C: number } {
  const totalMonoPerPhase = { A: 0, B: 0, C: 0 };
  
  nodes.forEach(node => {
    // 1. Clients importés MONO avec leur phase assignée
    const linkedClients = clientsImportes.filter(client =>
      clientLinks.some(link => link.clientId === client.id && link.nodeId === node.id)
    );
    
    linkedClients.forEach(client => {
      if (client.connectionType === 'MONO' && client.assignedPhase) {
        totalMonoPerPhase[client.assignedPhase] += client.puissanceContractuelle_kVA;
      }
    });
    
    // 2. Charges manuelles MONO du nœud (réparties équitablement par défaut)
    if (node.manualLoadType === 'MONO') {
      const manualTotal = node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
      // Pour les charges manuelles, on considère une répartition équilibrée initiale
      totalMonoPerPhase.A += manualTotal / 3;
      totalMonoPerPhase.B += manualTotal / 3;
      totalMonoPerPhase.C += manualTotal / 3;
    }
  });
  
  const total = totalMonoPerPhase.A + totalMonoPerPhase.B + totalMonoPerPhase.C;
  
  // Si pas de charges MONO, retourner équilibré
  if (total === 0) {
    return { A: 33.33, B: 33.33, C: 33.34 };
  }
  
  // Convertir en pourcentages
  return {
    A: (totalMonoPerPhase.A / total) * 100,
    B: (totalMonoPerPhase.B / total) * 100,
    C: (totalMonoPerPhase.C / total) * 100
  };
}

/**
 * Calcule la répartition réelle des PRODUCTIONS MONO par phase
 */
export function calculateRealMonoProductionDistributionPercents(
  nodes: Node[],
  clientsImportes: ClientImporte[],
  clientLinks: { clientId: string; nodeId: string }[]
): { A: number; B: number; C: number } {
  const totalMonoPerPhase = { A: 0, B: 0, C: 0 };
  
  nodes.forEach(node => {
    // 1. Productions PV des clients importés MONO avec leur phase assignée
    const linkedClients = clientsImportes.filter(client =>
      clientLinks.some(link => link.clientId === client.id && link.nodeId === node.id)
    );
    
    linkedClients.forEach(client => {
      if (client.connectionType === 'MONO' && client.assignedPhase && client.puissancePV_kVA) {
        totalMonoPerPhase[client.assignedPhase] += client.puissancePV_kVA;
      }
    });
    
    // 2. Productions manuelles du nœud
    // Note: On ne peut pas déterminer si les productions manuelles sont MONO ou POLY
    // On les répartit équitablement si le nœud a un type de charge manuel MONO
    if (node.manualLoadType === 'MONO' && node.productions.length > 0) {
      const manualTotal = node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
      totalMonoPerPhase.A += manualTotal / 3;
      totalMonoPerPhase.B += manualTotal / 3;
      totalMonoPerPhase.C += manualTotal / 3;
    }
  });
  
  const total = totalMonoPerPhase.A + totalMonoPerPhase.B + totalMonoPerPhase.C;
  
  // Si pas de productions MONO, retourner équilibré
  if (total === 0) {
    return { A: 33.33, B: 33.33, C: 33.34 };
  }
  
  // Convertir en pourcentages
  return {
    A: (totalMonoPerPhase.A / total) * 100,
    B: (totalMonoPerPhase.B / total) * 100,
    C: (totalMonoPerPhase.C / total) * 100
  };
}

/**
 * Calcule le déséquilibre global du projet en mode mixte
 */
export function calculateProjectUnbalance(
  nodes: Node[]
): { 
  unbalancePercent: number; 
  status: 'normal' | 'warning' | 'critical';
  phaseLoads: { A: number; B: number; C: number };
} {
  const totalPhaseLoads = { A: 0, B: 0, C: 0 };
  
  nodes.forEach(node => {
    if (node.autoPhaseDistribution) {
      totalPhaseLoads.A += node.autoPhaseDistribution.charges.total.A;
      totalPhaseLoads.B += node.autoPhaseDistribution.charges.total.B;
      totalPhaseLoads.C += node.autoPhaseDistribution.charges.total.C;
    }
  });
  
  const moyenne = (totalPhaseLoads.A + totalPhaseLoads.B + totalPhaseLoads.C) / 3;
  
  const unbalancePercent = moyenne > 0 ? Math.max(
    Math.abs((totalPhaseLoads.A - moyenne) / moyenne * 100),
    Math.abs((totalPhaseLoads.B - moyenne) / moyenne * 100),
    Math.abs((totalPhaseLoads.C - moyenne) / moyenne * 100)
  ) : 0;
  
  let status: 'normal' | 'warning' | 'critical' = 'normal';
  if (unbalancePercent >= 20) status = 'critical';
  else if (unbalancePercent >= 10) status = 'warning';
  
  return { unbalancePercent, status, phaseLoads: totalPhaseLoads };
}
