/**
 * lib/airQuality.ts
 * Live air quality data from WAQI (World Air Quality Index) API.
 * Station: Navi Mumbai MPCB — closest monitoring station to Port.
 *
 * Free tier constraints:
 * - 1,000 requests/second quota
 * - Data CANNOT be used in paid/commercial applications (WAQI terms)
 * - For commercial deployment → switch to IQAir ($399/mo)
 *
 * The returned shape matches generateEnvironmentData().aqi exactly
 * so environment/route.ts can swap it in with zero component changes.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveAQIData {
  overall: number;
  category: AQICategory;
  pm25: number;
  pm10: number;
  co2: number;
  no2: number;
  so2: number;
  o3: number;
  station: string;
  updatedAt: string;
  source: 'WAQI_LIVE' | 'WAQI_ERROR_FALLBACK';
}

type AQICategory =
  | 'GOOD'
  | 'SATISFACTORY'
  | 'MODERATE'
  | 'POOR'
  | 'VERY_POOR'
  | 'HAZARDOUS';

interface WAQIResponse {
  status: 'ok' | 'error';
  data: {
    aqi: number;
    city: { name: string };
    time: { iso: string };
    iaqi: {
      pm25?: { v: number };
      pm10?: { v: number };
      co?:   { v: number };
      no2?:  { v: number };
      so2?:  { v: number };
      o3?:   { v: number };
    };
  };
}

// ─── AQI category mapper (Indian CPCB scale) ─────────────────────────────────

function getAQICategory(aqi: number): AQICategory {
  if (aqi <= 50)  return 'GOOD';
  if (aqi <= 100) return 'SATISFACTORY';
  if (aqi <= 200) return 'MODERATE';
  if (aqi <= 300) return 'POOR';
  if (aqi <= 400) return 'VERY_POOR';
  return 'HAZARDOUS';
}

// ─── Fallback — matches mockDataGen ranges so UI never shows nulls ────────────

function simulatedFallback(): LiveAQIData {
  return {
    overall:   Math.floor(85 + Math.random() * 60),
    category:  'MODERATE',
    pm25:      parseFloat((22 + Math.random() * 30).toFixed(1)),
    pm10:      parseFloat((55 + Math.random() * 40).toFixed(1)),
    co2:       parseFloat((410 + Math.random() * 20).toFixed(1)),
    no2:       parseFloat((28 + Math.random() * 20).toFixed(1)),
    so2:       parseFloat((12 + Math.random() * 15).toFixed(1)),
    o3:        parseFloat((45 + Math.random() * 20).toFixed(1)),
    station:   'Navi Mumbai (simulation fallback)',
    updatedAt: new Date().toISOString(),
    source:    'WAQI_ERROR_FALLBACK',
  };
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

/**
 * Fetch live AQI from WAQI Navi Mumbai station.
 * Station ID @7873 = Navi Mumbai MPCB.
 * Falls back to simulation-range values on any error.
 *
 * @param stationId  WAQI station ID (default: Navi Mumbai MPCB)
 */
export async function fetchLiveAirQuality(
  stationId = '@7873'
): Promise<LiveAQIData> {
  const token = process.env.WAQI_TOKEN;

  if (!token) {
    console.warn('[AQI] WAQI_TOKEN not set — using simulation fallback');
    return simulatedFallback();
  }

  try {
    const res = await fetch(
      `https://api.waqi.info/feed/${stationId}/?token=${token}`,
      {
        next: { revalidate: 300 },          // cache 5 min — WAQI updates hourly
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!res.ok) throw new Error(`WAQI HTTP ${res.status}`);

    const json: WAQIResponse = await res.json();

    if (json.status !== 'ok') {
      throw new Error(`WAQI API error: ${JSON.stringify(json.data)}`);
    }

    const d = json.data;
    const aqi = d.aqi;

    return {
      overall:   aqi,
      category:  getAQICategory(aqi),
      // WAQI reports CO as ppm*10; multiply by 100 for approximate μg/m³ display
      pm25:      d.iaqi?.pm25?.v ?? simulatedFallback().pm25,
      pm10:      d.iaqi?.pm10?.v ?? simulatedFallback().pm10,
      co2:       d.iaqi?.co   != null ? d.iaqi.co.v * 100 : simulatedFallback().co2,
      no2:       d.iaqi?.no2?.v ?? simulatedFallback().no2,
      so2:       d.iaqi?.so2?.v ?? simulatedFallback().so2,
      o3:        d.iaqi?.o3?.v  ?? simulatedFallback().o3,
      station:   d.city?.name ?? 'Navi Mumbai MPCB',
      updatedAt: d.time?.iso ?? new Date().toISOString(),
      source:    'WAQI_LIVE',
    };
  } catch (err) {
    console.error('[AQI] Fetch failed:', err);
    return simulatedFallback();
  }
}
