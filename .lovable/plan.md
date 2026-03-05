

# Graphique Tension vs Distance depuis la source — Onglet Labo

## Objectif

Ajouter deux graphiques dans l'onglet Labo montrant la tension moyenne de chaque noeud en fonction de la distance cumulee depuis la source :
- **Graphique 1** : Heure de tension la plus basse de la journee (pire cas prelevement)
- **Graphique 2** : Heure de tension la plus haute de la journee (pire cas injection PV)

Chaque derivation (branche) du reseau est tracee comme une ligne separee partant du noeud de bifurcation.

## Donnees disponibles

Le `CalculationResult` contient deja `nodeMetricsPerPhase` avec les tensions par phase pour **tous** les noeuds du reseau. Le `DailyProfileCalculator` retourne un `HourlyVoltageResult` par heure, mais uniquement pour le noeud selectionne.

**Probleme** : `extractNodeVoltages` ne renvoie que le noeud selectionne. Pour le graphique tension-distance, il faut les tensions de **tous** les noeuds a chaque heure.

**Solution** : Executer `ElectricalCalculator.calculateScenarioWithHTConfig()` directement dans le Labo pour les 24 heures (comme le fait deja `DailyProfileCalculator`), puis extraire les tensions de tous les noeuds depuis `nodeMetricsPerPhase` de chaque `CalculationResult`. On identifie ensuite l'heure du min global et l'heure du max global.

## Algorithme pour les chemins avec derivations

```text
1. Trouver le noeud source (isSource=true)
2. Construire l'arbre du reseau par BFS depuis la source
3. Pour chaque noeud, calculer la distance cumulee = somme des cable.length_m sur le chemin source→noeud
4. Identifier les "branches" = chemins lineaires source→feuille
   - Au noeud de bifurcation (>1 enfant), creer une branche par enfant
5. Chaque branche = serie de points (distance_m, voltage_V) avec tous les noeuds intermediaires
```

Exemple pour un reseau en Y :
```text
Source ──100m── N1 ──150m── N2 ──200m── N3
                              └──80m── N4

Branche 1: Source(0m) → N1(100m) → N2(250m) → N3(450m)
Branche 2: Source(0m) → N1(100m) → N2(250m) → N4(330m)
```

## Implementation

### Modification de `LaboFoisonnementTab.tsx`

1. **Nouvelle fonction utilitaire** `buildNetworkPaths(nodes, cables)` :
   - BFS depuis la source
   - Retourne une liste de `BranchPath[]` avec `{ branchId, label, points: { nodeId, nodeName, distance_m }[] }`

2. **Nouvelle fonction** `compute24hAllNodeVoltages(project, options, continuCoeff)` :
   - Pour chaque heure 0-23, execute le calcul electrique (palier et continu)
   - Extrait `nodeMetricsPerPhase` de chaque resultat
   - Retourne `Map<nodeId, { minVoltage, minHour, maxVoltage, maxHour }>` pour les deux modes

3. **Deux graphiques Recharts** `LineChart` :
   - X : distance en metres depuis la source
   - Y : tension en V
   - Une `<Line>` par branche (couleurs distinctes)
   - Chaque branche a un label (ex: "Circuit N2→N3", "Dérivation N2→N4")
   - Seuils ±5% et ±10% en reference lines
   - Deux series par branche : trait plein = palier, pointille = continu

4. **Badge** indiquant l'heure correspondante (ex: "Vmin @ 19h", "Vmax @ 13h")

### Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Ajout BFS paths + calcul 24h all-nodes + 2 graphiques tension-distance |

Aucun autre fichier modifie. Le calcul electrique existant est reutilise tel quel via `ElectricalCalculator`.

### Performance

24 heures × 2 modes (palier + continu) = 48 appels au moteur electrique. C'est plus lourd que le calcul actuel (2 appels). Pour eviter un gel de l'UI :
- Calcul lance via `useMemo` avec dependances sur le projet et les options
- Bouton "Calculer" explicite plutot qu'auto-calcul

