import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Zap, Users, Settings2, FlaskConical, FileDown } from "lucide-react";
import { useNetworkStore } from "@/store/networkStore";
import { ExcelImporter } from '@/components/ExcelImporter';
import { NetworkTab, RaccordementsTab, ParametersTab, SimulationTab, ExportTab } from '@/components/topMenu';

interface TopMenuTabsProps {
  defaultTab?: string;
  className?: string;
}

export const TopMenuTabs = ({ defaultTab = 'network', className = '' }: TopMenuTabsProps) => {
  const [showImporter, setShowImporter] = useState(false);
  const [activeTab, setActiveTab] = useState(defaultTab);
  
  const { currentProject } = useNetworkStore();

  if (!currentProject) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Aucun projet chargé
      </div>
    );
  }

  return (
    <div className={className}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* Navigation Tabs */}
        <div className="border-b border-border/50 bg-muted/30">
          <TabsList className="h-10 w-full justify-start rounded-none bg-transparent p-0 px-4">
            <TabsTrigger 
              value="network" 
              className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Zap className="h-4 w-4 mr-2" />
              Réseau
            </TabsTrigger>
            <TabsTrigger 
              value="raccordements" 
              className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-emerald-500 data-[state=active]:text-emerald-500 data-[state=active]:shadow-none"
            >
              <Users className="h-4 w-4 mr-2" />
              Raccordements
            </TabsTrigger>
            <TabsTrigger 
              value="parameters" 
              className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-secondary data-[state=active]:text-secondary data-[state=active]:shadow-none"
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Paramètres
            </TabsTrigger>
            <TabsTrigger 
              value="simulation" 
              className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-accent data-[state=active]:text-accent data-[state=active]:shadow-none"
            >
              <FlaskConical className="h-4 w-4 mr-2" />
              Simulation
            </TabsTrigger>
            <TabsTrigger 
              value="export" 
              className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-destructive data-[state=active]:text-destructive data-[state=active]:shadow-none"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Export
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Contenu des Tabs */}
        <TabsContent value="network" className="mt-0">
          <NetworkTab />
        </TabsContent>
        <TabsContent value="raccordements" className="mt-0">
          <RaccordementsTab onShowImporter={() => setShowImporter(true)} />
        </TabsContent>
        <TabsContent value="parameters" className="mt-0">
          <ParametersTab />
        </TabsContent>
        <TabsContent value="simulation" className="mt-0">
          <SimulationTab />
        </TabsContent>
        <TabsContent value="export" className="mt-0">
          <ExportTab />
        </TabsContent>
      </Tabs>

      {/* Dialog for Excel Importer */}
      <Dialog open={showImporter} onOpenChange={setShowImporter}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <ExcelImporter onClose={() => setShowImporter(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
};
