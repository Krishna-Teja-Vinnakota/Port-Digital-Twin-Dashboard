/**
 * lib/opencvProxy.ts
 * Client for the OpenCV/YOLOv8 Python microservice.
 *
 * The Python service runs separately (not on Netlify):
 *   Deploy on Railway or Render free tier.
 *   See opencv-service/main.py for the FastAPI server code.
 *
 * When OPENCV_SERVICE_URL is not set, all functions return simulation values
 * matching the mockDataGen ranges — zero UI disruption.
 *
 * What this feeds in the UI:
 *  - trucks/route.ts     → trucksInGeofence count (replaces simulation)
 *  - alerts/route.ts     → PERIMETER_BREACH alert classification (LIVE/SIMULATED)
 *  - kpi/route.ts        → Trucks in Geo-Fence KPI card (live count)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DetectionSource = 'OPENCV_LIVE' | 'OPENCV_OFFLINE_SIMULATION';

export interface ZoneAnalytics {
  zoneName:       string;
  truckCount:     number;
  personCount:    number;
  intrusion:      boolean;
  fireHazard:     boolean;
  timestamp:      string;
}

export interface CameraAnalytics {
  trucksDetected:     number;    // total across all zones
  personsDetected:    number;
  intrusionDetected:  boolean;
  fireHazard:         boolean;
  zones:              ZoneAnalytics[];
  lastFrameAt:        string;
  source:             DetectionSource;
}

// ─── Python service response shape ───────────────────────────────────────────

interface OpenCVServiceResponse {
  truck_count:   number;
  person_count:  number;
  intrusion:     boolean;
  fire_hazard:   boolean;
  mode?:         'LIVE' | 'DEMO' | string;
  zone_summary:  Record<string, {
    truck_count:  number;
    person_count: number;
    intrusion:    boolean;
    timestamp:    string;
  }>;
  timestamp:     string;
}

// ─── Simulation fallback (matches Port geofence truck count range) ────────────

function simulatedAnalytics(): CameraAnalytics {
  const trucks  = Math.floor(35 + Math.random() * 20);
  const persons = Math.floor(5  + Math.random() * 15);
  return {
    trucksDetected:    trucks,
    personsDetected:   persons,
    intrusionDetected: false,
    fireHazard:        false,
    zones: [
      {
        zoneName:    'gate_1',
        truckCount:  Math.floor(trucks * 0.6),
        personCount: Math.floor(persons * 0.5),
        intrusion:   false,
        fireHazard:  false,
        timestamp:   new Date().toISOString(),
      },
      {
        zoneName:    'perimeter',
        truckCount:  Math.floor(trucks * 0.4),
        personCount: Math.floor(persons * 0.5),
        intrusion:   false,
        fireHazard:  false,
        timestamp:   new Date().toISOString(),
      },
    ],
    lastFrameAt: new Date().toISOString(),
    source:      'OPENCV_OFFLINE_SIMULATION',
  };
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

/**
 * Fetch latest frame analytics from the OpenCV Python microservice.
 * Falls back to simulation values if service is offline or not configured.
 */
export async function fetchCameraAnalytics(): Promise<CameraAnalytics> {
  const serviceUrl = process.env.OPENCV_SERVICE_URL;

  if (!serviceUrl) {
    return simulatedAnalytics();
  }

  try {
    const res = await fetch(`${serviceUrl}/api/analytics/latest`, {
      next:   { revalidate: 30 },          // 30s cache — real-time ish
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`OpenCV service HTTP ${res.status}`);

    const data: OpenCVServiceResponse = await res.json();
    const serviceMode = String(data.mode || '').toUpperCase();
    const isCameraLive = serviceMode === 'LIVE';

    const zones: ZoneAnalytics[] = Object.entries(data.zone_summary ?? {}).map(
      ([name, z]) => ({
        zoneName:    name,
        truckCount:  z.truck_count  ?? 0,
        personCount: z.person_count ?? 0,
        intrusion:   z.intrusion    ?? false,
        fireHazard:  false,
        timestamp:   z.timestamp    ?? new Date().toISOString(),
      })
    );

    return {
      trucksDetected:    data.truck_count    ?? 0,
      personsDetected:   data.person_count   ?? 0,
      intrusionDetected: data.intrusion      ?? false,
      fireHazard:        data.fire_hazard    ?? false,
      zones,
      lastFrameAt:       data.timestamp      ?? new Date().toISOString(),
      source:            isCameraLive ? 'OPENCV_LIVE' : 'OPENCV_OFFLINE_SIMULATION',
    };
  } catch (err) {
    console.warn('[OpenCV] Service unavailable — simulation fallback:', err);
    return simulatedAnalytics();
  }
}

/**
 * Generate an intrusion alert object ready to prepend to the alerts feed.
 * Only call this when intrusionDetected === true.
 */
export function buildIntrusionAlert(analytics: CameraAnalytics) {
  const intrudedZones = analytics.zones
    .filter(z => z.intrusion)
    .map(z => z.zoneName)
    .join(', ');

  return {
    id:             `INTRUSION-${Date.now()}`,
    type:           'Encroachment',
    severity:       'HIGH' as const,
    color:          'orange',
    message:        `Unauthorized vehicle/person detected — Zone: ${intrudedZones || 'Perimeter'}`,
    affectedEntity: 'Zone-C Perimeter - CCTV Surveillance',
    timestamp:      analytics.lastFrameAt,
    dismissed:      false,
    origin:         analytics.source === 'OPENCV_LIVE' ? 'LIVE' : 'SIMULATED',
    source:         analytics.source,
  };
}
