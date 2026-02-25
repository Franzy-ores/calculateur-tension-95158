

# Note d'information Profil 24H — Bouton "?" avec dialog explicatif

## Objectif

Ajouter un bouton **?** (icone `HelpCircle`) a cote du titre "Parametres de simulation" dans `DailyProfileTab.tsx`. Au clic, une dialog s'ouvre avec une explication complete du processus de calcul : parametres utilises, profils, foisonnement, clusters, VE, et calcul client.

## Contenu de la note d'information

La dialog contiendra les sections suivantes :

### 1. Parametres d'entree
- **Noeud analyse** : point du reseau ou la tension est calculee
- **Saison** : hiver / ete (profils horaires differents)
- **Meteo** : soleil / gris (facteur PV : ×1.0 ou ×0.3)
- **Cluster** : Urbain dense / Urbain residentiel / Peri-urbain / Rural (modifie facteurConso et facteurVE)

### 2. Profil de base (residential)
- Valeurs horaires 0-23h en % de la puissance contractuelle
- Hiver : pic a 21% (h19) / Ete : pic a 16.5% (h19)
- Profil industriel_pme : pic a 100% (h10-11, h14-16)
- Profil PV : courbe solaire, pic a 65% hiver / 100% ete

### 3. Auto-foisonnement (paliers terrain)
Oui, l'auto-foisonnement = application des paliers sur le profil de base :

```text
Nombre de clients (n)    Coefficient    Exemple (profil 21%)
─────────────────────    ───────────    ────────────────────
n = 1                    × 1.00         → 21.0%
n = 2 à 10               × 0.30         → 6.3%
n = 11 à 20              × 0.15         → 3.15%
n > 20                   × 0.08         → 1.68%
```

Formule : `profil_foisonne = profil_base(h) × palier(n)`

Les paliers s'appliquent a la **puissance contractuelle** (pas a la puissance appelee). Le ratio d'utilisation (~0.25-0.40) est implicitement integre dans les valeurs du profil de base.

### 4. Cluster (modificateur)
Applique **apres** le foisonnement comme multiplicateur pur :
- facteurConso : ×1.0 (urbain) a ×1.2 (rural)
- facteurVE : ×0.5 (urbain dense) a ×2.0 (rural)

### 5. Bonus VE
- Heures 18-21 : +2.5% (soiree)
- Heures 22-05 : +5.0% (nuit)
- Le bonus VE est aussi foisonne par les paliers terrain
- Puis multiplie par facteurVE du cluster

### 6. Formule finale reseau
```text
foisonnement_residentiel(h) = 
    profil_residential(h) × palier(n) × facteurConso
  + bonus_VE(h) × palier(n) × facteurVE
```

### 7. Calcul client (courbe cyan)
- Utilise le profil `client` (individuel, sans foisonnement)
- ΔU = chute de tension dans le cable de branchement
- V_client = V_noeud - ΔU

## Implementation technique

### Fichier modifie : `src/components/topMenu/DailyProfileTab.tsx`

1. Importer `HelpCircle` de lucide-react et `Dialog` de radix
2. Ajouter un state `showInfoDialog`
3. Placer un bouton `<HelpCircle>` a cote du titre CardTitle (ligne ~311)
4. Creer un composant `CalculationInfoDialog` avec ScrollArea contenant toutes les sections ci-dessus, formatees en texte lisible avec des tableaux ASCII et des exemples numeriques concrets
5. Le dialog utilise les **vrais parametres actuels** du projet : nombre de clients residentiels/industriels detectes, cluster selectionne, palier de foisonnement applique

### Nouveau composant interne : `CalculationInfoDialog`

- Props : `open`, `onOpenChange`, `nResidentialClients`, `selectedCluster`, `currentPalier`
- Affiche les valeurs dynamiques du projet en cours
- Sections avec separateurs visuels et titres en gras

