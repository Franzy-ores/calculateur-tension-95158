import { useState, useEffect, useRef } from 'react';
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
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DailyProfileConfig } from '@/types/dailyProfile';
import { AlertTriangle, RotateCcw, Save, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
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
  const [globalMultiplier, setGlobalMultiplier] = useState(100);
  const [targetProfile, setTargetProfile] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setJsonText(JSON.stringify(profiles, null, 2));
      setError(null);
      setGlobalMultiplier(100);
    }
  }, [open, profiles]);

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText) as DailyProfileConfig;
      
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

  const handleExport = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `profils-24h-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Profils exportés avec succès');
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          JSON.parse(content);
          setJsonText(content);
          setError(null);
          toast.success('Profils importés avec succès');
        } catch {
          toast.error('Fichier JSON invalide');
        }
      };
      reader.readAsText(file);
    }
    if (event.target) event.target.value = '';
  };

  const applyGlobalMultiplier = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const multiplier = globalMultiplier / 100;
      const seasons = ['winter', 'summer'];
      const profileKeys = targetProfile === 'all' 
        ? ['residential', 'pv', 'ev', 'industrial_pme']
        : [targetProfile];

      seasons.forEach(season => {
        profileKeys.forEach(profileKey => {
          if (parsed.profiles?.[season]?.[profileKey]) {
            Object.keys(parsed.profiles[season][profileKey]).forEach(hour => {
              const originalValue = parsed.profiles[season][profileKey][hour];
              const newValue = Math.max(0, Math.min(100, Math.round(originalValue * multiplier)));
              parsed.profiles[season][profileKey][hour] = newValue;
            });
          }
        });
      });

      setJsonText(JSON.stringify(parsed, null, 2));
      setError(null);
      toast.success(`Multiplicateur ×${multiplier.toFixed(1)} appliqué`);
    } catch {
      setError('Erreur lors de l\'application du multiplicateur');
    }
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

          {/* Section ajustement global */}
          <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
            <Label className="text-sm font-medium">Ajustement global</Label>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Profil cible</Label>
                <Select value={targetProfile} onValueChange={setTargetProfile}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les profils</SelectItem>
                    <SelectItem value="residential">Résidentiel</SelectItem>
                    <SelectItem value="pv">Production PV</SelectItem>
                    <SelectItem value="ev">Véhicules électriques</SelectItem>
                    <SelectItem value="industrial_pme">Industriel/PME</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Multiplicateur : ×{(globalMultiplier / 100).toFixed(1)}
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">10%</span>
                  <Slider
                    value={[globalMultiplier]}
                    onValueChange={([v]) => setGlobalMultiplier(v)}
                    min={10}
                    max={200}
                    step={5}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground">200%</span>
                </div>
              </div>
            </div>
            
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={applyGlobalMultiplier}
              className="w-full"
            >
              Appliquer le multiplicateur
            </Button>
          </div>

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
            className="flex-1 min-h-[250px] font-mono text-xs"
            placeholder="Configuration JSON des profils..."
          />
        </div>

        <DialogFooter className="flex flex-row justify-between gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1">
              <Download className="h-4 w-4" />
              Exporter
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => fileInputRef.current?.click()} 
              className="gap-1"
            >
              <Upload className="h-4 w-4" />
              Importer
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
          
          <div className="flex gap-2">
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
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
