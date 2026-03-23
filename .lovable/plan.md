

# Fix: Amperage incohérent dans la ligne TOTAL du tableau récapitulatif

## Probleme

La ligne **TOTAL** du tableau récapitulatif par couplage additionne les courants des 3 phases (`Math.abs(data.courantTotal)` pour A+B+C, ligne 480). Cela donne 436A pour 100 kVA, alors que le courant par phase est correct (~145A chacun).

**Per-phase** : `I = (100.4 × 0.3333) × 1000 / 230 ≈ 145.5A` -- correct
**Total affiché** : `145.5 × 3 = 436.5A` -- trompeur

Le total arithmétique des courants de phase n'a pas de sens physique. Le courant total triphasé est `I_total = S × 1000 / (√3 × U_LL)` en 400V, ou `I_total = S × 1000 / (√3 × U_LL)` en 230V delta.

De plus, la tension en ligne 113 est toujours 230V, ce qui est correct pour 400V étoile (phase-neutre) et 230V delta (tension entre conducteurs d'un couplage mono), mais la formule du courant TOTAL doit etre adaptée.

## Correction

**Fichier** : `src/components/PhaseDistributionDisplay.tsx`

### 1. Ligne TOTAL — courant triphasé correct (ligne ~480)

Remplacer la somme `courantTotal += Math.abs(data.courantTotal)` par un calcul triphasé correct :
- En 400V étoile : `I_ligne = S_total × 1000 / (√3 × 400)`
- En 230V delta : `I_ligne = S_total × 1000 / (√3 × 230)`

Formule : `I_total = (totalChargeFoisonne - totalProdFoisonne) × 1000 / (√3 × U_LL)`

Ou `U_LL` = 400 si TÉTRAPHASÉ_400V, 230 si TRIPHASÉ_230V.

### 2. Alternative plus simple : afficher le courant max par phase

Au lieu d'une somme, afficher `max(|I_A|, |I_B|, |I_C|)` dans la cellule TOTAL, avec un label adapté (ex: "I max"). C'est la valeur dimensionnante pour le disjoncteur.

Je recommande l'option 1 (courant triphasé correct) car c'est la convention standard.

## Fichier modifié

- `src/components/PhaseDistributionDisplay.tsx` : lignes 478-480 (calcul courant TOTAL)

