import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileDown, FileSpreadsheet, Eye, FileText } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PDFGenerator } from "@/utils/pdfGenerator";
import { toast } from "sonner";

interface ExportTabProps {
  onShowImporter: () => void;
}

export const ExportTab = ({ onShowImporter }: ExportTabProps) => {
  const {
    currentProject,
    showVoltages,
    setShowVoltages,
    selectedScenario,
    calculationResults,
    simulationResults,
    isSimulationActive,
    simulationEquipment,
    clientColorMode,
    setClientColorMode,
  } = useNetworkStore();

  const handleExportPDF = async () => {
    if (!currentProject || !selectedScenario) {
      toast.error("Aucun projet ou scénario sélectionné.");
      return;
    }
    
    const activeEquipmentCount = (simulationEquipment.srg2Devices?.filter(s => s.enabled).length || 0) + 
                                 simulationEquipment.neutralCompensators.filter(c => c.enabled).length;
    
    const resultsToUse = (isSimulationActive && activeEquipmentCount > 0) 
      ? simulationResults 
      : calculationResults;
    
    const generatePDF = async () => {
      const pdfGenerator = new PDFGenerator();
      await pdfGenerator.generateReport({
        project: currentProject,
        results: resultsToUse,
        selectedScenario,
        simulationResults: (isSimulationActive && activeEquipmentCount > 0) 
          ? simulationResults[selectedScenario] 
          : undefined
      });
    };
    
    toast.promise(generatePDF(), {
      loading: "Génération du rapport PDF en cours...",
      success: "Rapport PDF généré avec succès !",
      error: "Erreur lors de la génération du rapport PDF."
    });
  };

  if (!currentProject) return null;

  const hasClients = currentProject.clientsImportes && currentProject.clientsImportes.length > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {/* Card 1: Export */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileDown className="h-4 w-4 text-primary" />
            Export de données
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <Button 
            variant="outline" 
            className="w-full justify-start" 
            onClick={handleExportPDF}
            disabled={!calculationResults[selectedScenario]}
          >
            <FileText className="h-4 w-4 mr-2 text-destructive" />
            Exporter rapport PDF
          </Button>
          <p className="text-xs text-muted-foreground">
            Génère un rapport complet avec tous les résultats de calcul et graphiques.
          </p>
        </CardContent>
      </Card>

      {/* Card 2: Import */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-secondary" />
            Import de données
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <Button 
            variant="outline" 
            className="w-full justify-start" 
            onClick={onShowImporter}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2 text-success" />
            Importer clients Excel
          </Button>
          {hasClients && (
            <Badge variant="secondary" className="text-xs">
              {currentProject.clientsImportes?.length} clients importés
            </Badge>
          )}
          <p className="text-xs text-muted-foreground">
            Importez une liste de clients depuis un fichier Excel.
          </p>
        </CardContent>
      </Card>

      {/* Card 3: Affichage */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Eye className="h-4 w-4 text-accent" />
            Options d'affichage
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Toggle tensions nœuds */}
          <div className="flex items-center justify-between">
            <Label htmlFor="show-voltages" className="text-sm">
              Tensions des nœuds
            </Label>
            <Switch
              id="show-voltages"
              checked={showVoltages}
              onCheckedChange={setShowVoltages}
            />
          </div>

          {/* Coloration clients */}
          {hasClients && (
            <div className="space-y-2">
              <Label className="text-sm">Mode coloration clients</Label>
              <Select value={clientColorMode} onValueChange={(value: any) => setClientColorMode(value)}>
                <SelectTrigger className="w-full bg-background border text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border z-[10000]">
                  <SelectItem value="couplage">Par couplage</SelectItem>
                  <SelectItem value="circuit">Par circuit</SelectItem>
                  <SelectItem value="tension">Par tension</SelectItem>
                  <SelectItem value="lien">Par lien</SelectItem>
                  <SelectItem value="gps">Par GPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
