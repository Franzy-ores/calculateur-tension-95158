# Plan : Implémentation de la formule GRD belge pour les impédances

## ✅ IMPLÉMENTÉ (2026-02-02)

La formule GRD belge (ORES/RESA/Sibelga) a été appliquée à tous les calculs d'impédance de phase :

```text
R = (R₀ + 2×R₁₂) / 3
X = (X₀ + 2×X₁₂) / 3
```

### Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `src/utils/electricalCalculations.ts` | Ajout de `calculateGRDImpedance()` et modification de `selectRX()` |
| `src/utils/equi8CME.ts` | Application de la formule pour le calcul d'impédance équivalente |
| `src/utils/optimalEqui8Finder.ts` | Application de la formule pour la recherche de nœud optimal |
| `src/utils/optimalSrg2Finder.ts` | Application de la formule pour la recherche de nœud SRG2 |
| `src/utils/__tests__/mono230VCurrentCalculation.test.ts` | Tests mis à jour pour valider la formule GRD |

### Impact sur les calculs

Exemple pour câble TR 70 Alu :
- R₁₂ = 0.450 Ω/km, R₀ = 1.350 Ω/km
- R_GRD = (1.350 + 2×0.450) / 3 = 0.750 Ω/km
- Impact : +67% sur la résistance effective

La chute de tension sera augmentée de 33-67% selon le câble, ce qui correspond aux observations terrain des GRD belges.

### Notes techniques

- Le conducteur **neutre** continue d'utiliser R₀/X₀ directement (inchangé)
- Les conducteurs de **phase** utilisent maintenant la formule combinée
- Cette correction s'applique aux réseaux 230V triangle ET 400V étoile

---

## Contexte technique (archive)

Dans les réseaux de distribution BT des GRD belges (ORES, RESA, Sibelga), la chute de tension ne se calcule jamais avec R₁₂ seul. La résistance et réactance effectives vues par une phase sont toujours :

```text
R = (R₀ + 2×R₁₂) / 3
X = (X₀ + 2×X₁₂) / 3
```

Cette formule combine les impédances de séquence directe (Z₁) et homopolaire (Z₀) car le réseau GRD est structurellement déséquilibré. Référence : modèles CYME, NEPLAN, PowerFactory.

### Formules de chute de tension

Ces formules restent inchangées, mais utilisent les nouvelles valeurs R et X :

```text
Monophasé : ΔV = 2 × L × I × (R×cosφ + X×sinφ)
Triphasé  : ΔV = √3 × L × I × (R×cosφ + X×sinφ)
```

### Impact sur les fichiers de câbles de branchement

Le fichier `src/data/branchementCableTypes.ts` utilise une structure simplifiée avec `R_ohm_per_km` et `X_ohm_per_km` (sans distinction R₁₂/R₀). Ces câbles de branchement sont utilisés uniquement dans l'onglet "Tension Client" et ne sont pas affectés par cette modification.
