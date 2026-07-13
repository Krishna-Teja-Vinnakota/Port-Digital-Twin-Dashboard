/**
 * GET /api/simulation/state
 * Returns the full Port port snapshot from the server-side simulation singleton.
 */

import { NextResponse } from 'next/server';
import { getSimulationState } from '@/lib/simulationStore';
import { withApiLogging } from '@/lib/apiLogger';

async function getHandler() {
  try {
    const state = getSimulationState();
    return NextResponse.json({
      vessels:   state.vessels,
      gates:     state.gates,
      trucks:    state.trucks,
      alerts:    state.alerts,
      kpis:      state.kpis,
      simTime:   state.simTime,
      yard:      state.yard,
      eventLog:  state.eventLog,
      lastUpdated: state.lastUpdated,
      simulationFlags: state.simulationFlags,
      lastTimingProfile: state.lastTimingProfile,
      scenarioSeed: state.scenarioSeed,
    });
  } catch (err) {
    console.error('Failed to get simulation state:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withApiLogging('GET', '/api/simulation/state', getHandler);
