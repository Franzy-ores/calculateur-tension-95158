

# Plan: Refonte LaboFoisonnementTab en 3 niveaux + correctif build

## Contexte

Le fichier actuel `LaboFoisonnementTab.tsx` fait 1899 lignes avec tous les graphiques et paramètres affichés simultanément. L'objectif est de restructurer en 3 niveaux progressifs (Rapide / Personnalisé / Expert) tout en conservant 100% de la logique de calcul existante (3 runs, buildNetworkPaths, voltage-distance, etc.).

Il y a aussi un bug build bloquant dans `scenarioManager.ts` ligne 249 : `determineB etterScenario` (espace dans le nom de fonction).

## Correctif build immédiat

**Fichier:** `src/utils/scenarioManager.ts` ligne 249
- Remplacer `determineB etterScenario` par `determineBetterScenario`

## Architecture des 3 niveaux

```text
LaboFoisonnementTab
├── viewMode state: 'rapid' | 'custom' | 'expert'
├── Toute la logique de calcul existante (inchangée)
│   ├── 3 runs DailyProfileCalculator
│   ├── powerData, voltage24hData, voltageDistanceData
│   ├── clientPointsData, networkPaths
│   └── voltageRange, peakSummary
├── Niveau 1 — Rapide (inline)
│   ├── Config minimale: saison + météo + bouton "Analyser"
│   ├── Alerte violations (criticalPointsDetector)
│   ├── Graphique tension 24h avec zones ±5%/±10%
│   └── Bouton → Niveau 2
├── Niveau 2 — Personnalisé (inline)
│   ├── Breadcrumb navigation
│   ├── Tous paramètres existants (cluster, formule K(N), VE, PAC)
│   ├── Graphiques puissance + tension 24h
│   ├── Comparaison avant/après (baseline vs current)
│   └── Boutons ← Niveau 1 / → Niveau 3
└── Niveau 3 — Expert (inline)
    ├── Breadcrumb navigation
    ├── Graphiques tension-distance (charge/injection/horaire)
    ├── ClockDial + analyse par heure
    ├── Tableau horaire détaillé
    ├── Export CSV + sauvegarde scénario
    ├── Dialogs plein écran (existants)
    └── Bouton ← Niveau 2
```

## Étapes d'implémentation

### Étape 1 — Fix build error
Corriger le typo dans `scenarioManager.ts` ligne 249.

### Étape 2 — Ajouter states et imports
Dans `LaboFoisonnementTab.tsx`:
- Ajouter `viewMode` state
- Ajouter `analysisCompleted` state (true dès que les calculs tournent, ce qui est déjà automatique via useMemo)
- Ajouter `baselineResults` state pour stocker la première configuration analysée
- Ajouter `savedScenarios` state + useEffect pour charger au montage
- Importer `detectCriticalPoints`, `exportToCSV`, `saveScenario`, `loadAllScenarios`, `deleteScenario`
- Importer `ScenarioConfiguration` type

### Étape 3 — CriticalPoints useMemo
Ajouter un `criticalPointsAnalysis` useMemo basé sur `voltageContinu` qui appelle `detectCriticalPoints(voltageContinu, 230)`.

### Étape 4 — Restructurer le JSX en 3 vues
Toute la logique de calcul (useMemo, useEffect, callbacks) reste au niveau du composant parent. Seul le rendu JSX est conditionnel selon `viewMode`.

**Niveau 1 — Rapide:**
- Layout simple 1 colonne
- Carte config: saison + météo (boutons existants)
- Résultats automatiques (pas de bouton "Analyser" car les calculs sont déjà réactifs via useMemo)
- Alerte violations avec badges (warning/critical count)
- Graphique tension 24h avec ReferenceArea ±5%/±10% (réutilise le graphique existant)
- Bouton "Personnaliser →"

**Niveau 2 — Personnalisé:**
- Breadcrumb: Rapide > Personnalisé
- Layout 2 colonnes (paramètres | graphiques)
- Col paramètres: tous les paramètres existants (nœud, cluster, K(N), VE, PAC, simulation toggle)
- Col graphiques: puissance 24h + tension 24h
- Section comparaison: si `baselineResults` existe, afficher deltas (ΔV max, Δ violations)
- Navigation: ← Rapide / Expert →

**Niveau 3 — Expert:**
- Breadcrumb: Rapide > Personnalisé > Expert
- Graphiques tension-distance (charge, injection, horaire avec ClockDial)
- Checkboxes existantes (per-phase, neutral current, client points)
- Tableau horaire détaillé
- Boutons export CSV + sauvegarde scénario
- Dialogs plein écran existants
- Navigation: ← Personnalisé

### Étape 5 — Handlers export/scénario
- `handleExportCSV`: appelle `exportToCSV(voltageContinu, rawContinu, { projectName, filename })`
- `handleSaveScenario`: prompt nom, appelle `saveScenario(name, config, voltageContinu)`, refresh liste
- `handleLoadScenarios`: `useEffect(() => setSavedScenarios(loadAllScenarios()), [])`

### Étape 6 — Baseline comparison
- Quand l'utilisateur change de niveau Rapide → Personnalisé pour la première fois, capturer `voltageContinu` comme `baselineResults`
- Calculer deltas: ΔV min, ΔV max, Δ violations ±5%, Δ violations ±10%

## Contraintes respectées

- Toute la logique de calcul (3 runs, BFS, buildNetworkPaths, buildClientPoints, getNodeVoltagePerPhase) reste identique et au même niveau
- Couleurs BRANCH_COLORS inchangées
- Tous les useMemo existants conservés
- TypeScript strict
- Transitions entre niveaux = simple changement de state, pas de rechargement
- Les dialogs plein écran restent en dehors du conditionnel (toujours montés)

## Fichiers modifiés

1. `src/utils/scenarioManager.ts` — fix typo ligne 249
2. `src/components/topMenu/LaboFoisonnementTab.tsx` — restructuration JSX en 3 niveaux + nouveaux imports/states/handlers

