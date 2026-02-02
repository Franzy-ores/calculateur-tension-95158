import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, Check, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { parseExcelToClients, validateClient, GeocodingReport } from '@/utils/clientsUtils';
import { ClientImporte } from '@/types/network';
import { useNetworkStore } from '@/store/networkStore';
import { toast } from 'sonner';

interface ExcelImporterProps {
  onClose: () => void;
}

export const ExcelImporter = ({ onClose }: ExcelImporterProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ClientImporte[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Map<string, string[]>>(new Map());
  const [geocodingProgress, setGeocodingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [geocodingReport, setGeocodingReport] = useState<GeocodingReport | null>(null);

  const { importClientsFromExcel, currentProject } = useNetworkStore();
  
  // Vérifier le nombre d'imports déjà effectués (max 3)
  const importCount = currentProject?.importCount ?? 0;
  const hasReachedImportLimit = importCount >= 3;

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (selectedFile: File) => {
    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('Format de fichier invalide. Veuillez sélectionner un fichier Excel (.xlsx ou .xls)');
      return;
    }

    setFile(selectedFile);
    setIsLoading(true);
    setValidationErrors(new Map());
    setGeocodingProgress(null);
    setGeocodingReport(null);

    try {
      const { clients, geocodingReport } = await parseExcelToClients(
        selectedFile,
        (current, total) => {
          setGeocodingProgress({ current, total });
        }
      );
      
      // Vérifier la limite de 300 clients
      if (clients.length > 300) {
        toast.error('Raccordements trop nombreux, veuillez revoir votre fichier sources', {
          description: `Le fichier contient ${clients.length} raccordements. Maximum autorisé : 300 raccordements.`
        });
        setIsLoading(false);
        setFile(null);
        return;
      }
      
      // Valider tous les clients
      const errors = new Map<string, string[]>();
      clients.forEach(client => {
        const validation = validateClient(client);
        if (!validation.valid) {
          errors.set(client.id, validation.errors);
        }
      });

      setValidationErrors(errors);
      setPreviewData(clients);
      setGeocodingReport(geocodingReport);
      
      const successMessage = geocodingReport.geocoded > 0 
        ? `${clients.length} raccordements chargés (${geocodingReport.geocoded} géocodés automatiquement)`
        : `${clients.length} raccordements chargés depuis le fichier`;
      
      toast.success(successMessage);
    } catch (error) {
      console.error('Erreur lors du parsing Excel:', error);
      toast.error('Erreur lors de la lecture du fichier Excel');
    } finally {
      setIsLoading(false);
      setGeocodingProgress(null);
    }
  };

  const handleImport = () => {
    // Filtrer les raccordements valides seulement
    const validClients = previewData.filter(client => !validationErrors.has(client.id));
    
    if (validClients.length === 0) {
      toast.error('Aucun raccordement valide à importer');
      return;
    }

    importClientsFromExcel(validClients);
    toast.success(`${validClients.length} raccordements importés avec succès`);
    onClose();
  };

  const validCount = previewData.filter(c => !validationErrors.has(c.id)).length;
  const invalidCount = validationErrors.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Importer des Raccordements</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {hasReachedImportLimit ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-3">
            <p className="font-semibold">Limite d'importation atteinte</p>
            <p>
              Vous avez déjà effectué <strong>{importCount} import(s)</strong> sur ce projet.
              Le nombre maximum d'imports autorisés est de <strong>3</strong>.
            </p>
            <p className="text-sm">
              <strong>Solution :</strong>
            </p>
            <ul className="text-sm list-disc list-inside space-y-1">
              <li>Créez un nouveau projet pour importer d'autres raccordements</li>
            </ul>
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={onClose}>
                Fermer
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : !file ? (
        <Card
          className={`p-8 border-2 border-dashed transition-colors ${
            dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center justify-center gap-4">
            <Upload className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="text-lg font-medium">Glissez-déposez votre fichier Excel ici</p>
              <p className="text-sm text-muted-foreground mt-1">ou</p>
            </div>
            <label htmlFor="file-upload">
              <Button variant="outline" className="cursor-pointer" asChild>
                <span>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Sélectionner un fichier
                </span>
              </Button>
              <input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
            <p className="text-xs text-muted-foreground">Formats acceptés: .xlsx, .xls</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              <span className="font-medium">{file.name}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => {
              setFile(null);
              setPreviewData([]);
              setValidationErrors(new Map());
              setGeocodingReport(null);
            }}>
              Changer de fichier
            </Button>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-8 space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-sm text-muted-foreground">
                {geocodingProgress 
                  ? `Géocodage en cours... (${geocodingProgress.current}/${geocodingProgress.total})`
                  : 'Chargement du fichier...'}
              </p>
              {geocodingProgress && (
                <div className="w-full max-w-md">
                  <Progress 
                    value={(geocodingProgress.current / geocodingProgress.total) * 100} 
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              {geocodingReport && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-2">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Rapport d'import
                  </h3>
                  <ul className="text-sm space-y-1 text-blue-800 dark:text-blue-200">
                    <li className="flex items-center gap-2">
                      <Check className="h-3 w-3" />
                      {geocodingReport.withGPS} raccordements avec GPS d'origine
                    </li>
                    {geocodingReport.geocoded > 0 && (
                      <li className="flex items-center gap-2 font-medium">
                        🔍 {geocodingReport.geocoded} raccordements géocodés automatiquement
                      </li>
                    )}
                    {geocodingReport.ambiguous > 0 && (
                      <li className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                        ⚠️ {geocodingReport.ambiguous} adresses ambiguës (à vérifier)
                      </li>
                    )}
                    {geocodingReport.failed > 0 && (
                      <li className="flex items-center gap-2 text-red-600 dark:text-red-400">
                        <X className="h-3 w-3" />
                        {geocodingReport.failed} échecs de géocodage
                      </li>
                    )}
                  </ul>
                </div>
              )}
              
              <div className="flex items-center gap-4">
                <Badge variant="default" className="bg-green-600">
                  <Check className="h-3 w-3 mr-1" />
                  {validCount} valides
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="destructive">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {invalidCount} invalides
                  </Badge>
                )}
              </div>

              {invalidCount > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {invalidCount} raccordement(s) contiennent des erreurs et ne seront pas importés.
                  </AlertDescription>
                </Alert>
              )}

              <div className="max-h-96 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Statut</th>
                      <th className="p-2 text-left">Circuit</th>
                      <th className="p-2 text-left">Couplage</th>
                      <th className="p-2 text-right">Charge (kVA)</th>
                      <th className="p-2 text-right">PV (kVA)</th>
                      <th className="p-2 text-left">Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map(client => {
                      const hasError = validationErrors.has(client.id);
                      return (
                        <tr
                          key={client.id}
                          className={hasError ? 'bg-destructive/10' : ''}
                        >
                          <td className="p-2">
                            {hasError ? (
                              <X className="h-4 w-4 text-destructive" />
                            ) : (
                              <Check className="h-4 w-4 text-green-600" />
                            )}
                          </td>
                          <td className="p-2">{client.nomCircuit}</td>
                          <td className="p-2">
                            <Badge variant={client.couplage === 'TRI' ? 'default' : 'secondary'}>
                              {client.couplage}
                            </Badge>
                          </td>
                          <td className="p-2 text-right">{client.puissanceContractuelle_kVA.toFixed(2)}</td>
                          <td className="p-2 text-right">{client.puissancePV_kVA.toFixed(2)}</td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {client.lat.toFixed(5)}, {client.lng.toFixed(5)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>
                  Annuler
                </Button>
                <Button 
                  onClick={handleImport}
                  disabled={validCount === 0}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Importer {validCount} raccordement(s)
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
