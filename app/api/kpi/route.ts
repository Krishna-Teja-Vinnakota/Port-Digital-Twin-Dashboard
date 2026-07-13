/**
 * GET /api/kpi
 * Returns KPI values merged with live AIS / geofence / camera signals when available.
 */

import { NextResponse } from 'next/server';
import { getSimulationState } from '@/lib/simulationStore';
import { calculateKPIs } from '@/lib/carbonCalculator';
import { fetchLiveVessels } from '@/lib/aisStream';
import { fetchGateCongestion, mergeGeofenceIntoGates } from '@/lib/geofence';
import { fetchCameraAnalytics } from '@/lib/opencvProxy';
import { alignTruckCount } from '@/lib/mockDataGen';
import type { Gate, SimTruck } from '@/store/useSimulationStore';
import { withApiLogging } from '@/lib/apiLogger';

function pushHistoryValue(history: number[] | undefined, nextValue: number): number[] {
  const seed = Array.isArray(history) && history.length > 0 ? [...history] : [nextValue];
  if (seed.length >= 25) seed.shift();
  seed.push(parseFloat(nextValue.toFixed(1)));
  return seed;
}

async function getHandler() {
  try {
    const state = getSimulationState();
    const [liveVesselsResult, cameraResult] = await Promise.allSettled([
      fetchLiveVessels(),
      fetchCameraAnalytics(),
    ]);

    const vessels =
      liveVesselsResult.status === 'fulfilled' && liveVesselsResult.value?.length
        ? liveVesselsResult.value
        : state.vessels;

    const camera =
      cameraResult.status === 'fulfilled'
        ? cameraResult.value
        : null;
    const trucks: SimTruck[] = camera?.source === 'OPENCV_LIVE'
      ? (alignTruckCount(state.trucks, camera.trucksDetected) as SimTruck[])
      : state.trucks;

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

    const liveKpis = calculateKPIs(
      vessels,
      gates,
      trucks,
      state.simulationFlags || {},
      state.yard ?? null,
      state.lastTimingProfile ?? null
    );

    const baseline = state.kpis || liveKpis;
    const trucksInGeoFence = geofence
      ? geofence.trucksInGeofence
      : liveKpis.trucksInGeoFence;

    const merged = {
      ...baseline,
      avgVesselTAT: liveKpis.avgVesselTAT,
      preBerthingDetention: liveKpis.preBerthingDetention,
      berthOccupancy: liveKpis.berthOccupancy,
      gateCongestionLevel: liveKpis.gateCongestionLevel,
      trucksInGeoFence,
      carbonIndex: liveKpis.carbonIndex,
      yardOccupancyPct: liveKpis.yardOccupancyPct,
      gateQueueLength: liveKpis.gateQueueLength,
      history: {
        ...baseline.history,
        avgVesselTAT: pushHistoryValue(baseline.history?.avgVesselTAT, liveKpis.avgVesselTAT),
        preBerthingDetention: pushHistoryValue(
          baseline.history?.preBerthingDetention,
          liveKpis.preBerthingDetention
        ),
        berthOccupancy: pushHistoryValue(baseline.history?.berthOccupancy, liveKpis.berthOccupancy),
        trucksInGeoFence: pushHistoryValue(
          baseline.history?.trucksInGeoFence,
          trucksInGeoFence
        ),
      },
    };

    state.kpis = merged;

    return NextResponse.json(merged, {
      headers: {
        'X-Vessel-Source':
          liveVesselsResult.status === 'fulfilled' && liveVesselsResult.value?.length
            ? 'aisstream.io LIVE'
            : 'SIMULATION',
        'X-Gate-Source': geofence?.source ?? 'SIMULATION',
        'X-Truck-Source': camera?.source ?? 'SIMULATION',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withApiLogging('GET', '/api/kpi', getHandler);
