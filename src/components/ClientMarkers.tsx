import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ClientImporte, ClientLink } from '@/types/network';

interface ClientMarkersProps {
  map: L.Map;
  clients: ClientImporte[];
  links: ClientLink[];
  onClientClick?: (clientId: string) => void;
}

export const useClientMarkers = ({ map, clients, links, onClientClick }: ClientMarkersProps) => {
  const clientMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const linkLinesRef = useRef<Map<string, L.Polyline>>(new Map());

  useEffect(() => {
    if (!map || !clients) return;

    // Nettoyer les marqueurs existants
    clientMarkersRef.current.forEach(marker => map.removeLayer(marker));
    clientMarkersRef.current.clear();
    
    linkLinesRef.current.forEach(line => map.removeLayer(line));
    linkLinesRef.current.clear();

    // Créer les marqueurs clients
    clients.forEach(client => {
      const color = client.couplage === 'TRI' ? '#3b82f6' : '#f97316';
      
      const icon = L.divIcon({
        className: 'client-marker',
        html: `<div class="w-3 h-3 rounded-full border-2 border-white shadow-md" style="background-color: ${color}"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });
      
      const marker = L.marker([client.lat, client.lng], { icon });
      
      const popupContent = `
        <div style="min-width: 200px;">
          <strong>${client.nomCircuit}</strong><br>
          <strong>ID:</strong> ${client.identifiantCircuit}<br>
          <strong>Couplage:</strong> ${client.couplage}<br>
          <strong>Charge:</strong> ${client.puissanceContractuelle_kVA.toFixed(1)} kVA<br>
          <strong>PV:</strong> ${client.puissancePV_kVA.toFixed(1)} kVA<br>
          ${client.tensionMoyenne_V ? `<strong>U moy:</strong> ${client.tensionMoyenne_V.toFixed(1)} V<br>` : ''}
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

    return () => {
      clientMarkersRef.current.forEach(marker => map.removeLayer(marker));
      linkLinesRef.current.forEach(line => map.removeLayer(line));
    };
  }, [map, clients, links, onClientClick]);

  return { clientMarkersRef, linkLinesRef };
};
