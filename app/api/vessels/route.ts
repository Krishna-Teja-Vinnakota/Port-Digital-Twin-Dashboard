/**
 * app/api/vessels/route.ts
 * Live AIS vessel positions from aisstream.io relay, falling back to
 * simulationStore vessels when relay is not configured or not running.
 */

import { NextResponse } from 'next/server';
import { getSimulationState } from '@/lib/simulationStore';
import { fetchLiveVessels } from '@/lib/aisStream';
import { withApiLogging } from '@/lib/apiLogger';
import { fetchVTMSVessels, isVTMSEnabled } from '@/lib/vtmsClient';
import { softSyncSimulationVessels } from '@/lib/simulationStore';

function normalizeName(name?: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mergeLiveWithSimulation<T extends { id?: string; name?: string; mmsi?: number | null; imo?: string | null }>(
  liveVessels: T[],
  simVessels: any[],
) {
  return liveVessels.map((liveV: any) => {
    const liveName = normalizeName(liveV?.name);
    const simMatch = simVessels.find(
      (sv: any) =>
        (liveV.mmsi != null && (sv.mmsi === liveV.mmsi || String(sv.id || '').includes(String(liveV.mmsi)))) ||
        (liveV.imo && sv.imo && String(sv.imo).toLowerCase() === String(liveV.imo).toLowerCase()) ||
        normalizeName(sv.name) === liveName,
    );
    if (!simMatch) return liveV;
    return {
      ...simMatch,
      ...liveV,
      position: liveV.position || simMatch.position,
      lifecycleState: liveV.lifecycleState || simMatch.lifecycleState,
      eta: liveV.eta || simMatch.eta,
      berthNumber: liveV.berthNumber ?? simMatch.berthNumber,
    };
  });
}

async function getHandler() {
  const simState = getSimulationState();
  const simVessels = simState.vessels;
  const fallbackReasons: string[] = [];

  if (isVTMSEnabled()) {
    const vtms = await fetchVTMSVessels();
    if (vtms.ok && vtms.vessels.length > 0) {
      const merged = mergeLiveWithSimulation(vtms.vessels, simVessels);
      const minConfidence = vtms.source === 'VTMS_WEB_SNAPSHOT' ? 0.45 : 0.6;
      softSyncSimulationVessels(merged, { sourceLabel: vtms.source, minConfidence });
      return NextResponse.json(merged, {
        headers: {
          'X-Data-Source': vtms.source,
          'X-VTMS-Freshness-Ms': String(vtms.freshnessMs ?? -1),
          'X-Vessel-Count': String(merged.length),
          'X-Data-Fallback-Reason': '',
        },
      });
    }
    if (vtms.fallbackReason) fallbackReasons.push(vtms.fallbackReason);
  }

  try {
    // 2. Try live AIS data
    const liveVessels = await fetchLiveVessels();

    if (liveVessels && liveVessels.length > 0) {
      const merged = mergeLiveWithSimulation(liveVessels, simVessels);

      // Supplement with simulation vessels that are LOADING or BERTHING at the
      // actual quayside — these represent ships already in port that may not be
      // broadcasting AIS (or whose AIS position hasn't been picked up yet by the
      // relay).  Exclude any sim vessel whose id or name already appears in the
      // merged AIS set so we don't double-count real ships.
      const mergedIds  = new Set(merged.map((v: any) => v.id));
      const mergedNames = new Set(merged.map((v: any) => normalizeName(v.name)));
      const simBerthed = simVessels.filter(
        sv =>
          (sv.lifecycleState === 'LOADING' || sv.lifecycleState === 'BERTHING') &&
          !mergedIds.has(sv.id) &&
          !mergedNames.has(normalizeName(sv.name)),
      );

      const combined = [...merged, ...simBerthed];

      return NextResponse.json(combined, {
        headers: {
          'X-Data-Source':  'aisstream.io LIVE + Simulation (berthed)',
          'X-Vessel-Count': String(combined.length),
          'X-Sim-Berthed':  String(simBerthed.length),
          'X-Data-Fallback-Reason': fallbackReasons.join('; '),
        },
      });
    }
    fallbackReasons.push('No live AIS vessels in Port bounds');
  } catch (err) {
    // Catch-all: any unexpected error falls through to simulation
    console.error('[vessels/route] Unexpected error:', err);
    fallbackReasons.push('AIS fetch error');
  }

  // Fallback: simulation
  const noRelay = !process.env.AIS_RELAY_URL?.trim();
  const relayReason = noRelay
    ? 'AIS relay URL not configured'
    : 'No live vessels in Port region, relay error, or relay not running';
  fallbackReasons.push(relayReason);
  return NextResponse.json(simVessels, {
    headers: {
      'X-Data-Source':  'Simulation',
      'X-Data-Fallback-Reason': fallbackReasons.join('; '),
      'X-Vessel-Count': String(simVessels.length),
    },
  });
}

export const GET = withApiLogging('GET', '/api/vessels', getHandler);