

# Plan : Correction du critere de convergence BFS

## Probleme identifie

La convergence du Backward-Forward Sweep normalise le delta de tension par `Vslack_phase` (tension fixe au point source, environ 230V) au lieu de la tension reelle du noeud. Cela rend le critere trop permissif pour les noeuds en bout de reseau a basse tension.

Deux endroits concernes :
- Ligne 1400 : BFS per-phase (triphase)
- Ligne 2112 : BFS monophase/simplifie

## Solution

Remplacer la normalisation par `Vslack_phase` par une normalisation par la tension reelle de chaque noeud, noeud par noeud. Le critere de convergence devient : pour tout noeud, `|V_new - V_old| / |V_new|` doit etre inferieur a la tolerance.

## Modifications

### Fichier : `src/utils/electricalCalculations.ts`

**Ligne 1393-1400 (BFS per-phase)** :

Avant :
```typescript
let maxDelta = 0;
for (const [nid, Vn] of V_node_phase.entries()) {
  const Vp = V_prev2.get(nid) || Vslack_phase_ph;
  const d = abs(sub(Vn, Vp));
  if (d > maxDelta) maxDelta = d;
}
if (maxDelta / (Vslack_phase || 1) < CONVERGENCE_TOLERANCE) { converged2 = true; break; }
```

Apres :
```typescript
let allConverged = true;
for (const [nid, Vn] of V_node_phase.entries()) {
  const Vp = V_prev2.get(nid) || Vslack_phase_ph;
  const d = abs(sub(Vn, Vp));
  const Vn_mag = abs(Vn) || 1;
  if (d / Vn_mag >= CONVERGENCE_TOLERANCE) {
    allConverged = false;
    break;
  }
}
if (allConverged) { converged2 = true; break; }
```

**Ligne 2105-2112 (BFS monophase)** :

Avant :
```typescript
let maxDelta = 0;
for (const [nid, Vn] of V_node.entries()) {
  const Vp = V_prev.get(nid) || Vslack;
  const d = abs(sub(Vn, Vp));
  if (d > maxDelta) maxDelta = d;
}
if (maxDelta / (Vslack_phase || 1) < tol) { converged = true; break; }
```

Apres :
```typescript
let allConverged = true;
for (const [nid, Vn] of V_node.entries()) {
  const Vp = V_prev.get(nid) || Vslack;
  const d = abs(sub(Vn, Vp));
  const Vn_mag = abs(Vn) || 1;
  if (d / Vn_mag >= tol) {
    allConverged = false;
    break;
  }
}
if (allConverged) { converged = true; break; }
```

## Impact

- Le critere est desormais relatif a la tension locale de chaque noeud
- Un noeud a 195V aura le meme critere relatif qu'un noeud a 230V
- Aucun impact sur la performance (meme boucle, meme nombre d'operations)
- Les tests existants devraient passer sans modification car la tolerance (1e-4) est suffisamment large

## Fichier modifie

| Fichier | Lignes | Modification |
|---|---|---|
| `src/utils/electricalCalculations.ts` | 1393-1400 | Normalisation par V_node au lieu de Vslack (BFS triphase) |
| `src/utils/electricalCalculations.ts` | 2105-2112 | Normalisation par V_node au lieu de Vslack (BFS monophase) |

