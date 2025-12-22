import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useNetworkStore } from '@/store/networkStore';
import { ClientCouplage, ClientConnectionType, ClientType } from '@/types/network';
import { normalizeClientConnectionType } from '@/utils/phaseDistributionCalculator';
import { toast } from 'sonner';
import { MapPin, Unlink, Target, Move } from 'lucide-react';

export const ClientEditPanel = () => {
  const { 
    currentProject, 
    selectedClientId, 
    updateClientImporte, 
    closeEditPanel, 
    unlinkClient, 
    linkClientToNode,
    addClientManual,
    isCreatingClient,
    cancelClientCreation
  } = useNetworkStore();
  
  // Mode création ou édition
  const isCreationMode = isCreatingClient && !selectedClientId;
  
  const client = isCreationMode ? null : currentProject?.clientsImportes?.find(c => c.id === selectedClientId);
  const clientLink = client ? currentProject?.clientLinks?.find(link => link.clientId === selectedClientId) : null;
  const linkedNode = clientLink 
    ? currentProject?.nodes.find(n => n.id === clientLink.nodeId)
    : null;

  // États du formulaire
  const [nomCircuit, setNomCircuit] = useState('');
  const [identifiantCircuit, setIdentifiantCircuit] = useState('');
  const [puissanceContractuelle, setPuissanceContractuelle] = useState(5);
  const [puissancePV, setPuissancePV] = useState(0);
  const [couplage, setCouplage] = useState<ClientCouplage>('');
  const [tensionMin, setTensionMin] = useState<number | undefined>(undefined);
  const [tensionMax, setTensionMax] = useState<number | undefined>(undefined);
  const [tensionMinHiver, setTensionMinHiver] = useState<number | undefined>(undefined);
  const [tensionMaxEte, setTensionMaxEte] = useState<number | undefined>(undefined);
  const [ecartTension15jours, setEcartTension15jours] = useState<number | undefined>(undefined);
  const [tensionCircuit, setTensionCircuit] = useState<number | undefined>(undefined);
  const [identifiantCabine, setIdentifiantCabine] = useState<string>('');
  const [identifiantPosteSource, setIdentifiantPosteSource] = useState<string>('');
  const [assignedPhase, setAssignedPhase] = useState<'A' | 'B' | 'C' | undefined>(undefined);
  const [connectionType, setConnectionType] = useState<ClientConnectionType>('MONO');
  const [clientType, setClientType] = useState<ClientType>('résidentiel');
  const [isSelectingNode, setIsSelectingNode] = useState(false);
  const [isMovingClient, setIsMovingClient] = useState(false);
  
  // États spécifiques à la création
  const [creationLocation, setCreationLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [creationNodeId, setCreationNodeId] = useState<string | null>(null);
  const [isSelectingLocation, setIsSelectingLocation] = useState(false);

  // Initialisation des valeurs selon le mode
  useEffect(() => {
    if (isCreationMode) {
      // Réinitialiser pour un nouveau client
      setNomCircuit('');
      setIdentifiantCircuit('');
      setPuissanceContractuelle(5);
      setPuissancePV(0);
      setCouplage('');
      setConnectionType('MONO');
      setClientType('résidentiel');
      setCreationLocation(null);
      setCreationNodeId(null);
      setTensionMin(undefined);
      setTensionMax(undefined);
      setTensionMinHiver(undefined);
      setTensionMaxEte(undefined);
      setEcartTension15jours(undefined);
      setTensionCircuit(undefined);
      setIdentifiantCabine('');
      setIdentifiantPosteSource('');
      setAssignedPhase(undefined);
    } else if (client) {
      // Charger les données du client existant
      setNomCircuit(client.nomCircuit);
      setIdentifiantCircuit(client.identifiantCircuit);
      setPuissanceContractuelle(client.puissanceContractuelle_kVA);
      setPuissancePV(client.puissancePV_kVA);
      setCouplage(client.couplage);
      setTensionMin(client.tensionMin_V);
      setTensionMax(client.tensionMax_V);
      setTensionMinHiver(client.tensionMinHiver_V);
      setTensionMaxEte(client.tensionMaxEte_V);
      setEcartTension15jours(client.ecartTension15jours_V);
      setTensionCircuit(client.tensionCircuit_V);
      setIdentifiantCabine(client.identifiantCabine || '');
      setIdentifiantPosteSource(client.identifiantPosteSource || '');
      setAssignedPhase(client.assignedPhase);
      setClientType(client.clientType || 'résidentiel');
      setConnectionType(
        client.connectionType || 
        normalizeClientConnectionType(client.couplage, currentProject.voltageSystem)
      );
    }
  }, [client, isCreationMode]);

  // Écouter l'événement de sélection de nœud (mode édition et création)
  useEffect(() => {
    if (!isSelectingNode) return;
    
    const handleNodeSelected = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { nodeId } = customEvent.detail;
      
      if (isCreationMode) {
        // En mode création, stocker le nodeId pour l'utiliser à la création
        setCreationNodeId(nodeId);
        const node = currentProject?.nodes.find(n => n.id === nodeId);
        toast.success(`Point d'insertion sélectionné: ${node?.name || nodeId}`);
      } else if (client) {
        // En mode édition, lier directement
        linkClientToNode(client.id, nodeId);
        toast.success('Client lié au nœud');
      }
      
      setIsSelectingNode(false);
    };
    
    window.addEventListener('nodeSelectedForClient', handleNodeSelected);
    
    return () => {
      window.removeEventListener('nodeSelectedForClient', handleNodeSelected);
    };
  }, [isSelectingNode, isCreationMode, client?.id, linkClientToNode, currentProject?.nodes]);
  
  // Écouter l'événement de sélection de position (mode création et déplacement)
  useEffect(() => {
    if (!isSelectingLocation && !isMovingClient) return;
    
    const handleLocationSelected = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { lat, lng } = customEvent.detail;
      
      if (isCreationMode && isSelectingLocation) {
        // En mode création, stocker la position
        setCreationLocation({ lat, lng });
        setIsSelectingLocation(false);
        toast.success('Position sélectionnée');
      } else if (client && isMovingClient) {
        // En mode édition, mettre à jour le client
        updateClientImporte(client.id, { lat, lng });
        setIsMovingClient(false);
        toast.success('Position du client mise à jour');
      }
    };
    
    window.addEventListener('locationSelectedForClient', handleLocationSelected);
    
    return () => {
      window.removeEventListener('locationSelectedForClient', handleLocationSelected);
    };
  }, [isSelectingLocation, isMovingClient, isCreationMode, client?.id, updateClientImporte]);
  
  // Nettoyer les modes sélection/déplacement si on ferme le panneau
  useEffect(() => {
    return () => {
      if (isSelectingNode) {
        window.dispatchEvent(new CustomEvent('cancelNodeSelection'));
      }
      if (isMovingClient || isSelectingLocation) {
        window.dispatchEvent(new CustomEvent('cancelClientMove'));
      }
    };
  }, [isSelectingNode, isMovingClient, isSelectingLocation]);

  // Mode création sans client sélectionné
  if (!isCreationMode && !client) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">Aucun client sélectionné</p>
      </div>
    );
  }

  const handleSave = () => {
    if (!client) return;
    
    updateClientImporte(client.id, {
      nomCircuit,
      identifiantCircuit,
      puissanceContractuelle_kVA: puissanceContractuelle,
      puissancePV_kVA: puissancePV,
      tensionMin_V: tensionMin,
      tensionMax_V: tensionMax,
      tensionMinHiver_V: tensionMinHiver,
      tensionMaxEte_V: tensionMaxEte,
      ecartTension15jours_V: ecartTension15jours,
      tensionCircuit_V: tensionCircuit,
      identifiantCabine,
      identifiantPosteSource,
      assignedPhase,
      connectionType,
      clientType,
    });
    
    toast.success('Client mis à jour');
    closeEditPanel();
  };

  const handleCreate = () => {
    // Validations
    if (!nomCircuit.trim()) {
      toast.error('Veuillez entrer un nom pour le client');
      return;
    }
    if (!creationLocation) {
      toast.error('Veuillez sélectionner une position sur la carte');
      return;
    }
    if (!creationNodeId) {
      toast.error("Veuillez sélectionner un point d'insertion (nœud)");
      return;
    }
    if (puissanceContractuelle <= 0) {
      toast.error('La puissance de charge doit être supérieure à 0');
      return;
    }
    
    // Créer le client
    addClientManual({
      nomCircuit: nomCircuit.trim(),
      puissanceContractuelle_kVA: puissanceContractuelle,
      puissancePV_kVA: puissancePV,
      lat: creationLocation.lat,
      lng: creationLocation.lng,
      clientType,
      connectionType,
    });
    
    // Récupérer l'ID du client créé et le lier au nœud
    const state = useNetworkStore.getState();
    const clientsImportes = state.currentProject?.clientsImportes || [];
    const newClient = clientsImportes[clientsImportes.length - 1];
    
    if (newClient) {
      linkClientToNode(newClient.id, creationNodeId);
      toast.success(`Client "${nomCircuit}" créé et lié au réseau`);
    } else {
      toast.success('Client créé');
    }
    
    cancelClientCreation();
  };

  const handleCancel = () => {
    if (isSelectingNode) {
      window.dispatchEvent(new CustomEvent('cancelNodeSelection'));
    }
    if (isMovingClient || isSelectingLocation) {
      window.dispatchEvent(new CustomEvent('cancelClientMove'));
    }
    
    if (isCreationMode) {
      cancelClientCreation();
    } else {
      closeEditPanel();
    }
  };

  // Récupérer le nom du nœud sélectionné en mode création
  const selectedNodeForCreation = creationNodeId 
    ? currentProject?.nodes.find(n => n.id === creationNodeId)
    : null;

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-semibold">
        {isCreationMode ? 'Nouveau Client' : 'Éditer le Client'}
      </h3>

      <div className="space-y-3">
        <div>
          <Label htmlFor="nomCircuit">Nom du client *</Label>
          <Input
            id="nomCircuit"
            value={nomCircuit}
            onChange={(e) => setNomCircuit(e.target.value)}
            placeholder="Ex: Client 1"
          />
        </div>

        {!isCreationMode && (
          <div>
            <Label htmlFor="identifiantCircuit">Identifiant du circuit</Label>
            <Input
              id="identifiantCircuit"
              value={identifiantCircuit}
              onChange={(e) => setIdentifiantCircuit(e.target.value)}
            />
          </div>
        )}

        <div>
          <Label htmlFor="connectionType">Type de couplage</Label>
          <Select 
            value={connectionType} 
            onValueChange={(v: ClientConnectionType) => setConnectionType(v)}
          >
            <SelectTrigger id="connectionType">
              <SelectValue placeholder="Sélectionner un type" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="MONO">Monophasé (MONO)</SelectItem>
              <SelectItem value="TRI">Triphasé (TRI)</SelectItem>
              <SelectItem value="TETRA">Tétraphasé (TETRA)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="clientType">Type de client</Label>
          <Select value={clientType} onValueChange={(v: ClientType) => setClientType(v)}>
            <SelectTrigger id="clientType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="résidentiel">🏠 Résidentiel</SelectItem>
              <SelectItem value="industriel">🏭 Industriel</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isCreationMode && couplage && (
          <div>
            <Label htmlFor="couplageExcel">Couplage Excel (référence)</Label>
            <Input
              id="couplageExcel"
              value={couplage}
              readOnly
              className="bg-muted cursor-not-allowed text-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Valeur d'origine importée depuis Excel
            </p>
          </div>
        )}

        {currentProject?.loadModel === 'mixte_mono_poly' && 
         connectionType === 'MONO' &&
         (clientLink || isCreationMode) && (
          <div>
            <Label htmlFor="assignedPhase">Phase assignée</Label>
            <Select 
              value={assignedPhase} 
              onValueChange={(v: 'A' | 'B' | 'C') => setAssignedPhase(v)}
            >
              <SelectTrigger id="assignedPhase">
                <SelectValue placeholder="Auto (équilibrage)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A">L1</SelectItem>
                <SelectItem value="B">L2</SelectItem>
                <SelectItem value="C">L3</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {isCreationMode ? 'Phase de raccordement (mode mixte)' : 'Modification manuelle de la phase (mode mixte)'}
            </p>
          </div>
        )}

        <div>
          <Label htmlFor="puissanceContractuelle">Puissance charge (kVA) *</Label>
          <Input
            id="puissanceContractuelle"
            type="number"
            step="0.1"
            min="0"
            value={puissanceContractuelle}
            onChange={(e) => setPuissanceContractuelle(parseFloat(e.target.value) || 0)}
          />
        </div>

        <div>
          <Label htmlFor="puissancePV">Puissance PV (kVA)</Label>
          <Input
            id="puissancePV"
            type="number"
            step="0.1"
            min="0"
            value={puissancePV}
            onChange={(e) => setPuissancePV(parseFloat(e.target.value) || 0)}
          />
        </div>

        {/* Section Position - Mode Création */}
        {isCreationMode && (
          <div className="border-t pt-3 mt-3">
            <Label className="text-sm font-medium mb-2 block">Position sur la carte *</Label>
            
            {creationLocation ? (
              <div className="text-sm text-muted-foreground bg-muted p-2 rounded mb-2">
                <div>Latitude: {creationLocation.lat.toFixed(6)}</div>
                <div>Longitude: {creationLocation.lng.toFixed(6)}</div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-2">Aucune position sélectionnée</p>
            )}
            
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setIsSelectingLocation(true);
                window.dispatchEvent(new CustomEvent('startClientMove'));
              }}
              disabled={isSelectingLocation}
            >
              <MapPin className="w-4 h-4 mr-2" />
              {isSelectingLocation ? 'Cliquez sur la carte...' : '📍 Sélectionner sur la carte'}
            </Button>
            
            {isSelectingLocation && (
              <p className="text-xs text-amber-600 mt-2">
                ⚡ Cliquez sur la carte pour définir la position du client. Appuyez sur ESC pour annuler.
              </p>
            )}
          </div>
        )}

        {/* Section Point d'insertion - Mode Création */}
        {isCreationMode && (
          <div className="border-t pt-3 mt-3">
            <Label className="text-sm font-medium mb-2 block">Point d'insertion (nœud) *</Label>
            
            {selectedNodeForCreation ? (
              <div className="text-sm text-muted-foreground bg-muted p-2 rounded mb-2">
                <div className="font-medium">{selectedNodeForCreation.name}</div>
                <div className="text-xs">
                  Position: {selectedNodeForCreation.lat.toFixed(6)}, {selectedNodeForCreation.lng.toFixed(6)}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-2">Aucun nœud sélectionné</p>
            )}
            
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setIsSelectingNode(true);
                window.dispatchEvent(new CustomEvent('startNodeSelection'));
              }}
              disabled={isSelectingNode}
            >
              <Target className="w-4 h-4 mr-2" />
              {isSelectingNode ? 'Cliquez sur un nœud...' : "Sélectionner un point d'insertion"}
            </Button>
            
            {isSelectingNode && (
              <p className="text-xs text-amber-600 mt-2">
                ⚡ Cliquez sur un nœud de la carte pour définir le point d'insertion. Appuyez sur ESC pour annuler.
              </p>
            )}
          </div>
        )}

        {/* Sections spécifiques au mode édition */}
        {!isCreationMode && client && (
          <>
            <div className="border-t pt-3 mt-3">
              <Label className="text-sm font-medium mb-2 block">Tensions mesurées</Label>
              
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="tensionMin">Min Tension (V)</Label>
                  <Input
                    id="tensionMin"
                    type="number"
                    step="0.1"
                    value={tensionMin || ''}
                    onChange={(e) => setTensionMin(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="Non renseigné"
                  />
                </div>

                <div>
                  <Label htmlFor="tensionMax">Max Tension (V)</Label>
                  <Input
                    id="tensionMax"
                    type="number"
                    step="0.1"
                    value={tensionMax || ''}
                    onChange={(e) => setTensionMax(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="Non renseigné"
                  />
                </div>

                <div>
                  <Label htmlFor="tensionMinHiver">Min Tension hiver (V)</Label>
                  <Input
                    id="tensionMinHiver"
                    type="number"
                    step="0.1"
                    value={tensionMinHiver || ''}
                    onChange={(e) => setTensionMinHiver(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="Non renseigné"
                  />
                </div>

                <div>
                  <Label htmlFor="tensionMaxEte">Max Tension été (V)</Label>
                  <Input
                    id="tensionMaxEte"
                    type="number"
                    step="0.1"
                    value={tensionMaxEte || ''}
                    onChange={(e) => setTensionMaxEte(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="Non renseigné"
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="ecartTension15jours">Écart de tension sur les 15 derniers jours (V)</Label>
                  <Input
                    id="ecartTension15jours"
                    type="number"
                    step="0.1"
                    value={ecartTension15jours || ''}
                    onChange={(e) => setEcartTension15jours(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="Non renseigné"
                  />
                </div>

                <div className="col-span-2">
                  <Label htmlFor="tensionCircuit">Tension (Circuit) (V)</Label>
                  <Input
                    id="tensionCircuit"
                    type="number"
                    step="0.1"
                    value={tensionCircuit || ''}
                    onChange={(e) => setTensionCircuit(e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="230 ou 400"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Tension du circuit selon le couplage (230V ou 400V)
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t pt-3 mt-3">
              <Label className="text-sm font-medium mb-2 block">Identifiants et localisation</Label>
              
              <div className="space-y-2">
                <div>
                  <Label htmlFor="identifiantCabine">Identifiant cabine</Label>
                  <Input
                    id="identifiantCabine"
                    value={identifiantCabine}
                    onChange={(e) => setIdentifiantCabine(e.target.value)}
                    placeholder="Non renseigné"
                  />
                </div>

                <div>
                  <Label htmlFor="identifiantPosteSource">Identifiant poste source</Label>
                  <Input
                    id="identifiantPosteSource"
                    value={identifiantPosteSource}
                    onChange={(e) => setIdentifiantPosteSource(e.target.value)}
                    placeholder="Non renseigné"
                  />
                </div>

                <div className="pt-2">
                  <Label className="text-xs text-muted-foreground">Coordonnées GPS</Label>
                  <div className="space-y-1 text-xs text-muted-foreground mt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <span className="font-medium">Latitude:</span>
                      <span>{client.lat.toFixed(6)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <span className="font-medium">Longitude:</span>
                      <span>{client.lng.toFixed(6)}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2 w-full"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('centerMapOnClient', { 
                    detail: { lat: client.lat, lng: client.lng } 
                  }));
                }}
              >
                <MapPin className="w-4 h-4 mr-2" />
                Centrer la carte
              </Button>
              
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2 w-full"
                onClick={() => {
                  setIsMovingClient(true);
                  window.dispatchEvent(new CustomEvent('startClientMove'));
                }}
                disabled={isMovingClient}
              >
                <Move className="w-4 h-4 mr-2" />
                {isMovingClient ? 'Cliquez sur la carte...' : 'Déplacer sur la carte'}
              </Button>
              
              {isMovingClient && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚡ Cliquez sur la carte pour définir la nouvelle position du client. Appuyez sur ESC pour annuler.
                </p>
              )}
            </div>

            {linkedNode && (
              <div className="border-t pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">Nœud lié</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {linkedNode.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Position: {linkedNode.lat.toFixed(6)}, {linkedNode.lng.toFixed(6)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setIsSelectingNode(true);
                        window.dispatchEvent(new CustomEvent('startNodeSelection'));
                      }}
                      disabled={isSelectingNode}
                    >
                      <Target className="w-4 h-4 mr-2" />
                      {isSelectingNode ? 'Cliquez...' : 'Changer'}
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => {
                        unlinkClient(client.id);
                      }}
                    >
                      <Unlink className="w-4 h-4 mr-2" />
                      Délier
                    </Button>
                  </div>
                </div>
              </div>
            )}
            
            {!linkedNode && (
              <div className="border-t pt-3 mt-3">
                <Label className="text-sm font-medium mb-2 block">Point d'insertion</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Ce client n'est pas encore lié à un nœud du réseau
                </p>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setIsSelectingNode(true);
                    window.dispatchEvent(new CustomEvent('startNodeSelection'));
                  }}
                  disabled={isSelectingNode}
                >
                  <Target className="w-4 h-4 mr-2" />
                  {isSelectingNode ? 'Cliquez sur un nœud...' : 'Sélectionner un point d\'insertion'}
                </Button>
                {isSelectingNode && (
                  <p className="text-xs text-amber-600 mt-2">
                    ⚡ Cliquez sur un nœud de la carte pour lier ce client. Appuyez sur ESC pour annuler.
                  </p>
                )}
              </div>
            )}

            {client.rawData && Object.keys(client.rawData).length > 0 && (
              <div className="border-t pt-3 mt-3">
                <Accordion type="single" collapsible>
                  <AccordionItem value="rawData">
                    <AccordionTrigger className="text-sm font-medium">
                      Données brutes Excel ({Object.keys(client.rawData).length} colonnes)
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {Object.entries(client.rawData).map(([key, value]) => (
                          <div key={key} className="grid grid-cols-2 gap-2 text-xs">
                            <span className="font-medium text-muted-foreground truncate" title={key}>
                              {key}:
                            </span>
                            <span className="truncate" title={String(value)}>
                              {String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 pt-4 border-t">
        {isCreationMode ? (
          <>
            <Button 
              onClick={handleCreate} 
              className="flex-1"
              disabled={!nomCircuit.trim() || !creationLocation || !creationNodeId || puissanceContractuelle <= 0}
            >
              Créer
            </Button>
            <Button variant="outline" onClick={handleCancel} className="flex-1">
              Annuler
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleSave} className="flex-1">
              Enregistrer
            </Button>
            <Button variant="outline" onClick={handleCancel} className="flex-1">
              Annuler
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
