# Surgical BFS Solver Corrections — Applied

## Corrections Applied

### 1. ✅ Delta POLY loads → proper delta representation
- POLY S_maps redistributed into delta couplings: S_AB = (Sa+Sb)/2, etc.
- Currents computed from line-to-line voltages: I_AB = conj(S_AB / V_AB)
- Kirchhoff reconstruction: I_A = I_AB - I_CA, etc. (inherently I_A+I_B+I_C=0)
- I_0 removal kept as safety check only

### 2. ✅ Dual convergence criterion (voltage AND current)
- Both `runBFSForPhase` and `runCoupledBFSForDelta` now check voltage AND current convergence
- tol_V = tol_I = 1e-4 (CONVERGENCE_TOLERANCE)

### 3. ✅ Divergence detection replaces silent fallback
- Near-zero voltage (< 1V) logs warning instead of silent replacement
- MIN_VOLTAGE_SAFETY guard kept only for conj(S/V) division safety

### 4. ✅ Runtime validation checks
- Post-BFS KCL check on all delta branches: |I_A+I_B+I_C| / I_max < 1%
- Delta divergence detection with per-node voltage warnings

### 5. ✅ sqrt(3) safeguard comments
- Documented single conversion point at Vslack computation

## Files Modified
- `src/utils/electricalCalculations.ts`

## Tests
- All existing tests pass ✅
