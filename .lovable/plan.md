

## Corrections to Sequence Component Calculation

### Problem
The Fortescue transform currently uses phase-to-neutral phasors (after `V_neutral` subtraction), but the correct input for Fortescue sequence decomposition is the **raw phase-to-ground phasors** (before neutral correction). Additionally, the condition is too restrictive (`connectionType === 'TÉTRA_3P+N_230_400V'` instead of `is400V`).

### Changes — `src/utils/electricalCalculations.ts`

**Correction 1 — Broaden condition** (line 2336):
Replace `if (n.connectionType === 'TÉTRA_3P+N_230_400V')` with `if (is400V)` to cover all nodes on a 400V star network.

**Correction 2 — Use raw phasors for Fortescue** (insert before Fortescue math, ~line 2337):
Reconstruct raw (pre-neutral-correction) phasors by adding back `V_neutral_refined`:
```typescript
const Vn = V_neutral_refined.get(n.id) || C(0, 0);
const Va_seq = add(Va, Vn);
const Vb_seq = add(Vb, Vn);
const Vc_seq = add(Vc, Vn);
```
For the source node (no neutral correction applied), use Va/Vb/Vc directly. Then replace all `Va`/`Vb`/`Vc` references in the Fortescue formulas (lines 2342-2349) with `Va_seq`/`Vb_seq`/`Vc_seq`.

**Correction 3 — Add debug log** (after `sequenceComponents` assignment, ~line 2363):
```typescript
console.log(`🔬 Séquences ${n.name || n.id}: Va=${abs(Va_seq).toFixed(1)}∠${(Math.atan2(Va_seq.im,Va_seq.re)*180/Math.PI).toFixed(1)}° U1=${U1_mag.toFixed(1)}V U2=${U2_mag.toFixed(1)}V U0=${U0_mag.toFixed(1)}V ku=${sequenceComponents.ku_percent}% ${sequenceComponents.ku_percent > 2 ? '⚠️' : '✅'}`);
```

### File modified
| File | Change |
|---|---|
| `src/utils/electricalCalculations.ts` | Fix condition to `is400V`, reconstruct raw phasors via `add(V, Vn)`, use them for Fortescue, add debug log |

