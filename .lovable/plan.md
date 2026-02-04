

# Plan : Restructuration compacte de l'onglet Paramètres

## Objectif
Réduire l'espace vertical occupé tout en conservant toutes les informations existantes.

## Analyse de l'existant

| Composant | Hauteur estimée | Contenu |
|-----------|----------------|---------|
| Card Foisonnement | ~200px | Scénario + 3 sliders + totaux |
| Sliders de phase | ~150px | 2 groupes de 3 barres verticales |
| Alertes fortes puissances | ~200px | Grille 3 colonnes L1/L2/L3 |
| Résumé foisonnement | ~120px | Détail MONO/POLY par type |
| Tableau récapitulatif | ~180px | 11 colonnes, 3 lignes de données |

**Total déployé : ~850px de hauteur**

---

## Solution proposée : Layout en 2 rangées compactes

### Rangée 1 : Contrôles (toujours visible)

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ [Scénario ▼]  │  🏠 Rés. ═══●═══ 15%  │  🏭 Ind. ═══●═══ 70%  │  ☀️ Prod ═══●═══ 100%  │
│               │  180→27 kVA          │  150→105 kVA         │  36→36 kVA            │
├───────────────┼──────────────────────────────────────────────────────────────────────┤
│ Déséquilibre  │  Charges: [L1] [L2] [L3]   │   Productions: [L1] [L2] [L3]           │
│ ⟲ Reset       │  +2%   -1%   +5%           │   +0%   +3%   -2%                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Caractéristiques :**
- Sliders horizontaux au lieu de verticaux pour les phases (gain de ~80px)
- Scénario + foisonnement sur une seule ligne
- Affichage compact des écarts de phase (valeurs numériques uniquement)

### Rangée 2 : Détails (collapsible avec accordéon)

```text
┌─ [v] Récapitulatif par couplage ────────────────────────────────────────────────────┐
│  L1-L2 │ 15 MONO │ 60.0 kVA MONO │ 12.0 Poly Rés │ 35.0 Poly Ind │ 36.2 kVA │ 8.5A │
│  L2-L3 │ 12 MONO │ 48.0 kVA MONO │ 12.0 Poly Rés │ 35.0 Poly Ind │ 33.8 kVA │ 7.2A │
│  L3-L1 │ 18 MONO │ 72.0 kVA MONO │ 12.0 Poly Rés │ 35.0 Poly Ind │ 37.5 kVA │ 9.1A │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─ [v] Foisonnement détaillé ─────────────────────────────────────────────────────────┐
│  🏠 Résidentiel (15%): MONO 45 clients 180→27 kVA │ TRI 3 clients 36→5.4 kVA        │
│  🏭 Industriel (70%): TRI/TÉTRA 5 clients 150→105 kVA                               │
│  Total: 137.4 kVA foisonné                                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─ [v] Alertes fortes puissances ─────────────────────────────────────────────────────┐
│  ⚠️ L1: 2 clients (15 kVA)  │  L2: 0  │  L3: 1 client (12 kVA)                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Caractéristiques :**
- 3 sections en accordéon (une seule ouverte à la fois)
- Tableau réduit à 7 colonnes essentielles (au lieu de 11)
- Alertes condensées en une ligne

---

## Modifications techniques

### Fichier : `src/components/topMenu/ParametersTab.tsx`

| Modification | Description |
|--------------|-------------|
| Layout horizontal | Remplacer les 2 Cards côte à côte par un layout en rangées empilées |
| Sliders horizontaux pour phases | Remplacer les barres verticales par des sliders horizontaux compacts |
| Accordéon pour sections détaillées | Utiliser `Accordion` au lieu de `Collapsible` pour les 3 sections |
| Supprimer duplication | Le résumé foisonnement intégré dans la rangée 1 rend la Card séparée obsolète |

### Fichier : `src/components/PhaseDistributionSliders.tsx`

| Modification | Description |
|--------------|-------------|
| Orientation horizontale | Changer `orientation="vertical"` en layout horizontal |
| Affichage compact | Retirer les barres de progression visuelles, garder slider + valeur |
| Hauteur réduite | Passer de 120px à ~50px par groupe |

### Fichier : `src/components/PhaseDistributionDisplay.tsx`

| Modification | Description |
|--------------|-------------|
| Tableau 7 colonnes | Supprimer: "Prod. foisonné", "Ch. contrat", "Prod (kVA)" séparée |
| Colonnes conservées | Couplage, Nb MONO, Ch. MONO, Ch. Poly Rés, Ch. Poly Ind, Ch. déséq, Courant |
| Alertes condensées | Une seule ligne avec badges colorés au lieu de la grille 3 colonnes |
| Accordéon | Wrapper les 3 sections dans `AccordionItem` |

---

## Gain d'espace estimé

| Section | Avant | Après | Gain |
|---------|-------|-------|------|
| Foisonnement + Scénario | 200px | 80px | -120px |
| Sliders de phase | 150px | 50px | -100px |
| Tableau récapitulatif | 180px | 120px | -60px |
| Alertes fortes puissances | 200px | 40px (collapsé) | -160px |
| Résumé foisonnement | 120px | 40px (collapsé) | -80px |
| **TOTAL** | **~850px** | **~330px** | **-520px (~60%)** |

---

## Wireframe final

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PARAMÈTRES                                                                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Scénario ─┐  ┌─ Foisonnement ─────────────────────────────────────────────────────┐  │
│ │ ⚡ Mixte ▼ │  │ 🏠 ══●══ 15%  │  🏭 ══●══ 70%  │  ☀️ ══●══ 100%  │ Total: 137 kVA │  │
│ └────────────┘  │ 180→27        │  150→105       │  36→36          │                │  │
│                 └────────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Déséquilibre (%) ─────────────────────────────────────────────────────────────────┐  │
│ │ Charges:     L1-L2 ══●══ +2%  │  L2-L3 ══●══ -1%  │  L3-L1 ══●══ +5%     [⟲ Reset] │  │
│ │ Productions: L1-L2 ══●══ +0%  │  L2-L3 ══●══ +3%  │  L3-L1 ══●══ -2%     [⟲ Reset] │  │
│ └────────────────────────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ ▶ Récapitulatif par couplage                                                   [Table] │
│ ▶ Foisonnement détaillé (MONO/POLY)                                            [Stats] │
│ ▶ Alertes fortes puissances MONO                                           [⚠️ 3 L1]   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Fichiers à modifier

1. **`src/components/topMenu/ParametersTab.tsx`**
   - Refactorer le layout en rangées horizontales
   - Intégrer les sliders de foisonnement inline
   - Ajouter composant Accordion pour les sections détaillées

2. **`src/components/PhaseDistributionSliders.tsx`**
   - Convertir les sliders verticaux en horizontaux
   - Réduire la hauteur globale du composant

3. **`src/components/PhaseDistributionDisplay.tsx`**
   - Réduire le tableau à 7 colonnes essentielles
   - Condenser les alertes en badges inline
   - Wrapper les sections dans AccordionItems

## Bénéfices

- Gain de 60% d'espace vertical
- Toutes les informations restent accessibles
- Interface plus scannable (contrôles en haut, détails à la demande)
- Accordéon permet de voir une section détaillée sans encombrer

