
# Plan : Restructuration complète du tableau Récapitulatif par couplage

## Objectif
Afficher un tableau avec colonnes distinctes pour charges ET productions, par catégorie (MONO, Poly Résidentiel, Poly Industriel), avec valeurs brutes et foisonnées, plus l'intensité par phase.

## Structure du tableau proposée

| Couplage | Nb | Ch. | Pr. | Ch.F | Pr.F | Nb | Ch. | Pr. | Ch.F | Pr.F | Nb | Ch. | Pr. | Ch.F | Pr.F | Déséq. | I (A) |
|----------|----|----|-----|------|------|----|-----|-----|------|------|----|-----|-----|------|------|--------|-------|
|          | **MONO (Résidentiel)** |||||| **Poly Résidentiel** |||||| **Poly Industriel** |||||| | |

### Colonnes par catégorie (3 × 5 colonnes)
- **Nb** : Nombre de clients
- **Ch.** : Charge contractuelle (kVA)
- **Pr.** : Production PV (kVA)
- **Ch.F** : Charge foisonnée (kVA)
- **Pr.F** : Production foisonnée (kVA)

### Colonnes finales
- **Déséq.** : Écart par rapport à 33.33% (%)
- **I (A)** : Intensité calculée sur la phase

---

## Modifications techniques

### 1. Modifier `calculatePhaseData()` (lignes 23-131)

Ajouter le tracking des productions par catégorie :

```typescript
function calculatePhaseData(...) {
  // Variables MONO
  let nbMono = 0;
  let chargeMonoResidentiel = 0;
  let productionMonoResidentiel = 0;  // NOUVEAU
  
  // Variables POLY Résidentiel
  let nbPolyResidentiel = 0;  // NOUVEAU
  let chargePolyResidentiel = 0;
  let productionPolyResidentiel = 0;  // NOUVEAU
  
  // Variables POLY Industriel
  let nbPolyIndustriel = 0;  // NOUVEAU
  let chargePolyIndustriel = 0;
  let productionPolyIndustriel = 0;  // NOUVEAU
  
  clientsImportes?.forEach(client => {
    if (!linkedClientIds.has(client.id)) return;
    
    if (client.connectionType === 'MONO') {
      // Filtrage par phase/couplage (existant)
      if (matchesPhase) {
        nbMono++;
        chargeMonoResidentiel += client.puissanceContractuelle_kVA;
        productionMonoResidentiel += client.puissancePV_kVA || 0;  // NOUVEAU
      }
    }
    
    if (client.connectionType === 'TRI' || client.connectionType === 'TETRA') {
      const isResidentiel = client.clientType !== 'industriel';
      const chargeParPhase = client.puissanceContractuelle_kVA / 3;
      const prodParPhase = (client.puissancePV_kVA || 0) / 3;  // NOUVEAU
      
      if (isResidentiel) {
        nbPolyResidentiel += 1/3;  // Comptage fractionnel
        chargePolyResidentiel += chargeParPhase;
        productionPolyResidentiel += prodParPhase;  // NOUVEAU
      } else {
        nbPolyIndustriel += 1/3;
        chargePolyIndustriel += chargeParPhase;
        productionPolyIndustriel += prodParPhase;  // NOUVEAU
      }
    }
  });
  
  // Calculs foisonnés par catégorie
  const chargeMonoFoisonne = chargeMonoResidentiel * (foisonnementChargesResidentiel / 100);
  const prodMonoFoisonne = productionMonoResidentiel * (foisonnementProductions / 100);
  
  const chargePolyResFoisonne = chargePolyResidentiel * (foisonnementChargesResidentiel / 100);
  const prodPolyResFoisonne = productionPolyResidentiel * (foisonnementProductions / 100);
  
  const chargePolyIndFoisonne = chargePolyIndustriel * (foisonnementChargesIndustriel / 100);
  const prodPolyIndFoisonne = productionPolyIndustriel * (foisonnementProductions / 100);
  
  // Intensité totale : (Charges - Productions) foisonnées / Voltage
  const totalChargeFoisonne = chargeMonoFoisonne + chargePolyResFoisonne + chargePolyIndFoisonne;
  const totalProdFoisonne = prodMonoFoisonne + prodPolyResFoisonne + prodPolyIndFoisonne;
  const courant = ((totalChargeFoisonne - totalProdFoisonne) * 1000) / 230;
  
  return {
    // MONO
    nbMono,
    chargeMono: chargeMonoResidentiel,
    prodMono: productionMonoResidentiel,
    chargeMonoFoisonne,
    prodMonoFoisonne,
    
    // Poly Résidentiel
    nbPolyRes: nbPolyResidentiel,
    chargePolyRes: chargePolyResidentiel,
    prodPolyRes: productionPolyResidentiel,
    chargePolyResFoisonne,
    prodPolyResFoisonne,
    
    // Poly Industriel
    nbPolyInd: nbPolyIndustriel,
    chargePolyInd: chargePolyIndustriel,
    prodPolyInd: productionPolyIndustriel,
    chargePolyIndFoisonne,
    prodPolyIndFoisonne,
    
    // Totaux
    ecartChargePercent,
    courantTotal: courant
  };
}
```

### 2. Modifier `renderTable()` (lignes 283-361)

Nouvelle structure du tableau avec regroupement par catégorie :

```tsx
<table className="w-full text-[10px] border-collapse">
  <thead>
    {/* Ligne de regroupement */}
    <tr className="border-b border-border">
      <th rowSpan={2}>Couplage</th>
      <th colSpan={5} className="text-center bg-blue-100">MONO (Rés.)</th>
      <th colSpan={5} className="text-center bg-green-100">Poly Rés.</th>
      <th colSpan={5} className="text-center bg-orange-100">Poly Ind.</th>
      <th rowSpan={2}>Déséq.</th>
      <th rowSpan={2}>I (A)</th>
    </tr>
    {/* Ligne des sous-colonnes */}
    <tr className="border-b border-border text-[9px]">
      {/* MONO */}
      <th>Nb</th><th>Ch.</th><th>Pr.</th><th>Ch.F</th><th>Pr.F</th>
      {/* Poly Rés. */}
      <th>Nb</th><th>Ch.</th><th>Pr.</th><th>Ch.F</th><th>Pr.F</th>
      {/* Poly Ind. */}
      <th>Nb</th><th>Ch.</th><th>Pr.</th><th>Ch.F</th><th>Pr.F</th>
    </tr>
  </thead>
  <tbody>
    {(['A', 'B', 'C'] as const).map((phase) => {
      const data = calculatePhaseData(...);
      return (
        <tr key={phase}>
          <td>{phaseLabel}</td>
          {/* MONO */}
          <td>{data.nbMono}</td>
          <td>{data.chargeMono.toFixed(1)}</td>
          <td>{data.prodMono.toFixed(1)}</td>
          <td>{data.chargeMonoFoisonne.toFixed(1)}</td>
          <td>{data.prodMonoFoisonne.toFixed(1)}</td>
          {/* Poly Résidentiel */}
          <td>{data.nbPolyRes.toFixed(0)}</td>
          <td>{data.chargePolyRes.toFixed(1)}</td>
          <td>{data.prodPolyRes.toFixed(1)}</td>
          <td>{data.chargePolyResFoisonne.toFixed(1)}</td>
          <td>{data.prodPolyResFoisonne.toFixed(1)}</td>
          {/* Poly Industriel */}
          <td>{data.nbPolyInd.toFixed(0)}</td>
          <td>{data.chargePolyInd.toFixed(1)}</td>
          <td>{data.prodPolyInd.toFixed(1)}</td>
          <td>{data.chargePolyIndFoisonne.toFixed(1)}</td>
          <td>{data.prodPolyIndFoisonne.toFixed(1)}</td>
          {/* Totaux */}
          <td>{data.ecartChargePercent.toFixed(0)}%</td>
          <td>{Math.abs(data.courantTotal).toFixed(1)}</td>
        </tr>
      );
    })}
  </tbody>
</table>
```

---

## Formule de calcul de l'intensité

Le courant par phase est calculé selon :

```text
I_phase = (Σ Charges_foisonnées - Σ Productions_foisonnées) × 1000 / U
```

Où :
- **Charges_foisonnées** = Ch.MONO×15% + Ch.PolyRés×15% + Ch.PolyInd×70%
- **Productions_foisonnées** = (Pr.MONO + Pr.PolyRés + Pr.PolyInd) × foisonnementProductions%
- **U** = 230V

---

## Fichiers à modifier

| Fichier | Section | Modification |
|---------|---------|--------------|
| `src/components/PhaseDistributionDisplay.tsx` | `calculatePhaseData()` L23-131 | Ajouter tracking production par catégorie |
| `src/components/PhaseDistributionDisplay.tsx` | `renderTable()` L283-361 | Nouveau layout avec 17 colonnes |

---

## Aperçu visuel final

```text
┌──────────┬─────────────────────────────┬─────────────────────────────┬─────────────────────────────┬───────┬───────┐
│ Couplage │      MONO (Résidentiel)     │       Poly Résidentiel      │       Poly Industriel       │ Déséq │ I (A) │
│          ├────┬──────┬──────┬─────┬─────┼────┬──────┬──────┬─────┬─────┼────┬──────┬──────┬─────┬─────┤       │       │
│          │ Nb │ Ch.  │ Pr.  │ Ch.F│ Pr.F│ Nb │ Ch.  │ Pr.  │ Ch.F│ Pr.F│ Nb │ Ch.  │ Pr.  │ Ch.F│ Pr.F│       │       │
├──────────┼────┼──────┼──────┼─────┼─────┼────┼──────┼──────┼─────┼─────┼────┼──────┼──────┼─────┼─────┼───────┼───────┤
│ L1-L2    │ 15 │ 60.0 │  5.0 │ 9.0 │ 5.0 │  1 │ 12.0 │  3.0 │ 1.8 │ 3.0 │  2 │ 35.0 │ 10.0 │24.5 │10.0 │  +2%  │  8.5  │
│ L2-L3    │ 12 │ 48.0 │  3.0 │ 7.2 │ 3.0 │  1 │ 12.0 │  3.0 │ 1.8 │ 3.0 │  2 │ 35.0 │ 10.0 │24.5 │10.0 │  -1%  │  7.2  │
│ L3-L1    │ 18 │ 72.0 │  8.0 │10.8 │ 8.0 │  1 │ 12.0 │  3.0 │ 1.8 │ 3.0 │  1 │ 35.0 │ 10.0 │24.5 │10.0 │  +5%  │  9.1  │
└──────────┴────┴──────┴──────┴─────┴─────┴────┴──────┴──────┴─────┴─────┴────┴──────┴──────┴─────┴─────┴───────┴───────┘
```

---

## Légende des colonnes

| Abréviation | Signification |
|-------------|---------------|
| Nb | Nombre de clients |
| Ch. | Charge contractuelle (kVA) |
| Pr. | Production PV (kVA) |
| Ch.F | Charge foisonnée (kVA) |
| Pr.F | Production foisonnée (kVA) |
| Déséq. | Écart de répartition vs 33.33% |
| I (A) | Intensité résultante (A) |

---

## Note sur le comptage Poly

Pour les clients polyphasés (TRI/TÉTRA), le comptage par phase est fractionnel (1/3 par phase) car un client est réparti sur les 3 phases. Le "Nb" affiché représente donc la contribution équivalente par phase, non le nombre absolu de clients.

