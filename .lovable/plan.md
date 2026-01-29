# Diagnostic : Client TRI 100 kVA vs Charge Manuelle 100 kVA

## Problème
- Charge manuelle TRI 100 kVA → 207V ✅
- Client TRI résidentiel 100 kVA lié → 219V ❌

## Logs de diagnostic ajoutés

Les logs suivants sont maintenant actifs dans `electricalCalculations.ts`:

```
🔍 [DEBUG] Nœud "X" - Calcul S_prel_map:
   📋 Clients liés: N
      - "ClientName": 100 kVA × 15% = 15.00 kVA (résidentiel, TRI)
   🔧 Charges manuelles: 0 kVA × 15% = 0.00 kVA
   ➡️ S_prel TOTAL: 15.00 kVA
   📊 foisonneAvecCurseurs: A=X + B=X + C=X = Y kVA
   ✅ COHÉRENT / ⚠️ INCOHÉRENCE: S_prel ≈ foisonneAvecCurseurs total
```

## Prochaines étapes

1. **Reproduire le bug** : Créer un client TRI 100 kVA et le lier à un nœud
2. **Observer les logs** : Vérifier si S_prel et foisonneAvecCurseurs sont cohérents
3. **Identifier la source** : Si incohérent, le problème vient de `updateNodePhaseDistribution`

## Fichiers modifiés
- `src/utils/electricalCalculations.ts` (lignes 595-670)
