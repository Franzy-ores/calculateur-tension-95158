

## Plan: Ajouter la courbe du courant de neutre sur les graphiques Tension vs Distance

### Contexte
Les graphiques tension-distance du Labo affichent la tension (V) en ordonnée et la distance (m) en abscisse. L'objectif est d'ajouter un **axe Y droit en Ampères** pour tracer le courant de neutre le long du réseau, uniquement pour les réseaux 400V (étoile). Ce courant est déjà calculé par le moteur BFS et disponible dans `cables[i].currentsPerPhase_A.N`.

### Approche technique

**1. Enrichir les données de chemin avec I_N (`LaboFoisonnementTab.tsx`)**

Dans `buildBranchData`, pour chaque point du chemin (sauf la source), identifier le câble entre le point courant et son parent, puis extraire `currentsPerPhase_A.N` depuis `rawResults[hour].cables`. Ajouter un champ `I_neutral` à chaque point.

Pour associer câble ↔ segment de chemin :
- Deux points consécutifs (parent → enfant) correspondent à un câble reliant ces deux nœuds
- Chercher dans `rawResults[hour].cables` le câble dont `nodeAId/nodeBId` correspond au couple de nœuds

**2. Axe Y droit + courbe neutre (Recharts)**

- Ajouter un `<YAxis yAxisId="right" orientation="right" unit=" A" />` sur chaque graphique tension-distance
- Ajouter une `<Line yAxisId="right" dataKey="I_neutral" />` en trait pointillé orange/jaune
- L'axe gauche existant garde les tensions en V (avec `yAxisId="left"`)
- Contrôlé par une checkbox "Afficher I neutre" (comme l'option per-phase existante)

**3. Mise à jour de l'interface `BranchPoint`**

Ajouter `I_neutral?: number` au type `BranchPoint` (ou au type enrichi utilisé dans `buildBranchData`).

**4. Tooltip**

Enrichir le tooltip pour afficher `I_N: XX.X A` quand la donnée est disponible.

### Ce qui reste inchangé
- Le calcul moteur (le courant neutre est déjà calculé)
- Les graphiques tension 24h (pas de notion de distance)
- L'option per-phase existante (indépendante)

### Fichiers modifiés
- `src/components/topMenu/LaboFoisonnementTab.tsx` (seul fichier)

