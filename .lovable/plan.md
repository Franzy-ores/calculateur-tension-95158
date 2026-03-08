

## Plan: Afficher les raccordements clients sur les graphiques Tension vs Distance (mode plein écran)

### Principe UX
- Ajouter une checkbox "Afficher raccordements clients" a cote des checkboxes existantes (lignes 751-770)
- Quand cochee : ouvrir un `Dialog` plein ecran contenant les deux graphiques tension-distance avec les points clients superposes
- Quand decochee : fermer le dialog, retour a la vue normale

### Modifications — fichier unique : `src/components/topMenu/LaboFoisonnementTab.tsx`

**1. Imports supplementaires**
- `Dialog, DialogContent` depuis `@/components/ui/dialog`
- `branchementCableTypes, getBranchementCableById, calculateGeodeticDistance` depuis `@/data/branchementCableTypes`
- `Users` depuis `lucide-react`
- `Scatter, ScatterChart` n'est pas necessaire — on utilisera des `<Line>` avec `dot` uniquement (pas de trait) pour les points clients, ou des `ReferenceDot`

**2. Nouvel etat**
```ts
const [showClientPoints, setShowClientPoints] = useState(false);
```

**3. Calcul des points clients** (`useMemo` apres `voltageDistanceData`)

Pour chaque branche, pour chaque noeud du chemin :
- Trouver les clients lies via `currentProject.clientLinks` + `currentProject.clientsImportes`
- Pour chaque client : calculer la distance branchement (`calculateGeodeticDistance` entre client et noeud), puis la chute de tension dans le cable de branchement (R*cos + X*sin) * I * L
- Cable par defaut : `selectedBranchementCableId` du store, fallback `'exvb-4x16-cu'`
- Produire un point `{ distance_m: node_dist + branch_dist, voltage: V_node - deltaV, clientName, power_kVA, isClient: true }`
- Colorer en rouge si < 207V, orange si < 218.5V, vert sinon

**4. Checkbox UI** (ligne ~770, apres les deux checkboxes existantes)
```tsx
<div className="flex items-center gap-2 px-1">
  <Checkbox id="showClientPoints" checked={showClientPoints}
    onCheckedChange={(checked) => setShowClientPoints(checked === true)} />
  <Label htmlFor="showClientPoints" className="text-xs cursor-pointer">
    <Users className="h-3 w-3 inline mr-1" />
    Afficher raccordements clients (plein ecran)
  </Label>
</div>
```

**5. Dialog plein ecran**

Quand `showClientPoints === true`, ouvrir un `<Dialog open={showClientPoints} onOpenChange={setShowClientPoints}>` avec `<DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full">`. A l'interieur :
- Selecteur de cable de branchement (petit `<Select>` en haut)
- Les deux graphiques tension-distance (Vmin charge + Vmax injection) reproduits avec `height={400}` au lieu de 280
- Sur chaque graphique, les points clients affiches via une `<Line>` supplementaire par branche, avec `dot={{ r: 4 }}` et `strokeWidth={0}` (points seuls, pas de ligne)
- Tooltip enrichi : nom du client, puissance, tension au noeud, tension au point de livraison, longueur branchement
- Legende "▼ Clients" avec code couleur conformite

**6. Import store**
- Ajouter `selectedBranchementCableId, setSelectedBranchementCableId` a la destructuration du store (ligne 147)

### Fichier modifie
- `src/components/topMenu/LaboFoisonnementTab.tsx` — ~120 lignes ajoutees (useMemo clients, checkbox, dialog fullscreen avec graphiques)

