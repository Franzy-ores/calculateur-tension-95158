

# Mise a jour defaultCableTypes.ts — nouvelles valeurs constructeurs

## Changements identifies

Comparaison entre le fichier actuel et les donnees fournies :

### Cables souterrains cuivre (CA Cu) — corrections majeures

| Cable | Champ | Actuel | Nouveau |
|---|---|---|---|
| CA 10 Cu | R12 | 2.020 | 1.830 |
| CA 10 Cu | X12 | 0.0942 | 0.090 |
| CA 10 Cu | R0 | 7.320 | 5.490 |
| CA 10 Cu | X0 | 0.3768 | 0.270 |
| CA 16 Cu | R12 | 1.260 | 1.150 |
| CA 16 Cu | X12 | 0.0895 | 0.090 |
| CA 16 Cu | R0 | 4.600 | 3.450 |
| CA 16 Cu | X0 | 0.3580 | 0.270 |
| CA 25 Cu | R12 | 0.810 | 0.727 |
| CA 25 Cu | X12 | 0.0880 | 0.090 |
| CA 25 Cu | R0 | 1.716 | 2.181 |
| CA 25 Cu | X0 | 1.1414 | 0.270 |
| CA 35 Cu | R12 | 0.580 | 0.524 |
| CA 35 Cu | X12 | 0.0851 | 0.090 |
| CA 35 Cu | R0 | 1.420 | 1.572 |
| CA 35 Cu | X0 | 0.8527 | 0.270 |
| CA 50 Cu | R12 | 0.405 | 0.387 |
| CA 50 Cu | X12 | 0.0848 | 0.085 |
| CA 50 Cu | R0 | 1.142 | 1.161 |
| CA 50 Cu | X0 | 0.360 | 0.255 |
| CA 70 Cu | R12 | 0.290 | 0.269 |
| CA 70 Cu | X12 | 0.110 | 0.085 |
| CA 70 Cu | R0 | 0.957 | 0.807 |
| CA 70 Cu | X0 | 0.275 | 0.255 |
| CA 95 Cu | R12 | 0.210 | 0.195 |
| CA 95 Cu | X12 | 0.110 | 0.085 |
| CA 95 Cu | R0 | 0.693 | 0.585 |
| CA 95 Cu | X0 | 0.275 | 0.255 |
| CA 120 Cu | R12 | 0.169 | 0.153 |
| CA 120 Cu | X12 | 0.0804 | 0.080 |
| CA 120 Cu | R0 | 0.5159 | 0.459 |
| CA 120 Cu | X0 | 0.3385 | 0.240 |
| CA 150 Cu | R12 | 0.135 | 0.124 |
| CA 150 Cu | X12 | 0.100 | 0.075 |
| CA 150 Cu | R0 | 0.446 | 0.372 |
| CA 150 Cu | X0 | 0.250 | 0.225 |
| CA 240 Cu | R12 | 0.084 | 0.078 |
| CA 240 Cu | X12 | 0.0801 | 0.070 |
| CA 240 Cu | R0 | 0.2657 | 0.234 |
| CA 240 Cu | X0 | 0.2900 | 0.210 |

### Cables TR — revert label

| Cable | Champ | Actuel | Nouveau |
|---|---|---|---|
| TR 150 Alu | label | "TR 150 Alu" | "Tr 150 Alu" (revert) |

### Cables inchanges

NU Cu (10 cables), TR 16-95 Alu (5 cables), CA Alu (2 cables) — valeurs identiques.

### Note importante

Les nouvelles valeurs CA Cu utilisent un modele R0=3xR12, X0=3xX12 (IEC 60909) au lieu des valeurs GRD specifiques [T1]/[T2]/[RC] precedentes. C'est un changement de philosophie de calcul.

## Actions

### 1. Backup

Creer `src/data/defaultCableTypes.backup.20260224.ts` — copie du fichier actuel (post-corrections GRD precedentes).

### 2. Remplacement

Ecrire le contenu fourni par l'utilisateur tel quel dans `src/data/defaultCableTypes.ts`.

## Fichiers concernes

| Fichier | Action |
|---|---|
| `src/data/defaultCableTypes.backup.20260224.ts` | Nouveau — backup date |
| `src/data/defaultCableTypes.ts` | Remplace — nouvelles donnees constructeurs IEC 60909 |

