import { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileText, Zap, Calendar, Database, AlertCircle, Check, X } from 'lucide-react';
import { parsePQBoxFile, calculateHourlyProfile, PQBoxRawData, HourlyProfileResult } from '@/utils/pqboxParser';
import { useNetworkStore } from '@/store/networkStore';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface MeasuredProfileImporterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MeasuredProfileImporter = ({ open, onOpenChange }: MeasuredProfileImporterProps) => {
  const { setMeasuredProfile } = useNetworkStore();
  
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [rawData, setRawData] = useState<PQBoxRawData[]>([]);
  const [measurePeriod, setMeasurePeriod] = useState<string>('');
  const [dataPoints, setDataPoints] = useState<number>(0);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  
  const [contractualPower_kVA, setContractualPower_kVA] = useState<number>(250);
  const [profileName, setProfileName] = useState<string>('');
  
  const [previewResult, setPreviewResult] = useState<HourlyProfileResult | null>(null);

  // Calcul du profil quand les données ou la puissance contractuelle changent
  useMemo(() => {
    if (rawData.length > 0 && contractualPower_kVA > 0) {
      const result = calculateHourlyProfile(
        rawData,
        contractualPower_kVA,
        profileName || 'Profil mesuré',
        fileName,
        measurePeriod
      );
      setPreviewResult(result);
    } else {
      setPreviewResult(null);
    }
  }, [rawData, contractualPower_kVA, profileName, fileName, measurePeriod]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const processFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const result = parsePQBoxFile(content, file.name);
      
      if (result.success) {
        setFileName(file.name);
        setRawData(result.rawData);
        setMeasurePeriod(result.measurePeriod || '');
        setDataPoints(result.dataPoints);
        setParseErrors(result.errors);
        
        // Auto-générer un nom de profil
        const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
        setProfileName(baseName);
      } else {
        toast.error('Erreur de parsing', {
          description: result.errors.join(', ')
        });
        setParseErrors(result.errors);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  }, [processFile]);

  const handleImport = () => {
    if (!previewResult) return;
    
    setMeasuredProfile(previewResult.profile, previewResult.metadata);
    toast.success('Profil importé', {
      description: `"${previewResult.metadata.name}" - ${previewResult.metadata.dataPoints} points de mesure`
    });
    onOpenChange(false);
    resetState();
  };

  const resetState = () => {
    setFileName('');
    setRawData([]);
    setMeasurePeriod('');
    setDataPoints(0);
    setParseErrors([]);
    setContractualPower_kVA(250);
    setProfileName('');
    setPreviewResult(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  // Données pour le graphe de prévisualisation
  const chartData = useMemo(() => {
    if (!previewResult) return [];
    return previewResult.hourlyAverages.map(h => ({
      hour: `${h.hour}h`,
      percent: h.percent,
      kVA: h.avg_kVA
    }));
  }, [previewResult]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Importer mesures PQ-Box
          </DialogTitle>
          <DialogDescription>
            Importez un fichier de mesures PQ-Box pour créer un profil 24h basé sur les données réelles
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-1">
          <div className="space-y-4 pb-4">
            {/* Zone de drop */}
            {rawData.length === 0 ? (
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 hover:border-primary/50'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-2">
                  Glissez-déposez un fichier PQ-Box (.txt)
                </p>
                <p className="text-xs text-muted-foreground/70 mb-4">ou</p>
                <label>
                  <input
                    type="file"
                    accept=".txt,.csv"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                  <Button variant="outline" size="sm" asChild>
                    <span>Parcourir...</span>
                  </Button>
                </label>
              </div>
            ) : (
              <>
                {/* Fichier chargé */}
                <Card className="bg-muted/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="h-8 w-8 text-primary" />
                        <div>
                          <p className="font-medium text-sm">{fileName}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="text-[10px]">
                              <Database className="h-3 w-3 mr-1" />
                              {dataPoints} mesures
                            </Badge>
                            {measurePeriod && (
                              <Badge variant="outline" className="text-[10px]">
                                <Calendar className="h-3 w-3 mr-1" />
                                {measurePeriod}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={resetState}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Erreurs de parsing */}
                {parseErrors.length > 0 && (
                  <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-warning text-sm font-medium mb-1">
                      <AlertCircle className="h-4 w-4" />
                      Avertissements
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {parseErrors.slice(0, 3).map((err, i) => (
                        <li key={i}>• {err}</li>
                      ))}
                      {parseErrors.length > 3 && (
                        <li>• ... et {parseErrors.length - 3} autres</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Paramètres */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contractual-power" className="text-sm flex items-center gap-2">
                      <Zap className="h-4 w-4 text-warning" />
                      Puissance contractuelle (kVA) *
                    </Label>
                    <Input
                      id="contractual-power"
                      type="number"
                      min="1"
                      step="1"
                      value={contractualPower_kVA}
                      onChange={(e) => setContractualPower_kVA(parseFloat(e.target.value) || 0)}
                      className="font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Base de calcul pour les pourcentages (100%)
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-name" className="text-sm">
                      Nom du profil
                    </Label>
                    <Input
                      id="profile-name"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Ex: PT 19066 Nov 2025"
                    />
                  </div>
                </div>

                {/* Aperçu graphique */}
                {previewResult && (
                  <Card>
                    <CardContent className="p-4">
                      <h4 className="text-sm font-medium mb-3 flex items-center justify-between">
                        <span>Aperçu du profil 24h</span>
                        <Badge 
                          variant={previewResult.metadata.peakUsagePercent > 100 ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          Pic: {previewResult.metadata.peakUsagePercent.toFixed(1)}%
                        </Badge>
                      </h4>
                      <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                            <XAxis 
                              dataKey="hour" 
                              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                              interval={2}
                            />
                            <YAxis 
                              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                              tickFormatter={(v) => `${v}%`}
                              domain={[0, 'auto']}
                            />
                            <ReferenceLine y={100} stroke="hsl(var(--warning))" strokeDasharray="5 5" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                fontSize: '12px'
                              }}
                              formatter={(value: number, name: string) => [
                                name === 'percent' ? `${value.toFixed(1)}%` : `${value.toFixed(2)} kVA`,
                                name === 'percent' ? 'Utilisation' : 'Puissance'
                              ]}
                            />
                            <Line
                              type="monotone"
                              dataKey="percent"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              dot={{ fill: 'hsl(var(--primary))', r: 3 }}
                              activeDot={{ r: 5 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Tableau récapitulatif */}
                {previewResult && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                      Moyennes horaires
                    </div>
                    <ScrollArea className="h-[150px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b">
                            <th className="px-3 py-1.5 text-left font-medium">Heure</th>
                            <th className="px-3 py-1.5 text-right font-medium">Moy. (kVA)</th>
                            <th className="px-3 py-1.5 text-right font-medium">% Contractuel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewResult.hourlyAverages.map((h) => (
                            <tr 
                              key={h.hour} 
                              className={`border-b border-border/50 ${h.percent > 100 ? 'bg-destructive/10' : ''}`}
                            >
                              <td className="px-3 py-1">{h.hour}h</td>
                              <td className="px-3 py-1 text-right font-mono">{h.avg_kVA.toFixed(2)}</td>
                              <td className={`px-3 py-1 text-right font-mono ${h.percent > 100 ? 'text-destructive font-medium' : ''}`}>
                                {h.percent.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </div>
                )}

                {/* Métadonnées */}
                {previewResult && (
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <Card className="bg-muted/30">
                      <CardContent className="p-3 text-center">
                        <p className="text-muted-foreground mb-0.5">Puissance max</p>
                        <p className="font-mono font-medium">
                          {(previewResult.metadata.maxMeasured_VA / 1000).toFixed(2)} kVA
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-muted/30">
                      <CardContent className="p-3 text-center">
                        <p className="text-muted-foreground mb-0.5">Puissance moy.</p>
                        <p className="font-mono font-medium">
                          {(previewResult.metadata.avgMeasured_VA / 1000).toFixed(2)} kVA
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-muted/30">
                      <CardContent className="p-3 text-center">
                        <p className="text-muted-foreground mb-0.5">Utilisation pic</p>
                        <p className={`font-mono font-medium ${previewResult.metadata.peakUsagePercent > 100 ? 'text-destructive' : ''}`}>
                          {previewResult.metadata.peakUsagePercent.toFixed(1)}%
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Annuler
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={!previewResult || contractualPower_kVA <= 0}
            className="gap-2"
          >
            <Check className="h-4 w-4" />
            Importer le profil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
