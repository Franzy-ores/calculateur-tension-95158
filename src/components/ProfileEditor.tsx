import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DailyProfileConfig } from '@/types/dailyProfile';
import { AlertTriangle, RotateCcw, Save } from 'lucide-react';
import defaultProfiles from '@/data/hourlyProfiles.json';

interface ProfileEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: DailyProfileConfig;
  onSave: (profiles: DailyProfileConfig) => void;
}

export const ProfileEditor = ({ open, onOpenChange, profiles, onSave }: ProfileEditorProps) => {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setJsonText(JSON.stringify(profiles, null, 2));
      setError(null);
    }
  }, [open, profiles]);

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText) as DailyProfileConfig;
      
      // Validation basique
      if (!parsed.profiles?.winter || !parsed.profiles?.summer) {
        throw new Error('Les profils "winter" et "summer" sont requis');
      }
      if (!parsed.profiles.winter.residential || !parsed.profiles.winter.pv) {
        throw new Error('Les profils "residential" et "pv" sont requis pour chaque saison');
      }
      if (!parsed.weatherFactors) {
        throw new Error('Les facteurs météo sont requis');
      }

      onSave(parsed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON invalide');
    }
  };

  const handleReset = () => {
    setJsonText(JSON.stringify(defaultProfiles, null, 2));
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Éditer les profils horaires</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-3">
          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Les valeurs sont en pourcentage (0-100) pour chaque heure (0-23)</p>
            <p>• <strong>residential</strong>: profil de consommation résidentielle</p>
            <p>• <strong>pv</strong>: profil de production photovoltaïque</p>
            <p>• <strong>ev</strong>: profil de recharge véhicules électriques</p>
            <p>• <strong>industrial_pme</strong>: profil industriel/PME</p>
          </div>

          <Textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="flex-1 min-h-[300px] font-mono text-xs"
            placeholder="Configuration JSON des profils..."
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReset} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Réinitialiser
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            Sauvegarder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
