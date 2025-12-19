import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';
import { ClientConnectionType, ClientType } from '@/types/network';
import { MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ClientCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ClientCreationDialog = ({ open, onOpenChange }: ClientCreationDialogProps) => {
  const { addClientManual } = useNetworkStore();
  
  const [nomCircuit, setNomCircuit] = useState('');
  const [clientType, setClientType] = useState<ClientType>('résidentiel');
  const [connectionType, setConnectionType] = useState<ClientConnectionType>('MONO');
  const [puissanceCharge, setPuissanceCharge] = useState(5);
  const [puissanceProduction, setPuissanceProduction] = useState(0);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [isSelectingLocation, setIsSelectingLocation] = useState(false);

  // Écouter l'événement de sélection de position
  useEffect(() => {
    if (!isSelectingLocation) return;
    
    const handleLocationSelected = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { lat: selectedLat, lng: selectedLng } = customEvent.detail;
      
      setLat(selectedLat);
      setLng(selectedLng);
      setIsSelectingLocation(false);
      
      toast.success('Position sélectionnée');
    };
    
    const handleLocationCancelled = () => {
      setIsSelectingLocation(false);
    };
    
    window.addEventListener('locationSelectedForNewClient', handleLocationSelected);
    window.addEventListener('cancelNewClientLocationSelection', handleLocationCancelled);
    
    return () => {
      window.removeEventListener('locationSelectedForNewClient', handleLocationSelected);
      window.removeEventListener('cancelNewClientLocationSelection', handleLocationCancelled);
    };
  }, [isSelectingLocation]);

  // Réinitialiser le formulaire à l'ouverture
  useEffect(() => {
    if (open) {
      setNomCircuit('');
      setClientType('résidentiel');
      setConnectionType('MONO');
      setPuissanceCharge(5);
      setPuissanceProduction(0);
      setLat(null);
      setLng(null);
      setIsSelectingLocation(false);
    }
  }, [open]);

  const handleSelectLocation = () => {
    setIsSelectingLocation(true);
    window.dispatchEvent(new CustomEvent('startNewClientLocationSelection'));
  };

  const handleCreate = () => {
    if (!nomCircuit.trim()) {
      toast.error('Veuillez entrer un nom pour le client');
      return;
    }
    
    if (lat === null || lng === null) {
      toast.error('Veuillez sélectionner une position sur la carte');
      return;
    }
    
    addClientManual({
      nomCircuit: nomCircuit.trim(),
      puissanceContractuelle_kVA: puissanceCharge,
      puissancePV_kVA: puissanceProduction,
      lat,
      lng,
      clientType,
      connectionType,
    });
    
    onOpenChange(false);
  };

  const handleCancel = () => {
    if (isSelectingLocation) {
      window.dispatchEvent(new CustomEvent('cancelNewClientLocationSelection'));
    }
    onOpenChange(false);
  };

  // Gérer la fermeture du dialog - bloquer pendant la sélection de position
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isSelectingLocation) {
      return; // Bloquer la fermeture pendant la sélection
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className={cn(
          "sm:max-w-md transition-opacity duration-200",
          isSelectingLocation && "opacity-0 pointer-events-none"
        )}
      >
        <DialogHeader>
          <DialogTitle>Créer un nouveau client</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nomCircuit">Nom du client</Label>
            <Input
              id="nomCircuit"
              value={nomCircuit}
              onChange={(e) => setNomCircuit(e.target.value)}
              placeholder="Ex: Client 1"
            />
          </div>

          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label htmlFor="connectionType">Type de couplage</Label>
            <Select value={connectionType} onValueChange={(v: ClientConnectionType) => setConnectionType(v)}>
              <SelectTrigger id="connectionType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="MONO">Monophasé (MONO)</SelectItem>
                <SelectItem value="TRI">Triphasé (TRI)</SelectItem>
                <SelectItem value="TETRA">Tétraphasé (TETRA)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="puissanceCharge">Puissance charge (kVA)</Label>
              <Input
                id="puissanceCharge"
                type="number"
                min="0"
                step="0.1"
                value={puissanceCharge}
                onChange={(e) => setPuissanceCharge(parseFloat(e.target.value) || 0)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="puissanceProduction">Puissance production (kVA)</Label>
              <Input
                id="puissanceProduction"
                type="number"
                min="0"
                step="0.1"
                value={puissanceProduction}
                onChange={(e) => setPuissanceProduction(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Position sur la carte</Label>
            {lat !== null && lng !== null ? (
              <div className="text-sm text-muted-foreground bg-muted p-2 rounded">
                <div>Latitude: {lat.toFixed(6)}</div>
                <div>Longitude: {lng.toFixed(6)}</div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune position sélectionnée</p>
            )}
            
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSelectLocation}
              disabled={isSelectingLocation}
            >
              <MapPin className="w-4 h-4 mr-2" />
              {isSelectingLocation ? 'Cliquez sur la carte...' : '📍 Sélectionner sur la carte'}
            </Button>
            
            {isSelectingLocation && (
              <p className="text-xs text-amber-600">
                ⚡ Cliquez sur la carte pour positionner le client. Appuyez sur ESC pour annuler.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={!nomCircuit.trim() || lat === null || lng === null}>
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
