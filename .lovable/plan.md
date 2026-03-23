

# Afficher la ventilation clients importés / charges manuelles dans les totaux Circuit et Cabine

## Problème

Les blocs "Circuit - Charges F." et "Cabine - Charges F." affichent un total unique sans indiquer la part venant des **clients importés** vs des **charges manuelles sur nœuds**. L'utilisateur ne peut pas comprendre la composition du total.

## Correction

**Fichier** : `src/components/topMenu/ParametersTab.tsx`

### 1. Calculer la ventilation (après ligne 34)

Séparer les deux sources dans les calculs existants :

```
// Circuit
chargesImportees = clients importés liés aux nœuds connectés (déjà dans chargesResidentielles + chargesIndustrielles des clients importés)
chargesManuelles = node.clients.reduce(sum S_kVA) pour les nœuds connectés
productionsImportees = clients importés liés (puissancePV_kVA)
productionsManuelles = node.productions.reduce(sum S_kVA)
```

Appliquer les foisonnements respectifs pour obtenir les valeurs foisonnées.

### 2. Afficher sous les totaux (lignes 218-244)

Sous chaque total (Circuit et Cabine), ajouter une ligne de détail en `text-[9px]` :

```
Circuit - Charges F.
106.5 kVA
  ↳ Clients: 82.2 | Nœuds: 24.3

Circuit - Prod. F.
91.0 kVA
  ↳ Clients: 70.9 | Nœuds: 20.1
```

Même format pour le bloc Cabine.

### 3. Détail technique

- Charges manuelles circuit = `connectedNodesData.reduce((sum, n) => sum + n.clients.reduce(...), 0)` × foisonnementResidentiel/100
- Charges importées circuit = `chargesResidentiellesFoisonnees + chargesIndustriellesFoisonnees - chargesManuellesFoisonnees`
- Productions manuelles circuit = `connectedNodesData.reduce((sum, n) => sum + n.productions.reduce(...), 0)` × foisonnementProductions/100
- Productions importées circuit = `productionsFoisonnees - productionsManuellesFoisonnees`

Pour Cabine : les charges manuelles ne sont PAS incluses (Cabine = tous clients importés, liés et non liés). Afficher uniquement "Clients importés uniquement" en sous-texte.

## Fichier modifié

- `src/components/topMenu/ParametersTab.tsx`

