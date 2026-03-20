

# Diagnostic: Curseurs de déséquilibre → tensions nœuds

## Problème identifié

**En 230V**: les curseurs n'ont AUCUN effet sur les tensions calculées.

**En 400V**: les curseurs fonctionnent correctement.

### Cause racine

Dans `networkStore.ts`, les 3 appels à `calculateNodeAutoPhaseDistribution()` passent **toujours `undefined`** pour les paramètres `manualCouplingDistributionCharges` et `manualCouplingDistributionProductions` (lignes 641-642, 1474-1475, 1687-1688).

Pour le path **400V**, ce n'est pas un problème car le paramètre `manualPhaseDistributionCharges` (A/B/C %) est utilisé directement (ligne 828 de `phaseDistributionCalculator.ts`).

Pour le path **230V**, la fonction attend des valeurs de **couplage** (A-B/B-C/A-C) via `manualCouplingDistributionCharges`. En recevant `undefined`, elle utilise un fallback qui préserve la distribution physique — donc les curseurs sont ignorés.

### Chaîne de propagation (rappel)
```
Slider A/B/C %  →  manualPhaseDistribution.charges  →  calculateNodeAutoPhaseDistribution()
                                                          ↓
                                                  foisonneAvecCurseurs (A/B/C kVA)
                                                          ↓
                                              BFS: pA/pB/pC ratios (ligne 1091)
                                                          ↓
                                              S_maps par phase → tensions nœuds
```

## Correction

### Fichier: `src/store/networkStore.ts`

Aux **3 call sites** de `calculateNodeAutoPhaseDistribution()` (lignes ~641, ~1474, ~1687):

Remplacer:
```typescript
undefined, // manualCouplingDistributionCharges
undefined, // manualCouplingDistributionProductions
```

Par une conversion A/B/C → A-B/B-C/A-C quand le réseau est 230V:

```typescript
// Conversion : slider A% → couplage A-B, B% → B-C, C% → A-C
const is230V = project.voltageSystem === 'TRIPHASÉ_230V';
const couplingCharges = is230V && project.manualPhaseDistribution?.charges
  ? { 'A-B': project.manualPhaseDistribution.charges.A,
      'B-C': project.manualPhaseDistribution.charges.B,
      'A-C': project.manualPhaseDistribution.charges.C }
  : undefined;
const couplingProductions = is230V && project.manualPhaseDistribution?.productions
  ? { 'A-B': project.manualPhaseDistribution.productions.A,
      'B-C': project.manualPhaseDistribution.productions.B,
      'A-C': project.manualPhaseDistribution.productions.C }
  : undefined;
```

Le mapping A→A-B, B→B-C, C→A-C correspond aux labels des sliders en 230V: L1-L2, L2-L3, L3-L1.

### Pourquoi le 400V fonctionne déjà

En 400V, `calculateNodeAutoPhaseDistribution` utilise directement `manualPhaseDistributionCharges.A/B/C` à la ligne 828 pour calculer `foisonneAvecCurseurs`. Ce chemin ne dépend pas du paramètre `manualCouplingDistribution`.

### Impact

- **230V**: les curseurs redistribueront effectivement les puissances foisonnées par couplage, ce qui changera les courants phase-phase dans le BFS couplé et donc les tensions nodales.
- **400V**: aucun changement (le path 400V n'utilise pas `manualCouplingDistribution`).
- Rétrocompatibilité: quand les sliders sont en mode