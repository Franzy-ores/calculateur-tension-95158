

# Retirer le facteur PV des clusters de circuits

## Pourquoi

Le PV installe sur les toitures est une donnee physique connue (puissance declaree par client). Contrairement a la consommation et aux VE qui varient selon la typologie du quartier, la production PV suit toujours la meme courbe solaire. Le cluster ne doit donc pas modifier le profil PV.

## Modifications

### 1. `src/data/clusterProfiles.ts`

- Retirer le champ `facteurPV` de l'interface `ClusterProfile`
- Retirer `facteurPV` des 4 definitions de cluster
- Mettre a jour le commentaire d'en-tete

### 2. `src/utils/dailyProfileCalculator.ts`

- Retirer la lecture de `facteurPV` du cluster (ligne 184)
- Retirer `* facteurPV` dans le calcul de `productionsFoisonnement` (ligne 237)

### 3. `src/utils/clientDailyProfileCalculator.ts`

- Retirer la lecture de `facteurPV` (ligne 60)
- Retirer `* facteurPV` dans le calcul de `productionProfile` (ligne 93)

### 4. `src/components/topMenu/DailyProfileTab.tsx`

- Retirer l'affichage `PV x{cluster.facteurPV}` dans le libelle des boutons cluster (ligne 394)
- Ne garder que `VE x{cluster.facteurVE}`

## Ce qui ne change pas

- La courbe PV reste pilotee par le profil horaire JSON + le facteur meteo (sunny/gray)
- Les facteurs `facteurConso` et `facteurVE` restent actifs dans les clusters
- Le calcul statique principal n'est pas impacte

