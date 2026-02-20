

# Harmonisation de la reference de conformite EN50160 entre modes equilibre et desequilibre

## Probleme

Le BFS per-phase (mode desequilibre) calcule deux conformites avec des references differentes :

1. `compliance` (ligne 1798) : basee sur `U_nom` = tension nominale du type de connexion (ex: 230V, 400V). Coherent avec le mode equilibre.
2. `nodeCompliance` (lignes 1909-1921) : basee sur `U_ref` qui, dans la branche `else` (ligne 1888), peut utiliser `tensionCible` au lieu de la tension nominale.

Le mode simplifie (equilibre, ligne 2249) n'utilise que `U_nom`.

Le `finalCompliance` (ligne 1954) prend le pire des deux, ce qui introduit une asymetrie : un meme reseau peut etre juge conforme dans un mode et non-conforme dans l'autre, simplement parce que la reference change.

### Portee reelle du bug

Pour les types courants (`TETRA_3P+N_230_400V`, `TRI_230V_3F`, `MONO_230V_PN`), `U_ref` est fixe a 230V (lignes 1863, 1870, 1877), donc coherent avec `U_nom`. Le bug ne touche que la branche `else` (lignes 1879-1893), qui utilise `tensionCible` comme reference pour les types non-standard.

## Solution

Aligner la reference de conformite EN50160 du mode desequilibre sur celle du mode equilibre : toujours utiliser `U_nom` (tension nominale du type de connexion) comme denominateur pour les seuils 8%/10%.

La `tensionCible` reste utilisee pour :
- Le calcul du Vslack (tension de depart du BFS)
- L'affichage de la chute de tension relative (`deltaU_pct`)

Mais **pas** pour la conformite EN50160, qui doit etre evaluee par rapport a la tension nominale normative.

## Modifications techniques

### Fichier : `src/utils/electricalCalculations.ts`

**Branche `else` du calcul U_ref (lignes 1879-1893)** :

Remplacer la logique qui utilise `tensionCible` comme `U_ref` par la tension nominale :

Avant :
```typescript
} else {
  const scaleLine = this.getDisplayLineScale(n.connectionType);
  Va_display = Va_phase * scaleLine;
  Vb_display = Vb_phase * scaleLine;
  Vc_display = Vc_phase * scaleLine;
  
  const sourceNode = nodes.find(s => s.isSource);
  if (sourceNode?.tensionCible) {
    U_ref = sourceNode.tensionCible;
  } else {
    const { U_base } = this.getVoltage(n.connectionType);
    U_ref = U_base;
  }
}
```

Apres :
```typescript
} else {
  const scaleLine = this.getDisplayLineScale(n.connectionType);
  Va_display = Va_phase * scaleLine;
  Vb_display = Vb_phase * scaleLine;
  Vc_display = Vc_phase * scaleLine;
  
  // EN50160 : conformite toujours evaluee par rapport a la tension nominale
  // (tensionCible est utilisee pour le BFS/Vslack, pas pour la conformite)
  const { U_base } = this.getVoltage(n.connectionType);
  U_ref = U_base;
}
```

## Impact

- La conformite EN50160 sera desormais evaluee contre la meme reference (U_nom) dans les deux modes
- L'affichage des tensions et le calcul BFS ne changent pas (tensionCible continue a piloter le Vslack)
- Pour les types courants (TETRA, TRI, MONO), aucun changement car U_ref etait deja 230V
- Pour les types non-standard dans la branche `else`, la conformite sera evaluee contre U_base au lieu de tensionCible

## Fichier modifie

| Fichier | Lignes | Modification |
|---|---|---|
| `src/utils/electricalCalculations.ts` | 1886-1893 | Supprimer l'utilisation de tensionCible dans U_ref, utiliser U_base systematiquement |

