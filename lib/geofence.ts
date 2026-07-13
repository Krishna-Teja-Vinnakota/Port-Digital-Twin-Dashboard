/**
 * lib/geofence.ts
 * Port geo-fence truck monitoring and gate congestion.
 *
 * Sources:
 *  1. Google Maps Roads API  — nearest-road snapping near gate points
 *  2. OSRM (self-hosted)     — truck routing, ETA (free, open source)
 *
 * When LIVE: truck-in-geofence counts use actual truck positions + point-in-polygon;
 * per-gate queues use nearest-gate assignment (no random). When no trucks or outside
 * polygon, Roads segment counts map to queue deterministically.
 */

import type { Gate, Truck } from '@/store/useSimulationStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CongestionLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface GeofenceSummary {
  trucksInGeofence: number;
  gatesCongested: CongestionLevel;
  roadSegmentsActive: number;
  gates: GateCongestionUpdate[];
  source: 'GOOGLE_MAPS_LIVE' | 'GOOGLE_MAPS_FALLBACK';
}

export interface GateCongestionUpdate {
  gateId: number;
  congestionLevel: CongestionLevel;
  estimatedQueueLength: number;
  source: string;
}

export interface RouteETA {
  durationMin: number;
  distanceKm: number;
  source: 'HERE_LIVE' | 'HERE_FALLBACK' | 'OSRM_LIVE' | 'OSRM_FALLBACK' | 'SIMULATED';
}

/** Gate points aligned with `lib/gateEngine.js` GATE_LOCATIONS (4 gates). */
const Port_GATE_POINTS = [
  { gateId: 1, lat: 18.9520, lng: 72.9640, name: 'Gate 1 - Import (North)' },
  { gateId: 2, lat: 18.9480, lng: 72.9680, name: 'Gate 2 - Export (North)' },
  { gateId: 3, lat: 18.9400, lng: 72.9720, name: 'Gate 3 - Import (South)' },
  { gateId: 4, lat: 18.9360, lng: 72.9700, name: 'Gate 4 - Export (South)' },
] as const;

// Port boundary polygon for truck-in-geofence check (ray-cast)
const Port_BOUNDARY = [
  { lat: 18.948, lng: 72.932 },
  { lat: 18.948, lng: 72.958 },
  { lat: 18.928, lng: 72.958 },
  { lat: 18.928, lng: 72.932 },
];

// ─── Point-in-polygon (ray casting) ────────────────────────────────────────────

export function isInsidePortGeofence(lat: number, lng: number): boolean {
  const polygon = Port_BOUNDARY;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;
    const intersect =
      yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distSq(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dlat = lat1 - lat2;
  const dlng = lng1 - lng2;
  return dlat * dlat + dlng * dlng;
}

/**
 * Count trucks whose positions lie inside the Port geofence polygon.
 */
export function countTrucksInPortGeofence(trucks: Truck[]): number {
  return trucks.filter(
    (t) =>
      t?.position &&
      isInsidePortGeofence(t.position.lat, t.position.lng)
  ).length;
}

type GatePoint = (typeof Port_GATE_POINTS)[number];

/**
 * In-geofence trucks assigned to nearest gate; returns queue length per gateId.
 */
export function assignInGeofenceTrucksToGates(
  trucks: Truck[]
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const g of Port_GATE_POINTS) counts[g.gateId] = 0;

  for (const t of trucks) {
    if (!t?.position) continue;
    const { lat, lng } = t.position;
    if (!isInsidePortGeofence(lat, lng)) continue;

    let best: GatePoint = Port_GATE_POINTS[0]!;
    let bestD = distSq(lat, lng, best.lat, best.lng);
    for (let i = 1; i < Port_GATE_POINTS.length; i++) {
      const g = Port_GATE_POINTS[i]!;
      const d = distSq(lat, lng, g.lat, g.lng);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    counts[best.gateId] = (counts[best.gateId] ?? 0) + 1;
  }
  return counts;
}

// ─── Congestion from segments / queue (no random on LIVE) ─────────────────────

function segmentsToCongestion(count: number): CongestionLevel {
  if (count > 8) return 'HIGH';
  if (count > 3) return 'MEDIUM';
  return 'LOW';
}

/** Deterministic queue proxy from snapped segment count when truck positions are unavailable. */
function deterministicQueueFromSegments(segmentCount: number): number {
  return Math.min(99, Math.max(0, segmentCount * 4));
}

function queueLengthToCongestion(
  queue: number,
  status: 'OPEN' | 'CLOSED' | 'RESTRICTED' | string
): CongestionLevel {
  if (status === 'CLOSED') return 'HIGH';
  if (queue >= 50) return 'HIGH';
  if (queue >= 25) return 'MEDIUM';
  return 'LOW';
}

function maxCongestion(
  a: CongestionLevel,
  b: CongestionLevel
): CongestionLevel {
  const o = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return o[a] >= o[b] ? a : b;
}

function aggregateGatesCongested(gates: GateCongestionUpdate[]): CongestionLevel {
  if (gates.some((g) => g.congestionLevel === 'HIGH')) return 'HIGH';
  if (gates.some((g) => g.congestionLevel === 'MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

function congestionToQueueLength(
  level: CongestionLevel
): number {
  const map: Record<CongestionLevel, number> = {
    LOW: 12,
    MEDIUM: 32,
    HIGH: 68,
  };
  return map[level];
}

export interface FetchGateCongestionOptions {
  /** Truck fleet used for in-polygon count and per-gate nearest assignment. */
  trucks?: Truck[];
  /**
   * Optional gate snapshot (e.g. simulation) to respect CLOSED status when
   * classifying queue-based congestion.
   */
  gateStatusById?: Record<number, 'OPEN' | 'CLOSED' | 'RESTRICTED'>;
}

// ─── Google Maps Roads API: nearest road snapping ───────────────────────────────

/**
 * @param options.trucks — when provided, `trucksInGeofence` and per-gate queues use
 *   `isInsidePortGeofence` + nearest gate (LIVE: no random estimates).
 */
export async function fetchGateCongestion(
  options: FetchGateCongestionOptions = {}
): Promise<GeofenceSummary> {
  const { trucks = [], gateStatusById = {} } = options;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

  if (!apiKey) {
    console.warn('[Geofence] Google Maps key not set — simulation fallback');
    return simulatedGeofence(trucks, gateStatusById);
  }

  try {
    const pointStr = Port_GATE_POINTS.map((g) => `${g.lat},${g.lng}`).join('|');

    const res = await fetch(
      `https://roads.googleapis.com/v1/nearestRoads?points=${pointStr}&key=${apiKey}`,
      {
        next: { revalidate: 120 },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!res.ok) throw new Error(`Roads API HTTP ${res.status}`);

    const data = (await res.json()) as {
      snappedPoints?: Array<{ placeId: string; originalIndex?: number }>;
    };
    const snapped = data.snappedPoints ?? [];

    const perGate: Record<number, number> = {};
    for (const pt of snapped) {
      const idx = pt.originalIndex ?? 0;
      perGate[idx] = (perGate[idx] ?? 0) + 1;
    }

    const inGeofenceList = trucks.filter(
      (t) =>
        t?.position && isInsidePortGeofence(t.position.lat, t.position.lng)
    );
    const trucksInGeofence = inGeofenceList.length;
    const queueByGateId = assignInGeofenceTrucksToGates(trucks);
    const hasTruckSignal = trucks.length > 0;

    const gates: GateCongestionUpdate[] = Port_GATE_POINTS.map((g, i) => {
      const segmentCount = perGate[i] ?? 0;
      const segLevel = segmentsToCongestion(segmentCount);
      const status = gateStatusById[g.gateId] ?? 'OPEN';
      const q = queueByGateId[g.gateId] ?? 0;
      const queueLevel = queueLengthToCongestion(q, status);
      const level = maxCongestion(segLevel, queueLevel);

      let estimatedQueueLength: number;
      if (hasTruckSignal) {
        estimatedQueueLength = q;
        if (q === 0) {
          estimatedQueueLength = deterministicQueueFromSegments(segmentCount);
        }
      } else {
        estimatedQueueLength = deterministicQueueFromSegments(segmentCount);
      }

      return {
        gateId: g.gateId,
        congestionLevel: level,
        estimatedQueueLength,
        source: hasTruckSignal
          ? 'Truck positions + Roads API'
          : 'Google Maps Roads API',
      };
    });

    const overallLevel = aggregateGatesCongested(gates);

    return {
      trucksInGeofence,
      gatesCongested: overallLevel,
      roadSegmentsActive: snapped.length,
      gates,
      source: 'GOOGLE_MAPS_LIVE',
    };
  } catch (err) {
    console.error('[Geofence] Google Maps fetch failed:', err);
    return simulatedGeofence(trucks, gateStatusById);
  }
}

function simulatedGeofence(
  trucks: Truck[] = [],
  gateStatusById: Record<number, 'OPEN' | 'CLOSED' | 'RESTRICTED'> = {}
): GeofenceSummary {
  const inFenceCount = countTrucksInPortGeofence(trucks);
  const queueByGateId = assignInGeofenceTrucksToGates(trucks);
  const hasTruckRows = trucks.length > 0;

  const gates: GateCongestionUpdate[] = Port_GATE_POINTS.map((g) => {
    const q = queueByGateId[g.gateId] ?? 0;
    const status = gateStatusById[g.gateId] ?? 'OPEN';
    if (hasTruckRows) {
      return {
        gateId: g.gateId,
        congestionLevel: queueLengthToCongestion(q, status),
        estimatedQueueLength: q,
        source: 'Simulation',
      };
    }
    const level: CongestionLevel = 'MEDIUM';
    return {
      gateId: g.gateId,
      congestionLevel: level,
      estimatedQueueLength: congestionToQueueLength(level),
      source: 'Simulation',
    };
  });

  return {
    trucksInGeofence: hasTruckRows ? inFenceCount : 0,
    gatesCongested: aggregateGatesCongested(gates),
    roadSegmentsActive: 0,
    gates,
    source: 'GOOGLE_MAPS_FALLBACK',
  };
}

// ─── HERE Maps Routing API: truck route ETA ────────────────────────────────────

/**
 * Fetch a truck-mode route ETA from HERE Maps Routing API v8.
 * Uses `NEXT_PUBLIC_HERE_API_KEY`; falls back to simulated values if the key
 * is absent or the request fails.
 *
 * Results are cached for 5 minutes via Next.js `revalidate`.
 */
export async function fetchRouteETA(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<RouteETA> {
  const hereApiKey = process.env.NEXT_PUBLIC_HERE_API_KEY;
  if (!hereApiKey) {
    return { durationMin: 22, distanceKm: 8, source: 'SIMULATED' };
  }

  try {
    const url =
      `https://router.hereapi.com/v8/routes` +
      `?transportMode=truck` +
      `&origin=${originLat},${originLng}` +
      `&destination=${destLat},${destLng}` +
      `&return=summary` +
      `&apikey=${hereApiKey}`;

    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HERE Routing HTTP ${res.status}`);

    const data = (await res.json()) as {
      routes?: Array<{ sections?: Array<{ summary?: { duration: number; length: number } }> }>;
    };
    const routeSummary = data?.routes?.[0]?.sections?.[0]?.summary;
    if (!routeSummary) throw new Error('No route found in HERE response');

    return {
      durationMin: Math.round(routeSummary.duration / 60),
      distanceKm: Math.round(routeSummary.length / 100) / 10,
      source: 'HERE_LIVE',
    };
  } catch (err) {
    console.warn('[HERE] Route fetch failed:', err);
    return { durationMin: 22, distanceKm: 8, source: 'HERE_FALLBACK' };
  }
}

/**
 * Merge geofence congestion data into existing simulation Gate objects.
 */
export function mergeGeofenceIntoGates(
  simulationGates: Gate[],
  geofence: GeofenceSummary
): Gate[] {
  return simulationGates.map((gate) => {
    const update = geofence.gates.find((g) => g.gateId === gate.id);
    if (!update) return gate;

    return {
      ...gate,
      congestionLevel: update.congestionLevel,
      queueLength: update.estimatedQueueLength,
      lastUpdated: new Date().toISOString(),
    };
  });
}
