
# Plan : Corrections et ameliorations de l'onglet Raccordements

## 6 problemes identifies et solutions

---

### 1. Filtre par couplage ne fonctionne pas

**Cause** : Le filtre compare `client.couplage` (valeur brute Excel, ex: `"TRI"`, `"MONO"`) mais les valeurs Excel peuvent contenir des variantes (espaces, casse). De plus, le type `ClientCouplage` est un `string` libre. Pour les clients crees manuellement, `couplage` est mis a `connectionType` (ex: `"MONO"`) ce qui devrait fonctionner.

**Solution** : Modifier le filtre (ligne 75) pour comparer en majuscules et aussi verifier `client.connectionType` comme fallback :
```
if (filterCouplage !== 'ALL') {
  const couplageNorm = (client.couplage || '').toUpperCase().trim();
  const connType = client.connectionType || '';
  const isTri = couplageNorm.includes('TRI') || connType === 'TRI' || connType === 'TETRA';
  const isMono = couplageNorm.includes('MONO') || connType === 'MONO';
  if (filterCouplage === 'TRI' && !isTri) return false;
  if (filterCouplage === 'MONO' && !isMono) return false;
}
```
Ajouter aussi `TETRA` comme option dans le Select.

**Fichier** : `src/components/ClientsPanel.tsx` (lignes 74-77, 304-313)

---

### 2. Liste des raccordements repliable + recapitulatif par couplage

**Solution** : Envelopper la liste des raccordements dans un `Accordion` (meme pattern que ParametersTab lignes 224-258). Ajouter un accordeon "Recapitulatif par couplage" au-dessus de la liste, affichant le comptage MONO/TRI/TETRA avec charges et productions totales par type.

**Fichier** : `src/components/ClientsPanel.tsx`

---

### 3. Icone de localisation ne fonctionne pas

**Cause identifiee** : `ClientsPanel.handleZoomToClient` (ligne 129) dispatche l'evenement `zoomToLocation`, mais `MapView` (ligne 257) ecoute `centerMapOnClient`.

**Solution** : Remplacer `zoomToLocation` par `centerMapOnClient` dans `ClientsPanel.tsx` ligne 129 :
```
const event = new CustomEvent('centerMapOnClient', {
  detail: { lat: client.lat, lng: client.lng }
});
```

**Fichier** : `src/components/ClientsPanel.tsx` (ligne 129)

---

### 4. Ajouter tri par circuits

**Solution** : Ajouter un nouveau Select "Tri par" avec les options : `nom` (defaut), `circuit`, `puissance`, `type`. Quand "circuit" est selectionne, trier `filteredClients` par `identifiantCircuit`. Optionnellement regrouper visuellement par circuit avec des separateurs.

**Fichier** : `src/components/ClientsPanel.tsx`

---

### 5. Ajouter tri par type (importe / cree manuellement)

**Solution** : Detecter la source du client via son `id` : les clients manuels ont un id prefixe `client-manual-`, les importes ont `client-import-`. Ajouter une option de filtre "Source" avec les valeurs : Tous / Importes / Crees. Ajouter un tag visuel (badge) sur chaque client pour indiquer sa source.

**Fichier** : `src/components/ClientsPanel.tsx`

---

### 6. Import des clients avec coordonnees nulles + tag "non localise"

Actuellement, `validateClient` (clientsUtils.ts ligne 270) marque les clients sans GPS comme invalides, et `ExcelImporter` (ligne 117) les exclut de l'import.

**Solution en 3 fichiers** :

#### a) `src/utils/clientsUtils.ts`
- Modifier `validateClient` : ne plus rejeter les clients sans coordonnees GPS. Les coordonnees nulles ne sont plus une erreur bloquante.

#### b) `src/types/network.ts`
- Ajouter un champ optionnel `isLocalized?: boolean` a `ClientImporte` (ou le deduire de `lat === 0 && lng === 0`).

#### c) `src/components/ClientsPanel.tsx`
- Afficher un badge "Non localise" (tag orange) pour les clients avec `lat === 0 && lng === 0`.
- Desactiver le bouton MapPin pour ces clients.
- Ajouter une option de filtre "Non localise" dans le Select d'etat.

#### d) `src/components/ClientMarkers.tsx`
- Exclure les clients avec `lat === 0 && lng === 0` du rendu des marqueurs sur la carte.

#### e) `src/components/ExcelImporter.tsx`
- Les clients sans coordonnees restent dans `previewData` et sont importes normalement. Afficher un badge "Non localise" au lieu de l'icone erreur dans le tableau de previsualisation.

---

## Resume des fichiers modifies

| Fichier | Modifications |
|---|---|
| `src/components/ClientsPanel.tsx` | Fix filtre couplage, fix evenement zoom, ajout tri par circuit/source, liste repliable, recapitulatif couplage, badge "non localise" |
| `src/utils/clientsUtils.ts` | Modifier `validateClient` pour accepter GPS nuls |
| `src/components/ExcelImporter.tsx` | Afficher badge "non localise" au lieu de rejeter |
| `src/components/ClientMarkers.tsx` | Exclure clients non localises du rendu carte |

## Sequence d'implementation

1. Fix evenement zoom (`zoomToLocation` -> `centerMapOnClient`)
2. Fix filtre couplage (normalisation + ajout TETRA)
3. Modifier `validateClient` pour accepter GPS nuls
4. Mettre a jour `ExcelImporter` pour importer les clients sans GPS
5. Ajouter filtre/badge "non localise" + exclure de la carte
6. Ajouter les tris (circuit, source importe/cree)
7. Ajouter l'accordeon repliable + recapitulatif par couplage
