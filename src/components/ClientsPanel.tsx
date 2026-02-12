import { useState } from 'react';
import { Search, Link2, Unlink, Edit, Trash2, MapPin, Plus, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useNetworkStore } from '@/store/networkStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { analyzeClientPower } from '@/utils/clientsUtils';
import { ClientType } from '@/types/network';

interface ClientsPanelProps {
  onShowImporter?: () => void;
}

export const ClientsPanel = ({ onShowImporter }: ClientsPanelProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCouplage, setFilterCouplage] = useState<'ALL' | 'TRI' | 'MONO'>('ALL');
  const [filterLinked, setFilterLinked] = useState<'ALL' | 'LINKED' | 'UNLINKED'>('ALL');
  const [filterPower, setFilterPower] = useState<'ALL' | 'HIGH_POWER'>('ALL');
  const [filterSmallPolyProd, setFilterSmallPolyProd] = useState<boolean>(false);
  const [filterClientType, setFilterClientType] = useState<'ALL' | ClientType>('ALL');

  const {
    currentProject,
    deleteClientImporte,
    unlinkClient,
    setSelectedTool,
    setSelectedClient,
    setSelectedClientForLinking,
    openEditPanel,
    clientColorMode,
    circuitColorMapping,
    startClientCreation,
  } = useNetworkStore();

  if (!currentProject?.clientsImportes || currentProject.clientsImportes.length === 0) {
    return (
      <div className="p-3 bg-card/80 backdrop-blur border border-border/50 rounded-lg">
        <div className="text-center text-muted-foreground">
          <p className="text-xs">Aucun raccordement importé</p>
          <p className="text-[10px] mt-1">Utilisez le bouton "Importer Raccordements" ou créez un raccordement manuellement</p>
          <div className="flex gap-2 justify-center mt-3">
            {onShowImporter && (
              <Button variant="outline" size="sm" onClick={onShowImporter} className="text-xs h-7">
                <FileUp className="h-3 w-3 mr-1" />
                Importer
              </Button>
            )}
            <Button size="sm" onClick={() => startClientCreation()} className="text-xs h-7">
              <Plus className="h-3 w-3 mr-1" />
              Créer
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const clients = currentProject.clientsImportes;
  const links = currentProject.clientLinks || [];

  // Filtrage
  const filteredClients = clients.filter(client => {
    // Filtre de recherche
    if (searchTerm && !client.nomCircuit.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !client.identifiantCircuit.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }

    // Filtre couplage
    if (filterCouplage !== 'ALL' && client.couplage !== filterCouplage) {
      return false;
    }

    // Filtre liaison
    const isLinked = links.some(link => link.clientId === client.id);
    if (filterLinked === 'LINKED' && !isLinked) return false;
    if (filterLinked === 'UNLINKED' && isLinked) return false;

    // Filtre puissance
    if (filterPower === 'HIGH_POWER') {
      const analysis = analyzeClientPower(client);
      if (analysis.level === 'normal') {
        return false;
      }
    }

    // Filtre TRI/TETRA avec production ≤ 5 kVA
    if (filterSmallPolyProd) {
      const isPolyClient = client.couplage === 'TRI' || client.connectionType === 'TRI' || client.connectionType === 'TETRA';
      const hasSmallProduction = client.puissancePV_kVA > 0 && client.puissancePV_kVA <= 5;
      if (!isPolyClient || !hasSmallProduction) {
        return false;
      }
    }

    // Filtre type de client
    if (filterClientType !== 'ALL') {
      const clientTypeValue = client.clientType || 'résidentiel';
      if (clientTypeValue !== filterClientType) {
        return false;
      }
    }

    return true;
  });

  // Statistiques
  const totalClients = clients.length;
  const linkedClients = links.length;
  const unlinkedClients = totalClients - linkedClients;
  const totalCharge = clients.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0);
  const totalPV = clients.reduce((sum, c) => sum + c.puissancePV_kVA, 0);
  const smallPolyProdClients = clients.filter(c => 
    (c.couplage === 'TRI' || c.connectionType === 'TRI' || c.connectionType === 'TETRA') &&
    c.puissancePV_kVA > 0 && c.puissancePV_kVA <= 5
  ).length;

  const handleStartLinking = (clientId: string) => {
    setSelectedClientForLinking(clientId);
    setSelectedTool('linkClient');
  };

  const handleZoomToClient = (client: typeof clients[0]) => {
    const event = new CustomEvent('zoomToLocation', {
      detail: { lat: client.lat, lng: client.lng, zoom: 18 }
    });
    window.dispatchEvent(event);
  };

  const handleUnlink = (clientId: string) => {
    unlinkClient(clientId);
  };

  const handleDelete = (clientId: string) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce raccordement ?')) {
      deleteClientImporte(clientId);
    }
  };

  const handleEdit = (clientId: string) => {
    setSelectedClient(clientId);
    openEditPanel('client');
  };

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Boutons d'actions */}
      <div className="flex gap-2">
        {onShowImporter && (
          <Button variant="outline" size="sm" onClick={onShowImporter} className="flex-1 text-xs h-7">
            <FileUp className="h-3 w-3 mr-1" />
            Importer
          </Button>
        )}
        <Button size="sm" onClick={() => startClientCreation()} className="flex-1 text-xs h-7">
          <Plus className="h-3 w-3 mr-1" />
          Créer
        </Button>
      </div>

      {/* Légende mode de coloration */}
      <div className="p-2 bg-card/80 backdrop-blur border border-border/50 rounded-lg">
        <div className="text-xs">
          <div className="font-medium mb-1 text-[10px] text-muted-foreground">
            Coloration : 
            <span className="ml-1 text-primary font-semibold">
              {clientColorMode === 'couplage' && 'Par Couplage'}
              {clientColorMode === 'circuit' && 'Par Circuit'}
              {clientColorMode === 'tension' && 'Par Tension'}
              {clientColorMode === 'lien' && 'Par Lien'}
              {clientColorMode === 'gps' && 'Par Origine GPS'}
            </span>
          </div>
          
          {clientColorMode === 'couplage' && (
            <div className="flex gap-4 mt-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#3b82f6]"></div>
                <span>TRI</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#f97316]"></div>
                <span>MONO</span>
              </div>
            </div>
          )}
          
          {clientColorMode === 'circuit' && (
            <div className="space-y-1.5 mt-1">
              {Array.from(circuitColorMapping || new Map()).map(([circuit, color]) => (
                <div key={circuit} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></div>
                  <span className="text-xs truncate">{circuit}</span>
                </div>
              ))}
              {(circuitColorMapping?.size || 0) === 0 && (
                <div className="text-xs text-muted-foreground">Aucun circuit détecté</div>
              )}
              {(circuitColorMapping?.size || 0) > 6 && (
                <div className="text-xs text-amber-600 mt-1">
                  ⚠️ Plus de 6 circuits : certaines couleurs sont réutilisées
                </div>
              )}
            </div>
          )}
          
          {clientColorMode === 'tension' && (
            <div className="flex gap-4 mt-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#22c55e]"></div>
                <span>230V</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#3b82f6]"></div>
                <span>400V</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#6b7280]"></div>
                <span>Non renseigné</span>
              </div>
            </div>
          )}
          
          {clientColorMode === 'lien' && (
            <div className="flex gap-4 mt-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#22c55e]"></div>
                <span>Lié à un nœud</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ef4444]"></div>
                <span>Non lié</span>
              </div>
            </div>
          )}
          
          {clientColorMode === 'gps' && (
            <div className="flex gap-4 mt-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#22c55e]"></div>
                <span>GPS d'origine (fichier Excel)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#f97316]"></div>
                <span>GPS géocodé automatiquement</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Statistiques */}
      <div className="flex flex-wrap items-stretch gap-3 p-2 bg-card/80 backdrop-blur border border-border/50 rounded-lg">
        <div className="flex flex-col items-center px-2">
          <span className="text-[10px] text-muted-foreground">Total</span>
          <span className="text-sm font-bold text-primary">{totalClients}</span>
        </div>
        <div className="w-px bg-border/50 self-stretch" />
        <div className="flex flex-col items-center px-2">
          <span className="text-[10px] text-muted-foreground">Liés / Non liés</span>
          <span className="text-sm font-bold">
            <span className="text-green-600">{linkedClients}</span> / <span className="text-orange-600">{unlinkedClients}</span>
          </span>
        </div>
        <div className="w-px bg-border/50 self-stretch" />
        <div className="flex flex-col items-center px-2">
          <span className="text-[10px] text-muted-foreground">Charges</span>
          <span className="text-sm font-bold text-primary">{totalCharge.toFixed(1)} kVA</span>
        </div>
        <div className="w-px bg-border/50 self-stretch" />
        <div className="flex flex-col items-center px-2">
          <span className="text-[10px] text-muted-foreground">Production</span>
          <span className="text-sm font-bold text-yellow-500">{totalPV.toFixed(1)} kVA</span>
        </div>
        {smallPolyProdClients > 0 && (
          <>
            <div className="w-px bg-border/50 self-stretch" />
            <div className="flex flex-col items-center px-2">
              <span className="text-[10px] text-muted-foreground">TRI prod ≤5</span>
              <span className="text-sm font-bold text-purple-600">{smallPolyProdClients}</span>
            </div>
          </>
        )}
      </div>

      {/* Filtres */}
      <div className="p-2 bg-card/80 backdrop-blur border border-border/50 rounded-lg">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[150px] max-w-[220px]">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
          </div>
          
          <Select value={filterCouplage} onValueChange={(v: any) => setFilterCouplage(v)}>
            <SelectTrigger className="w-[100px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Couplage</SelectItem>
              <SelectItem value="TRI">TRI</SelectItem>
              <SelectItem value="MONO">MONO</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterLinked} onValueChange={(v: any) => setFilterLinked(v)}>
            <SelectTrigger className="w-[100px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">État</SelectItem>
              <SelectItem value="LINKED">Liés</SelectItem>
              <SelectItem value="UNLINKED">Non liés</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={filterPower} onValueChange={(v: any) => setFilterPower(v)}>
            <SelectTrigger className="w-[120px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Puissance</SelectItem>
              <SelectItem value="HIGH_POWER">⚡ Forte</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterClientType} onValueChange={(v: any) => setFilterClientType(v)}>
            <SelectTrigger className="w-[110px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Type</SelectItem>
              <SelectItem value="résidentiel">🏠 Rés.</SelectItem>
              <SelectItem value="industriel">🏭 Ind.</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center space-x-1">
            <Checkbox 
              id="filter-small-poly-prod"
              checked={filterSmallPolyProd}
              onCheckedChange={(checked) => setFilterSmallPolyProd(!!checked)}
              className="h-3.5 w-3.5"
            />
            <Label htmlFor="filter-small-poly-prod" className="text-[10px] cursor-pointer text-muted-foreground">
              TRI prod ≤5
            </Label>
          </div>
        </div>
      </div>

      {/* Liste des raccordements */}
      <div className="flex-1 overflow-hidden bg-card/80 backdrop-blur border border-border/50 rounded-lg">
        <ScrollArea className="h-full">
          <div className="p-2 space-y-1">
            {filteredClients.length === 0 ? (
              <p className="text-center text-muted-foreground py-4 text-xs">Aucun raccordement trouvé</p>
            ) : (
              filteredClients.map(client => {
                const link = links.find(l => l.clientId === client.id);
                const linkedNode = link ? currentProject.nodes.find(n => n.id === link.nodeId) : null;

                return (
                  <div key={client.id} className="p-2 space-y-1 border border-border/30 rounded-md bg-background/50 hover:bg-muted/30 transition-colors">
                     <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs font-semibold">{client.nomCircuit}</span>
                          <Badge variant={client.couplage === 'TRI' ? 'default' : 'secondary'}>
                            {client.couplage}
                          </Badge>
                          {(() => {
                            const powerAnalysis = analyzeClientPower(client, currentProject?.voltageSystem);
                            return (
                              <>
                                {powerAnalysis && powerAnalysis.level !== 'normal' && (
                                  <Badge variant={powerAnalysis.badgeVariant} className="text-xs">
                                    {powerAnalysis.label}
                                  </Badge>
                                )}
                                {client.connectionType === 'MONO' && powerAnalysis?.phaseCoupling && (
                                  <Badge variant="outline" className="text-xs">
                                    {powerAnalysis.phaseCoupling}
                                  </Badge>
                                )}
                              </>
                            );
                          })()}
                          {client.connectionType && client.connectionType !== 'MONO' && (
                            <Badge variant="outline" className="text-xs">
                              {client.connectionType}
                            </Badge>
                          )}
                          {(client.connectionType === 'TRI' || client.connectionType === 'TETRA' || client.couplage === 'TRI') && 
                           client.puissancePV_kVA > 0 && client.puissancePV_kVA <= 5 && (
                            <Badge variant="outline" className="text-xs text-purple-600 border-purple-600">
                              Prod ≤5kVA
                            </Badge>
                          )}
                          {link && (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              Lié
                            </Badge>
                          )}
                          <Badge variant={client.clientType === 'industriel' ? 'warning' : 'outline'} className="text-xs">
                            {client.clientType === 'industriel' ? '🏭 Industriel' : '🏠 Résidentiel'}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{client.identifiantCircuit}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-[10px]">
                      <span><span className="text-muted-foreground">Ch:</span> <span className="font-mono font-medium">{client.puissanceContractuelle_kVA.toFixed(1)}</span></span>
                      <span><span className="text-muted-foreground">PV:</span> <span className="font-mono font-medium">{client.puissancePV_kVA.toFixed(1)}</span></span>
                      {linkedNode && (
                        <span className="text-muted-foreground">→ <span className="font-medium text-foreground">{linkedNode.name}</span></span>
                      )}
                    </div>

                    <div className="flex gap-0.5">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleZoomToClient(client)}>
                        <MapPin className="h-3 w-3" />
                      </Button>
                      {link ? (
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleUnlink(client.id)}>
                          <Unlink className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleStartLinking(client.id)}>
                          <Link2 className="h-3 w-3" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEdit(client.id)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive/70 hover:text-destructive" onClick={() => handleDelete(client.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};
