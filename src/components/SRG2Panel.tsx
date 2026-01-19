import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useNetworkStore } from "@/store/networkStore";
import { SRG2Config } from "@/types/srg2";
import { NodeSelector } from "@/components/NodeSelector";
import { getLinkedClientsForNode } from "@/utils/clientsUtils";
import { 
  Zap, 
  Plug,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle,
  Activity,
  MapPin
} from "lucide-react";
import { cn } from "@/lib/utils";

export const SRG2Panel = () => {
  const {
    currentProject,
    simulationEquipment,
    addSRG2Device,
    removeSRG2Device,
    updateSRG2Device,
    startNodeSelection,
    nodeSelectionMode,
  } = useNetworkStore();

  if (!currentProject) return null;

  const nodes = currentProject.nodes.filter(n => !n.isSource);

  // Fonction pour trouver tous les nœuds en aval d'un nœud donné (incluant le nœud lui-même)
  const findDownstreamNodes = (startNodeId: string): string[] => {
    const downstream: string[] = [startNodeId]; // Inclure le nœud de départ
    const visited = new Set<string>([startNodeId]);
    const queue: string[] = [startNodeId];
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      const connectedCables = currentProject.cables.filter(
        c => c.nodeAId === currentId || c.nodeBId === currentId
      );
      
      for (const cable of connectedCables) {
        const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
        
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          downstream.push(nextNodeId);
          queue.push(nextNodeId);
        }
      }
    }
    
    return downstream;
  };

  // Limites fixes SRG2
  const LIMITE_CHARGE_KVA = 100;
  const LIMITE_PRODUCTION_KVA = 85;

  // Fonction pour calculer les puissances foisonnées en aval avec différenciation résidentiel/industriel
  const calculateDownstreamPowers = (srg2: SRG2Config) => {
    const downstreamNodeIds = findDownstreamNodes(srg2.nodeId);
    
    let totalChargeKVA = 0;
    let totalProductionKVA = 0;
    
    // Récupérer les taux de foisonnement différenciés
    const foisonnementResidentiel = currentProject.foisonnementChargesResidentiel ?? 15;
    const foisonnementIndustriel = currentProject.foisonnementChargesIndustriel ?? 70;
    const foisonnementProductions = currentProject.foisonnementProductions ?? 100;
    
    downstreamNodeIds.forEach(nodeId => {
      const node = currentProject.nodes.find(n => n.id === nodeId);
      if (!node) return;
      
      // 1. Charges manuelles (node.clients) - considérées comme résidentielles par défaut
      const chargesManuelles = node.clients.reduce((sum, client) => sum + client.S_kVA, 0);
      const chargesManuellesFoisonnees = chargesManuelles * (foisonnementResidentiel / 100);
      
      // 2. Clients importés liés à ce nœud - différenciation résidentiel/industriel
      const linkedClients = getLinkedClientsForNode(
        nodeId, 
        currentProject.clientsImportes || [], 
        currentProject.clientLinks || []
      );
      
      let chargesImporteesFoisonnees = 0;
      let productionsImporteesFoisonnees = 0;
      
      linkedClients.forEach(client => {
        // Appliquer le foisonnement selon le type de client
        const foisonnement = client.clientType === 'industriel' 
          ? foisonnementIndustriel 
          : foisonnementResidentiel;
        
        chargesImporteesFoisonnees += client.puissanceContractuelle_kVA * (foisonnement / 100);
        productionsImporteesFoisonnees += client.puissancePV_kVA * (foisonnementProductions / 100);
      });
      
      totalChargeKVA += chargesManuellesFoisonnees + chargesImporteesFoisonnees;
      
      // 3. Productions manuelles (node.productions)
      const productionsBrutes = node.productions.reduce((sum, prod) => sum + prod.S_kVA, 0);
      const productionsFoisonnees = productionsBrutes * (foisonnementProductions / 100);
      
      totalProductionKVA += productionsFoisonnees + productionsImporteesFoisonnees;
    });
    
    // Vérification séparée de chaque limite (sans bilan net)
    const ratioCharge = totalChargeKVA / LIMITE_CHARGE_KVA;
    const ratioProduction = totalProductionKVA / LIMITE_PRODUCTION_KVA;
    
    const chargeWithinLimit = ratioCharge <= 1.0;
    const productionWithinLimit = ratioProduction <= 1.0;
    
    return {
      totalChargeKVA,
      totalProductionKVA,
      ratioCharge,
      ratioProduction,
      chargeWithinLimit,
      productionWithinLimit,
      isWithinLimits: chargeWithinLimit && productionWithinLimit,
      nodeCount: downstreamNodeIds.length
    };
  };

  const SRG2Card = ({ srg2 }: { srg2: SRG2Config }) => {
    const node = currentProject.nodes.find(n => n.id === srg2.nodeId);
    
    const getStatusColor = (status?: string) => {
      switch (status) {
        case "ACTIF": return "bg-green-500";
        case "INACTIF": return "bg-gray-500";
        case "DEFAUT": return "bg-red-500";
        case "MAINTENANCE": return "bg-yellow-500";
        default: return "bg-gray-500";
      }
    };

    const getStatusText = (status?: string) => {
      switch (status) {
        case "ACTIF": return "Actif";
        case "INACTIF": return "Inactif";
        case "DEFAUT": return "Défaut";
        case "MAINTENANCE": return "Maintenance";
        default: return "Inconnu";
      }
    };
    
    return (
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-sm">{srg2.name}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(srg2.status)}`} />
                <span className="text-xs text-muted-foreground">{getStatusText(srg2.status)}</span>
              </div>
              <Switch
                checked={srg2.enabled}
                onCheckedChange={(enabled) => 
                  updateSRG2Device(srg2.id, { enabled })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeSRG2Device(srg2.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Nœud: {node?.name || srg2.nodeId} • Mode: {srg2.mode} • Type: {srg2.type || 'Auto'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Mode</Label>
              <Select 
                value={srg2.mode} 
                onValueChange={(mode) => updateSRG2Device(srg2.id, { mode: mode as "AUTO" | "MANUEL" })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Automatique</SelectItem>
                  <SelectItem value="MANUEL">Manuel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Consigne (230V fixe)</Label>
              <Input
                type="number"
                value={230}
                disabled
                className="h-8 bg-muted"
              />
            </div>
          </div>

          {/* Seuils de régulation */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Seuils de régulation ({srg2.type}):</Label>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">LO2 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilLO2_V || 246}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilLO2_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">LO1 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilLO1_V || 238}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilLO1_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO1 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilBO1_V || 222}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilBO1_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO2 (V)</Label>
                <Input
                  type="number"
                  value={srg2.seuilBO2_V || 214}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    seuilBO2_V: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
            </div>
          </div>

          {/* Coefficients de régulation */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Coefficients (%):</Label>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">LO2</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientLO2 || -7}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientLO2: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">LO1</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientLO1 || -3.5}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientLO1: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO1</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientBO1 || 3.5}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientBO1: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs">BO2</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={srg2.coefficientBO2 || 7}
                  onChange={(e) => updateSRG2Device(srg2.id, {
                    coefficientBO2: Number(e.target.value)
                  })}
                  className="h-8"
                />
              </div>
            </div>
          </div>

          {/* Limites de puissance - Informations fixes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Production max (kVA)</Label>
              <Input
                type="number"
                value={LIMITE_PRODUCTION_KVA}
                disabled
                className="h-8 bg-muted"
              />
            </div>
            <div>
              <Label className="text-xs">Charge max (kVA)</Label>
              <Input
                type="number"
                value={LIMITE_CHARGE_KVA}
                disabled
                className="h-8 bg-muted"
              />
            </div>
          </div>

          {/* Résultats de simulation */}
          {srg2.tensionEntree && (() => {
            const is230V = currentProject?.voltageSystem === 'TRIPHASÉ_230V';
            const phaseLabels = is230V 
              ? { A: 'L1-L2', B: 'L2-L3', C: 'L3-L1' }
              : { A: 'L1', B: 'L2', C: 'L3' };
            
            return (
            <div className="bg-muted/50 p-2 rounded">
              <div className="text-xs font-medium mb-1">Résultats de régulation:</div>
              
              {/* Tensions d'entrée */}
              <div className="mb-2">
                <div className="text-xs text-muted-foreground mb-1">Tensions d'entrée:</div>
                <div className="grid grid-cols-3 gap-1 text-xs">
                  <div>{phaseLabels.A}: {srg2.tensionEntree.A.toFixed(1)}V</div>
                  <div>{phaseLabels.B}: {srg2.tensionEntree.B.toFixed(1)}V</div>
                  <div>{phaseLabels.C}: {srg2.tensionEntree.C.toFixed(1)}V</div>
                </div>
              </div>

              {/* États des commutateurs */}
              {srg2.etatCommutateur && (
                <div className="mb-2">
                  <div className="text-xs text-muted-foreground mb-1">États commutateurs:</div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div>{phaseLabels.A}: <Badge variant="outline" className="text-xs">{srg2.etatCommutateur.A}</Badge></div>
                    <div>{phaseLabels.B}: <Badge variant="outline" className="text-xs">{srg2.etatCommutateur.B}</Badge></div>
                    <div>{phaseLabels.C}: <Badge variant="outline" className="text-xs">{srg2.etatCommutateur.C}</Badge></div>
                  </div>
                </div>
              )}

              {/* Coefficients appliqués */}
              {srg2.coefficientsAppliques && (
                <div className="mb-2">
                  <div className="text-xs text-muted-foreground mb-1">Coefficients:</div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div>{phaseLabels.A}: {srg2.coefficientsAppliques.A > 0 ? '+' : ''}{srg2.coefficientsAppliques.A.toFixed(1)}%</div>
                    <div>{phaseLabels.B}: {srg2.coefficientsAppliques.B > 0 ? '+' : ''}{srg2.coefficientsAppliques.B.toFixed(1)}%</div>
                    <div>{phaseLabels.C}: {srg2.coefficientsAppliques.C > 0 ? '+' : ''}{srg2.coefficientsAppliques.C.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Tensions de sortie */}
              {srg2.tensionSortie && (
                <div className="mb-2">
                  <div className="text-xs text-muted-foreground mb-1">Tensions de sortie:</div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div>{phaseLabels.A}: {srg2.tensionSortie.A.toFixed(1)}V</div>
                    <div>{phaseLabels.B}: {srg2.tensionSortie.B.toFixed(1)}V</div>
                    <div>{phaseLabels.C}: {srg2.tensionSortie.C.toFixed(1)}V</div>
                  </div>
                </div>
              )}

              {/* Contraintes et limitations */}
              {srg2.contraintesSRG230 && (
                <Badge variant="secondary" className="mt-1 text-xs">
                  Contraintes SRG2-230 actives
                </Badge>
              )}
              {srg2.limitePuissanceAtteinte && (
                <Badge variant="destructive" className="mt-1 text-xs">
                  Limite puissance atteinte
                </Badge>
              )}
              {srg2.defautCode && (
                <Badge variant="destructive" className="mt-1 text-xs">
                  Défaut: {srg2.defautCode}
                </Badge>
              )}
            </div>
            );
          })()}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Régulateurs SRG2</h3>
        <div className="flex items-center gap-2">
          <Button
            variant={nodeSelectionMode === 'srg2' ? 'default' : 'outline'}
            size="sm"
            onClick={() => startNodeSelection('srg2')}
            title="Sélectionner sur la carte"
            disabled={!nodes.length}
          >
            <MapPin className="h-3 w-3 mr-1" />
            Carte
          </Button>
          <NodeSelector
            nodes={currentProject.nodes}
            onNodeSelected={(nodeId) => addSRG2Device(nodeId)}
            title="Ajouter un SRG2"
            description="Stabilisateur de Réseau de Génération - Régulation de tension automatique"
            trigger={
              <Button size="sm" variant="outline" disabled={!nodes.length}>
                <Plus className="h-3 w-3 mr-1" />
                Liste
              </Button>
            }
          />
        </div>
      </div>

      {/* Affichage des puissances aval pour tous les SRG2 */}
      {simulationEquipment.srg2Devices && simulationEquipment.srg2Devices.length > 0 && (
        <div className="space-y-3">
          {simulationEquipment.srg2Devices.map(srg2 => {
            const powers = calculateDownstreamPowers(srg2);
            
            const getProgressColor = (ratio: number) => {
              if (ratio > 1) return 'bg-destructive';
              if (ratio > 0.8) return 'bg-orange-500';
              if (ratio > 0.7) return 'bg-yellow-500';
              return 'bg-green-500';
            };
            
            let badgeVariant: "default" | "secondary" | "destructive" = "default";
            let badgeLabel = "OK";
            
            if (!powers.isWithinLimits) {
              badgeVariant = "destructive";
              badgeLabel = "Dépassement";
            } else if (powers.ratioCharge > 0.8 || powers.ratioProduction > 0.8) {
              badgeVariant = "secondary";
              badgeLabel = "Attention";
            }
            
            return (
              <Card key={srg2.id} className="overflow-hidden">
                {/* Header amélioré */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{srg2.name}</span>
                  </div>
                  <Badge 
                    variant={badgeVariant}
                    className={cn(
                      "px-2 py-0.5 flex items-center gap-1",
                      badgeVariant === "default" && "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                    )}
                  >
                    {powers.isWithinLimits ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {badgeLabel}
                  </Badge>
                </div>
                
                {/* Grille 2 colonnes Production / Charge */}
                <div className="grid grid-cols-2 gap-3 p-3">
                  {/* Colonne Production */}
                  <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      <span className="text-xs font-medium text-orange-800 dark:text-orange-300">Production</span>
                    </div>
                    <div className="text-lg font-bold">
                      {powers.totalProductionKVA.toFixed(1)}
                      <span className="text-xs font-normal text-muted-foreground ml-1">/ {LIMITE_PRODUCTION_KVA} kVA</span>
                    </div>
                    <div className="relative">
                      <Progress 
                        value={Math.min(powers.ratioProduction * 100, 100)} 
                        className="h-2 bg-orange-200 dark:bg-orange-900/50"
                      />
                      <div 
                        className={cn(
                          "absolute inset-0 h-2 rounded-full transition-all",
                          getProgressColor(powers.ratioProduction)
                        )}
                        style={{ width: `${Math.min(powers.ratioProduction * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1 text-xs">
                      <span className={cn(
                        "font-medium",
                        powers.ratioProduction > 1 && "text-destructive",
                        powers.ratioProduction > 0.8 && powers.ratioProduction <= 1 && "text-orange-600 dark:text-orange-400"
                      )}>
                        {(powers.ratioProduction * 100).toFixed(0)}%
                      </span>
                      {!powers.productionWithinLimit && (
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                      )}
                    </div>
                  </div>
                  
                  {/* Colonne Charge */}
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Plug className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-medium text-blue-800 dark:text-blue-300">Charge</span>
                    </div>
                    <div className="text-lg font-bold">
                      {powers.totalChargeKVA.toFixed(1)}
                      <span className="text-xs font-normal text-muted-foreground ml-1">/ {LIMITE_CHARGE_KVA} kVA</span>
                    </div>
                    <div className="relative">
                      <Progress 
                        value={Math.min(powers.ratioCharge * 100, 100)} 
                        className="h-2 bg-blue-200 dark:bg-blue-900/50"
                      />
                      <div 
                        className={cn(
                          "absolute inset-0 h-2 rounded-full transition-all",
                          getProgressColor(powers.ratioCharge)
                        )}
                        style={{ width: `${Math.min(powers.ratioCharge * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1 text-xs">
                      <span className={cn(
                        "font-medium",
                        powers.ratioCharge > 1 && "text-destructive",
                        powers.ratioCharge > 0.8 && powers.ratioCharge <= 1 && "text-blue-600 dark:text-blue-400"
                      )}>
                        {(powers.ratioCharge * 100).toFixed(0)}%
                      </span>
                      {!powers.chargeWithinLimit && (
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Footer avec nombre de nœuds */}
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2 border-t bg-muted/20">
                  <MapPin className="h-3 w-3" />
                  <span>{powers.nodeCount} nœud{powers.nodeCount > 1 ? 's' : ''} en aval</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {simulationEquipment.srg2Devices?.length === 0 ? (
        <Card className="p-4 text-center text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun régulateur SRG2</p>
          <p className="text-xs">
            Ajoutez des SRG2 pour la régulation automatique de tension
          </p>
        </Card>
      ) : (
        simulationEquipment.srg2Devices?.map(srg2 => (
          <SRG2Card key={srg2.id} srg2={srg2} />
        ))
      )}
    </div>
  );
};