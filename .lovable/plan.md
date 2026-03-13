

## Plan: Virtual Neutral Correction for 3-wire Delta Networks

### What & Why

In a 3-wire delta (230V triangle, no neutral conductor), the physical constraint `I_A + I_B + I_C = 0` must hold. Currently the BFS runs each phase independently, which can produce a non-zero zero-sequence current. This change adds an iterative correction loop that shifts the virtual neutral point until the constraint is satisfied.

### File modified

`src/utils/electricalCalculations.ts` only.

### Changes

**STEP 1 — Add optional `V0_shift` parameter to `runBFSForPhase` (line 1306)**

```typescript
// Line 1306: add 4th optional parameter
const runBFSForPhase = (angleDeg: number, S_map: Map<string, Complex>, phaseLabel: 'A'|'B'|'C', V0_shift?: Complex) => {

// Line 1311: modify slack initialization
const Vslack_phase_ph = V0_shift
  ? sub(fromPolar(Vslack_phase, this.deg2rad(angleDeg)), V0_shift)
  : fromPolar(Vslack_phase, this.deg2rad(angleDeg));
```

All existing calls without the 4th argument continue to work unchanged.

**STEP 2 — Insert virtual neutral correction loop after line 1469**

Between the initial 3 BFS calls (lines 1467-1469) and the `is400V` detection (line 1471), insert the `!is400V` block:

- Initialize `V_neutral_shift = C(0,0)`
- Loop max 3 iterations:
  1. Compute source current per phase from `children.get(source.id)` outgoing branch currents
  2. Compute `I_0 = (I_A + I_B + I_C) / 3`
  3. If `|I_0| < 0.1A` → converged, break
  4. Newton step: `dV_0 = I_0 / Y_approx` where `Y_approx = |totalLoads - totalProductions| × 1000 / (3 × Vslack_phase²)` — both `totalLoads` and `totalProductions` are already in scope (computed at lines 768-798), and `Vslack_phase` at line 884
  5. Safety cap: if `|dV_0| > 25V` → break (divergence)
  6. Re-run BFS with shifted slacks via `runBFSForPhase(..., V_neutral_shift)`

**STEP 3 — No other changes**

No modifications to: thermal passes (line 1563+), `is400V` neutral coupling loop (line 1518+), EQUI8, SRG2, balanced mode, `sub(Va, Vn)` final correction, display logic, or `computeNodeS`.

### Scope guard

| Must NOT change | Reason |
|---|---|
| `is400V` block (lines 1518-1561) | 400V neutral coupling — separate mechanism |
| Thermal passes (lines 1563-1630) | Out of scope |
| Final V_neutral + `sub(Va, Vn)` block | Display correction, must remain |
| Balanced mode | Out of scope |
| `computeNodeS`, S_map construction | Out of scope |

