/**
 * app/api/gates/route.ts
 * Gate and congestion data from Google Maps Roads API, merged into
 * simulationStore Gate objects. Falls back to simulation on any error.
 *
 * Truck-in-geofence counts use actual positions (see lib/geofence.ts).
 */

import { NextResponse } from 'next/server';
import { getSimulationState } from '@/lib/simulationStore';
import { fetchGateCongestion, mergeGeofenceIntoGates } from '@/lib/geofence';
import { fetchCameraAnalytics } from '@/lib/opencvProxy';
import { alignTruckCount } from '@/lib/mockDataGen';
import type { Gate, SimTruck } from '@/store/useSimulationStore';
import { withApiLogging } from '@/lib/apiLogger';

async function getHandler() {
  const state = getSimulationState();
  const simGates = state.gates;

  let trucks: SimTruck[] = state.trucks;
  try {
    const camera = await fetchCameraAnalytics();
    if (camera.source === 'OPENCV_LIVE') {
      trucks = alignTruckCount(state.trucks, camera.trucksDetected) as SimTruck[];
    }
  } catch {
    /* use state.trucks */
  }

  const gateStatusById = Object.fromEntries(
    simGates.map((g: Gate) => [g.id, g.status])
  ) as Record<number, 'OPEN' | 'CLOSED' | 'RESTRICTED'>;

  try {
    const geofence = await fetchGateCongestion({ trucks, gateStatusById });
    const mergedGates = mergeGeofenceIntoGates(simGates, geofence);
    return NextResponse.json(mergedGates, {
      headers: {
        'X-Data-Source': geofence.source,
        'X-Trucks-In-Geofence': String(geofence.trucksInGeofence),
        'X-Overall-Congestion': geofence.gatesCongested,
      },
    });
  } catch (err) {
    console.error('[gates/route] Geofence fetch error:', err);
  }

  return NextResponse.json(simGates, {
    headers: { 'X-Data-Source': 'Simulation' },
  });
}

export const GET = withApiLogging('GET', '/api/gates', getHandler);
