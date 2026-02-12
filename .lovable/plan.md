

# Plan : Deplacer cos phi et nom du projet dans l'onglet Reseau

## Objectif

Rendre editables dans l'onglet **Reseau** :
1. Le **nom du projet** (actuellement non editable dans cet onglet)
2. Le **cos phi Charges** (actuellement affiche en lecture seule dans NetworkTab, lignes 126-128)
3. Le **cos phi Productions** (idem)

## Modification

**Fichier unique : `src/components/topMenu/NetworkTab.tsx`**

### 1. Remplacement de l'affichage lecture seule cos phi

Les lignes 125-128 affichent actuellement :
```
cos phi Charges: 0.95
cos phi Productions: 1.00
```
en texte simple. Elles seront remplacees par deux champs `<Input type="number">` editables (step 0.01, min 0.80, max 1.00) qui appelleront `updateProjectConfig({ cosPhiCharges: value })` et `updateProjectConfig({ cosPhiProductions: value })`.

### 2. Ajout du nom de projet editable

Une nouvelle **Card** (ou section en haut de la grille) contiendra un champ `<Input>` lie a `currentProject.name`, avec `updateProjectConfig({ name: value })` au changement. Ce champ sera place en premier dans la grille pour une visibilite immediate.

### 3. Import supplementaires

Ajouter `Input` depuis `@/components/ui/input` et l'icone `FileText` depuis `lucide-react`.

### Resume visuel

```text
┌─ Projet ─────────┬─ Systeme de tension ──────────┬─ Tension source ──┬─ Modele de charge ─┐
│ Nom: [Mon projet] │ 400V Tri / Transfo            │ Slider V          │ Select modele      │
│                   │ cos phi Ch: [0.95]             │ Busbar info       │                    │
│                   │ cos phi Pr: [1.00]             │                   │                    │
└───────────────────┴───────────────────────────────-┴───────────────────┴────────────────────┘
```

### Detail technique

| Element | Composant | Props |
|---|---|---|
| Nom projet | `<Input>` | `value={currentProject.name}`, `onChange` -> `updateProjectConfig({ name })` |
| cos phi Charges | `<Input type="number">` | `min=0.80, max=1.00, step=0.01`, `onChange` -> `updateProjectConfig({ cosPhiCharges })` |
| cos phi Productions | `<Input type="number">` | `min=0.80, max=1.00, step=0.01`, `onChange` -> `updateProjectConfig({ cosPhiProductions })` |

Un recalcul (`updateAllCalculations()`) sera declenche apres modification des cos phi.

