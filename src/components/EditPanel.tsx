import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Trash2, Plus, Target, Zap, Network, Car } from 'lucide-react';
import { useNetworkStore } from '@/store/networkStore';
import { ConnectionType, VoltageSystem, ClientCharge, ProductionPV, LoadModel } from '@/types/network';
import { getNodeConnectionType } from '@/utils/nodeConnectionType';
import { getLinkedClientsForNode } from '@/utils/clientsUtils';
import { toast } from 'sonner';
import { ClientEditPanel } from './ClientEditPanel';
import { NodePhaseDisplay } from './NodePhaseDisplay';

export const EditPanel = () => {
  const {
    editPanelOpen,
    editTarget,
    closeEditPanel,
    currentProject,
    selectedNodeId,
    selectedCableId,
    updateNode,
    updateCable,
    updateProjectConfig,
    deleteNode,
    deleteCable,
    calculateWithTargetVoltage
  } = useNetworkStore();

  const [formData, setFormData] = useState<any>({});

  const selectedNode = currentProject?.nodes?.find(n => n.id === selectedNodeId);
  const selectedCable = currentProject?.cables?.find(c => c.id === selectedCableId);

  // Récupérer les clients importés liés au nœud sélectionné
  const linkedClients = selectedNode && currentProject?.clientsImportes && currentProject?.clientLinks
    ? getLinkedClientsForNode(selectedNode.id, currentProject.clientsImportes, currentProject.clientLinks)
    : [];

  // Calculer les totaux
  const manualChargeTotal = formData.clients?.reduce((sum: number, c: ClientCharge) => sum + c.S_kVA, 0) || 0;
  const linkedChargeTotal = linkedClients.reduce((sum, c) => sum + c.puissanceContractuelle_kVA, 0);
  const manualProductionTotal = formData.productions?.reduce((sum: number, p: ProductionPV) => sum + p.S_kVA, 0) || 0;
  const linkedProductionTotal = linkedClients.reduce((sum, c) => sum + c.puissancePV_kVA, 0);

  // Calculer les tensions Min et Max extrêmes parmi les clients liés
  const extremeTensions = linkedClients.length > 0 ? {
    minVoltage: linkedClients
      .filter(c => c.tensionMin_V !== undefined)
      .reduce((min, c) => c.tensionMin_V! < min ? c.tensionMin_V! : min, Infinity),
    maxVoltage: linkedClients
      .filter(c => c.tensionMax_V !== undefined)
      .reduce((max, c) => c.tensionMax_V! > max ? c.tensionMax_V! : max, -Infinity),
    hasMinData: linkedClients.some(c => c.tensionMin_V !== undefined),
    hasMaxData: linkedClients.some(c => c.tensionMax_V !== undefined)
  } : { minVoltage: undefined, maxVoltage: undefined, hasMinData: false, hasMaxData: false };

  // Initialize form data when panel opens
  useEffect(() => {
    if (editPanelOpen) {
      if (editTarget === 'node' && selectedNode) {
        setFormData({
          name: selectedNode.name,
          clients: [...(selectedNode.clients || [])],
          productions: [...(selectedNode.productions || [])],
          tensionCible: selectedNode.tensionCible || '',
          transformerConfig: selectedNode.isSource ? currentProject?.transformerConfig : undefined,
          manualLoadType: selectedNode.manualLoadType || 'POLY',
          rt_terre_ohm: selectedNode.rt_terre_ohm ?? 25
        });
      } else if (editTarget === 'cable' && selectedCable) {
        setFormData({
          name: selectedCable.name,
          typeId: selectedCable.typeId,
          pose: selectedCable.pose
        });
      } else if (editTarget === 'project' && currentProject) {
        setFormData({
          name: currentProject.name,
          voltageSystem: currentProject.voltageSystem,
          cosPhi: currentProject.cosPhi,
          cosPhiCharges: currentProject.cosPhiCharges ?? currentProject.cosPhi ?? 0.95,
          cosPhiProductions: currentProject.cosPhiProductions ?? 1.00,
          foisonnementCharges: currentProject.foisonnementCharges,
          foisonnementProductions: currentProject.foisonnementProductions,
          defaultChargeKVA: currentProject.defaultChargeKVA || 5,
          defaultProductionKVA: currentProject.defaultProductionKVA || 5,
          loadModel: currentProject.loadModel ?? 'polyphase_equilibre',
          desequilibrePourcent: currentProject.desequilibrePourcent ?? 0,
          addEmptyNodeByDefault: currentProject.addEmptyNodeByDefault ?? true,
          treatSmallPolyProductionsAsMono: currentProject.treatSmallPolyProductionsAsMono ?? true
        });
      }
    }
  }, [editPanelOpen, editTarget, selectedNode, selectedCable, currentProject]);

  const handleSave = () => {
    try {
      if (editTarget === 'node' && selectedNodeId) {
        updateNode(selectedNodeId, formData);
        toast.success('Nœud mis à jour');
      } else if (editTarget === 'cable' && selectedCableId) {
        updateCable(selectedCableId, formData);
        toast.success('Câble mis à jour');
      } else if (editTarget === 'project') {
        updateProjectConfig(formData);
        toast.success('Projet mis à jour');
      }
      closeEditPanel();
    } catch (error) {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const handleDelete = () => {
    if (editTarget === 'node' && selectedNodeId) {
      deleteNode(selectedNodeId);
      toast.success('Nœud supprimé');
    } else if (editTarget === 'cable' && selectedCableId) {
      deleteCable(selectedCableId);
      toast.success('Câble supprimé');
    }
    closeEditPanel();
  };

  const addClient = () => {
    const newClient: ClientCharge = {
      id: `client-${Date.now()}`,
      label: `Charge ${formData.clients.length + 1}`,
      S_kVA: currentProject?.defaultChargeKVA || 10
    };
    setFormData({
      ...formData,
      clients: [...formData.clients, newClient]
    });
  };

  const addBorneVE = () => {
    const newBorne: ClientCharge = {
      id: `borne-${Date.now()}`,
      label: `Borne VE ${(formData.clients?.filter((c: ClientCharge) => c.clientCategory === 'bornesVE').length || 0) + 1}`,
      S_kVA: 11,
      clientCategory: 'bornesVE',
      borneVEConfig: {
        puissanceParBorne_kVA: 11,
        nombreBornes: 1,
        cosPhi: 0.95,
      }
    };
    setFormData({
      ...formData,
      clients: [...formData.clients, newBorne]
    });
  };

  const removeClient = (clientId: string) => {
    setFormData({
      ...formData,
      clients: formData.clients.filter((c: ClientCharge) => c.id !== clientId)
    });
  };

  const addProduction = () => {
    const newProduction: ProductionPV = {
      id: `prod-${Date.now()}`,
      label: `PV ${formData.productions.length + 1}`,
      S_kVA: currentProject?.defaultProductionKVA || 5
    };
    setFormData({
      ...formData,
      productions: [...formData.productions, newProduction]
    });
  };

  const removeProduction = (prodId: string) => {
    setFormData({
      ...formData,
      productions: formData.productions.filter((p: ProductionPV) => p.id !== prodId)
    });
  };

  const getConnectionTypeOptions = (voltageSystem: VoltageSystem) => {
    const options = {
      'TRIPHASÉ_230V': [
        { value: 'MONO_230V_PP', label: 'Monophasé 230V (2 phases)' },
        { value: 'TRI_230V_3F', label: 'Triphasé 230V (3 fils)' }
      ],
      'TÉTRAPHASÉ_400V': [
        { value: 'MONO_230V_PN', label: 'Monophasé 230V (phase-neutre)' },
        { value: 'TÉTRA_3P+N_230_400V', label: 'Tétraphasé 3P+N (230/400V)' }
      ]
    };
    return options[voltageSystem] || [];
  };

  // Calculer le type de connexion actuel du nœud
  const currentConnectionType = selectedNode && currentProject 
    ? getNodeConnectionType(currentProject.voltageSystem, currentProject.loadModel || 'polyphase_equilibre', selectedNode.isSource)
    : undefined;

  return (
    <Sheet open={editPanelOpen && editTarget !== 'simulation' && editTarget !== 'client'} onOpenChange={closeEditPanel}>
      <SheetContent className="w-96 overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>
            {editTarget === 'node' && 'Éditer le nœud'}
            {editTarget === 'cable' && 'Éditer le câble'}
            {editTarget === 'project' && 'Paramètres du projet'}
          </SheetTitle>
        </SheetHeader>

        {/* Other panels */}
        <div className="space-y-6 py-6">
          {/* Node editing */}
          {editTarget === 'node' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="node-name">Nom du nœud</Label>
                <Input
                  id="node-name"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              {linkedClients.length > 0 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded text-sm">
                  <div className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                    ℹ️ Clients importés liés
                  </div>
                  <div className="text-blue-700 dark:text-blue-300 space-y-1">
                    <div>Ce nœud a {linkedClients.length} client(s) importé(s) lié(s).</div>
                    {currentProject?.loadModel === 'mixte_mono_poly' && selectedNode?.autoPhaseDistribution && (
                      <div className="mt-2 pt-2 border-t border-blue-300 dark:border-blue-700">
                        <div className="font-semibold mb-1">Répartition par type :</div>
                        {(() => {
                          const totalMono = selectedNode.autoPhaseDistribution.monoClientsCount.A + 
                                          selectedNode.autoPhaseDistribution.monoClientsCount.B + 
                                          selectedNode.autoPhaseDistribution.monoClientsCount.C;
                          const totalPoly = selectedNode.autoPhaseDistribution.polyClientsCount;
                          return (
                            <div className="space-y-1">
                              {totalMono > 0 && (
                                   <div>
                                     🔌 <span className="font-medium">{totalMono} clients MONO</span>
                                     <div className="ml-4 text-xs">
                                       L1: {selectedNode.autoPhaseDistribution.monoClientsCount.A} • 
                                       L2: {selectedNode.autoPhaseDistribution.monoClientsCount.B} • 
                                       L3: {selectedNode.autoPhaseDistribution.monoClientsCount.C}
                                     </div>
                                   </div>
                              )}
                              {totalPoly > 0 && (
                                <div>⚡ <span className="font-medium">{totalPoly} clients TRI/TÉTRA</span></div>
                              )}
                              {selectedNode.autoPhaseDistribution.unbalancePercent > 5 && (
                                <div className={`font-semibold ${selectedNode.autoPhaseDistribution.unbalancePercent > 20 ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'}`}>
                                  ⚠️ Déséquilibre: {selectedNode.autoPhaseDistribution.unbalancePercent.toFixed(1)}%
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <div className="mt-2">Leurs puissances sont automatiquement incluses dans les calculs.</div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="connection-type">Type de connexion (automatique)</Label>
                <div className="p-2 bg-muted rounded text-sm">
                  {currentConnectionType ? (
                    getConnectionTypeOptions(currentProject?.voltageSystem || 'TÉTRAPHASÉ_400V')
                      .find(opt => opt.value === currentConnectionType)?.label || currentConnectionType
                  ) : 'Non défini'}
                </div>
                <p className="text-xs text-muted-foreground">
                  Le type de connexion est déterminé automatiquement selon le système de tension ({currentProject?.voltageSystem}) 
                  et le modèle de charge ({currentProject?.loadModel || 'polyphase_equilibre'}).
                </p>
              </div>

              {/* Résistance de terre (visible uniquement en 400V et nœud non-source) */}
              {currentProject?.voltageSystem === 'TÉTRAPHASÉ_400V' && !selectedNode?.isSource && (
                <div className="space-y-2">
                  <Label htmlFor="rt-terre" className="flex items-center gap-1">
                    Résistance de terre (Ω)
                    <span className="text-xs text-muted-foreground ml-1" title="Résistance de la prise de terre à ce poteau. 25 Ω = valeur réglementaire courante (NF C 11-201). Sol humide/argileux : 5–15 Ω. Sol sec/rocheux : 30–100 Ω. Mettre 0 pour désactiver la mise à la terre sur ce nœud.">
                      ℹ️
                    </span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="rt-terre"
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      value={formData.rt_terre_ohm ?? 25}
                      onChange={(e) => setFormData({ ...formData, rt_terre_ohm: parseFloat(e.target.value) || 0 })}
                      onBlur={() => {
                        if (selectedNode) {
                          updateNode(selectedNode.id, { rt_terre_ohm: formData.rt_terre_ohm ?? 25 });
                        }
                      }}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground font-medium">Ω</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Prise de terre poteau. 0 = pas de mise à la terre.
                  </p>
                </div>
              )}

              {/* Clients importés liés - Charges */}
              {linkedClients.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Network className="w-4 h-4" />
                      Clients importés liés ({linkedClients.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {linkedClients.map((client) => (
                      <div key={client.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                        <div className="flex-1">
                          <div className="font-medium">{client.nomCircuit || client.identifiantCircuit}</div>
                          <div className="text-xs text-muted-foreground">{client.identifiantCircuit}</div>
                        </div>
                        <div className="text-right space-y-1">
                          {client.puissanceContractuelle_kVA > 0 && (
                            <div className="font-mono">
                              ⚡ {client.puissanceContractuelle_kVA.toFixed(1)} kVA
                            </div>
                          )}
                          {client.puissancePV_kVA > 0 && (
                            <div className="font-mono text-green-600 dark:text-green-400">
                              ☀️ {client.puissancePV_kVA.toFixed(1)} kVA PV
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="pt-2 border-t mt-2">
                      <div className="flex justify-between text-sm font-medium">
                        <span>Total clients liés:</span>
                        <div className="space-y-1 text-right">
                          {linkedChargeTotal > 0 && (
                            <div>⚡ {linkedChargeTotal.toFixed(1)} kVA</div>
                          )}
                          {linkedProductionTotal > 0 && (
                            <div className="text-green-600 dark:text-green-400">☀️ {linkedProductionTotal.toFixed(1)} kVA PV</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Charges standard */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    Charges
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={addClient} title="Ajouter charge">
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={addBorneVE} title="Ajouter Borne VE" className="text-green-600 border-green-300 hover:bg-green-50">
                        <Car className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {formData.clients?.map((client: ClientCharge, index: number) => (
                    client.clientCategory === 'bornesVE' ? (
                      /* Formulaire spécifique Borne VE */
                      <div key={client.id} className="p-2 border border-green-200 dark:border-green-800 rounded bg-green-50/50 dark:bg-green-950/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium flex items-center gap-1">
                            <Car className="w-3 h-3 text-green-600" /> {client.label}
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => removeClient(client.id)} className="h-6 w-6 p-0">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Puissance/borne</Label>
                            <Select
                              value={String(client.borneVEConfig?.puissanceParBorne_kVA || 11)}
                              onValueChange={(v) => {
                                const updated = [...formData.clients];
                                const pBorne = parseInt(v);
                                const nBornes = updated[index].borneVEConfig?.nombreBornes || 1;
                                updated[index] = {
                                  ...updated[index],
                                  borneVEConfig: { ...updated[index].borneVEConfig!, puissanceParBorne_kVA: pBorne },
                                  S_kVA: nBornes * pBorne,
                                };
                                setFormData({ ...formData, clients: updated });
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="11">11 kVA</SelectItem>
                                <SelectItem value="22">22 kVA</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[10px]">Nb bornes</Label>
                            <Input
                              type="number" min={1} max={4} className="h-7 text-xs"
                              value={client.borneVEConfig?.nombreBornes || 1}
                              onChange={(e) => {
                                const updated = [...formData.clients];
                                const nBornes = Math.max(1, Math.min(4, parseInt(e.target.value) || 1));
                                const pBorne = updated[index].borneVEConfig?.puissanceParBorne_kVA || 11;
                                updated[index] = {
                                  ...updated[index],
                                  borneVEConfig: { ...updated[index].borneVEConfig!, nombreBornes: nBornes },
                                  S_kVA: nBornes * pBorne,
                                };
                                setFormData({ ...formData, clients: updated });
                              }}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Raccordement (kVA)</Label>
                            <Input
                              type="number" className="h-7 text-xs"
                              value={client.S_kVA}
                              onChange={(e) => {
                                const updated = [...formData.clients];
                                updated[index].S_kVA = parseFloat(e.target.value) || 0;
                                setFormData({ ...formData, clients: updated });
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">cos φ</Label>
                            <Input
                              type="number" step={0.01} min={0.8} max={1} className="h-7 text-xs"
                              value={client.borneVEConfig?.cosPhi || 0.95}
                              onChange={(e) => {
                                const updated = [...formData.clients];
                                updated[index] = {
                                  ...updated[index],
                                  borneVEConfig: { ...updated[index].borneVEConfig!, cosPhi: parseFloat(e.target.value) || 0.95 },
                                };
                                setFormData({ ...formData, clients: updated });
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          Tétraphasé 400V — {client.borneVEConfig?.nombreBornes || 1} borne(s) × {client.borneVEConfig?.puissanceParBorne_kVA || 11} kVA — Raccordement : {client.S_kVA} kVA
                        </div>
                      </div>
                    ) : (
                      /* Charge standard */
                      <div key={client.id} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Input
                            placeholder="Nom"
                            value={client.label}
                            onChange={(e) => {
                              const updated = [...formData.clients];
                              updated[index].label = e.target.value;
                              setFormData({ ...formData, clients: updated });
                            }}
                          />
                        </div>
                        <div className="w-20">
                          <Input
                            type="number"
                            placeholder="kVA"
                            value={client.S_kVA}
                            onChange={(e) => {
                              const updated = [...formData.clients];
                              updated[index].S_kVA = parseFloat(e.target.value) || 0;
                              setFormData({ ...formData, clients: updated });
                            }}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => removeClient(client.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )
                  ))}
                </CardContent>
              </Card>

              {/* Productions */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    Productions PV
                    <Button size="sm" variant="outline" onClick={addProduction}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {formData.productions?.map((prod: ProductionPV, index: number) => (
                    <div key={prod.id} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Input
                          placeholder="Nom"
                          value={prod.label}
                          onChange={(e) => {
                            const updated = [...formData.productions];
                            updated[index].label = e.target.value;
                            setFormData({ ...formData, productions: updated });
                          }}
                        />
                      </div>
                      <div className="w-20">
                        <Input
                          type="number"
                          placeholder="kVA"
                          value={prod.S_kVA}
                          onChange={(e) => {
                            const updated = [...formData.productions];
                            updated[index].S_kVA = parseFloat(e.target.value) || 0;
                            setFormData({ ...formData, productions: updated });
                          }}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeProduction(prod.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                 </CardContent>
               </Card>

               {/* Récapitulatif des puissances totales */}
               {(manualChargeTotal > 0 || linkedChargeTotal > 0 || manualProductionTotal > 0 || linkedProductionTotal > 0) && (
                 <Card className="bg-primary/5 border-primary/20">
                   <CardHeader className="pb-3">
                     <CardTitle className="text-base">📊 Puissances totales du nœud</CardTitle>
                   </CardHeader>
                   <CardContent className="space-y-2 text-sm">
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <div className="font-medium mb-1">Charges:</div>
                         <div className="space-y-1 text-muted-foreground">
                           <div>Manuel: {manualChargeTotal.toFixed(1)} kVA</div>
                           <div>Importé: {linkedChargeTotal.toFixed(1)} kVA</div>
                         </div>
                         <div className="font-bold mt-1 text-foreground">
                           Total: {(manualChargeTotal + linkedChargeTotal).toFixed(1)} kVA
                         </div>
                       </div>
                       <div>
                         <div className="font-medium mb-1">Productions:</div>
                         <div className="space-y-1 text-muted-foreground">
                           <div>Manuel: {manualProductionTotal.toFixed(1)} kVA</div>
                           <div>Importé: {linkedProductionTotal.toFixed(1)} kVA</div>
                         </div>
                         <div className="font-bold mt-1 text-foreground">
                           Total: {(manualProductionTotal + linkedProductionTotal).toFixed(1)} kVA
                         </div>
                       </div>
                     </div>
                   </CardContent>
                 </Card>
               )}

                {/* Composantes de séquence (U1/U2/U0, ku%) */}
                {selectedNode && <NodePhaseDisplay nodeId={selectedNode.id} />}

                {/* Tensions extrêmes des clients liés */}
               {linkedClients.length > 0 && (extremeTensions.hasMinData || extremeTensions.hasMaxData) && (
                 <Card className="bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                   <CardHeader className="pb-3">
                     <CardTitle className="text-base flex items-center gap-2">
                       <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                       ⚡ Tensions mesurées (clients liés)
                     </CardTitle>
                   </CardHeader>
                   <CardContent className="space-y-2 text-sm">
                     <div className="text-xs text-muted-foreground mb-2">
                       Valeurs extrêmes parmi les {linkedClients.length} client(s) lié(s)
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                       {extremeTensions.hasMinData && extremeTensions.minVoltage !== Infinity && (
                         <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded">
                           <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">
                             Tension Min
                           </div>
                           <div className="text-lg font-bold text-blue-900 dark:text-blue-100">
                             {extremeTensions.minVoltage.toFixed(1)} V
                           </div>
                           <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                             Plus basse mesurée
                           </div>
                         </div>
                       )}
                       {extremeTensions.hasMaxData && extremeTensions.maxVoltage !== -Infinity && (
                         <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded">
                           <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">
                             Tension Max
                           </div>
                           <div className="text-lg font-bold text-red-900 dark:text-red-100">
                             {extremeTensions.maxVoltage.toFixed(1)} V
                           </div>
                           <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                             Plus haute mesurée
                           </div>
                         </div>
                       )}
                     </div>
                     
                     {/* Optionnel : Afficher l'écart de tension */}
                     {extremeTensions.hasMinData && extremeTensions.hasMaxData && 
                      extremeTensions.minVoltage !== Infinity && extremeTensions.maxVoltage !== -Infinity && (
                       <div className="pt-2 border-t mt-2">
                         <div className="flex justify-between items-center">
                           <span className="text-xs text-muted-foreground">Écart:</span>
                           <span className="font-mono font-medium">
                             {(extremeTensions.maxVoltage - extremeTensions.minVoltage).toFixed(1)} V
                           </span>
                         </div>
                       </div>
                     )}
                   </CardContent>
                 </Card>
              )}

              {/* Mode mixte mono/polyphasé - affichage info seulement */}
              {currentProject?.loadModel === 'mixte_mono_poly' && selectedNode?.autoPhaseDistribution && (
                <Card className="bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">⚡ Mode mixte</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Checkbox charges manuelles MONO */}
                    <div className="flex items-start space-x-2">
                      <input
                        type="checkbox"
                        id="manualLoadTypeMono"
                        checked={formData.manualLoadType === 'MONO'}
                        onChange={(e) => setFormData({
                          ...formData,
                          manualLoadType: e.target.checked ? 'MONO' : 'POLY'
                        })}
                        className="mt-1 rounded border-gray-300"
                      />
                      <div className="flex-1">
                        <Label htmlFor="manualLoadTypeMono" className="text-sm font-medium cursor-pointer">
                          Charges manuelles monophasées
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Les charges/productions manuelles suivront le déséquilibre défini dans la configuration du projet.
                        </p>
                      </div>
                    </div>
                    
                    {/* Distribution de phase (lecture seule) */}
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-sm font-medium">📊 Analyse de phase (automatique)</Label>
                      
                      <div className="text-xs space-y-2 p-3 bg-background rounded border">
                        <div>
                          <div className="font-medium text-purple-700 dark:text-purple-300 mb-1">Charges:</div>
                          <div className="ml-2 space-y-0.5 font-mono">
                            <div className="text-muted-foreground">
                              MONO: A={selectedNode.autoPhaseDistribution.charges.mono.A.toFixed(1)} kVA, 
                              B={selectedNode.autoPhaseDistribution.charges.mono.B.toFixed(1)} kVA, 
                              C={selectedNode.autoPhaseDistribution.charges.mono.C.toFixed(1)} kVA
                            </div>
                            <div className="text-muted-foreground">
                              TRI/TÉTRA: A={selectedNode.autoPhaseDistribution.charges.poly.A.toFixed(1)} kVA, 
                              B={selectedNode.autoPhaseDistribution.charges.poly.B.toFixed(1)} kVA, 
                              C={selectedNode.autoPhaseDistribution.charges.poly.C.toFixed(1)} kVA
                            </div>
                            <div className="font-semibold text-foreground">
                              Total: A={selectedNode.autoPhaseDistribution.charges.total.A.toFixed(1)} kVA, 
                              B={selectedNode.autoPhaseDistribution.charges.total.B.toFixed(1)} kVA, 
                              C={selectedNode.autoPhaseDistribution.charges.total.C.toFixed(1)} kVA
                            </div>
                          </div>
                        </div>
                        
                        <div className="pt-2 border-t">
                          <div className="font-medium text-purple-700 dark:text-purple-300 mb-1">Clients MONO par phase:</div>
                          <div className="ml-2 font-mono text-muted-foreground">
                            A: {selectedNode.autoPhaseDistribution.monoClientsCount.A}, 
                            B: {selectedNode.autoPhaseDistribution.monoClientsCount.B}, 
                            C: {selectedNode.autoPhaseDistribution.monoClientsCount.C}
                          </div>
                        </div>
                        
                        <div className="pt-2 border-t">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-purple-700 dark:text-purple-300">Déséquilibre nœud:</span>
                            <span className={`font-bold ${
                              (selectedNode.autoPhaseDistribution.unbalancePercent || 0) < 10 ? 'text-green-600 dark:text-green-400' :
                              (selectedNode.autoPhaseDistribution.unbalancePercent || 0) < 20 ? 'text-yellow-600 dark:text-yellow-400' :
                              'text-red-600 dark:text-red-400'
                            }`}>
                              {(selectedNode.autoPhaseDistribution.unbalancePercent || 0).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

                {/* Tension Cible */}
                {!selectedNode?.isSource && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Tension Cible
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="tension-cible">Tension cible (V)</Label>
                        <div className="flex gap-2">
                          <Input
                            id="tension-cible"
                            type="number"
                            placeholder="Ex: 230"
                            value={formData.tensionCible || ''}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              tensionCible: parseFloat(e.target.value) || undefined 
                            })}
                          />
                          {formData.tensionCible && (
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (selectedNodeId && formData.tensionCible) {
                                  calculateWithTargetVoltage(selectedNodeId, formData.tensionCible);
                                }
                              }}
                            >
                              Ajuster
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Ajuste automatiquement le foisonnement des charges pour atteindre cette tension
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
             </>
           )}

          {/* Cable editing */}
          {editTarget === 'cable' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="cable-name">Nom du câble</Label>
                <Input
                  id="cable-name"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cable-type">Type de câble</Label>
                <Select
                  value={formData.typeId}
                  onValueChange={(value) => setFormData({ ...formData, typeId: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentProject?.cableTypes?.map(type => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.label}
                      </SelectItem>
                    )) || []}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cable-pose">Type de pose</Label>
                <Select
                  value={formData.pose}
                  onValueChange={(value) => setFormData({ ...formData, pose: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentProject?.cableTypes
                      ?.find(t => t.id === formData.typeId)
                      ?.posesPermises?.map(pose => (
                        <SelectItem key={pose} value={pose}>
                          {pose}
                        </SelectItem>
                      )) || []}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Project editing */}
          {editTarget === 'project' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="project-name">Nom du projet</Label>
                <Input
                  id="project-name"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="voltage-system">Système de tension</Label>
                <Select
                  value={formData.voltageSystem}
                  onValueChange={(value) => setFormData({ ...formData, voltageSystem: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRIPHASÉ_230V">Triphasé 230V</SelectItem>
                    <SelectItem value="TÉTRAPHASÉ_400V">Tétraphasé 400V</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Facteurs de puissance séparés */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Facteurs de puissance (cos φ)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cos-phi-charges">Cos φ Charges (Consommation)</Label>
                    <Input
                      id="cos-phi-charges"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={formData.cosPhiCharges ?? formData.cosPhi ?? 0.95}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        cosPhiCharges: parseFloat(e.target.value) || 0.95,
                        cosPhi: parseFloat(e.target.value) || 0.95 // Synchroniser pour rétrocompatibilité
                      })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Facteur de puissance des charges. Par défaut: 0.95 (inductif)
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cos-phi-productions">Cos φ Productions (PV/Cogen)</Label>
                    <Input
                      id="cos-phi-productions"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={formData.cosPhiProductions ?? 1.00}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        cosPhiProductions: parseFloat(e.target.value) || 1.00 
                      })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Facteur de puissance des productions. Par défaut: 1.00 (unitaire)
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
                    <strong>Impact sur les calculs:</strong><br />
                    • Charges: Q = P × tan(acos(cos φ)) → Q réactif consommé<br />
                    • Productions: cos φ = 1 → Q = 0 (injection purement active)
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <Label htmlFor="foisonnement-charges">Foisonnement charges (%)</Label>
                <Input
                  id="foisonnement-charges"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.foisonnementCharges || 100}
                  onChange={(e) => setFormData({ ...formData, foisonnementCharges: parseFloat(e.target.value) || 100 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="foisonnement-productions">Foisonnement productions (%)</Label>
                <Input
                  id="foisonnement-productions"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.foisonnementProductions || 100}
                  onChange={(e) => setFormData({ ...formData, foisonnementProductions: parseFloat(e.target.value) || 100 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="default-charge">Charge par défaut (kVA)</Label>
                <Input
                  id="default-charge"
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.defaultChargeKVA || 5}
                  onChange={(e) => setFormData({ ...formData, defaultChargeKVA: parseFloat(e.target.value) || 5 })}
                />
                <p className="text-xs text-muted-foreground">
                  Charge appliquée par défaut aux nouveaux nœuds
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="default-production">Production par défaut (kVA)</Label>
                <Input
                  id="default-production"
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.defaultProductionKVA || 5}
                  onChange={(e) => setFormData({ ...formData, defaultProductionKVA: parseFloat(e.target.value) || 5 })}
                />
                <p className="text-xs text-muted-foreground">
                  Production PV appliquée par défaut aux nouveaux nœuds
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="empty-nodes"
                    checked={formData.addEmptyNodeByDefault || false}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      addEmptyNodeByDefault: e.target.checked 
                    })}
                    className="rounded border-input"
                  />
                  <Label htmlFor="empty-nodes" className="cursor-pointer font-normal">
                    Ajouter des nœuds vierges par défaut
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Si activé, les nouveaux nœuds n'auront ni charge ni production par défaut
                </p>
              </div>

              {/* Option pour les petites productions TRI/TETRA */}
              {formData.loadModel === 'mixte_mono_poly' && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="treat-small-poly-productions"
                      checked={formData.treatSmallPolyProductionsAsMono || false}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        treatSmallPolyProductionsAsMono: e.target.checked 
                      })}
                      className="rounded border-input"
                    />
                    <Label htmlFor="treat-small-poly-productions" className="cursor-pointer font-normal">
                      Production TRI/Tétra ≤5 kVA : mono
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Les productions PV des clients TRI/TÉTRA ≤5 kVA sont réparties comme des productions MONO (100% sur une phase en 400V, 50/50 en 230V). Les charges restent en répartition 33.33%.
                  </p>
                </div>
              )}

              {/* Configuration Modèle de Charge */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Network className="w-4 h-4" />
                    Modèle de Charge
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="load-model">Type de modèle</Label>
                    <Select
                      value={formData.loadModel || 'mixte_mono_poly'}
                      onValueChange={(value: LoadModel) => setFormData({ ...formData, loadModel: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="polyphase_equilibre">Polyphasé équilibré (ancien)</SelectItem>
                        <SelectItem value="monophase_reparti">Monophasé réparti (ancien)</SelectItem>
                        <SelectItem value="mixte_mono_poly">Mixte mono/polyphasé ✨ (recommandé)</SelectItem>
                      </SelectContent>
                    </Select>
                    {formData.loadModel === 'mixte_mono_poly' && (
                      <p className="text-xs text-muted-foreground">
                        Les clients MONO sont répartis automatiquement sur les phases. Le déséquilibre manuel s'applique aux clients MONO + charges manuelles.
                      </p>
                    )}
                    {formData.loadModel !== 'mixte_mono_poly' && (
                      <p className="text-xs text-muted-foreground">
                        Mode équilibré: calcul simplifié triphasé. Mode réparti: calcul complet par phase avec déséquilibre possible.
                      </p>
                    )}
                  </div>

                  {formData.loadModel === 'monophase_reparti' && (
                    <div className="space-y-2">
                      <Label htmlFor="desequilibre">Taux de déséquilibre (%)</Label>
                      <Input
                        id="desequilibre"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={formData.desequilibrePourcent || 0}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          desequilibrePourcent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0))
                        })}
                      />
                      <p className="text-xs text-muted-foreground">
                        0% = équilibré (33,3% par phase). Plus élevé = plus de charge sur la phase A, moins sur B et C.
                      </p>
                      {formData.desequilibrePourcent > 0 && (
                        <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
                          <strong>Répartition avec {formData.desequilibrePourcent}% :</strong><br />
                          • Phase A : {((1/3) * (1 + (formData.desequilibrePourcent || 0)/100) * 100).toFixed(1)}%<br />
                          • Phase B/C : {((1 - (1/3) * (1 + (formData.desequilibrePourcent || 0)/100))/2 * 100).toFixed(1)}% chacune
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-4">
            <Button onClick={handleSave} className="flex-1">
              Sauvegarder
            </Button>
            {(editTarget === 'node' || editTarget === 'cable') && (
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};