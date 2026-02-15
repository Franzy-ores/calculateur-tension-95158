
# Plan : Modele thermique saisonnier des cables

## Objectif

Implementer une correction thermique de la resistance des cables en fonction de la saison (hiver/ete) et du type de pose (aerien/souterrain). Cette correction impacte le calcul de chute de tension de maniere realiste : tensions plus basses en ete (resistance augmente), plus hautes en hiver.

## Principe physique

```text
1. Temperature ambiante selon saison et pose :
   ┌─────────────┬─────────┬─────────┐
   │ Pose        │ Hiver   │ Ete     │
   ├─────────────┼─────────┼─────────┤
   │ Aerien      │  5 °C   │ 28 °C   │
   │ Souterrain  │ 12 °C   │ 20 °C   │
   └─────────────┴─────────┴─────────┘

2. Temperature du cable :
   T = T_ambient + k * (I / Imax)^2
   k = 40°C (aerien), 35°C (souterrain)

3. Correction de R :
   R(T) = R20 * (1 + alpha * (T - 20))
   alpha = 0.00393 (Cuivre), 0.00403 (Aluminium)
   X non corrige.
```

## Architecture de la solution

### 1. Nouveau fichier : `src/utils/thermalModel.ts`

Module utilitaire pur contenant :
- `getAmbientTemperature(season, pose)` : retourne T_ambient
- `calculateCableTemperature(T_ambient, I_A, Imax_A, pose)` : retourne T cable
- `correctResistance(R20, T_cable, matiere)` : retourne R(T)
- `getThermalCorrectionFactor(season, pose, matiere, I_A, Imax_A)` : fonction tout-en-un retournant le coefficient multiplicateur de R

### 2. Type projet : `src/types/network.ts`

Ajouter un champ optionnel a `Project` :
```
season?: 'winter' | 'summer';
```
Valeur par defaut : `'winter'` (comportement conservateur).

### 3. Moteur de calcul : `src/utils/electricalCalculations.ts`

Modifier la methode `selectRX` (ligne 268) pour accepter un contexte thermique optionnel :
- Recevoir `season`, `pose` (du cable), `matiere` (du cableType), `I_A` et `Imax_A`
- Appliquer `correctResistance` sur R12 et R0 **avant** le calcul GRD `(R0 + 2*R12) / 3`
- X reste inchange

Le BFS principal (ligne 804-820) sera modifie pour :
1. Passer `season` et `pose` du cable a `selectRX`
2. Utiliser une estimation initiale du courant (iteration precedente ou S_aval/V) pour le terme `(I/Imax)^2`
3. Lors de la premiere iteration BFS, utiliser I=0 (pas de surcharge), ce qui donne T = T_ambient seul. Les iterations suivantes raffinent naturellement.

Meme correction pour le calcul du neutre (ligne 1476-1479).

### 4. Profil journalier : `src/utils/dailyProfileCalculator.ts`

Le `DailyProfileCalculator` utilise deja `this.options.season` ('winter'/'summer'). Cette valeur sera propagee au `Project` copie pour chaque heure :
```
projectWithHourlyFoisonnement.season = this.options.season;
```
Ainsi, le moteur de calcul utilise automatiquement la bonne saison pour chaque pas horaire.

### 5. UI Parametres : `src/components/topMenu/ParametersTab.tsx`

Ajouter un selecteur "Saison" (Hiver / Ete) dans la barre de parametres, a cote du scenario. Ce selecteur :
- Met a jour `project.season` via `updateProjectConfig({ season })`
- Declenche `updateAllCalculations()`
- Affiche une icone Snowflake (hiver) ou Sun (ete)

### 6. Store : `src/store/networkStore.ts`

- Passer `currentProject.season` lors de l'appel a `calculateScenarioWithHTConfig` (aucun changement de signature necessaire car la saison est lue depuis le `Project`)
- Valeur par defaut `'winter'` dans `updateAllCalculations` si non definie

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/utils/thermalModel.ts` | **Nouveau** - module de calcul thermique |
| `src/types/network.ts` | Ajout champ `season?: 'winter' \| 'summer'` a `Project` |
| `src/utils/electricalCalculations.ts` | Correction thermique dans `selectRX` et `calculateGRDImpedance`, lecture de `project.season` dans `calculateScenario` |
| `src/utils/dailyProfileCalculator.ts` | Propagation de `options.season` au projet pour chaque heure |
| `src/components/topMenu/ParametersTab.tsx` | Selecteur Saison (Hiver/Ete) |
| `src/store/networkStore.ts` | Initialisation `season: 'winter'` par defaut |

## Impact sur les resultats

- **Hiver** : T_ambient basse -> R(T) < R20 -> chute de tension plus faible -> tensions plus hautes
- **Ete** : T_ambient haute -> R(T) > R20 -> chute de tension plus forte -> tensions plus basses
- **Surcharge** : Le terme `(I/Imax)^2` amplifie l'echauffement et donc la resistance, modelisant l'effet de surcharge
- **Courbe 24h** : Le choix de saison dans l'onglet profil journalier (deja existant) pilotera automatiquement la correction thermique heure par heure

## Points d'attention

- Le courant `I` n'est connu qu'apres le BFS. La correction thermique sera donc appliquee avec le courant de l'iteration precedente (convergence naturelle du BFS iteratif existant)
- `maxCurrent_A` n'est pas toujours defini dans `CableType`. En l'absence de cette valeur, le terme de surcharge `(I/Imax)^2` sera ignore (T = T_ambient uniquement)
- Les cables de branchement (`branchementCableTypes.ts`) ont deja `maxCurrent_A` et `R_ohm_per_km` - la correction s'appliquera aussi au calcul de tension client si pertinent
