

# Affichage double diagramme Ete/Hiver dans le profil 24H

## Objectif

Remplacer le selecteur de saison (boutons Ete/Hiver) par deux diagrammes cote a cote : un pour l'hiver, un pour l'ete. Le filtre meteo (Soleil/Gris/Nuit) reste et s'applique aux deux graphiques simultanement. Les heures critiques et le foisonnement horaire sont lies a chaque graphique, avec un bouton de masquage.

## Modifications techniques

### 1. `src/components/topMenu/DailyProfileTab.tsx`

**Calcul double** : au lieu d'un seul `useEffect` de calcul, calculer deux jeux de resultats :
- `resultsWinter` : calcul avec `season: 'winter'`
- `resultsSummer` : calcul avec `season: 'summer'`

Les deux utilisent les memes options (meteo, cluster, VE, foisonnement adaptatif, noeud selectionne).

**Heures critiques doubles** :
- `criticalHoursWinter` et `criticalHoursSummer` calcules independamment

**Interface** :
- Supprimer le bloc selecteur de saison (lignes 319-340)
- Remplacer le graphique unique par deux graphiques empiles verticalement (ou cote a cote en large ecran)
- Chaque graphique a un titre "Hiver" / "Ete" avec un badge
- Ajouter un etat local `showDetails` (boolean, defaut true) avec un bouton oeil pour masquer/afficher les sections heures critiques et foisonnement
- Les heures critiques sont affichees sous chaque graphique (ou groupees)
- Le tableau de foisonnement est duplique (un par saison) ou affiche via un onglet Hiver/Ete

**Bouton de masquage** : un bouton icone (Eye/EyeOff) dans l'en-tete de la zone graphiques qui bascule la visibilite des heures critiques et du tableau de foisonnement.

### 2. `src/components/DailyProfileChart.tsx`

Ajouter une prop optionnelle `title` (string) pour afficher un titre au-dessus du graphique (ex: "Hiver", "Ete"). Reduire la hauteur par defaut de 300px a 250px pour que les deux graphiques tiennent dans l'espace.

### 3. `src/types/dailyProfile.ts`

Aucun changement de type necessaire. Le champ `season` reste dans `DailySimulationOptions` mais il ne sera plus pilote par l'UI directement : il sera utilise en interne pour les deux calculs.

## Layout prevu

```text
+---------------------------+-------------------------------------------+
| Parametres                | Graphique Hiver (250px)                   |
|  - Noeud                  |   [titre: "Hiver ❄️"]                    |
|  - Meteo (soleil/gris)    +-------------------------------------------+
|  - Cluster                | Graphique Ete (250px)                     |
|  - Foisonnement           |   [titre: "Ete ☀️"]                      |
|  - Simulation             +-------------------------------------------+
|  - VE                     | [Eye] Heures critiques Hiver | Ete       |
|  - Profil mesure          +-------------------------------------------+
|  - Courbe raccordement    | [Eye] Foisonnement horaire Hiver | Ete   |
+---------------------------+-------------------------------------------+
```

Le bouton masquage (oeil) permet de cacher/montrer les sections "Heures critiques" et "Foisonnement horaire" pour ne garder que les deux graphiques.

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/components/topMenu/DailyProfileTab.tsx` | Calcul double hiver/ete, suppression selecteur saison, deux graphiques, bouton masquage, heures critiques et foisonnement par saison |
| `src/components/DailyProfileChart.tsx` | Ajout prop `title`, hauteur reduite a 250px |

## Ce qui ne change pas

- Le filtre Meteo (Soleil/Gris/Nuit) reste identique
- Le calcul electrique sous-jacent ne change pas
- La courbe client s'affiche sur les deux graphiques si activee
- Le mode comparaison simulation s'applique aux deux graphiques
- Le foisonnement adaptatif et les clusters restent inchanges

