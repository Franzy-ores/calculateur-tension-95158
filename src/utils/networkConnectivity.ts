import { Node, Cable } from '@/types/network';

/**
 * Calcule les nœuds alimentés (connectés à une source) dans le réseau
 */
export const getConnectedNodes = (nodes: Node[], cables: Cable[]): Set<string> => {
  const sources = nodes.filter(node => node.isSource);
  const connectedNodes = new Set<string>();
  
  // Ajouter toutes les sources comme connectées
  sources.forEach(source => connectedNodes.add(source.id));
  
  // Parcourir iterativement pour trouver tous les nœuds connectés
  let hasChanged = true;
  while (hasChanged) {
    hasChanged = false;
    cables.forEach(cable => {
      const nodeAConnected = connectedNodes.has(cable.nodeAId);
      const nodeBConnected = connectedNodes.has(cable.nodeBId);
      
      if (nodeAConnected && !nodeBConnected) {
        connectedNodes.add(cable.nodeBId);
        hasChanged = true;
      } else if (nodeBConnected && !nodeAConnected) {
        connectedNodes.add(cable.nodeAId);
        hasChanged = true;
      }
    });
  }
  
  return connectedNodes;
};

/**
 * Calcule les câbles connectés (dont au moins un nœud est alimenté)
 */
export const getConnectedCables = (cables: Cable[], connectedNodes: Set<string>): Cable[] => {
  return cables.filter(cable => 
    connectedNodes.has(cable.nodeAId) || connectedNodes.has(cable.nodeBId)
  );
};

/**
 * Identifie tous les nœuds appartenant au même circuit qu'un nœud donné
 * (c'est-à-dire alimentés par la même source)
 */
export const getCircuitNodes = (nodes: Node[], cables: Cable[], nodeId: string): Set<string> => {
  // Trouver la source qui alimente ce nœud
  const connectedNodes = getConnectedNodes(nodes, cables);
  
  // Si le nœud n'est pas connecté, retourner un ensemble vide
  if (!connectedNodes.has(nodeId)) {
    return new Set<string>();
  }
  
  // Trouver quelle source alimente ce nœud en remontant le réseau
  const sources = nodes.filter(node => node.isSource);
  
  for (const source of sources) {
    // Pour chaque source, calculer les nœuds qu'elle alimente
    const sourceConnectedNodes = new Set<string>();
    sourceConnectedNodes.add(source.id);
    
    // Parcourir iterativement pour trouver tous les nœuds connectés à cette source
    let hasChanged = true;
    while (hasChanged) {
      hasChanged = false;
      cables.forEach(cable => {
        const nodeAConnected = sourceConnectedNodes.has(cable.nodeAId);
        const nodeBConnected = sourceConnectedNodes.has(cable.nodeBId);
        
        if (nodeAConnected && !nodeBConnected) {
          sourceConnectedNodes.add(cable.nodeBId);
          hasChanged = true;
        } else if (nodeBConnected && !nodeAConnected) {
          sourceConnectedNodes.add(cable.nodeAId);
          hasChanged = true;
        }
      });
    }
    
    // Si cette source alimente notre nœud, retourner tous les nœuds de ce circuit
    if (sourceConnectedNodes.has(nodeId)) {
      return sourceConnectedNodes;
    }
  }
  
  // Si aucune source n'alimente ce nœud (ne devrait pas arriver si le nœud est connecté)
  return new Set<string>([nodeId]);
};