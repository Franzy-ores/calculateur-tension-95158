
# Plan : Mise à jour de la base de données des câbles

## Résumé

Je vais créer une copie de sauvegarde du fichier actuel puis mettre à jour la base de données avec les 30 câbles de votre fichier Excel.

## Étapes d'implémentation

### Étape 1 : Créer une copie de sauvegarde

Créer le fichier `src/data/defaultCableTypes.backup.ts` contenant une copie exacte du fichier actuel pour référence future.

### Étape 2 : Mettre à jour le fichier principal

Remplacer le contenu de `src/data/defaultCableTypes.ts` avec :

**Câbles NU (Cuivre Nu Aérien) - 10 types**

| ID | Label | R (Ohm/km) | X (Ohm/km) | I max (A) |
|----|-------|------------|------------|-----------|
| nu-7cu | NU 7 Cu | 2.550 | 0.300 | 64 |
| nu-10cu | NU 10 Cu | 1.790 | 0.300 | 88 |
| nu-12.5cu | NU 12.5 Cu | 1.490 | 0.300 | 98 |
| nu-16cu | NU 16 Cu | 1.120 | 0.300 | 119 |
| nu-20cu | NU 20 Cu | 0.900 | 0.300 | 137 |
| nu-25cu | NU 25 Cu | 0.720 | 0.300 | 157 |
| nu-28cu | NU 28 Cu | 0.640 | 0.300 | 169 |
| nu-35cu | NU 35 Cu | 0.510 | 0.300 | 194 |
| nu-50cu | NU 50 Cu | 0.360 | 0.300 | 235 |
| nu-70cu | NU 70 Cu | 0.260 | 0.300 | 299 |

**Câbles TR (Torsadé Aluminium Aérien) - 5 types**

| ID | Label | R (Ohm/km) | X (Ohm/km) | I max (A) |
|----|-------|------------|------------|-----------|
| tr-16al | TR 16 Alu | 1.900 | 0.100 | 71 |
| tr-25al | TR 25 Alu | 1.240 | 0.100 | 93 |
| tr-35al | TR 35 Alu | 0.870 | 0.100 | 116 |
| tr-70al | TR 70 Alu | 0.450 | 0.100 | 177 |
| tr-95al | TR 95 Alu | 0.330 | 0.100 | 230 |

**Câbles CA Cuivre (Souterrain) - 10 types**

| ID | Label | R (Ohm/km) | X (Ohm/km) | I max (A) |
|----|-------|------------|------------|-----------|
| ca-10cu | CA 10 Cu | 2.020 | 0.160 | 73 |
| ca-16cu | CA 16 Cu | 1.260 | 0.144 | 95 |
| ca-25cu | CA 25 Cu | 0.810 | 0.134 | 130 |
| ca-35cu | CA 35 Cu | 0.580 | 0.127 | 160 |
| ca-50cu | CA 50 Cu | 0.405 | 0.120 | 190 |
| ca-70cu | CA 70 Cu | 0.290 | 0.110 | 235 |
| ca-95cu | CA 95 Cu | 0.210 | 0.110 | 280 |
| ca-120cu | CA 120 Cu | 0.169 | 0.104 | 320 |
| ca-150cu | CA 150 Cu | 0.135 | 0.100 | 355 |
| ca-240cu | CA 240 Cu | 0.084 | 0.096 | 420 |

**Câbles CA Aluminium (Souterrain) - 5 types**

| ID | Label | R (Ohm/km) | X (Ohm/km) | I max (A) |
|----|-------|------------|------------|-----------|
| ca-50al | CA 50 Alu | 0.688 | 0.120 | 145 |
| ca-95al | CA 95 Alu | 0.363 | 0.107 | 210 |
| ca-150al | CA 150 Alu | 0.229 | 0.100 | 270 |
| ca-185al | CA 185 Alu | 0.186 | 0.098 | 310 |
| ca-240al | CA 240 Alu | 0.143 | 0.096 | 355 |

**Câbles conservés (existants)**

- BAXB 70, 95, 150 (torsadé aluminium spécifique)
- EAXeCWB 4x150 (souterrain aluminium)

### Détails techniques

**Calcul des impédances homopolaires (R0, X0)**

Pour tous les câbles, j'appliquerai la règle standard :
- R0 = 3 x R12
- X0 = 3 x X12

**Organisation du fichier**

Le fichier sera structuré en sections commentées :
1. Câbles nus cuivre aériens (NU)
2. Câbles torsadés aluminium aériens (TR)
3. Câbles souterrains cuivre (CA Cu)
4. Câbles souterrains aluminium (CA Alu)
5. Câbles BAXB (conservés)
6. Câble EAXeCWB (conservé)

## Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `src/data/defaultCableTypes.backup.ts` | Nouveau - copie de sauvegarde |
| `src/data/defaultCableTypes.ts` | Modifié - 30 nouveaux câbles + 4 conservés |

## Résultat attendu

- Les calculs de tension utiliseront les mêmes valeurs R et X que votre fichier Excel
- La différence de 3V sera corrigée grâce aux valeurs X réalistes (0.300 au lieu de 0.08)
- 34 types de câbles disponibles au total
