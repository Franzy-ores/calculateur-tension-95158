import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';
import { ClientConnectionType, ClientType } from '@/types/network';
import { MapPin, X } from 'lucide-react';
import { toast } from 'sonner';

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
  const [isSelectingLocation, setIsSelectingLocation] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{lat: number; lng: number} | null>(null);

  // Réinitialiser le formulaire à l'ouverture
  useEffect(() => {
    if (open) {
      setNomCircuit('');
      setClientType('résidentiel');
      setConnectionType('MONO');
      setPuissanceCharge(5);
      setPuissanceProduction(0);
      setSelectedLocation(null);
      setIsSelectingLocation(false);
    }
  }, [open]);

  // Écouter l'événement de sélection de position (comme ClientEditPanel)
  useEffect(() => {
    if (!isSelectingLocation) return;
    
    const handleLocationSelected = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { lat, lng } = customEvent.detail;
      setSelectedLocation({ lat, lng });
      setIsSelectingLocation(false);
      toast.success('Position sélectionnée');
    };
    
    window.addEventListener('locationSelectedForClient', handleLocationSelected);
    
    return () => {
      window.removeEventListener('locationSelectedForClient', handleLocationSelected);
    };
  }, [isSelectingLocation]);

  // Nettoyer le mode sélection si on ferme le dialog
  useEffect(() => {
    return () => {
      if (isSelectingLocation) {
        window.dispatchEvent(new CustomEvent('cancelClientMove'));
      }
    };
  }, [isSelectingLocation]);

  // Gérer ESC pour annuler la sélection ou fermer le dialog
  useEffect(() => {
    if (!open) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSelectingLocation) {
          setIsSelectingLocation(false);
          window.dispatchEvent(new CustomEvent('cancelClientMove'));
          toast.info('Sélection annulée');
        } else {
          handleCancel();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isSelectingLocation]);

  const handleSelectLocation = () => {
    setIsSelectingLocation(true);
    window.dispatchEvent(new CustomEvent('startClientMove'));
  };

  const handleCreate = () => {
    if (!nomCircuit.trim()) {
      toast.error('Veuillez entrer un nom pour le client');
      return;
    }
    
    if (!selectedLocation) {
      toast.error('Veuillez sélectionner une position sur la carte');
      return;
    }
    
    addClientManual({
      nomCircuit: nomCircuit.trim(),
      puissanceContractuelle_kVA: puissanceCharge,
      puissancePV_kVA: puissanceProduction,
      lat: selectedLocation.lat,
      lng: selectedLocation.lng,
      clientType,
      connectionType,
    });
    
    onOpenChange(false);
    toast.success('Client créé');
  };

  const handleCancel = () => {
    if (isSelectingLocation) {
      window.dispatchEvent(new CustomEvent('cancelClientMove'));
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-[2000]"
        onClick={handleCancel}
      />
      
      <div 
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[2001] bg-background border border-border rounded-lg shadow-xl w-full max-w-md p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Créer un nouveau client</h2>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleCancel}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Content */}
        <div className="space-y-4">
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
              <SelectContent className="bg-popover border-border z-[2002]">
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
              <SelectContent className="bg-popover border-border z-[2002]">
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
            {selectedLocation ? (
              <div className="text-sm text-muted-foreground bg-muted p-2 rounded">
                <div>Latitude: {selectedLocation.lat.toFixed(6)}</div>
                <div>Longitude: {selectedLocation.lng.toFixed(6)}</div>
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
              <p className="text-xs text-amber-600 mt-2">
                ⚡ Cliquez sur la carte pour définir la position du client. Appuyez sur ESC pour annuler.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={handleCancel}>
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={!nomCircuit.trim() || !selectedLocation}>
            Créer
          </Button>
        </div>
      </div>
    </>
  );
};
