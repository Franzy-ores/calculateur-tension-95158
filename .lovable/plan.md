

## Plan: Afficher la tension busbar dynamique dans les graphes Tension vs Distance du Labo

### Diagnostic

Les 3 graphes Tension vs Distance (pire cas charge, pire cas injection, profil horaire) affichent une **ligne de référence statique à 230V**. Or, la tension réelle au busbar (jeu de barres BT du transfo) varie selon la charge/production à chaque heure. Cette tension est déjà calculée par le moteur (`rawContinu[hour].virtualBusbar.voltage_V`) mais n'est pas exploitée dans l'affichage.

Le nœud source à distance=0 affiche déjà correctement la tension busbar (le moteur calcule `V_source_bus = Vslack - Ztr × I_source`), donc les courbes sont justes. C'est la **ligne de référence 230V** qui est trompeuse car elle ne reflète pas la tension réelle au busbar.

### Modifications — `src/components/topMenu/LaboFoisonnementTab.tsx`

**1. Graphe "Pire cas charge" (minBranches)**
- Extraire `rawConsoPure[minHour].virtualBusbar?.voltage_V` dans `voltageDistanceData`
- Remplacer `ReferenceLine y={230}` par `y={busbarVoltageCharge}` avec label "Busbar: XXX.XV"
- Ajouter le busbar voltage dans le badge du titre

**2. Graphe "Pire cas injection" (maxBranches)**
- Extraire `rawProdPure[maxHour].virtualBusbar?.voltage_V`
- Même traitement : ReferenceLine dynamique + badge

**3. Graphe "Profil horaire" (clockHour)**
- Extraire `rawContinu[clockHour].virtualBusbar?.voltage_V`
- ReferenceLine dynamique à la tension busbar de l'heure sélectionnée
- Badge avec tension busbar

**4. Graphe "Tension 24h" (voltage24hData)**
- Ajouter une courbe `V_busbar` montrant la tension busbar heure par heure (extraite de `rawContinu[h].virtualBusbar?.voltage_V`)
- Ligne trait-point distincte (ex: magenta ou orange)

### Détail des modifications dans `voltageDistanceData` useMemo

```ts
// Ajouter aux données retournées :
return {
  minHour, maxHour, minV, maxV,
  minBranches, maxBranches,
  busbarVoltageCharge: rawConsoPure[globalMinHour]?.virtualBusbar?.voltage_V ?? 230,
  busbarVoltageInjection: rawProdPure[globalMaxHour]?.virtualBusbar?.voltage_V ?? 230,
};
```

### Détail pour le graphe horaire (clockHour)

```ts
const busbarVoltageHourly = rawContinu[clockHour]?.virtualBusbar?.voltage_V ?? 230;
// Remplacer <ReferenceLine y={230} .../> par :
<ReferenceLine yAxisId="left" y={busbarVoltageHourly} 
  stroke="hsl(280, 70%, 50%)" strokeDasharray="6 3" strokeWidth={1.5}
  label={{ value: `Busbar ${busbarVoltageHourly.toFixed(1)}V`, fontSize: 9 }} />
```

### Détail pour le graphe Tension 24h

```ts
const voltage24hData = voltageContinu.map((h, i) => ({
  ...existingFields,
  V_busbar: +(rawContinu[i]?.virtualBusbar?.voltage_V ?? 230).toFixed(2),
}));
// Ajouter une Line :
<Line dataKey="V_busbar" name="Busbar" stroke="hsl(280, 70%, 50%)" 
  strokeWidth={2} dot={false} strokeDasharray="6 3" />
```

### Fichier modifié

| Fichier | Action |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Tension busbar dynamique dans les 4 graphes tensions |

