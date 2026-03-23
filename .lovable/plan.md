

# Surgical BFS Solver Corrections — Physical Correctness and Robustness

## Current State Assessment

After reviewing all 2819 lines, the solver is already well-structured with clear separation:
- **Delta 230V**: `runCoupledBFSForDelta()` with I_A+I_B+I_C=0 enforcement, MONO loads via `phasePhaseLoads_map` using `I_AB = conj(S_AB / V_AB)` (correct)
- **Wye 400V**: 3 independent BFS + neutral coupling loop (8 passes, 0.01V tolerance) — already improved
- **Voltage model**: Internal V_LL/sqrt(3), display reconstructs V_AB=Va-Vb for delta — consistent

Several requested fixes are already implemented. The plan focuses on **5 genuine remaining issues**.

## Corrections

### 1. Delta POLY loads: convert from wye-equivalent to proper delta representation

**File**: `src/utils/electricalCalculations.ts`, in `runCoupledBFSForDelta()` backward sweep (lines 1551-1562)

**Problem**: POLY loads in delta mode use `I = conj(S_phase / V_phase_internal)` — a wye-equivalent shortcut. While mathematically equivalent for perfectly balanced loads, it produces incorrect currents when POLY distribution is unbalanced (cursor-driven redistribution pA != pB != pC). The I0 removal step masks but doesn't fix this.

**Fix**: Convert POLY S_maps to delta representation before computing currents:
```
S_AB_poly = (Sa + Sb) / 2  (simplified redistribution)
I_AB = conj(S_AB_poly / V_AB)
```
Then apply Kirchhoff: `I_A = I_AB + I_AC`, `I_B = I_BC - I_AB`, `I_C = -I_BC - I_AC`

This unifies the current calculation with the MONO path — all delta currents computed from line-to-line voltages.

### 2. Dual convergence criterion (voltage AND current)

**File**: `src/utils/electricalCalculations.ts`

**Problem**: Both `runBFSForPhase` (line 1459-1470) and `runCoupledBFSForDelta` (line 1716-1731) check only voltage convergence.

**Fix**: After the voltage convergence check, add current convergence:
```typescript
// Store previous branch currents before backward sweep
const I_prev = new Map(I_branch_phase); // or I_A_branch etc.

// After forward sweep, check BOTH:
let voltageConverged = true;
let currentConverged = true;

for (const [nid, Vn] of V_node_phase.entries()) {
  const d = abs(sub(Vn, V_prev.get(nid)!));
  if (d / (abs(Vn) || 1) >= 1e-4) { voltageConverged = false; break; }
}

for (const [cabId, I] of I_branch_phase.entries()) {
  const Ip = I_prev.get(cabId);
  if (Ip && abs(I) > 0.01) {
    if (abs(sub(I, Ip)) / abs(I) >= 1e-4) { currentConverged = false; break; }
  }
}

if (voltageConverged && currentConverged) { converged = true; break; }
```

Apply to both `runBFSForPhase` and `runCoupledBFSForDelta`.

### 3. Replace low-voltage fallback with divergence detection

**File**: `src/utils/electricalCalculations.ts`

**Problem**: Line 1320 (`runBFSForPhase`) and lines 1556-1558 (`runCoupledBFSForDelta`) silently replace low voltages with slack values. This hides divergence.

**Fix**: Replace the silent fallback with explicit divergence detection:
```typescript
// In runBFSForPhase:
const Vn = V_node_phase.get(n.id) || Vslack_phase_ph;
if (abs(Vn) < 1.0) { // Below 1V = clearly diverging
  console.error(`❌ BFS divergence: node ${n.id} voltage ${abs(Vn).toFixed(3)}V`);
  throw new Error(`BFS divergence detected at node ${n.id}: |V|=${abs(Vn).toFixed(3)}V`);
}
const Vsafe = Vn; // No silent replacement
```

Keep the MIN_VOLTAGE_SAFETY (1e-6) guard only for the `conj(S/V)` division to prevent NaN, but flag it:
```typescript
if (abs(Vn) < 0.1) {
  console.warn(`⚠️ Near-zero voltage at node ${n.id}, possible divergence`);
}
const Iinj = abs(Vn) > 1e-6 ? conj(div(Sph, Vn)) : C(0, 0);
```

### 4. Runtime validation checks

**File**: `src/utils/electricalCalculations.ts`

**A. Delta mode validation** — Add at the start of `runCoupledBFSForDelta`:
```typescript
// Validate: in delta mode, S_maps should only contain POLY loads
// MONO loads must go through phasePhaseLoads_map
for (const [nid, Sa] of S_A_m.entries()) {
  const Sb = S_B_m.get(nid) || C(0, 0);
  const Sc = S_C_m.get(nid) || C(0, 0);
  const total = abs(Sa) + abs(Sb) + abs(Sc);
  if (total > 0.001) {
    // Verify this is POLY (should have all 3 phases)
    const minPhase = Math.min(abs(Sa), abs(Sb), abs(Sc));
    if (minPhase < total * 0.01) {
      console.warn(`⚠️ [Delta validation] Node ${nid}: S_map has single-phase pattern — should be in phasePhaseLoads_map`);
    }
  }
}
```

**B. Post-BFS KCL check** — Add after coupled BFS convergence:
```typescript
// Verify I_A + I_B + I_C ≈ 0 on all branches
for (const [cabId, Ia] of I_A_branch.entries()) {
  const Ib = I_B_branch.get(cabId) || C(0, 0);
  const Ic = I_C_branch.get(cabId) || C(0, 0);
  const I_sum = abs(add(add(Ia, Ib), Ic));
  const I_max = Math.max(abs(Ia), abs(Ib), abs(Ic));
  if (I_max > 0.1 && I_sum / I_max > 0.01) {
    console.warn(`⚠️ [KCL violation] Cable ${cabId}: |I_A+I_B+I_C|=${I_sum.toFixed(2)}A (${(I_sum/I_max*100).toFixed(1)}% of max phase)`);
  }
}
```

**C. Wye mode neutral consistency** — Add after neutral computation:
```typescript
// Verify neutral current = sum of phase currents on each cable
for (const [cabId, IN] of I_neutral_cable.entries()) {
  const Ia = phaseA.I_branch_phase.get(cabId) || C(0, 0);
  const Ib = phaseB.I_branch_phase.get(cabId) || C(0, 0);
  const Ic = phaseC.I_branch_phase.get(cabId) || C(0, 0);
  const I_sum = add(add(Ia, Ib), Ic);
  // Note: IN includes earth leakage, so allow tolerance
  const diff = abs(sub(IN, I_sum));
  if (diff > 1.0) {
    console.warn(`⚠️ [Neutral check] Cable ${cabId}: I_N differs from Ia+Ib+Ic by ${diff.toFixed(2)}A`);
  }
}
```

### 5. Audit and protect against double sqrt(3)

**File**: `src/utils/electricalCalculations.ts`

**Current sqrt(3) usage audit:**
- Line 408: `Vslack = V_LL / sqrt(3)` — correct (internal representation)
- Line 414: `busVoltage = |V_bus| * sqrt(3)` — correct (display)
- Lines 921-928: `Vslack_phase = tensionCible / sqrt(3)` — correct
- Line 2093: `deltaU_line = dV_phase * sqrt(3)` for 400V star — correct
- Lines 2295-2297: Delta display uses `Va - Vb` — correct (no sqrt(3))
- Line 2301-2304: 400V display shows phase voltage directly (230V) — correct

No double-sqrt(3) bugs found. Add a safeguard comment at the Vslack computation to prevent future errors:
```typescript
// ⚠️ SINGLE √3 CONVERSION POINT: V_LL → V_phase_internal
// All other √3 conversions are for display only (getDisplayLineScale)
// Delta display uses Va-Vb (no √3 needed)
```

## Files Modified

- `src/utils/electricalCalculations.ts` — all 5 corrections

## What Is NOT Changed (already correct)

- MONO delta injection via phasePhaseLoads_map with I_AB = conj(S_AB/V_AB) and Kirchhoff
- Neutral iteration loop (already 8 passes, 0.01V tolerance)
- Voltage display scaling (delta: Va-Vb, star: phase direct)
- Fortescue sequence components (corrected in previous iteration)
- Thermal correction passes
- SRG2 series voltage injection

