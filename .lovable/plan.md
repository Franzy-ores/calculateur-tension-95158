

## Audit: SRG2/EQUI8 invisibles sur les graphiques Tension vs Distance

### Cause racine

Les graphiques Tension vs Distance utilisent uniquement les Runs 2 et 3 (enveloppes), qui ont été explicitement configurés avec `isSimulationActive = false` pour éviter la divergence BFS. Le Run 1 (complet, avec simulation) alimente les courbes 24h mais **jamais** les graphiques de distance. Par conséquent, l'effet du SRG2 et de l'EQUI8 n'apparaît nulle part sur ces graphiques.

### Solution proposée

Ajouter deux runs supplémentaires (Runs 4 et 5) qui calculent les mêmes scénarios d'enveloppe **avec** simulation active, et superposer les résultats en courbes pointillées sur les mêmes graphiques.

### Détail technique

**1. Deux runs supplémentaires dans le `useMemo` principal (lignes 233-292)**

```ts
// Run 4: Conso pure AVEC simulation (si active)
let rawConsoSim: CalculationResult[] = [];
let rawProdSim: CalculationResult[] = [];

if (isSimulationActive) {
  const calcConsoSim = new DailyProfileCalculator(
    currentProject,
    { ...baseOptions, zeroProduction: true },
    profilesData, simulationEquipment, true
  );
  calcConsoSim.calculateDailyVoltages();
  rawConsoSim = calcConsoSim.getLastRawResults();

  // Run 5: Prod pure AVEC simulation
  const calcProdSim = new DailyProfileCalculator(
    currentProject,
    { ...baseOptions, zeroConsumption: true },
    profilesData, simulationEquipment, true
  );
  calcProdSim.calculateDailyVoltages();
  rawProdSim = calcProdSim.getLastRawResults();
}
```

Retourner `rawConsoSim` et `rawProdSim` dans l'objet du useMemo.

**2. Enrichir `voltageDistanceData` avec les branches simulées**

Ajouter dans le `voltageDistanceData` useMemo :
```ts
minBranchesSim: rawConsoSim.length > 0
  ? buildBranchData(rawConsoSim, globalMinHour) : null,
maxBranchesSim: rawProdSim.length > 0
  ? buildBranchData(rawProdSim, globalMaxHour) : null,
```

**3. Superposer les courbes simulées sur les graphiques Recharts**

Pour chaque graphique (charge et injection), si `minBranchesSim` / `maxBranchesSim` existe, ajouter des `<Line>` supplémentaires en pointillés (`strokeDasharray="5 3"`) avec une couleur distincte (ex: violet pour SRG2) montrant la tension avec régulation.

Légende enrichie : "Sans régulation" (trait plein) vs "Avec SRG2/EQUI8" (pointillé).

**4. Points clients simulés**

Ajouter des `clientPoints` calculés sur les branches simulées pour montrer la tension client après régulation.

**5. Guard de sécurité**

Les Runs 4/5 utilisent le même clamp [1V, 350V] du BFS. Si une valeur sort de cette plage, ne pas tracer la courbe simulée et afficher un badge d'avertissement "Simulation divergente".

### Fichier modifié
- `src/components/topMenu/LaboFoisonnementTab.tsx`

### Impact performance
2 runs BFS supplémentaires uniquement si `isSimulationActive === true`. Total passe de 3 à 5 runs, mais toujours derrière le bouton "Calculer".

