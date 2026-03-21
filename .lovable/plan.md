

# Correction : ku sous-estime — ameliorer le couplage inter-phases

## Diagnostic

Le ku% est sous-estime car les tensions d'entree de Fortescue sont "trop equilibrees". La racine est double :

1. **BFS independant** : chaque phase ignore l'effet des courants des autres phases sur la chute de tension (pas de matrice d'impedance mutuelle)
2. **Couplage neutre limite** : 3 iterations max pour la boucle `neutral → S_correction → BFS → neutral`

## Corrections proposees

### A. Augmenter les iterations de couplage neutre (impact immediat)

**Fichier** : `src/utils/electricalCalculations.ts`, lignes 1839-1840

- `MAX_NEUTRAL_PASSES` : 3 → **8**
- `NEUTRAL_CONVERGENCE_V` : 0.1 → **0.01**

Cela permet une meilleure convergence de la retroaction neutre ↔ courants de charge, capturant plus d'asymetrie dans les tensions de phase. Cout : quelques ms de calcul supplementaires.

### B. Modeliser le couplage mutuel dans le BFS (impact structural)

**Fichier** : `src/utils/electricalCalculations.ts`, dans `runBFSForPhase()`

Dans le forward sweep (ligne 1380), la tension au noeud enfant est :
```
V(child) = V(parent) - Z_self * I_phase
```

Ajouter le terme de couplage neutre au forward sweep :
```
V(child) = V(parent) - Z_self * I_phase - Z_mutual_neutral * I_neutral
```

Ou `I_neutral = Ia + Ib + Ic` (somme des courants de branche) et `Z_mutual_neutral` est l'impedance de couplage phase-neutre (typiquement ~0.3 × Z_neutral pour cables multipolaires).

Cela necessite de passer les courants des 3 phases a chaque BFS, ou mieux, de calculer I_neutral apres le backward sweep et l'injecter dans le forward sweep. Implementation :

1. Apres le backward sweep de chaque phase, calculer `I_N(cable) = I_A + I_B + I_C` pour chaque cable
2. Dans le forward sweep, ajouter `- Z_coupling * I_N` a la chute de tension

**Fichier modifie** : `electricalCalculations.ts` uniquement

- Modifier `runBFSForPhase` pour accepter un parametre optionnel `I_neutral_branches: Map<string, Complex>` et un coefficient de couplage
- Apres la premiere passe (3 BFS independants), calculer I_N par cable, puis relancer les 3 BFS avec le couplage
- Integrer cette boucle dans la boucle existante de couplage neutre

### C. Coefficient de couplage realiste

Le couplage phase-neutre depend de la geometrie du cable :
- Cables multipolaires (ex: NF C 33-210) : `k_coupling ≈ 0.3 × Z_neutral`
- Cables unipolaires en nappe : `k_coupling ≈ 0.15 × Z_neutral`

Ajouter un champ optionnel `mutualCouplingFactor` au type `CableType` (default 0.3).

## Plan d'implementation

1. **Correction A** (rapide, ~5 lignes) : augmenter iterations neutre
2. **Correction B** (structural, ~50 lignes) : ajouter couplage mutuel dans le forward sweep
3. **Validation** : comparer ku% avant/apres sur le reseau de reference

## Fichiers modifies

- `src/utils/electricalCalculations.ts` : corrections A et B
- `src/types/network.ts` : ajout optionnel `mutualCouplingFactor` dans `CableType`

