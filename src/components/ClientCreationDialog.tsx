import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNetworkStore } from '@/store/networkStore';
import { ClientConnectionType, ClientType } from '@/types/network';
import { MapPin, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ClientCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ClientCreationDialog = ({ open, onOpenChange }: ClientCreationDialogProps) => {
  const { 
    addClientManual,
    selectingLocationForNewClient,
    pendingClientLocation,
    startClientLocationSelection,
    cancelClientLocationSelection,
    clearPendingClientLocation,
  } = useNetworkStore();
  
  const [nomCircuit, setNomCircuit] = useState('');
  const [clientType, setClientType] = useState<ClientType>('résidentiel');
  const [connectionType, setConnectionType] = useState<ClientConnectionType>('MONO');
  const [puissanceCharge, setPuissanceCharge] = useState(5);
  const [puissanceProduction, setPuissanceProduction] = useState(0);

  // Réinitialiser le formulaire à l'ouverture
  useEffect(() => {
    console.log('[DEBUG Dialog] useEffect open:', open);
    if (open) {
      console.log('[DEBUG Dialog] Resetting form');
      setNomCircuit('');
      setClientType('résidentiel');
      setConnectionType('MONO');
      setPuissanceCharge(5);
      setPuissanceProduction(0);
      clearPendingClientLocation();
      cancelClientLocationSelection();
    }
  }, [open, clearPendingClientLocation, cancelClientLocationSelection]);

  // Log quand la location est reçue
  useEffect(() => {
    if (pendingClientLocation) {
      console.log('[DEBUG Dialog] pendingClientLocation updated:', pendingClientLocation);
    }
  }, [pendingClientLocation]);

  const handleSelectLocation = () => {
    console.log('[DEBUG Dialog] handleSelectLocation called - using store');
    startClientLocationSelection();
    toast.info('Cliquez sur la carte pour positionner le nouveau client');
  };

  const handleCreate = () => {
    if (!nomCircuit.trim()) {
      toast.error('Veuillez entrer un nom pour le client');
      return;
    }
    
    if (!pendingClientLocation) {
      toast.error('Veuillez sélectionner une position sur la carte');
      return;
    }
    
    addClientManual({
      nomCircuit: nomCircuit.trim(),
      puissanceContractuelle_kVA: puissanceCharge,
      puissancePV_kVA: puissanceProduction,
      lat: pendingClientLocation.lat,
      lng: pendingClientLocation.lng,
      clientType,
      connectionType,
    });
    
    clearPendingClientLocation();
    onOpenChange(false);
  };

  const handleCancel = () => {
    cancelClientLocationSelection();
    clearPendingClientLocation();
    onOpenChange(false);
  };

  // Fermer avec ESC
  useEffect(() => {
    if (!open) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectingLocationForNewClient) {
          cancelClientLocationSelection();
        } else {
          handleCancel();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, selectingLocationForNewClient, cancelClientLocationSelection]);

  console.log('[DEBUG Dialog] RENDER - open:', open, 'selecting:', selectingLocationForNewClient, 'location:', pendingClientLocation);

  if (!open) return null;

  return (
    <>
      {/* Overlay - seulement quand pas en sélection */}
      {!selectingLocationForNewClient && (
        <div 
          className="fixed inset-0 bg-black/50 z-[100]"
          onClick={handleCancel}
        />
      )}
      
      {/* Dialog box - custom */}
      <div 
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101]",
          "bg-background border border-border rounded-lg shadow-xl",
          "w-full max-w-md p-6",
          "transition-all duration-200",
          selectingLocationForNewClient && "opacity-0 pointer-events-none scale-95"
        )}
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
              <SelectContent className="bg-popover border-border z-[102]">
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
              <SelectContent className="bg-popover border-border z-[102]">
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
            {pendingClientLocation ? (
              <div className="text-sm text-muted-foreground bg-muted p-2 rounded">
                <div>Latitude: {pendingClientLocation.lat.toFixed(6)}</div>
                <div>Longitude: {pendingClientLocation.lng.toFixed(6)}</div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune position sélectionnée</p>
            )}
            
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSelectLocation}
              disabled={selectingLocationForNewClient}
            >
              <MapPin className="w-4 h-4 mr-2" />
              {selectingLocationForNewClient ? 'Cliquez sur la carte...' : '📍 Sélectionner sur la carte'}
            </Button>
            
            {selectingLocationForNewClient && (
              <p className="text-xs text-amber-600">
                ⚡ Cliquez sur la carte pour positionner le client. Appuyez sur ESC pour annuler.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={handleCancel}>
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={!nomCircuit.trim() || !pendingClientLocation}>
            Créer
          </Button>
        </div>
      </div>
    </>
  );
};
