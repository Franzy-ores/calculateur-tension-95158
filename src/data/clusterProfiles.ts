/**
 * Clusters de circuits pour le profil journalier 24H
 * 
 * Chaque cluster applique des modificateurs sur les profils horaires de base :
 * - facteurConso : multiplicateur sur le profil résidentiel
 * - facteurPV : multiplicateur sur le profil de production PV
 * - facteurVE : multiplicateur sur le bonus de charge VE
 */
export interface ClusterProfile {
  id: string;
  name: string;
  description: string;
  icon: string;
  facteurConso: number;
  facteurPV: number;
  facteurVE: number;
}

export const clusterProfiles: ClusterProfile[] = [
  {
    id: 'cluster_1',
    name: 'Urbain dense',
    description: 'Centre-ville, peu de toitures PV, peu de VE',
    icon: '🏢',
    facteurConso: 1.0,
    facteurPV: 0.3,
    facteurVE: 0.5,
  },
  {
    id: 'cluster_2',
    name: 'Urbain résidentiel',
    description: 'Pavillonnaire standard, PV moyen, VE standard',
    icon: '🏘️',
    facteurConso: 1.0,
    facteurPV: 0.7,
    facteurVE: 1.0,
  },
  {
    id: 'cluster_3',
    name: 'Péri-urbain',
    description: 'Maisons individuelles, PV en croissance, plus de VE',
    icon: '🏡',
    facteurConso: 1.1,
    facteurPV: 1.2,
    facteurVE: 1.5,
  },
  {
    id: 'cluster_4',
    name: 'Rural / diffus',
    description: 'Grandes parcelles, fort PV, forte VE',
    icon: '🌾',
    facteurConso: 1.2,
    facteurPV: 1.5,
    facteurVE: 2.0,
  },
];

export const getClusterById = (id: string): ClusterProfile | undefined =>
  clusterProfiles.find(c => c.id === id);

export const DEFAULT_CLUSTER_ID = 'cluster_2';
