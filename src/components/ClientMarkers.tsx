import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ClientImporte, ClientLink, Node } from '@/types/network';
import { getClientMarkerColor } from '@/utils/clientsUtils';
import type { ClientColorMode } from '@/store/networkStore';

interface ClientMarkersProps {
  map: L.Map;
  clients: ClientImporte[];
  links: ClientLink[];
  nodes: Node[];
  selectedClientId?: string | null;
  onClientClick?: (clientId: string) => void;
  onClientDragToNode?: (clientId: string, nodeId: string) => void;
  colorMode: ClientColorMode;
  circuitColorMapping?: Map<string, string>;
  showTensionLabels?: boolean;
}

export const useClientMarkers = ({ map, clients, links, nodes, selectedClientId, onClientClick, onClientDragToNode, colorMode, circuitColorMapping, showTensionLabels = false }: ClientMarkersProps) => {
  const clientMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const linkLinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const dragLineRef = useRef<L.Polyline | null>(null);
  const highlightCircleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && map && !map.dragging.enabled()) {
        map.dragging.enable();
        
        if (dragLineRef.current) {
          map.removeLayer(dragLineRef.current);
          dragLineRef.current = null;
        }
        if (highlightCircleRef.current) {
          map.removeLayer(highlightCircleRef.current);
          highlightCircleRef.current = null;
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !clients) return;

    // Nettoyer les marqueurs existants
    clientMarkersRef.current.forEach(marker => map.removeLayer(marker));
    clientMarkersRef.current.clear();
    
    linkLinesRef.current.forEach(line => map.removeLayer(line));
    linkLinesRef.current.clear();

    // Créer les marqueurs clients
    clients.forEach(client => {
      const color = getClientMarkerColor(client, colorMode, circuitColorMapping, links);
      const isSelected = selectedClientId === client.id;
      const borderColor = isSelected ? '#22c55e' : 'white';
      const borderWidth = isSelected ? 3 : 2;
      
      const icon = L.divIcon({
        className: 'client-marker',
        html: `<div class="w-3 h-3 rounded-full shadow-lg ${isSelected ? 'animate-pulse' : 'hover:scale-125 transition-transform'}" style="background-color: ${color}; border: ${borderWidth}px solid ${borderColor}; cursor: grab;"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });
      
      const marker = L.marker([client.lat, client.lng], { 
        icon,
        draggable: true,
        autoPan: true,
        zIndexOffset: 1000
      });

      // Tooltip au survol avec les informations du client
      const tooltipContent = `
        <div style="font-size: 11px; line-height: 1.4; white-space: nowrap;">
          <strong>${client.nomCircuit || client.identifiantCircuit}</strong><br>
          <span style="color: #666;">Couplage: ${client.couplage}</span><br>
          <span style="color: #666;">Charge: ${client.puissanceContractuelle_kVA.toFixed(1)} kVA</span>
          ${client.puissancePV_kVA > 0 ? `<br><span style="color: #666;">PV: ${client.puissancePV_kVA.toFixed(1)} kVA</span>` : ''}
          ${showTensionLabels && (client.tensionMin_V || client.tensionMax_V) ? `<br><span style="color: #f59e0b;">Min: ${(client.tensionMin_V || 0).toFixed(1)}V / Max: ${(client.tensionMax_V || 0).toFixed(1)}V</span>` : ''}
        </div>
      `;

      marker.bindTooltip(tooltipContent, {
        permanent: false,
        direction: 'top',
        offset: [0, -10],
        className: 'client-hover-tooltip',
        opacity: 0.95
      });

      // Gestion du drag & drop
      let initialPosition: L.LatLng;
      
      marker.on('dragstart', (e) => {
        initialPosition = e.target.getLatLng();
        map.dragging.disable();
        const element = marker.getElement();
        if (element) {
          element.style.cursor = 'grabbing';
        }
      });

      marker.on('drag', (e) => {
        const currentLatLng = e.target.getLatLng();
        
        // Dessiner la ligne temporaire
        if (!dragLineRef.current) {
          dragLineRef.current = L.polyline(
            [[initialPosition.lat, initialPosition.lng], [currentLatLng.lat, currentLatLng.lng]],
            { color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '5, 10' }
          ).addTo(map);
        } else {
          dragLineRef.current.setLatLngs([
            [initialPosition.lat, initialPosition.lng],
            [currentLatLng.lat, currentLatLng.lng]
          ]);
        }
        
        // Trouver le nœud le plus proche
        const closestNode = nodes.reduce<{ node: Node | null; distance: number }>(
          (closest, node) => {
            const distance = map.distance([node.lat, node.lng], [currentLatLng.lat, currentLatLng.lng]);
            if (distance < 30 && distance < closest.distance) {
              return { node, distance };
            }
            return closest;
          },
          { node: null, distance: Infinity }
        );
        
        // Mettre en surbrillance le nœud proche
        if (closestNode.node) {
          if (!highlightCircleRef.current) {
            highlightCircleRef.current = L.circle(
              [closestNode.node.lat, closestNode.node.lng],
              { radius: 30, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.2, weight: 2 }
            ).addTo(map);
          } else {
            highlightCircleRef.current.setLatLng([closestNode.node.lat, closestNode.node.lng]);
          }
        } else if (highlightCircleRef.current) {
          map.removeLayer(highlightCircleRef.current);
          highlightCircleRef.current = null;
        }
      });

      marker.on('dragend', (e) => {
        const dropLatLng = e.target.getLatLng();
        
        // Nettoyer les éléments visuels
        if (dragLineRef.current) {
          map.removeLayer(dragLineRef.current);
          dragLineRef.current = null;
        }
        if (highlightCircleRef.current) {
          map.removeLayer(highlightCircleRef.current);
          highlightCircleRef.current = null;
        }
        
        // Vérifier si on a lâché sur un nœud (trouver le plus proche)
        const closestNodeAtDrop = nodes.reduce<{ node: Node | null; distance: number }>(
          (closest, node) => {
            const distance = map.distance(
              [node.lat, node.lng],
              [dropLatLng.lat, dropLatLng.lng]
            );
            if (distance < 30 && distance < closest.distance) {
              return { node, distance };
            }
            return closest;
          },
          { node: null, distance: Infinity }
        );
        
        const droppedOnNode = closestNodeAtDrop.node;
        
        if (droppedOnNode && onClientDragToNode) {
          onClientDragToNode(client.id, droppedOnNode.id);
        }
        
        // Toujours revenir à la position initiale
        marker.setLatLng(initialPosition);
        
        const element = marker.getElement();
        if (element) {
          element.style.cursor = 'grab';
        }
        
        map.dragging.enable();
      });
      
      const popupContent = `
        <div style="min-width: 200px;">
          <strong>${client.nomCircuit}</strong><br>
          <strong>ID:</strong> ${client.identifiantCircuit}<br>
          <strong>Couplage:</strong> ${client.couplage}<br>
          <strong>Charge:</strong> ${client.puissanceContractuelle_kVA.toFixed(1)} kVA<br>
          <strong>PV:</strong> ${client.puissancePV_kVA.toFixed(1)} kVA<br>
          ${client.tensionMin_V || client.tensionMax_V ? `<strong>U moy:</strong> ${(((client.tensionMin_V || 0) + (client.tensionMax_V || 0)) / 2).toFixed(1)} V<br>` : ''}
          ${client.identifiantCabine ? `<strong>Cabine:</strong> ${client.identifiantCabine}<br>` : ''}
        </div>
      `;
      
      marker.bindPopup(popupContent);
      
      if (onClientClick) {
        marker.on('click', () => onClientClick(client.id));
      }
      
      marker.addTo(map);
      clientMarkersRef.current.set(client.id, marker);
    });

    // Créer les lignes de liaison entre clients et nœuds
    links.forEach(link => {
      const client = clients.find(c => c.id === link.clientId);
      const node = nodes.find(n => n.id === link.nodeId);
      
      if (client && node) {
        const line = L.polyline(
          [[client.lat, client.lng], [node.lat, node.lng]],
          {
            color: '#000000',
            weight: 1.5,
            opacity: 0.6
          }
        ).addTo(map);
        
        linkLinesRef.current.set(link.id, line);
      }
    });

    return () => {
      clientMarkersRef.current.forEach(marker => map.removeLayer(marker));
      linkLinesRef.current.forEach(line => map.removeLayer(line));
      if (dragLineRef.current) map.removeLayer(dragLineRef.current);
      if (highlightCircleRef.current) map.removeLayer(highlightCircleRef.current);
    };
  }, [map, clients, links, nodes, selectedClientId, onClientClick, onClientDragToNode, colorMode, circuitColorMapping, showTensionLabels]);

  return { clientMarkersRef, linkLinesRef };
};
