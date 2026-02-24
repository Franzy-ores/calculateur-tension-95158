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
