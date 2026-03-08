

## Plan: Tension client par phase au lieu de la moyenne

### Problème
Actuellement, `buildClientPoints` utilise `bp.voltage` (tension moyenne) pour calculer la tension au point de livraison du client. Sur un réseau déséquilibré, un client MONO sur la phase la plus chargée peut dépasser la norme alors que la moyenne reste conforme — le dépassement est masqué.

### Solution
Utiliser la tension de la phase spécifique du client (`voltage_A`, `voltage_B`, `voltage_C`) au lieu de la moyenne.

### Modification — `src/components/topMenu/LaboFoisonnementTab.tsx`, fonction `buildClientPoints`

**1. Déterminer la phase du client**

Pour chaque client, résoudre sa phase à partir de `phaseCoupling` et `assignedPhase` :
- Réseau 400V étoile : `phaseCoupling` = `'A'|'B'|'C'` → phase directe
- Réseau 230V triangle : `phaseCoupling` = `'A-B'|'B-C'|'A-C'` → prendre la phase la plus basse (pire cas charge) ou la plus haute (pire cas injection), ou la moyenne des deux phases
- Fallback sur `assignedPhase`, puis `'A'` par défaut
- Clients TRI/TETRA : garder la moyenne (`bp.voltage`)

**2. Sélectionner la tension nodale correspondante**

```ts
// Résoudre la tension du nœud selon la phase du client
function getNodeVoltageForClient(bp, client, voltageSystem) {
  if (client.couplage === 'TRI' || client.couplage === 'TETRA') {
    return bp.voltage; // moyenne pour poly
  }
  const coupling = client.phaseCoupling || client.assignedPhase;
  if (voltageSystem === 'TRIPHASÉ_230V') {
    // Triangle : tension phase-phase, prendre min des 2 phases (charge) ou max (injection)
    // Pour simplifier : utiliser la map coupling → voltages
    const phaseMap = { 'A-B': [bp.voltage_A, bp.voltage_B], 'B-C': [bp.voltage_B, bp.voltage_C], 'A-C': [bp.voltage_A, bp.voltage_C] };
    const pair = phaseMap[coupling];
    if (pair) return mode === 'charge' ? Math.min(...pair) : Math.max(...pair);
  }
  // 400V étoile : phase simple
  const singleMap = { A: bp.voltage_A, B: bp.voltage_B, C: bp.voltage_C };
  return singleMap[coupling] || bp.voltage;
}
```

**3. Remplacer `const nodeV = bp.voltage || 230`**

Par :
```ts
const nodeV = getNodeVoltageForClient(bp, client, currentProject.voltageSystem) || 230;
```

**4. Enrichir le point client avec la phase**

Ajouter `phase: coupling` au point pour l'afficher dans le tooltip.

**5. Tooltip enrichi**

Ajouter l'indication de la phase utilisée dans le tooltip du dialog plein écran (ex: "Phase: L1" ou "Couplage: L1-L2").

### Interface `ClientPoint`
Ajouter un champ optionnel `phase?: string`.

### Fichier modifié
- `src/components/topMenu/LaboFoisonnementTab.tsx` — ~20 lignes modifiées/ajoutées

