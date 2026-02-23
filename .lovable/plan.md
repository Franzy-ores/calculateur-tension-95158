

# Corrections GRD du moteur electrique BT

## Contexte

Apres analyse complete des fichiers `electricalCalculations.ts` (2466 lignes), `dailyProfileCalculator.ts` (1099 lignes) et `thermalModel.ts` (134 lignes), voici les corrections identifiees et la strategie d'implementation.

---

## PRIORITE 1 -- Corrections critiques

### 1.1 Reseau 230V triangle -- eviter la double-correction phase-phase

**Probleme identifie** : Lignes 1128-1240 de `electricalCalculations.ts`, une correction vectorielle est appliquee sur les `phasePhaseLoads` pour calculer les courants corrects en triangle. Mais les puissances par phase (S_A_map, S_B_map, S_C_map) sont deja calculees aux lignes 1060-1126 a partir de `autoPhaseDistribution`. La correction vectorielle REMPLACE ensuite ces valeurs (ligne 1233-1235), ce qui peut creer une incoherence si le foisonnement est applique deux fois (une fois dans les proportions pA/pB/pC, une fois via `foisChargeCoeff`).

**Correction** :
- Ajouter un flag `vectorialCorrectionApplied` dans `autoPhaseDistribution` pour eviter la double-application
- Si `autoPhaseDistribution.phasePhaseLoads` existe et que les valeurs sont deja foisonnees (via `foisonneAvecCurseurs`), ne pas re-appliquer `foisChargeCoeff` dans le bloc vectoriel (lignes 1165-1166)
- Verifier que S_AB, S_BC, S_AC ne subissent le foisonnement qu'une seule fois

**Fichier** : `src/utils/electricalCalculations.ts` (lignes 1139-1240)

### 1.2 Foisonnement -- suppression du double foisonnement

**Probleme identifie** : Dans `dailyProfileCalculator.ts`, le foisonnement horaire est calcule (lignes 193-236) puis injecte dans le projet via `foisonnementChargesResidentiel` et `foisonnementChargesIndustriel` (lignes 239-246). Ensuite dans `electricalCalculations.ts` (lignes 647-668), ces valeurs sont utilisees pour multiplier `client.puissanceContractuelle_kVA * (foisonnement / 100)`. Le probleme est que les `phasePhaseLoads` dans `autoPhaseDistribution` sont calcules a partir des puissances BRUTES des clients, donc le foisonnement est correctement applique une fois. MAIS si `foisonneAvecCurseurs` est deja foisonne et que le bloc vectoriel (ligne 1144-1145) re-applique `foisChargeCoeff`, on obtient S x F^2.

**Correction** :
- Dans le bloc vectoriel 230V (lignes 1140-1240), detecter si les valeurs `phasePhaseLoads` sont deja foisonnees
- Si `foisonneAvecCurseurs` est utilise pour les proportions (ce qui implique que le foisonnement est integre), ne pas re-appliquer `foisChargeCoeff` aux `phasePhaseLoads.charges`
- Ajouter un commentaire clair `// 🔧 FIX GRD -- foisonnement applique une seule fois`

**Fichier** : `src/utils/electricalCalculations.ts` (lignes 1140-1240)

### 1.3 Thermique -- limitation normative T_max

**Probleme identifie** : Dans `thermalModel.ts`, la temperature du cable n'est pas bornee. Le ratio I/Imax est limite a 2x (ligne 83) mais aucune limite normative IEC 60287 n'est appliquee :
- PVC : T_max = 70 degC
- XLPE/PR : T_max = 90 degC

Sans cette limite, R(T) peut devenir irrealiste et destabiliser le BFS.

**Correction** :
- Ajouter une constante `INSULATION_TEMP_LIMITS` avec PVC=70 et XLPE=90
- Ajouter un parametre optionnel `insulationType` a `calculateCableTemperature` et `getThermalCorrectionFactor`
- Appliquer `T_cable = Math.min(T_cable, T_max_insulation)` avant le retour
- Dans `CableType` (types/network.ts), ajouter un champ optionnel `insulationType?: 'PVC' | 'XLPE' | 'PR'`
- Fallback: si `insulationType` non defini, borner a 90 degC (XLPE par defaut, le plus courant en BT)

**Fichiers** :
- `src/utils/thermalModel.ts` : ajout des limites et du parametre
- `src/types/network.ts` : ajout du champ `insulationType` dans `CableType`
- `src/utils/electricalCalculations.ts` : passer `insulationType` au contexte thermique

### 1.4 EN50160 -- reference de tension correcte

**Probleme identifie** : Partiellement corrige. Pour `MONO_230V_PN`, la reference est bien 230V (lignes 1748-1750, 1763-1766). Mais pour `TETRA_3P+N_230_400V`, la reference U_ref_display utilise `sourceNode.tensionCible` (ligne 1751-1752) au lieu de la tension nominale 230V (phase-neutre). Idem pour le mode equilibre (lignes 2200-2201).

**Correction** :
- Pour TOUS les types de connexion, la conformite EN50160 doit etre evaluee par rapport a la tension nominale du type de connexion (230V pour phase-neutre, 230V pour triangle, 400V pour ligne-ligne en etoile)
- Ne JAMAIS utiliser `tensionCible` comme reference EN50160
- Modifier lignes 1746-1756 : toujours utiliser `U_base` du type de connexion
- Modifier lignes 2199-2201 : idem pour le mode equilibre

**Fichier** : `src/utils/electricalCalculations.ts` (lignes 1746-1756 et 2199-2201)

---

## PRIORITE 2 -- Corrections importantes

### 2.1 SRG2 -- contraintes reelles

**Probleme identifie** : `applySRG230Constraints` (lignes 724-761 de dailyProfileCalculator.ts) gere deja l'interdiction boost+buck simultanes pour SRG2-230, mais :
- Pas de priorisation du mode commun (A=B=C)
- Pas de limite totale a +/-10%
- L'hysteresis existe (lignes 664-708) mais pourrait etre renforcee

**Correction** :
- Ajouter une priorisation du mode commun : si les 3 phases sont dans le meme sens (toutes BO ou toutes LO), les aligner sur le meme niveau (le plus conservateur)
- Ajouter une verification que le coefficient total SRG2 ne depasse pas +/-10% par phase
- Etendre `applySRG230Constraints` a tous les types de SRG2, pas seulement SRG2-230

**Fichier** : `src/utils/dailyProfileCalculator.ts` (lignes 724-761)

### 2.2 Thermique -- recalcul apres convergence (2 passes)

**Probleme identifie** : La micro-iteration thermique (lignes 1417-1470 de electricalCalculations.ts) fait deja un recalcul apres le premier BFS, ce qui est correct. Mais elle ne fait qu'une seule passe supplementaire, ce qui peut etre insuffisant si les courants changent significativement apres correction thermique.

**Correction** :
- Structurer en 2 passes explicites :
  - Passe 1 : BFS avec R a 20 degC -> courants I_phase
  - Passe 2 : correction R(T) avec I reel -> BFS final
- Limiter a 2 passes maximum (pas de boucle infinie)
- Logger les temperatures avant/apres pour diagnostic

**Fichier** : `src/utils/electricalCalculations.ts` (lignes 1417-1470)

---

## PRIORITE 3 -- Ameliorations optionnelles

### 3.1 Module de validation interne

**Nouveau fichier** : `src/utils/validationModule.ts`

Fonctions de verification :
- `validatePowerBalance(nodes, cables)` : S_aval <= S_amont
- `validatePhaseBalance(node)` : A + B + C = S_total +/- 1%
- `validateNeutralCurrent(cable, maxCurrent)` : I_N <= I_max cable
- `validateFoisonnement(project)` : detecter les incoherences de foisonnement

Appele automatiquement apres chaque calcul BFS, avec logs clairs dans la console.

### 3.2 Logs explicites

Ajouter des tags `// 🔧 FIX GRD` sur chaque section modifiee pour faciliter l'audit.
Remplacer les logs emoji par des messages structures : `[GRD-FIX] description`.

---

## Tests de non-regression

**Fichier** : `src/utils/__tests__/grdCorrections.test.ts`

Cas de test :
1. Reseau 230V triangle, 30 clients, 20 kVA AB + 10 kVA BC : verifier courants realistes (pas de double-correction)
2. Reseau 400/230V, 15 kW PV sur phase B : verifier I_N > 0
3. SRG2 boost une seule phase : verifier pas de buck simultane
4. Cable XLPE surcharge legere : verifier T bloquee a 90 degC
5. Profil 24h EV + PV : verifier pas de double foisonnement (comparer S avec et sans profil)

---

## Resume des fichiers modifies

| Fichier | Modifications |
|---|---|
| `src/utils/thermalModel.ts` | Ajout limites T_max PVC/XLPE, parametre insulationType |
| `src/types/network.ts` | Ajout `insulationType` dans `CableType` |
| `src/utils/electricalCalculations.ts` | Fix double-correction 230V, fix double foisonnement, fix EN50160, thermique 2 passes, passage insulationType |
| `src/utils/dailyProfileCalculator.ts` | Renforcement contraintes SRG2 (mode commun, limite +/-10%) |
| `src/utils/validationModule.ts` | Nouveau module de validation interne |
| `src/utils/__tests__/grdCorrections.test.ts` | Tests de non-regression |

## Ordre d'implementation

1. thermalModel.ts + types/network.ts (fondations thermiques)
2. electricalCalculations.ts -- priorite 1 (double-correction, double foisonnement, EN50160)
3. electricalCalculations.ts -- priorite 2 (thermique 2 passes)
4. dailyProfileCalculator.ts -- SRG2 contraintes
5. validationModule.ts + tests

