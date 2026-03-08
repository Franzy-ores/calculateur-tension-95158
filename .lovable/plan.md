

## Plan: Limiter la consommation client à 80% du contractuel en mode charge

### Modification unique dans `buildClientPoints` (ligne 479)

Le courant de charge du client doit être calculé à **80% de la puissance contractuelle** (et non 100%), car c'est le niveau de charge réaliste au point de livraison. Le réseau reste calculé selon la courbe de foisonnement — seul le calcul de la tension au bout du câble de branchement est concerné.

**Ligne 479 — remplacer :**
```ts
const I_charge = (client.puissanceContractuelle_kVA * 1000) / (V_nom * ...);
```
**Par :**
```ts
const I_charge = (client.puissanceContractuelle_kVA * 0.80 * 1000) / (V_nom * ...);
```

Rien d'autre ne change : le mode injection reste à 0% conso / 100% PV, et le réseau garde son foisonnement.

### Fichier modifié
- `src/components/topMenu/LaboFoisonnementTab.tsx` — 1 ligne modifiée (ligne 479)

