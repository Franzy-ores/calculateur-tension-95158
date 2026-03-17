

## Fix: Remove POLY double-counting in `phasePhaseLoads` (230V Triangle)

**File**: `src/utils/phaseDistributionCalculator.ts`

**Root cause**: POLY clients are added to both `charges.poly` (correct, for S_maps) AND `phasePhaseLoads` (incorrect, reserved for MONO). This double-counting produces 154A instead of 63A for 25 kVA.

### Changes

**1. Remove POLY from phasePhaseLoads in imported clients — charges (lines 357-362)**

Delete:
```ts
if (networkVoltage === 'TRIPHASÉ_230V' && result.phasePhaseLoads) {
  result.phasePhaseLoads.charges['A-B'] += totalCharge / 3;
  result.phasePhaseLoads.charges['B-C'] += totalCharge / 3;
  result.phasePhaseLoads.charges['A-C'] += totalCharge / 3;
}
```

**2. Remove POLY from phasePhaseLoads in imported clients — productions (lines 403-407)**

Delete:
```ts
if (networkVoltage === 'TRIPHASÉ_230V' && result.phasePhaseLoads) {
  result.phasePhaseLoads.productions['A-B'] += totalProd / 3;
  result.phasePhaseLoads.productions['B-C'] += totalProd / 3;
  result.phasePhaseLoads.productions['A-C'] += totalProd / 3;
}
```

**3. Remove POLY from foisonnement coupling accumulators in section 5b (lines 670-677)**

Replace with MONO-only:
```ts
chargeFoisonneParCouplage[c] =
  monoResChargesCoupling[c] * (foisonnementChargesResidentiel / 100) +
  monoIndChargesCoupling[c] * (foisonnementChargesIndustriel  / 100);
prodFoisonneParCouplage[c] =
  monoResProdCoupling[c] * (foisonnementProductions / 100);
```

The POLY foisonné contributions are already correctly handled via `charges.poly` / `S_A/S_B/S_C` in the BFS solver — they must not appear in `phasePhaseLoads` or `chargeFoisonneParCouplage`.

**4. Add rule comment** at the top of phasePhaseLoads initialization (around line 263):
```ts
// RÈGLE ABSOLUE 230V TRIANGLE :
// phasePhaseLoads → MONO uniquement (couplages physiques A-B, B-C, A-C)
// charges.poly / S_A/S_B/S_C → POLY uniquement
// Ces deux chemins sont mutuellement exclusifs — jamais les deux.
```

### Not touched
- 400V star path (unaffected)
- Manual MONO node loads adding to phasePhaseLoads (correct — they are MONO)
- `charges.poly` accumulation (correct — for S_maps)
- Section 5c (400V foisonnement)
- All UI components

