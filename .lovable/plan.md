

## Plan: Calculer la tension client en mode injection (PV)

### Problème
Actuellement, `buildClientPoints` applique toujours une chute de tension basée sur la consommation (`nodeV - deltaV`). Pour le scénario "Vmax injection", si le client a de la production PV, le courant circule du client vers le réseau, ce qui **augmente** la tension au point de livraison (`clientV = nodeV + deltaV_pv`).

### Correction dans `LaboFoisonnementTab.tsx` — fonction `buildClientPoints`

Ajouter un paramètre `mode: 'charge' | 'injection'` à `buildClientPoints` :

- **Mode `'charge'`** (minBranches — pire cas charge) :
  - Consommation à 100% de la puissance contractuelle, PV = 0
  - `deltaV = (R·cosφ + X·sinφ) · I_charge · L` (positif → chute)
  - `clientV = nodeV - deltaV`

- **Mode `'injection'`** (maxBranches — pire cas injection) :
  - Consommation = 0, PV à 100% de `puissancePV_kVA`
  - `deltaV_pv = (R·cosφ_pv + X·sinφ_pv) · I_pv · L` (positif → hausse)
  - `clientV = nodeV + deltaV_pv`
  - Si le client n'a pas de PV (`puissancePV_kVA === 0`), afficher la tension du noeud directement (pas de delta)
  - `cosφ_pv` = cos phi productions du projet (typiquement 1.0)

Appeler :
```ts
minClientPoints: buildClientPoints(voltageDistanceData.minBranches, 'charge'),
maxClientPoints: buildClientPoints(voltageDistanceData.maxBranches, 'injection'),
```

### Ajustement couleur EN50160 pour injection
Pour le mode injection, la non-conformité est une **surtension** : rouge si > 253V (110%), orange si > 241.5V (105%).

### Fichier modifié
- `src/components/topMenu/LaboFoisonnementTab.tsx` — ~15 lignes modifiées dans `buildClientPoints`

