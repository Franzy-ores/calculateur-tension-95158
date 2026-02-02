import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { CompactHourlySlider } from './CompactHourlySlider';
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
type ProfileType = 'residential' | 'pv' | 'industrial_pme' | 'ev' | 'client';

const PROFILE_LABELS: Record<ProfileType, { label: string; color: string }> = {
  residential: { label: 'Résidentiel', color: '#3b82f6' },
  client: { label: 'Raccordement client', color: '#06b6d4' },
  pv: { label: 'Production PV', color: '#f59e0b' },
  ev: { label: 'Véhicules électriques', color: '#10b981' },
  industrial_pme: { label: 'Industriel / PME', color: '#8b5cf6' },
};

const MULTIPLIER_BUTTONS = [
  { label: '×0.5', value: 0.5 },
  { label: '×0.8', value: 0.8 },
  { label: '×1.0', value: 1.0 },
  { label: '×1.2', value: 1.2 },
  { label: '×1.5', value: 1.5 },
];

export const ProfileVisualEditor = ({
  open,
  onOpenChange,
  profiles,
  onSave,
}: ProfileVisualEditorProps) => {
  const [editedProfiles, setEditedProfiles] = useState<DailyProfileConfig>(profiles);
  const [season, setSeason] = useState<Season>('winter');
  const [profileType, setProfileType] = useState<ProfileType>('residential');
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
          
          if (parsed.type === 'measured_profile' && parsed.profile) {
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

  const applyMultiplier = (multiplierValue: number) => {
    const seasons: Season[] = ['winter', 'summer'];
    const profileKeys: ProfileType[] = targetProfile === 'all' 
      ? ['residential', 'client', 'pv', 'ev', 'industrial_pme']
      : [targetProfile as ProfileType];

    setEditedProfiles(prev => {
      const updated = { ...prev, profiles: { ...prev.profiles } };
      
      seasons.forEach(s => {
        updated.profiles[s] = { ...prev.profiles[s] };
        profileKeys.forEach(pk => {
          const seasonProfiles = prev.profiles[s] as unknown as Record<string, { [key: string]: number } | undefined>;
          const profile = seasonProfiles[pk];
          if (profile) {
            const newProfile: { [key: string]: number } = {};
            Object.entries(profile).forEach(([hour, value]) => {
              newProfile[hour] = Math.max(0, Math.min(100, Math.round(value * multiplierValue)));
            });
            (updated.profiles[s] as unknown as Record<string, { [key: string]: number }>)[pk] = newProfile;
          }
        });
      });
      
      return updated;
    });
    
    toast.success(`Multiplicateur ×${multiplierValue.toFixed(1)} appliqué`);
  };

  const currentValues = getCurrentValues();
  const currentConfig = PROFILE_LABELS[profileType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Éditeur de profils horaires</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-3">
          {/* Season & Profile Type Selection - Compact row */}
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={season} onValueChange={(v) => setSeason(v as Season)}>
              <TabsList className="h-8">
                <TabsTrigger value="winter" className="gap-1 text-xs h-7 px-2">
                  <Snowflake className="h-3 w-3" />
                  Hiver
                </TabsTrigger>
                <TabsTrigger value="summer" className="gap-1 text-xs h-7 px-2">
                  <Sun className="h-3 w-3" />
                  Été
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Select value={profileType} onValueChange={(v) => setProfileType(v as ProfileType)}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROFILE_LABELS).map(([key, { label }]) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select onValueChange={handleApplyTemplate}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="Modèle..." />
              </SelectTrigger>
              <SelectContent>
                {profileTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id} className="text-xs">
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preview Chart - Larger */}
          <Card className="p-3">
            <ProfilePreviewChart
              values={currentValues}
              color={currentConfig.color}
              label={`${currentConfig.label} - ${season === 'winter' ? 'Hiver' : 'Été'}`}
            />
          </Card>

          {/* Hourly Sliders - Responsive Grid */}
          <Card className="p-3 flex-1 overflow-auto">
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-0">
              {Array.from({ length: 24 }, (_, i) => (
                <CompactHourlySlider
                  key={i}
                  hour={i}
                  value={currentValues[i]}
                  onChange={(v) => handleSliderChange(i, v)}
                />
              ))}
            </div>
          </Card>

          {/* Quick Adjustment - Multiplier Buttons */}
          <Card className="p-2 bg-muted/30">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs font-medium shrink-0">Ajuster :</Label>
              
              <div className="flex gap-1">
                {MULTIPLIER_BUTTONS.map((btn) => (
                  <Button
                    key={btn.label}
                    variant={btn.value === 1.0 ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => applyMultiplier(btn.value)}
                  >
                    {btn.label}
                  </Button>
                ))}
              </div>

              <Select value={targetProfile} onValueChange={setTargetProfile}>
                <SelectTrigger className="w-36 h-7 text-xs ml-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Tous les profils</SelectItem>
                  <SelectItem value="residential" className="text-xs">Résidentiel</SelectItem>
                  <SelectItem value="client" className="text-xs">Raccordement client</SelectItem>
                  <SelectItem value="pv" className="text-xs">Production PV</SelectItem>
                  <SelectItem value="ev" className="text-xs">Véhicules élec.</SelectItem>
                  <SelectItem value="industrial_pme" className="text-xs">Industriel / PME</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>
        </div>

        <DialogFooter className="flex justify-between gap-2 sm:gap-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1 h-8">
              <Download className="h-3 w-3" />
              <span className="hidden sm:inline">Exporter</span>
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => fileInputRef.current?.click()} 
              className="gap-1 h-8"
            >
              <Upload className="h-3 w-3" />
              <span className="hidden sm:inline">Importer</span>
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
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1 h-8">
              <RotateCcw className="h-3 w-3" />
              <span className="hidden sm:inline">Reset</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8">
              Annuler
            </Button>
            <Button size="sm" onClick={handleSave} className="gap-1 h-8">
              <Save className="h-3 w-3" />
              Sauver
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
