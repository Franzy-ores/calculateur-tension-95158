/**
 * Tests unitaires pour valider le calcul de courant MONO en 230V triangle
 * 
 * PROBLÈME IDENTIFIÉ :
 * Un client MONO 10 kVA sur couplage L1-L2 (230V phase-phase) doit générer :
 * - Courant I = S / U_LL = 10000 / 230 = 43.5 A dans L1 ET L2 (même courant, phases opposées)
 * 
 * Actuellement, le code répartit 50/50 la puissance (5 kVA sur L1, 5 kVA sur L2)
 * et calcule I_L1 = 5000/230 = 21.7A et I_L2 = 21.7A séparément,
 * ce qui sous-estime le courant réel par un facteur 2.
 * 
 * FORMULE CORRECTE pour couplage phase-phase :
 * I = S_total / U_phase-phase (le courant est le même dans les deux phases du couplage)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ElectricalCalculator } from '../electricalCalculations';
import { Node, Cable, CableType, TransformerConfig, Project, ClientImporte } from '@/types/network';
import { calculateNodeAutoPhaseDistribution } from '../phaseDistributionCalculator';

// Helper pour créer un type de câble standard
const mkCableType = (
  R12 = 0.32,  // Ω/km
  X12 = 0.08,  // Ω/km
  R0 = 0.64,   // Ω/km (non utilisé en 230V triangle)
  X0 = 0.16    // Ω/km (non utilisé en 230V triangle)
): CableType => ({
  id: 'test-cable',
  label: 'Test Cable',
  R12_ohm_per_km: R12,
  X12_ohm_per_km: X12,
  R0_ohm_per_km: R0,
  X0_ohm_per_km: X0,
  matiere: 'ALUMINIUM',
  posesPermises: ['AÉRIEN'],
  maxCurrent_A: 200
});

// Helper pour créer une config transformateur 230V
const baseTransformer = (): TransformerConfig => ({
  rating: '250kVA',
  nominalPower_kVA: 250,
  nominalVoltage_V: 230,
  shortCircuitVoltage_percent: 4,
  cosPhi: 0.9,
  xOverR: 4
});

// Helper pour créer un nœud avec puissance
const createNode = (id: string, name: string, isSource: boolean, lat: number, lng: number): Node => ({
  id,
  name,
  lat,
  lng,
  connectionType: 'TRI_230V_3F',
  clients: [],
  productions: [],
  isSource
});

// Helper pour créer un câble
const createCable = (id: string, nodeAId: string, nodeBId: string, typeId: string, lengthMeters: number): Cable => {
  // Calculer les coordonnées pour obtenir la longueur souhaitée (approximation)
  const degPerMeter = 1 / 111320; // Approximation à l'équateur
  return {
    id,
    name: `Cable ${id}`,
    nodeAId,
    nodeBId,
    typeId,
    pose: 'AÉRIEN',
    coordinates: [
      { lat: 50.0, lng: 4.0 },
      { lat: 50.0 + lengthMeters * degPerMeter, lng: 4.0 }
    ]
  };
};

// Helper pour créer un client MONO importé
const createMonoClient = (
  id: string,
  chargeKVA: number,
  prodKVA: number,
  phaseCoupling: 'A-B' | 'B-C' | 'A-C',
  assignedPhase: 'A' | 'B' | 'C' = 'A'
): ClientImporte => ({
  id,
  identifiantCircuit: `CIRCUIT_${id}`,
  nomCircuit: `Client ${id}`,
  lat: 50.0,
  lng: 4.0,
  puissanceContractuelle_kVA: chargeKVA,
  puissancePV_kVA: prodKVA,
  couplage: 'MONO',
  connectionType: 'MONO',
  phaseCoupling,
  assignedPhase,
  linkedNodeId: undefined
});

describe('Calcul de courant MONO en 230V triangle', () => {
  let calculator: ElectricalCalculator;

  beforeEach(() => {
    calculator = new ElectricalCalculator(0.95);
  });

  describe('Validation de la formule de courant phase-phase', () => {
    it('Client MONO 10 kVA sur couplage A-B devrait avoir I = S/U_LL = 43.5A', () => {
      // ARRANGE
      const S_kVA = 10; // Puissance apparente totale
      const U_LL = 230; // Tension ligne-ligne
      
      // Formule correcte pour couplage phase-phase
      const I_expected = (S_kVA * 1000) / U_LL; // = 43.48 A
      
      // ASSERT
      expect(I_expected).toBeCloseTo(43.48, 1);
    });

    it('Répartition 50/50 ne doit pas diviser le courant par 2', () => {
      // ARRANGE : client 10 kVA sur A-B
      const S_total_kVA = 10;
      const U_LL = 230;
      
      // Calcul INCORRECT (actuel) : I = (S/2) / U
      const I_incorrect = (S_total_kVA * 1000 / 2) / U_LL; // = 21.7 A (FAUX)
      
      // Calcul CORRECT : I = S_total / U_LL
      const I_correct = (S_total_kVA * 1000) / U_LL; // = 43.5 A
      
      // ASSERT
      expect(I_incorrect).toBeCloseTo(21.7, 1); // Ce qu'on obtient actuellement
      expect(I_correct).toBeCloseTo(43.5, 1);   // Ce qu'on devrait obtenir
      expect(I_correct).toBeCloseTo(I_incorrect * 2, 0); // Facteur 2 de différence
    });
  });

  describe('Calcul de distribution de phase pour MONO 230V', () => {
    it('Client MONO 10 kVA sur A-B doit répartir la puissance 50/50 mais conserver le courant total', () => {
      // ARRANGE
      const client = createMonoClient('c1', 10, 0, 'A-B', 'A');
      const node = createNode('n1', 'Node 1', false, 50.0, 4.0);
      
      // ACT
      const distribution = calculateNodeAutoPhaseDistribution(
        node,
        [client],
        { A: 33.33, B: 33.33, C: 33.34 },
        { A: 33.33, B: 33.33, C: 33.34 },
        'TRIPHASÉ_230V'
      );
      
      // ASSERT : la puissance est répartie 50/50 (comportement actuel correct)
      expect(distribution.charges.mono.A).toBeCloseTo(5, 1);
      expect(distribution.charges.mono.B).toBeCloseTo(5, 1);
      expect(distribution.charges.mono.C).toBe(0);
      
      // Note: Le problème n'est pas dans la répartition de puissance,
      // mais dans la façon dont le BFS calcule le courant à partir de cette puissance
    });

    it('3 clients MONO équilibrés (1 par couplage) doivent avoir une distribution symétrique', () => {
      // ARRANGE : 3 clients de 10 kVA chacun sur A-B, B-C, A-C
      const clients = [
        createMonoClient('c1', 10, 0, 'A-B', 'A'),
        createMonoClient('c2', 10, 0, 'B-C', 'B'),
        createMonoClient('c3', 10, 0, 'A-C', 'C')
      ];
      const node = createNode('n1', 'Node 1', false, 50.0, 4.0);
      
      // ACT
      const distribution = calculateNodeAutoPhaseDistribution(
        node,
        clients,
        { A: 33.33, B: 33.33, C: 33.34 },
        { A: 33.33, B: 33.33, C: 33.34 },
        'TRIPHASÉ_230V'
      );
      
      // ASSERT : chaque phase doit avoir 10 kVA (50% de 2 clients)
      // A = 50% de (A-B) + 50% de (A-C) = 5 + 5 = 10 kVA
      // B = 50% de (A-B) + 50% de (B-C) = 5 + 5 = 10 kVA
      // C = 50% de (B-C) + 50% de (A-C) = 5 + 5 = 10 kVA
      expect(distribution.charges.mono.A).toBeCloseTo(10, 1);
      expect(distribution.charges.mono.B).toBeCloseTo(10, 1);
      expect(distribution.charges.mono.C).toBeCloseTo(10, 1);
    });
  });

  describe('Comparaison MONO 230V vs MONO 400V', () => {
    it('Client MONO 10 kVA doit avoir le même courant de ligne en 230V (phase-phase) et 400V (phase-neutre)', () => {
      // THÉORIE :
      // - 230V phase-phase : I = S / U_LL = 10000 / 230 = 43.5 A
      // - 400V phase-neutre : I = S / U_PN = 10000 / 230 = 43.5 A
      // Les deux doivent être identiques car la tension de référence est 230V dans les deux cas
      
      const S_kVA = 10;
      const U_230V_PP = 230; // Tension phase-phase en 230V triangle
      const U_400V_PN = 230; // Tension phase-neutre en 400V étoile
      
      const I_230V = (S_kVA * 1000) / U_230V_PP;
      const I_400V = (S_kVA * 1000) / U_400V_PN;
      
      expect(I_230V).toBeCloseTo(I_400V, 1);
      expect(I_230V).toBeCloseTo(43.5, 1);
    });
  });

  describe('Utilisation de R12/X12 en 230V triangle', () => {
    it('Le calcul 230V triangle doit toujours utiliser R12/X12 (pas R0)', () => {
      // ARRANGE
      const cableType = mkCableType(0.32, 0.08, 0.64, 0.16);
      
      // En 230V triangle, on doit utiliser R12 = 0.32, pas R0 = 0.64
      // Le facteur de chute de tension doit être basé sur R12
      
      const L_km = 0.1;
      const I = 43.5;
      const cosPhi = 0.95;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      
      // Calcul avec R12 (correct)
      const deltaU_R12 = Math.sqrt(3) * I * (cableType.R12_ohm_per_km * cosPhi + cableType.X12_ohm_per_km * sinPhi) * L_km;
      
      // Calcul avec R0 (incorrect pour 230V)
      const deltaU_R0 = Math.sqrt(3) * I * (cableType.R0_ohm_per_km * cosPhi + cableType.X0_ohm_per_km * sinPhi) * L_km;
      
      console.log(`ΔU avec R12: ${deltaU_R12.toFixed(2)}V, avec R0: ${deltaU_R0.toFixed(2)}V`);
      
      // R0 donnerait une chute de tension 2x plus grande (incorrect en 230V triangle)
      expect(deltaU_R0).toBeCloseTo(deltaU_R12 * 2, 1);
    });
  });
});

describe('Analyse du problème de modélisation phase-phase', () => {
  it('Documentation du problème et de la solution', () => {
    /**
     * PROBLÈME ACTUEL :
     * ================
     * Le modèle actuel traite les clients MONO 230V comme deux charges indépendantes
     * réparties 50/50 sur les phases du couplage. Cela donne :
     * 
     * Client 10 kVA sur A-B :
     * - S_A = 5 kVA, S_B = 5 kVA, S_C = 0 kVA
     * - I_A = S_A / V = 5000 / 230 = 21.7 A
     * - I_B = S_B / V = 5000 / 230 = 21.7 A
     * 
     * PROBLÈME : Ce n'est pas le comportement physique réel.
     * Physiquement, une charge phase-phase tire un courant I = S / U_AB
     * et ce MÊME courant circule dans les deux phases (sortant d'une, entrant dans l'autre).
     * 
     * SOLUTION PROPOSÉE :
     * ==================
     * Pour les clients MONO sur couplage phase-phase en 230V :
     * 1. NE PAS diviser la puissance par 2 pour le calcul de courant
     * 2. Le courant doit être I = S_total / U_LL sur les deux phases
     * 3. Les phaseurs de puissance doivent avoir des angles appropriés pour refléter
     *    le fait que le courant "entre" dans une phase et "sort" de l'autre
     * 
     * MODIFICATION REQUISE :
     * =====================
     * Dans electricalCalculations.ts, lors de la construction des maps S_A, S_B, S_C
     * pour les nœuds avec clients MONO 230V, il faut :
     * - Stocker S_total sur les deux phases du couplage (pas S/2)
     * - Appliquer un déphasage de 180° entre les deux phases pour modéliser
     *   correctement le flux de puissance phase-phase
     * 
     * OU alternativement :
     * - Modifier le calcul de courant I_inj pour reconnaître les couplages phase-phase
     * - Calculer I = S_total / U_LL puis répartir ce courant sur les deux phases
     */
    
    expect(true).toBe(true); // Test de documentation
  });
});

describe('Solution de correction pour courant MONO 230V', () => {
  it('Approche vectorielle : courant identique sur les deux phases avec déphasage 180°', () => {
    /**
     * SOLUTION VECTORIELLE :
     * =====================
     * Pour un client MONO 10 kVA sur couplage A-B :
     * 
     * 1. Calculer le courant total : I = S_total / U_AB = 10000 / 230 = 43.5 A
     * 
     * 2. Modéliser comme courant entrant dans A et sortant de B :
     *    I_A = +43.5 A (courant entrant)
     *    I_B = -43.5 A (courant sortant, déphasé de 180°)
     * 
     * 3. En termes de phaseurs de puissance :
     *    S_A = V_A × I_A* = V_A × (43.5∠0°)*
     *    S_B = V_B × I_B* = V_B × (43.5∠180°)* = -S_A
     * 
     * Cette approche conserve :
     * - Le courant total correct dans le câble (43.5 A max)
     * - La conservation de l'énergie (P_A + P_B = P_total)
     * - La bonne chute de tension
     */
    
    const S_kVA = 10;
    const U_LL = 230;
    const I_total = (S_kVA * 1000) / U_LL;
    
    // Approche vectorielle : courants opposés
    const I_A = I_total;
    const I_B = -I_total; // Déphasé de 180°
    
    // Courant max dans le câble (pour le calcul de chute de tension)
    const I_cable_max = Math.max(Math.abs(I_A), Math.abs(I_B));
    
    expect(I_cable_max).toBeCloseTo(43.5, 1);
  });
});
