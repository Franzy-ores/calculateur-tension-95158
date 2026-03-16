

## Plan : Désactiver définitivement le mode équilibré

Fichier unique : `src/utils/electricalCalculations.ts`

### Modification 1 — Ligne 838 (forcer `isUnbalanced = true`)

Remplacer la ligne 838 et la ligne 840 par :
- Un guard qui force `loadModel = 'mixte_mono_poly'` si ce n'est pas déjà `mixte_mono_poly` ou `monophase_reparti`, avec `console.warn`
- `const isUnbalanced = true;`

### Modification 2 — Ligne 2360+ (bloc mode équilibré)

Remplacer tout le bloc `// ---- Mode équilibré ----` (de la ligne 2360 jusqu'à la fin de la méthode) par un `throw new Error(...)` indiquant que ce chemin est désactivé.

Le bloc commence à la ligne 2360 et s'étend probablement jusqu'à la fin de `calculateScenario`. Il faut identifier la fin exacte pour ne supprimer que le bloc équilibré sans toucher au reste.

### Rien d'autre n'est modifié

`selectRX`, `runBFSForPhase`, `computeNeutralVoltages`, `runCoupledBFSForDelta`, passes thermiques — tout reste intact.

