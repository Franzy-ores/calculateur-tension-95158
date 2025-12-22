# Documentation Technique - Calculateur de Chute de Tension

## Vue d'ensemble

Cette application permet de calculer les chutes de tension dans un réseau électrique basse tension (BT) en créant visuellement des nœuds et des câbles sur une carte interactive, puis en générant des rapports PDF détaillés.

## Architecture

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
│   ├── MapView.tsx      # Carte interactive principale
│   ├── ResultsPanel.tsx # Panneau des résultats
│   ├── EditPanel.tsx    # Panneau d'édition nœuds/câbles
│   └── ...
├── store/               # Gestion d'état Zustand
│   └── networkStore.ts  # Store principal du réseau
├── types/               # Définitions TypeScript
│   └── network.ts       # Types du réseau électrique
├── utils/               # Utilitaires
│   ├── electricalCalculations.ts  # Moteur de calcul
│   ├── pdfGenerator.ts            # Générateur PDF
│   └── tableGenerator.ts          # Générateur tableaux
├── data/                # Données par défaut
│   └── defaultCableTypes.ts       # Types de câbles
└── pages/               # Pages principales
    └── Index.tsx        # Page principale
```

## Modèle de données

### Types principaux (`src/types/network.ts`)

```typescript
// Système de tension
type VoltageSystem = 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V';

// Types de raccordement
type ConnectionType = 
  // Réseau 230V (triangle) :
  | 'MONO_230V_PP'      // monophasé 230V entre 2 phases
  | 'TRI_230V_3F'       // triphasé 230V (3 fils, pas de neutre)
  // Réseau 400V (étoile) :
  | 'MONO_230V_PN'      // monophasé 230V phase-neutre
  | 'TÉTRA_3P+N_230_400V'; // tétraphasé 3P+N (230/400V)

// Types de raccordement normalisés
type ClientConnectionType = 'MONO' | 'TRI' | 'TETRA';

// Types de raccordement (résidentiel ou industriel)
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
  clients: ClientCharge[];      // Charges connectées (legacy)
  productions: ProductionPV[];  // Productions PV connectées (legacy)
}

// Raccordement importé
interface ClientImporte {
  id: string;
  identifiantCircuit: string;
  nomCircuit: string;
  lat: number;
  lng: number;
  puissanceContractuelle_kVA: number;  // charge
  puissancePV_kVA: number;             // production PV
  couplage: string;                     // "TRI", "MONO", "TETRA"
  clientType?: ClientType;              // 'résidentiel' | 'industriel'
  connectionType?: ClientConnectionType; // Type de raccordement normalisé
  assignedPhase?: 'A' | 'B' | 'C';      // Phase assignée (pour MONO)
  linkedNodeId?: string;                 // ID du nœud lié
}

// Câble du réseau
interface Cable {
  id: string;
  name: string;
  nodeAId: string;
  nodeBId: string;
  typeId: string;
  coordinates: { lat: number; lng: number }[];
  // Propriétés calculées
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
  R0_ohm_per_km: number;    // Résistance phase-neutre
  X0_ohm_per_km: number;    // Réactance phase-neutre
  I_max_A: number;          // Courant admissible
  poses: string[];          // Modes de pose autorisés
}

// Projet complet
interface Project {
  id: string;
  name: string;
  voltageSystem: VoltageSystem;
  cosPhi: number;
  foisonnementChargesResidentiel: number;   // % foisonnement résidentiel
  foisonnementChargesIndustriel: number;    // % foisonnement industriel
  foisonnementProductions: number;           // % foisonnement productions
  nodes: Node[];
  cables: Cable[];
  cableTypes: CableType[];
  clientsImportes?: ClientImporte[];
  clientLinks?: ClientLink[];
  geographicBounds?: any;
}
```

---

## 3. Principes de calcul électrique

### 3.1 Systèmes de tension : 230V Triangle vs 400V Étoile

Le calculateur supporte deux systèmes de tension fondamentalement différents :

#### Réseau 230V Triangle (TRIPHASÉ_230V)

```
       ────A────
      /         \
    230V       230V
    /             \
   B──── 230V ────C
```

**Caractéristiques :**
- **3 conducteurs** : phases A, B, C (pas de neutre)
- **Tension entre phases** : 230V (tension composée)
- **Pas de neutre physique** → pas de tension phase-neutre
- **Types de raccordement disponibles** :
  - `MONO_230V_PP` : monophasé 230V entre deux phases (ex: A-B)
  - `TRI_230V_3F` : triphasé 230V (3 fils)

**Impédances utilisées** : Toujours R12/X12 (impédances phase-phase)

**Formule du courant triphasé** :
```
I = S / (√3 × 230V)
```

---

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

**Caractéristiques :**
- **4 conducteurs** : phases A, B, C + Neutre (N)
- **Tension phase-neutre** : 230V (tension simple)
- **Tension entre phases** : 400V (tension composée = 230V × √3)
- **Neutre disponible** → permet les charges monophasées phase-neutre
- **Types de raccordement disponibles** :
  - `MONO_230V_PN` : monophasé 230V phase-neutre (ex: A-N)
  - `TÉTRA_3P+N_230_400V` : tétraphasé 3P+N (230/400V)

**Impédances utilisées** :
- Phases : R12/X12 (impédances phase-phase)
- Neutre : R0/X0 (impédances phase-neutre)

**Formule du courant triphasé** :
```
I = S / (√3 × 400V)
```

---

### 3.2 Sélection automatique des impédances

La fonction `selectRX()` choisit automatiquement les bonnes impédances selon le contexte :

```typescript
private selectRX(cableType, is400V, isUnbalanced, forNeutral): { R, X }
```

| Réseau | Conducteur | Impédances utilisées |
|--------|-----------|---------------------|
| 230V Triangle | Phases | R12/X12 |
| 400V Étoile | Phases | R12/X12 |
| 400V Étoile | Neutre | R0/X0 |

> **Important** : En réseau 230V triangle, il n'y a pas de conducteur neutre. Les impédances R0/X0 ne sont jamais utilisées.

---

### 3.3 Raccordements : Résidentiel vs Industriel

#### Types de raccordement

Chaque raccordement importé peut être classé selon son type :

| Type | Foisonnement typique | Usage |
|------|---------------------|-------|
| **Résidentiel** | 15-30% | Habitations, petits commerces |
| **Industriel** | 70-100% | Usines, entrepôts, gros consommateurs |

#### Foisonnement différencié

Le foisonnement représente le taux de simultanéité des charges. Il est appliqué différemment selon le type de raccordement :

```typescript
// Calcul de la puissance équivalente foisonnée
for (const raccordement of raccordementsLies) {
  const foisonnement = raccordement.clientType === 'industriel' 
    ? foisonnementChargesIndustriel    // Ex: 70%
    : foisonnementChargesResidentiel;  // Ex: 15%
  
  S_foisonne += raccordement.puissanceContractuelle_kVA * (foisonnement / 100);
}
```

**Exemple concret :**

| Raccordement | Type | P contractuelle | Foisonnement | P foisonnée |
|-------------|------|----------------|--------------|-------------|
| Maison A | Résidentiel | 12 kVA | 15% | 1.8 kVA |
| Maison B | Résidentiel | 9 kVA | 15% | 1.35 kVA |
| Usine X | Industriel | 100 kVA | 70% | 70 kVA |
| **Total** | | **121 kVA** | | **73.15 kVA** |

---

### 3.4 Répartition des phases (Mode mixte)

En mode `mixte_mono_poly`, les raccordements sont automatiquement répartis sur les phases selon leur type de couplage :

#### Raccordements MONO (monophasés)

Les raccordements monophasés sont assignés à une phase unique (A, B ou C) :

```typescript
// En 400V étoile : phase-neutre
assignedPhase: 'A'  // Raccordé entre phase A et neutre

// En 230V triangle : phase-phase  
phaseCoupling: 'A-B'  // Raccordé entre phases A et B
```

**Répartition des charges par phase :**
- Charges 100% sur la phase assignée
- Productions 100% sur la phase assignée (ou réparties si puissance > seuil)

#### Raccordements TRI/TÉTRA (triphasés/tétraphasés)

Les raccordements triphasés sont répartis équitablement sur les 3 phases :

```typescript
// Répartition équilibrée
chargesParPhase = {
  A: puissanceContractuelle / 3,
  B: puissanceContractuelle / 3,
  C: puissanceContractuelle / 3
}
```

#### Foisonnement différencié par phase

Le foisonnement est appliqué **par type de raccordement et par phase** :

```typescript
// Pour chaque phase (A, B, C)
totalFoisonneChargeA = 
  chargesResidentiellesPhaseA * (foisonnementResidentiel / 100) +
  chargesIndustriellesPhaseA * (foisonnementIndustriel / 100);
```

---

## 4. Moteur de calcul électrique

### 4.1 Algorithme Backward-Forward Sweep

Le réseau est supposé radial (arborescent) avec une seule source. Les calculs sont réalisés en régime sinusoïdal établi par une méthode Backward-Forward Sweep phasorielle (nombres complexes).

#### Prétraitements

1. **Construction de l'arbre** depuis la source (BFS) → parent/children, ordre postfixé
2. **Puissance équivalente par nœud** : `S_eq(n) = charges_foisonnées − productions_foisonnées`
3. **Puissance aval** : `S_aval(n) = S_eq(n) + Σ S_aval(descendants)`
4. **Tension initiale** : `V(n) ← V_slack = U_ref_phase ∠ 0°`

#### Boucle itérative

(max 100 itérations, tolérance 1e−4 sur |ΔV|/U_ref_phase)

**1. Courant d'injection nodal (par phase)**
```
S_total(n) = P + jQ
  P = S_kVA × cos φ × 1000
  Q = |S_kVA| × sin φ × 1000 × sign(S_kVA)

S_phase(n) = S_total(n) / (3 si triphasé, sinon 1)
I_inj(n) = conj(S_phase(n) / V(n))
```

**2. Backward (courants de branches)**
```
I_branche(u→p) = I_inj(u) + Σ I_branche(descendants de u)
I_source_net = I_inj(source) + Σ I_branche(départs)
```

**3. Forward (mises à jour des tensions)**
```
V_source_bus = V_slack − Z_tr × I_source_net
V(enfant) = V(parent) − Z_câble × I_branche
```

**4. Test de convergence** sur la variation maximale de tension phasorielle.

---

### 4.2 Calcul du courant selon le type de raccordement

La conversion puissance → courant dépend du type de raccordement :

```typescript
private calculateCurrentA(S_kVA, connectionType, sourceVoltage?): number {
  switch (connectionType) {
    case 'MONO_230V_PN':
      // Monophasé phase-neutre: I = S / U_phase
      return (S_kVA * 1000) / 230;
      
    case 'MONO_230V_PP':
      // Monophasé phase-phase: I = S / U_phase-phase
      return (S_kVA * 1000) / 230;
      
    case 'TRI_230V_3F':
      // Triangle 230V: I = S / (√3 × 230V)
      return (S_kVA * 1000) / (Math.sqrt(3) * 230);
      
    case 'TÉTRA_3P+N_230_400V':
      // Étoile 400V: I = S / (√3 × 400V)
      return (S_kVA * 1000) / (Math.sqrt(3) * 400);
  }
}
```

---

### 4.3 Impédance du transformateur

Le transformateur HT/BT est modélisé par son impédance série par phase :

```typescript
// Calcul de l'impédance transformateur
const Zpu = Ucc_percent / 100;           // p.u.
const Sbase_VA = S_nominal_kVA * 1000;   // VA
const Zbase = U_line² / Sbase_VA;        // Ω
const Zmag = Zpu * Zbase;                // |Z| en Ω

// Décomposition R/X via ratio X/R
if (xOverR > 0) {
  R = Zmag / sqrt(1 + xOverR²);
  X = R * xOverR;
} else {
  R = 0.05 * Zmag;  // Fallback
  X = sqrt(Zmag² - R²);
}

Ztr_phase = R + jX;
```

---

### 4.4 Calculs par tronçon (résultats)

Pour chaque câble du réseau :

| Grandeur | Formule |
|----------|---------|
| Courant RMS | `I = \|I_branche\|` |
| Chute par phase | `ΔV_ph = Z_câble × I_ph` |
| Chute ligne | `ΔU_ligne = \|ΔV_ph\| × (√3 si triphasé)` |
| Pourcentage chute | `ΔU_% = (ΔU_ligne / U_ref) × 100` |
| Puissance apparente | `S_kVA = \|V_amont × conj(I_ph)\| × (3 si tri) / 1000` |
| Pertes Joule | `P_pertes = I² × R_phase × (3 si tri) / 1000` |

---

### 4.5 Évaluation nodale et conformité EN 50160

Pour chaque nœud :

```typescript
// Tension nœud (ligne)
U_node = |V(n)| × (√3 si triphasé, sinon 1)

// Chute cumulée
ΔU_cum_V = U_ref - U_node
ΔU_cum_% = ΔU_cum_V / U_ref × 100

// Conformité EN 50160
if (|ΔU_%| ≤ 8%)  → 'normal' (vert)
if (|ΔU_%| ≤ 10%) → 'warning' (orange)
if (|ΔU_%| > 10%) → 'critical' (rouge)
```

---

### 4.6 Scénarios et foisonnement

| Scénario | Formule S_eq |
|----------|--------------|
| PRÉLÈVEMENT | `S_eq = charges_foisonnées` |
| PRODUCTION | `S_eq = −productions_foisonnées` |
| MIXTE | `S_eq = charges_foisonnées − productions_foisonnées` |

**Application du foisonnement différencié :**

```typescript
// Pour chaque raccordement lié au nœud
const foisonnement = (raccordement.clientType === 'industriel')
  ? project.foisonnementChargesIndustriel    // Ex: 70%
  : project.foisonnementChargesResidentiel;  // Ex: 15%

chargesFoisonnees += raccordement.puissanceContractuelle_kVA * (foisonnement / 100);
```

> **Note** : Seuls les nœuds connectés à la source sont inclus dans les totaux.

---

## 5. Module de Simulation

### 5.1 Architecture du module

Le module de simulation étend les capacités de calcul standard en introduisant des équipements de compensation et de régulation.

- **SimulationCalculator** : Extension de `ElectricalCalculator`
- **SimulationEquipment** : Structure regroupant tous les équipements (EQUI8, SRG2)
- **simulationResults** : Résultats séparés qui remplacent `calculationResults` quand la simulation est active

### 5.2 EQUI8 - Compensateur de Courant de Neutre

#### Principe technique

L'EQUI8 réduit le courant dans le conducteur neutre (I_N) en injectant des puissances réactives calculées automatiquement sur les trois phases.

**Conditions d'éligibilité :**
1. Réseau en 400V tétraphasé (neutre requis)
2. Type de raccordement du nœud : MONO_230V_PN
3. Mode de charge : `monophase_reparti` activé
4. Déséquilibre présent (> 0%)
5. Impédances minimales : Zph > 0.15Ω, Zn > 0.15Ω

> ⚠️ **Important** : Un EQUI8 ne peut pas fonctionner en réseau 230V triangle car il n'y a pas de conducteur neutre.

#### Algorithme de compensation

```
1. I_N_initial = I_A + I_B + I_C (somme vectorielle)
2. Si |I_N_initial| < tolerance_A → EQUI8 reste inactif
3. Calcul Q_A, Q_B, Q_C pour équilibrer les tensions Ph-N
4. Limitation par puissance maximale si nécessaire
5. Application: I_phase_compensé = I_phase + Q_phase / V_phase
6. I_N_final = I_A_comp + I_B_comp + I_C_comp
7. reductionPercent = (1 - |I_N_final| / |I_N_initial|) × 100
```

### 5.3 SRG2 - Régulateur de Tension Triphasé

Le SRG2 est un stabilisateur automatique de tension disponible en deux variantes :

#### SRG2-400 (réseau 400V étoile)

| Position | Seuil (V) | Coefficient |
|----------|-----------|-------------|
| LO2 | U > 246V | -7% |
| LO1 | U > 238V | -3.5% |
| BYP | 222-238V | 0% |
| BO1 | U < 222V | +3.5% |
| BO2 | U < 214V | +7% |

#### SRG2-230 (réseau 230V triangle)

| Position | Seuil (V) | Coefficient |
|----------|-----------|-------------|
| LO2 | U > 244V | -6% |
| LO1 | U > 236V | -3% |
| BYP | 224-236V | 0% |
| BO1 | U < 224V | +3% |
| BO2 | U < 216V | +6% |

**Formule de régulation :**
```
U_sortie = U_entrée × (1 + coefficient/100)
```

**Limites de puissance aval :**
- Injection (PV > charges) : 85 kVA max
- Prélèvement (charges > PV) : 110 kVA max

---

## 6. Mode déséquilibré (Monophasé réparti)

### 6.1 Définition

Le mode `monophase_reparti` permet de modéliser des réseaux où les charges monophasées ne sont pas réparties uniformément sur les phases.

**Effets :**
- Tensions phase-neutre différentes pour chaque phase
- Courant de neutre non nul (I_N)
- Conditions nécessaires pour l'utilisation de l'EQUI8

### 6.2 Répartition des phases

Trois paramètres définissent la distribution (total = 100%) :
- `phaseAPercent` : Pourcentage sur phase A
- `phaseBPercent` : Pourcentage sur phase B
- `phaseCPercent` : Pourcentage sur phase C

### 6.3 Calcul du courant de neutre

```
I_N = I_A + I_B + I_C (somme vectorielle complexe)

En équilibre parfait : I_N = 0
Avec déséquilibre    : I_N ≠ 0 → échauffement conducteur neutre
```

---

## 7. Jeu de barres virtuel

### 7.1 Principe

Calculé après convergence du power flow, le jeu de barres représente le point de départ du réseau BT après le transformateur.

### 7.2 Grandeurs calculées

| Grandeur | Description |
|----------|-------------|
| `voltage_V` | Tension au jeu de barres (V ligne) |
| `current_A` | Courant net total (A RMS) |
| `current_N` | Courant neutre (A RMS) en mode déséquilibré |
| `netSkVA` | Puissance nette (charges - productions) |
| `deltaU_V` | Chute de tension dans le transformateur |
| `losses_kW` | Pertes cuivre du transformateur |

### 7.3 Analyse par circuit

Chaque départ (enfant direct de la source) dispose de :
- `subtreeSkVA` : Puissance du sous-arbre
- `direction` : 'injection' ou 'prélèvement'
- `current_A` : Courant du départ
- `minNodeVoltage_V` / `maxNodeVoltage_V` : Plage de tensions

---

## 8. Gestion d'état (Zustand)

### Store principal (`src/store/networkStore.ts`)

```typescript
interface NetworkState {
  // Projet actuel
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

## 9. Interface cartographique

### Composant `MapView`

#### Codes couleur des nœuds

| Couleur | Signification |
|---------|--------------|
| 🔵 Bleu | Charges seules |
| 🟢 Vert | Productions seules |
| 🟡 Jaune | Mixte (charges + productions) |
| 🔴 Rouge | Non-conformité EN50160 |
| 🟦 Cyan | Source 230V |
| 🟣 Magenta | Source 400V |

#### Tracé de câbles interactif

1. Clic sur nœud source → mode routage activé
2. Clics intermédiaires → points du tracé
3. Double-clic ou Entrée → finalisation
4. Échap → annulation

---

## 10. Export PDF

### Structure du rapport

1. **Page de titre** avec date/heure
2. **Résumé global** : charges, productions, pertes, conformité
3. **Comparaison des scénarios** : tableau comparatif
4. **Détails par tronçon** : tableau complet

### Contenu avec simulation active

Lorsque la simulation est active, le PDF intègre :

**Section EQUI8** (pour chaque compensateur actif) :
- Réduction % du courant de neutre
- Tensions Ph-N équilibrées
- Puissances réactives injectées

**Section SRG2** (pour chaque régulateur actif) :
- Tensions d'entrée/sortie par phase
- États des commutateurs (LO2/LO1/BYP/BO1/BO2)
- Coefficients appliqués

---

## 11. Extensibilité

### Ajouter un nouveau type de câble

Éditer `src/data/defaultCableTypes.ts` :

```typescript
{
  id: "nouveau_cable",
  label: "Nouveau câble XYZ",
  R12_ohm_per_km: 0.xxx,  // Résistance phase-phase Ω/km
  X12_ohm_per_km: 0.xxx,  // Réactance phase-phase Ω/km
  R0_ohm_per_km: 0.xxx,   // Résistance phase-neutre Ω/km
  X0_ohm_per_km: 0.xxx,   // Réactance phase-neutre Ω/km
  I_max_A: xxx,           // Courant admissible A
  poses: ["ENTERRÉ", "AÉRIEN"]
}
```

### Personnaliser les calculs

La classe `ElectricalCalculator` peut être étendue pour :
- Ajouter de nouveaux types de raccordement
- Modifier les formules de chute de tension
- Implémenter d'autres normes (IEC, NEC, etc.)

---

## 12. Maintenance et debugging

### Console de debug

L'application affiche des logs détaillés :

```typescript
console.log('=== CALCUL ÉLECTRIQUE ===');
console.log('Scénario:', scenario);
console.log('Mode:', isUnbalanced ? 'déséquilibré' : 'équilibré');
console.log('Foisonnement résidentiel:', foisonnementResidentiel + '%');
console.log('Foisonnement industriel:', foisonnementIndustriel + '%');
```

### Points d'attention

| Problème | Cause | Solution |
|----------|-------|----------|
| Calculs incorrects | Mauvais paramètres câble | Vérifier R12/X12, R0/X0 |
| EQUI8 inactif | Réseau 230V | Passer en 400V (neutre requis) |
| Foisonnement incorrect | Type raccordement non défini | Vérifier `clientType` |
| Phases déséquilibrées | Mode équilibré actif | Activer `monophase_reparti` |

---

## 13. Roadmap

### Fonctionnalités implémentées

- ✅ Import/export de projets (.json)
- ✅ Support des transformateurs HT/BT
- ✅ Module de simulation (EQUI8, SRG2)
- ✅ Foisonnement différencié résidentiel/industriel
- ✅ Mode déséquilibré avec répartition par phase
- ✅ Export PDF avancé avec simulation

### Améliorations prévues

- [ ] Calculs de court-circuit (Icc)
- [ ] API REST pour calculs serveur
- [ ] Mode multi-utilisateurs
- [ ] Export vers formats CAO (DXF, DWG)

---

## Contacts

Pour questions techniques ou contributions :
- Vérifier la console navigateur pour les erreurs
- Utiliser l'historique Lovable pour revenir à une version stable
- Consulter la documentation des dépendances (Leaflet, jsPDF, etc.)
