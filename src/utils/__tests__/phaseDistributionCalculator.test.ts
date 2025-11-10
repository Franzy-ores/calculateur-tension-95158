import { describe, it, expect } from 'vitest';
import { normalizeClientConnectionType, autoAssignPhaseForMonoClient } from '../phaseDistributionCalculator';
import { ClientImporte } from '@/types/network';

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
      expect(phase).toBe('A');
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
});
