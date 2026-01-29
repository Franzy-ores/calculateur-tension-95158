
# Plan : Sélection du nœud SRG2 optimal basée sur l'impact réseau aval

## Objectif

Modifier la logique de `findOptimalSRG2Node` pour qu'elle évalue l'**impact réel** de chaque position SRG2 candidate sur le réseau aval, avec pour objectif de **maximiser le nombre de nœuds hors norme EN50160 qui rentrent dans la norme** après l'ajout du SRG2.

## Principe physique

Le SRG2 est un régulateur de tension qui ajuste la tension en sortie via des prises (typiquement ±7%, ±3.5%). Son efficacité dépend de :
- Sa position sur le réseau (nœuds en aval bénéficiant de la régulation)
- L'état initial du réseau (nœuds hors norme à corriger)
- Sa capacité à ramener les nœuds hors norme dans les limites EN50160 (207V-253V)

## Nouvelle logique de sélection

```text
Pour chaque nœud candidat (distance ≤ 250m de la source) :
  1. Identifier tous les nœuds en aval du candidat
  2. Compter les nœuds hors norme EN50160 AVANT simulation
  3. Simuler l'effet du SRG2 à cette position
  4. Compter les nœuds hors norme APRÈS simulation
  5. Calculer le score = (noeuds_corrigés / noeuds_hors_norme_aval)

Le nœud optimal est celui qui MAXIMISE ce score d'amélioration
```

## Structure des données retournées

```typescript
interface OptimalSRG2Result {
  nodeId: string;
  nodeName: string;
  distanceFromSource_m: number;
  
  // Nouveau : métriques d'impact
  downstreamNodesCount: number;           // Nombre de nœuds en aval
  nodesOutOfNormBefore: number;           // Nœuds hors norme avant SRG2
  nodesOutOfNormAfter: number;            // Nœuds hors norme après SRG2
  nodesCorrected: number;                 // Nœuds ramenés dans la norme
  correctionRate: number;                 // Taux de correction (0-100%)
  
  // Score = taux de correction (plus élevé = meilleur)
  score: number;
  
  // Tensions estimées après SRG2
  estimatedVoltagesAfter: { min: number; max: number; mean: number };
  
  justification: string;
}
```

## Algorithme détaillé

### Étape 1 : Identifier les candidats (distance ≤ 250m)

```typescript
const MAX_DISTANCE_M = 250;

for (const node of nodes) {
  if (node.isSource) continue;
  
  const { pathLength_m } = computeUpstreamImpedance(node.id, ...);
  
  if (pathLength_m > MAX_DISTANCE_M) {
    // Trop loin de la source
    continue;
  }
  
  candidates.push(node);
}
```

### Étape 2 : Pour chaque candidat, trouver les nœuds aval

Réutiliser la logique BFS existante dans `SRG2Panel.tsx` (`findDownstreamNodes`).

### Étape 3 : Compter les nœuds hors norme AVANT simulation

```typescript
const VOLTAGE_MIN_EN50160 = 207; // -10% de 230V
const VOLTAGE_MAX_EN50160 = 253; // +10% de 230V

function countOutOfNormNodes(
  nodeIds: string[], 
  calculationResult: CalculationResult
): number {
  let count = 0;
  for (const nodeId of nodeIds) {
    const metrics = calculationResult.nodeMetricsPerPhase?.find(n => n.nodeId === nodeId);
    if (!metrics?.voltagesPerPhase) continue;
    
    const { A, B, C } = metrics.voltagesPerPhase;
    const anyOutOfNorm = [A, B, C].some(
      v => v < VOLTAGE_MIN_EN50160 || v > VOLTAGE_MAX_EN50160
    );
    
    if (anyOutOfNorm) count++;
  }
  return count;
}
```

### Étape 4 : Simuler l'effet du SRG2 (estimation)

Plutôt qu'une simulation complète (coûteuse), estimer l'effet du SRG2 :

```typescript
function estimateSRG2Effect(
  candidateNodeId: string,
  downstreamNodes: string[],
  baselineResult: CalculationResult,
  project: Project
): { nodesOutOfNormAfter: number; estimatedVoltages: {...} } {
  
  // 1. Calculer la tension moyenne au nœud candidat
  const candidateMetrics = baselineResult.nodeMetricsPerPhase?.find(
    n => n.nodeId === candidateNodeId
  );
  const { A, B, C } = candidateMetrics.voltagesPerPhase;
  const Umean = (A + B + C) / 3;
  
  // 2. Estimer le coefficient SRG2 pour atteindre 230V
  // Coefficient max = ±7% (positions LO2/BO2)
  const targetVoltage = 230;
  const requiredBoost = targetVoltage - Umean;
  const boostPercent = Math.max(-7, Math.min(7, (requiredBoost / Umean) * 100));
  
  // 3. Appliquer ce boost aux nœuds aval (estimation linéaire)
  // Les nœuds aval verront un boost proportionnel
  let nodesStillOutOfNorm = 0;
  
  for (const nodeId of downstreamNodes) {
    const nodeMetrics = baselineResult.nodeMetricsPerPhase?.find(
      n => n.nodeId === nodeId
    );
    if (!nodeMetrics?.voltagesPerPhase) continue;
    
    // Estimer les tensions après boost
    const boostedVoltages = {
      A: nodeMetrics.voltagesPerPhase.A * (1 + boostPercent / 100),
      B: nodeMetrics.voltagesPerPhase.B * (1 + boostPercent / 100),
      C: nodeMetrics.voltagesPerPhase.C * (1 + boostPercent / 100)
    };
    
    const anyOutOfNorm = [boostedVoltages.A, boostedVoltages.B, boostedVoltages.C].some(
      v => v < VOLTAGE_MIN_EN50160 || v > VOLTAGE_MAX_EN50160
    );
    
    if (anyOutOfNorm) nodesStillOutOfNorm++;
  }
  
  return { nodesOutOfNormAfter: nodesStillOutOfNorm, ... };
}
```

### Étape 5 : Calculer le score et trier

```typescript
for (const candidate of candidates) {
  const downstreamNodes = findDownstreamNodes(candidate.id);
  const nodesBefore = countOutOfNormNodes(downstreamNodes, baselineResult);
  
  if (nodesBefore === 0) {
    // Tous les nœuds aval sont déjà conformes
    // Score bas car pas d'amélioration possible
    candidate.score = 0.1;
    continue;
  }
  
  const { nodesOutOfNormAfter } = estimateSRG2Effect(...);
  const nodesCorrected = nodesBefore - nodesOutOfNormAfter;
  const correctionRate = (nodesCorrected / nodesBefore) * 100;
  
  candidate.score = correctionRate;
  candidate.nodesCorrected = nodesCorrected;
  candidate.correctionRate = correctionRate;
}

// Trier par score DÉCROISSANT (plus élevé = meilleur)
candidates.sort((a, b) => b.score - a.score);
```

## Cas particuliers

1. **Aucun nœud hors norme** : Retourner le nœud le plus proche de la source avec un message "Réseau conforme, SRG2 optionnel"

2. **Tous les candidats ont le même score** : Départager par la distance (plus proche = prioritaire)

3. **Aucun candidat dans les 250m** : Relâcher la contrainte à 300m ou suggérer "Aucun emplacement optimal dans la zone"

## Fichiers à modifier

| Fichier | Modifications |
|---------|---------------|
| `src/utils/optimalSrg2Finder.ts` | Nouvelle logique basée sur l'impact aval |
| `src/components/SRG2Panel.tsx` | Affichage des nouvelles métriques d'impact |

## Affichage UI (SRG2Panel)

La carte "Suggestion automatique" affichera :

```
🎯 Nœud recommandé: N3
   • Distance source: 180 m
   • Nœuds en aval: 12
   • Nœuds hors norme avant: 5
   • Nœuds corrigés: 4 (80%)
   • Score d'impact: 80%
   
💡 Ce nœud permet de ramener 4 nœuds dans la norme EN50160
```

## Tests de validation

1. **Réseau avec sous-tensions** : Le nœud optimal doit être celui qui corrige le plus de nœuds avec boost positif
2. **Réseau avec surtensions** : Le nœud optimal doit être celui qui corrige le plus de nœuds avec boost négatif
3. **Réseau mixte** : Équilibrer les corrections surtension/sous-tension
4. **Réseau conforme** : Suggérer le nœud le plus proche avec mention "optionnel"

## Impact utilisateur

- L'utilisateur voit directement l'impact potentiel du SRG2 avant de l'ajouter
- Le choix est justifié par des métriques concrètes (nombre de nœuds corrigés)
- La suggestion est basée sur l'efficacité réelle, pas sur des critères théoriques
