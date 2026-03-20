

# Refonte Labo Foisonnement — Page unique moderne

## Concept

Abandonner les 3 niveaux (Rapide/Personnalisé/Expert) au profit d'une page unique avec un layout dashboard compact. Toutes les fonctionnalités restent accessibles sans navigation, organisées en sections visuellement distinctes avec des collapsibles pour les zones secondaires.

## Layout proposé

```text
┌──────────────────────────────────────────────────────────────┐
│  BARRE DE CONTRÔLE (sticky, compact, 1 ligne)               │
│  [Nœud ▼] [❄️|☀️] [☀️|☁️] [Cluster ▼] [Simulation ○]      │
│  [VE: 0% ▼] [PAC: 0% ▼] [Export ↓] [Save 💾]              │
└──────────────────────────────────────────────────────────────┘
┌─ ALERTES (conditionnel) ────────────────────────────────────┐
│  ⚠ 3 violations ±5%  ⛔ 1 violation ±10%  Heures: 18h, 19h │
│  ✅ ou: Réseau conforme EN 50160                             │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────┬───────────────────────────────────┐
│  SYNTHÈSE (sidebar)     │  GRAPHIQUES (zone principale)     │
│  ┌────────────────────┐  │  ┌─────────────────────────────┐  │
│  │ Puissances         │  │  │ Puissance nodale 24h        │  │
│  │ Pic charge: X kVA  │  │  │ [graphique recharts]        │  │
│  │ Pic net: X kVA     │  │  └─────────────────────────────┘  │
│  ├────────────────────┤  │  ┌─────────────────────────────┐  │
│  │ Tensions           │  │  │ Tension nodale 24h          │  │
│  │ V min: X V         │  │  │ [graphique + zones ±5/±10]  │  │
│  │ V max: X V         │  │  └─────────────────────────────┘  │
│  │ A: X…X V           │  │  ┌─────────────────────────────┐  │
│  │ B: X…X V           │  │  │ Tension vs Distance         │  │
│  │ C: X…X V           │  │  │ [Charge] [Injection] [Hour] │  │
│  ├────────────────────┤  │  │ (tabs internes)             │  │
│  │ Foisonnement K(N)  │  │  └─────────────────────────────┘  │
│  │ a=0.13  N=X        │  │  ┌─────────────────────────────┐  │
│  │ Continu: 0.XXXX    │  │  │ Tableau horaire détaillé    │  │
│  │ [sliders a, N]     │  │  │ (collapsible)               │  │
│  ├────────────────────┤  │  └─────────────────────────────┘  │
│  │ Comparaison Δ      │  │                                   │
│  │ (si baseline)      │  │                                   │
│  └────────────────────┘  │                                   │
└──────────────────────────┴───────────────────────────────────┘
```

## Changements structurels

### 1. Supprimer le state `viewMode` et toute la navigation par niveaux
- Plus de `renderRapidView()`, `renderCustomView()`, `renderExpertView()`
- Plus de breadcrumbs, boutons "Personnaliser →", "← Retour"
- Tout le JSX dans un seul render

### 2. Barre de contrôle compacte (sticky top)
Une seule barre horizontale regroupant TOUS les contrôles en mode compact (h-7/h-8):
- **Ligne 1**: Sélecteur nœud + Saison (toggle) + Météo (toggle) + Cluster (dropdown) + Simulation switch
- **Ligne 2**: VE pénétration (mini slider inline) + VE puissance (3.7/11/22) + PAC pénétration + PAC puissance + Boutons Export/Save/Reset
- Popovers pour les paramètres avancés (formule K(N) avec sliders a/N, profil editor)

### 3. Zone principale: grille 2 colonnes
- **Colonne gauche (w-64 fixe)**: Synthèse verticale compacte
  - Carte alertes violations
  - Bloc puissances (pic charge, pic net)
  - Bloc tensions (min/max par phase)
  - Bloc foisonnement K(N) avec sliders
  - Bloc comparaison baseline (conditionnel)
  - Scénarios sauvegardés (collapsible)

- **Colonne droite (flex-1)**: Graphiques empilés
  - Puissance nodale 24h
  - Tension nodale 24h (avec zones ±5%/±10%)
  - Tension vs Distance avec sous-tabs internes (Charge | Injection | Horaire) au lieu de 3 cards séparées
  - Tableau horaire détaillé (collapsible, fermé par défaut)

### 4. Graphiques Tension vs Distance: sous-tabs
Remplacer les 3 cards séparées + ClockDial par un seul composant avec tabs internes:
- Tab "Charge" → pire cas charge
- Tab "Injection" → pire cas injection  
- Tab "Horaire" → profil horaire avec ClockDial intégré dans le header du tab
- Checkboxes (per-phase, I_N, clients) dans le header commun

### 5. Options d'affichage
Les checkboxes (per-phase, neutral current, client points) dans une barre horizontale au-dessus des graphiques distance, pas dans un niveau séparé.

## Fichier modifié

`src/components/topMenu/LaboFoisonnementTab.tsx` — refonte complète du JSX. Toute la logique de calcul (useMemo, useEffect, callbacks, fonctions utilitaires) reste identique et inchangée.

## Esthétique

- Style compact existant: `bg-card/80 backdrop-blur`, `border-border/50`, `text-xs`
- Pas de Cards lourdes pour la barre de contrôle — juste un `div` avec border-bottom
- Graphiques avec hauteur réduite (220-250px au lieu de 280-300px) pour tout voir sans trop scroller
- Collapsibles pour tableau horaire et scénarios sauvegardés
- Popovers pour paramètres avancés (K(N), profils) au lieu de sections déployées

