

# Correction du foisonnement adaptatif et impact des clusters

## Probleme identifie

Dans `dailyProfileCalculator.ts` (lignes 193-228), le cluster `facteurConso` est applique **avant** la formule de Velander :

```text
1. residentialProfile = base * facteurConso    (ex: 21% * 1.2 = 25.2%)
2. + evBonus * facteurVE                       (ex: 5 * 2.0 = 10)
3. = residentialFoisonnementHoraire = 35.2%
4. Velander: plancher = 35.2/100 = 0.352
5. Resultat = (0.352 + 0.648/sqrt(n)) * 100
```

Le probleme : le cluster modifie le **plancher** de la formule Velander. Plus le facteurConso est eleve, plus le plancher monte et plus l'effet de diversite (1-plancher) diminue. Cela cree une incoherence : un cluster Rural avec peu de clients devrait avoir PLUS de diversite, pas moins.

**Impact chiffre** (19h, hiver, n=30 clients) :
- Urbain dense : plancher=0.21, foisonnement=35.4%
- Rural/diffus : plancher=0.252, foisonnement=38.9%
- Ecart reel de seulement 3.5 points alors que facteurConso passe de 1.0 a 1.2 (devrait etre +20%)

La formule Velander "absorbe" une partie du multiplicateur cluster car elle reduit la diversite en meme temps.

## Correction proposee

**Regle** : appliquer le foisonnement Velander sur le profil de **base** (sans cluster), puis multiplier le resultat par les facteurs cluster.

```text
AVANT (incorrect) :
  profile = base * facteurConso + evBonus * facteurVE
  foisonne = Velander(n, profile)

APRES (correct) :
  baseFois = Velander(n, base)
  evFois   = Velander(n, evBonus)     // ou pas de Velander sur EV
  profile  = baseFois * facteurConso + evFois * facteurVE
```

Cela garantit que :
- Le cluster agit comme un **multiplicateur pur** sur le resultat foisonne
- La diversite Velander est calculee sur le profil physique de base (indepedant du cluster)
- Le passage d'un cluster a l'autre donne un ecart proportionnel et coherent

## Ajout d'un editeur de clusters

Actuellement les 4 clusters sont en dur dans `clusterProfiles.ts`. L'utilisateur ne peut pas modifier `facteurConso` ni `facteurVE`. On va ajouter un editeur leger directement dans le panneau Profil 24H.

## Modifications

### 1. `src/utils/dailyProfileCalculator.ts` -- Correction de l'ordre foisonnement/cluster

**Lignes 193-228** : reorganiser le calcul :
1. Calculer `baseResidential` = profil horaire brut (sans cluster)
2. Calculer `evBonus` brut (sans facteurVE)
3. Appliquer Velander sur `baseResidential + evBonus` (profil physique reel)
4. Multiplier le resultat par `facteurConso` (pour la partie residentielle)
5. Multiplier le bonus EV par `facteurVE` separement
6. Resultat final = (baseFoisonne * facteurConso) + (evBonusFoisonne * facteurVE)

Le plancher de Velander reste base sur le profil physique, le cluster ne modifie que l'amplitude finale.

### 2. `src/data/clusterProfiles.ts` -- Rendre les clusters personnalisables

- Ajouter un champ `custom?: boolean` a `ClusterProfile`
- Exporter une fonction `createCustomCluster(base, overrides)` pour creer des variantes
- Garder les 4 clusters par defaut inchanges (valeurs de reference)

### 3. `src/components/topMenu/DailyProfileTab.tsx` -- Editeur de cluster inline

Remplacer la grille de boutons cluster par un selecteur + mini-editeur :
- Selecteur cluster (boutons existants, inchanges)
- Sous le selecteur : 2 sliders editables pour le cluster actif :
  - `facteurConso` : slider 0.5 - 2.0 (pas de 0.1)
  - `facteurVE` : slider 0.0 - 3.0 (pas de 0.1)
- Les valeurs modifiees sont stockees dans `dailyProfileOptions` (pas dans `clusterProfiles` directement)
- Un bouton "Reset" pour revenir aux valeurs par defaut du cluster selectionne
- Affichage en temps reel de l'impact sur le graphe

### 4. `src/types/dailyProfile.ts` -- Etendre DailySimulationOptions

Ajouter dans `DailySimulationOptions` :
```typescript
customFacteurConso?: number;   // Override du facteurConso du cluster
customFacteurVE?: number;      // Override du facteurVE du cluster
```

Si presents, ces valeurs remplacent celles du cluster selectionne.

## Resume technique

| Fichier | Modification |
|---|---|
| `src/utils/dailyProfileCalculator.ts` | Reordonner : Velander sur base brute, puis cluster en multiplicateur |
| `src/data/clusterProfiles.ts` | Ajout `custom` flag et helper |
| `src/types/dailyProfile.ts` | Ajout `customFacteurConso` et `customFacteurVE` dans options |
| `src/components/topMenu/DailyProfileTab.tsx` | Sliders editables sous le selecteur de cluster |

## Ordre d'implementation

1. Types (`dailyProfile.ts`) -- ajout des champs custom
2. Calcul (`dailyProfileCalculator.ts`) -- correction de l'ordre foisonnement/cluster
3. Data (`clusterProfiles.ts`) -- helper pour clusters personnalises
4. UI (`DailyProfileTab.tsx`) -- sliders editables + reset

