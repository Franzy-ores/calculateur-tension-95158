# Manuel Utilisateur - Calcul de Chute de Tension BT

**Version : 10 février 2026**

---

## 📋 Vue d'ensemble

Cette application permet de calculer et d'analyser les chutes de tension dans les réseaux électriques basse tension (BT). Elle offre une interface cartographique intuitive pour concevoir, modéliser et analyser des réseaux électriques avec différents scénarios de charge.

## 🚀 Démarrage rapide

### 1. Création d'un nouveau réseau
- Cliquez sur **"Nouveau Réseau"** dans le menu principal
- Choisissez le système de tension (230V triphasé ou 400V tétraphasé)
- Votre projet est automatiquement initialisé avec un transformateur par défaut

### 2. Première utilisation
1. **Ajoutez des nœuds** : Cliquez sur l'outil "Nœud" puis sur la carte
2. **Connectez les nœuds** : Utilisez l'outil "Câble" pour relier les points
3. **Configurez les charges** : Double-cliquez sur un nœud pour ajouter des consommations
4. **Lancez le calcul** : Les résultats s'affichent automatiquement

## 🛠️ Interface utilisateur

### Menu principal (en haut)
- **Scénario** : Choix entre Prélèvement, Mixte, ou Production
- **Curseurs de foisonnement** : 
  - **Charges** : Pourcentage de la puissance des charges (0-100%)
  - **Productions** : Pourcentage de la puissance PV (0-100%)
- **Affichage tensions** : Active/désactive l'affichage des tensions sur la carte
- **Changement de système** : Bascule entre 230V et 400V
  - ⚡ **Adaptation automatique** : Les équipements de simulation (SRG2, EQUI8) s'adaptent automatiquement au nouveau système

### Barre d'outils (à gauche)
- 🏠 **Nœud** : Ajouter un point de connexion
- 🔌 **Câble** : Connecter deux nœuds
- ✋ **Sélection** : Sélectionner et déplacer des éléments
- 📍 **Adresse** : Rechercher une adresse sur la carte

### Panneau de résultats (à droite)
- **Conformité globale** : Statut du réseau (Conforme/Non conforme)
- **Chute de tension max** : Circuit le plus critique
- **Détails par circuit** : Intensité, chute de tension, pertes
- **Jeu de barres virtuel** : Analyse du transformateur

## ⚡ Types de scénarios

### 🔋 Production (PV max)
- **Charges** : 0% (pas de consommation)
- **Productions** : 100% (injection PV maximale)
- **Usage** : Vérifier les remontées de tension en cas de surproduction

### 🔄 Mixte
- **Charges** : 30% (consommation réduite)
- **Productions** : 100% (injection PV maximale)
- **Usage** : Conditions intermédiaires, autoconsommation partielle

### 📊 Prélèvement (Charge max)
- **Charges** : 30% (consommation normale)
- **Productions** : 0% (pas d'injection PV)
- **Usage** : Conditions de pointe, vérification des chutes de tension

> 💡 **Astuce** : Le choix du scénario ajuste automatiquement les curseurs de foisonnement

## 🏗️ Configuration des éléments

### Nœuds (points de connexion)
**Double-clic sur un nœud** pour configurer :

#### Charges électriques
- **Type de connexion** : Monophasé, triphasé, tétra
- **Puissance** : En kW ou kVA
- **Cos φ** : Facteur de puissance (0.8 à 1.0)
- **Nom** : Identification de la charge

#### Productions photovoltaïques
- **Puissance crête** : En kWc
- **Cos φ** : Généralement 1.0 pour les onduleurs
- **Type de connexion** : Selon le raccordement

### Câbles
**Double-clic sur un câble** pour configurer :
- **Type de câble** : Section et matériau (cuivre/aluminium)
- **Mode de pose** : Aérien ou souterrain
- **Longueur** : Calculée automatiquement ou saisie manuelle

### Transformateur
**Paramètres généraux** → **Configuration transformateur** :
- **Puissance nominale** : En kVA
- **Tension de court-circuit** : En %
- **Rapport X/R** : Réactance/Résistance
- **Cos φ** : Facteur de puissance

## 📊 Lecture des résultats

### Codes couleur sur la carte

**Câbles** :
- 🟢 **Vert** : Chute de tension ≤ 3% (conforme)
- 🟡 **Orange** : Chute de tension 3-5% (attention)
- 🔴 **Rouge** : Chute de tension > 5% (non conforme)

**Badges d'équipements de simulation** :
- 🟢 **Badge vert** : EQUI8 actif sur le nœud
- 🔵 **Badge bleu** : SRG2 actif sur le nœud
- 🟡 **Badge jaune** : Équipement présent mais désactivé

### Panneau de résultats détaillés

#### Conformité globale
- **Conforme** : Tous les circuits respectent les 3%
- **Non conforme** : Au moins un circuit dépasse les 3%

#### Détails par circuit
- **I (A)** : Intensité circulant dans le câble
- **ΔU (%)** : Chute de tension en pourcentage
- **ΔU (V)** : Chute de tension en volts
- **Pertes (W)** : Pertes par effet Joule
- **Longueur** : Distance en mètres

#### Jeu de barres virtuel
- **Tension** : Tension au secondaire du transformateur
- **Intensité** : Courant total au secondaire
- **ΔU** : Variation de tension due au transformateur

## 📁 Gestion des projets

### Sauvegarder un projet
1. Cliquez sur **"Sauvegarder"**
2. Le fichier JSON est téléchargé automatiquement
3. Conservez ce fichier pour vos archives

### Charger un projet existant
1. Cliquez sur **"Charger"**
2. Sélectionnez votre fichier JSON
3. Le projet s'ouvre avec tous ses paramètres

### Exporter un rapport PDF
1. Cliquez sur **"Exporter PDF"**
2. Le rapport complet est généré automatiquement
3. Contenu enrichi :
   - ✅ Schéma du réseau et tableaux de calculs détaillés
   - ✅ **Données de simulation** si le module est actif (EQUI8, SRG2)
   - ✅ **Détails EQUI8** : Réduction I_N, tensions Ph-N, puissances réactives
   - ✅ **Détails SRG2** : Tensions entrée/sortie, états commutateurs, coefficients
   - ✅ **Comparaison baseline vs simulation** : Tableaux avant/après

> 💡 **Astuce** : Pour exporter uniquement les calculs standards (sans simulation), désactivez tous les équipements avant d'exporter le PDF.

## 🔧 Fonctionnalités avancées

### Mise à jour automatique des câbles
- **"Mettre à jour câbles"** : Actualise la base de données des types de câbles
- Ajoute les dernières références normalisées

### Recherche d'adresse
1. Cliquez sur l'outil **"Adresse"**
2. Tapez l'adresse recherchée
3. La carte se centre automatiquement

### Calcul avec tension cible
- Permet de déterminer la section de câble nécessaire
- Pour atteindre une tension spécifique en bout de ligne

### Totaux Clients Cabine et alerte transfo

L'onglet **Paramètres** affiche côte à côte :
- **Circuit** : Charges/productions foisonnées des nœuds connectés au réseau
- **Clients Cabine** : Charges/productions foisonnées de **tous** les clients importés (liés et non liés)

Une **alerte transfo** s'affiche automatiquement si :
- **Surcharge** : les charges foisonnées dépassent la puissance du transfo + les productions
- **Injection** : les productions foisonnées dépassent la puissance du transfo + les charges

---

## 🔬 Module de Simulation

Le module de simulation vous permet d'ajouter des équipements de compensation et de régulation pour optimiser votre réseau électrique.

### 8.1 Accéder au module simulation

**Où le trouver ?**
1. Double-cliquez sur un nœud du réseau
2. Dans le panneau d'édition, cliquez sur le bouton **"Simulation"**
3. Un panneau latéral droit s'ouvre avec 3 onglets :
   - 🟢 **EQUI8** : Compensateurs de courant de neutre
   - 🔵 **SRG2** : Régulateurs de tension
   - 📖 **Documentation** : Aide contextuelle sur les équipements

### 8.2 EQUI8 - Compensateur de Courant de Neutre

#### Qu'est-ce que l'EQUI8 ?

L'EQUI8 est un dispositif intelligent qui :
- **Réduit le courant dans le conducteur neutre** (I_N) en injectant des puissances réactives
- **Protège contre l'échauffement** du conducteur neutre
- **Équilibre automatiquement** les tensions phase-neutre (Ph-N) entre les phases A, B et C
- **S'adapte en temps réel** aux conditions de charge du réseau

**Bénéfices** :
- Économies sur la section du conducteur neutre
- Réduction des pertes par effet Joule
- Amélioration de la qualité de la tension
- Conformité aux normes de sécurité

#### Comment l'utiliser ?

1. **Ouvrir l'onglet EQUI8** dans le panneau de simulation
2. **Cliquer sur "+ Ajouter"** pour créer un nouveau compensateur
3. **Sélectionner un nœud éligible** dans la liste déroulante
   - Le nœud doit remplir toutes les conditions d'éligibilité (voir ci-dessous)
4. **Configurer les paramètres** :
   - **Puissance max (kVA)** : Limite de puissance réactive disponible (par défaut: 50 kVA)
   - **Seuil I_N (A)** : Courant minimal pour activer le compensateur (par défaut: 10A)
   - **Zph - Phase (Ω)** : Impédance de phase, doit être > 0.15Ω (par défaut: 0.5Ω)
   - **Zn - Neutre (Ω)** : Impédance de neutre, doit être > 0.15Ω (par défaut: 0.2Ω)
5. **Activer le compensateur** en basculant le switch vert
6. **Lancer la simulation** en cliquant sur le bouton **"Simuler"** en bas du panneau

#### Conditions d'utilisation

Pour qu'un EQUI8 puisse fonctionner, **toutes** ces conditions doivent être remplies :

- ✅ **Réseau 400V tétraphasé** (3 phases + neutre)
  - Vérifiez dans Paramètres généraux → Système de tension = "400V tétraphasé"
- ✅ **Nœud monophasé Phase-Neutre** (MONO_230V_PN)
  - Le nœud doit être connecté entre une phase et le neutre
- ✅ **Mode "Monophasé réparti"** activé
  - Allez dans Paramètres généraux → Cochez "Mode monophasé réparti"
- ✅ **Déséquilibre > 0%** configuré
  - Ajustez le curseur "Déséquilibre" dans Paramètres généraux

> ⚠️ **Important** : Si l'EQUI8 apparaît grisé ou désactivé, le panneau affiche des boutons rapides pour activer automatiquement le mode déséquilibré et configurer les paramètres nécessaires.

#### Lecture des résultats EQUI8

Une fois la simulation exécutée, les résultats s'affichent dans des cartes récapitulatives :

**Indicateurs principaux** :
- **I-EQUI8 (A)** : Courant absorbé par l'EQUI8 lui-même
- **Réduction (%)** : Pourcentage de réduction du courant de neutre
  - Exemple : 45% signifie que I_N a été réduit de 45%
- **I_N initial / I_N compensé** : Comparaison avant/après
  - Exemple : 85A → 47A

**Tensions équilibrées** :
- **Ph1-N (V)** : Tension phase A - neutre après compensation
- **Ph2-N (V)** : Tension phase B - neutre après compensation
- **Ph3-N (V)** : Tension phase C - neutre après compensation
- Ces tensions doivent être proches et idéalement autour de 230V

**Puissances réactives injectées** :
- **Q_A (kVAr)** : Puissance réactive injectée sur phase A
- **Q_B (kVAr)** : Puissance réactive injectée sur phase B
- **Q_C (kVAr)** : Puissance réactive injectée sur phase C

**Badges d'état** :
- 🟡 **"Limité par puissance max"** : La compensation demandée dépasse la puissance maximale configurée → envisagez d'augmenter maxPower_kVA
- 🟢 **"Actif"** : L'EQUI8 fonctionne normalement

### 8.3 SRG2 - Régulateur de Tension Triphasé

#### Qu'est-ce que le SRG2 ?

Le SRG2 est un stabilisateur automatique de tension qui :
- **Régule indépendamment chaque phase** (A, B, C) pour maintenir une tension stable
- **Dispose de 5 positions de commutation** par phase (LO2, LO1, Bypass, BO1, BO2)
- **S'adapte automatiquement** à la tension d'entrée avec hystérésis pour éviter les oscillations
- **Vise à maintenir 230V** stable sur chaque phase en sortie

**Applications** :
- Compensation des chutes de tension importantes
- Stabilisation en cas de production PV fluctuante
- Amélioration de la qualité de la tension en bout de ligne
- Conformité aux normes EN 50160

#### Types de SRG2

Le type de SRG2 est **automatiquement adapté** au système de tension de votre réseau :

**SRG2-400** (pour réseau 400V tétraphasé) :
- Régulation : **±7% / ±3.5%**
- Seuils par défaut : 246V, 238V, Bypass, 222V, 214V
- Utilisé pour les réseaux avec conducteur neutre

**SRG2-230** (pour réseau 230V triphasé) :
- Régulation : **±6% / ±3%**
- Seuils par défaut : 244V, 236V, Bypass, 224V, 216V
- Utilisé pour les réseaux phase-phase sans neutre

> 💡 **Astuce** : Lors du changement de système de tension (230V ↔ 400V), tous les SRG2 sont automatiquement reconfigurés avec les paramètres appropriés.

#### Comment l'utiliser ?

1. **Ouvrir l'onglet SRG2** dans le panneau de simulation
2. **Cliquer sur "+ Ajouter"** pour créer un nouveau régulateur
3. **Sélectionner un nœud** où installer le SRG2
   - Peut être installé sur n'importe quel nœud du réseau
4. **Configurer les paramètres** (optionnel, les valeurs par défaut sont optimales) :
   - **Seuils de régulation** : LO2, LO1, BO1, BO2 (en Volts)
   - **Coefficients** : Pourcentages d'augmentation/réduction de tension
5. **Activer le SRG2** en basculant le switch vert
6. **Lancer la simulation** en cliquant sur **"Simuler"**

#### Vérification des limites de puissance

Le panneau SRG2 affiche automatiquement les **puissances aval foisonnées** pour chaque régulateur :

**Badges de statut** :
- 🟢 **"Dans les limites"** : Puissance aval OK, le SRG2 peut fonctionner normalement
- 🟡 **"Proche limite (X%)"** : Plus de 80% de la limite atteinte → surveiller
- 🔴 **"Limite dépassée (X%)"** : Plus de 100% de la limite → le SRG2 ne peut pas réguler correctement

**Limites techniques** :
- **Injection max : 85 kVA** (cas production PV > charges en aval)
- **Prélèvement max : 110 kVA** (cas charges > production en aval)

> ⚠️ **Attention** : Si la limite est dépassée, répartissez les charges sur plusieurs départs ou installez plusieurs SRG2 sur le réseau.

#### Lecture des résultats SRG2

**Tensions d'entrée** :
- **Entrée A, B, C (V)** : Tensions mesurées avant régulation
- Permet de voir l'état initial du réseau

**États des commutateurs** :
Chaque phase affiche son état de commutation :
- **LO2** : Baisse forte (-7% ou -6%)
- **LO1** : Baisse modérée (-3.5% ou -3%)
- **BYP** : Bypass, pas de modification (0%)
- **BO1** : Boost modéré (+3.5% ou +3%)
- **BO2** : Boost fort (+7% ou +6%)

**Coefficients appliqués** :
- **Coeff A, B, C (%)** : Pourcentage de correction appliqué sur chaque phase
- Exemple : +7% sur phase A signifie tension augmentée de 7%

**Tensions de sortie** :
- **Sortie A, B, C (V)** : Tensions régulées après traitement par le SRG2
- Objectif : proche de 230V pour chaque phase

**Puissance aval** :
- **Puissance aval (kVA)** : Puissance totale calculée en aval du SRG2
- Comparée aux limites 85/110 kVA

**Badges d'état** :
- 🔴 **"Limite puissance atteinte"** : Dépassement des 85/110 kVA
- 🟢 **"Actif"** : Le SRG2 fonctionne normalement

## 🔄 Mode Déséquilibré

### Qu'est-ce que le mode déséquilibré ?

Le mode déséquilibré permet de modéliser des réseaux réels où :
- Les charges et productions monophasées ne sont **pas réparties uniformément** sur les trois phases
- Il existe un **courant de neutre non nul** (I_N)
- Les tensions phase-neutre (Ph-N) sont **différentes** pour chaque phase

Ce mode est **indispensable** pour utiliser l'EQUI8, car sans déséquilibre, il n'y a pas de courant de neutre à compenser.

### Comment l'activer ?

1. Ouvrir le menu **"Paramètres généraux"** (icône ⚙️ dans le menu principal)
2. Cocher la case **"Mode monophasé réparti"**
3. Ajuster le curseur **"Déséquilibre (%)"** :
   - **0%** = Charges équilibrées parfaitement (33.33% sur chaque phase)
   - **50%** = Déséquilibre modéré
   - **100%** = Déséquilibre maximal (répartition très inégale)

### Répartition des phases

Trois curseurs permettent de définir la distribution manuelle des charges/productions :

- **Phase A (%)** : Pourcentage de puissance sur la phase A
- **Phase B (%)** : Pourcentage de puissance sur la phase B
- **Phase C (%)** : Pourcentage de puissance sur la phase C

> 📌 **Note** : Le total des trois phases doit toujours égaler 100%. Les curseurs s'ajustent automatiquement pour respecter cette contrainte.

### Visualisation

**Sur la carte** :
- Les tensions Ph-N s'affichent différemment pour chaque phase si le mode est activé
- Les nœuds monophasés montrent leur phase de connexion (A, B ou C)

**Dans les résultats** :
- Le **courant de neutre (I_N)** apparaît dans les calculs
- Les tensions **Ph-N** sont affichées individuellement (V_A-N, V_B-N, V_C-N)
- Les déséquilibres de phase sont quantifiés

> 💡 **Astuce - Recentrage automatique** : Lorsque vous quittez le mode plein écran du panneau de résultats (icône œil 👁️), la carte se recentre automatiquement sur votre projet pour vous faciliter la navigation.

---

## 🔌 Calcul de tension — Détails techniques

Ce chapitre décrit en détail le fonctionnement du moteur de calcul électrique utilisé par l'application.

### 10.1 Systèmes de tension supportés

L'application supporte deux systèmes de tension fondamentalement différents :

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
- **Types de raccordement** : MONO_230V_PP (monophasé phase-phase), TRI_230V_3F (triphasé 3 fils)
- **Impédances utilisées** : toujours R12/X12 (phase-phase)
- **Tension interne BFS** : la référence de calcul est 230/√3 ≈ 133V par phase, ce qui assure des courants de branche et pertes I²R physiquement corrects tout en présentant les tensions ligne-ligne (230V) dans l'interface

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
- **Types de raccordement** : MONO_230V_PN (phase-neutre), TÉTRA_3P+N_230_400V (tétraphasé)
- **Impédances** : phases → R12/X12, neutre → R0/X0

### 10.2 Formule d'impédance des conducteurs (GRD belges)

L'impédance effective des conducteurs de phase est calculée selon la formule des GRD belges (ORES/RESA/Sibelga), qui combine les composantes directe et homopolaire pour refléter le déséquilibre structurel du réseau :

```
R_eff = (R0 + 2 × R12) / 3
X_eff = (X0 + 2 × X12) / 3
```

Le conducteur neutre utilise directement R0/X0. Cette formule s'applique à tous les calculs de chute de tension (BFS) et de recherche d'emplacement optimal.

### 10.3 Algorithme Backward-Forward Sweep (BFS)

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

I_inj(n) = conj(S_phase(n) / V(n))
```

Les puissances actives (P) et réactives (Q) sont calculées séparément pour les charges (cos φ charges, par défaut 0.95 inductif) et les productions (cos φ productions, par défaut 1.00), puis combinées par somme vectorielle au nœud.

**Étape 2 — Backward (courants de branches)**

```
I_branche(u→parent) = I_inj(u) + Σ I_branche(descendants de u)
```

**Étape 3 — Forward (mise à jour des tensions)**

```
V_source_bus = V_slack − Z_transfo × I_source_net
V(enfant) = V(parent) − Z_câble × I_branche
```

**Étape 4 — Convergence** : vérification de la variation maximale de tension phasorielle.

### 10.4 Impédance du transformateur

Le transformateur HT/BT est modélisé par son impédance série par phase :

```
Z_pu  = Ucc% / 100
Z_base = U_ligne² / S_nominal_VA
|Z|   = Z_pu × Z_base

R = |Z| / √(1 + (X/R)²)
X = R × (X/R)

Z_transfo = R + jX
```

### 10.5 Foisonnement différencié

Le foisonnement (taux de simultanéité) est appliqué différemment selon le type de client :

| Type | Foisonnement typique | Usage |
|------|---------------------|-------|
| **Résidentiel** | 15-30% | Habitations, petits commerces |
| **Industriel** | 70-100% | Usines, entrepôts |

Le calcul au nœud :
```
Charges_foisonnées = Σ(résidentiels × fois_résidentiel/100) + Σ(industriels × fois_industriel/100)
Productions_foisonnées = Σ(PV_kVA × fois_productions/100)
```

### 10.6 Scénarios de calcul

| Scénario | Puissance équivalente au nœud |
|----------|-------------------------------|
| **Prélèvement** | S_eq = charges foisonnées |
| **Production** | S_eq = −productions foisonnées |
| **Mixte** | S_eq = charges foisonnées − productions foisonnées |

### 10.7 Résultats par tronçon

Pour chaque câble du réseau :

| Grandeur | Formule |
|----------|---------|
| Courant RMS | I = \|I_branche\| |
| Chute par phase | ΔV_ph = Z_câble × I_ph |
| Chute ligne | ΔU = \|ΔV_ph\| × √3 (si triphasé) |
| Pourcentage | ΔU% = ΔU / U_ref × 100 |
| Pertes Joule | P = I² × R × 3 (si triphasé) / 1000 kW |

### 10.8 Conformité EN 50160

Pour chaque nœud, l'écart par rapport à la tension nominale est évalué :

| Écart | Statut | Couleur |
|-------|--------|---------|
| ≤ 8% | Normal | 🟢 Vert |
| ≤ 10% | Attention | 🟡 Orange |
| > 10% | Critique | 🔴 Rouge |

### 10.9 Raccordements monophasés 230V Triangle (correction vectorielle)

En réseau 230V triangle, un client monophasé branché entre deux phases (ex. L1-L2) est modélisé par une paire de phaseurs opposés :
- S_A = +S_total à 0°
- S_B = −S_total à 180°

Cela assure que le courant calculé par le BFS vaut bien I = S_total / 230V, sans double-comptage de puissance.

### 10.10 Tension source configurable

La tension source est réglable via un curseur dans l'onglet **Réseau** :
- **230V** : plage 225–240V
- **400V** : plage 390–430V

Elle est automatiquement réinitialisée à la valeur nominale lors d'un changement de système de tension.

---

## 🟢 Calcul EQUI8 — Détails techniques

Ce chapitre décrit en détail le modèle de calcul du compensateur de courant de neutre EQUI8.

### 11.1 Principe physique

L'EQUI8 agit exclusivement comme une **source de courant shunt** :
- Injection de +I sur le conducteur neutre
- Injection de −I/3 sur chacune des trois phases

Les tensions résultantes sont calculées naturellement par le solveur BFS — elles ne sont jamais imposées ni forcées.

### 11.2 Conditions d'éligibilité

Un nœud est éligible à l'EQUI8 si :
1. Réseau **400V tétraphasé** (neutre requis)
2. Le nœud possède un **déséquilibre réel** entre phases (détecté dynamiquement)
3. Impédances équivalentes Zph et Zn ≥ **0.15Ω** (contrainte fournisseur)

L'éligibilité est désormais indépendante du mode de charge global et fonctionne aussi bien en mode `monophase_reparti` qu'en mode `mixte_mono_poly`.

### 11.3 Algorithme de calibration CME

L'EQUI8 utilise une boucle de calibration par **méthode de la sécante** avec amortissement :

1. Calcul du courant de neutre initial I_N = I_A + I_B + I_C (somme vectorielle)
2. Si |I_N| < seuil → EQUI8 reste inactif
3. Calcul itératif du courant d'injection optimal :
   - Variation de I limitée à **±20% par itération**
   - Facteur d'amortissement **0.7** pour éviter les oscillations
4. Respect des **limites thermiques** :
   - 80A pendant 15 minutes
   - 60A pendant 3 heures
   - 45A en régime permanent
5. Si une limite est atteinte, la calibration s'arrête au cap et la saturation est signalée

### 11.4 Placement optimal

Le nœud optimal pour l'EQUI8 est déterminé en maximisant le score :

```
Score = I_neutre / Z_amont
```

Ce critère privilégie les nœuds avec un fort courant de neutre (déséquilibre marqué) tout en s'assurant que l'impédance amont est assez faible pour ne pas que le compensateur domine la tension locale. La recherche est contrainte aux nœuds situés entre **10% et 70%** de l'impédance totale du réseau.

### 11.5 Interaction avec le SRG2

- L'EQUI8 (shunt courant) et le SRG2 (série tension) sont **physiquement compatibles** et peuvent coexister
- **Règle de conflit** : si un SRG2 et un EQUI8 sont sur le même nœud ou en relation parent/enfant immédiate, le SRG2 est prioritaire et l'EQUI8 est automatiquement désactivé
- La boucle de couplage suit la séquence : EQUI8 → Décision SRG2 → Application SRG2 → BFS → Mise à jour

---

## 🔵 Calcul SRG2 — Détails techniques

Ce chapitre décrit en détail le modèle de calcul du régulateur de tension SRG2.

### 12.1 Principe physique

Le SRG2 est modélisé comme une **injection de tension série** dans une branche (câble). Dans le forward sweep du BFS :

```
V_sortie = (V_amont − Z_câble × I) + V_série
```

V_série est un phaseur complexe injecté dans la branche. Les tensions nodales sont ainsi un résultat naturel du solveur réseau, pas un forçage arbitraire.

### 12.2 Modèle d'automate à seuils

Le SRG2 fonctionne comme un **automate à seuils** (pas un régulateur PID). La convergence est définie par la stabilité de la décision de prise : si `tap_change == 0` après une itération, l'automate a convergé.

Chaque phase dispose de 5 positions indépendantes :

| Position | SRG2-400 | SRG2-230 |
|----------|----------|----------|
| **LO2** | −7% | −6% |
| **LO1** | −3.5% | −3% |
| **Bypass** | 0% | 0% |
| **BO1** | +3.5% | +3% |
| **BO2** | +7% | +6% |

La décision de changement de prise intègre une **hystérésis de ±2V** et une **temporisation de 7 secondes** pour éviter les oscillations.

### 12.3 Limites de puissance

| Mode | Limite |
|------|--------|
| **Injection** (PV > charges) | 85 kVA max |
| **Prélèvement** (charges > PV) | 110 kVA max |

Si la puissance aval foisonnée dépasse ces limites, le SRG2 ne peut plus réguler correctement.

### 12.4 Placement optimal

La fonction de recherche identifie le nœud optimal pour le SRG2 **dans un rayon de 250m** de la source. Elle :
1. Privilégie les nœuds conformes à la norme EN 50160 (207V–253V)
2. Calcule un **score d'impact** : pourcentage de nœuds aval remis en conformité après une régulation théorique ±7%

```
Score = (nœuds corrigés / nœuds hors norme initiaux) × 100
```

### 12.5 Boucle de couplage SRG2 + EQUI8

Lorsque les deux équipements sont actifs sur le réseau, la simulation suit une séquence causale :

1. **EQUI8** : calcul du courant d'injection (CME) à partir de l'état réseau courant
2. **SRG2** : décision de prise basée sur les tensions résultantes
3. **Application** des coefficients SRG2 aux nœuds concernés
4. **BFS** : recalcul complet des tensions et courants
5. **Convergence** : atteinte dès que le SRG2 ne demande plus de changement de prise

L'EQUI8 est recalculé dynamiquement à chaque itération sans utiliser de ratios mémorisés.

---

## ⚠️ Normes et conformité

### Limites réglementaires
- **Chute de tension max** : 3% selon NF C 15-100
- **Facteur de puissance** : Généralement entre 0.8 et 1.0
- **Sections minimales** : Selon usage et protection

### Cas particuliers
- **Remontée de tension** : En cas de production PV importante
- **Déséquilibre** : Répartition des phases sur les charges monophasées
- **Harmoniques** : Impact des charges non linéaires

## 🐛 Résolution des problèmes

### Circuit non conforme
1. **Vérifiez la section** : Augmentez si nécessaire
2. **Contrôlez la longueur** : Réduisez le chemin si possible
3. **Répartissez les charges** : Équilibrez sur plusieurs départs

### Erreurs de calcul
1. **Vérifiez les connexions** : Tous les nœuds doivent être reliés
2. **Contrôlez les données** : Puissances et sections cohérentes
3. **Rechargez le projet** : En cas d'état incohérent

### Performance
- **Projets volumineux** : Limitez le nombre de nœuds (< 100 recommandé)
- **Calculs lents** : Simplifiez le réseau si nécessaire

### EQUI8 ne s'active pas

Si l'EQUI8 apparaît grisé ou refuse de s'activer :

1. **Vérifier le système de tension** : Doit être en **400V tétraphasé**
   - Menu → Paramètres généraux → Système de tension = "400V tétraphasé"
2. **Vérifier le type de connexion du nœud** : Doit être **MONO_230V_PN**
   - Double-clic sur le nœud → Vérifier "Type de connexion"
3. **Activer le mode monophasé réparti** :
   - Menu → Paramètres généraux → Cocher "Mode monophasé réparti"
4. **Configurer un déséquilibre > 0%** :
   - Ajuster le curseur "Déséquilibre" dans Paramètres généraux
5. **Vérifier les impédances** :
   - Zph (Phase) et Zn (Neutre) doivent être **> 0.15Ω**
   - Configuration dans le panneau EQUI8

> 💡 **Astuce** : Le panneau EQUI8 affiche des boutons d'aide rapide pour activer automatiquement le mode déséquilibré si nécessaire.

### SRG2 affiche "Limite puissance atteinte"

Si le badge rouge de limite de puissance s'affiche :

1. **Vérifier les puissances aval foisonnées** :
   - Consultez l'indicateur dans le panneau SRG2 (en kVA)
2. **Réduire les charges ou productions en aval** :
   - Diminuer la puissance des charges connectées après le SRG2
   - Réduire la puissance PV si en mode injection
3. **Répartir les charges sur plusieurs départs** :
   - Diviser le réseau pour équilibrer les puissances
4. **Installer plusieurs SRG2** :
   - Placer des régulateurs sur plusieurs branches du réseau

> 📌 **Rappel des limites** : Injection max = 85 kVA / Prélèvement max = 110 kVA

### Les résultats de simulation ne s'affichent pas

Si la simulation ne produit pas de résultats :

1. **Vérifier qu'au moins un équipement est activé** :
   - Le switch vert doit être activé sur un EQUI8 ou un SRG2
2. **Cliquer sur "Simuler"** :
   - Bouton en bas du panneau de simulation
3. **Vérifier le badge de convergence** :
   - Doit afficher "Convergé" en vert
4. **Si "Non convergé"** :
   - Simplifier le réseau (moins de nœuds en aval)
   - Ajuster les paramètres des équipements
   - Réduire le déséquilibre (< 30%)

## 📞 Support technique

Pour toute question ou problème :
1. Vérifiez ce manuel en premier lieu
2. Contrôlez la cohérence de vos données
3. Sauvegardez votre projet avant modifications importantes

---

*Application développée pour les professionnels de l'électricité - Conforme aux normes NF C 15-100*
*Dernière mise à jour : 10 février 2026*
