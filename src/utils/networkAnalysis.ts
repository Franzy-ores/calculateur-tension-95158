import { CalculationResult, Project, Node } from '@/types/network';

/**
 * Calcule la distance d'un nœud à la source en suivant les câbles (BFS).
 */
export function calculateDistanceFromSource(
  node: Node,
  project: Project
): number {
  const sourceNode = project.nodes.find(n => n.isSource);
  if (!sourceNode) return Infinity;
  if (node.id === sourceNode.id) return 0;

  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; distance: number }> = [
    { nodeId: sourceNode.id, distance: 0 }
  ];
  visited.add(sourceNode.id);

  while (queue.length > 0) {
    const { nodeId, distance } = queue.shift()!;

    const connectedCables = project.cables.filter(c =>
      c.nodeAId === nodeId || c.nodeBId === nodeId
    );

    for (const cable of connectedCables) {
      const nextNodeId = cable.nodeAId === nodeId ? cable.nodeBId : cable.nodeAId;

      if (nextNodeId === node.id) {
        return distance + (cable.length_m || 0);
      }

      if (!visited.has(nextNodeId)) {
        visited.add(nextNodeId);
        queue.push({
          nodeId: nextNodeId,
          distance: distance + (cable.length_m || 0)
        });
      }
    }
  }

  return Infinity;
}

/**
 * Trouve tous les nœuds en AVAL d'un nœud donné (s'éloignant de la source).
 * Utilise un parcours directionnel basé sur la distance à la source.
 */
export function findDownstreamNodesFromNode(
  project: Project,
  startNodeId: string
): string[] {
  const sourceNode = project.nodes.find(n => n.isSource);
  if (!sourceNode) {
    console.error('findDownstreamNodes: Aucun nœud source trouvé');
    return [];
  }

  // Étape 1 : Calculer la distance de chaque nœud à la source
  const distanceFromSource = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; distance: number }> = [
    { nodeId: sourceNode.id, distance: 0 }
  ];
  visited.add(sourceNode.id);
  distanceFromSource.set(sourceNode.id, 0);

  while (queue.length > 0) {
    const { nodeId, distance } = queue.shift()!;
    const connectedCables = project.cables.filter(c =>
      c.nodeAId === nodeId || c.nodeBId === nodeId
    );
    for (const cable of connectedCables) {
      const nextNodeId = cable.nodeAId === nodeId ? cable.nodeBId : cable.nodeAId;
      const nextDistance = distance + (cable.length_m || 1);
      if (!visited.has(nextNodeId)) {
        visited.add(nextNodeId);
        distanceFromSource.set(nextNodeId, nextDistance);
        queue.push({ nodeId: nextNodeId, distance: nextDistance });
      }
    }
  }

  // Étape 2 : Parcourir depuis startNode en ne gardant que les nœuds PLUS LOIN
  const startDistance = distanceFromSource.get(startNodeId);
  if (startDistance === undefined) {
    console.error(`findDownstreamNodes: Nœud ${startNodeId} non trouvé dans la topologie`);
    return [];
  }

  const downstream: string[] = [];
  const visitedDownstream = new Set<string>();
  const queueDownstream: string[] = [startNodeId];
  visitedDownstream.add(startNodeId);

  while (queueDownstream.length > 0) {
    const currentId = queueDownstream.shift()!;
    const connectedCables = project.cables.filter(c =>
      c.nodeAId === currentId || c.nodeBId === currentId
    );
    for (const cable of connectedCables) {
      const nextNodeId = cable.nodeAId === currentId ? cable.nodeBId : cable.nodeAId;
      const nextDistance = distanceFromSource.get(nextNodeId);
      if (nextDistance !== undefined && nextDistance > startDistance && !visitedDownstream.has(nextNodeId)) {
        visitedDownstream.add(nextNodeId);
        downstream.push(nextNodeId);
        queueDownstream.push(nextNodeId);
      }
    }
  }

  return downstream;
}

/**
 * Calcule la puissance totale en aval d'un nœud.
 */
export function calculateDownstreamPower(
  downstreamNodeIds: string[],
  project: Project
): number {
  let totalPower_kVA = 0;

  for (const nodeId of downstreamNodeIds) {
    const node = project.nodes.find(n => n.id === nodeId);
    if (node) {
      const chargeTotal = node.clients.reduce((sum, c) => sum + c.S_kVA, 0);
      const prodTotal = node.productions.reduce((sum, p) => sum + p.S_kVA, 0);
      totalPower_kVA += chargeTotal + prodTotal;
    }
  }

  return totalPower_kVA;
}

/**
 * Calcule le courant neutre à un nœud (approximation scalaire).
 */
export function calculateNeutralCurrent(
  nodeMetrics: { currentPerPhase?: { A: number; B: number; C: number } }
): number {
  if (!nodeMetrics.currentPerPhase) return 0;
  const { A, B, C } = nodeMetrics.currentPerPhase;
  return Math.abs(A + B + C);
}

/**
 * Calcule le déséquilibre triphasé (écart-type normalisé des courants).
 */
export function calculateImbalance(
  nodeMetrics: { currentPerPhase?: { A: number; B: number; C: number } }
): number {
  if (!nodeMetrics.currentPerPhase) return 0;

  const { A, B, C } = nodeMetrics.currentPerPhase;
  const I_avg = (Math.abs(A) + Math.abs(B) + Math.abs(C)) / 3;

  if (I_avg < 0.1) return 0;

  const variance = (
    Math.pow(Math.abs(A) - I_avg, 2) +
    Math.pow(Math.abs(B) - I_avg, 2) +
    Math.pow(Math.abs(C) - I_avg, 2)
  ) / 3;

  return Math.sqrt(variance) / I_avg * 100;
}
