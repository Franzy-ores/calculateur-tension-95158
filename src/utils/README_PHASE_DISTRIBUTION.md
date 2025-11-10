# Module de Distribution de Phase (Mode Mixte)

## Vue d'ensemble
Ce module gère la répartition automatique des clients monophasés (MONO) et polyphasés (TRI/TÉTRA) 
sur les trois phases du réseau électrique en mode `mixte_mono_poly`.

## Fonctions principales

### `normalizeClientConnectionType()`
Normalise le couplage brut du fichier Excel en type standardisé (MONO/TRI/TETRA).

**Entrée**: 
- `couplage`: string brut depuis Excel (ex: "TRI", "MONO", "?", etc.)
- `networkVoltage`: système de tension du réseau (230V ou 400V)

**Sortie**: `'MONO' | 'TRI' | 'TETRA'`

**Règles**:
- `"MONO"`, `"?"`, `""`, `undefined` → `'MONO'`
- `"TRI"`, `"TRIPHASÉ"`, `"TRIPHASE"` → `'TRI'`
- `"TÉTRA"`, `"TETRA"`, `"TÉTRAPHASÉ"` → `'TETRA'`
- Valeurs inconnues → `'MONO'` (par défaut)

### `validateAndConvertConnectionType()`
Valide la cohérence entre le type de connexion du client et le réseau.

**Entrée**:
- `connectionType`: type normalisé (`'MONO' | 'TRI' | 'TETRA'`)
- `networkVoltage`: système de tension du réseau
- `clientName`: nom du client (pour les messages)

**Sortie**: 
```typescript
{
  correctedType: ClientConnectionType;
  warning?: string;
}
```

**Règles de conversion**:
- Réseau 230V + client TÉTRA → Converti en TRI (avec avertissement)
- Réseau 400V + client TRI → Converti en TÉTRA (avec avertissement)
- MONO → Toujours valide (compatible sur les deux réseaux)

### `autoAssignPhaseForMonoClient()`
Assigne automatiquement une phase (A, B ou C) à un client MONO en équilibrant la charge totale.

**Algorithme**:
1. Calculer la puissance totale (charge + production) par phase pour les clients existants
2. Calculer la puissance totale du nouveau client
3. Assigner à la phase ayant la **plus faible puissance totale**

**Exemple**:
```
Phase A : 10 kVA (clients existants)
Phase B : 15 kVA
Phase C : 12 kVA
→ Nouveau client MONO (5 kVA) → Phase A
```

### `calculateNodeAutoPhaseDistribution()`
Calcule la distribution complète des charges et productions d'un nœud en séparant MONO et POLY.

**Entrée**:
- `node`: nœud à analyser
- `linkedClients`: clients importés liés au nœud
- `manualPhaseDistribution`: répartition manuelle (%) définie dans le projet

**Sortie**:
```typescript
{
  charges: {
    mono: { A: number; B: number; C: number };  // kVA MONO par phase
    poly: { A: number; B: number; C: number };  // kVA TRI/TÉTRA par phase
    total: { A: number; B: number; C: number }; // Somme
  };
  productions: { ... };  // Même structure
  monoClientsCount: { A: number; B: number; C: number };
  polyClientsCount: number;
  unbalancePercent: number;
}
```

**Logique**:
1. **Clients MONO** : utiliser `assignedPhase` directement
2. **Clients TRI/TÉTRA** : répartir équitablement (33.33% par phase)
3. **Charges manuelles** :
   - Si `node.manualLoadType === 'MONO'` : appliquer `manualPhaseDistribution` (%)
   - Sinon : répartir équitablement (33.33% par phase)
4. **Calcul déséquilibre** : `max(|phase - moyenne| / moyenne * 100)`

### `calculateProjectUnbalance()`
Calcule le déséquilibre global du projet et retourne un statut.

**Sortie**:
```typescript
{
  unbalancePercent: number;
  status: 'normal' | 'warning' | 'critical';
  phaseLoads: { A: number; B: number; C: number };
}
```

**Seuils**:
- **Normal** : < 10%
- **Warning** : 10-20%
- **Critical** : > 20%

## Flux de données

1. **Import Excel** → `parseExcelToClients()` → `couplage` brut conservé
2. **Liaison client** → `normalizeClientConnectionType()` → `connectionType` normalisé
3. **Validation** → `validateAndConvertConnectionType()` → conversion automatique si nécessaire
4. **Si MONO** → `autoAssignPhaseForMonoClient()` → `assignedPhase` assignée
5. **Calcul distribution** → `calculateNodeAutoPhaseDistribution()` → `autoPhaseDistribution` mis à jour
6. **Affichage UI** → Lecture de `autoPhaseDistribution`

## Intégration Store

### Actions principales

**`linkClientToNode(clientId, nodeId)`**:
- Normalise le `couplage` → `connectionType`
- Valide et convertit si nécessaire (TRI↔TÉTRA)
- Assigne phase si MONO
- Met à jour `client.connectionType` et `client.assignedPhase`
- Appelle `updateNodePhaseDistribution(nodeId)`

**`updateNodePhaseDistribution(nodeId)`**:
- Récupère les clients liés au nœud
- Appelle `calculateNodeAutoPhaseDistribution()`
- Met à jour `node.autoPhaseDistribution`

**`unlinkClient(clientId)`**:
- Supprime le lien
- Recalcule la distribution du nœud concerné

## Affichage UI

### PhaseDistributionDisplay
Composant global affichant les statistiques du projet :
- Nombre de clients MONO/TRI/TÉTRA
- Charges totales par phase
- Déséquilibre global avec badge de statut

### EditPanel (Node)
Section "Mode mixte mono/polyphasé" affichant :
- Checkbox "Charges manuelles monophasées"
- Analyse de phase détaillée (lecture seule)
- Nombre de clients MONO par phase
- Déséquilibre du nœud

### ClientsPanel
Affichage du type de connexion et phase assignée :
- Badge `MONO - Phase A/B/C`
- Badge `TRI` ou `TETRA`

## Tests

Fichier : `src/utils/__tests__/phaseDistributionCalculator.test.ts`

**Tests unitaires** :
- Normalisation de tous les couplages possibles
- Assignation de phase avec différentes configurations
- Équilibrage tenant compte des charges et productions

## Notes importantes

### Mode par défaut
Le mode `mixte_mono_poly` est le mode **par défaut** pour les nouveaux projets.

### Compatibilité
Les anciens modes (`polyphase_equilibre`, `monophase_reparti`) continuent de fonctionner sans modification.

### Migration automatique
Les projets sans `loadModel` sont automatiquement migrés vers `polyphase_equilibre` (comportement historique).

### Conversion automatique
Les clients TRI sur réseau 400V sont automatiquement convertis en TÉTRA (et vice versa) avec un message d'avertissement.

### Charges manuelles
Par défaut, les charges manuelles d'un nœud sont considérées comme polyphasées (`POLY`). 
L'utilisateur peut cocher "Charges manuelles monophasées" pour appliquer le déséquilibre manuel.

## Phase 2 (Non implémenté)

**Ce qui reste à faire** :
- Calculs électriques avancés (neutral current pour 400V)
- Intégration dans `electricalCalculations.ts`
- Gestion EQUI8/SRG2 en mode mixte
- Export PDF enrichi
- Clustering géographique avec séparation groupes TRI/TÉTRA
- Tests d'intégration complets
