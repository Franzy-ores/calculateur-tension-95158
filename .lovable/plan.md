

## Plan: Corrections A et C — Impédance phase déséquilibré + Facteur de flèche aérien

### CORRECTION A — Impédance phase en mode déséquilibré

**Problème**: `selectRX` (ligne 303-305) retourne `calculateGRDImpedance` (formule `(R0+2·R12)/3`) pour les conducteurs de phase, que le mode soit équilibré ou déséquilibré. En mode déséquilibré, le neutre est modélisé explicitement (Z_neutral avec R0/X0), donc cette formule double-compte la composante homopolaire.

**Modification** dans `selectRX` (lignes 303-305):

```typescript
// AVANT:
// Conducteurs de phase → formule GRD belge (R0 + 2*R12) / 3
return this.calculateGRDImpedance(cableType, thermalFactor);

// APRÈS:
if (isUnbalanced) {
  // Mode déséquilibré: R12/X12 direct (le neutre est modélisé séparément via R0/X0)
  return {
    R: cableType.R12_ohm_per_km * thermalFactor,
    X: cableType.X12_ohm_per_km
  };
}
// Mode équilibré: formule GRD belge (R0 + 2*R12) / 3
return this.calculateGRDImpedance(cableType, thermalFactor);
```

**Fichier**: `src/utils/electricalCalculations.ts`, uniquement lignes 303-305. La branche `forNeutral=true` (lignes 296-301) reste inchangée.

---

### CORRECTION C — Facteur de flèche câbles aériens

**Étape 1** — Ajouter `sagFactorPercent` au type `Project` dans `src/types/network.ts` (ligne 348, avant la fermeture `}`):

```typescript
sagFactorPercent?: number; // Facteur de flèche câbles aériens (%), défaut 3, plage 0-10
```

**Étape 2** — Ajouter `sagFactorPercent?: number` en paramètre optionnel de `calculateScenario` (après `season`, ligne 601):

```typescript
season?: ThermalSeason,
sagFactorPercent?: number  // Facteur de flèche aérien (%), défaut 3
```

**Étape 3** — Passer `sagFactorPercent` depuis `calculateScenarioWithHTConfig` (ligne 574, ajouter après `project.season`):

```typescript
project.season as ThermalSeason | undefined,
project.sagFactorPercent
```

**Étape 4** — Créer une fonction helper locale dans `calculateScenario` (après les déclarations initiales, ~ligne 608):

```typescript
const applySagCorrection = (rawLength_m: number, pose: CablePose): number => {
  if (pose === 'AÉRIEN') {
    return rawLength_m * (1 + ((sagFactorPercent ?? 3) / 100));
  }
  return rawLength_m;
};
```

**Étape 5** — Appliquer dans les 5 emplacements où `calculateLengthMeters` est appelé dans `calculateScenario`:

| Ligne | Contexte | Modification |
|---|---|---|
| 840 | Pré-calcul impédances (boucle initiale) | `applySagCorrection(length_m, cab.pose)` |
| 1467 | Boucle thermique (thermal passes) | idem |
| 1639 | Propagation V_neutral | idem |
| 1725 | Assemblage résultats (boucle résultats) | idem |
| 2196 | Assemblage résultats mode équilibré | idem |

Pattern pour chaque emplacement:
```typescript
// AVANT:
const length_m = this.calculateLengthMeters(cab.coordinates || []);
const L_km = length_m / 1000;

// APRÈS:
const length_m_raw = this.calculateLengthMeters(cab.coordinates || []);
const length_m = applySagCorrection(length_m_raw, cab.pose);
const L_km = length_m / 1000;
```

---

### Fichiers modifiés

| Fichier | Modification |
|---|---|
| `src/types/network.ts` | Ajouter `sagFactorPercent?: number` à `Project` |
| `src/utils/electricalCalculations.ts` | Correction A (selectRX) + Correction C (sag factor) |

### Hors scope (non modifié)

- Mode équilibré dans `selectRX` (inchangé, toujours GRD)
- `forNeutral=true` (inchangé, toujours R0/X0)
- `computeNodeS`, `runBFSForPhase`, EQUI8, SRG2, V_neutral propagation logic
- Modèle thermique (`thermalModel.ts`)

### Vérification

Tous les appels `calculateScenario` depuis `simulationCalculator.ts` et `dailyProfileCalculator.ts` n'ont pas le paramètre `sagFactorPercent` dans leur signature → ils recevront `undefined` → défaut 3% pour aérien. Les appels via `calculateScenarioWithHTConfig` (qui ont accès au `project`) passeront la valeur configurée.

