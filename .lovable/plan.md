

# Diagnostic : hourlyProfiles.json non reactif dans le Labo

## Probleme identifie

Le fichier `hourlyProfiles.json` **est bien utilise** par le `DailyProfileCalculator` (import statique ligne 6 de `dailyProfileCalculator.ts`). Cependant, le Labo ne reagit pas aux modifications pour deux raisons :

1. **Import indirect** : Les profils sont importes dans `dailyProfileCalculator.ts`, pas dans `LaboFoisonnementTab.tsx`. Le composant Labo passe `undefined` comme `customProfiles` (ligne 242), laissant le calculator utiliser son import interne.

2. **useMemo aveugle** : Le `useMemo` (ligne 272) qui lance les 3 runs a pour dependances `[currentProject, selectedNodeId, season, weather, ...]` — les profils JSON n'y figurent pas. Meme si Vite HMR recharge le module, le memo ne se re-execute pas car aucune de ses dependances reactives n'a change.

En resume : vous modifiez le JSON, Vite le recharge, mais le `useMemo` du Labo ne sait pas qu'il doit recalculer.

## Correction

### `LaboFoisonnementTab.tsx`

1. **Importer directement** `hourlyProfiles.json` dans le composant Labo
2. **Passer** cet import comme `customProfiles` aux 3 constructeurs `DailyProfileCalculator` (au lieu de `undefined`)
3. **Ajouter** l'objet profiles aux dependances du `useMemo` principal

```text
Avant:  new DailyProfileCalculator(currentProject, baseOptions, undefined, ...)
Apres:  new DailyProfileCalculator(currentProject, baseOptions, profilesData, ...)
```

Cela rend le Labo reactif a toute modification du fichier JSON.

### Fichier modifie

| Fichier | Modification |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | +1 import hourlyProfiles.json, passer comme customProfiles aux 3 runs, ajouter aux deps useMemo |

