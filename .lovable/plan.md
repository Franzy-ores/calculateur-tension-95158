

## Plan: Fix MONO client assignment to use coupling-only logic for 230V delta

### Problem
In `autoAssignPhaseForMonoClient`, for 230V delta networks:
- The function accumulates `phaseLoads` with a 50/50 split per coupling (lines 96-110) — physically incorrect
- The `assignedPhase` return value is derived from `phaseLoads` (line 123-127), not from the coupling selection
- The coupling-based selection (lines 134-143) is already correct but disconnected from the phase assignment

The same issue exists in `autoAssignProductionPhaseForSmallPolyClient` (lines 183-210).

### Changes

**File: `src/utils/phaseDistributionCalculator.ts`**

**1. Remove `DELTA_PHASE_CONTRIBUTION_FACTOR` constant (line 8)**
No longer needed — balancing is done on couplings, not pseudo-phase contributions.

**2. Fix `autoAssignPhaseForMonoClient` (lines 86-158)**

For 230V delta:
- Remove the 50/50 `phaseLoads` accumulation (lines 96-110) — don't update `phaseLoads` at all for 230V MONO clients
- Move the coupling selection **before** the phase selection
- Derive `assignedPhase` from the selected coupling (e.g., `A-B` → `A`, `B-C` → `B`, `A-C` → `A`) — this is a legacy field needed by downstream code; the first letter of the coupling is a reasonable convention
- Use **only** `couplingLoads` for the optimization decision in 230V mode

**3. Fix `autoAssignProductionPhaseForSmallPolyClient` (lines 166-248)**

Same pattern: for 230V, remove 50/50 `phaseProductions` accumulation and derive `assignedPhase` from the selected coupling.

### Mapping coupling → assignedPhase

For backward compatibility (some downstream code reads `assignedPhase`), derive it from the coupling:
- `A-B` → `A`
- `B-C` → `B`  
- `A-C` → `C`

This maps each coupling to a unique phase, ensuring the `assignedPhase` field remains populated but the real balancing decision is made on couplings.

### What stays unchanged
- 400V star path — uses `phaseLoads` as before
- `calculateNodeAutoPhaseDistribution` — already uses `phaseCoupling` for 230V
- `runCoupledBFSForDelta` — already reads `phasePhaseLoads_map`
- All other functions listed in the "do not modify" list

