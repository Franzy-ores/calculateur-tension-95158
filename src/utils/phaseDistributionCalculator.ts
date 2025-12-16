import { ClientImporte, VoltageSystem, ClientConnectionType, Node, LoadModel } from '@/types/network';

/**
 * Facteur de conversion pour les réseaux Triangle (Delta) 230V
 * Relation physique : I_ligne = √3 × I_couplage
 * Donc : S_phase = S_couplage / √3 ≈ 0.577
 */
const DELTA_PHASE_CONTRIBUTION_FACTOR = 1 / Math.sqrt(3); // ≈ 0.577350269

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
 * Pour 230V : retourne un couplage phase-phase (A-B, B-C, A-C)
 * Pour 400V : retourne une phase simple (A, B, C)
 */
export function autoAssignPhaseForMonoClient(
  client: ClientImporte,
  existingClients: ClientImporte[],
  networkVoltage: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V' = 'TÉTRAPHASÉ_400V'
): 'A' | 'B' | 'C' {
  // Calculer la puissance totale par phase et par couplage des clients déjà assignés
  const phaseLoads = { A: 0, B: 0, C: 0 };
  const couplingLoads = { 'A-B': 0, 'B-C': 0, 'A-C': 0 } as const;
  
  existingClients.forEach(c => {
    if (c.connectionType === 'MONO') {
      const totalPower = c.puissanceContractuelle_kVA + c.puissancePV_kVA;
      
      if (networkVoltage === 'TRIPHASÉ_230V' && c.phaseCoupling) {
        // 230V : répartir la puissance sur les 2 phases du couplage
        if (c.phaseCoupling === 'A-B') {
          // Mise à jour couplage
          (couplingLoads as any)['A-B'] += totalPower;
          // Charges par phase (50% / 50%)
          phaseLoads.A += totalPower / 2;
          phaseLoads.B += totalPower / 2;
        } else if (c.phaseCoupling === 'B-C') {
          (couplingLoads as any)['B-C'] += totalPower;
          phaseLoads.B += totalPower / 2;
          phaseLoads.C += totalPower / 2;
        } else if (c.phaseCoupling === 'A-C') {
          (couplingLoads as any)['A-C'] += totalPower;
          phaseLoads.A += totalPower / 2;
          phaseLoads.C += totalPower / 2;
        }
      } else if (c.assignedPhase) {
        // 400V ou absence de phaseCoupling : tout sur la phase assignée
        phaseLoads[c.assignedPhase] += totalPower;
      }
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
  
  // Déterminer le couplage selon le type de réseau
  let phaseCoupling: 'A' | 'B' | 'C' | 'A-B' | 'B-C' | 'A-C';
  
  if (networkVoltage === 'TRIPHASÉ_230V') {
    // 230V : couplage phase-à-phase, équilibré sur les 3 couplages possibles
    const couplings: Array<'A-B' | 'B-C' | 'A-C'> = ['A-B', 'B-C', 'A-C'];
    // Si aucun historique (premier client), les charges de couplage sont à 0 par défaut
    const currentCouplingLoads: Record<'A-B' | 'B-C' | 'A-C', number> = {
      'A-B': (couplingLoads as any)['A-B'] || 0,
      'B-C': (couplingLoads as any)['B-C'] || 0,
      'A-C': (couplingLoads as any)['A-C'] || 0,
    };
    const minCouplingLoad = Math.min(...Object.values(currentCouplingLoads));
    const minCouplings = couplings.filter(c => currentCouplingLoads[c] === minCouplingLoad);
    phaseCoupling = minCouplings[Math.floor(Math.random() * minCouplings.length)];
    
    console.log(`📌 Client MONO "${client.nomCircuit}" assigné au couplage ${phaseCoupling} (230V phase-phase)`);
  } else {
    // 400V : phase-neutre simple
    phaseCoupling = assignedPhase;
    console.log(`📌 Client MONO "${client.nomCircuit}" assigné à phase ${assignedPhase} (400V phase-neutre)`);
  }
  
  console.log(`   Charges avant: A=${phaseLoads.A.toFixed(1)} kVA, B=${phaseLoads.B.toFixed(1)} kVA, C=${phaseLoads.C.toFixed(1)} kVA`);
  console.log(`   Puissance client: ${clientTotalPower.toFixed(1)} kVA`);
  
  // Stocker le couplage dans le client
  client.phaseCoupling = phaseCoupling;
  
  return assignedPhase;
}

/**
 * Assigne automatiquement une phase de PRODUCTION pour un client TRI/TETRA dont la production ≤5kVA
 * doit être traitée comme MONO (option treatSmallPolyProductionsAsMono)
 * Équilibre en fonction des productions existantes (pas des charges)
 */
export function autoAssignProductionPhaseForSmallPolyClient(
  client: ClientImporte,
  existingClients: ClientImporte[],
  networkVoltage: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V' = 'TÉTRAPHASÉ_400V'
): { assignedPhase: 'A' | 'B' | 'C'; phaseCoupling: 'A' | 'B' | 'C' | 'A-B' | 'B-C' | 'A-C' } {
  // Calculer la production totale par phase/couplage des clients existants
  const phaseProductions = { A: 0, B: 0, C: 0 };
  const couplingProductions = { 'A-B': 0, 'B-C': 0, 'A-C': 0 };
  
  existingClients.forEach(c => {
    const prodKVA = c.puissancePV_kVA || 0;
    if (prodKVA === 0) return;
    
    if (c.connectionType === 'MONO') {
      // Client MONO : utiliser sa phase assignée
      if (networkVoltage === 'TRIPHASÉ_230V' && c.phaseCoupling) {
        couplingProductions[c.phaseCoupling as keyof typeof couplingProductions] += prodKVA;
        if (c.phaseCoupling === 'A-B') {
          phaseProductions.A += prodKVA / 2;
          phaseProductions.B += prodKVA / 2;
        } else if (c.phaseCoupling === 'B-C') {
          phaseProductions.B += prodKVA / 2;
          phaseProductions.C += prodKVA / 2;
        } else if (c.phaseCoupling === 'A-C') {
          phaseProductions.A += prodKVA / 2;
          phaseProductions.C += prodKVA / 2;
        }
      } else if (c.assignedPhase) {
        phaseProductions[c.assignedPhase] += prodKVA;
      }
    } else if ((c.connectionType === 'TRI' || c.connectionType === 'TETRA') && prodKVA <= 5) {
      // Client TRI/TETRA ≤5kVA avec production traitée comme MONO
      if (c.assignedProductionPhase) {
        if (networkVoltage === 'TRIPHASÉ_230V' && c.productionPhaseCoupling) {
          couplingProductions[c.productionPhaseCoupling as keyof typeof couplingProductions] += prodKVA;
          if (c.productionPhaseCoupling === 'A-B') {
            phaseProductions.A += prodKVA / 2;
            phaseProductions.B += prodKVA / 2;
          } else if (c.productionPhaseCoupling === 'B-C') {
            phaseProductions.B += prodKVA / 2;
            phaseProductions.C += prodKVA / 2;
          } else if (c.productionPhaseCoupling === 'A-C') {
            phaseProductions.A += prodKVA / 2;
            phaseProductions.C += prodKVA / 2;
          }
        } else {
          phaseProductions[c.assignedProductionPhase] += prodKVA;
        }
      }
    } else {
      // Client TRI/TETRA >5kVA : réparti 33.33%
      phaseProductions.A += prodKVA / 3;
      phaseProductions.B += prodKVA / 3;
      phaseProductions.C += prodKVA / 3;
    }
  });
  
  // Trouver la phase avec la plus faible production
  const phases: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
  const minProd = Math.min(phaseProductions.A, phaseProductions.B, phaseProductions.C);
  const minPhases = phases.filter(p => phaseProductions[p] === minProd);
  const assignedPhase = minPhases[Math.floor(Math.random() * minPhases.length)];
  
  let phaseCoupling: 'A' | 'B' | 'C' | 'A-B' | 'B-C' | 'A-C';
  
  if (networkVoltage === 'TRIPHASÉ_230V') {
    // 230V : équilibrer sur les couplages
    const couplings: Array<'A-B' | 'B-C' | 'A-C'> = ['A-B', 'B-C', 'A-C'];
    const minCouplingProd = Math.min(...Object.values(couplingProductions));
    const minCouplings = couplings.filter(c => couplingProductions[c] === minCouplingProd);
    phaseCoupling = minCouplings[Math.floor(Math.random() * minCouplings.length)];
    
    console.log(`☀️ Production TRI/TETRA ≤5kVA "${client.nomCircuit}" (${client.puissancePV_kVA}kVA) → couplage ${phaseCoupling} (230V)`);
  } else {
    // 400V : phase simple
    phaseCoupling = assignedPhase;
    console.log(`☀️ Production TRI/TETRA ≤5kVA "${client.nomCircuit}" (${client.puissancePV_kVA}kVA) → phase ${assignedPhase} (400V)`);
  }
  
  console.log(`   Productions avant: A=${phaseProductions.A.toFixed(1)} kVA, B=${phaseProductions.B.toFixed(1)} kVA, C=${phaseProductions.C.toFixed(1)} kVA`);
  
  return { assignedPhase, phaseCoupling };
}

interface NodePhaseDistributionResult {
  charges: {
    mono: { A: number; B: number; C: number };
    poly: { A: number; B: number; C: number };
    total: { A: number; B: number; C: number };
    foisonneAvecCurseurs?: { A: number; B: number; C: number }; // Valeurs foisonnées avec curseurs de déséquilibre
  };
  productions: {
    mono: { A: number; B: number; C: number };
    poly: { A: number; B: number; C: number };
    total: { A: number; B: number; C: number };
    foisonneAvecCurseurs?: { A: number; B: number; C: number }; // Valeurs foisonnées avec curseurs de déséquilibre
  };
  // NOUVEAU : Charges phase-phase pour réseau 230V triangle (pour calcul correct du courant)
  phasePhaseLoads?: {
    charges: { 'A-B': number; 'B-C': number; 'A-C': number };
    productions: { 'A-B': number; 'B-C': number; 'A-C': number };
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
  networkVoltage: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V' = 'TÉTRAPHASÉ_400V', // Système de tension du réseau
  foisonnementCharges?: number,  // Coefficient de foisonnement des charges (%)
  foisonnementProductions?: number,  // Coefficient de foisonnement des productions (%)
  treatSmallPolyProductionsAsMono: boolean = false  // Option pour traiter productions TRI/TETRA ≤5kVA comme MONO
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
    // NOUVEAU : Charges phase-phase pour calcul correct du courant en 230V triangle
    phasePhaseLoads: {
      charges: { 'A-B': 0, 'B-C': 0, 'A-C': 0 },
      productions: { 'A-B': 0, 'B-C': 0, 'A-C': 0 }
    },
    monoClientsCount: { A: 0, B: 0, C: 0 },
    polyClientsCount: 0,
    unbalancePercent: 0
  };
  
  // === 1. CLIENTS IMPORTÉS ===
  linkedClients.forEach(client => {
    if (client.connectionType === 'MONO') {
      const chargeKVA = client.puissanceContractuelle_kVA;
      const prodKVA = client.puissancePV_kVA;
      
      // ✅ Réseau 230V : utiliser le facteur √3 pour la contribution physique
      if (networkVoltage === 'TRIPHASÉ_230V' && client.phaseCoupling) {
        // Étape 1 : Calculer la contribution physique de base (sans curseurs)
        let baseChargeA = 0, baseChargeB = 0, baseChargeC = 0;
        let baseProdA = 0, baseProdB = 0, baseProdC = 0;
        
        // Répartition 50/50 sur chaque phase du couplage (pour affichage)
        // MAIS stocker la puissance TOTALE dans phasePhaseLoads (pour calcul correct du courant)
        if (client.phaseCoupling === 'A-B') {
          baseChargeA = chargeKVA * 0.5;
          baseChargeB = chargeKVA * 0.5;
          baseProdA = prodKVA * 0.5;
          baseProdB = prodKVA * 0.5;
          // ✅ NOUVEAU : Stocker la puissance TOTALE pour le couplage (pour I = S_total / U_LL)
          result.phasePhaseLoads!.charges['A-B'] += chargeKVA;
          result.phasePhaseLoads!.productions['A-B'] += prodKVA;
        } else if (client.phaseCoupling === 'B-C') {
          baseChargeB = chargeKVA * 0.5;
          baseChargeC = chargeKVA * 0.5;
          baseProdB = prodKVA * 0.5;
          baseProdC = prodKVA * 0.5;
          result.phasePhaseLoads!.charges['B-C'] += chargeKVA;
          result.phasePhaseLoads!.productions['B-C'] += prodKVA;
        } else if (client.phaseCoupling === 'A-C') {
          baseChargeA = chargeKVA * 0.5;
          baseChargeC = chargeKVA * 0.5;
          baseProdA = prodKVA * 0.5;
          baseProdC = prodKVA * 0.5;
          result.phasePhaseLoads!.charges['A-C'] += chargeKVA;
          result.phasePhaseLoads!.productions['A-C'] += prodKVA;
        }
        
        // Distribution physique SANS curseurs de déséquilibre
        result.charges.mono.A += baseChargeA;
        result.charges.mono.B += baseChargeB;
        result.charges.mono.C += baseChargeC;
        
        result.productions.mono.A += baseProdA;
        result.productions.mono.B += baseProdB;
        result.productions.mono.C += baseProdC;
        
        // Comptage pour affichage selon le couplage
        if (client.phaseCoupling === 'A-B' || client.phaseCoupling === 'A-C') {
          result.monoClientsCount.A += 0.5;
        }
        if (client.phaseCoupling === 'A-B' || client.phaseCoupling === 'B-C') {
          result.monoClientsCount.B += 0.5;
        }
        if (client.phaseCoupling === 'B-C' || client.phaseCoupling === 'A-C') {
          result.monoClientsCount.C += 0.5;
        }
      } else {
        // ✅ Réseau 400V : distribution physique sur la phase assignée SANS curseurs de déséquilibre
        if (client.assignedPhase === 'A') {
          result.charges.mono.A += chargeKVA;
          result.productions.mono.A += prodKVA;
        } else if (client.assignedPhase === 'B') {
          result.charges.mono.B += chargeKVA;
          result.productions.mono.B += prodKVA;
        } else if (client.assignedPhase === 'C') {
          result.charges.mono.C += chargeKVA;
          result.productions.mono.C += prodKVA;
        }
        
        // Comptage pour affichage sur la phase assignée
        if (client.assignedPhase) {
          result.monoClientsCount[client.assignedPhase] += 1;
        }
      }
    } else {
      // Client TRI/TÉTRA
      const totalCharge = client.puissanceContractuelle_kVA;
      const totalProd = client.puissancePV_kVA;
      
      // Charges : TOUJOURS réparties 33.33% par phase (pas affecté par l'option)
      result.charges.poly.A += totalCharge / 3;
      result.charges.poly.B += totalCharge / 3;
      result.charges.poly.C += totalCharge / 3;
      
      // Productions : dépend de l'option treatSmallPolyProductionsAsMono
      if (treatSmallPolyProductionsAsMono && totalProd > 0 && totalProd <= 5) {
        // Production ≤5 kVA : traiter comme MONO (comptée dans productions.mono)
        if (networkVoltage === 'TRIPHASÉ_230V' && client.productionPhaseCoupling) {
          // 230V : 50/50 sur le couplage
          if (client.productionPhaseCoupling === 'A-B') {
            result.productions.mono.A += totalProd * 0.5;
            result.productions.mono.B += totalProd * 0.5;
            // ✅ NOUVEAU : Stocker la puissance TOTALE pour le couplage
            result.phasePhaseLoads!.productions['A-B'] += totalProd;
          } else if (client.productionPhaseCoupling === 'B-C') {
            result.productions.mono.B += totalProd * 0.5;
            result.productions.mono.C += totalProd * 0.5;
            result.phasePhaseLoads!.productions['B-C'] += totalProd;
          } else if (client.productionPhaseCoupling === 'A-C') {
            result.productions.mono.A += totalProd * 0.5;
            result.productions.mono.C += totalProd * 0.5;
            result.phasePhaseLoads!.productions['A-C'] += totalProd;
          } else {
            // Fallback si pas de couplage assigné : répartir équitablement
            result.productions.poly.A += totalProd / 3;
            result.productions.poly.B += totalProd / 3;
            result.productions.poly.C += totalProd / 3;
          }
        } else if (client.assignedProductionPhase) {
          // 400V : 100% sur la phase assignée
          result.productions.mono[client.assignedProductionPhase] += totalProd;
        } else {
          // Fallback si pas de phase assignée : répartir équitablement
          result.productions.poly.A += totalProd / 3;
          result.productions.poly.B += totalProd / 3;
          result.productions.poly.C += totalProd / 3;
        }
      } else {
        // Production >5 kVA ou option désactivée : répartir 33.33% par phase
        result.productions.poly.A += totalProd / 3;
        result.productions.poly.B += totalProd / 3;
        result.productions.poly.C += totalProd / 3;
      }
      
      result.polyClientsCount++;
    }
  });
  
  // === 2. CHARGES/PRODUCTIONS MANUELLES DU NŒUD ===
  // ✅ Correction : traiter chaque charge/production manuelle individuellement selon sa phase assignée
  
  if (node.manualLoadType === 'MONO') {
    // Charges manuelles MONO : chaque charge a sa propre phase assignée
    node.clients.forEach(client => {
      const chargeKVA = client.S_kVA;
      
      if (networkVoltage === 'TRIPHASÉ_230V' && client.phaseCoupling) {
        // 230V : 50/50 sur le couplage assigné
        if (client.phaseCoupling === 'A-B') {
          result.charges.mono.A += chargeKVA * 0.5;
          result.charges.mono.B += chargeKVA * 0.5;
          // ✅ NOUVEAU : Stocker la puissance TOTALE pour le couplage
          result.phasePhaseLoads!.charges['A-B'] += chargeKVA;
        } else if (client.phaseCoupling === 'B-C') {
          result.charges.mono.B += chargeKVA * 0.5;
          result.charges.mono.C += chargeKVA * 0.5;
          result.phasePhaseLoads!.charges['B-C'] += chargeKVA;
        } else if (client.phaseCoupling === 'A-C') {
          result.charges.mono.A += chargeKVA * 0.5;
          result.charges.mono.C += chargeKVA * 0.5;
          result.phasePhaseLoads!.charges['A-C'] += chargeKVA;
        } else {
          // Fallback : utiliser curseurs globaux si pas de couplage assigné
          result.charges.mono.A += chargeKVA * (manualPhaseDistributionCharges.A / 100);
          result.charges.mono.B += chargeKVA * (manualPhaseDistributionCharges.B / 100);
          result.charges.mono.C += chargeKVA * (manualPhaseDistributionCharges.C / 100);
        }
      } else if (client.assignedPhase) {
        // 400V : 100% sur la phase assignée
        result.charges.mono[client.assignedPhase] += chargeKVA;
      } else {
        // Fallback : utiliser curseurs globaux si pas de phase assignée
        result.charges.mono.A += chargeKVA * (manualPhaseDistributionCharges.A / 100);
        result.charges.mono.B += chargeKVA * (manualPhaseDistributionCharges.B / 100);
        result.charges.mono.C += chargeKVA * (manualPhaseDistributionCharges.C / 100);
      }
    });
    
    // Productions manuelles MONO : chaque production a sa propre phase assignée
    node.productions.forEach(prod => {
      const prodKVA = prod.S_kVA;
      
      if (networkVoltage === 'TRIPHASÉ_230V' && prod.phaseCoupling) {
        // 230V : 50/50 sur le couplage assigné
        if (prod.phaseCoupling === 'A-B') {
          result.productions.mono.A += prodKVA * 0.5;
          result.productions.mono.B += prodKVA * 0.5;
          // ✅ NOUVEAU : Stocker la puissance TOTALE pour le couplage
          result.phasePhaseLoads!.productions['A-B'] += prodKVA;
        } else if (prod.phaseCoupling === 'B-C') {
          result.productions.mono.B += prodKVA * 0.5;
          result.productions.mono.C += prodKVA * 0.5;
          result.phasePhaseLoads!.productions['B-C'] += prodKVA;
        } else if (prod.phaseCoupling === 'A-C') {
          result.productions.mono.A += prodKVA * 0.5;
          result.productions.mono.C += prodKVA * 0.5;
          result.phasePhaseLoads!.productions['A-C'] += prodKVA;
        } else {
          // Fallback : utiliser curseurs globaux
          result.productions.mono.A += prodKVA * (manualPhaseDistributionProductions.A / 100);
          result.productions.mono.B += prodKVA * (manualPhaseDistributionProductions.B / 100);
          result.productions.mono.C += prodKVA * (manualPhaseDistributionProductions.C / 100);
        }
      } else if (prod.assignedPhase) {
        // 400V : 100% sur la phase assignée
        result.productions.mono[prod.assignedPhase] += prodKVA;
      } else {
        // Fallback : utiliser curseurs globaux
        result.productions.mono.A += prodKVA * (manualPhaseDistributionProductions.A / 100);
        result.productions.mono.B += prodKVA * (manualPhaseDistributionProductions.B / 100);
        result.productions.mono.C += prodKVA * (manualPhaseDistributionProductions.C / 100);
      }
    });
  } else {
    // Charges manuelles POLY : répartir équitablement (33.33%)
    const manualChargeTotal = node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
    const manualProdTotal = node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
    
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
  console.log(`🔍 Distribution nœud "${node.name}" (Option B: curseurs appliqués à TOUS les clients)`);
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
  
  // === 5. CALCUL DES VALEURS FOISONNÉES AVEC CURSEURS DE DÉSÉQUILIBRE ===
  // Si les coefficients de foisonnement sont fournis, calculer les valeurs foisonnées avec curseurs
  if (foisonnementCharges !== undefined && foisonnementProductions !== undefined) {
    // 1. Appliquer le foisonnement sur les valeurs physiques totales
    const totalFoisonneChargeA = result.charges.total.A * (foisonnementCharges / 100);
    const totalFoisonneChargeB = result.charges.total.B * (foisonnementCharges / 100);
    const totalFoisonneChargeC = result.charges.total.C * (foisonnementCharges / 100);
    
    const totalFoisonneProdA = result.productions.total.A * (foisonnementProductions / 100);
    const totalFoisonneProdB = result.productions.total.B * (foisonnementProductions / 100);
    const totalFoisonneProdC = result.productions.total.C * (foisonnementProductions / 100);
    
    // 2. Calculer le total global foisonné
    const totalFoisonneChargeGlobal = totalFoisonneChargeA + totalFoisonneChargeB + totalFoisonneChargeC;
    const totalFoisonneProdGlobal = totalFoisonneProdA + totalFoisonneProdB + totalFoisonneProdC;
    
    // 3. Redistribuer selon les curseurs de déséquilibre
    result.charges.foisonneAvecCurseurs = {
      A: totalFoisonneChargeGlobal * (manualPhaseDistributionCharges.A / 100),
      B: totalFoisonneChargeGlobal * (manualPhaseDistributionCharges.B / 100),
      C: totalFoisonneChargeGlobal * (manualPhaseDistributionCharges.C / 100)
    };
    
    result.productions.foisonneAvecCurseurs = {
      A: totalFoisonneProdGlobal * (manualPhaseDistributionProductions.A / 100),
      B: totalFoisonneProdGlobal * (manualPhaseDistributionProductions.B / 100),
      C: totalFoisonneProdGlobal * (manualPhaseDistributionProductions.C / 100)
    };
    
    console.log(`🔍 Nœud "${node.name}": Valeurs foisonnées avec curseurs calculées`);
    console.log(`   Charges foisonnées avec curseurs: A=${result.charges.foisonneAvecCurseurs.A.toFixed(1)}kVA, B=${result.charges.foisonneAvecCurseurs.B.toFixed(1)}kVA, C=${result.charges.foisonneAvecCurseurs.C.toFixed(1)}kVA`);
    console.log(`   Productions foisonnées avec curseurs: A=${result.productions.foisonneAvecCurseurs.A.toFixed(1)}kVA, B=${result.productions.foisonneAvecCurseurs.B.toFixed(1)}kVA, C=${result.productions.foisonneAvecCurseurs.C.toFixed(1)}kVA`);
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
      if (client.connectionType === 'MONO') {
        const chargeKVA = client.puissanceContractuelle_kVA;
        
        // EN 230V : utiliser le phaseCoupling pour la distribution réelle
        if (client.phaseCoupling) {
          if (client.phaseCoupling === 'A-B') {
            totalMonoPerPhase.A += chargeKVA / 2;
            totalMonoPerPhase.B += chargeKVA / 2;
          } else if (client.phaseCoupling === 'B-C') {
            totalMonoPerPhase.B += chargeKVA / 2;
            totalMonoPerPhase.C += chargeKVA / 2;
          } else if (client.phaseCoupling === 'A-C') {
            totalMonoPerPhase.A += chargeKVA / 2;
            totalMonoPerPhase.C += chargeKVA / 2;
          }
        } 
        // EN 400V : COMPORTEMENT ACTUEL CONSERVÉ (assignedPhase)
        else if (client.assignedPhase) {
          totalMonoPerPhase[client.assignedPhase] += chargeKVA;
        }
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
      if (client.connectionType === 'MONO' && client.puissancePV_kVA) {
        const prodKVA = client.puissancePV_kVA;
        
        // EN 230V : utiliser le phaseCoupling pour la distribution réelle
        if (client.phaseCoupling) {
          if (client.phaseCoupling === 'A-B') {
            totalMonoPerPhase.A += prodKVA / 2;
            totalMonoPerPhase.B += prodKVA / 2;
          } else if (client.phaseCoupling === 'B-C') {
            totalMonoPerPhase.B += prodKVA / 2;
            totalMonoPerPhase.C += prodKVA / 2;
          } else if (client.phaseCoupling === 'A-C') {
            totalMonoPerPhase.A += prodKVA / 2;
            totalMonoPerPhase.C += prodKVA / 2;
          }
        } 
        // EN 400V : COMPORTEMENT ACTUEL CONSERVÉ (assignedPhase)
        else if (client.assignedPhase) {
          totalMonoPerPhase[client.assignedPhase] += prodKVA;
        }
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

/**
 * Calcule la répartition réelle par couplage pour les réseaux 230V (charges)
 * Basé sur les clients mono réellement connectés sur chaque couplage phase-phase
 */
export function calculateRealCouplingDistributionPercents(
  nodes: Node[],
  clientsImportes: ClientImporte[],
  clientLinks: { clientId: string; nodeId: string }[]
): { 'A-B': number; 'B-C': number; 'A-C': number } {
  let totalAB = 0, totalBC = 0, totalAC = 0;
  
  // Filtrer les clients liés
  const linkedClientIds = new Set(clientLinks.map(link => link.clientId));
  const linkedClients = clientsImportes.filter(c => linkedClientIds.has(c.id));
  
  linkedClients.forEach(client => {
    if (client.connectionType === 'MONO' && client.phaseCoupling) {
      const kva = client.puissanceContractuelle_kVA;
      if (client.phaseCoupling === 'A-B') totalAB += kva;
      else if (client.phaseCoupling === 'B-C') totalBC += kva;
      else if (client.phaseCoupling === 'A-C') totalAC += kva;
    }
  });
  
  const total = totalAB + totalBC + totalAC;
  if (total === 0) return { 'A-B': 33.33, 'B-C': 33.33, 'A-C': 33.34 };
  
  return {
    'A-B': (totalAB / total) * 100,
    'B-C': (totalBC / total) * 100,
    'A-C': (totalAC / total) * 100
  };
}

/**
 * Calcule la répartition réelle par couplage pour les réseaux 230V (productions)
 * Basé sur les clients mono réellement connectés sur chaque couplage phase-phase
 */
export function calculateRealCouplingProductionDistributionPercents(
  nodes: Node[],
  clientsImportes: ClientImporte[],
  clientLinks: { clientId: string; nodeId: string }[]
): { 'A-B': number; 'B-C': number; 'A-C': number } {
  let totalAB = 0, totalBC = 0, totalAC = 0;
  
  const linkedClientIds = new Set(clientLinks.map(link => link.clientId));
  const linkedClients = clientsImportes.filter(c => linkedClientIds.has(c.id));
  
  linkedClients.forEach(client => {
    if (client.connectionType === 'MONO' && client.phaseCoupling) {
      const kva = client.puissancePV_kVA || 0;
      if (client.phaseCoupling === 'A-B') totalAB += kva;
      else if (client.phaseCoupling === 'B-C') totalBC += kva;
      else if (client.phaseCoupling === 'A-C') totalAC += kva;
    }
  });
  
  const total = totalAB + totalBC + totalAC;
  if (total === 0) return { 'A-B': 33.33, 'B-C': 33.33, 'A-C': 33.34 };
  
  return {
    'A-B': (totalAB / total) * 100,
    'B-C': (totalBC / total) * 100,
    'A-C': (totalAC / total) * 100
  };
}
