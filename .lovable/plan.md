

## Plan: Connecter les profils du store + ajouter bouton éditeur dans le Labo

### Problème
Le Labo utilise `profilesData` (import statique JSON) au lieu de `dailyProfileCustomProfiles` du store Zustand. Les modifications faites via l'éditeur de profils ne sont donc pas reflétées.

### Modifications — `src/components/topMenu/LaboFoisonnementTab.tsx`

**1. Remplacer l'import statique par le store**
- Supprimer `import profilesData from '@/data/hourlyProfiles.json'`
- Extraire `dailyProfileCustomProfiles` et `setDailyProfileCustomProfiles` depuis `useNetworkStore()`
- Passer `dailyProfileCustomProfiles` aux 3 constructeurs `DailyProfileCalculator` (lignes 264, 274, 283) au lieu de `profilesData as any`
- Remplacer `profilesData` par `dailyProfileCustomProfiles` dans les deps du `useMemo` (ligne 294)

**2. Ajouter le bouton éditeur de profils + dialog**
- Importer `ProfileVisualEditor` et l'icône `Settings`
- Ajouter un state `editorOpen`
- Placer un bouton "Modifier les profils" dans la zone de contrôle (près des sélecteurs saison/météo)
- Rendre le composant `<ProfileVisualEditor>` avec `dailyProfileCustomProfiles` / `setDailyProfileCustomProfiles`

### Fichiers modifiés

| Fichier | Action |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Remplacer profilesData par store + ajouter bouton éditeur |

