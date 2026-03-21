

# Diagnostic: Choix incorrect du noeud SRG2

## Problemes identifies

### 1. DEUX algorithmes concurrents avec la meme signature

Il existe **deux** fonctions `findOptimalSRG2Node` dans le projet:

- **`optimalSrg2Finder.ts`** (ancien) — algorithme impedance: `score = deltaU * Z_upstream` (minimiser). Utilise par `SRG2Panel.tsx` pour suggerer le noeud optimal quand l'utilisateur clique "Suggestion optimale".

- **`srg2Placement.ts`** (nouveau) — algorithme simulation exhaustive avec scoring pragmatique (correction/marge/viabilite). Utilise par `SimulationPanel.tsx` > onglet Analyse.

Le `SRG2Panel.tsx` (ligne 13) importe depuis `optimalSrg2Finder.ts`, pas depuis le nouveau `srg2Placement.ts`.

### 2. `SRG2Panel.tsx` a son propre `findDownstreamNodes` NON-DIRECTIONNEL (ligne 73-97)

Cette version locale parcourt le graphe dans toutes les directions (pas de filtre par distance a la source). Elle est utilisee pour calculer la puissance aval affichee dans le panneau SRG2. Elle peut remonter vers la source et compter tous les noeuds du reseau comme "aval".

### 3. L'ancien algorithme (`optimalSrg2Finder.ts`) ne verifie PAS la puissance aval

Il se base uniquement sur `deltaU * Z_upstream`. Un noeud avec un faible desequilibre mais trop proche de la source (noeud 2) peut etre selectionne car son score est bas, sans verifier que la puissance qui le traverse depasse la capacite du SRG2.

### 4. Le nouveau algorithme (`srg2Placement.ts`) a un bug de correction rate

Ligne 92: `correctionRate = beforeIssues > 0 ? ... : 100`. Si le reseau n'a pas de noeuds hors norme (ex: tensions entre 207-253V), TOUS les candidats obtiennent 100% de correction, et le score est domine par la marge de puissance — ce qui favorise les noeuds en bout de reseau (feuilles) au lieu des noeuds intermediaires.

## Corrections proposees

### A. Unifier sur le nouvel algorithme dans SRG2Panel

- **`SRG2Panel.tsx`**: Remplacer l'import de `optimalSrg2Finder.ts` par `srg2Placement.ts`
- Adapter l'appel (le nouveau prend `scenario` en plus)
- Supprimer la fonction locale `findDownstreamNodes` non-directionnelle et utiliser `findDownstreamNodesFromNode` de `networkAnalysis.ts`

### B. Corriger le scoring du nouveau algorithme

Dans `srg2Placement.ts`, `analyzeSRG2Impact`:
- Si `beforeIssues === 0`: le score de correction doit etre determine par **l'amelioration de tension** (reduction du delta V max), pas un 100% par defaut
- Ajouter un critere de **couverture minimale**: le SRG2 doit avoir au moins X noeuds en aval pour justifier l'investissement (ex: `downstreamNodes.length >= 3`)
- Si puissance aval > limite → score = 0 (elimination directe, pas de score positif avec marge negative)

### C. Supprimer `optimalSrg2Finder.ts` (code mort apres unification)

Ce fichier n'aura plus de consommateur apres la correction A.

## Fichiers modifies

1. `src/components/SRG2Panel.tsx` — import + logique downstream
2. `src/utils/srg2Placement.ts` — scoring et couverture
3. `src/utils/optimalSrg2Finder.ts` — suppression (ou conservation comme reference)

## Impact

- Le noeud SRG2 propose sera desormais base sur la simulation reelle (correction + marge + viabilite)
- Les noeuds trop proches de la source seront elimines par la marge de puissance negative
- Les noeuds feuilles seront penalises par le manque de couverture

