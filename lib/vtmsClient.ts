import type { Vessel, VesselState } from '@/store/useSimulationStore';
import { enrichVesselManifest } from '@/lib/manifestEnricher';
import { Port_BBOX } from '@/lib/aisStream';

export interface VTMSVessel extends Vessel {
  mmsi?: number | null;
  imo?: string | null;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  observedAt: string;
  source: 'VTMS_LIVE' | 'VTMS_WEB_SNAPSHOT';
  confidence: number;
}

export interface VTMSFetchResult {
  vessels: VTMSVessel[];
  ok: boolean;
  source: string;
  stale: boolean;
  freshnessMs: number | null;
  fallbackReason?: string;
  errors: string[];
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;
const DEFAULT_STALE_MS = 120_000;
const DEFAULT_MAX_VESSELS = 150;

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function inPortBounds(lat: number, lng: number): boolean {
  return (
    lat >= Port_BBOX.minLat &&
    lat <= Port_BBOX.maxLat &&
    lng >= Port_BBOX.minLng &&
    lng <= Port_BBOX.maxLng
  );
}

function mapStatusToLifecycle(status: unknown): VesselState {
  const txt = String(status ?? '').toUpperCase();
  if (txt.includes('ANCHOR')) return 'ANCHORED';
  if (txt.includes('BERTH')) return 'BERTHING';
  if (txt.includes('LOAD') || txt.includes('CARGO') || txt.includes('WORKING')) return 'LOADING';
  if (txt.includes('DEPART')) return 'DEPARTING';
  return 'APPROACHING';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizeVesselCandidate(candidate: unknown): VTMSVessel | null {
  return normalizeVesselCandidateWithSource(candidate, 'VTMS_LIVE', 1);
}

function normalizeVesselCandidateWithSource(
  candidate: unknown,
  source: VTMSVessel['source'],
  confidenceScale: number,
): VTMSVessel | null {
  const row = asRecord(candidate);
  const lat = parseNumber(row.lat ?? row.latitude ?? row.y);
  const lng = parseNumber(row.lng ?? row.lon ?? row.longitude ?? row.x);
  if (lat == null || lng == null) return null;

  const rawName = normalizeText(row.name ?? row.vesselName ?? row.shipName);
  const mmsi = parseNumber(row.mmsi ?? row.MMSI);
  const imoText = normalizeText(row.imo ?? row.IMO);
  const observedAt =
    normalizeText(row.observedAt ?? row.timestamp ?? row.updatedAt ?? row.lastSeenAt) ||
    new Date().toISOString();
  const lifecycleState = mapStatusToLifecycle(
    row.lifecycleState ?? row.navStatus ?? row.statusText ?? row.status
  );
  const berthNumber = normalizeText(row.berth ?? row.berthNumber ?? row.berthId);
  const heading = parseNumber(row.heading ?? row.hdg);
  const sog = parseNumber(row.sog ?? row.speed ?? row.speedOverGround);
  const cog = parseNumber(row.cog ?? row.course ?? row.courseOverGround);
  const rawConfidence = Math.max(
    0,
    Math.min(1, parseNumber(row.confidence ?? row.trackConfidence ?? row.qualityScore) ?? 0.7),
  );
  const confidence = Math.max(0, Math.min(1, rawConfidence * confidenceScale));

  const base: Vessel = {
    id: `VTMS-${mmsi ?? imoText ?? rawName ?? `${lat.toFixed(5)}-${lng.toFixed(5)}`}`,
    name: rawName || `VTMS-VESSEL-${mmsi ?? 'UNKNOWN'}`,
    type: 'GENERAL',
    dwt: 0,
    position: { lat, lng },
    lifecycleState,
    eta: observedAt,
    waitHours: lifecycleState === 'ANCHORED' ? 1 : 0,
    emissionsRate: 2.2,
    pilotAssigned: ['BERTHING', 'LOADING', 'DEPARTING'].includes(lifecycleState),
    berthNumber: berthNumber || null,
    flag: normalizeText(row.flag ?? row.countryCode) || 'IN',
    ticksInState: 0,
    assignedCranes: 3,
  };

  return {
    ...enrichVesselManifest(base),
    mmsi,
    imo: imoText,
    sog,
    cog,
    heading,
    observedAt,
    source,
    confidence,
  };
}

function extractCandidates(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (Array.isArray(root.vessels)) return root.vessels;
  if (Array.isArray(root.targets)) return root.targets;
  if (Array.isArray(root.data)) return root.data;
  const nested = asRecord(root.data);
  if (Array.isArray(nested.vessels)) return nested.vessels;
  return [];
}

function getObservedAt(payload: unknown): string | null {
  const root = asRecord(payload);
  const timestamp =
    normalizeText(root.timestamp) ||
    normalizeText(root.generatedAt) ||
    normalizeText(root.observedAt);
  return timestamp || null;
}

function getConfig() {
  const retries = parseNumber(process.env.VTMS_RETRY_COUNT) ?? DEFAULT_RETRIES;
  const timeoutMs = parseNumber(process.env.VTMS_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const staleMs = parseNumber(process.env.VTMS_MAX_STALE_MS) ?? DEFAULT_STALE_MS;
  const maxVessels = parseNumber(process.env.VTMS_MAX_VESSELS) ?? DEFAULT_MAX_VESSELS;
  const portOnly = (process.env.VTMS_FILTER_TO_Port ?? 'true').toLowerCase() !== 'false';

  return {
    baseUrl: process.env.VTMS_BASE_URL?.trim(),
    webSnapshotUrl: process.env.VTMS_WEB_SNAPSHOT_URL?.trim(),
    token: process.env.VTMS_API_TOKEN?.trim(),
    apiKey: process.env.VTMS_API_KEY?.trim(),
    retries: Math.max(0, Math.floor(retries)),
    timeoutMs: Math.max(1000, Math.floor(timeoutMs)),
    staleMs: Math.max(15_000, Math.floor(staleMs)),
    maxVessels: Math.max(10, Math.floor(maxVessels)),
    portOnly,
  };
}

export function isVTMSEnabled(): boolean {
  return (process.env.VTMS_ENABLED ?? 'false').toLowerCase() === 'true';
}

async function fetchWebsiteSnapshot(cfg: ReturnType<typeof getConfig>, priorErrors: string[]): Promise<VTMSFetchResult> {
  if (!cfg.webSnapshotUrl) {
    return {
      vessels: [],
      ok: false,
      source: 'VTMS_UNAVAILABLE',
      stale: true,
      freshnessMs: null,
      fallbackReason: 'VTMS web snapshot URL not configured',
      errors: priorErrors,
    };
  }

  try {
    const res = await fetch(cfg.webSnapshotUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) {
      return {
        vessels: [],
        ok: false,
        source: 'VTMS_UNAVAILABLE',
        stale: true,
        freshnessMs: null,
        fallbackReason: `VTMS web snapshot returned ${res.status}`,
        errors: [...priorErrors, `snapshot_status_${res.status}`],
      };
    }

    const payload = await res.json();
    const observedAt = getObservedAt(payload) || new Date().toISOString();
    const observedTs = Date.parse(observedAt);
    const freshnessMs = Number.isFinite(observedTs) ? Date.now() - observedTs : null;
    const stale = freshnessMs == null ? false : freshnessMs > cfg.staleMs;
    const candidates = extractCandidates(payload);

    const normalized = candidates
      .map(c => normalizeVesselCandidateWithSource(c, 'VTMS_WEB_SNAPSHOT', 0.65))
      .filter((v): v is VTMSVessel => !!v)
      .filter(v => (cfg.portOnly ? inPortBounds(v.position.lat, v.position.lng) : true))
      .slice(0, cfg.maxVessels);

    if (normalized.length === 0) {
      return {
        vessels: [],
        ok: false,
        source: 'VTMS_WEB_SNAPSHOT',
        stale,
        freshnessMs,
        fallbackReason: 'VTMS web snapshot returned no usable local vessels',
        errors: priorErrors,
      };
    }
    if (stale) {
      return {
        vessels: [],
        ok: false,
        source: 'VTMS_WEB_SNAPSHOT',
        stale: true,
        freshnessMs,
        fallbackReason: 'VTMS web snapshot data is stale',
        errors: priorErrors,
      };
    }

    return {
      vessels: normalized,
      ok: true,
      source: 'VTMS_WEB_SNAPSHOT',
      stale: false,
      freshnessMs,
      errors: priorErrors,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'unknown_error';
    return {
      vessels: [],
      ok: false,
      source: 'VTMS_UNAVAILABLE',
      stale: true,
      freshnessMs: null,
      fallbackReason: 'VTMS web snapshot fetch failed',
      errors: [...priorErrors, `snapshot_error_${msg}`],
    };
  }
}

export async function fetchVTMSVessels(): Promise<VTMSFetchResult> {
  const cfg = getConfig();
  const errors: string[] = [];
  if (!cfg.baseUrl) {
    errors.push('vtms_base_url_missing');
    return fetchWebsiteSnapshot(cfg, errors);
  }
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/api/vessels`;

  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    try {
      const res = await fetch(endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(cfg.timeoutMs),
        headers: {
          ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
          ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
        },
      });
      if (!res.ok) {
        errors.push(`attempt_${attempt + 1}: status_${res.status}`);
        continue;
      }

      const payload = await res.json();
      const observedAt = getObservedAt(payload) || new Date().toISOString();
      const observedTs = Date.parse(observedAt);
      const freshnessMs = Number.isFinite(observedTs) ? Date.now() - observedTs : null;
      const stale = freshnessMs == null ? false : freshnessMs > cfg.staleMs;
      const candidates = extractCandidates(payload);

      const normalized = candidates
        .map(normalizeVesselCandidate)
        .filter((v): v is VTMSVessel => !!v)
        .filter(v => (cfg.portOnly ? inPortBounds(v.position.lat, v.position.lng) : true))
        .slice(0, cfg.maxVessels);

      if (normalized.length === 0) {
        return {
          vessels: [],
          ok: false,
          source: 'VTMS_LIVE',
          stale,
          freshnessMs,
          fallbackReason: 'VTMS returned no usable local vessels',
          errors,
        };
      }

      if (stale) {
        return {
          vessels: [],
          ok: false,
          source: 'VTMS_LIVE',
          stale: true,
          freshnessMs,
          fallbackReason: 'VTMS data is stale',
          errors,
        };
      }

      return {
        vessels: normalized,
        ok: true,
        source: 'VTMS_LIVE',
        stale: false,
        freshnessMs,
        errors,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown_error';
      errors.push(`attempt_${attempt + 1}: ${msg}`);
    }
  }

  return fetchWebsiteSnapshot(cfg, errors);
}
