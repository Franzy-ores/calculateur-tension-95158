import { useEffect } from 'react';
import { useNetworkStore } from '@/store/networkStore';

/**
 * Hook pour synchroniser le store Zustand entre plusieurs fenêtres via localStorage
 * Écoute les événements 'storage' pour détecter les modifications depuis d'autres fenêtres
 */
export const useStorageSync = () => {
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // Vérifier que c'est bien notre clé de stockage
      if (event.key === 'network-storage' && event.newValue) {
        try {
          const newState = JSON.parse(event.newValue);
          if (newState?.state?.currentProject) {
            // Forcer le rechargement du state depuis localStorage
            // Zustand persist middleware gère automatiquement la réhydratation
            window.location.reload();
          }
        } catch (error) {
          console.error('Erreur lors de la synchronisation du storage:', error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);
};
