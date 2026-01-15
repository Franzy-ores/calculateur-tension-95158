/**
 * Types de câbles de branchement
 * Utilisés pour les raccordements entre le réseau BT et les clients
 */

export interface BranchementCableType {
  id: string;
  label: string;
  R_ohm_per_km: number;     // Résistance linéique (Ohm/km)
  X_ohm_per_km: number;     // Réactance linéique (Ohm/km)
  maxCurrent_A: number;     // Courant admissible maximal (A)
  section_mm2: number;      // Section en mm²
  materiau: 'Alu' | 'Cu';   // Matériau conducteur
}

/**
 * Liste des câbles de branchement
 * BAXB = Aluminium, EXVB = Cuivre, EAXeVB = Aluminium (gros calibres)
 */
export const branchementCableTypes: BranchementCableType[] = [
  // BAXB - Câbles aluminium
  { 
    id: 'baxb-4x10-alu', 
    label: 'BAXB 4×10 Alu', 
    R_ohm_per_km: 1.83, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 63, 
    section_mm2: 10,
    materiau: 'Alu'
  },
  { 
    id: 'baxb-4x16-alu', 
    label: 'BAXB 4×16 Alu', 
    R_ohm_per_km: 1.91, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 75, 
    section_mm2: 16,
    materiau: 'Alu'
  },
  { 
    id: 'baxb-4x25-alu', 
    label: 'BAXB 4×25 Alu', 
    R_ohm_per_km: 1.20, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 100, 
    section_mm2: 25,
    materiau: 'Alu'
  },
  { 
    id: 'baxb-4x35-alu', 
    label: 'BAXB 4×35 Alu', 
    R_ohm_per_km: 0.868, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 125, 
    section_mm2: 35,
    materiau: 'Alu'
  },

  // EXVB - Câbles cuivre
  { 
    id: 'exvb-4x10-cu', 
    label: 'EXVB 4×10 Cu', 
    R_ohm_per_km: 1.83, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 63, 
    section_mm2: 10,
    materiau: 'Cu'
  },
  { 
    id: 'exvb-4x16-cu', 
    label: 'EXVB 4×16 Cu', 
    R_ohm_per_km: 1.15, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 85, 
    section_mm2: 16,
    materiau: 'Cu'
  },
  { 
    id: 'exvb-4x25-cu', 
    label: 'EXVB 4×25 Cu', 
    R_ohm_per_km: 0.727, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 110, 
    section_mm2: 25,
    materiau: 'Cu'
  },
  { 
    id: 'exvb-4x35-cu', 
    label: 'EXVB 4×35 Cu', 
    R_ohm_per_km: 0.524, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 135, 
    section_mm2: 35,
    materiau: 'Cu'
  },

  // EAXeVB - Câbles aluminium gros calibres (équivalent réseau)
  { 
    id: 'eaxevb-4g95-alu', 
    label: 'EAXeVB 4G95 Alu', 
    R_ohm_per_km: 0.320, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 230, 
    section_mm2: 95,
    materiau: 'Alu'
  },
  { 
    id: 'eaxevb-4g150-alu', 
    label: 'EAXeVB 4G150 Alu', 
    R_ohm_per_km: 0.206, 
    X_ohm_per_km: 0.08, 
    maxCurrent_A: 290, 
    section_mm2: 150,
    materiau: 'Alu'
  },
];

/**
 * Récupère un câble de branchement par son ID
 */
export const getBranchementCableById = (id: string): BranchementCableType | undefined => {
  return branchementCableTypes.find(cable => cable.id === id);
};

/**
 * Retourne tous les câbles de branchement disponibles
 * Tous les câbles sont compatibles avec tous les types de raccordement (MONO, TRI, TETRA)
 */
export const getCompatibleBranchementCables = (
  _connectionType?: 'MONO' | 'TRI' | 'TETRA'
): BranchementCableType[] => {
  return branchementCableTypes;
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
