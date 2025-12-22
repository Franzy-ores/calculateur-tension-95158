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
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p>Aucun client importé</p>
          <p className="text-sm mt-2">Utilisez le bouton "Importer Clients" ou créez un client manuellement</p>
          <div className="flex gap-2 justify-center mt-4">
            {onShowImporter && (
              <Button variant="outline" onClick={onShowImporter}>
                <FileUp className="h-4 w-4 mr-2" />
                Importer Clients
              </Button>
            )}
            <Button onClick={() => startClientCreation()}>
              <Plus className="h-4 w-4 mr-2" />
              Créer un client
            </Button>
          </div>
        </div>
      </Card>
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
    if (confirm('Êtes-vous sûr de vouloir supprimer ce client ?')) {
      deleteClientImporte(clientId);
    }
  };

  const handleEdit = (clientId: string) => {
    setSelectedClient(clientId);
    openEditPanel('client');
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Boutons d'actions */}
      <div className="flex gap-2">
        {onShowImporter && (
          <Button variant="outline" onClick={onShowImporter} className="flex-1">
            <FileUp className="h-4 w-4 mr-2" />
            Importer Clients
          </Button>
        )}
        <Button onClick={() => startClientCreation()} className="flex-1">
          <Plus className="h-4 w-4 mr-2" />
          Créer un client
        </Button>
      </div>

      {/* Légende mode de coloration */}
      <Card className="p-3">
        <div className="text-sm">
          <div className="font-medium mb-2">
            Mode de coloration : 
            <span className="ml-1 text-primary">
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
      </Card>

      {/* Statistiques */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total clients</p>
            <p className="text-2xl font-bold">{totalClients}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Liés / Non liés</p>
            <p className="text-2xl font-bold">
              <span className="text-green-600">{linkedClients}</span> / <span className="text-orange-600">{unlinkedClients}</span>
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Charge totale</p>
            <p className="text-xl font-bold">{totalCharge.toFixed(1)} kVA</p>
          </div>
          <div>
            <p className="text-muted-foreground">Production totale</p>
            <p className="text-xl font-bold">{totalPV.toFixed(1)} kVA</p>
          </div>
          {smallPolyProdClients > 0 && (
            <div className="col-span-2">
              <p className="text-muted-foreground">TRI/TETRA avec prod. ≤5 kVA</p>
              <p className="text-xl font-bold text-purple-600">{smallPolyProdClients}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Filtres */}
      <Card className="p-4">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un circuit..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <Select value={filterCouplage} onValueChange={(v: any) => setFilterCouplage(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous couplages</SelectItem>
                <SelectItem value="TRI">TRI seulement</SelectItem>
                <SelectItem value="MONO">MONO seulement</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterLinked} onValueChange={(v: any) => setFilterLinked(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous états</SelectItem>
                <SelectItem value="LINKED">Liés</SelectItem>
                <SelectItem value="UNLINKED">Non liés</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Select value={filterPower} onValueChange={(v: any) => setFilterPower(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes puissances</SelectItem>
              <SelectItem value="HIGH_POWER">⚡ Forte puissance (≥10 kVA MONO)</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterClientType} onValueChange={(v: any) => setFilterClientType(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous types</SelectItem>
              <SelectItem value="résidentiel">🏠 Résidentiel</SelectItem>
              <SelectItem value="industriel">🏭 Industriel</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center space-x-2 pt-1">
            <Checkbox 
              id="filter-small-poly-prod"
              checked={filterSmallPolyProd}
              onCheckedChange={(checked) => setFilterSmallPolyProd(!!checked)}
            />
            <Label htmlFor="filter-small-poly-prod" className="text-sm cursor-pointer">
              TRI/TETRA avec production ≤ 5 kVA
            </Label>
          </div>
        </div>
      </Card>

      {/* Liste des clients */}
      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-2">
            {filteredClients.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Aucun client trouvé</p>
            ) : (
              filteredClients.map(client => {
                const link = links.find(l => l.clientId === client.id);
                const linkedNode = link ? currentProject.nodes.find(n => n.id === link.nodeId) : null;

                return (
                  <Card key={client.id} className="p-3 space-y-2">
                     <div key={client.id} className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{client.nomCircuit}</h4>
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
                        <p className="text-xs text-muted-foreground">{client.identifiantCircuit}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Charge:</span> {client.puissanceContractuelle_kVA.toFixed(1)} kVA
                      </div>
                      <div>
                        <span className="text-muted-foreground">PV:</span> {client.puissancePV_kVA.toFixed(1)} kVA
                      </div>
                    </div>

                    {linkedNode && (
                      <div className="text-xs text-muted-foreground">
                        Lié à: <span className="font-medium">{linkedNode.name}</span>
                      </div>
                    )}

                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleZoomToClient(client)}
                      >
                        <MapPin className="h-3 w-3" />
                      </Button>
                      
                      {link ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnlink(client.id)}
                        >
                          <Unlink className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStartLinking(client.id)}
                        >
                          <Link2 className="h-3 w-3" />
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(client.id)}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(client.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
};
