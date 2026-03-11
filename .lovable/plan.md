

## Plan: Afficher la tension busbar sur le noeud source

### Problème

Dans `MapView.tsx` ligne 763, le noeud source affiche `tensionCible` (tension consigne, ex: 230V) car le bloc de calcul (ligne 767) est ignoré pour les noeuds source (`!node.isSource`). La tension réelle au busbar (`virtualBusbar.voltage_V`), qui tient compte de l'impédance du transfo et des flux de puissance, n'est pas utilisée.

### Modification — `src/components/MapView.tsx`

Après la ligne 763 (`let nodeVoltage = sourceVoltage;`), ajouter une extraction de la tension busbar calculée pour le noeud source :

```ts
let nodeVoltage = sourceVoltage;

// Pour le noeud source, utiliser la tension busbar calculée si disponible
if (node.isSource) {
  const busbarVoltage = resultsToUse[selectedScenario]?.virtualBusbar?.voltage_V;
  if (busbarVoltage) {
    nodeVoltage = busbarVoltage;
  }
}
```

Cela garantit que le tooltip et l'affichage de tension sur le noeud source reflètent la tension busbar réelle (qui peut monter ou descendre selon charge/production) au lieu de la tension consigne fixe.

### Fichier modifié

| Fichier | Modification |
|---|---|
| `src/components/MapView.tsx` | Utiliser `virtualBusbar.voltage_V` pour `nodeVoltage` du noeud source |

