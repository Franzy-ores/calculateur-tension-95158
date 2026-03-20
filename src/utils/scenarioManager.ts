/**
 * Gestionnaire de Scénarios - Sauvegarde et Comparaison
 * 
 * Permet de sauvegarder, charger et comparer différentes configurations
 * d'analyse réseau 24h.
 */

import type { HourlyVoltageResult, DailySimulationOptions } from '@/types/dailyProfile';

/**
 * Scénario sauvegardé avec configuration et résultats
 */
export interface SavedScenario {
  /** Identifiant unique */
  id: string;
  /** Nom du scénario */
  name: string;
  /** Date de création */
  date: Date;
  /** Description optionnelle */
  description?: string;
  /** Configuration utilisée */
  configuration: ScenarioConfiguration;
  /** Résultats de tension 24h */
  results: HourlyVoltageResult[];
  /** Tags pour filtrage */
  tags?: string[];
}

/**
 * Configuration d'un scénario
 */
export interface ScenarioConfiguration {
  /** Saison */
  season: 'winter' | 'summer';
  /** Météo */
  weather: 'sunny' | 'gray';
  /** Taux de pénétration VE (%) */
  evPenetration: number;
  /** Puissance VE (kW) */
  evPower: 3.7 | 11 | 22;
  /** Taux de pénétration PAC (%) */
  pacPenetration: number;
  /** Puissance PAC (kW) */
  pacPower: number;
  /** Coefficient foisonnement manuel */
  customDiversityCoeff?: number;
  /** Mode adaptatif actif */
  adaptiveFoisonnement?: boolean;
  /** Profils personnalisés */
  customProfiles?: any;
  /** Nœud sélectionné */
  selectedNodeId?: string;
  /** Cluster sélectionné */
  selectedClusterId?: string;
}

const STORAGE_KEY = 'labo_saved_scenarios';
const MAX_SCENARIOS = 50; // Limite pour éviter de saturer le localStorage

/**
 * Sauvegarde un scénario dans le localStorage
 */
export function saveScenario(
  name: string,
  configuration: ScenarioConfiguration,
  results: HourlyVoltageResult[],
  description?: string,
  tags?: string[]
): SavedScenario {
  const scenario: SavedScenario = {
    id: `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    date: new Date(),
    description,
    configuration,
    results,
    tags,
  };

  const scenarios = loadAllScenarios();
  scenarios.unshift(scenario); // Ajouter au début

  // Limiter le nombre de scénarios
  if (scenarios.length > MAX_SCENARIOS) {
    scenarios.length = MAX_SCENARIOS;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
    return scenario;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du scénario:', error);
    // Si quota dépassé, supprimer les plus anciens
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const reducedScenarios = scenarios.slice(0, Math.floor(MAX_SCENARIOS / 2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reducedScenarios));
      throw new Error('Quota de stockage dépassé. Anciens scénarios supprimés.');
    }
    throw error;
  }
}

/**
 * Charge tous les scénarios sauvegardés
 */
export function loadAllScenarios(): SavedScenario[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const scenarios = JSON.parse(stored);
    
    // Convertir les dates
    return scenarios.map((s: any) => ({
      ...s,
      date: new Date(s.date),
    }));
  } catch (error) {
    console.error('Erreur lors du chargement des scénarios:', error);
    return [];
  }
}

/**
 * Charge un scénario par son ID
 */
export function loadScenario(id: string): SavedScenario | null {
  const scenarios = loadAllScenarios();
  return scenarios.find(s => s.id === id) || null;
}

/**
 * Supprime un scénario
 */
export function deleteScenario(id: string): boolean {
  const scenarios = loadAllScenarios();
  const filtered = scenarios.filter(s => s.id !== id);
  
  if (filtered.length === scenarios.length) {
    return false; // Scénario non trouvé
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Erreur lors de la suppression du scénario:', error);
    return false;
  }
}

/**
 * Met à jour le nom ou la description d'un scénario
 */
export function updateScenario(
  id: string,
  updates: Partial<Pick<SavedScenario, 'name' | 'description' | 'tags'>>
): boolean {
  const scenarios = loadAllScenarios();
  const index = scenarios.findIndex(s => s.id === id);
  
  if (index === -1) return false;

  scenarios[index] = {
    ...scenarios[index],
    ...updates,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
    return true;
  } catch (error) {
    console.error('Erreur lors de la mise à jour du scénario:', error);
    return false;
  }
}

/**
 * Recherche des scénarios par tags ou nom
 */
export function searchScenarios(query: string): SavedScenario[] {
  const scenarios = loadAllScenarios();
  const lowerQuery = query.toLowerCase();

  return scenarios.filter(s => 
    s.name.toLowerCase().includes(lowerQuery) ||
    s.description?.toLowerCase().includes(lowerQuery) ||
    s.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Compare deux scénarios et retourne les différences
 */
export function compareScenarios(
  scenario1: SavedScenario,
  scenario2: SavedScenario
): ScenarioComparison {
  const config1 = scenario1.configuration;
  const config2 = scenario2.configuration;

  const configDifferences: string[] = [];

  if (config1.season !== config2.season) {
    configDifferences.push(`Saison: ${config1.season} vs ${config2.season}`);
  }
  if (config1.weather !== config2.weather) {
    configDifferences.push(`Météo: ${config1.weather} vs ${config2.weather}`);
  }
  if (config1.evPenetration !== config2.evPenetration) {
    configDifferences.push(`VE: ${config1.evPenetration}% vs ${config2.evPenetration}%`);
  }
  if (config1.evPower !== config2.evPower) {
    configDifferences.push(`Puissance VE: ${config1.evPower}kW vs ${config2.evPower}kW`);
  }
  if (config1.pacPenetration !== config2.pacPenetration) {
    configDifferences.push(`PAC: ${config1.pacPenetration}% vs ${config2.pacPenetration}%`);
  }

  // Comparer les résultats
  const voltages1 = scenario1.results.map(r => r.voltage);
  const voltages2 = scenario2.results.map(r => r.voltage);

  const avg1 = voltages1.reduce((a, b) => a + b, 0) / voltages1.length;
  const avg2 = voltages2.reduce((a, b) => a + b, 0) / voltages2.length;

  const min1 = Math.min(...voltages1);
  const min2 = Math.min(...voltages2);

  const max1 = Math.max(...voltages1);
  const max2 = Math.max(...voltages2);

  // Compter violations
  const violations1 = countViolations(scenario1.results);
  const violations2 = countViolations(scenario2.results);

  return {
    scenario1Name: scenario1.name,
    scenario2Name: scenario2.name,
    configDifferences,
    metrics: {
      avgVoltageDiff: avg2 - avg1,
      minVoltageDiff: min2 - min1,
      maxVoltageDiff: max2 - max1,
      violations5Diff: violations2.violations5 - violations1.violations5,
      violations10Diff: violations2.violations10 - violations1.violations10,
    },
    betterScenario: determineB etterScenario(violations1, violations2, avg1, avg2),
  };
}

/**
 * Résultat de comparaison entre scénarios
 */
export interface ScenarioComparison {
  scenario1Name: string;
  scenario2Name: string;
  configDifferences: string[];
  metrics: {
    avgVoltageDiff: number;
    minVoltageDiff: number;
    maxVoltageDiff: number;
    violations5Diff: number;
    violations10Diff: number;
  };
  betterScenario: 1 | 2 | null;
}

/**
 * Compte les violations dans les résultats
 */
function countViolations(results: HourlyVoltageResult[]): { violations5: number; violations10: number } {
  let violations5 = 0;
  let violations10 = 0;

  for (const result of results) {
    const deviation = Math.abs((result.voltage - 230) / 230 * 100);
    if (deviation >= 10) {
      violations10++;
    } else if (deviation >= 5) {
      violations5++;
    }
  }

  return { violations5, violations10 };
}

/**
 * Détermine quel scénario est meilleur
 */
function determineBetterScenario(
  violations1: { violations5: number; violations10: number },
  violations2: { violations5: number; violations10: number },
  avg1: number,
  avg2: number
): 1 | 2 | null {
  // Priorité aux violations critiques
  if (violations1.violations10 !== violations2.violations10) {
    return violations1.violations10 < violations2.violations10 ? 1 : 2;
  }

  // Ensuite violations 5%
  if (violations1.violations5 !== violations2.violations5) {
    return violations1.violations5 < violations2.violations5 ? 1 : 2;
  }

  // Enfin, proximité à 230V
  const dev1 = Math.abs(avg1 - 230);
  const dev2 = Math.abs(avg2 - 230);

  if (Math.abs(dev1 - dev2) < 0.1) {
    return null; // Équivalent
  }

  return dev1 < dev2 ? 1 : 2;
}

/**
 * Exporte tous les scénarios en JSON
 */
export function exportScenariosToJSON(): string {
  const scenarios = loadAllScenarios();
  return JSON.stringify(scenarios, null, 2);
}

/**
 * Importe des scénarios depuis JSON
 */
export function importScenariosFromJSON(jsonString: string): number {
  try {
    const imported = JSON.parse(jsonString);
    
    if (!Array.isArray(imported)) {
      throw new Error('Format invalide: attendu un tableau de scénarios');
    }

    const existing = loadAllScenarios();
    const combined = [...imported, ...existing];

    // Dédupliquer par ID
    const unique = combined.reduce((acc, scenario) => {
      if (!acc.find((s: SavedScenario) => s.id === scenario.id)) {
        acc.push(scenario);
      }
      return acc;
    }, [] as SavedScenario[]);

    // Limiter
    const limited = unique.slice(0, MAX_SCENARIOS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
    return imported.length;
  } catch (error) {
    console.error('Erreur lors de l\'importation:', error);
    throw error;
  }
}

/**
 * Efface tous les scénarios sauvegardés
 */
export function clearAllScenarios(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Obtient des statistiques sur les scénarios
 */
export function getScenarioStatistics(): {
  total: number;
  byseason: { winter: number; summer: number };
  avgViolations: number;
  storageUsed: number;
} {
  const scenarios = loadAllScenarios();

  const byseason = {
    winter: scenarios.filter(s => s.configuration.season === 'winter').length,
    summer: scenarios.filter(s => s.configuration.season === 'summer').length,
  };

  const totalViolations = scenarios.reduce((sum, s) => {
    const v = countViolations(s.results);
    return sum + v.violations5 + v.violations10;
  }, 0);

  const avgViolations = scenarios.length > 0 ? totalViolations / scenarios.length : 0;

  // Estimer l'utilisation du storage
  const stored = localStorage.getItem(STORAGE_KEY);
  const storageUsed = stored ? new Blob([stored]).size : 0;

  return {
    total: scenarios.length,
    byseason,
    avgViolations,
    storageUsed,
  };
}
