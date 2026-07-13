/**
 * POST /api/simulation/action
 * Applies a simulation action to the server-side state and returns updated state + alerts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { applySimulationAction } from '@/lib/simulationStore';
import { withApiLogging } from '@/lib/apiLogger';

async function postHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action;
    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }
    const { action: _omit, ...payload } = body;
    const result = applySimulationAction(action, payload);

    const s = result.updatedState;
    return NextResponse.json({
      success: true,
      updatedState: {
        vessels: s.vessels,
        gates: s.gates,
        trucks: s.trucks,
        alerts: s.alerts,
        kpis: s.kpis,
        yard: s.yard,
        eventLog: s.eventLog,
        simTime: s.simTime,
        simulationFlags: s.simulationFlags,
        lastTimingProfile: s.lastTimingProfile,
        scenarioSeed: s.scenarioSeed,
      },
      triggeredAlerts: result.triggeredAlerts,
      toastMessage: result.toastMessage,
    });
  } catch (err) {
    console.error('Simulation action error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const POST = withApiLogging('POST', '/api/simulation/action', postHandler);
