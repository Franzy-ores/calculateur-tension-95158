

# Plan: Relancer simulation après changement tension source, déséquilibre ou foisonnement

## Problème

Dans `updateAllCalculations()` (ligne 1756), la condition pour relancer `runSimulation()` vérifie uniquement `simulationMode` (panneau ouvert). Si le panneau est fermé mais la simulation est active (`isSimulationActive`), les changements de tension source, curseurs de déséquilibre, ou paramètres de foisonnement ne relancent pas la simulation.

De plus, `cableReplacement` n'est pas vérifié dans les équipements actifs.

## Correction

**Fichier:** `src/store/networkStore.ts`, lignes 1755-1764

Remplacer :
```typescript
const { simulationMode, simulationEquipment } = get();
const hasActiveEquipment = simulationMode && (
  (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
  simulationEquipment.neutralCompensators.some(c => c.enabled)
);
```

Par :
```typescript
const { simulationMode, isSimulationActive, simulationEquipment } = get();
const hasActiveEquipment = (simulationMode || isSimulationActive) && (
  (simulationEquipment.srg2Devices?.some(s => s.enabled) || false) ||
  simulationEquipment.neutralCompensators.some(c => c.enabled) ||
  (simulationEquipment.cableReplacement?.enabled || false)
);
```

## Couverture des déclencheurs

`updateAllCalculations()` est déjà appelé par tous les setters pertinents — la seule correction nécessaire est cette condition. Voici les déclencheurs qui passent par `updateAllCalculations()` et bénéficieront du fix :

- **Tension source** (slider busbar) → `setSourceVoltage` → `updateAllCalculations`
- **Curseurs déséquilibre** → `setManualPhaseDistribution` → `updateAllCalculations`
- **Foisonnement** (coefficient diversité, nombre clients) → `updateAllCalculations`
- **Cos φ, puissances clients** → `updateAllCalculations`

Aucun changement supplémentaire requis pour le foisonnement car il transite déjà par la même fonction.

## Impact
- Un seul fichier modifié, une seule condition corrigée
- Aucune régression : le comportement existant (panneau ouvert) reste identique
- Tous les paramètres réseau relancent désormais la simulation si active

