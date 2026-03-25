

# Ajout du type de charge "Bornes VE"

## Résumé

Ajouter un nouveau type de noeud de consommation "Bornes VE" (borne de recharge véhicules électriques) avec profil de charge bimodal dédié, foisonnement indépendant, et isolation vis-à-vis des curseurs VE/PAC globaux.

## Architecture des modifications

### Fichiers à créer

**`src/data/bornesVEProfile.ts`** — Profil bimodal 24h et configuration type
- Exporte `PROFIL_BIMODAL_VE: number[]` (24 valeurs normalisées 0-1)
- Exporte l'interface `BorneVEConfig` avec les champs : `puissanceParBorne_kVA`, `nombreBornes`, `puissanceRaccordee_kVA`, `cosPhiDefaut`, `borneOptions`

### Fichiers à modifier

**1. `src/types/network.ts`** (~10 lignes)
- Ajouter `ClientType = 'résidentiel' | 'industriel' | 'bornesVE'` (ligne 30)
- Ajouter au type `Project` : `foisonnementBornesVE?: number` (défaut 50)
- Ajouter à `ClientCharge` : `clientCategory?: 'bornesVE'` et `borneVEConfig?: { puissanceParBorne_kVA: number; nombreBornes: number; cosPhi: number; profil24h?: number[] }`

**2. `src/store/networkStore.ts`** (~15 lignes)
- Ajouter action `setFoisonnementBornesVE(value: number)`
- Initialiser `foisonnementBornesVE: 50` dans le projet par défaut

**3. `src/components/EditPanel.tsx`** (~80 lignes)
- Dans la section ajout de charges (après `addClient`, ligne ~129), ajouter un bouton "Ajouter Borne VE"
- Fonction `addBorneVE()` : crée un `ClientCharge` avec `clientCategory: 'bornesVE'` et `borneVEConfig` par défaut (11 kVA, 1 borne, cosPhi 0.95)
- Pour les charges de type bornesVE, afficher un formulaire spécifique :
  - Sélecteur puissance par borne (11/22 kVA)
  - Spinner nombre de bornes (1-4)
  - Puissance raccordée (pré-remplie = N×P, éditable librement)
  - cos φ
  - Résumé : "Raccordement tétraphasé 400V — X bornes × Y kVA — Raccordement : Z kVA"

**4. `src/components/topMenu/ParametersTab.tsx`** (~30 lignes)
- Ajouter un slider "Bornes VE" (icône ⚡) après le slider Industriel, avec séparateur visuel
- Plage 10-100%, pas de 5%, valeur par défaut 50%
- Calcul et affichage des totaux Bornes VE foisonnés dans les blocs Circuit/Cabine

**5. `src/utils/electricalCalculations.ts`** (~20 lignes)
- Dans le calcul `S_prel_map` (ligne ~683), ajouter la détection des charges `bornesVE` :
  - Utiliser `foisonnementBornesVE` au lieu de `foisonnementResidentiel/Industriel`
  - Distribution équilibrée sur 3 phases (L1=L2=L3=P/3)
- **Ne PAS appliquer** les coefficients de pénétration VE/PAC globaux sur ces charges

**6. `src/utils/clientsUtils.ts`** (~10 lignes)
- Dans `calculatePowersByClientType`, ajouter un retour `chargesBornesVE` séparé
- Adapter les fonctions qui filtrent par `clientType` pour gérer `bornesVE`

**7. `src/utils/dailyProfileCalculator.ts`** (~15 lignes)
- Dans le calcul horaire, détecter les charges de type `bornesVE`
- Appliquer `PROFIL_BIMODAL_VE[hour]` × puissanceRaccordee × cosPhi × foisonnementBornesVE
- Exclure ces charges du calcul VE/PAC résidentiel

**8. `src/data/profileTemplates.ts`** (~10 lignes)
- Ajouter le template `bimodal_VE` dans la liste des profils disponibles

### Points d'isolation critique

- `foisonnementBornesVE` est un paramètre indépendant, jamais mélangé avec K(N) résidentiel
- Les curseurs "Pénétration VE" et "Pénétration PAC" du labo vérifient `clientCategory !== 'bornesVE'` avant d'appliquer leurs coefficients
- Dans les tableaux récapitulatifs (PhaseDistributionDisplay), les bornes VE apparaissent comme catégorie distincte

## Ordre d'implémentation

1. Créer `bornesVEProfile.ts` + modifier `network.ts` (types)
2. Modifier `networkStore.ts` (action foisonnement)
3. Modifier `EditPanel.tsx` (UI création borne VE)
4. Modifier `ParametersTab.tsx` (slider foisonnement)
5. Modifier `electricalCalculations.ts` + `dailyProfileCalculator.ts` (moteur)
6. Modifier `clientsUtils.ts` (catégorisation)

