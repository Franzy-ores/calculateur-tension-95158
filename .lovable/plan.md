
# Plan : Ajout des totaux "Clients Cabine" et alerte transfo dans l'onglet Parametres

## Contexte

Actuellement, l'onglet Parametres affiche uniquement les totaux foisonnes du **circuit** (noeuds connectes). Le besoin est d'afficher egalement les totaux foisonnes de **tous les clients importes** (lies et non lies au reseau), appeles "Clients Cabine", et d'alerter si le net depasse la puissance du transformateur.

## Modification

**Fichier unique : `src/components/topMenu/ParametersTab.tsx`**

### 1. Calcul des totaux "Clients Cabine"

Ajouter le calcul de la somme de tous les `clientsImportes` (lies et non lies), avec application des coefficients de foisonnement differencies (residentiel/industriel) :

```text
clientsImportes.forEach(client => {
  if (client.clientType === 'industriel') {
    cabineChargesIndustrielles += client.puissanceContractuelle_kVA
  } else {
    cabineChargesResidentielles += client.puissanceContractuelle_kVA  
  }
  cabineProductionsTotal += client.puissancePV_kVA
})

cabineChargesFoisonnees = cabineResidentielles * (foisResidentiel/100) + cabineIndustrielles * (foisIndustriel/100)
cabineProductionsFoisonnees = cabineProductionsTotal * (foisProductions/100)
```

### 2. Affichage dans le panneau Total

A cote du bloc existant "Charges foisonnees / Productions foisonnees" (circuit), ajouter un second bloc separe par un trait vertical :

```text
| Circuit              | Clients Cabine        |
| Ch.F: XX.X kVA      | Ch.F: XX.X kVA        |
| Pr.F: XX.X kVA      | Pr.F: XX.X kVA        |
```

### 3. Alerte transfo

Sous le bloc "Clients Cabine", si `cabineChargesFoisonnees - cabineProductionsFoisonnees > transformerPower` et `transformerPower > 0`, afficher une ligne d'alerte avec icone AlertTriangle en rouge et le texte du depassement.

La logique d'alerte reprend celle du `GlobalAlertPopup` existant dans `Index.tsx` (surcharge : charges > transfo + productions, injection : productions > transfo + charges).

### Resume visuel du bloc Total modifie

```text
┌─ Circuit ──────────┬─ Clients Cabine ─────────────┐
│ Charges foisonnees │ Charges foisonnees            │
│ 12.5 kVA           │ 45.2 kVA                     │
│ Productions fois.  │ Productions foisonnees        │
│ 3.0 kVA            │ 8.5 kVA                      │
│                    │ [!] Surcharge: +XX kVA/transfo│
└────────────────────┴──────────────────────────────-┘
```

## Fichier modifie

| Fichier | Modification |
|---|---|
| `src/components/topMenu/ParametersTab.tsx` | Calcul totaux cabine + affichage bloc + alerte transfo |
