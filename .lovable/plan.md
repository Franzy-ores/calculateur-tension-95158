

# Plan : Simplification des boutons d'ajustement

## Problème actuel

Les boutons multiplicateurs (×0.5, ×0.8, ×1.0, ×1.2, ×1.5) proposent actuellement un menu déroulant "Cible" pour choisir quel profil ajuster. C'est redondant et confus car l'utilisateur a déjà sélectionné un profil en haut de la fenêtre.

## Solution

**L'ajustement doit impacter uniquement le profil actuellement affiché** (saison + type de profil sélectionnés).

### Modifications

| Élément | Avant | Après |
|---------|-------|-------|
| **Cible de l'ajustement** | Choix via dropdown (Tous / Résidentiel / etc.) | Profil affiché uniquement (season + profileType) |
| **Dropdown "Cible"** | Présent en bas à droite | Supprimé |
| **Variable `targetProfile`** | Utilisée | Supprimée |
| **Fonction `applyMultiplier`** | Parcourt plusieurs profils/saisons | Modifie uniquement `editedProfiles.profiles[season][profileType]` |

### Code simplifié

```typescript
const applyMultiplier = (multiplierValue: number) => {
  const currentProfile = editedProfiles.profiles[season][profileType];
  if (!currentProfile) return;

  const newProfile: { [key: string]: number } = {};
  Object.entries(currentProfile).forEach(([hour, value]) => {
    newProfile[hour] = Math.max(0, Math.min(100, Math.round(value * multiplierValue)));
  });

  setEditedProfiles(prev => ({
    ...prev,
    profiles: {
      ...prev.profiles,
      [season]: {
        ...prev.profiles[season],
        [profileType]: newProfile,
      },
    },
  }));

  toast.success(`×${multiplierValue.toFixed(1)} appliqué à ${PROFILE_LABELS[profileType].label} (${season === 'winter' ? 'Hiver' : 'Été'})`);
};
```

### Interface simplifiée

```text
┌─ Ajustement rapide ─────────────────────────────────┐
│  Ajuster : [×0.5] [×0.8] [×1.0] [×1.2] [×1.5]      │
└─────────────────────────────────────────────────────┘
```

## Fichier à modifier

- `src/components/ProfileVisualEditor.tsx`
  - Supprimer l'état `targetProfile`
  - Simplifier `applyMultiplier` pour cibler uniquement le profil affiché
  - Supprimer le `<Select>` de choix de cible dans la zone d'ajustement

## Bénéfice

- Interface plus intuitive : ce qu'on voit = ce qu'on modifie
- Moins d'éléments visuels, moins de confusion
- Comportement cohérent avec le reste de l'éditeur (modèles, sliders)

