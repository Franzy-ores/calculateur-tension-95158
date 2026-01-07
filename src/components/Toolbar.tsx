import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { useNetworkStore } from '@/store/networkStore';
import { toast } from 'sonner';

export const Toolbar = () => {
  const { 
    selectedTool, 
    setSelectedTool, 
    currentProject, 
    calculateAll,
    setSelectedNode,
    focusMode,
    toggleFocusMode,
    showClientTensionLabels,
    toggleClientTensionLabels,
    showVoltages,
    setShowVoltages,
    clientColorMode,
    setClientColorMode,
  } = useNetworkStore();

  const hasClients = currentProject?.clientsImportes && currentProject.clientsImportes.length > 0;

  const colorModes = [
    { value: 'couplage', label: 'Par couplage' },
    { value: 'circuit', label: 'Par circuit' },
    { value: 'tension', label: 'Par tension' },
    { value: 'link', label: 'Par lien au nœud' },
    { value: 'gps', label: 'Par statut GPS' },
  ];

  const handleCalculate = () => {
    if (!currentProject) {
      toast.error('Aucun projet ouvert');
      return;
    }
    
    if (currentProject.nodes.length === 0) {
      toast.error('Ajoutez au moins un nœud');
      return;
    }
    
    calculateAll();
    toast.success('Calculs effectués pour tous les scénarios');
  };

  const tools = [
    {
      id: 'select' as const,
      emoji: '↖️',
      label: 'Sélectionner',
      description: 'Mode sélection'
    },
    {
      id: 'addNode' as const,
      emoji: '➕',
      label: 'Ajouter nœud',
      description: 'Cliquer pour ajouter un nœud'
    },
    {
      id: 'addCable' as const,
      emoji: '🔌',
      label: 'Ajouter câble',
      description: 'Connecter deux nœuds'
    },
    {
      id: 'edit' as const,
      emoji: '⚙️',
      label: 'Éditer',
      description: 'Modifier les propriétés'
    },
    {
      id: 'move' as const,
      emoji: '✋',
      label: 'Déplacer',
      description: 'Déplacer un nœud'
    },
    {
      id: 'delete' as const,
      emoji: '🗑️',
      label: 'Supprimer',
      description: 'Supprimer un élément'
    }
  ];

  return (
    <div className="w-16 bg-muted/30 border-r flex flex-col items-center py-4 gap-2">
      {/* Bouton Mode Focus en haut */}
      <Button
        variant={focusMode ? "default" : "outline"}
        size="icon"
        onClick={toggleFocusMode}
        title={focusMode ? "Sortir du mode Focus" : "Mode Focus (masque menus haut/droite)"}
        className="w-12 h-12 mb-2"
      >
        <span className="text-lg">{focusMode ? '↩️' : '🎯'}</span>
      </Button>
      
      <Button
        variant={showClientTensionLabels ? "default" : "outline"}
        size="icon"
        onClick={toggleClientTensionLabels}
        title={showClientTensionLabels ? "Masquer tensions clients" : "Afficher tensions clients (Min/Max)"}
        className="w-12 h-12 mb-2"
      >
        <span className="text-lg">{showClientTensionLabels ? '⚡' : '🔢'}</span>
      </Button>
      
      <Button
        variant={showVoltages ? "default" : "outline"}
        size="icon"
        onClick={() => setShowVoltages(!showVoltages)}
        title={showVoltages ? "Masquer tensions nœuds" : "Afficher tensions nœuds"}
        className="w-12 h-12 mb-2"
      >
        <span className="text-lg">{showVoltages ? '🔋' : '🔌'}</span>
      </Button>
      
      {hasClients && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              title="Mode coloration raccordements"
              className="w-12 h-12 mb-2"
            >
              <span className="text-lg">🎨</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-48 p-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground px-2">Coloration</Label>
              {colorModes.map((mode) => (
                <Button
                  key={mode.value}
                  variant={clientColorMode === mode.value ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start text-sm"
                  onClick={() => setClientColorMode(mode.value as any)}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      
      <div className="w-full h-px bg-border mb-1" />
      
      {tools.map((tool) => {
        return (
          <Button
            key={tool.id}
            variant={selectedTool === tool.id ? "default" : "ghost"}
            size="icon"
            onClick={() => {
              console.log('Tool selected:', tool.id);
              setSelectedTool(tool.id);
              // Réinitialiser la sélection de nœud quand on change d'outil
              setSelectedNode(null);
            }}
            title={tool.description}
            className="w-12 h-12"
          >
            <span className="text-lg">{tool.emoji}</span>
          </Button>
        );
      })}
      
      <Button
        onClick={handleCalculate}
        variant="outline"
        size="icon"
        title="Calculer tous les scénarios"
        className="w-12 h-12"
        disabled={!currentProject}
      >
        <span className="text-lg">📊</span>
      </Button>
    </div>
  );
};