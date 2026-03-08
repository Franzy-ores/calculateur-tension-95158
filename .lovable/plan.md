

## Plan: Graphe Tension vs Distance horaire avec curseur horloge

### Concept
Ajouter un 3e graphe Tension vs Distance dans l'onglet Labo, piloté par un curseur circulaire (horloge 0-23h). L'utilisateur tourne l'aiguille, le graphe affiche les tensions par phase (A, B, C) et le courant de neutre pour l'heure sélectionnée, en utilisant les résultats `rawContinu` (foisonnement continu, conso+prod combinées).

### Modifications

**1. Nouveau composant `src/components/ClockDial.tsx`**
- SVG circulaire représentant une horloge 24h
- 24 graduations (traits + labels 0h, 3h, 6h, ... ou toutes les heures)
- Aiguille rotative contrôlée par drag (mousedown/mousemove sur le cercle) ou click sur les graduations
- Props: `hour: number`, `onChange: (hour: number) => void`
- Calcul de l'angle: `angle = (hour / 24) * 360 - 90`
- Taille compacte (~120x120px)

**2. Mise à jour `src/components/topMenu/LaboFoisonnementTab.tsx`**

- Ajouter un state `const [clockHour, setClockHour] = useState(12)`
- Ajouter un `useMemo` pour construire les données du graphe horaire:
  ```ts
  const hourlyDistanceData = useMemo(() => {
    if (!networkPaths.length || !rawContinu.length) return null;
    // Réutilise buildBranchData(rawContinu, clockHour)
    // Calcule min/max tensions pour le domaine Y dynamique
    return { branches, minV, maxV, hour: clockHour };
  }, [networkPaths, rawContinu, clockHour]);
  ```
- Insérer une nouvelle `Card` après les 2 graphes existants (charge/injection):
  - Titre: "Tension vs Distance — Profil horaire (foisonnement continu)"
  - Layout flex: ClockDial à gauche, LineChart à droite
  - Le graphe affiche: tensions moyennes par branche (lignes pleines), phases A/B/C (pointillés si checkbox active), I_neutre sur axe droit
  - Mêmes ReferenceLine (207V, 253V, 230V) et ReferenceArea (218.5-241.5V)
  - Badge affichant l'heure et le coefficient de foisonnement à cette heure
  - Tooltip identique aux graphes existants

### Structure visuelle

```text
┌──────────────────────────────────────────────────┐
│  ⚗ Tension vs Distance — Profil horaire    14h  │
│                                                  │
│  ┌─────────┐  ┌──────────────────────────────┐   │
│  │   12    │  │                              │   │
│  │ 9  ◉ 3 │  │   LineChart (tensions +      │   │
│  │   6     │  │   courant neutre par heure)  │   │
│  └─────────┘  └──────────────────────────────┘   │
│   Horloge 24h                                    │
└──────────────────────────────────────────────────┘
```

### Fichiers modifiés/créés

| Fichier | Action |
|---|---|
| `src/components/ClockDial.tsx` | Nouveau — composant SVG horloge 24h interactive |
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Ajout state `clockHour`, useMemo `hourlyDistanceData`, nouveau graphe Card |

### Notes techniques
- `buildBranchData` existe déjà dans le composant, on le réutilise avec `rawContinu` au lieu de `rawConsoPure`/`rawProdPure`
- Le domaine Y suit la même logique dynamique que les graphes existants (scan min/max réels + marge ±5V)
- Les checkboxes "par phase" et "courant neutre" existantes s'appliquent aussi à ce nouveau graphe

