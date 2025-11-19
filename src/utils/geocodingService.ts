export interface GeocodeResult {
  lat: number;
  lng: number;
  confidence: number;
  displayName: string;
  status: 'success' | 'failed' | 'ambiguous';
}

/**
 * Géocode une adresse en utilisant l'API Nominatim d'OpenStreetMap
 * @param address - Adresse à géocoder
 * @param countryCode - Codes de pays pour limiter la recherche (par défaut: Belgique, France, Luxembourg)
 * @returns Résultat du géocodage ou null en cas d'erreur
 */
export const geocodeAddress = async (
  address: string, 
  countryCode = 'be,fr,lu'
): Promise<GeocodeResult | null> => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?` +
      `format=json&q=${encodeURIComponent(address)}` +
      `&limit=3&countrycodes=${countryCode}&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'ElectricalNetworkApp/1.0'
        }
      }
    );
    
    if (response.ok) {
      const results = await response.json();
      
      if (results.length === 0) {
        return { 
          lat: 0, 
          lng: 0, 
          confidence: 0, 
          displayName: '', 
          status: 'failed' 
        };
      }
      
      const best = results[0];
      const isAmbiguous = results.length > 1 && 
        Math.abs(parseFloat(results[0].importance) - parseFloat(results[1].importance)) < 0.1;
      
      return {
        lat: parseFloat(best.lat),
        lng: parseFloat(best.lon),
        confidence: parseFloat(best.importance || 0.5),
        displayName: best.display_name,
        status: isAmbiguous ? 'ambiguous' : 'success'
      };
    }
    return null;
  } catch (error) {
    console.error('❌ Erreur de géocodage:', error);
    return null;
  }
};

/**
 * Délai pour respecter le rate limiting de Nominatim (1 requête/seconde)
 * @param ms - Durée du délai en millisecondes
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
