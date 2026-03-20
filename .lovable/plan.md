

# Correction directionnelle findDownstreamNodes + diagnostic SRG2

## Probleme
`findDownstreamNodesFromNode()` parcourt le graphe sans direction — elle peut remonter vers la source, ce qui fausse le calcul de puissance aval et propose des noeuds trop proches de la source.

## Corrections

### 1. `src/utils/networkAnalysis.ts` — Remplacer `findDownstreamNodesFromNode()`
Remplacer l'implementation actuelle (lignes 50-78) par la version directionnelle en 2 etapes :
1. BFS depuis la source pour calculer la distance de chaque noeud
2. BFS depuis `startNodeId` en ne suivant que les noeuds dont la distance a la source est strictement superieure

Code exact fourni dans le prompt utilisateur.

### 2. `src/utils/srg2Placement.ts` — Ajouter diagnostic Top 10
Apres la ligne 205 (`const candidates = ...`), inserer le bloc de diagnostic qui log pour les 10 premiers candidats : nombre de noeuds aval, puissance aval, marge. Cela permet de valider visuellement que la correction fonctionne.

### 3. Verification des call sites
Les 2 fichiers consommateurs (`srg2Placement.ts` ligne 4, `equi8Placement.ts` ligne 3) importent deja `findDownstreamNodesFromNode` — aucun changement d'import necessaire puisque le nom de la fonction reste identique.

## Impact
- `networkAnalysis.ts` : remplacement du corps de `findDownstreamNodesFromNode`
- `srg2Placement.ts` : ajout de ~15 lignes de logs diagnostic
- Aucun autre fichier modifie

