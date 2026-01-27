
# Plan de correction : Cohérence des tensions EQUI8 + SRG2

## Contexte du problème

L'audit révèle que les tensions affichées en mode EQUI8 + SRG2 combiné sont **incohérentes** car :
1. Le calcul final n'inclut pas les injections de courant EQUI8
2. Des tensions sont imposées artificiellement après le calcul, violant le principe CME
3. Le SRG2 applique ses coefficients sur un réseau qui ne "voit" plus l'effet EQUI8

## Principe fondamental à respecter

> **EQUI8 modifie les courants, JAMAIS les tensions directement.**

Les tensions doivent résulter **naturellement** du solveur BFS avec les injections de courant EQUI8 intégrées.

---

## Corrections à apporter

### 1. Calcul final avec injections EQUI8 actives

**Fichier** : `src/utils/simulationCalculator.ts`  
**Fonction** : `calculateWithCombinedSRG2AndEQUI8`  
**Lignes** : ~900-935

**Problème** : Le calcul final appelle `calculateScenario()` sans passer les injections EQUI8.

**Correction** :
- Conserver les injections EQUI8 calculées lors de la dernière itération
- Passer ces injections au `calculateScenario` final via le paramètre `equi8CurrentInjections`
- Les coefficients SRG2 seront appliqués par le BFS (via `hasSRG2Device` et `srg2TensionSortie`)

```text
Avant:
  calculateScenario(workingNodes, ...) // Sans EQUI8

Après:
  calculateScenario(workingNodes, ..., equi8FinalInjections) // Avec EQUI8
```

### 2. Supprimer l'imposition directe de tensions EQUI8

**Fichier** : `src/utils/simulationCalculator.ts`  
**Fonction** : `applyNeutralCompensatorsToResult`  
**Lignes** : 1951-1954

**Problème** : Ces lignes imposent des tensions calculées par formule au lieu de laisser le BFS les calculer naturellement.

**Correction** :
- Supprimer les lignes qui écrasent `nodeMetrics.voltagesPerPhase.X`
- Conserver uniquement la mise à jour des métadonnées du compensateur (pour affichage informatif)

### 3. Reconstruire les injections EQUI8 avant le calcul final

**Fichier** : `src/utils/simulationCalculator.ts`  
**Fonction** : `calculateWithCombinedSRG2AndEQUI8`  

**Modification** :
- Après la boucle de convergence SRG2+EQUI8, les injections EQUI8 calibrées doivent être conservées
- Appeler `calculateWithEQUI8_CME` pour le calcul final, pas `calculateScenario` directement
- Puis appliquer les coefficients SRG2 sur ce résultat

### 4. Ordre correct du calcul final

Le calcul final doit suivre cet ordre :
1. **EQUI8 CME** active (injections de courant intégrées au BFS)
2. **SRG2** applique ses coefficients de tension (via marqueurs sur les nœuds)
3. **BFS complet** avec les deux effets simultanément

---

## Détail technique

### Modification de `calculateWithCombinedSRG2AndEQUI8`

Remplacer le bloc "Étape finale" (lignes ~896-935) par :

```typescript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ÉTAPE FINALE: Calcul BFS avec EQUI8 CME + coefficients SRG2
// Les deux effets sont appliqués simultanément pour cohérence des tensions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. Préparer les nœuds avec les marqueurs SRG2 (coefficients + tensions sortie)
const workingNodes = JSON.parse(JSON.stringify(workingProject.nodes)) as Node[];
for (const srg2 of srg2Devices) {
  if (srg2.coefficientsAppliques && srg2.tensionSortie) {
    this.applySRG2Coefficients(workingNodes, srg2, srg2.coefficientsAppliques, srg2.tensionSortie);
  }
}

// 2. Reconstruire les injections EQUI8 à partir des données de calibration
const equi8FinalInjections = new Map<string, {...}>();
// ... reconstruire depuis cmeDataMap ou dernière calibration

// 3. Calcul final avec EQUI8 + SRG2 actifs
const finalResult = this.calculateScenario(
  workingNodes,
  workingProject.cables,
  workingProject.cableTypes,
  scenario,
  ...,
  equi8FinalInjections  // ✅ Injections EQUI8 incluses
);
```

### Modification de `applyNeutralCompensatorsToResult`

Supprimer les lignes 1951-1954 :

```typescript
// ❌ SUPPRIMER - Violation du principe CME
// nodeMetrics.voltagesPerPhase.A = equi8Result.UEQUI8_ph1_mag;
// nodeMetrics.voltagesPerPhase.B = equi8Result.UEQUI8_ph2_mag;
// nodeMetrics.voltagesPerPhase.C = equi8Result.UEQUI8_ph3_mag;

// ✅ GARDER - Mise à jour des métadonnées seulement
compensator.u1p_V = nodeMetrics.voltagesPerPhase.A; // Lire, pas écrire
compensator.u2p_V = nodeMetrics.voltagesPerPhase.B;
compensator.u3p_V = nodeMetrics.voltagesPerPhase.C;
```

---

## Tests de validation

Après correction, vérifier :

1. **Cohérence EQUI8 seul** : Les tensions au nœud EQUI8 = résultat BFS avec injection (pas de formule directe)

2. **Cohérence SRG2 seul** : Les tensions après SRG2 = tension entrée × (1 + coefficient%)

3. **Cohérence couplée** : 
   - L'écart de tension au nœud EQUI8 est réduit (pas augmenté)
   - Les tensions après SRG2 reflètent l'effet sur un réseau déjà équilibré par EQUI8
   - Pas de "saut" de tension entre les résultats EQUI8 et le résultat final

4. **Convergence** : La boucle couplée converge en moins de 10 itérations avec tap_change == 0

---

## Résumé des fichiers modifiés

| Fichier | Modifications |
|---------|---------------|
| `src/utils/simulationCalculator.ts` | Calcul final avec `equi8Injections`, suppression imposition tensions |

## Impact attendu

- Tensions cohérentes entre les étapes EQUI8 → SRG2 → Affichage
- Respect du modèle physique CME (injection courant, pas imposition tension)
- Résultats identiques au comportement terrain attendu
