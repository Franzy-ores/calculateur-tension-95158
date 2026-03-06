

# Refonte Labo : Foisonnement continu comme moteur unique

## Constat

Actuellement le Labo utilise deux moteurs separement :
- `circuitPowerCalculator` pour le graphique de puissance (moteur simplifie, pas de reseau)
- `DailyProfileCalculator` pour les tensions (moteur electrique complet)

L'utilisateur veut un flux unique et coherent : la formule continue `f(N) = a + (1-a)/√N` determine le foisonnement heure par heure, et ce foisonnement alimente tout — puissances, tensions 24h, et graphiques tension-distance.

## Architecture cible

Un seul moteur : `DailyProfileCalculator` avec `customDiversityCoeff` (continu).

Trois runs :
1. **Run principal** : simulation complete (conso + prod) → graphique puissance 24h + graphique tension 24h
2. **Run "conso pure"** : `zeroProduction: true` → trouver l'heure de Vmin → graphique tension-distance (pire cas charge)
3. **Run "prod pure"** : nouvelle option `zeroConsumption: true` → trouver l'heure de Vmax → graphique tension-distance (pire cas injection)

## Modifications

### 1. `src/types/dailyProfile.ts` — Ajouter `zeroConsumption`

```typescript
/** Force le foisonnement résidentiel et industriel à 0% (production seule) */
zeroConsumption?: boolean;
```

### 2. `src/utils/dailyProfileCalculator.ts` — Respecter `zeroConsumption`

Dans `calculateHourlyVoltage`, quand `zeroConsumption: true` :
- `residentialFoisonnementHoraire = 0`
- `industrialFoisonnementHoraire = 0`
- `evFoisonne = 0`
- Seul le profil PV est actif

### 3. `src/components/topMenu/LaboFoisonnementTab.tsx` — Refonte

**Supprimer** l'utilisation de `circuitPowerCalculator` (plus de `simulateCircuit24h`).

**Trois simulations** via `DailyProfileCalculator` :
- Run complet (conso + prod) → `rawResults` pour puissances et tensions 24h
- Run conso pure (`zeroProduction: true`) → `rawResults` pour voltage-distance Vmin
- Run prod pure (`zeroConsumption: true`) → `rawResults` pour voltage-distance Vmax

**Graphique puissance 24h** (nouveau) :
- Donnees extraites des `HourlyVoltageResult` du run complet : `chargesResidentialPower_kVA`, `chargesIndustrialPower_kVA`, `productionsPower_kVA`
- P_charge = residentiel + industriel, P_pv = productions, P_net = P_charge - P_pv
- Recharts LineChart avec 3 courbes

**Graphique tension 24h** : inchange (deja base sur DailyProfileCalculator)

**Graphiques tension-distance** :
- Vmin : utilise le run "conso pure" au lieu du run complet
- Vmax : utilise le run "prod pure" au lieu du run complet
- Titres mis a jour : "Pire cas charge (sans production)" / "Pire cas injection (sans consommation)"

**Tableau comparatif** : adapte pour utiliser les donnees du DailyProfileCalculator au lieu de circuitPowerCalculator

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/types/dailyProfile.ts` | +1 champ `zeroConsumption` |
| `src/utils/dailyProfileCalculator.ts` | +5 lignes : branche `zeroConsumption` |
| `src/components/topMenu/LaboFoisonnementTab.tsx` | Refonte : 3 runs DailyProfileCalculator, supprimer circuitPowerCalculator, graphique puissance derive du moteur electrique |

