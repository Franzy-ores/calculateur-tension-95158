/**
 * Calcul du foisonnement par paliers terrain (puissance contractuelle)
 * 
 * Paliers conservateurs basés sur les mesures terrain,
 * ajustés avec une marge de sécurité par rapport à la norme NF C 14-100 :
 * 
 *   n = 1       → 100%  (pas de diversité possible)
 *   n = 2-10    → 30%   (aligné avec NF C 14-100 corrigée du ratio d'utilisation)
 *   n = 11-20   → 15%   (marge de sécurité vs. terrain à 10%)
 *   n > 20      → 8%    (marge de sécurité vs. terrain à 5%)
 * 
 * Ces paliers s'appliquent à la puissance contractuelle, pas à la puissance appelée.
 * Le ratio d'utilisation typique résidentiel (~0.25 à 0.40) est implicitement intégré.
 * 
 * @param nClients Nombre de clients résidentiels connectés
 * @param baseProfile Valeur du profil horaire de base (en %, ex: 21)
 * @returns Foisonnement effectif (en %)
 */
export function calculateAdaptiveFoisonnement(nClients: number, baseProfile: number): number {
  if (nClients <= 0) return 0;
  if (nClients === 1) return baseProfile;

  const palier = getFoisonnementPalier(nClients);
  return baseProfile * palier;
}

/**
 * Retourne le coefficient de foisonnement (0-1) selon le nombre de clients
 */
export function getFoisonnementPalier(nClients: number): number {
  if (nClients <= 1) return 1.0;
  if (nClients <= 10) return 0.30;
  if (nClients <= 20) return 0.15;
  return 0.08;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FONCTION DE DIVERSITÉ NORMALISÉE K(N, cluster)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Le profil P90 hiver/été est calibré sur la mesure réelle
// (N=150, urbain résidentiel = référence).
// K vaut exactement 1.0 dans ce cas de référence et corrige
// relativement pour tout autre N ou cluster.
//
// K(N, cluster) = [ a + (1-a)/√N ] / F_REF
// avec F_REF = a_ref + (1-a_ref)/√N_ref   (constante ≈ 0.2010)

/** Coefficients 'a' par type de cluster */
export const A_CLUSTER: Record<string, number> = {
  rural: 0.18,
  urbain_dense: 0.15,
  urbain_residentiel: 0.13,
  peri_urbain: 0.11,
};

/** Mapping des lettres de cluster (circuitSimulationConfig) vers les clés A_CLUSTER */
export const CLUSTER_LETTER_TO_KEY: Record<string, string> = {
  A: 'urbain_dense',
  B: 'urbain_residentiel',
  C: 'peri_urbain',
  D: 'rural',
};

/** Référence : N=150, urbain résidentiel (a=0.13) */
const A_REF = 0.13;
const N_REF = 150;
export const F_REF = A_REF + (1 - A_REF) / Math.sqrt(N_REF);

/**
 * Coefficient de diversité normalisé K(N, cluster).
 * Vaut exactement 1.0 pour N=150, a=0.13 (urbain résidentiel).
 * 
 * @param n Nombre de clients résidentiels
 * @param a Coefficient asymptotique du cluster (ex: 0.13)
 * @returns Coefficient multiplicateur (1.0 = référence)
 */
export function calculateNormalizedDiversity(n: number, a: number): number {
  if (n <= 0) return 0;
  if (n === 1) {
    // n=1 : pas de diversité → f(1) = a + (1-a) = 1.0, normalisé par F_REF
    return 1.0 / F_REF;
  }
  return (a + (1 - a) / Math.sqrt(n)) / F_REF;
}
