/**
 * Types de câbles de branchement NF C 14-100
 * Utilisés pour les raccordements entre le réseau BT et les clients
 */

export interface BranchementCableType {
  id: string;
  label: string;
  R_ohm_per_km: number;     // Résistance linéique (Ohm/km)
  X_ohm_per_km: number;     // Réactance linéique (Ohm/km)
  maxCurrent_A: number;     // Courant admissible maximal (A)
  type: 'MONO' | 'TRI';     // Type de câble (monophasé ou triphasé)
  nbConducteurs: number;    // Nombre de conducteurs (2 pour mono, 4 pour tri)
  section_mm2: number;      // Section en mm²
  materiau: 'Alu' | 'Cu';   // Matériau conducteur
}

/**
 * Liste des câbles de branchement standard NF C 14-100
 * Principalement en aluminium pour le réseau de distribution
 */
export const branchementCableTypes: BranchementCableType[] = [
  // Câbles monophasés (2 conducteurs) - phase + neutre ou phase-phase
  { 
    id: 'brcht-2x16-alu', 
    label: '2×16 Alu', 
    R_ohm_per_km: 1.91, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 75, 
    type: 'MONO', 
    nbConducteurs: 2,
    section_mm2: 16,
    materiau: 'Alu'
  },
  { 
    id: 'brcht-2x25-alu', 
    label: '2×25 Alu', 
    R_ohm_per_km: 1.20, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 100, 
    type: 'MONO', 
    nbConducteurs: 2,
    section_mm2: 25,
    materiau: 'Alu'
  },
  
  // Câbles triphasés/tétraphasés (4 conducteurs) - 3 phases + neutre
  { 
    id: 'brcht-4x16-alu', 
    label: '4×16 Alu', 
    R_ohm_per_km: 1.91, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 75, 
    type: 'TRI', 
    nbConducteurs: 4,
    section_mm2: 16,
    materiau: 'Alu'
  },
  { 
    id: 'brcht-4x25-alu', 
    label: '4×25 Alu', 
    R_ohm_per_km: 1.20, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 100, 
    type: 'TRI', 
    nbConducteurs: 4,
    section_mm2: 25,
    materiau: 'Alu'
  },
  { 
    id: 'brcht-4x35-alu', 
    label: '4×35 Alu', 
    R_ohm_per_km: 0.868, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 125, 
    type: 'TRI', 
    nbConducteurs: 4,
    section_mm2: 35,
    materiau: 'Alu'
  },
  { 
    id: 'brcht-4x50-alu', 
    label: '4×50 Alu', 
    R_ohm_per_km: 0.641, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 150, 
    type: 'TRI', 
    nbConducteurs: 4,
    section_mm2: 50,
    materiau: 'Alu'
  },
  { 
    id: 'brcht-4x70-alu', 
    label: '4×70 Alu', 
    R_ohm_per_km: 0.443, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 190, 
    type: 'TRI', 
    nbConducteurs: 4,
    section_mm2: 70,
    materiau: 'Alu'
  },
  { 
    id: 'brcht-4x95-alu', 
    label: '4×95 Alu', 
    R_ohm_per_km: 0.320, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 230, 
    type: 'TRI', 
    nbConducteurs: 4,
    section_mm2: 95,
    materiau: 'Alu'
  },
  
  // Câbles cuivre (moins courants mais parfois utilisés)
  { 
    id: 'brcht-2x10-cu', 
    label: '2×10 Cu', 
    R_ohm_per_km: 1.83, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 63, 
    type: 'MONO', 
    nbConducteurs: 2,
    section_mm2: 10,
    materiau: 'Cu'
  },
  { 
    id: 'brcht-4x10-cu', 
    label: '4×10 Cu', 
    R_ohm_per_km: 1.83, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 63, 
    type: 'TRI', 
    nbConducteurs: 4,
    section_mm2: 10,
    materiau: 'Cu'
  },
];

/**
 * Récupère un câble de branchement par son ID
 */
export const getBranchementCableById = (id: string): BranchementCableType | undefined => {
  return branchementCableTypes.find(cable => cable.id === id);
};

/**
 * Filtre les câbles compatibles avec un type de raccordement client
 * @param connectionType Type de connexion du client (MONO, TRI, TETRA)
 * @returns Liste des câbles compatibles
 */
export const getCompatibleBranchementCables = (
  connectionType: 'MONO' | 'TRI' | 'TETRA'
): BranchementCableType[] => {
  if (connectionType === 'MONO') {
    // MONO peut utiliser des câbles 2x (mono) ou 4x (tri)
    return branchementCableTypes;
  }
  // TRI et TETRA nécessitent des câbles 4x
  return branchementCableTypes.filter(cable => cable.type === 'TRI');
};

/**
 * Calcule la distance géodésique entre deux points en mètres
 * Formule de Haversine
 */
export const calculateGeodeticDistance = (
  lat1: number, 
  lng1: number, 
  lat2: number, 
  lng2: number
): number => {
  const R = 6371000; // Rayon de la Terre en mètres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance en mètres
};
