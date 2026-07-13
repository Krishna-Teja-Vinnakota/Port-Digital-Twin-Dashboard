import { NextRequest, NextResponse } from 'next/server';
import { getSimulationState, dismissAlert } from '@/lib/simulationStore';
import { fetchLiveVessels } from '@/lib/aisStream';
import { fetchGateCongestion, mergeGeofenceIntoGates } from '@/lib/geofence';
import { fetchCameraAnalytics } from '@/lib/opencvProxy';
import { buildOperationalAlerts } from '@/lib/liveAlerts';
import { alignTruckCount } from '@/lib/mockDataGen';
import type { Gate, SimTruck } from '@/store/useSimulationStore';
import { withApiLogging } from '@/lib/apiLogger';

async function getHandler() {
  const state = getSimulationState();
  const [liveVesselsResult, cameraResult] = await Promise.allSettled([
    fetchLiveVessels(),
    fetchCameraAnalytics(),
  ]);

  const liveVessels =
    liveVesselsResult.status === 'fulfilled' && liveVesselsResult.value?.length
      ? liveVesselsResult.value
      : null;
  const vessels = liveVessels || state.vessels;
  const vesselSource = liveVessels ? 'aisstream.io LIVE' : 'SIMULATION';

  const camera = cameraResult.status === 'fulfilled' ? cameraResult.value : null;
  const trucks: SimTruck[] = camera?.source === 'OPENCV_LIVE'
    ? (alignTruckCount(state.trucks, camera.trucksDetected) as SimTruck[])
    : state.trucks;
  const truckSource = camera?.source || 'SIMULATION';

  const gateStatusById = Object.fromEntries(
    state.gates.map((g: Gate) => [g.id, g.status])
  ) as Record<number, 'OPEN' | 'CLOSED' | 'RESTRICTED'>;

  let geofence: Awaited<ReturnType<typeof fetchGateCongestion>> | null = null;
  try {
    geofence = await fetchGateCongestion({ trucks, gateStatusById });
  } catch {
    geofence = null;
  }
  const gates = geofence ? mergeGeofenceIntoGates(state.gates, geofence) : state.gates;
  const gateSource = geofence?.source || 'SIMULATION';

  const trucksCount =
    geofence != null
      ? geofence.trucksInGeofence
      : camera?.trucksDetected ?? state.trucks.length;

  const computedAlerts = buildOperationalAlerts({
    vessels,
    vesselSource,
    gates,
    gateSource,
    trucksCount,
    truckSource,
    camera,
  });

  // Keep dismissal state stable across polling cycles for active alert IDs.
  const priorDismissedById = new Map(state.alerts.map((a: any) => [a.id, Boolean(a.dismissed)]));
  state.alerts = computedAlerts.map((a) => ({
    ...a,
    dismissed: priorDismissedById.get(a.id) ?? false,
  }));

  return NextResponse.json(state.alerts.filter((a: any) => !a.dismissed), {
    headers: {
      'X-Vessel-Alert-Source': vesselSource,
      'X-Gate-Alert-Source': gateSource,
      'X-Truck-Alert-Source': truckSource,
    },
  });
}

async function deleteHandler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (id) dismissAlert(id);
  return NextResponse.json({ success: true });
}

export const GET = withApiLogging('GET', '/api/alerts', getHandler);
export const DELETE = withApiLogging('DELETE', '/api/alerts', deleteHandler);
