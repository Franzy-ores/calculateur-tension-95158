

## Plan: Désactiver clusters et foisonnement adaptatif dans le Profil 24H

### Contexte
L'onglet **Profil 24H** (`DailyProfileTab.tsx`) utilise actuellement les clusters (facteurConso, facteurVE) et le foisonnement adaptatif (Velander) pour moduler les courbes. Le profil P90 étant déjà calibré sur la mesure réelle, ces corrections ne doivent plus s'appliquer aux courbes du Profil 24H. Le Labo Foisonnement conserve sa propre logique avec K(N, cluster).

### Modifications

**1. `src/utils/dailyProfileCalculator.ts`**
- Forcer `facteurConso = 1.0` et `facteurVE = 1.0` (ignorer le cluster sélectionné et les overrides custom).
- Forcer le foisonnement adaptatif à `false` : le profil horaire brut est utilisé directement sans modulation par le nombre de clients.
- Le résultat : `charge_effective(h) = profil_P90(h) × P_contractuelle`, sans aucune correction cluster ni Velander.

**2. `src/components/topMenu/DailyProfileTab.tsx`**
- Supprimer ou masquer la section UI "Cluster de circuit" (sélection des 4 clusters + éditeur de facteurs).
- Supprimer ou masquer le switch "Foisonnement adaptatif" et son texte explicatif.
- Nettoyer les références au cluster dans le `CalculationInfoDialog`.

### Ce qui reste inchangé
- **Labo Foisonnement** : conserve K(N, cluster) et ses contrôles.
- **Bonus VE** : le toggle VE et ses sliders (soirée/nuit) restent actifs mais sans multiplicateur cluster (`facteurVE = 1.0`).
- **Profils industriels et PV** : inchangés.

