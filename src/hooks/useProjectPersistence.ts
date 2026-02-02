import { useEffect, useCallback, useState } from 'react';
import { useNetworkStore } from '@/store/networkStore';
import { Project, SimulationEquipment } from '@/types/network';

const DRAFT_KEY = 'bt-network-draft';
const AUTO_SAVE_INTERVAL = 30000; // 30 secondes

export interface DraftData {
  project: Project;
  savedAt: string;
  simulationEquipment: SimulationEquipment;
  projectName: string;
}

export const useProjectPersistence = () => {
  const { 
    currentProject, 
    simulationEquipment, 
    isDirty,
    setLastAutoSaveAt 
  } = useNetworkStore();
  
  const [hasDraft, setHasDraft] = useState(false);
  const [draftInfo, setDraftInfo] = useState<{ name: string; savedAt: string } | null>(null);

  // Vérifier s'il y a un brouillon au démarrage
  useEffect(() => {
    const checkForDraft = () => {
      try {
        const draftJson = localStorage.getItem(DRAFT_KEY);
        if (draftJson) {
          const draft: DraftData = JSON.parse(draftJson);
          setHasDraft(true);
          setDraftInfo({
            name: draft.projectName || draft.project?.name || 'Projet sans nom',
            savedAt: draft.savedAt
          });
        }
      } catch (error) {
        console.error('Erreur lors de la lecture du brouillon:', error);
        localStorage.removeItem(DRAFT_KEY);
      }
    };
    
    checkForDraft();
  }, []);

  // Auto-save toutes les 30 secondes si dirty
  useEffect(() => {
    if (!isDirty || !currentProject) return;

    const intervalId = setInterval(() => {
      saveDraft();
    }, AUTO_SAVE_INTERVAL);

    return () => clearInterval(intervalId);
  }, [isDirty, currentProject, simulationEquipment]);

  // Sauvegarder le brouillon
  const saveDraft = useCallback(() => {
    if (!currentProject) return;

    try {
      const draftData: DraftData = {
        project: currentProject,
        simulationEquipment,
        savedAt: new Date().toISOString(),
        projectName: currentProject.name
      };
      
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
      setLastAutoSaveAt(new Date());
      console.log('📝 Brouillon sauvegardé automatiquement');
    } catch (error) {
      console.error('Erreur lors de la sauvegarde du brouillon:', error);
    }
  }, [currentProject, simulationEquipment, setLastAutoSaveAt]);

  // Récupérer le brouillon
  const recoverDraft = useCallback((): DraftData | null => {
    try {
      const draftJson = localStorage.getItem(DRAFT_KEY);
      if (draftJson) {
        const draft: DraftData = JSON.parse(draftJson);
        return draft;
      }
    } catch (error) {
      console.error('Erreur lors de la récupération du brouillon:', error);
    }
    return null;
  }, []);

  // Supprimer le brouillon
  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
    setDraftInfo(null);
    console.log('🗑️ Brouillon supprimé');
  }, []);

  // Vérifier s'il y a un brouillon
  const checkDraftExists = useCallback((): boolean => {
    return localStorage.getItem(DRAFT_KEY) !== null;
  }, []);

  return {
    saveDraft,
    recoverDraft,
    clearDraft,
    checkDraftExists,
    hasDraft,
    draftInfo
  };
};
