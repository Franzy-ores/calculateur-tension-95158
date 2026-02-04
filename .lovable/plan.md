

# Plan : Correction du tableau Récapitulatif par Couplage

## Clarification métier

| Règle | Description |
|-------|-------------|
| **MONO = Résidentiel uniquement** | Les clients monophasés sont toujours résidentiels |
| **Industriel = TRI/TÉTRA uniquement** | Les clients industriels sont obligatoirement polyphasés |
| **Tag clientType fait loi** | Le foisonnement dépend du tag résidentiel/industriel, pas du couplage |

## Corrections à apporter

### 1. Supprimer les lignes TRI et TÉTRA du tableau

**Lignes 734-775** : Ces lignes affichent des données redondantes car les charges TRI/TÉTRA sont déjà réparties dans les colonnes "Ch. Poly 33.3%" des lignes L1/L2/L3.

### 2. Corriger le foisonnement POLY (bug ligne 229)

```typescript
// AVANT (ligne 229) - incorrect
const chargePolyFoisonne = chargePoly * (foisonnementChargesIndustriel / 100); // Poly = industriel

// APRÈS - correct : utiliser le tag clientType des clients TRI/TÉTRA
const chargePolyFoisonne = 
  chargePolyResidentiel * (foisonnementChargesResidentiel / 100) +
  chargePolyIndustriel * (foisonnementChargesIndustriel / 100);
```

### 3. Simplifier les colonnes MONO industriel

Puisque les clients MONO sont toujours résidentiels :
- Supprimer la colonne "Nb Ind." pour les lignes MONO (ou laisser à 0)
- Supprimer la colonne "Ch. Ind. (kVA)" pour les lignes MONO (ou afficher "-")
- Renommer "Ch. Rés." en "Ch. MONO" (implicitement résidentiel)

### 4. Enrichir le résumé foisonnement avec détail MONO/POLY

Nouveau format proposé :

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 📊 FOISONNEMENT PAR TYPE ET COUPLAGE                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│  🏠 Résidentiel (15%)                                                           │
│     MONO: 45 clients, 180 kVA → 27.0 kVA foisonné                              │
│     TRI/TÉTRA: 3 clients, 36 kVA → 5.4 kVA foisonné                            │
│     Total: 48 clients, 216 kVA → 32.4 kVA                                      │
│                                                                                 │
│  🏭 Industriel (70%)                                                            │
│     TRI/TÉTRA: 5 clients, 150 kVA → 105.0 kVA foisonné                         │
│                                                                                 │
│  Total foisonné: 137.4 kVA                                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Fichier à modifier

**`src/components/PhaseDistributionDisplay.tsx`**

| Section | Lignes | Modification |
|---------|--------|--------------|
| `calculatePhaseData()` | 139-269 | Séparer `chargePolyResidentiel` et `chargePolyIndustriel` pour le foisonnement |
| `calculateGlobalFoisonne()` | 271-330 | Ajouter compteurs MONO/POLY par type résidentiel |
| Ligne TRI | 734-753 | Supprimer |
| Ligne TÉTRA | 756-775 | Supprimer |
| Résumé foisonnement | 625-651 | Enrichir avec détail MONO vs TRI/TÉTRA par type |
| Colonnes tableau | 668-682 | Simplifier : retirer colonnes Ind. pour MONO, garder pour POLY |

## Détail technique

### Modification de `calculatePhaseData()` (lignes 139-269)

Ajouter la distinction résidentiel/industriel pour les clients POLY :

```typescript
// Variables additionnelles à tracker
let chargePolyResidentiel = 0;
let chargePolyIndustriel = 0;

// Dans la boucle clients POLY
if (client.connectionType === 'TRI' || client.connectionType === 'TETRA') {
  const chargeParPhase = client.puissanceContractuelle_kVA / 3;
  if (client.clientType === 'industriel') {
    chargePolyIndustriel += chargeParPhase;
  } else {
    chargePolyResidentiel += chargeParPhase;
  }
}

// Foisonnement POLY corrigé
const chargePolyFoisonne = 
  chargePolyResidentiel * (foisonnementChargesResidentiel / 100) +
  chargePolyIndustriel * (foisonnementChargesIndustriel / 100);
```

### Modification de `calculateGlobalFoisonne()` (lignes 271-330)

Ajouter les compteurs pour le résumé enrichi :

```typescript
interface GlobalFoisonneResult {
  // Existants
  totalFoisonneChargeGlobal: number;
  totalFoisonneProductionGlobal: number;
  // Nouveaux
  monoResidentiel: { nbClients: number; charge: number; foisonne: number };
  polyResidentiel: { nbClients: number; charge: number; foisonne: number };
  polyIndustriel: { nbClients: number; charge: number; foisonne: number };
}
```

### Tableau simplifié

| Couplage | Nb MONO | Ch. MONO | Ch. Poly Rés. | Ch. Poly Ind. | Prod. | Ch. contrat | Ch. foisonné | Ch. déséq. | Courant |
|----------|---------|----------|---------------|---------------|-------|-------------|--------------|------------|---------|
| L1-L2    | 15      | 60.0     | 12.0          | 35.0          | 5.0   | 107.0       | 35.5         | 36.2 (+2%) | 8.5     |
| L2-L3    | 12      | 48.0     | 12.0          | 35.0          | 3.0   | 95.0        | 33.1         | 33.8 (-1%) | 7.2     |
| L3-L1    | 18      | 72.0     | 12.0          | 35.0          | 8.0   | 119.0       | 38.9         | 37.5 (+5%) | 9.1     |

## Bénéfices

| Avant | Après |
|-------|-------|
| Lignes TRI/TÉTRA redondantes | Supprimées (info dans colonnes POLY) |
| Foisonnement POLY toujours industriel | Foisonnement selon tag clientType |
| Résumé sans détail MONO/POLY | Détail complet par type et couplage |
| Colonnes Ind. pour MONO (toujours 0) | Colonnes simplifiées |

