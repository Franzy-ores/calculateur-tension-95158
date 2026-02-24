/**
 * Calcul de puissance nodale par circuit BT
 *
 * Architecture :
 *   1. getClusterDelta()       — multiplicateur horaire résidentiel par cluster
 *   2. diversityFactor()       — f(N, cluster) = a + (1-a)/√N
 *   3. clientHourlyPower()     — puissance individuelle P_i(h)
 *   4. nodeHourlyPower()       — puissance nette P_nœud(h)
 *   5. simulateCircuit()       — résultat complet 24h × saison × météo
 *
 * Toutes les fonctions sont pures (pas d'effets de bord).
 */

import type {
  CircuitClient,
  CircuitCluster,
  CircuitConfig,
  CircuitSeason,
  CircuitWeather,
  CircuitSimulationConfig,
  CircuitSimulationResult,
  HourlyNodePower,
  HourlyProfileMap,
  SeasonProfiles,
} from '@/types/circuitSimulation';

// ─── 1. Cluster delta ─────────────────────────────────────────────────────────

/**
 * Determine whether hour `h` falls inside a range string like "18-21" or "22-6" (wrapping).
 */
function hourInRange(h: number, rangeStr: string): boolean {
  const [startStr, endStr] = rangeStr.split('-').map(s => parseInt(s, 10));
  if (isNaN(startStr) || isNaN(endStr)) return false;
  if (startStr <= endStr) {
    // e.g. 18-21 → 18,19,20,21
    return h >= startStr && h <= endStr;
  }
  // wrapping e.g. 22-6 → 22,23,0,1,2,3,4,5,6
  return h >= startStr || h <= endStr;
}

/**
 * Return the cluster delta multiplier for a given hour, season and cluster.
 * Only applies to residential clients.
 */
export function getClusterDelta(
  cluster: CircuitCluster,
  hour: number,
  season: CircuitSeason,
  config: CircuitSimulationConfig,
): number {
  const deltas = config.clusterDeltas[cluster];
  if (!deltas) return 1.0;

  let multiplier = 1.0;

  for (const [key, value] of Object.entries(deltas)) {
    // key can be "HH-HH" (all seasons) or "season_HH-HH"
    const parts = key.split('_');
    let rangeStr: string;
    let keySeason: string | null = null;

    if (parts.length === 2) {
      keySeason = parts[0];
      rangeStr = parts[1];
    } else {
      rangeStr = parts[0];
    }

    // Season filter
    if (keySeason && keySeason !== season) continue;

    if (hourInRange(hour, rangeStr)) {
      multiplier *= value;
    }
  }

  return multiplier;
}

// ─── 2. Diversity factor ──────────────────────────────────────────────────────

/**
 * Continuous diversity factor: f(N, cluster) = a + (1 - a) / √N
 *
 * Applied on the SUM of individual powers, NOT on the profile percentage.
 */
export function diversityFactor(
  nClients: number,
  cluster: CircuitCluster,
  config: CircuitSimulationConfig,
): number {
  if (nClients <= 0) return 0;
  if (nClients === 1) return 1.0;

  const a = config.diversityFactors[cluster];
  return a + (1 - a) / Math.sqrt(nClients);
}

// ─── 3. Individual client hourly power ────────────────────────────────────────

/**
 * Compute the hourly power of a single client at hour h.
 *
 * For load clients (residential, industrial_pme, public_charging):
 *   P_i(h) = puissanceContrat × profile(season, h) / 100 × delta(cluster, h)
 *   (delta only for residential)
 *
 * For pv clients:
 *   P_pv(h) = pvPuissance × profile_pv(season, h) / 100 × weatherFactor
 *
 * Returns { load_kW, pv_kW } — both positive values.
 */
export function clientHourlyPower(
  client: CircuitClient,
  hour: number,
  season: CircuitSeason,
  weather: CircuitWeather,
  profiles: { winter: SeasonProfiles; summer: SeasonProfiles },
  weatherFactors: { sunny: number; gray: number },
  cluster: CircuitCluster,
  config: CircuitSimulationConfig,
): { load_kW: number; pv_kW: number } {
  const seasonProfiles = profiles[season];
  const hourStr = hour.toString();

  if (client.type === 'pv') {
    const pvProfile = seasonProfiles.pv[hourStr] ?? 0;
    const wf = weatherFactors[weather];
    return {
      load_kW: 0,
      pv_kW: (client.pvPuissance_kW ?? 0) * pvProfile / 100 * wf,
    };
  }

  // Load client
  const profileType: keyof SeasonProfiles =
    client.type === 'public_charging' ? 'industrial_pme' : client.type;
  const baseProfile = seasonProfiles[profileType]?.[hourStr] ?? 0;

  // Cluster delta only for residential
  const delta =
    client.type === 'residential'
      ? getClusterDelta(cluster, hour, season, config)
      : 1.0;

  return {
    load_kW: client.puissanceContrat_kW * baseProfile / 100 * delta,
    pv_kW: 0,
  };
}

// ─── 4. Node hourly power ─────────────────────────────────────────────────────

/**
 * Compute net node power at hour h for a full circuit.
 *
 * P_charge(h) = [ Σ P_i(h) for load clients ] × f(N_load, cluster)
 * P_pv(h)     = Σ pvPuissance_j × pv_profile(h) × weather_factor   (no diversity)
 * P_net(h)    = P_charge(h) − P_pv(h)
 */
export function nodeHourlyPower(
  circuit: CircuitConfig,
  hour: number,
  season: CircuitSeason,
  weather: CircuitWeather,
  profiles: { winter: SeasonProfiles; summer: SeasonProfiles },
  weatherFactors: { sunny: number; gray: number },
  config: CircuitSimulationConfig,
): { P_charge_kW: number; P_pv_kW: number; P_net_kW: number } {
  let sumLoad = 0;
  let sumPV = 0;
  let nLoadClients = 0;

  for (const client of circuit.clients) {
    const { load_kW, pv_kW } = clientHourlyPower(
      client, hour, season, weather, profiles, weatherFactors, circuit.cluster, config,
    );
    sumLoad += load_kW;
    sumPV += pv_kW;
    if (client.type !== 'pv') nLoadClients++;
  }

  // Apply diversity factor on the sum of load powers (NOT on profile %)
  const f = diversityFactor(nLoadClients, circuit.cluster, config);
  const P_charge = sumLoad * f;

  return {
    P_charge_kW: P_charge,
    P_pv_kW: sumPV,
    P_net_kW: P_charge - sumPV,
  };
}

// ─── 5. Full circuit simulation ───────────────────────────────────────────────

/**
 * Run a full 24h simulation for one season × weather combination.
 */
export function simulateCircuit24h(
  circuit: CircuitConfig,
  season: CircuitSeason,
  weather: CircuitWeather,
  profiles: { winter: SeasonProfiles; summer: SeasonProfiles },
  weatherFactors: { sunny: number; gray: number },
  config: CircuitSimulationConfig,
): CircuitSimulationResult {
  const hourly: HourlyNodePower[] = [];
  let nEvents_high = 0;
  let nEvents_low = 0;
  let peakLoad = -Infinity;
  let peakInjection = Infinity;

  for (let h = 0; h < 24; h++) {
    const { P_charge_kW, P_pv_kW, P_net_kW } = nodeHourlyPower(
      circuit, h, season, weather, profiles, weatherFactors, config,
    );

    let flagged = false;
    let flagType: 'overload' | 'injection' | undefined;

    if (P_net_kW > config.thresholds.overload_kW) {
      flagged = true;
      flagType = 'overload';
      nEvents_high++;
    } else if (P_net_kW < config.thresholds.injection_kW) {
      flagged = true;
      flagType = 'injection';
      nEvents_low++;
    }

    if (P_net_kW > peakLoad) peakLoad = P_net_kW;
    if (P_net_kW < peakInjection) peakInjection = P_net_kW;

    hourly.push({ hour: h, P_charge_kW, P_pv_kW, P_net_kW, flagged, flagType });
  }

  return {
    circuitId: circuit.id,
    season,
    weather,
    hourly,
    nEvents_high,
    nEvents_low,
    peakLoad_kW: peakLoad,
    peakInjection_kW: peakInjection,
  };
}

/**
 * Run all 4 season × weather combinations for a circuit.
 */
export function simulateCircuitAllConditions(
  circuit: CircuitConfig,
  profiles: { winter: SeasonProfiles; summer: SeasonProfiles },
  weatherFactors: { sunny: number; gray: number },
  config: CircuitSimulationConfig,
): CircuitSimulationResult[] {
  const seasons: CircuitSeason[] = ['winter', 'summer'];
  const weathers: CircuitWeather[] = ['sunny', 'gray'];
  const results: CircuitSimulationResult[] = [];

  for (const season of seasons) {
    for (const weather of weathers) {
      results.push(
        simulateCircuit24h(circuit, season, weather, profiles, weatherFactors, config),
      );
    }
  }

  return results;
}
