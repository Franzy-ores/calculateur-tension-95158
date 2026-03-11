

## Plan: Échelle Y fixe et lignes de référence normalisées pour les graphes Tension vs Distance

### Situation actuelle

Les 3 graphes Tension vs Distance (pire cas charge, pire cas injection, profil horaire) ont chacun un domaine Y **dynamique** qui s'adapte aux données. Les lignes de référence existantes sont :
- `ReferenceArea` à 218.5V–241.5V (±5%, zone grisée)
- `ReferenceLine` à 207V et 253V (±10%, rouge pointillé)
- `ReferenceLine` à 230V (gris)

### Modifications demandées

**Axe Y fixe** : Remplacer les 3 domaines dynamiques par un domaine fixe identique, centré sur 230V. Domaine proposé : **[205, 255]** pour visualiser confortablement les seuils ±10%.

**Lignes de référence normalisées** (sur les 3 graphes) :
- **±8% (211.6V / 248.4V)** : rouge pointillé (`strokeDasharray="6 4"`)
- **±10% (207V / 253V)** : rouge continu (trait plein, `strokeWidth={1.5}`)
- Supprimer la `ReferenceArea` 218.5–241.5 (l'ancien ±5%)
- Conserver la ligne 230V et la ligne Busbar

### Emplacements dans `LaboFoisonnementTab.tsx`

| Graphe | Lignes YAxis domain | Lignes ReferenceArea/ReferenceLine |
|---|---|---|
| Pire cas charge | ~982 | ~1016–1019 |
| Pire cas injection | ~1068 | ~1102–1105 |
| Profil horaire | ~1205 | ~1239–1242 |

### Détail des changements (identique sur les 3 graphes)

```tsx
// YAxis : domaine fixe
<YAxis yAxisId="left" domain={[205, 255]} ... />

// Supprimer ReferenceArea y1={218.5} y2={241.5}

// ±8% rouge pointillé
<ReferenceLine yAxisId="left" y={211.6} stroke="hsl(0, 72%, 51%)" strokeDasharray="6 4" strokeWidth={1} />
<ReferenceLine yAxisId="left" y={248.4} stroke="hsl(0, 72%, 51%)" strokeDasharray="6 4" strokeWidth={1} />

// ±10% rouge continu
<ReferenceLine yAxisId="left" y={207} stroke="hsl(0, 72%, 51%)" strokeWidth={1.5} />
<ReferenceLine yAxisId="left" y={253} stroke="hsl(0, 72%, 51%)" strokeWidth={1.5} />
```

### Fichier modifié

| Fichier | Modification |
|---|---|
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Domaine Y fixe [205, 255] + lignes ±8% pointillé rouge + ±10% continu rouge, sur les 3 graphes tension vs distance |

