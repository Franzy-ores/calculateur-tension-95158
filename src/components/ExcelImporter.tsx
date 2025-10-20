import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, Check, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { parseExcelToClients, validateClient } from '@/utils/clientsUtils';
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

  const { importClientsFromExcel } = useNetworkStore();

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

    try {
      const clients = await parseExcelToClients(selectedFile);
      
      // Vérifier la limite de 300 clients
      if (clients.length > 300) {
        toast.error('Clients trop nombreux, veuillez revoir votre fichier sources', {
          description: `Le fichier contient ${clients.length} clients. Maximum autorisé : 300 clients.`
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
      toast.success(`${clients.length} clients chargés depuis le fichier`);
    } catch (error) {
      console.error('Erreur lors du parsing Excel:', error);
      toast.error('Erreur lors de la lecture du fichier Excel');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = () => {
    // Filtrer les clients valides seulement
    const validClients = previewData.filter(client => !validationErrors.has(client.id));
    
    if (validClients.length === 0) {
      toast.error('Aucun client valide à importer');
      return;
    }

    importClientsFromExcel(validClients);
    toast.success(`${validClients.length} clients importés avec succès`);
    onClose();
  };

  const validCount = previewData.filter(c => !validationErrors.has(c.id)).length;
  const invalidCount = validationErrors.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Importer des Clients</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!file ? (
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
            }}>
              Changer de fichier
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
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
                    {invalidCount} client(s) contiennent des erreurs et ne seront pas importés.
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
                  Importer {validCount} client(s)
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
