import { useState } from 'react';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { useNetworkStore } from "@/store/networkStore";
import { TopMenuHeader } from '@/components/topMenu';
import { TopMenuTabs } from '@/components/TopMenuTabs';

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
          <CollapsibleContent className="animate-accordion-down">
            <TopMenuTabs />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};
