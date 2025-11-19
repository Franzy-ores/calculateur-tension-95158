import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ClientImporte, ClientLink, Node, ClientGroupe } from '@/types/network';
import { getClientMarkerColor, groupColocatedClients } from '@/utils/clientsUtils';
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
  const groupeMarkersRef = useRef<Map<string, L.Marker>>(new Map());
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
    groupeMarkersRef.current.forEach(marker => map.removeLayer(marker));
    groupeMarkersRef.current.clear();
    
    linkLinesRef.current.forEach(line => map.removeLayer(line));
    linkLinesRef.current.clear();

    // Regrouper les clients co-localisés
    const { groupes, clientsIsoles } = groupColocatedClients(clients);

    // Créer les marqueurs pour les groupes
    groupes.forEach(groupe => {
      // Déterminer la couleur du groupe (prend la couleur du premier client pour simplicité)
      const firstClient = groupe.clients[0];
      const color = getClientMarkerColor(firstClient, colorMode, circuitColorMapping, links);
      const hasProduction = groupe.puissancePV_kVA > 0;
      
      const icon = L.divIcon({
        className: 'client-groupe-marker',
        html: hasProduction 
          ? `<div class="relative hover:scale-125 transition-transform" style="width: 24px; height: 24px; cursor: grab;">
               <div class="absolute inset-0 rounded-full border-2 border-yellow-400" style="box-shadow: 0 0 8px rgba(250, 204, 21, 0.7);"></div>
               <div class="absolute" style="top: 3px; left: 3px; width: 18px; height: 18px; background-color: ${color}; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
                 <span style="font-size: 10px; font-weight: bold; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${groupe.nombreClients}</span>
               </div>
             </div>`
          : `<div class="w-5 h-5 rounded-full shadow-lg hover:scale-125 transition-transform flex items-center justify-center" style="background-color: ${color}; border: 2px solid white; cursor: grab;">
               <span style="font-size: 10px; font-weight: bold; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${groupe.nombreClients}</span>
             </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      
      const marker = L.marker([groupe.lat, groupe.lng], { 
        icon,
        draggable: true,
        autoPan: true,
        zIndexOffset: 2000 // Plus élevé que les clients isolés
      });

      // Popup détaillé pour le groupe avec boutons Éditer
      const popupElement = document.createElement('div');
      popupElement.style.minWidth = '280px';
      popupElement.style.maxHeight = '400px';
      popupElement.style.overflowY = 'auto';
      
      // Header du groupe
      const header = document.createElement('div');
      header.style.position = 'sticky';
      header.style.top = '0';
      header.style.background = 'white';
      header.style.paddingBottom = '8px';
      header.style.borderBottom = '2px solid #3b82f6';
      header.style.marginBottom = '8px';
      header.innerHTML = `
        <strong style="font-size: 14px;">Groupe de ${groupe.nombreClients} clients</strong><br>
        <div style="margin-top: 4px; font-size: 12px; color: #666;">
          <strong>Charge totale:</strong> ${groupe.puissanceContractuelle_kVA.toFixed(1)} kVA<br>
          <strong>PV total:</strong> ${groupe.puissancePV_kVA.toFixed(1)} kVA
        </div>
      `;
      popupElement.appendChild(header);
      
      // Liste des clients avec boutons "Éditer"
      groupe.clients.forEach((c, idx) => {
        const clientRow = document.createElement('div');
        clientRow.style.padding = '6px';
        clientRow.style.margin = '4px 0';
        clientRow.style.border = '1px solid #e5e7eb';
        clientRow.style.borderRadius = '4px';
        clientRow.style.background = idx % 2 === 0 ? '#f9fafb' : 'white';
        
        clientRow.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; font-size: 12px; color: #111827;">${c.nomCircuit}</div>
              <div style="font-size: 10px; color: #6b7280; margin-top: 2px;">
                ${c.identifiantCircuit}<br>
                ${c.rawData?.['Rue'] || c.rawData?.['Numéro de rue'] ? `${c.rawData?.['Rue'] || ''} ${c.rawData?.['Numéro de rue'] || ''}<br>` : ''}
                <span style="color: #059669;">${c.couplage}</span> | 
                <span style="color: #dc2626;">${c.puissanceContractuelle_kVA.toFixed(1)} kVA</span>
                ${c.puissancePV_kVA > 0 ? ` | <span style="color: #f59e0b;">PV: ${c.puissancePV_kVA.toFixed(1)} kVA</span>` : ''}
              </div>
            </div>
            <button 
              class="edit-client-btn" 
              data-client-id="${c.id}"
              style="
                padding: 4px 8px; 
                background: #3b82f6; 
                color: white; 
                border: none; 
                border-radius: 4px; 
                cursor: pointer; 
                font-size: 10px;
                font-weight: 600;
                white-space: nowrap;
                flex-shrink: 0;
              "
            >
              Éditer
            </button>
          </div>
        `;
        
        popupElement.appendChild(clientRow);
      });
      
      marker.bindPopup(popupElement, { maxWidth: 350 });
      
      // Attacher les événements click aux boutons après l'ouverture de la popup
      marker.on('popupopen', () => {
        const editButtons = popupElement.querySelectorAll('.edit-client-btn');
        editButtons.forEach(btn => {
          const handleClick = (e: Event) => {
            e.stopPropagation();
            const clientId = (btn as HTMLElement).dataset.clientId;
            if (clientId && onClientClick) {
              onClientClick(clientId);
              marker.closePopup();
            }
          };
          
          btn.addEventListener('click', handleClick);
          
          // Effets hover
          btn.addEventListener('mouseenter', () => {
            (btn as HTMLElement).style.background = '#2563eb';
          });
          btn.addEventListener('mouseleave', () => {
            (btn as HTMLElement).style.background = '#3b82f6';
          });
        });
      });
      
      // Tooltip au survol
      const tooltipContent = `
        <div style="font-size: 11px; line-height: 1.4; white-space: nowrap;">
          <strong>Groupe (${groupe.nombreClients} clients)</strong><br>
          <span style="color: #666;">Charge: ${groupe.puissanceContractuelle_kVA.toFixed(1)} kVA</span>
          ${groupe.puissancePV_kVA > 0 ? `<br><span style="color: #666;">PV: ${groupe.puissancePV_kVA.toFixed(1)} kVA</span>` : ''}
        </div>
      `;
      marker.bindTooltip(tooltipContent, {
        permanent: false,
        direction: 'top',
        offset: [0, -12],
        className: 'client-hover-tooltip',
        opacity: 0.95
      });

      // Gestion du drag & drop pour le groupe
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
            { color: '#8b5cf6', weight: 3, opacity: 0.6, dashArray: '5, 10' }
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
              { radius: 30, color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.2, weight: 2 }
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
        
        // Vérifier si on a lâché sur un nœud
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
          // Lier TOUS les clients du groupe automatiquement
          groupe.clientIds.forEach(clientId => {
            onClientDragToNode(clientId, droppedOnNode.id);
          });
        }
        
        // Toujours revenir à la position initiale
        marker.setLatLng(initialPosition);
        
        const element = marker.getElement();
        if (element) {
          element.style.cursor = 'grab';
        }
        
        map.dragging.enable();
      });
      
      marker.addTo(map);
      groupeMarkersRef.current.set(groupe.id, marker);
    });

    // Créer les marqueurs pour les clients isolés
    clientsIsoles.forEach(client => {
      const color = getClientMarkerColor(client, colorMode, circuitColorMapping, links);
      const isSelected = selectedClientId === client.id;
      const borderColor = isSelected ? '#22c55e' : 'white';
      const borderWidth = isSelected ? 3 : 2;
      
      // Ajouter un cercle jaune si le client a une production PV
      const hasProduction = client.puissancePV_kVA > 0;
      const iconSize = hasProduction ? 18 : 12;
      const iconAnchor = hasProduction ? 9 : 6;
      
      const icon = L.divIcon({
        className: 'client-marker',
        html: hasProduction 
          ? `<div class="relative ${isSelected ? 'animate-pulse' : 'hover:scale-125 transition-transform'}" style="width: 18px; height: 18px; cursor: grab;">
               <div class="absolute inset-0 rounded-full border-2 border-yellow-400" style="box-shadow: 0 0 6px rgba(250, 204, 21, 0.6);"></div>
               <div class="absolute" style="top: 3px; left: 3px; width: 12px; height: 12px; background-color: ${color}; border: ${borderWidth}px solid ${borderColor}; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>
             </div>`
          : `<div class="w-3 h-3 rounded-full shadow-lg ${isSelected ? 'animate-pulse' : 'hover:scale-125 transition-transform'}" style="background-color: ${color}; border: ${borderWidth}px solid ${borderColor}; cursor: grab;"></div>`,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconAnchor, iconAnchor]
      });
      
      const marker = L.marker([client.lat, client.lng], { 
        icon,
        draggable: true,
        autoPan: true,
        zIndexOffset: 1000
      });

      // Affichage conditionnel : permanent si showTensionLabels, sinon au survol
      if (showTensionLabels && (client.tensionMin_V || client.tensionMax_V)) {
        // Mode label permanent : afficher uniquement les tensions
        const tensionLabel = `<div style="
          font-size: 10px;
          font-weight: 600;
          color: #f59e0b;
          background: rgba(255, 255, 255, 0.95);
          padding: 2px 4px;
          border-radius: 3px;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          border: 1px solid #f59e0b;
        ">
          ${(client.tensionMin_V || 0).toFixed(1)}V / ${(client.tensionMax_V || 0).toFixed(1)}V
        </div>`;
        
        marker.bindTooltip(tensionLabel, {
          permanent: true,
          direction: 'right',
          offset: [8, 0],
          className: 'client-tension-label-permanent',
          opacity: 1
        });
      } else {
        // Mode normal : tooltip au survol avec toutes les infos
        const tooltipContent = `
          <div style="font-size: 11px; line-height: 1.4; white-space: nowrap;">
            <strong>${client.nomCircuit || client.identifiantCircuit}</strong><br>
            <span style="color: #666;">Couplage: ${client.couplage}</span><br>
            <span style="color: #666;">Charge: ${client.puissanceContractuelle_kVA.toFixed(1)} kVA</span>
            ${client.puissancePV_kVA > 0 ? `<br><span style="color: #666;">PV: ${client.puissancePV_kVA.toFixed(1)} kVA</span>` : ''}
            ${(client.tensionMin_V || client.tensionMax_V) ? `<br><span style="color: #f59e0b;">Min: ${(client.tensionMin_V || 0).toFixed(1)}V / Max: ${(client.tensionMax_V || 0).toFixed(1)}V</span>` : ''}
          </div>
        `;

        marker.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          offset: [0, -10],
          className: 'client-hover-tooltip',
          opacity: 0.95
        });
      }

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
          ${client.rawData?.['Rue'] || client.rawData?.['Numéro de rue'] ? `<strong>Adresse:</strong> ${client.rawData?.['Rue'] || ''} ${client.rawData?.['Numéro de rue'] || ''}<br>` : ''}
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
      groupeMarkersRef.current.forEach(marker => map.removeLayer(marker));
      linkLinesRef.current.forEach(line => map.removeLayer(line));
      if (dragLineRef.current) map.removeLayer(dragLineRef.current);
      if (highlightCircleRef.current) map.removeLayer(highlightCircleRef.current);
    };
  }, [map, clients, links, nodes, selectedClientId, onClientClick, onClientDragToNode, colorMode, circuitColorMapping, showTensionLabels]);

  return { clientMarkersRef, groupeMarkersRef, linkLinesRef };
};
