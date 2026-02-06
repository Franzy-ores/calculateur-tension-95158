

# Plan : Correction de la mise à jour du tableau et des curseurs + Ajout ligne Total

## Problèmes identifiés

### Problème 1 : Curseurs de déséquilibre ne se mettent pas à jour automatiquement

**Cause racine** : Le `useEffect` dans `PhaseDistributionSliders.tsx` a une dépendance circulaire problématique.

```typescript
// Ligne 64 : currentProject?.manualPhaseDistribution est dans les dépendances
// Ligne 51-56 : Le useEffect met à jour manualPhaseDistribution
// → Cela crée une boucle mais avec le threshold de 0.5, ça devrait fonctionner
```

**Vrai problème** : La ligne 24-27 saute l'exécution lors du premier montage via `isInitialMount.current`, mais **ne se réinitialise jamais** quand les clients changent réellement. Le `useEffect` compare les nouvelles valeurs calculées aux anciennes, mais si `manualPhaseDistribution` n'a jamais été initialisé, la comparaison échoue.

**Solution** : 
1. Retirer `currentProject?.manualPhaseDistribution` des dépendances (éviter la boucle)
2. Utiliser uniquement les données clients comme déclencheur
3. Ajouter un hash/signature des clients liés pour détecter les vrais changements

### Problème 2 : Tableau ne se met pas à jour pour clients industriel/poly

**Cause racine** : Le composant `PhaseDistributionDisplay` utilise `useNetworkStore()` pour accéder à `currentProject`. Quand un client est lié, le store est mis à jour mais le composant ne semble pas se re-rendre.

Après analyse, le composant devrait se re-rendre automatiquement car :
- `linkClientToNode` appelle `set({...})` qui notifie Zustand
- Zustand déclenche un re-render des composants abonnés

**Hypothèse de cause** : L'accordéon est fermé, donc l'utilisateur ne voit pas la mise à jour, OU il y a un problème de memoization quelque part.

**Solution** : Vérifier et forcer le re-calcul après liaison d'un client en utilisant une clé unique basée sur le nombre de clients liés.

### Problème 3 : Ajout d'une section TOTAL au tableau

**Demande** : Ajouter une ligne "TOTAL" qui agrège les données des 3 couplages avec les mêmes sous-colonnes.

---

## Modifications techniques

### 1. Fichier `src/components/PhaseDistributionSliders.tsx`

#### Correction du useEffect (lignes 22-68)

```typescript
useEffect(() => {
  // Skip initial mount to avoid overwriting loaded project values
  if (isInitialMount.current) {
    isInitialMount.current = false;
    return;
  }
  
  // Guard: skip if project not ready
  if (!currentProject || !currentProject.manualPhaseDistribution) {
    return;
  }
  
  const isForced = type === 'charges' 
    ? currentProject.manualPhaseDistribution?.chargesForced 
    : currentProject.manualPhaseDistribution?.productionsForced;
  
  // Only auto-sync if not forced and in mixte mode
  if (isForced || currentProject.loadModel !== 'mixte_mono_poly') {
    return;
  }
  
  const autoValues = calculateAutoDistributionInternal(currentProject, type);
  const distribution = currentProject.manualPhaseDistribution[type];
  
  // Only update if values differ significantly (avoid infinite loops)
  const threshold = 0.5;
  if (Math.abs(autoValues.A - distribution.A) > threshold ||
      Math.abs(autoValues.B - distribution.B) > threshold ||
      Math.abs(autoValues.C - distribution.C) > threshold) {
    updateProjectConfig({
      manualPhaseDistribution: {
        ...currentProject.manualPhaseDistribution,
        [type]: autoValues
      }
    });
  }
}, [
  // CORRECTION: Retirer manualPhaseDistribution des dépendances (boucle circulaire)
  // Utiliser uniquement les données sources
  currentProject?.clientsImportes, 
  currentProject?.clientLinks,
  currentProject?.foisonnementChargesResidentiel,
  currentProject?.foisonnementChargesIndustriel,
  currentProject?.foisonnementProductions,
  currentProject?.loadModel,
  type,
  updateProjectConfig,
  currentProject  // Ajouter currentProject pour détecter tout changement
]);
```

**Note importante** : Le vrai problème est que `currentProject?.manualPhaseDistribution` dans les dépendances empêche le cycle de fonctionner correctement. En le retirant et en gardant `currentProject` comme dépendance globale, l'effet se déclenchera quand les clients sont liés.

### 2. Fichier `src/components/PhaseDistributionDisplay.tsx`

#### Ajout de la ligne TOTAL dans `renderTable()` (après ligne 400)

```typescript
// Calcul des totaux globaux pour la ligne TOTAL
const calculateTotals = () => {
  let totalNbMono = 0, totalChargeMono = 0, totalProdMono = 0;
  let totalChargeMonoFois = 0, totalProdMonoFois = 0;
  let totalNbPolyRes = 0, totalChargePolyRes = 0, totalProdPolyRes = 0;
  let totalChargePolyResFois = 0, totalProdPolyResFois = 0;
  let totalNbPolyInd = 0, totalChargePolyInd = 0, totalProdPolyInd = 0;
  let totalChargePolyIndFois = 0, totalProdPolyIndFois = 0;
  let totalCourant = 0;
  
  (['A', 'B', 'C'] as const).forEach(phase => {
    const data = calculatePhaseData(
      currentProject.nodes,
      phase,
      foisonnementResidentiel,
      foisonnementIndustriel,
      foisonnementProductions,
      globalFoisonne.totalFoisonneChargeGlobal,
      globalFoisonne.totalFoisonneProductionGlobal,
      currentProject.clientsImportes,
      currentProject.clientLinks,
      is230V,
      currentProject.manualPhaseDistribution
    );
    
    totalNbMono += data.nbMono;
    totalChargeMono += data.chargeMono;
    totalProdMono += data.prodMono;
    totalChargeMonoFois += data.chargeMonoFoisonne;
    totalProdMonoFois += data.prodMonoFoisonne;
    
    totalNbPolyRes += data.nbPolyRes;
    totalChargePolyRes += data.chargePolyRes;
    totalProdPolyRes += data.prodPolyRes;
    totalChargePolyResFois += data.chargePolyResFoisonne;
    totalProdPolyResFois += data.prodPolyResFoisonne;
    
    totalNbPolyInd += data.nbPolyInd;
    totalChargePolyInd += data.chargePolyInd;
    totalProdPolyInd += data.prodPolyInd;
    totalChargePolyIndFois += data.chargePolyIndFoisonne;
    totalProdPolyIndFois += data.prodPolyIndFoisonne;
    
    totalCourant += data.courantTotal;
  });
  
  return {
    nbMono: totalNbMono,
    chargeMono: totalChargeMono,
    prodMono: totalProdMono,
    chargeMonoFoisonne: totalChargeMonoFois,
    prodMonoFoisonne: totalProdMonoFois,
    nbPolyRes: totalNbPolyRes,
    chargePolyRes: totalChargePolyRes,
    prodPolyRes: totalProdPolyRes,
    chargePolyResFoisonne: totalChargePolyResFois,
    prodPolyResFoisonne: totalProdPolyResFois,
    nbPolyInd: totalNbPolyInd,
    chargePolyInd: totalChargePolyInd,
    prodPolyInd: totalProdPolyInd,
    chargePolyIndFoisonne: totalChargePolyIndFois,
    prodPolyIndFoisonne: totalProdPolyIndFois,
    courantTotal: totalCourant
  };
};
```

#### Modification de la table JSX - Ajout ligne TOTAL dans `<tbody>` (après la boucle des phases)

```tsx
<tbody>
  {/* Lignes par couplage (existant) */}
  {(['A', 'B', 'C'] as const).map((phase) => {
    // ... code existant ...
  })}
  
  {/* NOUVELLE LIGNE TOTAL */}
  {(() => {
    const totals = calculateTotals();
    return (
      <tr className="border-t-2 border-border bg-muted/30 font-semibold">
        <td className="py-1.5 px-1 text-foreground">TOTAL</td>
        {/* MONO */}
        <td className="text-center py-1 px-0.5 text-foreground">{totals.nbMono}</td>
        <td className="text-right py-1 px-0.5 text-foreground">{totals.chargeMono.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-foreground">{totals.prodMono.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-primary font-bold">{totals.chargeMonoFoisonne.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-primary font-bold border-r border-border/50">{totals.prodMonoFoisonne.toFixed(1)}</td>
        {/* Poly Rés. */}
        <td className="text-center py-1 px-0.5 text-foreground">{Math.round(totals.nbPolyRes)}</td>
        <td className="text-right py-1 px-0.5 text-foreground">{totals.chargePolyRes.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-foreground">{totals.prodPolyRes.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-green-700 dark:text-green-400 font-bold">{totals.chargePolyResFoisonne.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-green-700 dark:text-green-400 font-bold border-r border-border/50">{totals.prodPolyResFoisonne.toFixed(1)}</td>
        {/* Poly Ind. */}
        <td className="text-center py-1 px-0.5 text-foreground">{Math.round(totals.nbPolyInd)}</td>
        <td className="text-right py-1 px-0.5 text-foreground">{totals.chargePolyInd.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-foreground">{totals.prodPolyInd.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-orange-700 dark:text-orange-400 font-bold">{totals.chargePolyIndFoisonne.toFixed(1)}</td>
        <td className="text-right py-1 px-0.5 text-orange-700 dark:text-orange-400 font-bold border-r border-border/50">{totals.prodPolyIndFoisonne.toFixed(1)}</td>
        {/* Totaux (pas de déséquilibre sur la ligne totale) */}
        <td className="text-right py-1 px-1 text-muted-foreground">—</td>
        <td className="text-right py-1 px-1 text-foreground font-bold">{Math.abs(totals.courantTotal).toFixed(1)}</td>
      </tr>
    );
  })()}
</tbody>
```

---

## Résumé des fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `src/components/PhaseDistributionSliders.tsx` | Corriger les dépendances du useEffect pour éviter la boucle circulaire |
| `src/components/PhaseDistributionDisplay.tsx` | Ajouter fonction `calculateTotals()` et ligne TOTAL dans le tableau |

---

## Résultat attendu

### Tableau après correction

```text
┌──────────┬─────────────────────────────┬─────────────────────────────┬─────────────────────────────┬───────┬───────┐
│ Couplage │      MONO (Résidentiel)     │       Poly Résidentiel      │       Poly Industriel       │ Déséq │ I (A) │
│          ├────┬──────┬──────┬─────┬─────┼────┬──────┬──────┬─────┬─────┼────┬──────┬──────┬─────┬─────┤       │       │
│          │ Nb │ Ch.  │ Pr.  │ Ch.F│ Pr.F│ Nb │ Ch.  │ Pr.  │ Ch.F│ Pr.F│ Nb │ Ch.  │ Pr.  │ Ch.F│ Pr.F│       │       │
├──────────┼────┼──────┼──────┼─────┼─────┼────┼──────┼──────┼─────┼─────┼────┼──────┼──────┼─────┼─────┼───────┼───────┤
│ L1-L2    │ 15 │ 60.0 │  5.0 │ 9.0 │ 5.0 │  1 │ 12.0 │  3.0 │ 1.8 │ 3.0 │  2 │ 35.0 │ 10.0 │24.5 │10.0 │  +2%  │  8.5  │
│ L2-L3    │ 12 │ 48.0 │  3.0 │ 7.2 │ 3.0 │  1 │ 12.0 │  3.0 │ 1.8 │ 3.0 │  2 │ 35.0 │ 10.0 │24.5 │10.0 │  -1%  │  7.2  │
│ L3-L1    │ 18 │ 72.0 │  8.0 │10.8 │ 8.0 │  1 │ 12.0 │  3.0 │ 1.8 │ 3.0 │  1 │ 35.0 │ 10.0 │24.5 │10.0 │  +5%  │  9.1  │
├══════════┼════┼══════┼══════┼═════┼═════┼════┼══════┼══════┼═════┼═════┼════┼══════┼══════┼═════┼═════┼═══════┼═══════┤
│ TOTAL    │ 45 │180.0 │ 16.0 │27.0 │16.0 │  3 │ 36.0 │  9.0 │ 5.4 │ 9.0 │  5 │105.0 │ 30.0 │73.5 │30.0 │   —   │ 24.8  │
└──────────┴────┴──────┴──────┴─────┴─────┴────┴──────┴──────┴─────┴─────┴────┴──────┴──────┴─────┴─────┴───────┴───────┘
```

### Comportement curseurs

- **Mode automatique** : Les curseurs se synchronisent avec le tableau après chaque ajout/suppression de client
- **Mode forcé** : Fond jaune, les curseurs conservent les valeurs manuelles
- **Reset** : Retour au mode automatique

