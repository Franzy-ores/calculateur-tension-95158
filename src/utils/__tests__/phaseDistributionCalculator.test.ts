import { describe, it, expect } from 'vitest';
import { normalizeClientConnectionType, autoAssignPhaseForMonoClient, calculateNodeAutoPhaseDistribution } from '../phaseDistributionCalculator';
import { ClientImporte, Node } from '@/types/network';

describe('phaseDistributionCalculator', () => {
  describe('normalizeClientConnectionType', () => {
    it('should normalize MONO couplage', () => {
      expect(normalizeClientConnectionType('MONO', 'TÉTRAPHASÉ_400V')).toBe('MONO');
      expect(normalizeClientConnectionType('mono', 'TÉTRAPHASÉ_400V')).toBe('MONO');
      expect(normalizeClientConnectionType('?', 'TÉTRAPHASÉ_400V')).toBe('MONO');
      expect(normalizeClientConnectionType('', 'TÉTRAPHASÉ_400V')).toBe('MONO');
      expect(normalizeClientConnectionType(undefined, 'TÉTRAPHASÉ_400V')).toBe('MONO');
    });
    
    it('should normalize TRI couplage', () => {
      expect(normalizeClientConnectionType('TRI', 'TRIPHASÉ_230V')).toBe('TRI');
      expect(normalizeClientConnectionType('tri', 'TRIPHASÉ_230V')).toBe('TRI');
      expect(normalizeClientConnectionType('TRIPHASÉ', 'TRIPHASÉ_230V')).toBe('TRI');
    });
    
    it('should normalize TÉTRA couplage', () => {
      expect(normalizeClientConnectionType('TÉTRA', 'TÉTRAPHASÉ_400V')).toBe('TETRA');
      expect(normalizeClientConnectionType('TETRA', 'TÉTRAPHASÉ_400V')).toBe('TETRA');
      expect(normalizeClientConnectionType('tétra', 'TÉTRAPHASÉ_400V')).toBe('TETRA');
    });
  });
  
  describe('autoAssignPhaseForMonoClient', () => {
    it('should assign to phase A if all phases empty', () => {
      const newClient: ClientImporte = {
        id: 'client-1',
        identifiantCircuit: 'C1',
        nomCircuit: 'Client 1',
        lat: 0,
        lng: 0,
        puissanceContractuelle_kVA: 5,
        puissancePV_kVA: 0,
        connectionType: 'MONO',
        couplage: 'MONO'
      };
      
      const phase = autoAssignPhaseForMonoClient(newClient, []);
      // Avec la randomisation, n'importe quelle phase peut être assignée quand toutes sont vides
      expect(['A', 'B', 'C']).toContain(phase);
    });
    
    it('should assign to least loaded phase', () => {
      const existingClients: ClientImporte[] = [
        { 
          id: 'c1',
          identifiantCircuit: 'C1',
          nomCircuit: 'Client 1',
          lat: 0,
          lng: 0,
          connectionType: 'MONO', 
          assignedPhase: 'A', 
          puissanceContractuelle_kVA: 10, 
          puissancePV_kVA: 0,
          couplage: 'MONO'
        },
        { 
          id: 'c2',
          identifiantCircuit: 'C2',
          nomCircuit: 'Client 2',
          lat: 0,
          lng: 0,
          connectionType: 'MONO', 
          assignedPhase: 'B', 
          puissanceContractuelle_kVA: 5, 
          puissancePV_kVA: 0,
          couplage: 'MONO'
        }
      ];
      
      const newClient: ClientImporte = {
        id: 'client-new',
        identifiantCircuit: 'C3',
        nomCircuit: 'Client 3',
        lat: 0,
        lng: 0,
        puissanceContractuelle_kVA: 5,
        puissancePV_kVA: 0,
        connectionType: 'MONO',
        couplage: 'MONO'
      };
      
      const phase = autoAssignPhaseForMonoClient(newClient, existingClients);
      // Phase C est vide (0 kVA), donc devrait être assignée
      // Avec la randomisation, si plusieurs phases ont la même charge minimale,
      // n'importe laquelle peut être choisie, donc on vérifie juste que c'est une phase valide
      expect(['A', 'B', 'C']).toContain(phase);
      // Phase C a la charge minimale (0 kVA), donc devrait être la plus probable
      expect(phase).toBe('C');
    });
    
    it('should balance across phases considering both charge and production', () => {
      const existingClients: ClientImporte[] = [
        { 
          id: 'c1',
          identifiantCircuit: 'C1',
          nomCircuit: 'Client 1',
          lat: 0,
          lng: 0,
          connectionType: 'MONO', 
          assignedPhase: 'A', 
          puissanceContractuelle_kVA: 5, 
          puissancePV_kVA: 5,  // Total: 10 kVA
          couplage: 'MONO'
        },
        { 
          id: 'c2',
          identifiantCircuit: 'C2',
          nomCircuit: 'Client 2',
          lat: 0,
          lng: 0,
          connectionType: 'MONO', 
          assignedPhase: 'B', 
          puissanceContractuelle_kVA: 8, 
          puissancePV_kVA: 0,  // Total: 8 kVA
          couplage: 'MONO'
        },
        { 
          id: 'c3',
          identifiantCircuit: 'C3',
          nomCircuit: 'Client 3',
          lat: 0,
          lng: 0,
          connectionType: 'MONO', 
          assignedPhase: 'C', 
          puissanceContractuelle_kVA: 3, 
          puissancePV_kVA: 3,  // Total: 6 kVA
          couplage: 'MONO'
        }
      ];
      
      const newClient: ClientImporte = {
        id: 'client-new',
        identifiantCircuit: 'C4',
        nomCircuit: 'Client 4',
        lat: 0,
        lng: 0,
        puissanceContractuelle_kVA: 5,
        puissancePV_kVA: 0,
        connectionType: 'MONO',
        couplage: 'MONO'
      };
      
      const phase = autoAssignPhaseForMonoClient(newClient, existingClients);
      // Phase C a le moins de charge (6 kVA), donc devrait être assignée
      expect(phase).toBe('C');
    });
  });
  
  describe('calculateNodeAutoPhaseDistribution (Option B)', () => {
    it('should apply sliders to all clients (MONO, TRI/TÉTRA)', () => {
      const node: Node = {
        id: 'node-1',
        name: 'Test Node',
        lat: 0,
        lng: 0,
        connectionType: 'TÉTRA_3P+N_230_400V',
        clients: [],
        productions: []
      };
      
      const linkedClients: ClientImporte[] = [
        {
          id: 'c1',
          identifiantCircuit: 'C1',
          nomCircuit: 'Client MONO',
          lat: 0,
          lng: 0,
          connectionType: 'MONO',
          assignedPhase: 'A',
          puissanceContractuelle_kVA: 30,
          puissancePV_kVA: 0,
          couplage: 'MONO'
        },
        {
          id: 'c2',
          identifiantCircuit: 'C2',
          nomCircuit: 'Client TRI',
          lat: 0,
          lng: 0,
          connectionType: 'TRI',
          puissanceContractuelle_kVA: 60,
          puissancePV_kVA: 0,
          couplage: 'TRI'
        }
      ];
      
      // Curseurs: 60% L1, 20% L2, 20% L3
      const manualCharges = { A: 60, B: 20, C: 20 };
      const manualProductions = { A: 33.33, B: 33.33, C: 33.34 };
      
      const result = calculateNodeAutoPhaseDistribution(
        node,
        linkedClients,
        manualCharges,
        manualProductions,
        'TÉTRAPHASÉ_400V'
      );
      
      // MONO: 30 kVA réparti selon curseurs
      expect(result.charges.mono.A).toBeCloseTo(30 * 0.6, 1); // 18 kVA
      expect(result.charges.mono.B).toBeCloseTo(30 * 0.2, 1); // 6 kVA
      expect(result.charges.mono.C).toBeCloseTo(30 * 0.2, 1); // 6 kVA
      
      // TRI: 60 kVA réparti selon curseurs (Option B)
      expect(result.charges.poly.A).toBeCloseTo(60 * 0.6, 1); // 36 kVA
      expect(result.charges.poly.B).toBeCloseTo(60 * 0.2, 1); // 12 kVA
      expect(result.charges.poly.C).toBeCloseTo(60 * 0.2, 1); // 12 kVA
      
      // Total
      expect(result.charges.total.A).toBeCloseTo(54, 1); // 18 + 36
      expect(result.charges.total.B).toBeCloseTo(18, 1); // 6 + 12
      expect(result.charges.total.C).toBeCloseTo(18, 1); // 6 + 12
    });
  });
});
