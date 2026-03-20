/**
 * Point d'entrée unifié pour le placement optimal des équipements de régulation.
 */

import { Project, CalculationResult, CalculationScenario } from '@/types/network';
import { findOptimalSRG2Node, SRG2PlacementResult } from './srg2Placement';
import { findOptimalEQUI8PlacementNode, EQUI8PlacementResult } from './equi8Placement';

export { findOptimalSRG2Node } from './srg2Placement';
export { findOptimalEQUI8PlacementNode } from './equi8Placement';
export type { SRG2PlacementResult } from './srg2Placement';
export type { EQUI8PlacementResult } from './equi8Placement';

export interface FullPlacementAnalysis {
  srg2: SRG2PlacementResult;
  equi8: EQUI8PlacementResult;
  summary: string;
}

/**
 * Analyse complète : propose SRG2 ET EQUI8 si pertinents
 */
export function analyzeOptimalEquipmentPlacement(
  project: Project,
  baselineResult: CalculationResult,
  scenario: CalculationScenario,
  onProgress?: (step: string, current: number, total: number) => void
): FullPlacementAnalysis {
  const srg2Analysis = findOptimalSRG2Node(
    project, baselineResult, scenario,
    (c, t) => onProgress?.('SRG2', c, t)
  );
  
  const equi8Analysis = findOptimalEQUI8PlacementNode(
    project, baselineResult, scenario,
    (c, t) => onProgress?.('EQUI8', c, t)
  );

  let summary = '📊 ANALYSE COMPLÈTE DES ÉQUIPEMENTS DE RÉGULATION\n\n';

  if (srg2Analysis.recommendation === 'install_srg2') {
    summary += `✅ SRG2 recommandé sur nœud "${srg2Analysis.nodeName}" (score: ${srg2Analysis.score.toFixed(0)}/100)\n`;
  } else {
    summary += `❌ SRG2 non viable : ${srg2Analysis.reasoning.split('\n')[0]}\n`;
  }

  if (equi8Analysis.recommendation === 'install_equi8') {
    summary += `✅ EQUI8 recommandé sur nœud "${equi8Analysis.nodeName}" (score: ${equi8Analysis.score.toFixed(0)}/100)\n`;
  } else {
    summary += `❌ EQUI8 non viable : ${equi8Analysis.reasoning.split('\n')[0]}\n`;
  }

  return { srg2: srg2Analysis, equi8: equi8Analysis, summary };
}
