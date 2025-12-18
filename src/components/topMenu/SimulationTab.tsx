import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FlaskConical, Settings2, Zap, Cable, Gauge } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";

export const SimulationTab = () => {
  const {
    currentProject,
    isSimulationActive,
    toggleSimulationActive,
    simulationEquipment,
    updateCableTypes,
  } = useNetworkStore();

  if (!currentProject) return null;

  const srg2Count = simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0;
  const compensatorCount = simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
  const hasCableReplacement = simulationEquipment.cableReplacement?.enabled;
  const totalEquipment = srg2Count + compensatorCount + (hasCableReplacement ? 1 : 0);

  const hasAnyEquipment = totalEquipment > 0 || 
    (simulationEquipment.srg2Devices?.length || 0) > 0 || 
    simulationEquipment.neutralCompensators.length > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {/* Card 1: Mode simulation */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-accent" />
            Mode simulation
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="simulation-toggle" className="text-sm font-medium">
              Activer la simulation
            </Label>
            <Switch
              id="simulation-toggle"
              checked={isSimulationActive}
              onCheckedChange={toggleSimulationActive}
              disabled={!hasAnyEquipment}
              className="data-[state=checked]:bg-success"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Badge 
              variant={isSimulationActive ? "default" : "outline"} 
              className={`${isSimulationActive ? 'bg-success text-success-foreground' : 'border-muted-foreground/30 text-muted-foreground'}`}
            >
              {isSimulationActive ? '✓ Active' : '✗ Inactive'}
            </Badge>
            {totalEquipment > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalEquipment} équipement{totalEquipment > 1 ? 's' : ''} actif{totalEquipment > 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {!hasAnyEquipment && (
            <p className="text-xs text-muted-foreground">
              Ajoutez des équipements de simulation pour activer ce mode
            </p>
          )}
        </CardContent>
      </Card>

      {/* Card 2: Équipements actifs */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Équipements de simulation
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {/* SRG2 Devices */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span>Régulateurs SRG2</span>
            </div>
            <Badge variant={srg2Count > 0 ? "default" : "outline"} className="text-xs">
              {srg2Count} / {simulationEquipment.srg2Devices?.length || 0}
            </Badge>
          </div>

          {/* Neutral Compensators */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-secondary" />
              <span>Compensateurs</span>
            </div>
            <Badge variant={compensatorCount > 0 ? "default" : "outline"} className="text-xs">
              {compensatorCount} / {simulationEquipment.neutralCompensators.length}
            </Badge>
          </div>

          {/* Cable Replacement */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Cable className="h-4 w-4 text-accent" />
              <span>Remplacement câble</span>
            </div>
            <Badge variant={hasCableReplacement ? "default" : "outline"} className="text-xs">
              {hasCableReplacement ? '✓ Actif' : '✗ Inactif'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: Types de câbles */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Cable className="h-4 w-4 text-muted-foreground" />
            Configuration câbles
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Gérez les types de câbles disponibles pour le réseau et les simulations de remplacement.
          </p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={updateCableTypes}
            className="w-full"
          >
            <Settings2 className="h-4 w-4 mr-2" />
            Gérer les types de câbles
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
