

# Ajouter les tensions 24h dans l'onglet Labo

## Constat actuel

L'onglet Labo affiche uniquement les **puissances** (P_charge, P_pv, P_net) issues du moteur continu `circuitPowerCalculator.ts`. Mais ce moteur ne calcule pas de tensions — il n'a pas de modele de reseau (impedances cables, topologie). Seul `DailyProfileCalculator` sait calculer les tensions car il utilise le moteur electrique complet (`ElectricalCalculator`).

## Approche

Utiliser `DailyProfileCalculator` deux fois dans le Labo :

1. **Run "Palier"** : calcul normal avec `adaptiveFoisonnement: true` (paliers terrain existants)
2. **Run "Continu"** : calcul avec une option supplementaire `customDiversityCoeff` qui remplace les paliers par le coefficient continu `f(N) = a + (1-a)/√N`

Cela donne deux courbes de tension 24h superposees sur le meme graphique, avec le meme moteur electrique et le meme reseau.

## Modification minimale du moteur

### `src/types/dailyProfile.ts` — Ajouter une option

```typescript
export interface DailySimulationOptions {
  // ... existant ...
  /** Override du coefficient de diversite (remplace les paliers terrain) */
  customDiversityCoeff?: number;
}
```

### `src/utils/dailyProfileCalculator.ts` — Respecter l'override

Dans `calculateHourlyVoltage`, lignes 218-229, ajouter une branche :

```text
Si customDiversityCoeff est defini :
  baseFoisonne = baseResidentialProfile × customDiversityCoeff
  evFoisonne = baseEvBonus × customDiversityCoeff
Sinon si adaptiveFoisonnement :
  ... paliers existants (inchange) ...
```

C'est un ajout de 4 lignes dans une branche `else if`, pas de modification du code existant.

## Modifications de l'onglet Labo

### `src/components/topMenu/LaboFoisonnementTab.tsx`

Ajouter sous le graphique des puissances un **graphique des tensions** :

- Importer `DailyProfileCalculator` et `HourlyVoltageResult`
- Executer deux simulations :
  - Palier : `new DailyProfileCalculator(project, options)` (normal)
  - Continu : `new DailyProfileCalculator(project, { ...options, customDiversityCoeff: continuCoeff, adaptiveFoisonnement: false })` 
- Graphique recharts avec :
  - Courbe bleue pleine : tension moyenne palier (Vavg palier)
  - Courbe violet pointillee : tension moyenne continu (Vavg continu)
  - Bande horizontale grise : zone ±5% (218.5V — 241.5V)
  - Lignes rouges : seuils ±10% (207V — 253V)
- Tableau comparatif etendu avec colonnes supplementaires : V_palier, V_continu, ΔV

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/types/dailyProfile.ts` | +1 champ optionnel `customDiversityCoeff` |
| `src/utils/dailyProfileCalculator.ts` | +4 lignes : branche `customDiversityCoeff` avant les paliers |
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Ajout graphique tensions + double simulation |

## Ce qui ne change PAS

- `foisonnementCalculator.ts` — inchange
- `DailyProfileTab.tsx` — inchange, ne passe jamais `customDiversityCoeff`
- `circuitPowerCalculator.ts` — toujours utilise pour les puissances dans le Labo
- Tous les resultats existants du Profil 24H restent identiques (le nouveau champ est optionnel et non utilise par defaut)

## Details techniques

Le coefficient continu est calcule une seule fois par run :
```text
continuCoeff = diversityFactor(nResidential, circuitCluster, circuitConfig)
```

Puis passe en option au `DailyProfileCalculator`. Le moteur l'applique comme multiplicateur pur sur le profil de base, exactement comme les paliers mais avec une valeur continue.

