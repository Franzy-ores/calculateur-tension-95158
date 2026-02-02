
# Plan : Rationalisation de l'éditeur de profils horaires

## Problèmes identifiés

| Problème | Impact |
|----------|--------|
| **24 sliders verticaux** | Sur petit écran, impossible de voir toute la journée sans scroller |
| **Zone défilante cachée** | Partie inférieure des heures (12h-23h) invisible sans action utilisateur |
| **Sélecteur de profil noyé** | Les contrôles Saison + Type + Modèle sont sur une même ligne, peu lisible |
| **Graphique trop petit** | Hauteur fixe de 120px, difficile à analyser |
| **Ajustement global encombrant** | Occupe beaucoup de place avec peu d'usage |

## Solution proposée : Interface compacte et responsive

### 1. Nouvelle disposition des heures : grille 6x4

Au lieu de 2 colonnes de 12 sliders, utiliser une grille compacte avec sliders horizontaux miniatures :

```text
┌──────────────────────────────────────────────────────────────┐
│  00h [▓▓░░░░░] 15%   01h [▓░░░░░░] 10%   02h [▓░░░░░░] 8%   │
│  03h [▓░░░░░░] 8%    04h [▓░░░░░░] 10%   05h [▓▓░░░░░] 18%  │
│  06h [▓▓▓░░░░] 30%   07h [▓▓▓▓░░░] 45%   08h [▓▓▓▓▓░░] 55%  │
│  09h [▓▓▓▓░░░] 50%   10h [▓▓▓░░░░] 35%   11h [▓▓▓░░░░] 30%  │
│  12h [▓▓▓░░░░] 28%   13h [▓▓▓░░░░] 28%   14h [▓▓▓░░░░] 30%  │
│  15h [▓▓▓░░░░] 32%   16h [▓▓▓▓░░░] 45%   17h [▓▓▓▓▓░░] 60%  │
│  18h [▓▓▓▓▓▓░] 75%   19h [▓▓▓▓▓▓▓] 85%   20h [▓▓▓▓▓▓░] 72%  │
│  21h [▓▓▓▓▓░░] 58%   22h [▓▓▓▓░░░] 42%   23h [▓▓▓░░░░] 28%  │
└──────────────────────────────────────────────────────────────┘
```

- **Desktop** : 6 colonnes × 4 lignes (toutes les heures visibles)
- **Tablette** : 4 colonnes × 6 lignes
- **Mobile** : 3 colonnes × 8 lignes

### 2. Composant HourlySlider compact

Remplacer le slider actuel par un composant condensé :

```text
┌────────────────────────┐
│ 18h [▓▓▓▓▓▓▓░░░] 75%  │
└────────────────────────┘
```

- Label d'heure intégré (2 caractères)
- Slider horizontal miniature
- Valeur en % sur 3 caractères
- Click pour édition directe
- Pas de champ input séparé

### 3. Graphique plus grand et interactif

- Augmenter la hauteur de 120px à 180px
- Permettre le clic sur le graphique pour modifier une valeur
- Afficher les 24 heures avec labels plus clairs

### 4. Interface réorganisée

```text
┌────────────────────────────────────────────────────────────────────┐
│  🌡️ Éditeur de profils horaires                                   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  [❄️ Hiver] [☀️ Été]     [Résidentiel ▼]     [Modèle... ▼]        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │               📊 GRAPHIQUE PRÉVISUALISATION                  │  │
│  │                    (hauteur 180px)                           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  00h ▓░░ 15   01h ▓░░ 10   02h ▓░░ 8    03h ▓░░ 8           │  │
│  │  04h ▓░░ 10   05h ▓▓░ 18   06h ▓▓▓ 30   07h ▓▓▓ 45          │  │
│  │  08h ▓▓▓ 55   09h ▓▓▓ 50   10h ▓▓▓ 35   11h ▓▓░ 30          │  │
│  │  12h ▓▓░ 28   13h ▓▓░ 28   14h ▓▓░ 30   15h ▓▓░ 32          │  │
│  │  16h ▓▓▓ 45   17h ▓▓▓ 60   18h ▓▓▓ 75   19h ▓▓▓ 85          │  │
│  │  20h ▓▓▓ 72   21h ▓▓▓ 58   22h ▓▓▓ 42   23h ▓▓░ 28          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ Ajustement rapide ──────────────────────────────────────────┐  │
│  │  [×0.5] [×0.8] [×1.0] [×1.2] [×1.5]   Cible: [Tous ▼]       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  [📥 Importer] [📤 Exporter]    [↩️ Reset] [Annuler] [✓ Sauver]   │
└────────────────────────────────────────────────────────────────────┘
```

### 5. Ajustement automatique simplifié

Remplacer le slider 10%-200% par des boutons préréglés :

| Bouton | Action |
|--------|--------|
| **×0.5** | Réduire de 50% |
| **×0.8** | Réduire de 20% |
| **×1.0** | Réinitialiser |
| **×1.2** | Augmenter de 20% |
| **×1.5** | Augmenter de 50% |

Plus un menu déroulant pour cibler un profil spécifique ou tous.

## Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `src/components/ProfileVisualEditor.tsx` | Refonte complète de la disposition |
| `src/components/HourlySlider.tsx` | Version compacte pour grille |
| `src/components/ProfilePreviewChart.tsx` | Augmenter hauteur + interactivité optionnelle |

## Nouveau composant : CompactHourlySlider

```typescript
interface CompactHourlySliderProps {
  hour: number;
  value: number;
  onChange: (value: number) => void;
}

// Affichage : "18h ▓▓▓▓▓░░ 75"
// Interaction : drag sur la barre ou clic pour popup d'édition
```

## Bénéfices attendus

| Avant | Après |
|-------|-------|
| Scroll obligatoire pour voir 24h | Vision complète en un coup d'œil |
| Interface encombrée | Interface épurée et lisible |
| Ajustement global complexe | Boutons rapides préréglés |
| Graphique petit | Graphique agrandi 50% |
| Non responsive | Adapté mobile/tablette/desktop |

## Implémentation

### Phase 1 : Composant CompactHourlySlider
- Nouveau composant compact avec barre de progression visuelle
- Interaction drag ou clic pour modifier

### Phase 2 : Grille responsive
- CSS Grid avec breakpoints : 6/4/3 colonnes
- Suppression du ScrollArea pour les heures

### Phase 3 : Boutons multiplicateurs
- Remplacement du slider par boutons préréglés
- Simplification du flux utilisateur

### Phase 4 : Graphique agrandi
- Hauteur 180px au lieu de 120px
- Labels d'heures plus visibles

