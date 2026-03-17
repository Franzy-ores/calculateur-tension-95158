

## Plan : Corriger le bug `nodeConnType` dans `calculateVirtualBusbar`

**Fichier unique** : `src/utils/electricalCalculations.ts`

### Problème
Ligne 473 : `nodeConnType` utilise toujours `source.connectionType` pour tous les nœuds, au lieu du type de connexion réel de chaque nœud. En réseau mixte (source 400V étoile, clients mono), tous les nœuds sont traités comme la source.

### Modification 1 — Ajouter `nodes` en paramètre (ligne 387-401)

Ajouter un paramètre `nodes: Node[]` à la signature de `calculateVirtualBusbar`, après `cableIndexByPair`.

### Modification 2 — Utiliser le vrai `connectionType` par nœud (ligne 473)

Remplacer :
```ts
const nodeConnType: ConnectionType = source.connectionType;
```
Par :
```ts
const nodeConnType: ConnectionType = nodes.find(n => n.id === nid)?.connectionType
  ?? source.connectionType;
```

### Modification 3 — Mettre à jour l'appel (ligne 2235-2249)

Passer `nodes` dans l'appel existant, entre `cableIndexByPair` et `I_source_net_phases`.

### Aucune autre modification
Le bloc TRI_230V_3F ligne-à-ligne (lignes 475-498) est déjà correct et reste inchangé.

