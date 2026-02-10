

# Plan : Ajout du total foisonne production dans l'onglet Parametres

## Modification

Fichier : `src/components/topMenu/ParametersTab.tsx`

Dans la section "Total" (lignes 144-148), ajouter une deuxieme ligne affichant le total foisonne des productions a cote du total foisonne des charges.

### Code actuel (lignes 144-148)
```typescript
<div className="flex flex-col items-end justify-center px-2 border-l border-border/50">
  <span className="text-[10px] text-muted-foreground">Total foisonné</span>
  <span className="text-sm font-bold text-primary">{totalChargesFoisonnees.toFixed(1)} kVA</span>
</div>
```

### Code modifie
```typescript
<div className="flex flex-col items-end justify-center px-2 border-l border-border/50">
  <span className="text-[10px] text-muted-foreground">Charges foisonnees</span>
  <span className="text-sm font-bold text-primary">{totalChargesFoisonnees.toFixed(1)} kVA</span>
  <span className="text-[10px] text-muted-foreground mt-0.5">Productions foisonnees</span>
  <span className="text-sm font-bold text-yellow-500">{productionsFoisonnees.toFixed(1)} kVA</span>
</div>
```

La valeur `productionsFoisonnees` est deja calculee a la ligne 53 du fichier, il suffit de l'afficher.

