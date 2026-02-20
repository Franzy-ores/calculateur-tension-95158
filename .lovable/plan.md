

# Filtres meteo independants par graphique (Hiver / Ete)

## Objectif

Remplacer les 3 boutons meteo globaux (Soleil/Gris/Nuit) dans le panneau parametres par 3 icones integrees directement dans chaque graphique. Chaque graphique (Hiver, Ete) a son propre filtre meteo independant. On peut donc avoir par exemple "Hiver + Nuit" et "Ete + Soleil" simultanement.

## Modifications

### 1. `src/components/topMenu/DailyProfileTab.tsx`

**Nouveaux etats locaux** :
- `weatherWinter`: etat meteo du graphe hiver (`'sunny' | 'gray'` + `zeroProductionWinter: boolean`)
- `weatherSummer`: etat meteo du graphe ete (`'sunny' | 'gray'` + `zeroProductionSummer: boolean`)

Initialises depuis `dailyProfileOptions.weather` et `dailyProfileOptions.zeroProduction` actuels.

**Suppression** : retirer le bloc "Meteo / Production" (lignes 340-372) du panneau parametres gauche.

**Calcul** : adapter le useEffect pour que :
- `winterOptions` utilise `weatherWinter` / `zeroProductionWinter`
- `summerOptions` utilise `weatherSummer` / `zeroProductionSummer`

**Props aux graphiques** : passer a chaque `DailyProfileChart` les props de selection meteo pour qu'il affiche les 3 icones dans son en-tete.

### 2. `src/components/DailyProfileChart.tsx`

**Nouvelles props** :
- `weather`: `'sunny' | 'gray'` (meteo actuelle du graphe)
- `zeroProduction`: `boolean` (mode nuit)
- `onWeatherChange`: `(weather: 'sunny' | 'gray', zeroProduction: boolean) => void`

**Affichage** : dans l'en-tete du graphique (a cote du titre), afficher 3 icones cliquables :
- Soleil (Sun) : actif si `weather === 'sunny' && !zeroProduction`
- Gris (Cloud) : actif si `weather === 'gray' && !zeroProduction`
- Nuit (Moon) : actif si `zeroProduction === true`

L'icone active est mise en surbrillance (couleur primaire), les autres sont en gris attenue. Un clic sur une icone appelle `onWeatherChange` avec les valeurs correspondantes.

### 3. Layout visuel

```text
+-------------------------------------------+
| ❄️ Hiver    [☀️] [☁️] [🌙]              |
| [graphique 250px]                         |
+-------------------------------------------+
| ☀️ Été      [☀️] [☁️] [🌙]              |
| [graphique 250px]                         |
+-------------------------------------------+
```

Les icones sont petites (h-4 w-4), alignees a droite du titre, avec un style bouton ghost compact.

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/components/topMenu/DailyProfileTab.tsx` | Etats meteo locaux par saison, suppression bloc meteo global, passage props aux charts, adaptation calcul |
| `src/components/DailyProfileChart.tsx` | Ajout props meteo + 3 icones cliquables dans l'en-tete du graphique |

## Ce qui ne change pas

- Les clusters, VE, foisonnement adaptatif restent globaux (panneau gauche)
- Le calcul electrique sous-jacent ne change pas
- La courbe client et le mode comparaison restent identiques
- Les heures critiques et le foisonnement horaire restent masquables

