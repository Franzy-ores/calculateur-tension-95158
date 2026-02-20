

# Clusters de circuits et foisonnement adaptatif dans le profil 24H

## Contexte

Ces deux fonctionnalites s'appliquent **uniquement au module profil journalier 24H**. Le foisonnement manuel (curseurs dans l'onglet Parametres) reste inchange et continue de piloter le calcul statique principal.

## 1. Les 4 clusters de circuits

Chaque cluster definit des modificateurs appliques aux profils horaires du JSON (`hourlyProfiles.json`). Le profil de base "residential" reste la reference.

| Cluster | Nom | Conso | PV | VE | Description |
|---|---|---|---|---|---|
| 1 | Urbain dense | x1.0 | x0.3 | x0.5 | Centre-ville, peu de toitures, peu de VE |
| 2 | Urbain residentiel | x1.0 | x0.7 | x1.0 | Pavillonnaire, PV moyen, VE standard |
| 3 | Peri-urbain | x1.1 | x1.2 | x1.5 | Maisons individuelles, PV en croissance, plus de VE |
| 4 | Rural / diffus | x1.2 | x1.5 | x2.0 | Grandes parcelles, fort PV, forte VE |

Application dans le calcul horaire :

```text
residentialProfile_effectif = residentialProfile * cluster.facteurConso
productionProfile_effectif  = pvProfile * cluster.facteurPV
evBonus_effectif            = evBonus * cluster.facteurVE
```

## 2. Foisonnement adaptatif (profil 24H uniquement)

Dans le profil 24H, le foisonnement horaire issu du JSON est module par le nombre de clients connectes au reseau. Formule type Velander :

```text
facteur(n) = plancher + (1 - plancher) / sqrt(n)
```

Ou `plancher` = valeur minimale du profil horaire normalisee (converge vers le profil JSON pour n grand).

| Clients | Facteur (plancher 0.15) |
|---|---|
| 1 | 100% |
| 5 | 53% |
| 10 | 42% |
| 50 | 27% |
| 100 | 24% |

Concretement : le profil horaire du JSON (ex: 21% a 19h en hiver) est multiplie par ce facteur adaptatif. Avec 5 clients, 21% devient ~11%. Avec 100 clients, 21% reste ~5%.

**Important** : cela ne touche PAS les curseurs de foisonnement manuel du calcul statique.

## Modifications techniques

### Nouveau fichier : `src/data/clusterProfiles.ts`

Definition des 4 clusters avec leurs facteurs :

```typescript
export interface ClusterProfile {
  id: string;
  name: string;
  description: string;
  facteurConso: number;
  facteurPV: number;
  facteurVE: number;
}

export const clusterProfiles: ClusterProfile[] = [
  { id: 'cluster_1', name: 'Urbain dense', description: 'Centre-ville, peu de PV/VE', facteurConso: 1.0, facteurPV: 0.3, facteurVE: 0.5 },
  { id: 'cluster_2', name: 'Urbain résidentiel', description: 'Pavillonnaire standard', facteurConso: 1.0, facteurPV: 0.7, facteurVE: 1.0 },
  { id: 'cluster_3', name: 'Péri-urbain', description: 'PV en croissance, plus de VE', facteurConso: 1.1, facteurPV: 1.2, facteurVE: 1.5 },
  { id: 'cluster_4', name: 'Rural / diffus', description: 'Fort PV, forte VE', facteurConso: 1.2, facteurPV: 1.5, facteurVE: 2.0 },
];
```

### Nouveau fichier : `src/utils/foisonnementCalculator.ts`

Fonction pure pour le foisonnement adaptatif, utilisee uniquement par le profil 24H :

```typescript
export function calculateAdaptiveFoisonnement(nClients: number, baseProfile: number): number {
  if (nClients <= 0) return 0;
  if (nClients === 1) return baseProfile; // pas de diversite possible
  const plancher = baseProfile / 100;
  return (plancher + (1 - plancher) / Math.sqrt(nClients)) * 100;
}
```

### Type `DailySimulationOptions` (`src/types/dailyProfile.ts`)

Ajouter :

```typescript
selectedClusterId?: string;  // 'cluster_1' .. 'cluster_4', defaut 'cluster_2'
adaptiveFoisonnement?: boolean; // activer le foisonnement adaptatif, defaut true
```

### Calcul journalier (`src/utils/dailyProfileCalculator.ts`)

Dans `calculateHourlyVoltage` (lignes 166-215), appliquer les deux mecanismes :

1. **Cluster** : multiplier `residentialProfile`, `pvProfile` et `evBonus` par les facteurs du cluster selectionne
2. **Foisonnement adaptatif** : compter les clients residentiels lies au reseau, puis appliquer `calculateAdaptiveFoisonnement(nResidentiels, profileApresCluster)` pour obtenir le foisonnement effectif

L'ordre est : profil JSON -> modificateur cluster -> foisonnement adaptatif -> valeur injectee dans le projet horaire.

### Calcul client (`src/utils/clientDailyProfileCalculator.ts`)

Appliquer le cluster au profil de base utilise pour le calcul de la courbe client (meme logique : `baseFoisonnement * cluster.facteurConso`).

### Interface (`src/components/topMenu/DailyProfileTab.tsx`)

Ajouter dans les parametres de simulation (entre Saison et Meteo) :

- **Selecteur de cluster** : 4 boutons avec nom + icone
- **Toggle foisonnement adaptatif** : switch on/off avec affichage du nombre de clients detectes et du facteur applique

### Store (`src/store/networkStore.ts`)

Ajouter `selectedClusterId` et `adaptiveFoisonnement` dans `dailyProfileOptions` avec valeurs par defaut.

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/data/clusterProfiles.ts` | Nouveau : definition des 4 clusters |
| `src/utils/foisonnementCalculator.ts` | Nouveau : fonction foisonnement adaptatif |
| `src/types/dailyProfile.ts` | Ajout `selectedClusterId` et `adaptiveFoisonnement` sur `DailySimulationOptions` |
| `src/utils/dailyProfileCalculator.ts` | Application cluster + foisonnement adaptatif dans `calculateHourlyVoltage` |
| `src/utils/clientDailyProfileCalculator.ts` | Application cluster dans le calcul client |
| `src/components/topMenu/DailyProfileTab.tsx` | Selecteur cluster + toggle adaptatif |
| `src/store/networkStore.ts` | Persistance des nouvelles options |

## Ce qui ne change PAS

- Les curseurs de foisonnement manuel (onglet Parametres)
- Le calcul statique principal (`electricalCalculations.ts`)
- Les profils JSON de base (`hourlyProfiles.json`)
- La logique de repartition de phases
- Les clients industriels (leur profil reste independant des clusters)

