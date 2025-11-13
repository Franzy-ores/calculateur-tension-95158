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
  manualPhaseDistribution: { A: number; B: number; C: number } // Répartition manuelle (%)
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
        result.charges.mono[client.assignedPhase] += client.puissanceContractuelle_kVA;
        result.productions.mono[client.assignedPhase] += client.puissancePV_kVA;
        result.monoClientsCount[client.assignedPhase]++;
      } else {
        // Fallback si pas de phase assignée (ne devrait pas arriver en mode mixte)
        console.warn(`⚠️ Client MONO ${client.nomCircuit} sans assignedPhase`);
      }
    } else {
      // Client TRI/TÉTRA : répartir équitablement (33.33% par phase)
      const chargePerPhase = client.puissanceContractuelle_kVA / 3;
      const prodPerPhase = client.puissancePV_kVA / 3;
      
      result.charges.poly.A += chargePerPhase;
      result.charges.poly.B += chargePerPhase;
      result.charges.poly.C += chargePerPhase;
      
      result.productions.poly.A += prodPerPhase;
      result.productions.poly.B += prodPerPhase;
      result.productions.poly.C += prodPerPhase;
      
      result.polyClientsCount++;
    }
  });
  
  // === 2. CHARGES/PRODUCTIONS MANUELLES DU NŒUD ===
  const manualChargeTotal = node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
  const manualProdTotal = node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
  
  if (node.manualLoadType === 'MONO') {
    // Charges manuelles MONO : appliquer répartition manuelle (%)
    const ratioA = manualPhaseDistribution.A / 100;
    const ratioB = manualPhaseDistribution.B / 100;
    const ratioC = manualPhaseDistribution.C / 100;
    
    result.charges.mono.A += manualChargeTotal * ratioA;
    result.charges.mono.B += manualChargeTotal * ratioB;
    result.charges.mono.C += manualChargeTotal * ratioC;
    
    result.productions.mono.A += manualProdTotal * ratioA;
    result.productions.mono.B += manualProdTotal * ratioB;
    result.productions.mono.C += manualProdTotal * ratioC;
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
