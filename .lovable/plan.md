

# Parametres manuels pour la formule continue + N reseau global

## Constat actuel

- Le coefficient `a` est fixe par cluster depuis `circuitSimulationConfig.json` (A=0.15, B=0.13, C=0.11, D=0.18)
- `N` = nombre de clients residentiels lies **au noeud selectionne** uniquement (lignes 212-221)
- Aucun reglage manuel possible dans l'onglet Labo

## Modifications

### 1. N global reseau (pas par noeud)

Remplacer le calcul de `nResidential` pour compter **tous** les clients residentiels importes dans le projet, pas seulement ceux lies au noeud selectionne :

```text
Avant:  nResidential = clients lies au noeud selectionne
Apres:  nResidentialGlobal = tous les clients residentiels du projet
```

Le `customDiversityCoeff` passe au `DailyProfileCalculator` utilisera ce N global.

### 2. Sliders manuels dans le panneau parametres

Ajouter dans la section "Formule continue" du panneau gauche :

- **Slider `a`** : coefficient asymptotique, range 0.05 — 0.50, pas 0.01, valeur par defaut = valeur du cluster selectionne
- **Slider `N`** : nombre de clients, range 1 — 200, pas 1, valeur par defaut = N global calcule automatiquement
- **Bouton "Reset"** pour revenir aux valeurs auto (cluster + N global)
- Affichage en temps reel du coefficient resultant `f(N) = a + (1-a)/√N = X.XXXX`

Les sliders mettent a jour des `useState` locaux. Quand l'utilisateur modifie, le coefficient continu est recalcule a la volee et les simulations se relancent.

### 3. Impact sur les calculs

Le `continuCoeff` actuellement calcule via `diversityFactor(nResidential, circuitCluster, circuitConfig)` sera remplace par un calcul direct utilisant les valeurs des sliders :

```text
continuCoeff = customA + (1 - customA) / √(customN)
```

Cela affecte automatiquement les graphiques de tension 24h et les graphiques tension-distance car ils dependent de `continuCoeff`.

### Fichier modifie

| Fichier | Modification |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | N global, 2 sliders (a, N), bouton reset, recalcul dynamique |

Aucun autre fichier modifie — la formule est calculee localement dans le composant.

