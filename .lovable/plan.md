

# Audit : Traitement des clients "Bornes VE" sur phases et circuits

## Constat

Le type `bornesVE` n'est traité correctement que dans 2 fichiers (PhaseDistributionDisplay, ParametersTab). Dans **tous les autres fichiers**, les clients importés de type `bornesVE` tombent dans la branche `else` et sont traités comme **résidentiels** — foisonnement incorrect, comptage incorrect, distribution de phase incorrecte.

## Gaps identifiés (13 points)

### A. Moteur de calcul — `electricalCalculations.ts`

| Ligne | Problème |
|-------|----------|
| 698-700 | `S_prel_map` : clients importés bornesVE → foisonnement résidentiel au lieu de `foisonnementBornesVE` |
| 728-730 | Logs DEBUG : même erreur |
| 814-816 | `totalLoads` : même erreur |
| 824 | Charges manuelles bornesVE : foisonnement **hardcodé 50%** au lieu de `foisonnementBornesVE` |

**Fix** : Ajouter `client.clientType === 'bornesVE'` comme 3e branche avec `foisonnementBornesVE`.

### B. Profil journalier — `dailyProfileCalculator.ts`

| Ligne | Problème |
|-------|----------|
| 148 | `countResidentialClients()` : exclut industriel mais **pas** bornesVE → bornesVE compté comme résidentiel |
| 168 | `countResidentialClientsTransitant()` : idem |
| 200 | `calculateWeightedFoisonnement()` : puissance bornesVE ajoutée au résidentiel |

**Fix** : Exclure `bornesVE` du comptage résidentiel. Ajouter une 3e catégorie VE avec son propre poids.

### C. Utilitaires clients — `clientsUtils.ts`

| Ligne | Problème |
|-------|----------|
| 344-348 | `calculatePowersByClientType()` : bornesVE importés comptés en résidentiel |
| 384-394 | `calculateFoisonnedPowers()` : pas de retour `chargesBornesVEFoisonnees` |

**Fix** : Ajouter `chargesBornesVE` dans le retour et appliquer `foisonnementBornesVE`.

### D. Distribution de phases — `phaseDistributionCalculator.ts`

| Ligne | Problème |
|-------|----------|
| 604 | Seul `industriel` est détecté. bornesVE traité comme résidentiel pour la répartition par phase |

**Fix** : Ajouter branche `bornesVE` → distribution POLY équilibrée (1/3 par phase), foisonnement indépendant.

### E. UI — Onglets

| Fichier | Ligne | Problème |
|---------|-------|----------|
| `TensionClientTab.tsx` | 333 | Foisonnement client VE → résidentiel |
| `DailyProfileTab.tsx` | 47 | Comptage VE → résidentiel |
| `PhaseDistributionSliders.tsx` | 265 | Foisonnement curseur → résidentiel |
| `ClientsPanel.tsx` | 406 | Pas d'option filtre "Bornes VE" |

## Corrections à appliquer

### 1. `electricalCalculations.ts` — 3 endroits (lignes 698, 728, 814)
Remplacer le ternaire `industriel ? ind : res` par :
```typescript
const foisonnement = client.clientType === 'bornesVE'
  ? foisBornesVE
  : client.clientType === 'industriel'
    ? foisonnementIndustriel
    : foisonnementResidentiel;
```
Ligne 824 : remplacer `50` par `foisBornesVE`.

### 2. `dailyProfileCalculator.ts` — 3 endroits
Exclure `bornesVE` du comptage résidentiel (`clientType !== 'industriel' && clientType !== 'bornesVE'`). Ajouter `vePower` dans `calculateWeightedFoisonnement`.

### 3. `clientsUtils.ts` — `calculatePowersByClientType` et `calculateFoisonnedPowers`
Ajouter `chargesBornesVE` dans le retour. Accepter `foisonnementBornesVE` en paramètre de `calculateFoisonnedPowers`.

### 4. `phaseDistributionCalculator.ts` — ligne 604
Ajouter `const isVE = client.clientType === 'bornesVE'`. Traiter comme POLY avec foisonnement indépendant.

### 5. `TensionClientTab.tsx` — ligne 333
Ajouter branche bornesVE → `foisonnementBornesVE ?? 50`.

### 6. `DailyProfileTab.tsx` — ligne 47
Ajouter branche bornesVE dans le comptage.

### 7. `PhaseDistributionSliders.tsx` — ligne 265
Ajouter branche bornesVE → foisonnement VE.

### 8. `ClientsPanel.tsx` — ligne 406
Ajouter `<SelectItem value="bornesVE">⚡ VE</SelectItem>`.

## Fichiers modifiés (8)

1. `src/utils/electricalCalculations.ts`
2. `src/utils/dailyProfileCalculator.ts`
3. `src/utils/clientsUtils.ts`
4. `src/utils/phaseDistributionCalculator.ts`
5. `src/components/topMenu/TensionClientTab.tsx`
6. `src/components/topMenu/DailyProfileTab.tsx`
7. `src/components/PhaseDistributionSliders.tsx`
8. `src/components/ClientsPanel.tsx`

