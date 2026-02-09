

# Plan : Rationalisation des controles de simulation et changement de noeud SRG2

## Constat actuel

| Fonctionnalite | EQUI8 | SRG2 | Cables |
|---|---|---|---|
| Switch actif/inactif par equipement | Oui | Oui | Non (bouton Simuler/Annuler) |
| Changement de noeud | Oui (Select) | Non | N/A |

## Objectif

1. **Cables** : Ajouter un Switch actif/inactif coherent avec les autres onglets, remplacant le pattern Simuler/Annuler
2. **SRG2** : Ajouter un selecteur de noeud (Select dropdown) comme EQUI8 pour pouvoir deplacer un SRG2 apres creation
3. **Harmoniser** le look des 3 onglets pour une experience uniforme

---

## Modifications techniques

### 1. `src/components/SRG2Panel.tsx` - Ajout selecteur de noeud

Dans le composant `SRG2Card`, ajouter un `Select` sous le header (comme dans `CompensatorCard` de `SimulationPanel.tsx`) :

```typescript
// Apres la ligne CardDescription (ligne 222-224)
// Ajouter un Select pour changer de noeud
<div className="flex items-center gap-2 mt-1">
  <Label className="text-xs text-muted-foreground">Noeud:</Label>
  <Select 
    value={srg2.nodeId} 
    onValueChange={(newNodeId) => {
      if (newNodeId !== srg2.nodeId) {
        updateSRG2Device(srg2.id, { nodeId: newNodeId });
      }
    }}
  >
    <SelectTrigger className="h-7 text-xs flex-1">
      <SelectValue>{node?.name || srg2.nodeId}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      {nodes.map(n => (
        <SelectItem key={n.id} value={n.id}>
          <div className="flex items-center gap-2">
            <MapPin className="h-3 w-3" />
            <span>{n.name || n.id}</span>
          </div>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

### 2. `src/components/CableReplacementSimulator.tsx` - Ajout Switch actif/inactif

Remplacer le pattern boutons "Simuler" / "Annuler" par :

**a) Bouton "Simuler"** : configure et active la simulation (comme avant)

**b) Quand actif** : afficher un **Switch** enable/disable au lieu du bouton "Annuler", pour etre coherent avec EQUI8/SRG2

```typescript
// Section "Active simulation indicator" - remplacer le bouton Annuler
{isReplacementActive && (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <CheckCircle className="h-4 w-4 text-emerald-500" />
      <span className="text-sm font-medium">Simulation active</span>
    </div>
    <div className="flex items-center gap-2">
      <Switch 
        checked={cableReplacementConfig?.enabled ?? false}
        onCheckedChange={(enabled) => {
          if (cableReplacementConfig) {
            setCableReplacementConfig({ ...cableReplacementConfig, enabled });
          }
        }}
      />
      <Button variant="ghost" size="sm" onClick={handleCancelSimulation}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  </div>
)}
```

Le bouton "Simuler" reste pour la premiere configuration. Ensuite, le Switch permet d'activer/desactiver sans perdre la config, et la corbeille supprime completement.

### 3. Import du composant Switch dans CableReplacementSimulator

Ajouter l'import `Switch` et `Trash2` depuis les composants UI.

---

## Resume des fichiers a modifier

| Fichier | Modification |
|---|---|
| `src/components/SRG2Panel.tsx` | Ajouter Select dropdown pour changer de noeud dans SRG2Card |
| `src/components/CableReplacementSimulator.tsx` | Ajouter Switch actif/inactif + bouton supprimer, remplacer le bouton Annuler |

## Resultat attendu

| Fonctionnalite | EQUI8 | SRG2 | Cables |
|---|---|---|---|
| Switch actif/inactif | Oui | Oui | **Oui (nouveau)** |
| Changement de noeud | Oui | **Oui (nouveau)** | N/A |
| Suppression | Bouton corbeille | Bouton corbeille | **Bouton corbeille (nouveau)** |

