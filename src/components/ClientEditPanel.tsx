import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';
import { ClientCouplage } from '@/types/network';
import { toast } from 'sonner';

export const ClientEditPanel = () => {
  const { currentProject, selectedClientId, updateClientImporte, closeEditPanel } = useNetworkStore();
  
  const client = currentProject?.clientsImportes?.find(c => c.id === selectedClientId);

  const [nomCircuit, setNomCircuit] = useState('');
  const [identifiantCircuit, setIdentifiantCircuit] = useState('');
  const [puissanceContractuelle, setPuissanceContractuelle] = useState(0);
  const [puissancePV, setPuissancePV] = useState(0);
  const [couplage, setCouplage] = useState<ClientCouplage>('TRI');
  const [tensionMin, setTensionMin] = useState<number | undefined>(undefined);
  const [tensionMax, setTensionMax] = useState<number | undefined>(undefined);
  const [tensionMoyenne, setTensionMoyenne] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (client) {
      setNomCircuit(client.nomCircuit);
      setIdentifiantCircuit(client.identifiantCircuit);
      setPuissanceContractuelle(client.puissanceContractuelle_kVA);
      setPuissancePV(client.puissancePV_kVA);
      setCouplage(client.couplage);
      setTensionMin(client.tensionMin_V);
      setTensionMax(client.tensionMax_V);
      setTensionMoyenne(client.tensionMoyenne_V);
    }
  }, [client]);

  if (!client) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">Aucun client sélectionné</p>
      </div>
    );
  }

  const handleSave = () => {
    updateClientImporte(client.id, {
      nomCircuit,
      identifiantCircuit,
      puissanceContractuelle_kVA: puissanceContractuelle,
      puissancePV_kVA: puissancePV,
      couplage,
      tensionMin_V: tensionMin,
      tensionMax_V: tensionMax,
      tensionMoyenne_V: tensionMoyenne,
    });
    
    toast.success('Client mis à jour');
    closeEditPanel();
  };

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-semibold">Éditer le Client</h3>

      <div className="space-y-3">
        <div>
          <Label htmlFor="nomCircuit">Nom du circuit</Label>
          <Input
            id="nomCircuit"
            value={nomCircuit}
            onChange={(e) => setNomCircuit(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="identifiantCircuit">Identifiant du circuit</Label>
          <Input
            id="identifiantCircuit"
            value={identifiantCircuit}
            onChange={(e) => setIdentifiantCircuit(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="couplage">Couplage</Label>
          <Select value={couplage} onValueChange={(v: ClientCouplage) => setCouplage(v)}>
            <SelectTrigger id="couplage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TRI">TRI</SelectItem>
              <SelectItem value="MONO">MONO</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="puissanceContractuelle">Puissance contractuelle (kVA)</Label>
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

        <div className="border-t pt-3 mt-3">
          <h4 className="text-sm font-medium mb-2">Tensions mesurées (optionnel)</h4>
          
          <div className="space-y-2">
            <div>
              <Label htmlFor="tensionMin">Tension minimale (V)</Label>
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
              <Label htmlFor="tensionMax">Tension maximale (V)</Label>
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
              <Label htmlFor="tensionMoyenne">Tension moyenne (V)</Label>
              <Input
                id="tensionMoyenne"
                type="number"
                step="0.1"
                value={tensionMoyenne || ''}
                onChange={(e) => setTensionMoyenne(e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Non renseigné"
              />
            </div>
          </div>
        </div>

        <div className="border-t pt-3 mt-3 text-xs text-muted-foreground">
          <p><strong>Position:</strong> {client.lat.toFixed(6)}, {client.lng.toFixed(6)}</p>
          {client.identifiantCabine && <p><strong>Cabine:</strong> {client.identifiantCabine}</p>}
          {client.identifiantPosteSource && <p><strong>Poste source:</strong> {client.identifiantPosteSource}</p>}
        </div>
      </div>

      <div className="flex gap-2 pt-4 border-t">
        <Button onClick={handleSave} className="flex-1">
          Enregistrer
        </Button>
        <Button variant="outline" onClick={closeEditPanel} className="flex-1">
          Annuler
        </Button>
      </div>
    </div>
  );
};
