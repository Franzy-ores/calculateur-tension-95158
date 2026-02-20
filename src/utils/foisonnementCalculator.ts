/**
 * Calcul du foisonnement adaptatif selon le nombre de clients (profil 24H uniquement)
 * 
 * Formule type Velander/Boucherot :
 *   facteur(n) = plancher + (1 - plancher) / sqrt(n)
 * 
 * - n=1 → 100% (pas de diversité possible)
 * - n croissant → converge vers la valeur du profil de base (plancher)
 * 
 * @param nClients Nombre de clients résidentiels connectés
 * @param baseProfile Valeur du profil horaire de base (en %, ex: 21)
 * @returns Foisonnement effectif (en %)
 */
export function calculateAdaptiveFoisonnement(nClients: number, baseProfile: number): number {
  if (nClients <= 0) return 0;
  if (nClients === 1) return baseProfile;
  const plancher = baseProfile / 100;
  return (plancher + (1 - plancher) / Math.sqrt(nClients)) * 100;
}
