import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, AlertTriangle, Cable, Zap, MapPin, User } from 'lucide-react';
import { useNetworkStore } from '@/store/networkStore';
import { 
  branchementCableTypes, 
  BranchementCableType, 
  getCompatibleBranchementCables,
  calculateGeodeticDistance 
} from '@/data/branchementCableTypes';
import { ClientImporte } from '@/types/network';

interface PhaseResult {
  phase: string;
  V_node: number;
  I_charge: number;
  I_prod: number;
  I_net: number;
  deltaU_charge: number;
  deltaU_prod: number;
  deltaU_net: number;
  V_client: number;
  status: 'normal' | 'warning' | 'critical';
}

interface CalculationResult {
  phases: PhaseResult[];
  cableCompatible: boolean;
  cableOverloaded: boolean;
  maxCurrent: number;
}

/**
 * Calcule la tension chez le client en fonction des paramètres
 */
const calculateClientVoltage = (
  nodeVoltages: { L1: number; L2: number; L3: number },
  client: ClientImporte,
  cable: BranchementCableType,
  length_m: number,
  voltageSystem: 'TRIPHASÉ_230V' | 'TÉTRAPHASÉ_400V',
  foisonnementCharges: number,
  foisonnementProductions: number,
  cosPhiCharges: number,
  cosPhiProductions: number,
  desequilibre: { A: number; B: number; C: number }
): CalculationResult => {
  const L_km = length_m / 1000;
  const R = cable.R_ohm_per_km;
  const X = cable.X_ohm_per_km;
  const sinPhiCharges = Math.sqrt(1 - cosPhiCharges ** 2);
  const sinPhiProductions = Math.sqrt(1 - cosPhiProductions ** 2);
  
  // Puissances foisonnées (en VA)
  const S_charge = client.puissanceContractuelle_kVA * (foisonnementCharges / 100) * 1000;
  const S_prod = client.puissancePV_kVA * (foisonnementProductions / 100) * 1000;
  
  const is230V = voltageSystem === 'TRIPHASÉ_230V';
  const connectionType = client.connectionType || 'MONO';
  
  const results: PhaseResult[] = [];
  let maxCurrent = 0;
  
  if (connectionType === 'MONO') {
    // === MONOPHASÉ ===
    if (is230V) {
      // MONO 230V Phase-Phase (triangle)
      const U_ref = 230; // Tension phase-phase
      const I_charge = S_charge / U_ref;
      const I_prod = S_prod / U_ref;
      const I_net = I_charge - I_prod;
      maxCurrent = Math.abs(I_net);
      
      // Formule mono phase-phase : ΔU = 2 × I × (R×cosφ + X×sinφ) × L
      const deltaU_charge = 2 * I_charge * (R * cosPhiCharges + X * sinPhiCharges) * L_km;
      const deltaU_prod = 2 * I_prod * (R * cosPhiProductions + X * sinPhiProductions) * L_km;
      const deltaU_net = deltaU_charge - deltaU_prod;
      
      // Couplage du client (ex: A-B, B-C, A-C)
      const coupling = client.phaseCoupling || 'A-B';
      const phaseLabel = coupling.replace(/A/g, 'L1').replace(/B/g, 'L2').replace(/C/g, 'L3');
      
      // Tension phase-phase au noeud (utiliser la moyenne simplifiée)
      let V_node = 230;
      if (coupling.includes('A') && coupling.includes('B')) {
        V_node = (nodeVoltages.L1 + nodeVoltages.L2) / 2;
      } else if (coupling.includes('B') && coupling.includes('C')) {
        V_node = (nodeVoltages.L2 + nodeVoltages.L3) / 2;
      } else if (coupling.includes('A') && coupling.includes('C')) {
        V_node = (nodeVoltages.L1 + nodeVoltages.L3) / 2;
      }
      
      const V_client = V_node - deltaU_net;
      
      results.push({
        phase: phaseLabel,
        V_node,
        I_charge,
        I_prod,
        I_net,
        deltaU_charge,
        deltaU_prod,
        deltaU_net,
        V_client,
        status: getVoltageStatus(V_client, 230)
      });
      
    } else {
      // MONO 230V Phase-Neutre (étoile 400V)
      const U_ref = 230; // Tension phase-neutre
      const I_charge = S_charge / U_ref;
      const I_prod = S_prod / U_ref;
      const I_net = I_charge - I_prod;
      maxCurrent = Math.abs(I_net);
      
      // Formule mono phase-neutre : ΔU = 2 × I × (R×cosφ + X×sinφ) × L
      const deltaU_charge = 2 * I_charge * (R * cosPhiCharges + X * sinPhiCharges) * L_km;
      const deltaU_prod = 2 * I_prod * (R * cosPhiProductions + X * sinPhiProductions) * L_km;
      const deltaU_net = deltaU_charge - deltaU_prod;
      
      const assignedPhase = client.assignedPhase || 'A';
      const phaseKey = assignedPhase === 'A' ? 'L1' : assignedPhase === 'B' ? 'L2' : 'L3';
      const V_node = nodeVoltages[phaseKey as keyof typeof nodeVoltages];
      const V_client = V_node - deltaU_net;
      
      results.push({
        phase: phaseKey,
        V_node,
        I_charge,
        I_prod,
        I_net,
        deltaU_charge,
        deltaU_prod,
        deltaU_net,
        V_client,
        status: getVoltageStatus(V_client, 230)
      });
    }
    
  } else {
    // === TRIPHASÉ / TÉTRAPHASÉ ===
    const U_ligne = is230V ? 230 : 400;
    const U_phase = is230V ? 230 : 230; // Tension phase-neutre de référence pour conformité
    
    // Courant par phase équilibré : I = S / (√3 × U_ligne)
    const I_charge_base = S_charge / (Math.sqrt(3) * U_ligne);
    const I_prod_base = S_prod / (Math.sqrt(3) * U_ligne);
    
    // Formule triphasée : ΔU = √3 × I × (R×cosφ + X×sinφ) × L
    const Z_charge = (R * cosPhiCharges + X * sinPhiCharges) * L_km;
    const Z_prod = (R * cosPhiProductions + X * sinPhiProductions) * L_km;
    
    // Appliquer le déséquilibre du projet sur chaque phase
    const phases: Array<{ key: 'L1' | 'L2' | 'L3'; deseq: number }> = [
      { key: 'L1', deseq: desequilibre.A / 33.33 },
      { key: 'L2', deseq: desequilibre.B / 33.33 },
      { key: 'L3', deseq: desequilibre.C / 33.33 }
    ];
    
    phases.forEach(({ key, deseq }) => {
      const I_charge = I_charge_base * deseq;
      const I_prod = I_prod_base * deseq;
      const I_net = I_charge - I_prod;
      
      const deltaU_charge = Math.sqrt(3) * I_charge * Z_charge;
      const deltaU_prod = Math.sqrt(3) * I_prod * Z_prod;
      const deltaU_net = deltaU_charge - deltaU_prod;
      
      const V_node = nodeVoltages[key];
      const V_client = V_node - deltaU_net;
      
      maxCurrent = Math.max(maxCurrent, Math.abs(I_net));
      
      results.push({
        phase: key,
        V_node,
        I_charge,
        I_prod,
        I_net,
        deltaU_charge,
        deltaU_prod,
        deltaU_net,
        V_client,
        status: getVoltageStatus(V_client, U_phase)
      });
    });
  }
  
  // Vérification compatibilité câble
  const cableCompatible = connectionType === 'MONO' || cable.type === 'TRI';
  const cableOverloaded = maxCurrent > cable.maxCurrent_A;
  
  return {
    phases: results,
    cableCompatible,
    cableOverloaded,
    maxCurrent
  };
};

/**
 * Détermine le statut de conformité EN50160
 */
const getVoltageStatus = (voltage: number, nominalVoltage: number): 'normal' | 'warning' | 'critical' => {
  const deviation = Math.abs(voltage - nominalVoltage) / nominalVoltage * 100;
  
  if (deviation > 10) return 'critical';
  if (deviation > 5) return 'warning';
  return 'normal';
};

/**
 * Composant principal de l'onglet Tension Client
 */
export const TensionClientTab = () => {
  const { 
    currentProject, 
    calculationResults, 
    simulationResults,
    isSimulationActive,
    selectedScenario 
  } = useNetworkStore();
  
  // États locaux
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedCableId, setSelectedCableId] = useState<string>(branchementCableTypes[0]?.id || '');
  const [manualLength, setManualLength] = useState<number | null>(null);
  const [useManualLength, setUseManualLength] = useState(false);
  
  if (!currentProject) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Aucun projet chargé
      </div>
    );
  }
  
  // Récupérer les clients liés à un noeud
  const linkedClients = useMemo(() => {
    if (!currentProject.clientsImportes || !currentProject.clientLinks) return [];
    
    const linkedClientIds = new Set(currentProject.clientLinks.map(l => l.clientId));
    return currentProject.clientsImportes.filter(c => linkedClientIds.has(c.id));
  }, [currentProject.clientsImportes, currentProject.clientLinks]);
  
  // Client sélectionné
  const selectedClient = useMemo(() => {
    if (!selectedClientId) return null;
    return linkedClients.find(c => c.id === selectedClientId) || null;
  }, [selectedClientId, linkedClients]);
  
  // Noeud associé au client
  const linkedNode = useMemo(() => {
    if (!selectedClient || !currentProject.clientLinks) return null;
    const link = currentProject.clientLinks.find(l => l.clientId === selectedClient.id);
    if (!link) return null;
    return currentProject.nodes.find(n => n.id === link.nodeId) || null;
  }, [selectedClient, currentProject.clientLinks, currentProject.nodes]);
  
  // Câble sélectionné
  const selectedCable = useMemo(() => {
    return branchementCableTypes.find(c => c.id === selectedCableId) || branchementCableTypes[0];
  }, [selectedCableId]);
  
  // Câbles compatibles avec le type de raccordement du client
  const compatibleCables = useMemo(() => {
    if (!selectedClient) return branchementCableTypes;
    return getCompatibleBranchementCables(selectedClient.connectionType || 'MONO');
  }, [selectedClient]);
  
  // Longueur calculée automatiquement
  const calculatedLength = useMemo(() => {
    if (!selectedClient || !linkedNode) return 0;
    return calculateGeodeticDistance(
      linkedNode.lat, linkedNode.lng,
      selectedClient.lat, selectedClient.lng
    );
  }, [selectedClient, linkedNode]);
  
  // Longueur effective (manuelle ou calculée)
  const effectiveLength = useManualLength && manualLength !== null ? manualLength : calculatedLength;
  
  // Récupérer les tensions au noeud depuis les résultats de calcul
  const nodeVoltages = useMemo(() => {
    if (!linkedNode) return { L1: 230, L2: 230, L3: 230 };
    
    const results = isSimulationActive ? simulationResults : calculationResults;
    const scenarioResult = results[selectedScenario];
    
    if (!scenarioResult?.nodeMetricsPerPhase) {
      // Fallback sur la tension source
      const sourceVoltage = currentProject.transformerConfig?.sourceVoltage || 
        (currentProject.voltageSystem === 'TRIPHASÉ_230V' ? 230 : 230);
      return { L1: sourceVoltage, L2: sourceVoltage, L3: sourceVoltage };
    }
    
    const nodeMetrics = scenarioResult.nodeMetricsPerPhase[linkedNode.id];
    if (!nodeMetrics) {
      const sourceVoltage = currentProject.transformerConfig?.sourceVoltage || 230;
      return { L1: sourceVoltage, L2: sourceVoltage, L3: sourceVoltage };
    }
    
    return {
      L1: nodeMetrics.A?.voltage || 230,
      L2: nodeMetrics.B?.voltage || 230,
      L3: nodeMetrics.C?.voltage || 230
    };
  }, [linkedNode, calculationResults, simulationResults, isSimulationActive, selectedScenario, currentProject]);
  
  // Récupérer les coefficients de foisonnement selon le type de client
  const foisonnementCharges = useMemo(() => {
    if (!selectedClient) return currentProject.foisonnementChargesResidentiel || 15;
    return selectedClient.clientType === 'industriel' 
      ? (currentProject.foisonnementChargesIndustriel || 70)
      : (currentProject.foisonnementChargesResidentiel || 15);
  }, [selectedClient, currentProject]);
  
  const foisonnementProductions = currentProject.foisonnementProductions || 100;
  const cosPhiCharges = currentProject.cosPhiCharges || 0.95;
  const cosPhiProductions = currentProject.cosPhiProductions || 1.0;
  
  // Récupérer le déséquilibre du projet
  const desequilibre = useMemo(() => {
    const manual = currentProject.manualPhaseDistribution?.charges;
    if (manual) {
      return { A: manual.A, B: manual.B, C: manual.C };
    }
    return { A: 33.33, B: 33.33, C: 33.34 };
  }, [currentProject.manualPhaseDistribution]);
  
  // Calcul des résultats
  const calculationResult = useMemo(() => {
    if (!selectedClient || !selectedCable || effectiveLength <= 0) return null;
    
    return calculateClientVoltage(
      nodeVoltages,
      selectedClient,
      selectedCable,
      effectiveLength,
      currentProject.voltageSystem,
      foisonnementCharges,
      foisonnementProductions,
      cosPhiCharges,
      cosPhiProductions,
      desequilibre
    );
  }, [
    selectedClient, 
    selectedCable, 
    effectiveLength, 
    nodeVoltages, 
    currentProject.voltageSystem,
    foisonnementCharges,
    foisonnementProductions,
    cosPhiCharges,
    cosPhiProductions,
    desequilibre
  ]);
  
  // Reset du câble si incompatible
  useEffect(() => {
    if (selectedClient && !compatibleCables.find(c => c.id === selectedCableId)) {
      setSelectedCableId(compatibleCables[0]?.id || '');
    }
  }, [selectedClient, compatibleCables, selectedCableId]);
  
  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        
        {/* Card Sélection Client */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Sélection du raccordement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {linkedClients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun raccordement lié à un nœud. Liez d'abord des raccordements dans l'onglet Raccordements.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Raccordement</Label>
                  <Select value={selectedClientId || ''} onValueChange={setSelectedClientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un raccordement" />
                    </SelectTrigger>
                    <SelectContent>
                      {linkedClients.map(client => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.nomCircuit || client.identifiantCircuit} 
                          {' - '}{client.puissanceContractuelle_kVA} kVA
                          {client.connectionType && ` (${client.connectionType})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {selectedClient && (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={selectedClient.connectionType === 'MONO' ? 'secondary' : 'default'}>
                        {selectedClient.connectionType || 'MONO'}
                      </Badge>
                      <Badge variant="outline">
                        {currentProject.voltageSystem === 'TRIPHASÉ_230V' ? '230V △' : '400V ⭐'}
                      </Badge>
                      <Badge variant={selectedClient.clientType === 'industriel' ? 'default' : 'secondary'}>
                        {selectedClient.clientType === 'industriel' ? '🏭' : '🏠'} {selectedClient.clientType || 'résidentiel'}
                      </Badge>
                    </div>
                    
                    {linkedNode && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        Nœud : {linkedNode.name || linkedNode.id}
                      </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-2 mt-2 p-2 bg-muted/50 rounded">
                      <div>
                        <span className="text-muted-foreground">Charge :</span>
                        <span className="ml-1 font-medium">{selectedClient.puissanceContractuelle_kVA} kVA</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Production :</span>
                        <span className="ml-1 font-medium">{selectedClient.puissancePV_kVA} kVA</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        
        {/* Card Câble de branchement */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cable className="h-4 w-4" />
              Câble de branchement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Type de câble</Label>
              <Select value={selectedCableId} onValueChange={setSelectedCableId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un câble" />
                </SelectTrigger>
                <SelectContent>
                  {compatibleCables.map(cable => (
                    <SelectItem key={cable.id} value={cable.id}>
                      {cable.label} - {cable.maxCurrent_A}A max
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {selectedCable && (
              <div className="text-sm space-y-1 p-2 bg-muted/50 rounded">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Résistance :</span>
                  <span>{selectedCable.R_ohm_per_km} Ω/km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Réactance :</span>
                  <span>{selectedCable.X_ohm_per_km} Ω/km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Imax :</span>
                  <span>{selectedCable.maxCurrent_A} A</span>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Longueur (m)</Label>
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="manualLength" 
                    checked={useManualLength}
                    onCheckedChange={(checked) => setUseManualLength(checked as boolean)}
                  />
                  <Label htmlFor="manualLength" className="text-xs text-muted-foreground">
                    Ajuster
                  </Label>
                </div>
              </div>
              
              {useManualLength ? (
                <Input 
                  type="number" 
                  value={manualLength ?? Math.round(calculatedLength)}
                  onChange={(e) => setManualLength(parseFloat(e.target.value) || 0)}
                  min={0}
                  step={1}
                />
              ) : (
                <div className="p-2 bg-muted/50 rounded text-sm">
                  {calculatedLength > 0 
                    ? `${calculatedLength.toFixed(1)} m (calculé GPS)`
                    : 'Sélectionnez un raccordement'
                  }
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Card Tensions au nœud */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Tensions au nœud
            </CardTitle>
          </CardHeader>
          <CardContent>
            {linkedNode ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 bg-blue-500/10 rounded">
                    <div className="text-xs text-muted-foreground">L1</div>
                    <div className="font-medium">{nodeVoltages.L1.toFixed(1)} V</div>
                  </div>
                  <div className="p-2 bg-green-500/10 rounded">
                    <div className="text-xs text-muted-foreground">L2</div>
                    <div className="font-medium">{nodeVoltages.L2.toFixed(1)} V</div>
                  </div>
                  <div className="p-2 bg-orange-500/10 rounded">
                    <div className="text-xs text-muted-foreground">L3</div>
                    <div className="font-medium">{nodeVoltages.L3.toFixed(1)} V</div>
                  </div>
                </div>
                
                <div className="text-xs text-muted-foreground mt-2">
                  Scénario : {selectedScenario}
                  {isSimulationActive && <Badge variant="outline" className="ml-2">Simulation</Badge>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sélectionnez un raccordement lié à un nœud
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Card Résultats */}
      {calculationResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Tension chez le raccordement
              
              {/* Alertes */}
              {!calculationResult.cableCompatible && (
                <Badge variant="destructive" className="ml-2">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Câble incompatible
                </Badge>
              )}
              {calculationResult.cableOverloaded && (
                <Badge variant="destructive" className="ml-2">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Câble surchargé ({calculationResult.maxCurrent.toFixed(1)}A &gt; {selectedCable.maxCurrent_A}A)
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Puissances foisonnées */}
            <div className="mb-4 p-3 bg-muted/30 rounded-lg">
              <div className="text-xs text-muted-foreground mb-2">Puissances foisonnées</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Charge :</span>
                  <span className="ml-1">
                    {selectedClient!.puissanceContractuelle_kVA} kVA × {foisonnementCharges}% = 
                    <span className="font-medium ml-1">
                      {(selectedClient!.puissanceContractuelle_kVA * foisonnementCharges / 100).toFixed(2)} kVA
                    </span>
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Production :</span>
                  <span className="ml-1">
                    {selectedClient!.puissancePV_kVA} kVA × {foisonnementProductions}% = 
                    <span className="font-medium ml-1">
                      {(selectedClient!.puissancePV_kVA * foisonnementProductions / 100).toFixed(2)} kVA
                    </span>
                  </span>
                </div>
              </div>
            </div>
            
            {/* Tableau des résultats par phase */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Phase</th>
                    <th className="text-right p-2">V nœud</th>
                    <th className="text-right p-2">I charge</th>
                    <th className="text-right p-2">I prod</th>
                    <th className="text-right p-2">I net</th>
                    <th className="text-right p-2">ΔU charge</th>
                    <th className="text-right p-2">ΔU prod</th>
                    <th className="text-right p-2">ΔU net</th>
                    <th className="text-right p-2">V client</th>
                    <th className="text-center p-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {calculationResult.phases.map((phase) => (
                    <tr key={phase.phase} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-medium">{phase.phase}</td>
                      <td className="text-right p-2">{phase.V_node.toFixed(1)} V</td>
                      <td className="text-right p-2 text-blue-600">{phase.I_charge.toFixed(2)} A</td>
                      <td className="text-right p-2 text-green-600">{phase.I_prod.toFixed(2)} A</td>
                      <td className="text-right p-2 font-medium">{phase.I_net.toFixed(2)} A</td>
                      <td className="text-right p-2 text-red-500">-{phase.deltaU_charge.toFixed(2)} V</td>
                      <td className="text-right p-2 text-green-500">+{phase.deltaU_prod.toFixed(2)} V</td>
                      <td className="text-right p-2 font-medium">
                        {phase.deltaU_net >= 0 ? '-' : '+'}{Math.abs(phase.deltaU_net).toFixed(2)} V
                      </td>
                      <td className="text-right p-2 font-bold">{phase.V_client.toFixed(1)} V</td>
                      <td className="text-center p-2">
                        {phase.status === 'normal' && (
                          <Badge variant="default" className="bg-green-500">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            OK
                          </Badge>
                        )}
                        {phase.status === 'warning' && (
                          <Badge variant="secondary" className="bg-yellow-500 text-black">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            ±5%
                          </Badge>
                        )}
                        {phase.status === 'critical' && (
                          <Badge variant="destructive">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            ±10%
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Légende conformité */}
            <div className="mt-4 text-xs text-muted-foreground flex gap-4">
              <span>Conformité EN50160 :</span>
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" /> Normal (207-253V)
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-yellow-500" /> Warning (±5%)
              </span>
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-red-500" /> Critical (±10%)
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
