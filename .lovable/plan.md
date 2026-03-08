

## Plan: Corriger 3 bugs SRG2 + garde-fou BFS

### Fichiers modifiés

1. **`src/utils/srg2SerieVoltage.ts`** — 2 fonctions corrigées
2. **`src/utils/electricalCalculations.ts`** — 1 garde-fou ajouté

---

### Bug 1 — `calculateForPhase` dans `computeSRG2SerieVoltagesAllPhases` (lignes 168-175)

Remplacer le régulateur continu par un commutateur à prises fixes :

```ts
// AVANT (lignes 168-175)
const stepPercent = Math.abs(coefficient);
const Vserie = computeSRG2SerieVoltage(Vmeasured, target, stepPercent, Vnom);
const Vout = Vmag + abs(Vserie) * Math.sign(coefficient);

// APRÈS
const VserieMag = (coefficient / 100) * Vnom;
const Vserie = fromPolar(Math.abs(VserieMag), angleRad + (VserieMag < 0 ? Math.PI : 0));
const Vout = Vmag + VserieMag;
```

Le coefficient est directement appliqué (-7, -3.5, 0, +3.5, +7%) sans calcul d'erreur proportionnelle. `fromPolar` reçoit toujours un rayon positif, la direction étant gérée par le déphasage de π.

---

### Bug 2 — `fromPolar` avec rayon négatif dans `computeSRG2SerieVoltage` (ligne 79)

```ts
// AVANT (ligne 79)
const Vserie = fromPolar(VserieMag, angleRad);

// APRÈS
const Vserie = fromPolar(Math.abs(VserieMag), angleRad + (VserieMag < 0 ? Math.PI : 0));
```

---

### Bug 3 — Garde-fou dans `computeSRG2SerieVoltage` (avant le return, ligne 88)

Ajouter avant `return Vserie` :

```ts
const MAX_VSERIE = 0.10 * Vnominal;
if (abs(Vserie) > MAX_VSERIE) {
  console.error(`❌ SRG2: V_série aberrante (${abs(Vserie).toFixed(1)}V), reset à 0`);
  return C(0, 0);
}
```

---

### Garde-fou BFS — `electricalCalculations.ts` (après ligne 1393, `Vv = add(Vv, Vserie)`)

Ajouter après la ligne `Vv = add(Vv, Vserie)` (et aussi après la ligne 1405 `V_node_phase.set(v, Vv)` pour couvrir le cas sans SRG2) :

```ts
const Vv_mag = abs(Vv);
if (!isFinite(Vv_mag) || Vv_mag > 350 || Vv_mag < 1) {
  console.error(`❌ Tension aberrante sur nœud ${v}: ${Vv_mag.toFixed(1)}V → reset à Vslack`);
  Vv = Vslack_phase_ph;
}
```

Placé juste avant `V_node_phase.set(v, Vv)` (ligne 1405) pour intercepter toute valeur aberrante quelle qu'en soit la source.

---

### Fonctions NON modifiées
- `determineSRG2SwitchState` — déjà corrigée précédemment
- `isSRG2Stabilized`, `createDefaultSRG2Config`, `logSRG2Metrics` — inchangées

