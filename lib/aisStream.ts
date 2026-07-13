import type { Vessel, VesselState } from '@/store/useSimulationStore';
import { enrichVesselManifest } from '@/lib/manifestEnricher';

export const Port_BBOX = {
  minLat: 15.0, maxLat: 23.0,
  minLng: 68.0, maxLng: 76.0,
};

// Tight bounding box for vessels physically inside the Port port / approaches
export const Port_PORT_BBOX = {
  minLat: 18.930, maxLat: 18.975,
  minLng: 72.930, maxLng: 72.980,
};

function isWithinPortBounds(lat: number, lng: number): boolean {
  return (
    lat >= Port_BBOX.minLat &&
    lat <= Port_BBOX.maxLat &&
    lng >= Port_BBOX.minLng &&
    lng <= Port_BBOX.maxLng
  );
}

export function isAtPortPort(lat: number, lng: number): boolean {
  return (
    lat >= Port_PORT_BBOX.minLat &&
    lat <= Port_PORT_BBOX.maxLat &&
    lng >= Port_PORT_BBOX.minLng &&
    lng <= Port_PORT_BBOX.maxLng
  );
}

interface AISVessel {
  mmsi: number;
  name: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  navStatus: number;
  shipType: number;
  destination: string;
  flag: string;
  updatedAt: string;
}

interface AISRelayResponse {
  vessels: AISVessel[];
  count: number;
  source: string;
  timestamp: string;
}

function mapNavStatus(code: number): VesselState {
  // AIS ITU-R M.1371 nav-status codes
  const map: Record<number, VesselState> = {
    0:  'APPROACHING',  // Under way using engine
    1:  'ANCHORED',     // At anchor
    2:  'APPROACHING',  // Not under command
    3:  'LOADING',      // Restricted in ability to manoeuvre (typically loading/discharge ops)
    4:  'LOADING',      // Constrained by draught (berthed, deep-loaded)
    5:  'LOADING',      // Moored ← was incorrectly APPROACHING
    6:  'LOADING',      // Aground (alongside berth)
    7:  'LOADING',      // Engaged in fishing
    8:  'DEPARTING',    // Under way sailing
    11: 'DEPARTING',    // Power-driven vessel towing astern (tug departure)
  };
  return map[code] ?? 'APPROACHING';
}

function mapShipType(code: number): import('@/lib/simulationTypes').VesselType {
  if (code >= 70 && code <= 79) return 'CONTAINER';
  if (code >= 80 && code <= 89) return 'TANKER';
  if (code >= 40 && code <= 49) return 'BULK_CARRIER';
  if (code === 60 || code === 69) return 'RO_RO';
  return 'GENERAL';
}

function mapAISToVessel(v: AISVessel): Vessel {
  // If the vessel is physically inside the Port port area, treat it as berthed
  // regardless of what the nav-status code says (some transponders stay on status 0
  // even while moored).
  const inPort = isAtPortPort(v.lat, v.lng);
  const mappedState = inPort ? 'LOADING' : mapNavStatus(v.navStatus);

  const base: Vessel = {
    id: `AIS-${v.mmsi}`,
    name: v.name?.trim() || `VESSEL-${v.mmsi}`,
    type: mapShipType(v.shipType),
    dwt: 0,
    position: { lat: v.lat, lng: v.lng },
    lifecycleState: mappedState as Vessel['lifecycleState'],
    eta: v.updatedAt,
    waitHours: 0,
    emissionsRate: 2.2,
    pilotAssigned: inPort,
    berthNumber: null,
    flag: v.flag || 'XX',
    ticksInState: 0,
    assignedCranes: inPort ? 3 : 0,
  };
  return enrichVesselManifest(base);
}

export async function fetchLiveVessels(): Promise<Vessel[] | null> {
  const relayUrl = process.env.AIS_RELAY_URL?.trim();

  if (!relayUrl) {
    return null;
  }

  try {
    const res = await fetch(`${relayUrl}/api/vessels`, {
      cache: 'no-store',  // Fixes the Next.js 2MB cache crash
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error(`[AIS] Relay returned ${res.status}`);
      return null;
    }

    const data: AISRelayResponse = await res.json();

    if (!Array.isArray(data.vessels) || data.vessels.length === 0) {
      return null;
    }

    // Relay may be subscribed to a wide/global feed. Keep only local Port traffic;
    // if none are local, let the API route fall back to simulation vessels.
    const localVessels = data.vessels.filter(v =>
      isWithinPortBounds(v.lat, v.lng)
    );

    if (localVessels.length === 0) {
      return null;
    }

    // Safety limit to prevent UI freezing if API sends too many
    const MAX_VESSELS = 150;
    const capped = localVessels.length > MAX_VESSELS
      ? localVessels.slice(0, MAX_VESSELS)
      : localVessels;

    return capped.map(mapAISToVessel);
  } catch (err) {
    console.error('[AIS] Fetch failed:', err);
    return null;
  }
}

export function countVesselsByState(vessels: Vessel[]): Record<VesselState, number> {
  const counts: Record<VesselState, number> = {
    APPROACHING: 0,
    ANCHORED: 0,
    BERTHING: 0,
    LOADING: 0,
    DEPARTING: 0,
    REMOVED: 0,
  };
  for (const v of vessels) {
    counts[v.lifecycleState] = (counts[v.lifecycleState] || 0) + 1;
  }
  return counts;
}