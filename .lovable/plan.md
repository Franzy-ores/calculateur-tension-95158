

## Résultat de la vérification

### 1. Réseau "Pire cas charge" sans production — OK
Le Run 2 (`rawConsoPure`) utilise bien `zeroProduction: true` et `customDiversityCoeff: continuCoeff` (formule continue). Le profil 24h complet est appliqué au réseau, et l'heure retenue est celle du pic de foisonnement résidentiel. Conforme.

### 2. Profil 24h avec formule continue, production = 0 — OK
Les options de base incluent `adaptiveFoisonnement: false` et `customDiversityCoeff: continuCoeff`, ce qui active la formule continue `K(N, a)`. La production est forcée à zéro via `zeroProduction: true`. Conforme.

### 3. Tension client : 80% de charge, pas de production — Partiellement OK

**Charge à 80%** : Ligne 535 applique `puissanceContractuelle_kVA * 0.80`. Conforme.
**Pas de production** : Le mode `charge` ne soustrait aucune PV. Conforme.

**BUG trouvé — facteur 2 monophasé manquant** : Le calcul du ΔV client dans le Labo (ligne 536) utilise :

```text
ΔV = (R·cosφ + X·sinφ) · I · L
```

Or, pour un client **monophasé**, le courant fait l'aller-retour (phase + neutre), donc la formule correcte est :

```text
ΔV = 2 · (R·cosφ + X·sinφ) · I · L
```

Le fichier `clientDailyProfileCalculator.ts` (ligne 133) applique correctement ce facteur 2. Le Labo ne le fait pas, ce qui **sous-estime la chute de tension** d'un facteur 2 pour tous les clients mono.

Même bug en mode injection (ligne 528) : le facteur 2 est absent pour les clients mono avec PV.

### Correction proposée — `LaboFoisonnementTab.tsx`

Dans la fonction `buildClientPoints`, ajouter le facteur multiplicatif selon le couplage :

```ts
// Ligne ~535 (mode charge)
const facteur = client.couplage === 'MONO' ? 2 : Math.sqrt(3);
const I_charge = (client.puissanceContractuelle_kVA * 0.80 * 1000) / (V_nom * (client.couplage === 'MONO' ? 1 : Math.sqrt(3)));
const deltaV = facteur * (R_per_m * cosPhiCharges + X_per_m * sinPhiCharges) * I_charge * dist_m;

// Ligne ~528 (mode injection)  
const I_pv = (pvKVA * 1000) / (V_nom * (client.couplage === 'MONO' ? 1 : Math.sqrt(3)));
const deltaV_pv = facteur * (R_per_m * cosPhiProd + X_per_m * sinPhiProd) * I_pv * dist_m;
```

Pour les clients **triphasés**, le courant est déjà divisé par `√3` et la chute est multipliée par `√3` (formule classique triphasée), donc il faut aussi ajouter ce `√3` qui manque actuellement.

### Fichier modifié

| Fichier | Modification |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Ajouter facteur 2 (mono) et √3 (tri) dans `buildClientPoints` pour charge et injection |

