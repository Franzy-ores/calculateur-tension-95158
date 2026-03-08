

## Plan: Arrondir les tensions à 1 décimale sur l'axe Y

### Problème
Les ticks de l'axe Y affichent des valeurs brutes non arrondies (ex: `244.8200062052674V`).

### Correction — `src/components/topMenu/LaboFoisonnementTab.tsx`

Ajouter `tickFormatter={(v: number) => v.toFixed(1)}` sur tous les `<YAxis>` des graphes tension-distance (charge et injection), dans les vues inline et fullscreen.

**Lignes concernées** (4 occurrences YAxis tension) :
- Ligne ~960 (charge inline)
- Ligne ~1043 (injection inline)  
- Ligne ~1157 (charge fullscreen)
- Ligne ~1244 (injection fullscreen)

Exemple de modification :
```tsx
<YAxis yAxisId="left"
  domain={[...]}
  tick={{ fontSize: 10 }}
  tickFormatter={(v: number) => v.toFixed(1)}
  unit=" V" />
```

### Fichier modifié
| Fichier | Modification |
|---|---|
| `LaboFoisonnementTab.tsx` | +1 prop `tickFormatter` sur 4 `<YAxis>` |

