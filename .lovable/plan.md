

## Plan: Couplage neutre dans la boucle BFS — Lot 2

### Résumé

Trois modifications dans `src/utils/electricalCalculations.ts` :

1. **Extraire** le bloc V_neutral (lignes 1601-1709) en méthode privée `computeNeutralVoltages`
2. **Ajouter** une méthode privée `correctSMapForNeutral`
3. **Insérer** une boucle de couplage neutre (max 3 passes) entre les BFS initiaux (ligne 1469) et les passes thermiques (ligne 1471), uniquement quand `is400V && isUnbalanced`

### Détail des modifications

**STEP 1 — `computeNeutralVoltages` (nouvelle méthode privée)**

Extraire le code des lignes 1601-1709 (BFS du neutre : stack3, V_neutral map, EQUI8 reduction, terre, Z_neutral) en méthode privée. Paramètres : source, children, parent, parentCableOfChild, nodeById, cableTypeById, phaseA/B/C, cableZ_phase, U_line_base, isUnbalanced, equi8UpstreamReduction, projectSeason, applySagCorrection. Retourne `Map<string, Complex>`.

Le bloc EQUI8 en amont (lignes 1549-1599, calcul de `equi8UpstreamReduction`) reste en place — il n'est PAS extrait.

**STEP 2 — `correctSMapForNeutral` (nouvelle méthode privée)**

Formule : `S_corr(n) = S(n) × V_phase(n) / (V_phase(n) - V_neutral(n))`. Guards : skip si source, si Veff < 1V, si Vph < MIN_VOLTAGE_SAFETY.

**STEP 3 — Boucle de couplage neutre**

Structure du code modifié (lignes 1467-1539) :

```text
// Ligne 1467: BFS initiaux (inchangés)
phaseA = runBFSForPhase(0, S_A_map, 'A');
phaseB = runBFSForPhase(-120, S_B_map, 'B');
phaseC = runBFSForPhase(120, S_C_map, 'C');

// NOUVEAU: Déplacer is400V + equi8UpstreamReduction AVANT la boucle neutre
const is400V = U_line_base >= VOLTAGE_400V_THRESHOLD;
const equi8UpstreamReduction = new Map<string, Complex>();
// ... bloc EQUI8 CME (lignes 1549-1599, inchangé) ...

// NOUVEAU: Boucle couplage neutre (seulement si is400V)
if (is400V) {
  let V_neutral_iter = new Map(nodes.map(n => [n.id, C(0,0)]));
  for (let pass = 0; pass < 3; pass++) {
    V_neutral_new = this.computeNeutralVoltages(...);
    maxDelta = max |V_new - V_prev| sur tous les nœuds;
    V_neutral_iter = V_neutral_new;
    if (maxDelta < 0.1 && pass > 0) break;  // convergé
    if (pass < 2) {
      S_A/B/C_corr = this.correctSMapForNeutral(...);
      phaseA/B/C = runBFSForPhase(S_corr);
    }
  }
}

// Ligne 1471: Passes thermiques (INCHANGÉES)
// ... thermal passes ...

// Ligne 1541-1734: Bloc is400V final (INCHANGÉ)
// - equi8UpstreamReduction déjà calculé plus haut
// - computeNeutralVoltages re-exécuté ici pour V_neutral finale post-thermique
// - sub(Va, Vn) correction d'affichage — PRÉSERVÉE
```

### Réorganisation nécessaire

Le bloc `equi8UpstreamReduction` + `is400V` (lignes 1541-1599) doit être déplacé **avant** la boucle neutre (entre les BFS initiaux et la boucle), car `computeNeutralVoltages` en a besoin. Le bloc final (lignes 1601-1734) reste en place — il recalcule V_neutral après les passes thermiques pour la correction d'affichage `sub(Va, Vn)`.

### Points de vigilance

| Risque | Mitigation |
|---|---|
| Suppression du bloc final `sub(Va, Vn)` | Le bloc lignes 1719-1733 est PRÉSERVÉ tel quel |
| Modification du mode équilibré | Tout est dans `if (isUnbalanced)`, aucun impact |
| Modification de computeNodeS | Hors scope |
| Modification des passes thermiques | Inchangées, exécutées après la boucle neutre |
| Double déclaration `equi8UpstreamReduction` | Déplacer la déclaration avant la boucle, supprimer la redéclaration dans le bloc final |

### Fichier modifié

`src/utils/electricalCalculations.ts` uniquement.

