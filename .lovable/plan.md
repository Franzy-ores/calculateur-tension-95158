

# Plan : Vue thermique globale du circuit dans le profil 24h

## Objectif

Remplacer l'affichage d'un seul cable amont par une vision globale du circuit : pour chaque heure, montrer un resume thermique de l'ensemble des cables du reseau (temperature min/max/moyenne, nombre de cables surchauffes, pertes totales estimees).

## Donnees deja disponibles

Le moteur de calcul retourne deja `result.cableTemperatures` : un tableau contenant la temperature estimee de CHAQUE cable du circuit a chaque heure. Actuellement, seul le `max` est extrait (ligne 969 de `dailyProfileCalculator.ts`).

## Modifications

### 1. Enrichir `HourlyVoltageResult` (src/types/dailyProfile.ts)

Ajouter des champs pour la synthese thermique globale :

```
// Synthese thermique circuit complet
circuitThermal?: {
  minTemp_C: number;          // Temperature cable le plus froid
  maxTemp_C: number;          // Temperature cable le plus chaud
  avgTemp_C: number;          // Temperature moyenne de tous les cables
  hotCablesCount: number;     // Nombre de cables au-dessus de 50 deg C
  totalCables: number;        // Nombre total de cables
  hottestCableId: string;     // ID du cable le plus chaud
  hottestCableName?: string;  // Nom lisible du cable le plus chaud
};
```

### 2. Extraire les donnees dans `dailyProfileCalculator.ts`

Dans `extractNodeVoltages` (ligne 968), au lieu de ne garder que le max, construire la synthese complete :

- Parcourir `result.cableTemperatures` pour calculer min, max, moyenne
- Compter les cables au-dessus de 50 deg C (seuil d'attention)
- Identifier le cable le plus chaud et retrouver son nom depuis `project.cables`
- Conserver `maxCableTemp_C` pour compatibilite

### 3. Enrichir le tooltip dans `DailyProfileChart.tsx`

Ajouter une section "Circuit thermique" dans le `CustomTooltip` :

```
--- Circuit thermique ---
Temp. cables : 28.3 a 47.2 deg C (moy: 35.1)
Cable le + chaud : TRC-04 (47.2 deg C)
Cables en surcharge : 0 / 12
```

Cette section apparait sous les donnees de tension existantes, uniquement si `circuitThermal` est present.

Code couleur dans le tooltip :
- Vert : maxTemp inferieure a 50 deg C
- Orange : maxTemp entre 50 et 65 deg C
- Rouge : maxTemp superieure a 65 deg C

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/types/dailyProfile.ts` | Ajout interface `circuitThermal` dans `HourlyVoltageResult` |
| `src/utils/dailyProfileCalculator.ts` | Construction de la synthese thermique dans `extractNodeVoltages` |
| `src/components/DailyProfileChart.tsx` | Section tooltip "Circuit thermique" avec code couleur |

## Avantages de cette approche

- Vision globale plutot que locale : l'utilisateur voit l'etat thermique de tout le reseau
- Impact de la saison visible : en ete les temperatures ambiantes montent, donc les cables chauffent plus
- Impact de la charge visible : aux heures de pointe (18h-20h), les temperatures cables sont plus elevees
- Pas de courbe supplementaire : l'information reste dans le tooltip, lisible et non intrusive
- Le cable le plus chaud est identifie par son nom, ce qui permet de localiser le point faible du reseau

