import * as XLSX from 'xlsx';
import { ClientImporte, Node, ClientLink } from '@/types/network';

/**
 * Parse un fichier Excel et retourne un tableau de clients importés
 */
export const parseExcelToClients = (file: File): Promise<ClientImporte[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        
        const clients: ClientImporte[] = jsonData.map((row: any, index: number) => {
          // Parser le couplage
          const couplageStr = String(row['Couplage'] || '').toUpperCase();
          const couplage = couplageStr.startsWith('TRI') ? 'TRI' : 'MONO';
          
          return {
            id: `client-import-${Date.now()}-${index}`,
            identifiantCircuit: String(row['Identifiant circuit'] || ''),
            nomCircuit: String(row['Nom (Circuit)'] || ''),
            lat: parseFloat(row['E_CLIENT.N_WGS84_Y']) || 0,
            lng: parseFloat(row['E_CLIENT.N_WGS84_X']) || 0,
            puissanceContractuelle_kVA: parseFloat(row['Puissance contractuelle']) || 0,
            puissancePV_kVA: parseFloat(row['Puissance PV en kVA']) || 0,
            couplage,
          tensionMin_V: parseFloat(row['Min Tension']) || undefined,
          tensionMax_V: parseFloat(row['Max Tension']) || undefined,
          tensionMinHiver_V: parseFloat(row['Min Tension hiver']) || undefined,
          tensionMaxEte_V: parseFloat(row['Max Tension été']) || undefined,
          ecartTension15jours_V: parseFloat(row['Ecart de tension sur les 15 derniers jours']) || undefined,
          tensionCircuit_V: parseFloat(row['Tension (Circuit)']) || undefined,
          identifiantCabine: String(row['Identifiant cabine'] || ''),
          identifiantPosteSource: String(row['Identifiant poste source'] || ''),
            rawData: row
          };
        });
        
        resolve(clients);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Calcule les puissances totales d'un nœud (clients liés + charges manuelles)
 */
export const calculateNodePowersFromClients = (
  node: Node,
  linkedClients: ClientImporte[]
): { totalCharge_kVA: number; totalProduction_kVA: number } => {
  // Puissances des clients liés
  const clientCharges = linkedClients.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0);
  const clientProductions = linkedClients.reduce((sum, c) => sum + c.puissancePV_kVA, 0);
  
  // Puissances manuelles du nœud
  const manualCharges = node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
  const manualProductions = node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
  
  return {
    totalCharge_kVA: clientCharges + manualCharges,
    totalProduction_kVA: clientProductions + manualProductions
  };
};

/**
 * Récupère les clients liés à un nœud spécifique
 */
export const getLinkedClientsForNode = (
  nodeId: string,
  clientsImportes: ClientImporte[],
  clientLinks: ClientLink[]
): ClientImporte[] => {
  const linkedClientIds = clientLinks
    .filter(link => link.nodeId === nodeId)
    .map(link => link.clientId);
  
  return clientsImportes.filter(client => linkedClientIds.includes(client.id));
};

/**
 * Valide les données d'un client importé
 */
export const validateClient = (client: ClientImporte): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!client.lat || !client.lng) {
    errors.push('Coordonnées GPS manquantes ou invalides');
  }
  
  if (client.lat < -90 || client.lat > 90) {
    errors.push('Latitude invalide (doit être entre -90 et 90)');
  }
  
  if (client.lng < -180 || client.lng > 180) {
    errors.push('Longitude invalide (doit être entre -180 et 180)');
  }
  
  if (client.puissanceContractuelle_kVA < 0) {
    errors.push('Puissance contractuelle ne peut pas être négative');
  }
  
  if (client.puissancePV_kVA < 0) {
    errors.push('Puissance PV ne peut pas être négative');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Calcule les puissances totales pour un ensemble de nœuds (manuel + clients importés)
 */
export const calculateTotalPowersForNodes = (
  nodes: Node[],
  clientsImportes: ClientImporte[],
  clientLinks: ClientLink[]
): {
  totalChargesContractuelles: number;
  totalProductionsContractuelles: number;
} => {
  let totalCharges = 0;
  let totalProds = 0;

  nodes.forEach(node => {
    // Charges/productions manuelles
    totalCharges += node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
    totalProds += node.productions.reduce((sum, p) => sum + p.S_kVA, 0);

    // Charges/productions importées liées à ce nœud
    const linkedClients = getLinkedClientsForNode(node.id, clientsImportes, clientLinks);
    totalCharges += linkedClients.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0);
    totalProds += linkedClients.reduce((sum, c) => sum + c.puissancePV_kVA, 0);
  });

  return {
    totalChargesContractuelles: totalCharges,
    totalProductionsContractuelles: totalProds
  };
};


/**
 * Détermine la couleur d'un marqueur client selon le mode sélectionné
 */
export const getClientMarkerColor = (
  client: ClientImporte, 
  mode: 'couplage' | 'circuit' | 'tension',
  circuitColorMapping?: Map<string, string>
): string => {
  switch (mode) {
    case 'couplage':
      return client.couplage === 'TRI' ? '#3b82f6' : '#f97316';
    
    case 'circuit':
      // Utiliser le mapping si disponible, sinon couleur par défaut
      if (circuitColorMapping && circuitColorMapping.has(client.identifiantCircuit)) {
        return circuitColorMapping.get(client.identifiantCircuit)!;
      }
      return '#6b7280'; // Gris par défaut si pas de mapping
    
    case 'tension':
      if (!client.tensionMin_V && !client.tensionMax_V) return '#6b7280';
      const avgTension = ((client.tensionMin_V || 0) + (client.tensionMax_V || 0)) / 2;
      return avgTension < 300 ? '#22c55e' : '#3b82f6';
    
    default:
      return '#3b82f6';
  }
};
