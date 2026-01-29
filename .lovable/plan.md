
# Audit : Différence entre Client TRI 100 kVA lié vs Charge Manuelle 100 kVA

## Problème signalé

Sur un nœud à 207V attendu :
- **Charge manuelle TRI 100 kVA** → Tension cohérente (207V)
- **Client TRI résidentiel 100 kVA créé manuellement et lié** → Tension incorrecte (219V)

---

## Cause identifiée : Double comptage

Le client lié est compté **DEUX FOIS** dans le calcul :

1. **Première fois** : Dans `S_prel_map` (lignes 607-611) via `getLinkedClientsForNode()`
2. **Deuxième fois** : Dans `autoPhaseDistribution.foisonneAvecCurseurs` via `calculateNodeAutoPhaseDistribution()`

Le calcul BFS utilise ces **deux sources de données** qui se chevauchent :

```
S_prel_map × distribution_ratio → S_phase_kVA
```

Or `S_prel_map` contient **déjà** la puissance foisonnée des clients liés.
Et `distribution_ratio` est calculé à partir de `foisonneAvecCurseurs` qui **refait** le calcul de foisonnement.

---

## Analyse technique détaillée

### Flux de calcul actuel (lignes 595-640 et 881-970)

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 1 : Calcul de S_prel_map (ligne 607-620)                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Pour chaque nœud :                                                  │
│    - linkedClients = getLinkedClientsForNode(...)                    │
│    - S_prel += client.puissanceContractuelle × (foisonnement/100)   │
│    - S_prel += manualCharges × (foisonnementResidentiel/100)        │
│                                                                      │
│  → S_prel = 100 × 0.15 = 15 kVA (client TRI résidentiel)            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 2 : Distribution par phase (lignes 900-904)                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  pA_charges = foisonneAvecCurseurs.A / total                        │
│  pB_charges = foisonneAvecCurseurs.B / total                        │
│  pC_charges = foisonneAvecCurseurs.C / total                        │
│                                                                      │
│  → pA = pB = pC = 33.33%                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 3 : Calcul puissance par phase (lignes 966-968)                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  S_A_charges_kVA = S_prel_map × pA_charges                          │
│                  = 15 × 0.333 = 5 kVA  ✅ Correct                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Vérification de cohérence avec charge manuelle

```text
┌──────────────────────────────────────────────────────────────────────┐
│ CAS : Charge manuelle 100 kVA TRI                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  S_prel = manualCharges × (foisonnementResidentiel/100)             │
│         = 100 × 0.15 = 15 kVA                                       │
│                                                                      │
│  Distribution 33.33% par phase → 5 kVA par phase                    │
│  → Résultat identique au client importé                             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Où est le problème ?

Le flux semble cohérent. Vérifions si le problème vient de :

1. **L'absence de lien** : Le client créé manuellement n'est peut-être pas **lié** au nœud
2. **L'absence de `autoPhaseDistribution`** : Le nœud n'a peut-être pas été recalculé après liaison
3. **Fallback incorrect** : Si `autoPhaseDistribution` est absent, le code utilise un autre chemin

### Vérification du fallback (lignes 915-935)

```typescript
} else {
  // Fallback : utiliser les valeurs physiques totales
  const totalCharges = n.autoPhaseDistribution.charges.total.A + ...
  
  if (totalCharges > 0.001) {
    pA_charges = n.autoPhaseDistribution.charges.total.A / totalCharges;
    ...
  }
}
```

Si `foisonneAvecCurseurs` n'existe pas (nœud non recalculé), le code utilise `charges.total` qui contient les valeurs **brutes non foisonnées** !

---

## Diagnostic probable

Le client TRI créé manuellement est :

1. **Ajouté à `clientsImportes`** via `addClientManual` (ligne 1127-1151)
2. **Lié au nœud** via `linkClientToNode` (ligne 1203+)
3. **Mais `autoPhaseDistribution` n'est pas recalculé** car la condition `loadModel === 'mixte_mono_poly'` peut ne pas être vérifiée, ou le calcul de distribution ne met pas à jour `foisonneAvecCurseurs`

### Si `foisonneAvecCurseurs` est manquant :

```text
S_prel_map = 15 kVA (correct, avec foisonnement)

MAIS le code utilise alors charges.total :
  - charges.total.A = 100/3 = 33.33 kVA (brut, SANS foisonnement)
  
Ratio pA = 33.33 / 100 = 0.333 → OK les ratios sont corrects

S_A_charges = S_prel × pA = 15 × 0.333 = 5 kVA → OK
```

### Si `autoPhaseDistribution` est complètement absent :

Le code passe au fallback `manualPhaseDistribution` (ligne 939-946) qui utilise les curseurs globaux.

---

## Hypothèse principale

Le problème vient probablement du fait que :

1. `addClientManual` **ne déclenche pas** `updateNodePhaseDistribution` car le client n'est pas encore lié
2. Mais `linkClientToNode` **ne met pas à jour `foisonneAvecCurseurs`** correctement pour les clients TRI

Vérifions `calculateNodeAutoPhaseDistribution` pour les clients TRI résidentiels :

Dans `phaseDistributionCalculator.ts` (lignes 570-622), le foisonnement différencié est appliqué aux `linkedClients`. Si le client vient d'être créé et lié, son `clientType` peut être `undefined` au lieu de `'résidentiel'`.

### Ligne 572 :
```typescript
const isIndustriel = client.clientType === 'industriel';
```

Si `clientType` est `undefined`, `isIndustriel` est `false`, donc le client est traité comme résidentiel. OK.

### Problème potentiel : Double foisonnement

Dans `electricalCalculations.ts` (ligne 611) :
```typescript
S_prel += client.puissanceContractuelle_kVA * (foisonnement / 100);  // = 15 kVA
```

Dans `phaseDistributionCalculator.ts` (lignes 647-655) :
```typescript
const totalFoisonneChargeA = 
  chargesResidentiellesParPhase.A * (foisonnementChargesResidentiel / 100);
```

Si `chargesResidentiellesParPhase.A` contient déjà la puissance brute (100/3 = 33.33 kVA), alors le foisonnement est appliqué correctement ici.

**Le problème n'est pas un double foisonnement.**

---

## Vérification : Le client est-il vraiment lié ?

Quand `addClientManual` est appelé, le client est ajouté à `clientsImportes` **mais pas lié** au nœud.

L'utilisateur doit ensuite **manuellement lier** le client au nœud via `linkClientToNode`.

**Question critique** : L'utilisateur a-t-il bien lié le client au nœud après l'avoir créé ?

Si le client **n'est pas lié** :
- `getLinkedClientsForNode()` ne le trouve pas
- `S_prel` = 0 pour ce nœud
- La tension reste à 230V (source) au lieu de chuter

Mais l'utilisateur observe 219V, donc il y a une charge, mais plus faible qu'attendu.

---

## Hypothèse révisée : Problème de type `connectionType`

Dans `addClientManual` (ligne 1141) :
```typescript
connectionType: clientData.connectionType,
```

Mais dans `linkClientToNode` pour le mode mixte (ligne 1228) :
```typescript
const rawConnectionType = normalizeClientConnectionType(
  client.couplage,   // ← utilise couplage, pas connectionType
  currentProject.voltageSystem
);
```

Si `client.couplage = "TRI"` (défini ligne 1139 comme `connectionType`), la normalisation retourne `"TRI"`.

Ensuite (ligne 1234-1238) :
```typescript
const { correctedType, warning } = validateAndConvertConnectionType(
  rawConnectionType,  // "TRI"
  currentProject.voltageSystem,  // ex: "TÉTRAPHASÉ_400V"
  client.nomCircuit
);
```

Pour un réseau 400V avec un client TRI, `validateAndConvertConnectionType` retourne :
```typescript
correctedType: 'TETRA',  // Converti !
warning: "⚠️ Client "XXX" (TRI) converti en TÉTRA pour réseau 400V"
```

Le client est donc traité comme **TETRA** au lieu de **TRI**.

Mais cela ne devrait pas affecter le calcul de puissance (les deux sont 33.33% par phase).

---

## Test recommandé

Afficher dans la console les valeurs suivantes :

1. `S_prel_map.get(nodeId)` - Puissance totale foisonnée au nœud
2. `node.autoPhaseDistribution?.charges.foisonneAvecCurseurs` - Répartition foisonnée
3. `linkedClients.length` - Nombre de clients liés au nœud
4. `client.clientType` - Type du client créé manuellement

---

## Correctifs à implémenter

### 1. Ajouter des logs de diagnostic

Ajouter des logs dans `calculateScenario` pour tracer la source des différences.

### 2. Vérifier la cohérence `S_prel_map` vs `foisonneAvecCurseurs`

Le total de `S_prel_map` devrait être égal au total de `foisonneAvecCurseurs` pour chaque nœud.

### 3. Forcer le recalcul de `autoPhaseDistribution` après `addClientManual`

Si le client est créé et immédiatement lié (même action UI), s'assurer que `updateNodePhaseDistribution` est appelé.

---

## Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `src/store/networkStore.ts` | `addClientManual`, `linkClientToNode` |
| `src/utils/electricalCalculations.ts` | Calcul de `S_prel_map` et distribution BFS |
| `src/utils/phaseDistributionCalculator.ts` | Calcul de `autoPhaseDistribution` |

---

## Prochaine étape recommandée

Ajouter des **logs de diagnostic détaillés** dans `calculateScenario` pour comparer :

1. La puissance issue de `S_prel_map` (clients liés + charges manuelles)
2. La puissance issue de `autoPhaseDistribution.foisonneAvecCurseurs`
3. Identifier si le client créé manuellement est bien compté dans les deux

Cela permettra de confirmer l'hypothèse exacte avant de corriger le code.
