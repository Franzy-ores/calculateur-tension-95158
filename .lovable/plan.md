

## Problem

The `NodePhaseDisplay` component (with sequence components U1/U2/U0 and ku%) exists but is **never imported or used** anywhere in the app. The node info is displayed in two places:

1. **Map tooltip** (MapView.tsx ~line 1191) — raw HTML string showing L1/L2/L3 voltages
2. **Edit panel** (EditPanel.tsx) — Sheet sidebar when clicking a node

The user wants sequence components visible "dans le noeud" (in the node display), replacing or augmenting the circuit info.

## Plan

### 1. Add `NodePhaseDisplay` to the EditPanel (primary location)

In `EditPanel.tsx`, after the "Puissances totales du noeud" card (~line 476), import and render `<NodePhaseDisplay nodeId={selectedNode.id} />` when `editTarget === 'node'` and a node is selected. This shows the full sequence component breakdown (U1, U2, U0, ku%) in the node's edit sidebar.

### 2. Add ku% summary to the map tooltip (compact)

In `MapView.tsx` (~line 1191), after the 3-phase voltage lines, append a compact ku% line when `sequenceComponents` is available on the `phaseMetrics`:

```
L1: 228V  L2: 225V  L3: 231V
ku=1.4% ✅
```

This keeps the tooltip compact while surfacing the key EN 50160 metric. Color-coded: green < 1.5%, orange 1.5-2%, red > 2%.

### Files to modify

- **`src/components/EditPanel.tsx`** — Import `NodePhaseDisplay`, render it in the node editing section
- **`src/components/MapView.tsx`** — Add ku% line to the node tooltip HTML when `phaseMetrics.sequenceComponents` exists

