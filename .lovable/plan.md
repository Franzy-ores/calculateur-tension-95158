

# Mise en evidence du noeud/client selectionne dans le profil 24H sur la carte

## Objectif

Quand un noeud ou un client est selectionne dans l'onglet "Profil 24H" (`DailyProfileTab`), le marqueur correspondant sur la carte doit etre visuellement mis en evidence avec une couleur distincte et une animation clignotante.

## Etat actuel

- `dailyProfileOptions.selectedNodeId` dans le store contient le noeud selectionne pour le profil 24H
- `selectedClientId` dans le store contient le client selectionne (utilise aussi par l'edition)
- `showClientCurve` dans DailyProfileTab indique si la courbe client est active (donc si un client est "actif" dans le profil 24H)
- Les marqueurs de noeuds sont crees dans `MapView.tsx` (lignes 726-900+) avec des `L.divIcon`
- Les marqueurs clients sont crees dans `ClientMarkers.tsx` avec des `L.divIcon`

## Approche

Ajouter un nouvel etat `dailyProfileHighlight` dans le store qui contient le noeud et/ou le client mis en evidence par le profil 24H. MapView et ClientMarkers liront cet etat pour appliquer un style special (bordure cyan vif + animation pulse CSS).

## Modifications techniques

### 1. Store (`src/store/networkStore.ts`)

Ajouter un nouvel etat :

```typescript
dailyProfileHighlightNodeId: string | null;
dailyProfileHighlightClientId: string | null;
setDailyProfileHighlight: (nodeId: string | null, clientId: string | null) => void;
```

### 2. DailyProfileTab (`src/components/topMenu/DailyProfileTab.tsx`)

Appeler `setDailyProfileHighlight` a chaque changement de selection :
- Quand `selectedNodeId` change : mettre a jour `dailyProfileHighlightNodeId`
- Quand `selectedClientId` change ET que `showClientCurve` est actif : mettre a jour `dailyProfileHighlightClientId`
- Au demontage du composant (cleanup `useEffect`) : remettre les deux a `null`

### 3. MapView (`src/components/MapView.tsx`)

Lire `dailyProfileHighlightNodeId` du store. Dans la boucle de creation des marqueurs de noeuds (ligne 726+), si `node.id === dailyProfileHighlightNodeId` :
- Ajouter un style CSS distinct : bordure cyan epaisse avec box-shadow lumineux
- Ajouter la classe CSS `animate-pulse` pour le clignotement
- Augmenter le `zIndexOffset` pour que le marqueur soit au premier plan

### 4. ClientMarkers (`src/components/ClientMarkers.tsx`)

Ajouter une prop `highlightedClientId` passee depuis MapView. Dans le rendu des marqueurs clients isoles et groupes :
- Si le client correspond au `highlightedClientId` : bordure cyan, animation pulse, taille legerement augmentee

### 5. CSS (`src/index.css`)

Ajouter un style specifique pour le marqueur mis en evidence :

```css
.daily-profile-highlight {
  animation: daily-highlight-pulse 1.5s ease-in-out infinite;
}

@keyframes daily-highlight-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(6, 182, 212, 0.6); }
  50% { box-shadow: 0 0 0 8px rgba(6, 182, 212, 0.2); }
}
```

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/store/networkStore.ts` | Ajouter `dailyProfileHighlightNodeId`, `dailyProfileHighlightClientId` et setter |
| `src/components/topMenu/DailyProfileTab.tsx` | Synchroniser la selection vers le highlight + cleanup au demontage |
| `src/components/MapView.tsx` | Lire le highlight du store, appliquer style special aux noeuds concernes |
| `src/components/ClientMarkers.tsx` | Ajouter prop `highlightedClientId`, appliquer style special |
| `src/index.css` | Ajouter l'animation `daily-highlight-pulse` |

## Comportement attendu

- Le noeud selectionne dans le profil 24H clignote en cyan sur la carte en permanence
- Si un client est selectionne pour la courbe de raccordement, il clignote egalement en cyan
- Le noeud ET le client peuvent clignoter en meme temps
- Quand on quitte l'onglet profil 24H, le clignotement s'arrete
- Le clignotement ne doit pas interferer avec les autres modes de selection (edition, routage)
