import { useEffect } from 'react';
import { X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TopMenuTabs } from '@/components/TopMenuTabs';
import { useNetworkStore } from '@/store/networkStore';
import { useStorageSync } from '@/hooks/useStorageSync';

const TopMenuPopup = () => {
  // Activer la synchronisation temps réel avec la fenêtre principale
  useStorageSync();
  
  const { currentProject } = useNetworkStore();

  // Mettre à jour le titre de la fenêtre
  useEffect(() => {
    document.title = currentProject 
      ? `Configuration - ${currentProject.name}` 
      : 'Configuration réseau';
  }, [currentProject?.name]);

  const handleClose = () => {
    window.close();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">Configuration</span>
          </div>
          {currentProject && (
            <span className="text-sm text-muted-foreground border-l border-border pl-3 ml-1">
              {currentProject.name}
            </span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={handleClose}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Contenu principal */}
      <main className="flex-1 bg-card">
        <TopMenuTabs className="h-full" />
      </main>

      {/* Footer indicateur de synchronisation */}
      <footer className="bg-muted/50 border-t border-border px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        Synchronisé avec la fenêtre principale
      </footer>
    </div>
  );
};

export default TopMenuPopup;
