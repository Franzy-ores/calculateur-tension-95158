import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { HourlySlider } from './HourlySlider';
import { ProfilePreviewChart } from './ProfilePreviewChart';
import { profileTemplates } from '@/data/profileTemplates';
import { DailyProfileConfig } from '@/types/dailyProfile';
import { RotateCcw, Save, Snowflake, Sun, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import defaultProfiles from '@/data/hourlyProfiles.json';

interface ProfileVisualEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: DailyProfileConfig;
  onSave: (profiles: DailyProfileConfig) => void;
}

type Season = 'winter' | 'summer';
type ProfileType = 'residential' | 'pv' | 'industrial_pme';

const PROFILE_LABELS: Record<ProfileType, { label: string; color: string }> = {
  residential: { label: 'Résidentiel', color: '#3b82f6' },
  pv: { label: 'Production PV', color: '#f59e0b' },
  industrial_pme: { label: 'Industriel / PME', color: '#8b5cf6' },
};

export const ProfileVisualEditor = ({
  open,
  onOpenChange,
  profiles,
  onSave,
}: ProfileVisualEditorProps) => {
  const [editedProfiles, setEditedProfiles] = useState<DailyProfileConfig>(profiles);
  const [season, setSeason] = useState<Season>('winter');
  const [profileType, setProfileType] = useState<ProfileType>('residential');
  const [globalMultiplier, setGlobalMultiplier] = useState(100);
  const [targetProfile, setTargetProfile] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setEditedProfiles(profiles);
    }
  }, [open, profiles]);

  // Convert HourlyProfile object to array
  const getCurrentValues = (): number[] => {
    const seasonData = editedProfiles.profiles[season];
    const profile = seasonData[profileType];
    if (!profile) return Array(24).fill(0);
    return Array.from({ length: 24 }, (_, i) => profile[i.toString()] ?? 0);
  };

  // Convert array back to HourlyProfile object
  const setCurrentValues = (values: number[]) => {
    const profileObject: { [key: string]: number } = {};
    values.forEach((v, i) => {
      profileObject[i.toString()] = v;
    });
    
    setEditedProfiles((prev) => ({
      ...prev,
      profiles: {
        ...prev.profiles,
        [season]: {
          ...prev.profiles[season],
          [profileType]: profileObject,
        },
      },
    }));
  };

  const handleSliderChange = (hour: number, value: number) => {
    const newValues = [...getCurrentValues()];
    newValues[hour] = value;
    setCurrentValues(newValues);
  };

  const handleApplyTemplate = (templateId: string) => {
    const template = profileTemplates.find((t) => t.id === templateId);
    if (template) {
      // Convert template array to HourlyProfile object format
      const profileObject: { [key: string]: number } = {};
      template.values.forEach((v, i) => {
        profileObject[i.toString()] = v;
      });
      
      setEditedProfiles((prev) => ({
        ...prev,
        profiles: {
          ...prev.profiles,
          [season]: {
            ...prev.profiles[season],
            [profileType]: profileObject,
          },
        },
      }));
    }
  };

  const handleReset = () => {
    setEditedProfiles(defaultProfiles as DailyProfileConfig);
  };

  const handleSave = () => {
    onSave(editedProfiles);
    onOpenChange(false);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(editedProfiles, null, 2)], { type: 'application/json' });
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
          const parsed = JSON.parse(content);
          
          // Détecter si c'est un profil mesuré PQ-Box
          if (parsed.type === 'measured_profile' && parsed.profile) {
            // Charger le profil mesuré dans le profil résidentiel actuel
            setEditedProfiles((prev) => ({
              ...prev,
              profiles: {
                ...prev.profiles,
                [season]: {
                  ...prev.profiles[season],
                  residential: parsed.profile,
                },
              },
            }));
            toast.success(`Profil mesuré "${parsed.metadata?.name || 'importé'}" chargé dans Résidentiel (${season === 'winter' ? 'Hiver' : 'Été'})`);
          } else {
            // Import standard d'une configuration complète
            setEditedProfiles(parsed as DailyProfileConfig);
            toast.success('Profils importés avec succès');
          }
        } catch {
          toast.error('Fichier JSON invalide');
        }
      };
      reader.readAsText(file);
    }
    if (event.target) event.target.value = '';
  };

  const applyGlobalMultiplier = () => {
    const multiplier = globalMultiplier / 100;
    const seasons: Season[] = ['winter', 'summer'];
    const profileKeys: ProfileType[] = targetProfile === 'all' 
      ? ['residential', 'pv', 'industrial_pme']
      : [targetProfile as ProfileType];

    setEditedProfiles(prev => {
      const updated = { ...prev, profiles: { ...prev.profiles } };
      
      seasons.forEach(s => {
        updated.profiles[s] = { ...prev.profiles[s] };
        profileKeys.forEach(pk => {
          if (prev.profiles[s][pk]) {
            const newProfile: { [key: string]: number } = {};
            Object.entries(prev.profiles[s][pk]!).forEach(([hour, value]) => {
              newProfile[hour] = Math.max(0, Math.min(100, Math.round(value * multiplier)));
            });
            updated.profiles[s][pk] = newProfile;
          }
        });
      });
      
      return updated;
    });
    
    toast.success(`Multiplicateur ×${multiplier.toFixed(1)} appliqué`);
  };

  const currentValues = getCurrentValues();
  const currentConfig = PROFILE_LABELS[profileType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Éditeur de profils horaires</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Season & Profile Type Selection */}
          <div className="flex flex-wrap items-center gap-4">
            <Tabs value={season} onValueChange={(v) => setSeason(v as Season)}>
              <TabsList>
                <TabsTrigger value="winter" className="gap-1">
                  <Snowflake className="h-3 w-3" />
                  Hiver
                </TabsTrigger>
                <TabsTrigger value="summer" className="gap-1">
                  <Sun className="h-3 w-3" />
                  Été
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Select value={profileType} onValueChange={(v) => setProfileType(v as ProfileType)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROFILE_LABELS).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select onValueChange={handleApplyTemplate}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Appliquer un modèle..." />
              </SelectTrigger>
              <SelectContent>
                {profileTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <div className="flex flex-col">
                      <span>{template.name}</span>
                      <span className="text-xs text-muted-foreground">{template.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Global Adjustment */}
          <Card className="p-3 bg-muted/30 space-y-3">
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
                    <SelectItem value="industrial_pme">Industriel / PME</SelectItem>
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
          </Card>

          {/* Preview Chart */}
          <Card className="p-3">
            <ProfilePreviewChart
              values={currentValues}
              color={currentConfig.color}
              label={`${currentConfig.label} - ${season === 'winter' ? 'Hiver' : 'Été'}`}
            />
          </Card>

          {/* Hourly Sliders */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="grid grid-cols-2 gap-x-6 gap-y-0 px-2">
              {/* Morning hours 0-11 */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 sticky top-0 bg-background py-1">
                  🌙 Nuit & Matin (0h-11h)
                </p>
                {Array.from({ length: 12 }, (_, i) => (
                  <HourlySlider
                    key={i}
                    hour={i}
                    value={currentValues[i]}
                    onChange={(v) => handleSliderChange(i, v)}
                    color={currentConfig.color}
                  />
                ))}
              </div>
              
              {/* Afternoon hours 12-23 */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 sticky top-0 bg-background py-1">
                  ☀️ Après-midi & Soir (12h-23h)
                </p>
                {Array.from({ length: 12 }, (_, i) => (
                  <HourlySlider
                    key={i + 12}
                    hour={i + 12}
                    value={currentValues[i + 12]}
                    onChange={(v) => handleSliderChange(i + 12, v)}
                    color={currentConfig.color}
                  />
                ))}
              </div>
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="flex justify-between gap-2 sm:gap-2">
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
            <Button variant="outline" onClick={handleReset} className="gap-1">
              <RotateCcw className="h-4 w-4" />
              Réinitialiser
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} className="gap-1">
              <Save className="h-4 w-4" />
              Sauvegarder
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
