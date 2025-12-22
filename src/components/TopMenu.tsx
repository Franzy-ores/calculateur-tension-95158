import { useState } from 'react';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { ExternalLink } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { TopMenuHeader } from '@/components/topMenu';
import { TopMenuTabs } from '@/components/TopMenuTabs';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TopMenuProps {
  onNewNetwork: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
}

export const TopMenu = ({
  onNewNetwork,
  onSave,
  onLoad,
  onSettings,
}: TopMenuProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const { currentProject } = useNetworkStore();

  const handleDetach = () => {
    const width = 900;
    const height = 700;
    const left = window.screen.width - width - 50;
    const top = 50;
    
    // Utiliser le basename correct pour GitHub Pages
    const basename = import.meta.env.PROD ? '/calculateur-tension-95158' : '';
    
    window.open(
      `${basename}/config-popup`,
      'ConfigWindow',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  };

  return (
    <div className="bg-card border-b border-border shadow-sm">
      {/* Header fixe */}
      <TopMenuHeader
        onNewNetwork={onNewNetwork}
        onSave={onSave}
        onLoad={onLoad}
        onSettings={onSettings}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded(!isExpanded)}
      />

      {/* Contenu avec Tabs (collapsible) */}
      {currentProject && (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleContent className="animate-accordion-down relative">
            {/* Bouton détacher */}
            <div className="absolute top-2 right-4 z-10">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDetach}
                    className="h-8 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    <span className="text-xs">Détacher</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Ouvrir dans une nouvelle fenêtre (pour second écran)
                </TooltipContent>
              </Tooltip>
            </div>
            
            <TopMenuTabs />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};
