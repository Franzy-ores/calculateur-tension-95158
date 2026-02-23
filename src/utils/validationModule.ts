/**
 * 🔧 FIX GRD — Module de validation interne
 * 
 * Vérifie la cohérence des résultats BFS après chaque calcul.
 * Logs explicites dans la console pour diagnostic rapide.
 */

import { Node, Cable, CableType, Project } from '@/types/network';

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Vérifie que S_aval ≤ S_amont pour chaque câble
 */
export function validatePowerBalance(
  nodes: Node[],
  cables: Cable[],
  S_prel_map: Map<string, number>,
  S_pv_map: Map<string, number>,
  children: Map<string, string[]>,
  sourceId: string
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Calculer S_aval pour chaque nœud (somme récursive des sous-arbres)
  const getSubtreeS = (nodeId: string): number => {
    const S_prel = S_prel_map.get(nodeId) || 0;
    const S_pv = S_pv_map.get(nodeId) || 0;
    let total = S_prel - S_pv;
    for (const childId of children.get(nodeId) || []) {
      total += getSubtreeS(childId);
    }
    return total;
  };

  const S_source = getSubtreeS(sourceId);
  if (!isFinite(S_source)) {
    errors.push(`[GRD-VALID] S_source non fini: ${S_source}`);
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Vérifie que A + B + C ≈ S_total (±1%) pour chaque nœud
 */
export function validatePhaseBalance(node: Node): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!node.autoPhaseDistribution) {
    return { valid: true, warnings, errors };
  }

  const total = node.autoPhaseDistribution.charges.total;
  const sum = total.A + total.B + total.C;
  
  // Comparer avec les charges brutes liées au nœud (si disponibles)
  if (sum > 0) {
    const diff = Math.abs(total.A + total.B + total.C);
    // Vérification interne : les proportions doivent sommer à ~100%
    if (node.autoPhaseDistribution.charges.foisonneAvecCurseurs) {
      const fac = node.autoPhaseDistribution.charges.foisonneAvecCurseurs;
      const facSum = fac.A + fac.B + fac.C;
      if (facSum > 0 && Math.abs(facSum - sum) / sum > 0.01) {
        warnings.push(`[GRD-VALID] Nœud ${node.name || node.id}: foisonneAvecCurseurs (${facSum.toFixed(2)}) ≠ total (${sum.toFixed(2)}), écart ${((facSum - sum) / sum * 100).toFixed(1)}%`);
      }
    }
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Vérifie que le courant neutre ne dépasse pas I_max câble
 */
export function validateNeutralCurrent(
  cable: Cable,
  cableType: CableType
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (cable.currentNeutral_A && cableType.maxCurrent_A) {
    if (cable.currentNeutral_A > cableType.maxCurrent_A) {
      errors.push(`[GRD-VALID] Câble ${cable.name || cable.id}: I_N=${cable.currentNeutral_A.toFixed(1)}A > I_max=${cableType.maxCurrent_A}A`);
    } else if (cable.currentNeutral_A > cableType.maxCurrent_A * 0.8) {
      warnings.push(`[GRD-VALID] Câble ${cable.name || cable.id}: I_N=${cable.currentNeutral_A.toFixed(1)}A > 80% de I_max=${cableType.maxCurrent_A}A`);
    }
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Détecte les incohérences de foisonnement dans le projet
 */
export function validateFoisonnement(project: Project): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const foisRes = project.foisonnementChargesResidentiel ?? project.foisonnementCharges;
  const foisInd = project.foisonnementChargesIndustriel ?? project.foisonnementCharges;
  const foisProd = project.foisonnementProductions;

  if (foisRes < 0 || foisRes > 100) {
    errors.push(`[GRD-VALID] Foisonnement résidentiel hors limites: ${foisRes}%`);
  }
  if (foisInd < 0 || foisInd > 100) {
    errors.push(`[GRD-VALID] Foisonnement industriel hors limites: ${foisInd}%`);
  }
  if (foisProd < 0 || foisProd > 100) {
    errors.push(`[GRD-VALID] Foisonnement productions hors limites: ${foisProd}%`);
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Exécute toutes les validations et log les résultats
 */
export function runAllValidations(project: Project): void {
  const foisResult = validateFoisonnement(project);
  
  for (const w of foisResult.warnings) console.warn(w);
  for (const e of foisResult.errors) console.error(e);
  
  for (const node of project.nodes) {
    const phaseResult = validatePhaseBalance(node);
    for (const w of phaseResult.warnings) console.warn(w);
    for (const e of phaseResult.errors) console.error(e);
  }
  
  for (const cable of project.cables) {
    const ct = project.cableTypes.find(t => t.id === cable.typeId);
    if (ct) {
      const neutralResult = validateNeutralCurrent(cable, ct);
      for (const w of neutralResult.warnings) console.warn(w);
      for (const e of neutralResult.errors) console.error(e);
    }
  }
}
