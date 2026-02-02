
# Plan : Gestion professionnelle de la sauvegarde des projets

## Audit de la situation actuelle

### Fonctionnalités existantes

| Fonctionnalité | État actuel | Problème |
|----------------|-------------|----------|
| **Sauvegarde** | Export JSON manuel uniquement | Aucun indicateur "projet modifié", pas d'auto-save |
| **Chargement** | Import JSON manuel | Écrase le projet courant sans confirmation |
| **Nouveau projet** | `createNewProject()` direct | Aucune vérification des modifications non sauvées |
| **Fermer fenêtre** | Aucune protection | Perte totale des données sans avertissement |
| **Restauration** | Aucune | Pas de récupération après crash/fermeture accidentelle |

### Risques identifiés

1. **Perte de données** : Fermer l'onglet = perte totale du travail
2. **Écrasement accidentel** : Nouveau projet ou chargement sans confirmation
3. **Pas de suivi des modifications** : L'utilisateur ne sait pas si son projet est sauvé
4. **Pas de récupération** : Aucun brouillon automatique

## Solution proposée : Gestion professionnelle

### Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                    GESTION DES PROJETS                          │
├─────────────────────────────────────────────────────────────────┤
│  1. État "dirty" (modifications non sauvées)                    │
│  2. Auto-save localStorage (brouillon toutes les 30 sec)        │
│  3. Dialogues de confirmation (nouveau/charger/fermer)          │
│  4. Protection beforeunload (fermeture navigateur)              │
│  5. Indicateur visuel "Modifications non sauvées"               │
│  6. Récupération au démarrage (brouillon détecté)               │
└─────────────────────────────────────────────────────────────────┘
```

### Nouveaux fichiers à créer

| Fichier | Description |
|---------|-------------|
| `src/hooks/useProjectPersistence.ts` | Hook centralisé pour la persistance |
| `src/hooks/useUnsavedChangesGuard.ts` | Protection contre les pertes de données |
| `src/components/UnsavedChangesDialog.tsx` | Dialogue de confirmation |
| `src/components/RecoveryDialog.tsx` | Dialogue de récupération au démarrage |

### Modifications du store

Ajout dans `networkStore.ts` :

```typescript
// Nouveaux états
isDirty: boolean;              // Projet modifié depuis dernière sauvegarde
lastSavedAt: Date | null;      // Timestamp dernière sauvegarde
lastAutoSaveAt: Date | null;   // Timestamp dernier auto-save

// Nouvelles actions
markAsSaved: () => void;       // Marquer comme sauvé
markAsDirty: () => void;       // Marquer comme modifié
setLastSavedAt: (date: Date) => void;
```

## Détails d'implémentation

### 1. Hook useProjectPersistence

Responsable de :
- Auto-save dans localStorage toutes les 30 secondes si `isDirty = true`
- Clé localStorage : `bt-network-draft`
- Détection au démarrage d'un brouillon existant
- Nettoyage du brouillon après sauvegarde manuelle réussie

```typescript
// Exemple de structure
const DRAFT_KEY = 'bt-network-draft';
const AUTO_SAVE_INTERVAL = 30000; // 30 secondes

interface DraftData {
  project: Project;
  savedAt: string;
  simulationEquipment: SimulationEquipment;
}
```

### 2. Hook useUnsavedChangesGuard

Responsable de :
- Écouter `beforeunload` pour protéger contre la fermeture du navigateur
- Exposer une méthode `confirmIfDirty(callback)` pour les actions destructrices
- Désactiver la protection pendant la sauvegarde

```typescript
// Protection fermeture navigateur
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = 'Vous avez des modifications non sauvées.';
    }
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [isDirty]);
```

### 3. Dialogue UnsavedChangesDialog

Utilisé pour :
- Nouveau projet (si projet courant modifié)
- Charger un projet (si projet courant modifié)
- Trois boutons : Sauvegarder / Ne pas sauvegarder / Annuler

```text
┌──────────────────────────────────────────────┐
│  ⚠️ Modifications non sauvées               │
├──────────────────────────────────────────────┤
│  Votre projet contient des modifications    │
│  non sauvées. Que souhaitez-vous faire ?    │
├──────────────────────────────────────────────┤
│  [Sauvegarder] [Ne pas sauvegarder] [Annuler]│
└──────────────────────────────────────────────┘
```

### 4. Dialogue RecoveryDialog

Affiché au démarrage si un brouillon existe dans localStorage :

```text
┌──────────────────────────────────────────────┐
│  📂 Récupération de projet                  │
├──────────────────────────────────────────────┤
│  Un brouillon non sauvé a été détecté :     │
│  "Réseau Saint-Vaast"                       │
│  Dernière modification : 14:32              │
│                                              │
│  Souhaitez-vous le récupérer ?              │
├──────────────────────────────────────────────┤
│  [Récupérer]  [Ignorer et supprimer]        │
└──────────────────────────────────────────────┘
```

### 5. Indicateur visuel dans TopMenuHeader

Badge affiché à côté du nom du projet quand `isDirty = true` :

```text
[Réseau BT : calcul de tension] [●] ← pastille orange si non sauvé
```

Ou texte :
```text
[Réseau BT] [Modifications non sauvées]
```

### 6. Tracking automatique de isDirty

Toutes les actions qui modifient le projet doivent appeler `markAsDirty()` :

- `addNode`, `updateNode`, `deleteNode`, `moveNode`
- `addCable`, `updateCable`, `deleteCable`
- `updateProjectConfig`
- `importClientsFromExcel`, `updateClientImporte`, `deleteClientImporte`
- `linkClientToNode`, `unlinkClient`
- Actions simulation : `addSRG2Device`, `addNeutralCompensator`, etc.

`markAsSaved()` est appelé :
- Après téléchargement du fichier JSON
- Après récupération d'un brouillon

## Flux utilisateur

### Scénario : Fermer la fenêtre sans sauver

```text
Utilisateur modifie le réseau
        ↓
Utilisateur ferme l'onglet
        ↓
  ┌─────────────────────────────────┐
  │ "Êtes-vous sûr de vouloir      │
  │  quitter ? Les modifications    │
  │  seront perdues."              │
  │                                 │
  │  [Quitter quand même] [Annuler] │
  └─────────────────────────────────┘
```

### Scénario : Nouveau projet après modifications

```text
Utilisateur modifie le réseau
        ↓
Clique sur "Nouveau réseau"
        ↓
  ┌─────────────────────────────────┐
  │ ⚠️ Modifications non sauvées   │
  │                                 │
  │  [Sauvegarder] [Ne pas sauver] │
  │  [Annuler]                      │
  └─────────────────────────────────┘
        ↓
"Sauvegarder" → télécharge JSON puis crée nouveau projet
"Ne pas sauvegarder" → crée nouveau projet immédiatement
"Annuler" → ferme le dialogue, retour à l'état précédent
```

### Scénario : Récupération au démarrage

```text
Utilisateur ouvre l'application
        ↓
Hook détecte brouillon dans localStorage
        ↓
  ┌─────────────────────────────────┐
  │ 📂 Récupération disponible     │
  │                                 │
  │  Projet : "Réseau Waremme"     │
  │  Sauvé il y a : 2 heures       │
  │                                 │
  │  [Récupérer] [Ignorer]         │
  └─────────────────────────────────┘
        ↓
"Récupérer" → charge le brouillon, supprime du localStorage
"Ignorer" → supprime du localStorage, continue normalement
```

## Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `src/store/networkStore.ts` | Ajouter isDirty, lastSavedAt, actions markAsDirty/markAsSaved |
| `src/pages/Index.tsx` | Intégrer hooks et dialogues, modifier handleSave/handleLoad/handleNewNetwork |
| `src/components/topMenu/TopMenuHeader.tsx` | Afficher indicateur "non sauvé" |

## Résumé des bénéfices

| Avant | Après |
|-------|-------|
| Perte de données à la fermeture | Protection beforeunload |
| Pas de récupération | Auto-save toutes les 30s + récupération |
| Écrasement sans confirmation | Dialogues de confirmation |
| Aucun feedback utilisateur | Indicateur visuel "Modifications non sauvées" |
| Actions destructrices immédiates | Triple choix : Sauvegarder / Ignorer / Annuler |

