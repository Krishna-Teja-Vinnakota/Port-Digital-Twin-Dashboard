import { NextResponse } from 'next/server';
import { generateBerthForecastData } from '@/lib/berthScheduler';
import { generateBerthForecastWithGemini, GEMINI_MODEL } from '@/lib/ai';
import { withApiLogging } from '@/lib/apiLogger';
import { fetchVTMSVessels, isVTMSEnabled, type VTMSVessel } from '@/lib/vtmsClient';
import { getSimulationState } from '@/lib/simulationStore';
import { computeLookahead } from '@/lib/lookahead';
import { getEffectivePortConfig } from '@/lib/portConfigApply';
import { getBasePortConfig } from '@/lib/portConfig';

async function getHandler() {
  let liveOverlays: VTMSVessel[] | undefined;
  let freshnessMs = -1;

  if (isVTMSEnabled()) {
    const vtms = await fetchVTMSVessels();
    if (vtms.ok && vtms.vessels.length > 0) {
      liveOverlays = vtms.vessels;
      freshnessMs = vtms.freshnessMs ?? -1;
    }
  }

  const hasVtmsVessels = Boolean(liveOverlays && liveOverlays.length > 0);

  const simState = getSimulationState();
  const baseCfg = getBasePortConfig();
  const effectiveCfg = getEffectivePortConfig(
    baseCfg,
    simState.simulationFlags,
    simState.simulationFlags?.activeScenarioIds || [],
  );

  const lookahead = computeLookahead(
    {
      vessels: simState.vessels,
      gates: simState.gates,
      trucks: simState.trucks,
      yard: simState.yard,
      berthLines: simState.berthLines,
      railRakes: simState.railRakes,
      cargoAggregates: simState.cargoAggregates,
      containers: simState.containers,
      simTime: simState.simTime,
    },
    effectiveCfg,
    240,
    5,
  );

  const berthMetaById = new Map(effectiveCfg.berths.map((b) => [b.id, b]));
  const lastTick = lookahead.perTickSnapshots.at(-1);
  const berthOccupiedHorizon = lastTick?.berthOccupied ?? lookahead.berthWindows.filter((w) => w.vesselId !== null).length;
  const berthTotal = lookahead.berthWindows.length || 1;

  const yardPct = lookahead.projectedYardUtilizationPct;
  const gateDelay = lookahead.gateDelayEstimateMins;
  const berthPct = parseFloat(((berthOccupiedHorizon / berthTotal) * 100).toFixed(1));

  const congestionIndex = Math.round(
    Math.min(
      100,
      Math.max(
        0,
        0.45 * yardPct +
          0.25 * Math.min(100, (gateDelay / 60) * 100) +
          0.30 * berthPct,
      ),
    ),
  );

  const drivers: string[] = [];
  const yardThreshold = effectiveCfg.defaults.yardCongestionUtilizationThresholdPct;
  if (yardPct >= yardThreshold) drivers.push('Yard nearing saturation');
  if (gateDelay >= 30) drivers.push('Gate delay rising');
  if (berthPct >= 75) drivers.push('Berths heavily utilized');
  if (drivers.length === 0) drivers.push('No major bottleneck detected');

  const congestion4h = {
    horizonMins: 240,
    snapshotSimMins: lookahead.snapshotSimMins,
    horizonSimMins: lookahead.horizonSimMins,
    projectedYardUtilizationPct: lookahead.projectedYardUtilizationPct,
    gateDelayEstimateMins: lookahead.gateDelayEstimateMins,
    yardCrossesThresholdInMins:
      lookahead.yardCrossesThresholdSimMins == null
        ? null
        : Math.max(0, lookahead.yardCrossesThresholdSimMins - lookahead.snapshotSimMins),
    bottleneckAtHorizon: String(lastTick?.bottleneck || 'UNKNOWN'),
    berthUtilizationPctAtHorizon: berthPct,
    berthWindows: lookahead.berthWindows
      .map((w) => {
        const meta = berthMetaById.get(w.berthId);
        const vacancyInMins = Math.max(0, w.estimatedVacancySimMins - lookahead.snapshotSimMins);
        return {
          berthId: w.berthId,
          berthCode: meta?.code || w.berthId,
          berthName: meta?.displayName || w.berthId,
          vesselId: w.vesselId,
          vacancyInMins,
        };
      })
      .sort((a, b) => a.berthCode.localeCompare(b.berthCode)),
    perTickSnapshots: lookahead.perTickSnapshots,
    congestionIndex,
    drivers,
    source: 'SUPPLY_CHAIN_LOOKAHEAD',
  };

  const upcomingVessels4h = simState.vessels
    .filter((v) => {
      const state = String(v.lifecycleState || '').toUpperCase();
      if (state === 'ANCHORED' || state === 'APPROACHING' || state === 'BERTHING' || state === 'LOADING') return true;
      const eta = v.eta ? new Date(v.eta).getTime() : NaN;
      if (!Number.isFinite(eta)) return false;
      return eta - Date.now() <= 4 * 60 * 60 * 1000 && eta - Date.now() >= -4 * 60 * 60 * 1000;
    })
    .slice(0, 12)
    .map((v) => ({
      id: v.id,
      name: v.name,
      lifecycleState: v.lifecycleState,
      eta: v.eta,
      berthNumber: v.berthNumber ?? null,
      assignedCranes: v.assignedCranes ?? null,
    }));

  const upcomingTrucks4h = {
    totalTrucks: simState.trucks.length,
    byState: simState.trucks.reduce((acc: Record<string, number>, t: any) => {
      const key = String(t?.state || 'UNKNOWN');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };

  const gemini = await generateBerthForecastWithGemini(
    hasVtmsVessels ? { liveOverlays: liveOverlays! } : {}
  );
  if (gemini) {
    const source = hasVtmsVessels ? 'GEMINI + VTMS' : 'GEMINI';
    return NextResponse.json(
      {
        ...gemini,
        congestion4h,
        upcomingVessels4h,
        upcomingTrucks4h,
      },
      {
      headers: {
        'X-Data-Source': source,
        'X-VTMS-Freshness-Ms': String(freshnessMs),
        'X-Berth-Forecast-Model': GEMINI_MODEL,
      },
      },
    );
  }

  if (hasVtmsVessels) {
    const forecast = generateBerthForecastData({ liveOverlays: liveOverlays! });
    return NextResponse.json(
      {
        ...forecast,
        congestion4h,
        upcomingVessels4h,
        upcomingTrucks4h,
      },
      {
      headers: {
        'X-Data-Source': 'VTMS_LIVE + Simulation',
        'X-VTMS-Freshness-Ms': String(freshnessMs),
        'X-Berth-Forecast-Model': 'simulation',
      },
      },
    );
  }

  return NextResponse.json(
    {
      ...generateBerthForecastData(),
      congestion4h,
      upcomingVessels4h,
      upcomingTrucks4h,
    },
    {
    headers: {
      'X-Data-Source': 'Simulation',
      'X-VTMS-Freshness-Ms': '-1',
      'X-Berth-Forecast-Model': 'simulation',
    },
    },
  );
}

export const GET = withApiLogging('GET', '/api/berth/forecast', getHandler);
