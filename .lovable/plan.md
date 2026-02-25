

# Nouvel onglet "Labo Foisonnement" — Test du moteur continu f(N)

## Approche

Creer un onglet temporaire "Labo" dans le menu principal qui utilise le moteur `circuitPowerCalculator.ts` existant (formule continue) et affiche ses resultats en parallele du moteur actuel (paliers terrain). Aucune modification du moteur actif. L'onglet pourra etre supprime une fois la decision prise.

## Ce qui existe deja

Le moteur continu est complet et fonctionnel dans `circuitPowerCalculator.ts` :
- `diversityFactor(N, cluster, config)` → `a + (1-a)/√N`
- `nodeHourlyPower()` → puissance nette 24h avec diversity appliquee sur la somme
- `simulateCircuit24h()` → simulation complete avec flagging surcharge/injection
- Config dans `circuitSimulationConfig.json` (coefficients `a` par cluster A-D)
- Types dans `circuitSimulation.ts`

Il suffit de l'alimenter avec les donnees du projet courant et d'afficher les resultats.

## Implementation

### 1. Nouveau composant `src/components/topMenu/LaboFoisonnementTab.tsx`

Ce composant :
- Lit le projet courant depuis le store (clients, liens, noeuds)
- Construit un `CircuitConfig` a partir des clients lies au noeud selectionne :
  - Mapping cluster : `cluster_1` → `A`, `cluster_2` → `B`, `cluster_3` → `C`, `cluster_4` → `D`
  - Conversion des clients importes en `CircuitClient[]`
- Appelle `simulateCircuit24h()` avec la saison/meteo selectionnee
- Affiche cote a cote :

**Panneau gauche — Resultats moteur continu (nouveau)** :
- Graphique 24h des puissances : P_charge (bleu), P_pv (vert), P_net (rouge)
- Flags surcharge/injection
- Coefficient de diversite affiche : `f(N) = a + (1-a)/√N = X.XX`

**Panneau droit — Comparaison avec paliers** :
- Tableau 24h montrant pour chaque heure :
  - Coefficient palier vs coefficient continu
  - Profil foisonne palier vs continu
  - Delta en %
- Synthese : pic de charge, pic d'injection, nombre d'alertes

**Parametres** (memes que le Profil 24H) :
- Selection du noeud
- Saison (hiver/ete)
- Meteo (soleil/gris)
- Cluster (avec mapping A-D affiche)

### 2. Modifications existantes

**`src/components/TopMenuTabs.tsx`** :
- Ajouter un onglet "Labo" avec icone `FlaskConical` et badge "TEST"
- Couleur distinctive (violet) pour signaler le caractere temporaire
- Import et rendu de `LaboFoisonnementTab`

**`src/components/topMenu/index.ts`** :
- Exporter `LaboFoisonnementTab`

### 3. Fichiers concernes

| Fichier | Action |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | **Nouveau** — onglet complet |
| `src/components/TopMenuTabs.tsx` | Ajouter onglet "Labo" |
| `src/components/topMenu/index.ts` | Exporter le nouveau composant |

### 4. Ce qui ne change PAS

- `dailyProfileCalculator.ts` — moteur actif inchange
- `foisonnementCalculator.ts` — paliers inchanges
- `DailyProfileTab.tsx` — onglet existant inchange
- `circuitPowerCalculator.ts` — utilise tel quel, pas de modification

### Details techniques

Le composant Labo devra adapter les donnees du projet au format `CircuitConfig` :

```text
Pour chaque client lie au noeud selectionne :
  → CircuitClient {
      id: client.id,
      type: mapping(client.clientType),
      puissanceContrat_kW: client.puissanceContractuelle_kVA * cos_phi,
      pvPuissance_kW: client.pvInstalle_kWc (si PV)
    }
```

Le `circuitSimulationConfig.json` est charge directement via import JSON. Les profils horaires proviennent du meme `hourlyProfiles.json` utilise par le moteur actif, convertis au format `SeasonProfiles`.

