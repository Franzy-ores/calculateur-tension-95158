

# Refactoring : Eliminer la duplication de `equi8UpstreamReduction`

## Probleme

Deux maps identiques sont calculees avec la meme logique de propagation amont :

1. **`equi8UpstreamReduction`** (ligne 1503) : construite a partir de `equi8CompensationByNode`, utilisee dans le BFS neutre (ligne 1551) pour reduire `IN_phasor` pendant le calcul de propagation.
2. **`equi8UpstreamReductionForCables`** (ligne 1648) : recalculee a partir de `n.customProps['equi8_I_compensation']`, utilisee plus bas (ligne 1718) pour reduire `IN_mag` dans la composition des resultats cables.

Le commentaire en ligne 1650 dit explicitement : *"Recalculer ici pour avoir acces en dehors du bloc"*. La cause est un probleme de portee (scope) : la premiere map est declaree a l'interieur d'un bloc `if (is400V)` et n'est pas accessible apres.

Les deux sources de donnees (`equi8CompensationByNode` vs `customProps`) contiennent normalement les memes valeurs, mais cette duplication cree un risque de divergence silencieuse si l'une est mise a jour sans l'autre.

## Solution

Remonter la declaration de `equi8UpstreamReduction` en dehors du bloc `if (is400V)` pour qu'elle soit accessible dans toute la fonction, puis supprimer entierement le second calcul (`equi8UpstreamReductionForCables`).

## Modifications techniques

### Fichier : `src/utils/electricalCalculations.ts`

**Etape 1 : Remonter la declaration (ligne 1503)**

Deplacer `const equi8UpstreamReduction = new Map<string, number>();` avant le bloc `if (is400V)` qui la contient, pour qu'elle soit visible dans toute la portee de la fonction. Le remplissage de la map reste a l'interieur du bloc `if (is400V)` (car il ne s'applique qu'aux reseaux 400V).

**Etape 2 : Supprimer le doublon (lignes 1646-1666)**

Supprimer entierement le bloc qui cree et remplit `equi8UpstreamReductionForCables`.

**Etape 3 : Renommer les references (ligne 1718)**

Remplacer `equi8UpstreamReductionForCables.get(cab.id)` par `equi8UpstreamReduction.get(cab.id)` dans la composition des resultats cables.

## Impact

- Suppression d'environ 20 lignes de code duplique
- Une seule source de verite pour les reductions EQUI8 amont
- Aucun changement de comportement : les valeurs calculees sont identiques
- Les tests existants (EQUI8 upstream propagation, non-regression SRG2) doivent passer sans modification

| Fichier | Lignes | Modification |
|---|---|---|
| `src/utils/electricalCalculations.ts` | ~1503 | Remonter la declaration avant le bloc `if (is400V)` |
| `src/utils/electricalCalculations.ts` | 1646-1666 | Supprimer le bloc duplique `equi8UpstreamReductionForCables` |
| `src/utils/electricalCalculations.ts` | ~1718 | Remplacer `equi8UpstreamReductionForCables` par `equi8UpstreamReduction` |

