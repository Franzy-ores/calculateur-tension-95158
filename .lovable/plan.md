

# Plan : Correction affichage 3 phases sur profil 24h et verification modele thermique

## Diagnostic

### Probleme 1 : Une seule courbe visible au lieu de 3 phases

Apres analyse approfondie du code, le probleme peut avoir deux causes :

**Cause probable A** : Si le reseau est parfaitement equilibre (distribution 33.3%/33.3%/33.3% sur les 3 phases), les trois courbes ont des valeurs IDENTIQUES et se superposent visuellement en une seule ligne. C'etait probablement deja le cas avant, mais peut-etre moins visible avec des valeurs de R differentes.

**Cause probable B** : Si `project.loadModel` est `undefined` (ancien projet), le fallback sur ligne 564 de `electricalCalculations.ts` utilise `'polyphase_equilibre'` au lieu de `'mixte_mono_poly'`. Cela active le mode equilibre (ligne 2276-2303) qui retourne A=B=C identiques. Ceci serait une regression si le store a ete modifie.

### Probleme 2 : Verification coherence modele thermique

Le modele thermique dans `thermalModel.ts` est **coherent** avec le prompt :

| Exigence | Implementation | Statut |
|---|---|---|
| Temperatures ambiantes (aerien/souterrain × hiver/ete) | `AMBIENT_TEMPERATURES` lignes 24-27 | OK |
| T_cable = T_ambient + k × (I/Imax)^2 | `calculateCableTemperature` ligne 61 | OK |
| k = 40 aerien, 35 souterrain | `HEATING_CONSTANTS` lignes 30-33 | OK |
| R(T) = R20 × (1 + alpha × (T-20)) | `correctResistance` ligne 86 | OK |
| alpha Cu=0.00393, Al=0.00403 | `ALPHA_COEFFICIENTS` lignes 36-41 | OK |
| X non corrige | `selectRX` ligne 297 : X sans thermalFactor | OK |
| R_eq = (R0_T + 2×R12_T) / 3 | `calculateGRDImpedance` applique thermalFactor aux R uniquement | OK |
| Integration dans BFS | `cableZ_phase` construit avec correction thermique | OK |
| Saison propagee dans profil 24h | `dailyProfileCalculator.ts` ligne 214 | OK |
| Neutre corrige aussi | Ligne 1516-1522 avec `forNeutral: true` | OK |

**Un point d'amelioration identifie** : Le courant `I_A` est fixe a 0 dans le calcul thermique (lignes 848 et 1519). Le prompt demande que le courant horaire `I(h)` soit utilise pour chaque heure. Cela signifie que l'echauffement par surcharge `(I/Imax)^2` n'est jamais applique - seule la temperature ambiante est prise en compte. Pour une premiere implementation c'est acceptable (effet principal = saison), mais cela devrait etre ameliore.

## Solution proposee

### Correction 1 : Forcer le graphe a montrer 3 courbes distinctes (4 fichiers)

**Fichier `src/utils/electricalCalculations.ts`** (ligne 564) :
- Remplacer le fallback `'polyphase_equilibre'` par `'mixte_mono_poly'` dans `calculateScenarioWithHTConfig`
- Idem ligne 583 pour le parametre par defaut de `calculateScenario`

Cela garantit que le mode desequilibre (per-phase) est toujours actif, meme pour les anciens projets.

**Fichier `src/components/DailyProfileChart.tsx`** :
- Ajouter une detection quand les 3 phases ont des valeurs identiques (equilibre parfait)
- Dans ce cas, afficher une seule courbe "Vmoy" au lieu de 3 courbes superposees, avec une legende indiquant "Equilibre (3 phases confondues)"

### Correction 2 : Integration du courant horaire dans le modele thermique

**Fichier `src/utils/electricalCalculations.ts`** (lignes 844-850) :
- Lors du BFS per-phase, apres la premiere iteration (quand les courants de branche sont connus), recalculer le contexte thermique avec le courant reel `I(h)` et mettre a jour les impedances
- Utiliser le courant total des 3 phases pour estimer I dans le terme `(I/Imax)^2`

Cela complete l'exigence du prompt : "Pour chaque heure : T_cable(h) = T_ambient + k × (I(h)/Imax)^2"

### Correction 3 : Harmonisation des defaults (mineur)

**Fichier `src/utils/electricalCalculations.ts`** :
- Ligne 564 : `project.loadModel ?? 'mixte_mono_poly'` (au lieu de `'polyphase_equilibre'`)
- Ligne 583 : `loadModel: LoadModel = 'mixte_mono_poly'` (au lieu de `'polyphase_equilibre'`)

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/utils/electricalCalculations.ts` | Defaults `loadModel` a `mixte_mono_poly`, integration courant reel dans contexte thermique |
| `src/components/DailyProfileChart.tsx` | Gestion visuelle quand 3 phases confondues |

## Sequence d'implementation

1. Corriger les defaults `loadModel` dans `electricalCalculations.ts`
2. Integrer le courant de branche dans le contexte thermique (BFS iteration)
3. Ameliorer l'affichage du graphe quand les phases sont identiques

