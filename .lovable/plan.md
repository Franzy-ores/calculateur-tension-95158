

# Plan : Correction du comptage des clients MONO par couplage

## Bug identifié

### Symptôme
Un client MONO ajouté sur le couplage L1-L2 apparaît sur **deux lignes** du tableau récapitulatif (L1-L2 ET L2-L3) au lieu d'une seule.

### Cause racine
Deux sources de données incohérentes sont utilisées pour le comptage :

| Source | Fichier | Comportement |
|--------|---------|--------------|
| `calculatePhaseData()` | `PhaseDistributionDisplay.tsx:53-57` | Mappage correct : couplage → ligne unique |
| `monoClientsCount` | `phaseDistributionCalculator.ts:357-365` | Mappage incorrect : compte 0.5 sur 2 phases |

### Logique incorrecte dans `phaseDistributionCalculator.ts`

```typescript
// LIGNES 357-365 - BUG : un client A-B est compté 0.5 sur A ET 0.5 sur B
if (client.phaseCoupling === 'A-B' || client.phaseCoupling === 'A-C') {
  result.monoClientsCount.A += 0.5;
}
if (client.phaseCoupling === 'A-B' || client.phaseCoupling === 'B-C') {
  result.monoClientsCount.B += 0.5;
}
if (client.phaseCoupling === 'B-C' || client.phaseCoupling === 'A-C') {
  result.monoClientsCount.C += 0.5;
}
```

**Le problème** : On ne parle pas de phases (L1, L2, L3) mais de **couples de phases** (L1-L2, L2-L3, L3-L1). Chaque client MONO appartient à UN SEUL couplage.

---

## Correction à apporter

### Logique métier 230V Triangle

| Couplage physique | Label tableau | Variable interne |
|------------------|---------------|------------------|
| L1-L2 | `L1-L2` | `phase === 'A'` |
| L2-L3 | `L2-L3` | `phase === 'B'` |
| L3-L1 | `L3-L1` | `phase === 'C'` |

Un client sur le couplage `A-B` appartient à la ligne **L1-L2** uniquement (phase interne = 'A').

### Fichier `src/utils/phaseDistributionCalculator.ts`

#### Modification 1 : Corriger `monoClientsCount` (lignes 356-365)

```typescript
// AVANT (incorrect) : 0.5 sur 2 phases
if (client.phaseCoupling === 'A-B' || client.phaseCoupling === 'A-C') {
  result.monoClientsCount.A += 0.5;
}
if (client.phaseCoupling === 'A-B' || client.phaseCoupling === 'B-C') {
  result.monoClientsCount.B += 0.5;
}

// APRÈS (correct) : 1 client par couplage
if (client.phaseCoupling === 'A-B') {
  result.monoClientsCount.A += 1;  // L1-L2
} else if (client.phaseCoupling === 'B-C') {
  result.monoClientsCount.B += 1;  // L2-L3
} else if (client.phaseCoupling === 'A-C') {
  result.monoClientsCount.C += 1;  // L3-L1
}
```

### Fichier `src/components/PhaseDistributionDisplay.tsx`

#### Vérification : Logique de `calculatePhaseData()` (lignes 53-57)

Cette partie est **CORRECTE** :

```typescript
if (is230V) {
  const coupling = client.phaseCoupling;
  if (phase === 'A' && coupling === 'A-B') matchesPhase = true;  // ✅ L1-L2 → A
  if (phase === 'B' && coupling === 'B-C') matchesPhase = true;  // ✅ L2-L3 → B
  if (phase === 'C' && coupling === 'A-C') matchesPhase = true;  // ✅ L3-L1 → C
}
```

Le mappage est correct : un client `A-B` n'apparaît que quand `phase === 'A'`.

---

## Impact de la correction

### Avant correction
| Ligne | Client sur A-B |
|-------|----------------|
| L1-L2 | 0.5 client |
| L2-L3 | 0.5 client |
| L3-L1 | 0 client |

### Après correction
| Ligne | Client sur A-B |
|-------|----------------|
| L1-L2 | 1 client ✅ |
| L2-L3 | 0 client ✅ |
| L3-L1 | 0 client ✅ |

---

## Fichiers à modifier

| Fichier | Lignes | Action |
|---------|--------|--------|
| `src/utils/phaseDistributionCalculator.ts` | 356-365 | Corriger le comptage `monoClientsCount` pour 230V |
| `src/components/PhaseDistributionDisplay.tsx` | 53-57 | Aucune modification (déjà correct) |

---

## Récapitulatif

La seule modification nécessaire est dans `phaseDistributionCalculator.ts` pour aligner le comptage des clients MONO avec la logique "1 client = 1 couplage de phases", au lieu de la logique erronée "1 client = 0.5 × 2 phases".

