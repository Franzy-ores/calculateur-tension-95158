

## Plan: Fix TRI_230V_3F voltage display to show line-to-line values

### Problem
Since `Vslack_phase = 230/√3 ≈ 133V`, internal BFS phase voltages are ~133V. Two display blocks still show these raw magnitudes instead of computing line-to-line voltages (V_AB, V_BC, V_AC), resulting in displayed voltages of ~133V instead of ~230V.

### Changes (all in `src/utils/electricalCalculations.ts`)

**1. nodeVoltageDrops block (line ~2033-2036)**

Replace the generic `scaleLine` computation for TRI_230V_3F with actual line-to-line voltage calculation:

```typescript
let U_node_line_tension: number;
if (n.connectionType === 'TRI_230V_3F') {
  // Delta: physical voltages are line-to-line
  U_node_line_tension = Math.min(
    abs(sub(Va, Vb)),  // V_AB
    abs(sub(Vb, Vc)),  // V_BC
    abs(sub(Va, Vc))   // V_AC
  );
} else {
  const scaleLine = this.getDisplayLineScale(n.connectionType);
  U_node_line_tension = Math.min(Va_mag, Vb_mag, Vc_mag) * scaleLine;
}
```

**2. nodeMetricsPerPhase display block (lines ~2132-2137)**

Replace the TRI_230V_3F case to compute line-to-line voltages from complex phasors:

```typescript
} else if (n.connectionType === 'TRI_230V_3F') {
  // Delta: the only physical voltages are line-to-line
  Va_display = abs(sub(Va, Vb));   // V_AB
  Vb_display = abs(sub(Vb, Vc));   // V_BC
  Vc_display = abs(sub(Va, Vc));   // V_AC
  U_ref = 230;
```

**3. No other changes needed**
- `getDisplayLineScale` for TRI_230V_3F is only used in the balanced-mode path and other generic paths — those will need the same treatment but are outside the unbalanced BFS block. For the unbalanced block, the two fixes above cover all display logic.
- `runCoupledBFSForDelta`, S_maps, thermal passes, 400V path — untouched.

### Validation
- No-load network, source at 230V → all displayed voltages = 230V on AB, BC, AC.
- Loaded network → voltages drop from 230V proportionally, not from 133V.

