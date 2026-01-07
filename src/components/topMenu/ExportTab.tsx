import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown, FileText } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { PDFGenerator } from "@/utils/pdfGenerator";
import { toast } from "sonner";

export const ExportTab = () => {
  const {
    currentProject,
    selectedScenario,
    calculationResults,
    simulationResults,
    isSimulationActive,
    simulationEquipment,
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

  return (
    <div className="p-4">
      {/* Card: Export */}
      <Card className="bg-card/50 backdrop-blur border-border/50 max-w-md">
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
    </div>
  );
};
