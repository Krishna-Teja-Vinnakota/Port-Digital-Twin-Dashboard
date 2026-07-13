/**
 * app/api/trucks/route.ts
 * Truck data from simulationStore, with OpenCV live truck count
 * overlaid when the Python microservice is running.
 *
 * Response shape: Truck[] — unchanged from original.
 * Components reading this endpoint require zero modification.
 *
 * What changes with OpenCV live:
 *  - trucksInGeofence KPI becomes real camera count
 *  - /api/alerts can classify intrusion alerts as LIVE when detected
 */

import { NextResponse } from 'next/server';
import { getSimulationState } from '@/lib/simulationStore';
import { fetchCameraAnalytics } from '@/lib/opencvProxy';
import { generateTruck } from '@/lib/mockDataGen';
import { withApiLogging } from '@/lib/apiLogger';
import { snapToTruckLand } from '@/lib/geoBounds.js';

const ZONE_CENTERS: Record<string, { lat: number; lng: number }> = {
  gate_1:    { lat: 18.9442, lng: 72.9319 },
  perimeter: { lat: 18.9365, lng: 72.9485 },
  nsict_gate:{ lat: 18.9505, lng: 72.9450 },
};

function withZonePosition(lat: number, lng: number) {
  const jitter = () => (Math.random() - 0.5) * 0.0015;
  const candidate = { lat: lat + jitter(), lng: lng + jitter() };
  return snapToTruckLand(candidate) ?? { lat, lng };
}

function buildLiveTruckList(baseTrucks: any[], detectedCount: number, zones: any[]): any[] {
  if (detectedCount <= 0) return [];

  const safeBase = baseTrucks.length > 0 ? baseTrucks : [generateTruck()];
  const trucks: any[] = [];
  let idx = 0;

  for (const zone of zones) {
    const count = Math.max(0, Math.floor(zone.truckCount ?? 0));
    const center = ZONE_CENTERS[zone.zoneName] ?? ZONE_CENTERS.perimeter;
    for (let i = 0; i < count && trucks.length < detectedCount; i++) {
      const template = safeBase[idx % safeBase.length];
      idx++;
      trucks.push({
        ...template,
        id: `${template.id}-LIVE-${zone.zoneName}-${idx}`,
        status: 'CAMERA_DETECTED',
        destination: zone.zoneName.toUpperCase(),
        position: withZonePosition(center.lat, center.lng),
      });
    }
  }

  // If zone breakdown is short, pad to match total detected count.
  while (trucks.length < detectedCount) {
    const template = safeBase[idx % safeBase.length];
    idx++;
    const fallbackCenter = ZONE_CENTERS.perimeter;
    trucks.push({
      ...template,
      id: `${template.id}-LIVE-pad-${idx}`,
      status: 'CAMERA_DETECTED',
      destination: 'PERIMETER',
      position: withZonePosition(fallbackCenter.lat, fallbackCenter.lng),
    });
  }

  return trucks.slice(0, detectedCount);
}

async function getHandler() {
  const state     = getSimulationState();
  const simTrucks = state.trucks;

  try {
    const camera = await fetchCameraAnalytics();
    const isCameraLive = camera.source === 'OPENCV_LIVE';
    const liveTrucks = isCameraLive
      ? buildLiveTruckList(simTrucks, camera.trucksDetected, camera.zones)
      : simTrucks;

    return NextResponse.json(liveTrucks, {
      headers: {
        'X-Data-Source':        camera.source,
        'X-Live-Truck-Count':   String(camera.trucksDetected),
        'X-Returned-Truck-Count': String(liveTrucks.length),
        'X-Intrusion-Detected': String(camera.intrusionDetected),
      },
    });
  } catch (err) {
    console.error('[trucks/route] Camera fetch error:', err);
  }

  return NextResponse.json(simTrucks, {
    headers: { 'X-Data-Source': 'Simulation' },
  });
}

export const GET = withApiLogging('GET', '/api/trucks', getHandler);
