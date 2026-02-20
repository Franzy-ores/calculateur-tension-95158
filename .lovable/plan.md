

# Correction du facteur sqrt(3) sur la chute de tension pour reseau 230V triangle

## Probleme confirme

Le code applique un facteur sqrt(3) a la chute de tension de TOUS les reseaux triphases, sans distinction entre etoile et triangle :

```
const deltaU_line_V = isThreePhase 
  ? Math.max(dVA, dVB, dVC) * Math.sqrt(3)
  : Math.max(dVA, dVB, dVC);
```

Or :
- **Reseau TETRA 400V (etoile)** : le BFS travaille en phase-neutre (~230V). Le facteur sqrt(3) est necessaire pour convertir la chute phase-neutre en chute ligne-ligne. **Correct.**
- **Reseau TRI 230V (triangle)** : le BFS travaille directement en tension composee (230V). La chute |Z x I| est deja une chute ligne-ligne. Appliquer sqrt(3) surestime la chute de tension d'un facteur 1.73. **Bug.**

Impact : sur un reseau 230V triangle, les chutes de tension affichees sont surestimees de 73%, ce qui peut fausser les diagnostics de conformite.

## Solution

Remplacer le test `isThreePhase` par une condition qui distingue etoile (TETRA) de triangle (TRI_230V_3F). Le facteur sqrt(3) ne doit s'appliquer que pour TETRA_3P+N_230_400V.

Deux endroits a corriger :
1. **Ligne 1681** : BFS per-phase (triphase desequilibre)
2. **Ligne 2157** : BFS monophase/simplifie (equilibre)

## Modifications techniques

### Fichier : `src/utils/electricalCalculations.ts`

**Correction 1 - BFS per-phase (ligne 1662-1683)**

Ajouter la detection du type de reseau pour le noeud distal, et appliquer sqrt(3) uniquement pour les reseaux etoile :

```typescript
const { isThreePhase } = this.getVoltage(distalNode.connectionType);
const isStarNetwork = distalNode.connectionType === 'TETRA_3P+N_230_400V';

// ...

// sqrt(3) uniquement pour etoile (phase-neutre -> ligne-ligne)
// En triangle, la chute est deja en tension composee
const deltaU_line_V = isStarNetwork
  ? Math.max(dVA, dVB, dVC) * Math.sqrt(3)
  : Math.max(dVA, dVB, dVC);
```

**Correction 2 - BFS simplifie (ligne 2141-2159)**

Meme logique :

```typescript
const { isThreePhase } = this.getVoltage(distalNode.connectionType);
const isStarNetwork = distalNode.connectionType === 'TETRA_3P+N_230_400V';

// ...

const deltaU_line_V = isStarNetwork
  ? abs(dVph) * Math.sqrt(3)
  : abs(dVph);
```

## Fichier modifie

| Fichier | Lignes | Modification |
|---|---|---|
| `src/utils/electricalCalculations.ts` | 1662, 1681-1683 | Detection `isStarNetwork`, suppression sqrt(3) pour triangle |
| `src/utils/electricalCalculations.ts` | 2141, 2157-2159 | Idem pour le BFS simplifie |

## Impact attendu

- Les chutes de tension sur reseau 230V triangle seront reduites d'un facteur sqrt(3) (~42% plus basses qu'avant)
- Les reseaux 400V etoile restent inchanges
- Les reseaux monophases restent inchanges (le `else` ne change pas)
- Les tests existants portant sur des reseaux triangle pourraient necessiter une mise a jour des valeurs attendues

