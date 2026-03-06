

## Plan: Ajouter le toggle simulation dans le Labo Foisonnement

### Modification unique : `src/components/topMenu/LaboFoisonnementTab.tsx`

**1. Importer `toggleSimulationActive` depuis le store** (ligne 153, ajouter à la destructuration existante)

**2. Calculer les compteurs d'équipements** (après les variables existantes, avant le `useMemo` principal) :
- `srg2Count`, `compensatorCount`, `hasCableReplacement`, `totalEquipment`, `hasAnyEquipment` — même logique que dans `DailyProfileTab` et `SimulationTab`

**3. Ajouter un bloc UI "Mode simulation"** dans la colonne paramètres, entre la synthèse tensions (ligne ~618) et la fin du `CardContent`, ou juste après le bloc météo (ligne ~479). Emplacement recommandé : après le bloc "Synthèse tensions", avant la fermeture de `</CardContent>`.

Le bloc comprend :
- Un `Switch` lié à `isSimulationActive` / `toggleSimulationActive`, désactivé si `!hasAnyEquipment`
- Un `Badge` indiquant l'état (Active/Inactive) + nombre d'équipements actifs
- Affiché uniquement si `hasAnyEquipment` est `true` (masqué si aucun équipement de simulation n'existe)

**4. Importer `Switch`** depuis `@/components/ui/switch` (pas encore importé dans ce fichier).

### Ce qui reste inchangé
- La logique de calcul (déjà branchée sur `isSimulationActive` et `simulationEquipment`)
- Les graphiques et tooltips existants

