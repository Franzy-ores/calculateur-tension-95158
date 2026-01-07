import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Zap, FileText, Save, FolderOpen, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
interface TopMenuHeaderProps {
  onNewNetwork: () => void;
  onSave: () => void;
  onLoad: () => void;
  onSettings: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}
export const TopMenuHeader = ({
  onNewNetwork,
  onSave,
  onLoad,
  onSettings,
  isExpanded,
  onToggleExpand
}: TopMenuHeaderProps) => {
  const {
    currentProject,
    editTarget,
    isSimulationActive,
    simulationEquipment
  } = useNetworkStore();
  const hasSimulationEquipment = (simulationEquipment.srg2Devices?.length || 0) > 0 || simulationEquipment.neutralCompensators.length > 0 || simulationEquipment.cableReplacement?.enabled;
  return <div className="flex items-center justify-between px-4 py-2 border-b border-primary/20">
      {/* Left: Logo + Title + Simulation Badge */}
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-primary/10 rounded-lg">
          <Zap className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-bold text-primary">Réseau BT : calcul de tension</h1>
        </div>
        {editTarget === 'simulation' && <Badge variant="default" className="animate-pulse bg-accent text-accent-foreground text-xs px-2 py-0.5">
            🔬 Mode Simulation
          </Badge>}
      </div>

      {/* Center: Key Status Badges */}
      {currentProject && <div className="flex items-center gap-2">
          <Badge variant="outline" className={`${currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? 'border-primary bg-primary/10 text-primary' : 'border-secondary bg-secondary/10 text-secondary'} text-xs px-2 py-0.5`}>
            {currentProject.voltageSystem === 'TÉTRAPHASÉ_400V' ? '400V' : '230V'}
          </Badge>
          <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground text-xs px-2 py-0.5">
            {currentProject.transformerConfig.rating} ({currentProject.transformerConfig.nominalPower_kVA}kVA)
          </Badge>
          {hasSimulationEquipment && <Badge variant={isSimulationActive ? "default" : "outline"} className={`text-xs px-2 py-0.5 ${isSimulationActive ? 'bg-success text-success-foreground' : 'border-muted-foreground/30 text-muted-foreground'}`}>
              Simulation {isSimulationActive ? '✓' : '✗'}
            </Badge>}
        </div>}

      {/* Right: Quick Actions */}
      <TooltipProvider>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onNewNetwork} className="h-8 px-2">
                <FileText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Nouveau réseau</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onSave} className="h-8 px-2">
                <Save className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Sauvegarder</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onLoad} className="h-8 px-2">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Charger un projet</p></TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onSettings} className="h-8 px-2">
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Paramètres</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={() => window.open('/manuel-utilisateur.html', '_blank')} className="h-8 px-2">
                <FileText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Manuel utilisateur</p></TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-border mx-1" />

          {currentProject && <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onToggleExpand} className="h-8 px-2">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{isExpanded ? 'Réduire' : 'Étendre'} les options</p></TooltipContent>
            </Tooltip>}
        </div>
      </TooltipProvider>
    </div>;
};