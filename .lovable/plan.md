

# Améliorations Labo Foisonnement

## 1. Afficher la source dans la liste de nœuds

**Problème**: Ligne 219, les nœuds source sont filtrés (`filter(n => !n.isSource)`). L'utilisateur ne peut pas sélectionner la source pour voir la tension au busbar.

**Correction** dans `LaboFoisonnementTab.tsx`:
- Inclure la source dans le `nodes` memo (supprimer le filtre `!n.isSource`)
- Dans le `SelectContent`, afficher le nœud source avec un badge distinctif "Source" et la tension busbar formatée en 230V (diviser par √3 si 400V)
- Le `DailyProfileCalculator` recevra `selectedNodeId = sourceNode.id`, ce qui calculera les tensions au point source

## 2. Alerte surcharge transfo avec VE + PAC

**Problème**: Quand l'utilisateur augmente VE et PAC, la puissance totale peut dépasser la capacité du transformateur. Aucune alerte n'existe dans le Labo.

**Correction**:
- Calculer `P_total_max = max(powerData.P_net)` (pic de puissance nette incluant VE + PAC)
- Récupérer `transformerPower = currentProject.transformerConfig?.nominalPower_kVA`
- Si `P_total_max > transformerPower`: afficher une alerte dans la zone alertes existante (sous le control bar), avec un badge rouge indiquant le dépassement en kVA
- Format: `⚠ Surcharge transfo: pic {P_total_max} kVA > capacité {transformerPower} kVA (+{delta} kVA)`

## 3. Remplacer sliders VE/PAC par champs numériques

**Problème**: Les sliders inline sont petits et peu pratiques sur la barre de contrôle compacte.

**Correction** dans la Row 2 du control bar (lignes 864-887):
- Remplacer chaque slider par un `Input` numérique compact (`w-14 h-6 text-xs text-center`) avec `type="number"`, `min=0`, `max=100`, `step=5` pour la pénétration
- Garder les boutons radio pour la puissance VE (3.7/11/22 kW) — déjà compact
- Pour PAC: un input pénétration + un input puissance (1-9 kW, step 0.5)
- Afficher un résumé inline: `→ {N_ev} VE × {evPower}kW = {total_ev} kW` pour feedback immédiat
- Layout: `⚡ VE [__]% × [3.7|11|22] → X.X kW  |  🌡️ PAC [__]% × [__]kW → X.X kW`

## Fichier modifié

`src/components/topMenu/LaboFoisonnementTab.tsx` uniquement.

## Détails techniques

- **Source dans liste**: Le memo `nodes` (ligne 217-220) supprime le filtre. Le `SelectItem` de la source ajoute un badge "Source · {voltage}V".
- **Alerte transfo**: Un nouveau bloc conditionnel dans la section alertes (ligne 910+), basé sur `Math.max(...powerData.map(d => d.P_net))` vs `transformerConfig.nominalPower_kVA`.
- **Inputs numériques**: Remplacement des `<Slider>` par `<Input type="number">` avec `onChange` qui clamp la valeur dans les bornes. Les boutons 3.7/11/22 restent en `<Button>` toggle.

