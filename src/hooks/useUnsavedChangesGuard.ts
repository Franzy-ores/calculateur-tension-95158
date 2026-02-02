import { useEffect, useCallback } from 'react';
import { useNetworkStore } from '@/store/networkStore';

export const useUnsavedChangesGuard = () => {
  const { isDirty } = useNetworkStore();

  // Protection contre la fermeture du navigateur
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = 'Vous avez des modifications non sauvées. Êtes-vous sûr de vouloir quitter ?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Vérifier si des modifications non sauvées existent
  const hasUnsavedChanges = useCallback(() => {
    return isDirty;
  }, [isDirty]);

  return {
    hasUnsavedChanges,
    isDirty
  };
};
