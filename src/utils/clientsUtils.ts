import * as XLSX from 'xlsx';
import { ClientImporte, Node, ClientLink } from '@/types/network';
import { geocodeAddress, delay } from './geocodingService';

export type ClientPowerLevel = 'normal' | 'medium' | 'high' | 'critical';

export interface ClientPowerAnalysis {
  level: ClientPowerLevel;
  label: string;
  color: string;
  markerSize: number;
  shouldPulse: boolean;
  badgeVariant: 'default' | 'warning' | 'destructive';
  phaseCoupling?: string; // Ex: "A-B (230V)" ou "A (400V)"
}

/**
 * Analyse le niveau de risque d'un client selon sa puissance contractuelle
 * Seuils unifiés pour tous les types (MONO, TRI, TETRA) : 10, 22, 56 kVA
 */
export const analyzeClientPower = (
  client: ClientImporte,
  networkVoltage?: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V'
): ClientPowerAnalysis => {
  const power = client.puissanceContractuelle_kVA;
  
  // Déterminer le couplage (phase-phase pour 230V, phase-neutre pour 400V)
  let phaseCoupling = '';
  if (client.phaseCoupling) {
    phaseCoupling = networkVoltage === 'TRIPHASÉ_230V' 
      ? `${client.phaseCoupling} (230V)` 
      : `${client.phaseCoupling} (400V)`;
  } else if (client.assignedPhase) {
    // Fallback si phaseCoupling n'est pas défini
    phaseCoupling = networkVoltage === 'TRIPHASÉ_230V'
      ? `${client.assignedPhase}-? (230V)`
      : `${client.assignedPhase} (400V)`;
  }

  // Seuils unifiés : 10, 22, 56 kVA
  if (power >= 56) {
    return {
      level: 'critical',
      label: '🔴 CRITIQUE',
      color: '#ef4444', // red-500
      markerSize: 32,
      shouldPulse: true,
      badgeVariant: 'destructive',
      phaseCoupling
    };
  } else if (power >= 22) {
    return {
      level: 'high',
      label: '⚡ FORTE CHARGE',
      color: '#f97316', // orange-500
      markerSize: 28,
      shouldPulse: false,
      badgeVariant: 'destructive',
      phaseCoupling
    };
  } else if (power >= 10) {
    return {
      level: 'medium',
      label: '⚠️ MOYENNE',
      color: '#f59e0b', // amber-500
      markerSize: 24,
      shouldPulse: false,
      badgeVariant: 'warning',
      phaseCoupling
    };
  }

  return {
    level: 'normal',
    label: '',
    color: '#10b981', // green-500
    markerSize: 20,
    shouldPulse: false,
    badgeVariant: 'default',
    phaseCoupling
  };
};

/**
 * Construit une adresse complète à partir des composants
 */
export const buildFullAddress = (
  localite?: string | number,
  rue?: string | number,
  numero?: string | number
): string | null => {
  const parts = [
    numero ? String(numero).trim() : null,
    rue ? String(rue).trim() : null,
    localite ? String(localite).trim() : null
  ].filter(Boolean);
  
  return parts.length >= 2 ? parts.join(', ') : null;
};

export interface GeocodingReport {
  total: number;
  withGPS: number;
  geocoded: number;
  ambiguous: number;
  failed: number;
}

/**
 * Parse un fichier Excel et retourne un tableau de clients importés avec géocodage automatique
 */
export const parseExcelToClients = (
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<{ clients: ClientImporte[]; geocodingReport: GeocodingReport }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        
        const clients: ClientImporte[] = [];
        const report: GeocodingReport = { 
          total: 0, 
          withGPS: 0, 
          geocoded: 0, 
          ambiguous: 0, 
          failed: 0 
        };
        
        for (let index = 0; index < jsonData.length; index++) {
          const row: any = jsonData[index];
          report.total++;
          
          // Prendre la valeur brute du couplage sans interprétation
          const couplage = String(row['Couplage'] || '').trim();
          
          // Extraire les coordonnées GPS
          let lat = parseFloat(row['E_CLIENT.N_WGS84_Y']) || 0;
          let lng = parseFloat(row['E_CLIENT.N_WGS84_X']) || 0;
          
          // Extraire les composants d'adresse
          const localite = row['Localité'];
          const rue = row['Rue'];
          const numero = row['Numéro de rue'];
          const fullAddress = buildFullAddress(localite, rue, numero);
          
          let geocoded = false;
          let geocodingStatus: 'success' | 'failed' | 'ambiguous' | undefined;
          let geocodingConfidence: number | undefined;
          
          // Si pas de GPS mais adresse disponible → géocoder
          if ((!lat || !lng) && fullAddress) {
            onProgress?.(index + 1, jsonData.length);
            
            console.log(`🔍 Géocodage de "${fullAddress}"...`);
            const result = await geocodeAddress(fullAddress);
            
            if (result && result.status !== 'failed') {
              lat = result.lat;
              lng = result.lng;
              geocoded = true;
              geocodingStatus = result.status;
              geocodingConfidence = result.confidence;
              
              if (result.status === 'success') {
                report.geocoded++;
                console.log(`✅ Géocodé: ${result.displayName}`);
              } else if (result.status === 'ambiguous') {
                report.ambiguous++;
                console.log(`⚠️ Géocodage ambigu: ${result.displayName}`);
              }
            } else {
              report.failed++;
              console.warn(`❌ Échec du géocodage pour "${fullAddress}"`);
              // On continue quand même avec lat/lng à 0 pour permettre la correction manuelle
            }
            
            // Respecter le rate limiting de Nominatim (1 req/sec)
            await delay(1000);
          } else if (lat && lng) {
            report.withGPS++;
          }
          
          const client: ClientImporte = {
            id: `client-import-${Date.now()}-${index}`,
            identifiantCircuit: String(row['Identifiant circuit (Circuit)'] || ''),
            nomCircuit: String(row['Nom (Circuit)'] || ''),
            lat,
            lng,
            puissanceContractuelle_kVA: parseFloat(row['Puissance contractuelle']) || 0,
            puissancePV_kVA: parseFloat(row['Puissance PV en kVA']) || 0,
            couplage,
            clientType: 'résidentiel', // Par défaut résidentiel pour les imports Excel
            tensionMin_V: parseFloat(row['Min Tension']) || undefined,
            tensionMax_V: parseFloat(row['Max Tension']) || undefined,
            tensionMinHiver_V: parseFloat(row['Min Tension hiver']) || undefined,
            tensionMaxEte_V: parseFloat(row['Max Tension été']) || undefined,
            ecartTension15jours_V: parseFloat(row['Ecart de tension sur les 15 derniers jours']) || undefined,
            tensionCircuit_V: parseFloat(row['Tension (Circuit)']) || undefined,
            identifiantCabine: String(row['Identifiant cabine'] || ''),
            identifiantPosteSource: String(row['Identifiant poste source'] || ''),
            rawData: row,
            adresse: fullAddress || undefined,
            geocoded,
            geocodingStatus,
            geocodingConfidence
          };
          
          clients.push(client);
        }
        
        resolve({ clients, geocodingReport: report });
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
  
  // GPS nulles ne sont plus bloquantes - le client sera marqué "non localisé"
  if (client.lat !== 0 && (client.lat < -90 || client.lat > 90)) {
    errors.push('Latitude invalide (doit être entre -90 et 90)');
  }
  
  if (client.lng !== 0 && (client.lng < -180 || client.lng > 180)) {
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
 * Calcule les puissances totales par type de client (résidentiel/industriel)
 */
export const calculatePowersByClientType = (
  nodes: Node[],
  clientsImportes: ClientImporte[],
  clientLinks: ClientLink[]
): {
  chargesResidentielles: number;
  chargesIndustrielles: number;
  totalCharges: number;
} => {
  let chargesResidentielles = 0;
  let chargesIndustrielles = 0;

  // Parcourir les clients liés aux nœuds
  const linkedClientIds = new Set(clientLinks.map(link => link.clientId));
  
  clientsImportes.forEach(client => {
    if (linkedClientIds.has(client.id)) {
      if (client.clientType === 'industriel') {
        chargesIndustrielles += client.puissanceContractuelle_kVA;
      } else {
        chargesResidentielles += client.puissanceContractuelle_kVA;
      }
    }
  });

  // Ajouter les charges manuelles (résidentielles ou bornesVE)
  nodes.forEach(node => {
    node.clients.forEach(c => {
      if (c.clientCategory === 'bornesVE') {
        // Les bornes VE ne sont comptées ni en résidentiel ni en industriel
      } else {
        chargesResidentielles += c.S_kVA;
      }
    });
  });

  return {
    chargesResidentielles,
    chargesIndustrielles,
    totalCharges: chargesResidentielles + chargesIndustrielles
  };
};

/**
 * Calcule les puissances foisonnées par type de client
 */
export const calculateFoisonnedPowers = (
  nodes: Node[],
  clientsImportes: ClientImporte[],
  clientLinks: ClientLink[],
  foisonnementResidentiel: number,
  foisonnementIndustriel: number
): {
  chargesResidentiellesFoisonnees: number;
  chargesIndustriellesFoisonnees: number;
  totalFoisonne: number;
} => {
  const { chargesResidentielles, chargesIndustrielles } = calculatePowersByClientType(
    nodes, clientsImportes, clientLinks
  );

  const chargesResidentiellesFoisonnees = chargesResidentielles * (foisonnementResidentiel / 100);
  const chargesIndustriellesFoisonnees = chargesIndustrielles * (foisonnementIndustriel / 100);

  return {
    chargesResidentiellesFoisonnees,
    chargesIndustriellesFoisonnees,
    totalFoisonne: chargesResidentiellesFoisonnees + chargesIndustriellesFoisonnees
  };
};


/**
 * Regroupe les clients ayant des coordonnées identiques (avec tolérance)
 * @param clients - Liste des clients à regrouper
 * @returns Objet contenant les groupes et les clients isolés
 */
export const groupColocatedClients = (
  clients: ClientImporte[]
): { groupes: import('@/types/network').ClientGroupe[]; clientsIsoles: ClientImporte[] } => {
  const TOLERANCE_DEGRES = 0.00001; // ~1 mètre
  
  // Créer un mapping coordonnées → clients
  const coordMap = new Map<string, ClientImporte[]>();
  
  clients.forEach(client => {
    // Arrondir les coordonnées pour la tolérance
    const latKey = Math.round(client.lat / TOLERANCE_DEGRES);
    const lngKey = Math.round(client.lng / TOLERANCE_DEGRES);
    const key = `${latKey},${lngKey}`;
    
    if (!coordMap.has(key)) {
      coordMap.set(key, []);
    }
    coordMap.get(key)!.push(client);
  });
  
  const groupes: import('@/types/network').ClientGroupe[] = [];
  const clientsIsoles: ClientImporte[] = [];
  
  coordMap.forEach((groupClients, coordKey) => {
    if (groupClients.length > 1) {
      // Créer un groupe
      const avgLat = groupClients.reduce((sum, c) => sum + c.lat, 0) / groupClients.length;
      const avgLng = groupClients.reduce((sum, c) => sum + c.lng, 0) / groupClients.length;
      
      // Récupérer les couplages et circuits uniques
      const couplagesSet = new Set(groupClients.map(c => c.couplage));
      const circuitsSet = new Set(groupClients.map(c => c.nomCircuit));
      
      groupes.push({
        id: `groupe-${coordKey}`,
        type: 'groupe',
        lat: avgLat,
        lng: avgLng,
        clientIds: groupClients.map(c => c.id),
        clients: groupClients,
        puissanceContractuelle_kVA: groupClients.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0),
        puissancePV_kVA: groupClients.reduce((sum, c) => sum + c.puissancePV_kVA, 0),
        couplages: Array.from(couplagesSet),
        nombreClients: groupClients.length,
        circuits: Array.from(circuitsSet),
      });
    } else {
      // Client isolé
      clientsIsoles.push(groupClients[0]);
    }
  });
  
  return { groupes, clientsIsoles };
};

/**
 * Détermine la couleur d'un marqueur client selon le mode sélectionné
 * @param client - Client importé à colorer
 * @param mode - Mode de coloration : 'couplage', 'circuit', 'tension', ou 'lien'
 * @param circuitColorMapping - Mapping des couleurs par circuit (pour mode 'circuit')
 * @param clientLinks - Liste des liens client-nœud (pour mode 'lien')
 * @returns Code couleur hexadécimal
 */
export const getClientMarkerColor = (
  client: ClientImporte, 
  mode: 'couplage' | 'circuit' | 'tension' | 'lien' | 'gps',
  circuitColorMapping?: Map<string, string>,
  clientLinks?: ClientLink[]
): string => {
  switch (mode) {
    case 'couplage':
      // Utiliser connectionType si disponible (modifiable), sinon interpréter couplage brut (Excel)
      if (client.connectionType) {
        // Utiliser le type de connexion normalisé
        return client.connectionType === 'MONO' ? '#f97316' : '#3b82f6'; // Orange pour MONO, Bleu pour TRI/TETRA
      }
      
      // Fallback : Interpréter les valeurs brutes pour la coloration
      const couplageUpper = client.couplage.toUpperCase();
      const isTriphasé = (
        couplageUpper.includes('TRI') || 
        couplageUpper.includes('TETRA') || 
        couplageUpper.includes('TÉTRA') ||
        couplageUpper.includes('3P')
      );
      return isTriphasé ? '#3b82f6' : '#f97316';
    
    case 'circuit':
      // Utiliser le mapping si disponible, sinon couleur par défaut
      if (circuitColorMapping && circuitColorMapping.has(client.identifiantCircuit)) {
        return circuitColorMapping.get(client.identifiantCircuit)!;
      }
      return '#6b7280'; // Gris par défaut si pas de mapping
    
    case 'tension':
      // Utiliser uniquement tensionCircuit_V
      if (client.tensionCircuit_V === undefined) return '#6b7280'; // Gris si pas de donnée
      return client.tensionCircuit_V < 300 ? '#06b6d4' : '#d946ef'; // Cyan pour 230V, Magenta pour 400V
    
    case 'gps':
      // Distinguer GPS d'origine vs géocodé
      if (client.geocoded === true) {
        return '#f97316'; // Orange pour géocodé automatiquement
      } else {
        return '#22c55e'; // Vert pour GPS d'origine (présent dans Excel)
      }
    
    case 'lien':
      // Vérifier si le client est lié à un nœud
      const isLinked = clientLinks?.some(link => link.clientId === client.id);
      return isLinked ? '#22c55e' : '#ef4444'; // Vert si lié, Rouge sinon
    
    default:
      return '#3b82f6';
  }
};
