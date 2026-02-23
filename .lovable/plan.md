

# Mise a jour des impedances cables existants (corrections GRD)

## Perimetre

Mise a jour des valeurs d'impedance des cables **existants uniquement** dans `src/data/defaultCableTypes.ts`, d'apres le fichier GRD consolide fourni. Aucun ajout de cable. Backup prealable.

## Valeurs a modifier

### Cables souterrains cuivre (CA Cu) — corrections X12, R0, X0

| Cable | Champ | Avant | Apres | Source |
|---|---|---|---|---|
| CA 10 Cu | X12 | 0.160 | 0.0942 | [T1] |
| CA 10 Cu | R0 | 6.060 | 7.320 | [T2] |
| CA 10 Cu | X0 | 0.480 | 0.3768 | [T2] |
| CA 16 Cu | X12 | 0.144 | 0.0895 | [T1] |
| CA 16 Cu | R0 | 3.780 | 4.600 | [T2] |
| CA 16 Cu | X0 | 0.432 | 0.3580 | [T2] |
| CA 25 Cu | X12 | 0.134 | 0.0880 | [T1] |
| CA 25 Cu | R0 | 2.430 | 1.716 | [T2] |
| CA 25 Cu | X0 | 0.402 | 1.1414 | [T2] |
| CA 35 Cu | X12 | 0.127 | 0.0851 | [T1] |
| CA 35 Cu | R0 | 1.740 | 1.420 | [T2] |
| CA 35 Cu | X0 | 0.381 | 0.8527 | [T2] |
| CA 50 Cu | X12 | 0.120 | 0.0848 | [T1] |
| CA 50 Cu | R0 | 1.215 | 1.142 | [T2] |
| CA 50 Cu | X0 | 0.360 | **conserve 0.360** | absent du fichier source |
| CA 50 Cu | maxCurrent_A | 190 | **conserve 190** | absent du fichier source |
| CA 70 Cu | R0 | 0.870 | 0.957 | [RC] |
| CA 70 Cu | X0 | 0.330 | 0.275 | [RC] |
| CA 95 Cu | R0 | 0.630 | 0.693 | [RC] |
| CA 95 Cu | X0 | 0.330 | 0.275 | [RC] |
| CA 120 Cu | X12 | 0.104 | 0.0804 | [T1] |
| CA 120 Cu | R0 | 0.507 | 0.5159 | [T2] |
| CA 120 Cu | X0 | 0.312 | 0.3385 | [T2] |
| CA 150 Cu | R0 | 0.405 | 0.446 | [RC] |
| CA 150 Cu | X0 | 0.300 | 0.250 | [RC] |
| CA 240 Cu | X12 | 0.096 | 0.0801 | [T1] |
| CA 240 Cu | R0 | 0.252 | 0.2657 | [T2] |
| CA 240 Cu | X0 | 0.288 | 0.2900 | [T2] |
| CA 240 Cu | maxCurrent_A | 420 | **conserve 420** | absent du fichier source |

### Cables torsades aluminium aeriens (TR)

| Cable | Champ | Avant | Apres |
|---|---|---|---|
| TR 150 Alu | label | "Tr 150 Alu" | "TR 150 Alu" |

### Cables non modifies

Les cables NU (cuivre aeriens), TR 16-95 Alu, et CA Alu (4G 95 et 4G 150) restent **inchanges** — les valeurs du fichier source correspondent aux valeurs actuelles.

## Actions

### 1. Backup

Creer `src/data/defaultCableTypes.backup.20260223.ts` — copie exacte du fichier actuel.

### 2. Modifications

Appliquer les corrections d'impedance listees ci-dessus dans `src/data/defaultCableTypes.ts` via des edits cibles (pas de reecriture totale).

## Fichiers concernes

| Fichier | Action |
|---|---|
| `src/data/defaultCableTypes.backup.20260223.ts` | Nouveau — backup |
| `src/data/defaultCableTypes.ts` | Modifie — corrections impedances |

