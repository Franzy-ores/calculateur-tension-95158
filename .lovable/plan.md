
# Plan : Implémentation de la formule GRD belge pour les impédances

## Contexte technique

Dans les réseaux de distribution BT des GRD belges (ORES, RESA, Sibelga), la chute de tension ne se calcule jamais avec R₁₂ seul. La résistance et réactance effectives vues par une phase sont toujours :

```text
R = (R₀ + 2×R₁₂) / 3
X = (X₀ + 2×X₁₂) / 3
```

Cette formule combine les impédances de séquence directe (Z₁) et homopolaire (Z₀) car le réseau GRD est structurellement déséquilibré.

## Analyse du code actuel

La méthode `selectRX` dans `src/utils/electricalCalculations.ts` retourne actuellement :

```text
┌─────────────────────────────────────────────────────────┐
│ Réseau 230V triangle : R = R₁₂, X = X₁₂                │
│ Réseau 400V étoile   : R = R₁₂, X = X₁₂ (phases)       │
│                        R = R₀,  X = X₀  (neutre seul)  │
└─────────────────────────────────────────────────────────┘
```

Cette logique sous-estime la chute de tension jusqu'à **40%** sur certains câbles torsadés.

## Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `src/utils/electricalCalculations.ts` | Modifier `selectRX` pour appliquer la formule GRD |
| `src/utils/equi8CME.ts` | Appliquer la formule pour le calcul d'impédance équivalente |
| `src/utils/optimalEqui8Finder.ts` | Appliquer la formule pour la recherche de nœud optimal |
| `src/utils/optimalSrg2Finder.ts` | Appliquer la formule pour la recherche de nœud SRG2 |
| `src/utils/__tests__/mono230VCurrentCalculation.test.ts` | Mettre à jour les tests unitaires |

## Détails techniques

### Étape 1 : Créer une fonction utilitaire de calcul d'impédance GRD

Ajouter dans `electricalCalculations.ts` :

```typescript
/**
 * Calcule l'impédance effective selon la formule GRD belge
 * R = (R0 + 2*R12) / 3
 * X = (X0 + 2*X12) / 3
 * 
 * Cette formule combine les composantes directe et homopolaire
 * car le réseau de distribution est structurellement déséquilibré.
 */
private calculateGRDImpedance(cableType: CableType): { R: number, X: number } {
  const R = (cableType.R0_ohm_per_km + 2 * cableType.R12_ohm_per_km) / 3;
  const X = (cableType.X0_ohm_per_km + 2 * cableType.X12_ohm_per_km) / 3;
  return { R, X };
}
```

### Étape 2 : Modifier la méthode `selectRX`

Remplacer la logique actuelle :

```text
AVANT:
  230V → R₁₂, X₁₂
  400V → R₁₂, X₁₂ (phases) / R₀, X₀ (neutre)

APRÈS:
  Phases → (R₀ + 2×R₁₂)/3, (X₀ + 2×X₁₂)/3
  Neutre → R₀, X₀ (inchangé)
```

### Étape 3 : Propagation aux modules connexes

Appliquer la même formule dans :
- `equi8CME.ts` ligne 207 : calcul de `Zph_total`
- `optimalEqui8Finder.ts` ligne 161 : calcul de `Zph_total`
- `optimalSrg2Finder.ts` ligne 162 : calcul de `Zph_total`

### Étape 4 : Validation numérique

Exemple de calcul pour un câble TR 70 Alu :

```text
R₁₂ = 0.450 Ω/km, R₀ = 1.350 Ω/km
X₁₂ = 0.100 Ω/km, X₀ = 0.300 Ω/km

R_GRD = (1.350 + 2×0.450) / 3 = 0.750 Ω/km
X_GRD = (0.300 + 2×0.100) / 3 = 0.167 Ω/km

Impact : R_GRD / R₁₂ = 0.750 / 0.450 = 1.67 (+67%)
```

La chute de tension sera augmentée d'environ 40-67% selon le câble, ce qui correspond aux observations terrain.

## Formules de chute de tension

Ces formules restent inchangées, mais utilisent les nouvelles valeurs R et X :

```text
Monophasé : ΔV = 2 × L × I × (R×cosφ + X×sinφ)
Triphasé  : ΔV = √3 × L × I × (R×cosφ + X×sinφ)
```

## Impact sur les fichiers de câbles de branchement

Le fichier `src/data/branchementCableTypes.ts` utilise une structure simplifiée avec `R_ohm_per_km` et `X_ohm_per_km` (sans distinction R₁₂/R₀). Ces câbles de branchement sont utilisés uniquement dans l'onglet "Tension Client" et ne sont pas affectés par cette modification.

## Tests de non-régression

Les tests existants devront être mis à jour pour refléter les nouvelles valeurs attendues. Les résultats de chute de tension seront plus élevés, ce qui correspond à la réalité physique des réseaux GRD belges.
