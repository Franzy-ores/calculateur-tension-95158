
# Plan : Couleur jaune clair pour les nœuds Production en situation normale

## Contexte

Actuellement, les nœuds avec **production seule** utilisent la couleur verte (`bg-voltage-normal`) en situation normale (≤8% de déviation de tension). Cette couleur est la même que celle des nœuds sans anomalie, ce qui ne distingue pas visuellement les nœuds producteurs.

Vous souhaitez que les nœuds avec production soient affichés en **jaune clair** en situation normale, comme les nœuds mixtes.

## Modifications prévues

### Fichier : `src/components/MapView.tsx`

La logique de couleur des nœuds sera modifiée dans la section qui détermine `iconClass` pour les nœuds avec production seule :

| Type de nœud | Situation | Avant | Après |
|--------------|-----------|-------|-------|
| Production seule (P) | ≤8% (normale) | Vert (`bg-voltage-normal`) | Jaune clair (`bg-yellow-300`) |
| Production seule (P) | 8-10% (warning) | Orange (inchangé) | Orange (inchangé) |
| Production seule (P) | >10% (critique) | Rouge (inchangé) | Rouge (inchangé) |

### Détail technique

Modifier les lignes 853-861 :

```text
AVANT:
  } else if (hasProduction) {
    iconContent = 'P';
    if (Math.abs(nominalDropPercent) <= 8) {
      iconClass = 'bg-voltage-normal border-green-600 text-white';
    } ...

APRÈS:
  } else if (hasProduction) {
    iconContent = 'P';
    if (Math.abs(nominalDropPercent) <= 8) {
      iconClass = 'bg-yellow-300 border-yellow-500 text-gray-800';
    } ...
```

### Cohérence visuelle

| Type nœud | Couleur normale | Code couleur |
|-----------|-----------------|--------------|
| Source (400V) | Fuchsia | `bg-fuchsia-500` |
| Source (230V) | Cyan | `bg-cyan-500` |
| Charge seule (C) | Bleu | `bg-blue-500` |
| Production seule (P) | **Jaune clair** | `bg-yellow-300` |
| Mixte (M) | Jaune | `bg-yellow-500` |
| Non alimenté | Gris | `bg-gray-400` |

Le jaune clair (`yellow-300`) est plus pâle que le jaune (`yellow-500`) des nœuds mixtes, créant une distinction visuelle claire entre production seule et mixte.

## Impact

- Changement visuel uniquement sur la carte
- Aucun impact sur les calculs
- Améliore la lisibilité : les nœuds producteurs sont immédiatement identifiables
