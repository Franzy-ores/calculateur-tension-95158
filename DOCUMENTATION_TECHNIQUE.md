# Documentation Technique - Calculateur de Chute de Tension

**Version : 10 février 2026** — Date de référence pour le développement.

---

## 1. Vue d'ensemble

Cette application permet de calculer les chutes de tension dans un réseau électrique basse tension (BT) en créant visuellement des nœuds et des câbles sur une carte interactive, puis en générant des rapports PDF détaillés. Elle intègre des modules de simulation (EQUI8, SRG2) pour l'optimisation du réseau.

## 2. Architecture

### Technologies utilisées
- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui components
- **Cartographie**: Leaflet + OpenStreetMap
- **État global**: Zustand
- **PDF**: jsPDF + html2canvas
- **Calculs**: Classes TypeScript personnalisées

### Structure des dossiers
```
src/
├── components/           # Composants React
│   ├── ui/              # Composants UI réutilisables (shadcn)
│   ├── topMenu/         # Onglets du menu supérieur
│   ├── MapView.tsx      # Carte interactive principale
│   ├── ResultsPanel.tsx # Panneau des résultats
│   ├── EditPanel.tsx    # Panneau d'édition nœuds/câbles
│   ├── SimulationPanel.tsx # Panneau de simulation
│   └── ...
├── store/               # Gestion d'état Zustand
│   └── networkStore.ts  # Store principal du réseau
├── types/               # Définitions TypeScript
│   ├── network.ts       # Types du réseau électrique
│   ├── srg2.ts          # Types SRG2
│   └── dailyProfile.ts  # Types profils journaliers
├── utils/               # Utilitaires et moteurs de calcul
│   ├── electricalCalculations.ts  # Moteur BFS principal
│   ├── simulationCalculator.ts    # Extension simulation
│   ├── equi8CME.ts                # Modèle CME EQUI8
│   ├── equi8LoadShiftCalculator.ts # Calibration EQUI8
│   ├── srg2SerieVoltage.ts        # Modèle série SRG2
│   ├── optimalEqui8Finder.ts      # Placement optimal EQUI8
│   ├── optimalSrg2Finder.ts       # Placement optimal SRG2
│   ├── phaseDistributionCalculator.ts # Répartition phases
│   ├── pdfGenerator.ts            # Générateur PDF
│   └── tableGenerator.ts          # Générateur tableaux
├── data/                # Données par défaut
│   └── defaultCableTypes.ts       # Types de câbles
└── pages/               # Pages principales
    └── Index.tsx        # Page principale
```

---

## 3. Modèle de données

### Types principaux (`src/types/network.ts`)

```typescript
// Système de tension
type VoltageSystem = 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V';

// Types de raccordement réseau
type ConnectionType = 
  // Réseau 230V (triangle) :
  | 'MONO_230V_PP'      // monophasé 230V entre 2 phases
  | 'TRI_230V_3F'       // triphasé 230V (3 fils, pas de neutre)
  // Réseau 400V (étoile) :
  | 'MONO_230V_PN'      // monophasé 230V phase-neutre
  | 'TÉTRA_3P+N_230_400V'; // tétraphasé 3P+N (230/400V)

// Types de raccordement normalisés
type ClientConnectionType = 'MONO' | 'TRI' | 'TETRA';

// Types de client (résidentiel ou industriel)
type ClientType = 'résidentiel' | 'industriel';

// Scénarios de calcul
type CalculationScenario = 'PRÉLÈVEMENT' | 'MIXTE' | 'PRODUCTION' | 'FORCÉ';

// Nœud du réseau
interface Node {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isSource: boolean;
  connectionType: ConnectionType;
  tensionCible?: number;
  clients: ClientCharge[];
  productions: ProductionPV[];
}

// Raccordement importé
interface ClientImporte {
  id: string;
  identifiantCircuit: string;
  nomCircuit: string;
  lat: number;
  lng: number;
  puissanceContractuelle_kVA: number;
  puissancePV_kVA: number;
  couplage: string;                     // "TRI", "MONO", "TETRA"
  clientType?: ClientType;              // 'résidentiel' | 'industriel'
  connectionType?: ClientConnectionType;
  assignedPhase?: 'A' | 'B' | 'C';
  linkedNodeId?: string;
}

// Câble du réseau
interface Cable {
  id: string;
  name: string;
  nodeAId: string;
  nodeBId: string;
  typeId: string;
  coordinates: { lat: number; lng: number }[];
  length_m?: number;
  current_A?: number;
  voltageDrop_V?: number;
  voltageDropPercent?: number;
  losses_kW?: number;
}

// Type de câble avec propriétés électriques
interface CableType {
  id: string;
  label: string;
  R12_ohm_per_km: number;   // Résistance phase-phase
  X12_ohm_per_km: number;   // Réactance phase-phase
  R0_ohm_per_km: number;    // Résistance phase-neutre / homopolaire
  X0_ohm_per_km: number;    // Réactance phase-neutre / homopolaire
  I_max_A: number;
  poses: string[];
}

// Projet complet
interface Project {
  id: string;
  name: string;
  voltageSystem: VoltageSystem;
  cosPhi: number;
  foisonnementChargesResidentiel: number;
  foisonnementChargesIndustriel: number;
  foisonnementProductions: number;
  nodes: Node[];
  cables: Cable[];
  cableTypes: CableType[];
  clientsImportes?: ClientImporte[];
  clientLinks?: ClientLink[];
  transformerConfig?: TransformerConfig;
}
```

---

## 4. Principes de calcul électrique

### 4.1 Systèmes de tension : 230V Triangle vs 400V Étoile

#### Réseau 230V Triangle (TRIPHASÉ_230V)

```
       ────A────
      /         \
    230V       230V
    /             \
   B──── 230V ────C
```

- **3 conducteurs** : phases A, B, C (pas de neutre)
- **Tension entre phases** : 230V (tension composée)
- **Types de raccordement** : MONO_230V_PP, TRI_230V_3F
- **Impédances utilisées** : toujours R12/X12 (phase-phase)
- **Tension interne BFS** : la référence est **230/√3 ≈ 133V** par phase, ce qui assure des courants de branche et pertes I²R physiquement corrects tout en présentant les tensions ligne-ligne (230V) dans l'interface

#### Réseau 400V Étoile (TÉTRAPHASÉ_400V)

```
          N (neutre)
          │
    ┌─────┼─────┐
    │     │     │
   230V  230V  230V
    │     │     │
    A     B     C
    └──400V──┴──400V──┘
```

- **4 conducteurs** : phases A, B, C + Neutre (N)
- **Tension phase-neutre** : 230V ; **Tension entre phases** : 400V (230V × √3)
- **Types de raccordement** : MONO_230V_PN, TÉTRA_3P+N_230_400V
- **Impédances** : phases → formule GRD belges (voir §4.2), neutre → R0/X0

### 4.2 Formule d'impédance des conducteurs (GRD belges)

L'impédance effective des conducteurs de phase est calculée selon la formule des GRD belges (ORES/RESA/Sibelga), qui combine les composantes directe et homopolaire pour refléter le déséquilibre structurel du réseau :

```
R_eff = (R0 + 2 × R12) / 3
X_eff = (X0 + 2 × X12) / 3
```

Le conducteur neutre utilise directement R0/X0. Cette formule s'applique à tous les calculs de chute de tension (BFS) et de recherche d'emplacement optimal.

### 4.3 Raccordements : Résidentiel vs Industriel

| Type | Foisonnement typique | Usage |
|------|---------------------|-------|
| **Résidentiel** | 15-30% | Habitations, petits commerces |
| **Industriel** | 70-100% | Usines, entrepôts, gros consommateurs |

**Règles métier :**
- Les clients **MONO** sont strictement résidentiels (foisonnement 15%)
- Les clients **industriels** doivent être polyphasés (TRI/TÉTRA, foisonnement 70%)
- Les **charges manuelles** sont toujours traitées comme résidentielles (15%)

### 4.4 Facteurs de puissance différenciés

Le moteur utilise des cos φ séparés pour les charges et les productions :
- **Charges** : cos φ = 0.95 (inductif) par défaut
- **Productions** : cos φ = 1.00 par défaut

Les calculs utilisent la somme vectorielle avec P (actif) et Q (réactif) calculés séparément pour chaque type avant combinaison au nœud.

### 4.5 Répartition des phases (Mode mixte)

#### Raccordements MONO (monophasés)

```typescript
// En 400V étoile : phase-neutre
assignedPhase: 'A'  // Raccordé entre phase A et neutre

// En 230V triangle : phase-phase  
phaseCoupling: 'A-B'  // Raccordé entre phases A et B
```

**Règle de cohérence** : un client MONO ayant charges et productions utilise la même affectation de phase pour les deux.

#### Raccordements TRI/TÉTRA (triphasés/tétraphasés)

Répartition équilibrée sur les 3 phases : `chargesParPhase = puissance / 3` par phase.

#### Foisonnement par phase

```
totalFoisonneChargeA = 
  chargesResidentiellesPhaseA × (foisResidentiel/100) +
  chargesIndustriellesPhaseA × (foisIndustriel/100)
```

### 4.6 Correction vectorielle MONO 230V Triangle

En réseau 230V triangle, un client monophasé branché entre deux phases (ex. L1-L2) est modélisé par une paire de phaseurs opposés :
- S_A = +S_total à 0°
- S_B = −S_total à 180°

Cela assure que le courant calculé par le BFS vaut bien I = S_total / 230V, sans double-comptage de puissance. La propriété `phasePhaseLoads` suit la puissance totale par couplage (A-B, B-C, A-C).

---

## 5. Moteur de calcul électrique (BFS)

### 5.1 Algorithme Backward-Forward Sweep

Le réseau est supposé **radial** (arborescent, une seule source). Les calculs sont réalisés en régime sinusoïdal établi par une méthode Backward-Forward Sweep phasorielle (nombres complexes).

#### Prétraitements

1. **Construction de l'arbre** depuis la source (parcours en largeur) → relations parent/enfant, ordre postfixé
2. **Puissance équivalente par nœud** : `S_eq(n) = charges_foisonnées − productions_foisonnées`
3. **Puissance aval** : `S_aval(n) = S_eq(n) + Σ S_aval(descendants)`
4. **Tension initiale** : `V(n) ← V_slack = U_ref_phase ∠ 0°`

#### Boucle itérative (max 100 itérations, tolérance 1e-4)

**Étape 1 — Courant d'injection nodal (par phase)**

```
S_total(n) = P + jQ
  P = S_kVA × cos φ × 1000
  Q = |S_kVA| × sin φ × 1000 × signe(S_kVA)

S_phase(n) = S_total(n) / (3 si triphasé, sinon 1)
I_inj(n) = conj(S_phase(n) / V(n))
```

Les P et Q sont calculés séparément pour les charges (cos φ charges = 0.95) et les productions (cos φ productions = 1.00), puis combinés par somme vectorielle.

**Étape 2 — Backward (courants de branches)**

```
I_branche(u→parent) = I_inj(u) + Σ I_branche(descendants de u)
I_source_net = I_inj(source) + Σ I_branche(départs)
```

**Étape 3 — Forward (mise à jour des tensions)**

```
V_source_bus = V_slack − Z_transfo × I_source_net
V(enfant) = V(parent) − Z_câble × I_branche
```

**Étape 4 — Convergence** : vérification de la variation maximale de tension phasorielle.

### 5.2 Tension source configurable

La tension source est réglable via un curseur dans l'onglet **Réseau** :
- **230V** : plage 225–240V
- **400V** : plage 390–430V

Elle est automatiquement réinitialisée à la valeur nominale lors d'un changement de système de tension. Le moteur de calcul utilise cette valeur en priorité sur la tension nominale.

### 5.3 Impédance du transformateur

```
Z_pu  = Ucc% / 100
Z_base = U_ligne² / S_nominal_VA
|Z|   = Z_pu × Z_base

R = |Z| / √(1 + (X/R)²)
X = R × (X/R)

Z_transfo = R + jX
```

### 5.4 Scénarios et foisonnement

| Scénario | Puissance équivalente au nœud |
|----------|-------------------------------|
| **Prélèvement** | S_eq = charges foisonnées |
| **Production** | S_eq = −productions foisonnées |
| **Mixte** | S_eq = charges foisonnées − productions foisonnées |

Application du foisonnement différencié :
```
Charges_foisonnées = Σ(résidentiels × fois_résidentiel/100) + Σ(industriels × fois_industriel/100)
Productions_foisonnées = Σ(PV_kVA × fois_productions/100)
```

> **Note** : Seuls les nœuds connectés à la source sont inclus dans les totaux « Circuit ».

### 5.5 Résultats par tronçon

| Grandeur | Formule |
|----------|---------|
| Courant RMS | I = \|I_branche\| |
| Chute par phase | ΔV_ph = Z_câble × I_ph |
| Chute ligne | ΔU = \|ΔV_ph\| × √3 (si triphasé) |
| Pourcentage | ΔU% = ΔU / U_ref × 100 |
| Pertes Joule | P = I² × R × 3 (si triphasé) / 1000 kW |

### 5.6 Conformité EN 50160

| Écart | Statut | Couleur |
|-------|--------|---------|
| ≤ 8% | Normal | 🟢 Vert |
| ≤ 10% | Attention | 🟡 Orange |
| > 10% | Critique | 🔴 Rouge |

---

## 6. Module de Simulation

### 6.1 Architecture

- **SimulationCalculator** : Extension de `ElectricalCalculator`
- **SimulationEquipment** : Structure regroupant tous les équipements (EQUI8, SRG2)
- **simulationResults** : Résultats séparés qui remplacent `calculationResults` quand la simulation est active

### 6.2 Contrôle harmonisé des équipements

Tous les modules de simulation (EQUI8, SRG2, remplacement de câbles) suivent un pattern UX harmonisé :
- **Switch actif/inactif** : active/désactive l'effet sans supprimer la configuration
- **Icône corbeille** : réinitialise l'équipement
- **Sélection de nœud** : dropdown dynamique pour le placement

---

## 7. EQUI8 — Compensateur de Courant de Neutre

### 7.1 Principe physique

L'EQUI8 agit exclusivement comme une **source de courant shunt** :
- Injection de **+I** sur le conducteur neutre
- Injection de **−I/3** sur chacune des trois phases

Les tensions résultantes sont calculées naturellement par le solveur BFS — elles ne sont jamais imposées ni forcées.

### 7.2 Conditions d'éligibilité

Un nœud est éligible à l'EQUI8 si :
1. Réseau **400V tétraphasé** (neutre requis)
2. Le nœud possède un **déséquilibre réel** entre phases (détecté dynamiquement)
3. Impédances équivalentes Zph et Zn ≥ **0.15Ω** (contrainte fournisseur)

> ⚠️ L'EQUI8 ne peut pas fonctionner en réseau 230V triangle (pas de conducteur neutre).

L'éligibilité est indépendante du mode de charge global et fonctionne en mode `monophase_reparti` comme en mode `mixte_mono_poly`.

### 7.3 Algorithme de calibration CME

L'EQUI8 utilise une boucle de calibration par **méthode de la sécante** avec amortissement :

1. Calcul du courant de neutre initial : I_N = I_A + I_B + I_C (somme vectorielle)
2. Si |I_N| < seuil → EQUI8 reste inactif
3. Calcul itératif du courant d'injection optimal :
   - Variation de I limitée à **±20% par itération**
   - Facteur d'amortissement **0.7** pour éviter les oscillations
4. Respect des **limites thermiques** :
   - **80A** pendant 15 minutes
   - **60A** pendant 3 heures
   - **45A** en régime permanent
5. Si une limite est atteinte, la calibration s'arrête au cap et la saturation est signalée

### 7.4 Placement optimal

Le nœud optimal est déterminé en maximisant le score :

```
Score = I_neutre / Z_amont
```

Ce critère privilégie les nœuds avec un fort courant de neutre (déséquilibre marqué) tout en s'assurant que l'impédance amont est assez faible pour éviter que le compensateur ne domine la tension locale. La recherche est contrainte aux nœuds situés entre **10% et 70%** de l'impédance totale du réseau.

### 7.5 Interaction avec le SRG2

- L'EQUI8 (shunt courant) et le SRG2 (série tension) sont **physiquement compatibles** car ils agissent sur des variables différentes
- **Règle de conflit** : si un SRG2 et un EQUI8 sont sur le même nœud ou en relation parent/enfant immédiate, le SRG2 est prioritaire et l'EQUI8 est automatiquement désactivé
- La boucle de couplage suit la séquence : EQUI8 → Décision SRG2 → Application SRG2 → BFS → Mise à jour

---

## 8. SRG2 — Régulateur de Tension Triphasé

### 8.1 Principe physique

Le SRG2 est modélisé comme une **injection de tension série** dans une branche (câble). Dans le forward sweep du BFS :

```
V_sortie = (V_amont − Z_câble × I) + V_série
```

V_série est un phaseur complexe injecté dans la branche. Les tensions nodales sont un résultat naturel du solveur réseau, pas un forçage arbitraire.

### 8.2 Modèle d'automate à seuils

Le SRG2 fonctionne comme un **automate à seuils** (pas un régulateur PID). La convergence est définie par la stabilité de la décision de prise : si `tap_change == 0` après une itération, l'automate a convergé.

Chaque phase dispose de 5 positions indépendantes :

| Position | SRG2-400 (±7%/±3.5%) | SRG2-230 (±6%/±3%) |
|----------|----------------------|---------------------|
| **LO2** | > 246V → −7% | > 244V → −6% |
| **LO1** | > 238V → −3.5% | > 237V → −3% |
| **Bypass** | 222–238V → 0% | 223–237V → 0% |
| **BO1** | < 222V → +3.5% | < 223V → +3% |
| **BO2** | < 214V → +7% | < 216V → +6% |

La décision de changement de prise intègre une **hystérésis de ±2V** et une **temporisation de 7 secondes** pour éviter les oscillations.

### 8.3 Mémoire mécanique (profils journaliers)

En analyse de profil journalier (24h), la position de prise du SRG2 est maintenue d'une heure à l'autre (mémoire mécanique). Le système utilise l'état de l'heure précédente et la zone d'hystérésis ±2V pour évaluer les changements de prise, évitant les oscillations irréalistes.

### 8.4 Limites de puissance

| Mode | Limite |
|------|--------|
| **Injection** (PV > charges) | 85 kVA max |
| **Prélèvement** (charges > PV) | 110 kVA max |

Si la puissance aval foisonnée dépasse ces limites, le SRG2 ne peut plus réguler correctement.

### 8.5 Placement optimal

La fonction `findOptimalSRG2Node` identifie le nœud optimal **dans un rayon de 250m** de la source :
1. Privilégie les nœuds conformes à la norme EN 50160 (207V–253V)
2. Calcule un **score d'impact** : pourcentage de nœuds aval remis en conformité après une régulation théorique ±7%

```
Score = (nœuds corrigés / nœuds hors norme initiaux) × 100
```

### 8.6 Boucle de couplage SRG2 + EQUI8

Lorsque les deux équipements sont actifs, la simulation suit une séquence causale :

1. **EQUI8** : calcul du courant d'injection (CME) à partir de l'état réseau courant
2. **SRG2** : décision de prise basée sur les tensions résultantes
3. **Application** des coefficients SRG2 aux nœuds concernés
4. **BFS** : recalcul complet des tensions et courants
5. **Convergence** : atteinte dès que le SRG2 ne demande plus de changement de prise

L'EQUI8 est recalculé dynamiquement à chaque itération sans utiliser de ratios mémorisés.

---

## 9. Mode déséquilibré (Monophasé réparti)

### 9.1 Définition

Le mode déséquilibré permet de modéliser des réseaux où les charges monophasées ne sont pas réparties uniformément sur les phases.

**Effets :**
- Tensions phase-neutre différentes pour chaque phase
- Courant de neutre non nul (I_N)
- Conditions nécessaires pour l'utilisation de l'EQUI8

### 9.2 Répartition des phases

Trois paramètres définissent la distribution (total = 100%) :
- `phaseAPercent`, `phaseBPercent`, `phaseCPercent`

Les curseurs de déséquilibre affectent **tous** les types de clients (MONO, TRI/TÉTRA) et les charges manuelles (Option B).

### 9.3 Calcul du courant de neutre

```
I_N = I_A + I_B + I_C (somme vectorielle complexe)

En équilibre parfait : I_N = 0
Avec déséquilibre    : I_N ≠ 0 → échauffement conducteur neutre
```

---

## 10. Totaux Clients Cabine et alerte transfo

### 10.1 Principe

L'onglet **Paramètres** affiche côte à côte :
- **Circuit** : charges/productions foisonnées des nœuds connectés au réseau
- **Clients Cabine** : charges/productions foisonnées de **tous** les clients importés (liés et non liés)

### 10.2 Calcul

```
cabineChargesFoisonnées = Σ(résidentiels × fois_résidentiel/100) + Σ(industriels × fois_industriel/100)
cabineProductionsFoisonnées = Σ(PV_kVA × fois_productions/100)
```

### 10.3 Alerte transfo

Une alerte s'affiche si :
- **Surcharge** : charges foisonnées > puissance transfo + productions foisonnées
- **Injection** : productions foisonnées > puissance transfo + charges foisonnées

---

## 11. Jeu de barres virtuel

### 11.1 Principe

Calculé après convergence du power flow, le jeu de barres représente le point de départ du réseau BT après le transformateur.

### 11.2 Grandeurs calculées

| Grandeur | Description |
|----------|-------------|
| `voltage_V` | Tension au jeu de barres (V ligne) |
| `current_A` | Courant net total (A RMS) |
| `current_N` | Courant neutre (A RMS) en mode déséquilibré |
| `netSkVA` | Puissance nette (charges - productions) |
| `deltaU_V` | Chute de tension dans le transformateur |
| `losses_kW` | Pertes cuivre du transformateur |

### 11.3 Analyse par circuit

Chaque départ (enfant direct de la source) dispose de :
- `subtreeSkVA` : Puissance du sous-arbre
- `direction` : 'injection' ou 'prélèvement'
- `current_A` : Courant du départ
- `minNodeVoltage_V` / `maxNodeVoltage_V` : Plage de tensions

---

## 12. Gestion d'état (Zustand)

### Store principal (`src/store/networkStore.ts`)

```typescript
interface NetworkState {
  currentProject: Project | null;
  
  // Raccordements importés
  clientsImportes: ClientImporte[];
  clientLinks: ClientLink[];
  
  // Interface utilisateur
  selectedTool: 'select' | 'addNode' | 'addCable' | 'move';
  selectedNodeId: string | null;
  selectedCableId: string | null;
  
  // Calculs standards
  calculationResults: Record<CalculationScenario, CalculationResult | null>;
  selectedScenario: CalculationScenario;
  
  // Simulation
  simulationMode: boolean;
  simulationEquipment: SimulationEquipment;
  simulationResults: Record<CalculationScenario, CalculationResult | null>;
  isSimulationActive: boolean;
  
  // Actions principales
  addNode: (lat, lng, connectionType) => void;
  addCable: (nodeAId, nodeBId, typeId, coordinates) => void;
  importClients: (clients: ClientImporte[]) => void;
  linkClientToNode: (clientId, nodeId) => void;
  calculateNetwork: () => void;
  runSimulation: () => void;
}
```

---

## 13. Interface cartographique

### Codes couleur des nœuds

| Couleur | Signification |
|---------|--------------|
| 🔵 Bleu | Charges seules |
| 🟢 Vert | Productions seules |
| 🟡 Jaune | Mixte (charges + productions) |
| 🔴 Rouge | Non-conformité EN50160 |
| 🟦 Cyan | Source 230V |
| 🟣 Magenta | Source 400V |

### Badges d'équipements de simulation

- 🟢 **Badge vert** : EQUI8 actif
- 🔵 **Badge bleu** : SRG2 actif
- 🟡 **Badge jaune** : Équipement présent mais désactivé

### Tracé de câbles interactif

1. Clic sur nœud source → mode routage activé
2. Clics intermédiaires → points du tracé
3. Double-clic ou Entrée → finalisation
4. Échap → annulation

---

## 14. Export PDF

### Structure du rapport

1. **Page de titre** avec date/heure
2. **Résumé global** : charges, productions, pertes, conformité
3. **Comparaison des scénarios** : tableau comparatif
4. **Détails par tronçon** : tableau complet

### Contenu avec simulation active

**Section EQUI8** (pour chaque compensateur actif) :
- Réduction % du courant de neutre
- Tensions Ph-N équilibrées
- Puissances réactives injectées

**Section SRG2** (pour chaque régulateur actif) :
- Tensions d'entrée/sortie par phase
- États des commutateurs (LO2/LO1/BYP/BO1/BO2)
- Coefficients appliqués

---

## 15. Normes et conformité

### Limites réglementaires
- **Chute de tension max** : 3% selon NF C 15-100
- **Facteur de puissance** : 0.8 à 1.0
- **Conformité EN 50160** : ±10% de la tension nominale

### Cas particuliers
- **Remontée de tension** : En cas de production PV importante
- **Déséquilibre** : Répartition des phases sur les charges monophasées

---

## 16. Extensibilité

### Ajouter un nouveau type de câble

Éditer `src/data/defaultCableTypes.ts` :

```typescript
{
  id: "nouveau_cable",
  label: "Nouveau câble XYZ",
  R12_ohm_per_km: 0.xxx,
  X12_ohm_per_km: 0.xxx,
  R0_ohm_per_km: 0.xxx,
  X0_ohm_per_km: 0.xxx,
  I_max_A: xxx,
  poses: ["ENTERRÉ", "AÉRIEN"]
}
```

### Personnaliser les calculs

La classe `ElectricalCalculator` peut être étendue via `SimulationCalculator` pour ajouter de nouveaux types d'équipements ou modifier les formules.

---

## 17. Maintenance et debugging

### Console de debug

L'application affiche des logs détaillés pour le diagnostic.

### Points d'attention

| Problème | Cause | Solution |
|----------|-------|----------|
| Calculs incorrects | Mauvais paramètres câble | Vérifier R12/X12, R0/X0 |
| EQUI8 inactif | Réseau 230V | Passer en 400V (neutre requis) |
| EQUI8 inactif | Pas de déséquilibre | Vérifier la distribution des phases |
| Foisonnement incorrect | Type raccordement non défini | Vérifier `clientType` |
| SRG2 limite atteinte | Puissance aval > 85/110 kVA | Répartir les charges |
| Conflit SRG2/EQUI8 | Même nœud ou parent/enfant | SRG2 prioritaire, EQUI8 désactivé |

---

## 18. Roadmap

### Fonctionnalités implémentées

- ✅ Import/export de projets (.json)
- ✅ Support des transformateurs HT/BT
- ✅ Module de simulation (EQUI8, SRG2)
- ✅ Foisonnement différencié résidentiel/industriel
- ✅ Mode déséquilibré avec répartition par phase
- ✅ Export PDF avancé avec simulation
- ✅ Formule d'impédance GRD belges
- ✅ Correction vectorielle MONO 230V triangle
- ✅ Tension source configurable
- ✅ Totaux Clients Cabine et alerte transfo
- ✅ Profils journaliers avec mémoire mécanique SRG2
- ✅ Calibration CME EQUI8 avec limites thermiques

### Améliorations prévues

- [ ] Calculs de court-circuit (Icc)
- [ ] API REST pour calculs serveur
- [ ] Mode multi-utilisateurs
- [ ] Export vers formats CAO (DXF, DWG)

---

*Application développée pour les professionnels de l'électricité - Conforme aux normes NF C 15-100*
*Dernière mise à jour : 10 février 2026*
