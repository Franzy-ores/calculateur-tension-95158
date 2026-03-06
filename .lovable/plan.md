

## Plan: Modélisation des prises de terre répétées du neutre (réseaux aériens 400V)

### Objectif
Modéliser la fuite du courant neutre vers la terre à chaque poteau via une résistance Rt, réduisant progressivement IN le long du réseau et améliorant la précision du calcul de tension phase-neutre en régime déséquilibré.

### Modifications

**1. Type Node (`src/types/network.ts`, ~ligne 226)**
- Ajouter `rt_terre_ohm?: number` à l'interface `Node`, avant la fermeture `}`.

**2. Valeur par défaut à la création (`src/store/networkStore.ts`, ~ligne 852)**
- Dans `addNode`, ajouter `rt_terre_ohm: 25` au `newNode`.

**3. Moteur de calcul (`src/utils/electricalCalculations.ts`, ~lignes 1598-1640)**
- Après le bloc EQUI8 (ligne ~1614) et avant le calcul de `Z_neutral`, insérer la logique de fuite terre :
  - Lire `Rt = childNode.rt_terre_ohm ?? 25`
  - Si `Rt > 0`, calculer `I_fuite = V_neutre_parent / Rt` (complexe)
  - Soustraire `I_fuite` de `IN_phasor`
  - Log console pour debug
- Le `distalNode` (childNode) est déjà récupéré ligne 1617 ; on déplacera ou dupliquera cette lecture avant le bloc fuite.

**4. Interface utilisateur (`src/components/EditPanel.tsx`)**
- Dans le `useEffect` d'initialisation du formData (ligne ~64), ajouter `rt_terre_ohm: selectedNode.rt_terre_ohm ?? 25`.
- Après le bloc "Type de connexion" (~ligne 266), ajouter un champ numérique conditionnel :
  - Visible uniquement si `currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V'` et nœud non-source
  - Label : "Résistance de terre (Ω)"
  - Input numérique, min=0, max=200, suffixe "Ω"
  - Tooltip explicatif (NF C 11-201, valeurs sols)

### Fichiers modifiés
- `src/types/network.ts` — 1 ligne ajoutée
- `src/store/networkStore.ts` — 1 ligne ajoutée
- `src/utils/electricalCalculations.ts` — ~15 lignes insérées
- `src/components/EditPanel.tsx` — ~30 lignes ajoutées (champ UI + init formData)

