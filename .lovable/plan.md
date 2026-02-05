
# Plan : Synchronisation automatique des curseurs de déséquilibre avec le tableau

## Objectif
1. Les curseurs de déséquilibre s'adaptent **automatiquement** aux valeurs calculées dans le tableau récapitulatif par couplage
2. Si l'utilisateur **force manuellement** un curseur, l'arrière-plan passe en **jaune** pour indiquer le mode forcé
3. Le bouton Reset remet les curseurs en mode automatique (synchronisé avec le tableau)

---

## Architecture proposée

### Nouveau flag dans `manualPhaseDistribution`

```typescript
manualPhaseDistribution?: {
  charges: { A: number; B: number; C: number };
  productions: { A: number; B: number; C: number };
  constraints: { min: number; max: number; total: number };
  // NOUVEAU : Flags de forçage manuel
  chargesForced?: boolean;      // true = curseurs charges forcés manuellement
  productionsForced?: boolean;  // true = curseurs productions forcés manuellement
};
```

### Comportement

| État | Comportement curseurs | Couleur fond |
|------|----------------------|--------------|
| `forced = false` | Valeurs = calcul tableau | Standard (gris/transparent) |
| `forced = true` | Valeurs = dernières valeurs manuelles | **Jaune** |
| Reset cliqué | `forced = false`, valeurs recalculées | Standard |

---

## Modifications techniques

### 1. `src/types/network.ts` (lignes 310-314)

Ajouter les flags de forçage :

```typescript
manualPhaseDistribution?: {
  charges: { A: number; B: number; C: number };
  productions: { A: number; B: number; C: number };
  constraints: { min: number; max: number; total: number };
  chargesForced?: boolean;      // NOUVEAU
  productionsForced?: boolean;  // NOUVEAU
};
```

### 2. `src/components/PhaseDistributionSliders.tsx`

#### a) Calculer les valeurs automatiques depuis le tableau

Réutiliser la logique de `calculatePhaseData()` de `PhaseDistributionDisplay.tsx` pour calculer les pourcentages réels par couplage :

```typescript
const calculateAutoDistribution = (): { A: number; B: number; C: number } => {
  // Calculer total foisonné par phase depuis les clients
  // Retourner pourcentages A, B, C
};
```

#### b) Synchroniser automatiquement si pas forcé

```typescript
useEffect(() => {
  const isForced = type === 'charges' 
    ? currentProject.manualPhaseDistribution?.chargesForced 
    : currentProject.manualPhaseDistribution?.productionsForced;
  
  if (!isForced) {
    const autoValues = calculateAutoDistribution();
    // Mettre à jour silencieusement si différent
    if (Math.abs(autoValues.A - distribution.A) > 0.1 ||
        Math.abs(autoValues.B - distribution.B) > 0.1 ||
        Math.abs(autoValues.C - distribution.C) > 0.1) {
      updateProjectConfig({
        manualPhaseDistribution: {
          ...currentProject.manualPhaseDistribution,
          [type]: autoValues
        }
      });
    }
  }
}, [currentProject.clientsImportes, currentProject.clientLinks, /* autres dépendances */]);
```

#### c) Marquer comme forcé lors d'une modification manuelle

```typescript
const handlePhaseChange = (phase: 'A' | 'B' | 'C', newValue: number) => {
  // ... logique existante ...
  
  updateProjectConfig({
    manualPhaseDistribution: {
      ...currentProject.manualPhaseDistribution,
      [type]: newDistribution,
      [`${type}Forced`]: true  // MARQUER COMME FORCÉ
    }
  });
};
```

#### d) Reset = retour en mode automatique

```typescript
const initializeToRealDistribution = () => {
  const realDistribution = calculateAutoDistribution();
  
  updateProjectConfig({
    manualPhaseDistribution: {
      ...currentProject.manualPhaseDistribution,
      [type]: realDistribution,
      [`${type}Forced`]: false  // RETOUR EN MODE AUTO
    }
  });
  
  toast.success(`${type === 'charges' ? 'Charges' : 'Productions'} synchronisées avec le tableau`);
};
```

#### e) Affichage fond jaune si forcé

```typescript
const isForced = type === 'charges' 
  ? currentProject.manualPhaseDistribution?.chargesForced 
  : currentProject.manualPhaseDistribution?.productionsForced;

return (
  <div className={cn(
    "flex items-center gap-3 p-2 rounded-md",
    isForced && "bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700"
  )}>
    {/* ... contenu existant ... */}
  </div>
);
```

### 3. `src/store/networkStore.ts`

#### Migration automatique

Lors du chargement d'un projet, initialiser les flags si absents :

```typescript
// Dans loadProject()
if (project.manualPhaseDistribution) {
  project.manualPhaseDistribution.chargesForced = project.manualPhaseDistribution.chargesForced ?? false;
  project.manualPhaseDistribution.productionsForced = project.manualPhaseDistribution.productionsForced ?? false;
}
```

#### Auto-sync lors de changements

Quand les clients changent (import, lien, suppression), si pas forcé, recalculer :

```typescript
// Dans importClientsFromExcel(), linkClientToNode(), unlinkClient(), etc.
// Après modification des clients :
if (!updatedProject.manualPhaseDistribution?.chargesForced) {
  const autoCharges = calculateRealMonoDistributionPercents(updatedProject.nodes, ...);
  updatedProject.manualPhaseDistribution.charges = autoCharges;
}
if (!updatedProject.manualPhaseDistribution?.productionsForced) {
  const autoProductions = calculateRealMonoProductionDistributionPercents(updatedProject.nodes, ...);
  updatedProject.manualPhaseDistribution.productions = autoProductions;
}
```

---

## Flux utilisateur

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ ÉTAT INITIAL : Mode automatique                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Charges:  L1-L2 ══●══ +2%  │  L2-L3 ══●══ -1%  │  L3-L1 ══●══ +5%  [⟲] │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                        (fond transparent, valeurs = tableau)                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ Utilisateur déplace un curseur
┌─────────────────────────────────────────────────────────────────────────────┐
│ ÉTAT FORCÉ : Mode manuel                                                    │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ ██████████████████████████████ FOND JAUNE ██████████████████████████████ │ │
│ │ Charges:  L1-L2 ══●══ +10% │  L2-L3 ══●══ -5%  │  L3-L1 ══●══ +8%  [⟲] │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                        (fond jaune, valeurs = manuelles)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ Utilisateur clique Reset [⟲]
┌─────────────────────────────────────────────────────────────────────────────┐
│ ÉTAT INITIAL : Mode automatique restauré                                    │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Charges:  L1-L2 ══●══ +2%  │  L2-L3 ══●══ -1%  │  L3-L1 ══●══ +5%  [⟲] │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                        (fond transparent, valeurs = tableau)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `src/types/network.ts` | Ajouter `chargesForced` et `productionsForced` au type |
| `src/components/PhaseDistributionSliders.tsx` | Auto-sync, détection forçage, fond jaune, Reset |
| `src/store/networkStore.ts` | Migration, auto-sync sur changement clients |

---

## Avantages

- Les curseurs reflètent toujours les données réelles du tableau (cohérence)
- L'utilisateur peut forcer des valeurs différentes (flexibilité)
- Le fond jaune indique clairement le mode manuel (transparence)
- Le Reset permet de revenir au mode automatique (réversibilité)
