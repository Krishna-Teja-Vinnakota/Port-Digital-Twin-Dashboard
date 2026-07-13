/**
 * GET /api/poc/data-status
 * Single JSON summary for pre-bid POC: what is live vs simulated (no UI DevTools).
 */

import { NextResponse } from 'next/server';
import { fetchLiveVessels } from '@/lib/aisStream';
import { fetchCameraAnalytics } from '@/lib/opencvProxy';
import { fetchLiveAirQuality } from '@/lib/airQuality';
import { fetchLiveWaterQuality } from '@/lib/weatherOcean';
import { fetchLiveNDVI } from '@/lib/ndvi';
import { withApiLogging } from '@/lib/apiLogger';
import type { PocDataStatus, PocDataSourceInfo, PocEnvironmentSources } from '@/lib/pocDataStatusTypes';

async function getHandler() {
  const now = new Date().toISOString();

  let vessels: PocDataSourceInfo;
  try {
    const live = await fetchLiveVessels();
    if (live && live.length > 0) {
      vessels = {
        mode: 'LIVE',
        detail: `AIS: ${live.length} vessel(s) in Port region (relay)`,
        lastChecked: now,
      };
    } else {
      const noRelay = !process.env.AIS_RELAY_URL?.trim();
      vessels = {
        mode: 'SIMULATED',
        detail: noRelay
          ? 'AIS relay not configured — using simulation store'
          : 'No AIS vessels in Port bounding box — using simulation',
        lastChecked: now,
      };
    }
  } catch {
    vessels = { mode: 'SIMULATED', detail: 'AIS fetch failed — using simulation', lastChecked: now };
  }

  let trucks: PocDataSourceInfo;
  try {
    const cam = await fetchCameraAnalytics();
    if (cam.source === 'OPENCV_LIVE' && (cam.trucksDetected ?? 0) > 0) {
      trucks = {
        mode: 'LIVE',
        detail: `OpenCV: ${cam.trucksDetected} truck(s) detected in geofence`,
        lastChecked: now,
      };
    } else if (cam.source === 'OPENCV_LIVE') {
      trucks = {
        mode: 'MIXED',
        detail: 'OpenCV live, zero count — list may be simulation-padded',
        lastChecked: now,
      };
    } else {
      trucks = {
        mode: 'SIMULATED',
        detail: 'OpenCV not live — /api/trucks returns simulation',
        lastChecked: now,
      };
    }
  } catch {
    trucks = { mode: 'SIMULATED', detail: 'Camera service error — simulation trucks', lastChecked: now };
  }

  const [aqiR, waterR, ndviR] = await Promise.allSettled([
    fetchLiveAirQuality().catch(() => null),
    fetchLiveWaterQuality().catch(() => null),
    fetchLiveNDVI().catch(() => null),
  ]);

  const aqiL = aqiR.status === 'fulfilled' ? aqiR.value : null;
  const waterL = waterR.status === 'fulfilled' ? waterR.value : null;
  const ndviL = ndviR.status === 'fulfilled' ? ndviR.value : null;

  const environment: PocEnvironmentSources = {
    aqi: aqiL?.source
      ? String(aqiL.source)
      : 'SIMULATION (WAQI or key not configured)',
    ndvi: ndviL ? String(ndviL.source) : 'SIMULATION',
    water: waterL ? 'Open-Meteo/NOAA blend LIVE' : 'SIMULATION',
  };

  const body: PocDataStatus = {
    vessels,
    trucks,
    tosManifest: {
      mode: 'SIMULATED',
      detail: 'TEU, cargo, crane defaults: simulated TOS/PCS-style enrichment',
      lastChecked: now,
    },
    environment,
    kpi: {
      mode: 'MERGED',
      detail: 'KPIs from /api/kpi: merges live where available, simulation baseline as fallback',
      lastChecked: now,
    },
    lastUpdated: now,
  };

  return NextResponse.json(body);
}

export const GET = withApiLogging('GET', '/api/poc/data-status', getHandler);
