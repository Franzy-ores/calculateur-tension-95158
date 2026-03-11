

## Plan: Boutons plein écran pour les graphes Labo24

### Objectif
Ajouter un bouton "plein écran" sur chacun des 3 graphes Tension vs Distance (pire cas charge, pire cas injection, profil horaire) pour les visualiser dans une modal/dialog en grand format.

### Implémentation

**1. États pour les dialogs**
Ajouter 3 états `useState` :
- `fullscreenChargeOpen` : pour le graphe pire cas charge
- `fullscreenInjectionOpen` : pour le graphe pire cas injection  
- `fullscreenHourlyOpen` : pour le graphe profil horaire

**2. Boutons dans les CardHeader**
Pour chaque des 3 graphes Tension vs Distance, ajouter un bouton icône dans le `CardHeader` (à droite du titre) :
- Icône : `Maximize` de lucide-react
- Variante : `ghost` ou `outline` avec taille `icon`
- Action : ouvrir le Dialog correspondant

**3. Dialogs plein écran**
Créer 3 Dialogs (`max-w-[95vw] max-h-[95vh]`) qui reproduisent :
- Le même titre avec badges
- Le même contenu de graphique (LineChart avec toutes les lignes, axes, tooltips)
- Hauteur augmentée (~500-600px dans le Dialog vs 280px en ligne)

**4. Emplacements des modifications**
| Emplacement | Changement |
|---|---|
| ~Lignes 172-173 | Ajouter les 3 états useState |
| ~Ligne 966 (CardHeader pire cas charge) | Ajouter bouton Maximize |
| ~Ligne 1040 (CardHeader pire cas injection) | Ajouter bouton Maximize |
| ~Ligne 1180 (CardHeader profil horaire) | Ajouter bouton Maximize |
| ~Après ligne 1278 | Ajouter les 3 Dialogs plein écran |

**5. Code pattern**
```tsx
// État
const [fullscreenChargeOpen, setFullscreenChargeOpen] = useState(false);

// Bouton dans CardHeader
<Button variant="ghost" size="icon" onClick={() => setFullscreenChargeOpen(true)}>
  <Maximize className="h-4 w-4" />
</Button>

// Dialog
<Dialog open={fullscreenChargeOpen} onOpenChange={setFullscreenChargeOpen}>
  <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full overflow-auto">
    <DialogHeader>
      <DialogTitle>...</DialogTitle>
    </DialogHeader>
    <ResponsiveContainer width="100%" height={550}>
      <LineChart>...</LineChart>
    </ResponsiveContainer>
  </DialogContent>
</Dialog>
```

### Fichier modifié
- `src/components/topMenu/LaboFoisonnementTab.tsx`

