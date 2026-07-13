/**
 * lib/lookahead.ts
 * 4-hour supply-chain lookahead using the exact same stepSupplyChain formulas as Phase 3.
 * Pure function — no I/O, no globals, no side effects.
 *
 * Golden-test invariant: fast-forwarding N ticks with stepSupplyChain directly must
 * produce the same yard/gate/berth state as computeLookahead(state, config, N*tickMins).
 */

import { stepSupplyChain, type SupplyChainState } from './supplyChainEngine';
import type { PortConfig } from './portConfig.types';

// ── Output types ─────────────────────────────────────────────────────────────

/** Vacancy window for one berth over the lookahead horizon. */
export interface BerthWindow {
  berthId: string;
  /** null = berth is already vacant at the start of the lookahead window. */
  vesselId: string | null;
  /**
   * Simulation clock (minutes) when the berth is projected to become free.
   * For vacant berths this equals snapshotSimMins (already free).
   * For occupied berths this comes from BerthLineState.opsEndProjectedSimMins.
   */
  estimatedVacancySimMins: number;
}

/** Single-tick summary for trend analysis / golden tests. */
export interface PerTickSnapshot {
  simTimeMins: number;
  yardOccPct: number;
  gateQueueTotal: number;
  berthOccupied: number;
  bottleneck: string;
}

export interface LookaheadResult {
  /** Simulation clock at the start of the lookahead (= currentState.simTime). */
  snapshotSimMins: number;
  /** Simulation clock at the end of the lookahead window (= snapshotSimMins + lookaheadMins). */
  horizonSimMins: number;
  /** Per-berth vacancy windows at the lookahead horizon. */
  berthWindows: BerthWindow[];
  /** Yard utilization (%) at the lookahead horizon. */
  projectedYardUtilizationPct: number;
  /**
   * Average gate wait estimate (minutes) at the lookahead horizon.
   * Uses M/D/c approximation: queueLength / serviceRatePerMin.
   */
  gateDelayEstimateMins: number;
  /**
   * Simulation clock (minutes) when yard first crosses the congestion threshold.
   * null = yard stays below threshold for the entire lookahead window.
   */
  yardCrossesThresholdSimMins: number | null;
  /** Per-tick snapshots — same length as Math.floor(lookaheadMins / tickMins). */
  perTickSnapshots: PerTickSnapshot[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fast-forward the supply chain from currentState by lookaheadMins, returning
 * berth windows, projected yard utilization, and gate delay estimates.
 *
 * Identical formulas to stepSupplyChain (Phase 3), so golden tests can compare
 * the two paths over the same simulation window.
 *
 * @param currentState       - Current SupplyChainState snapshot (not mutated)
 * @param effectivePortConfig - Result of getEffectivePortConfig(base, flags, scenarios)
 * @param lookaheadMins      - How far ahead to project (default 240 = 4 hours)
 * @param tickMins           - Per-tick advancement (must match SIM_TICK_MINUTES; default 5)
 */
export function computeLookahead(
  currentState: SupplyChainState,
  effectivePortConfig: PortConfig,
  lookaheadMins = 240,
  tickMins = 5,
): LookaheadResult {
  const ticks = Math.max(1, Math.floor(lookaheadMins / tickMins));
  const thresholdPct = effectivePortConfig.defaults.yardCongestionUtilizationThresholdPct;

  let state = currentState;
  const snapshots: PerTickSnapshot[] = [];
  let yardCrossesThresholdSimMins: number | null = null;

  for (let i = 0; i < ticks; i++) {
    const { nextState, derivedMetrics } = stepSupplyChain(state, effectivePortConfig, tickMins);
    state = nextState;

    if (
      yardCrossesThresholdSimMins === null &&
      derivedMetrics.totalYardOccupancyPct >= thresholdPct
    ) {
      yardCrossesThresholdSimMins = state.simTime;
    }

    snapshots.push({
      simTimeMins: state.simTime,
      yardOccPct: derivedMetrics.totalYardOccupancyPct,
      gateQueueTotal: state.gates.reduce((s, g) => s + g.queueLength, 0),
      berthOccupied: state.berthLines.filter((b) => b.vesselId !== null).length,
      bottleneck: derivedMetrics.bottleneck,
    });
  }

  // Berth vacancy windows at the horizon
  const berthWindows: BerthWindow[] = state.berthLines.map((bl) => ({
    berthId: bl.berthId,
    vesselId: bl.vesselId,
    estimatedVacancySimMins: bl.vesselId
      ? bl.opsEndProjectedSimMins
      : currentState.simTime, // already vacant
  }));

  const gateDelayEstimateMins = estimateGateDelay(state, effectivePortConfig);

  return {
    snapshotSimMins: currentState.simTime,
    horizonSimMins: state.simTime,
    berthWindows,
    projectedYardUtilizationPct: parseFloat((state.yard.occupancyFactor * 100).toFixed(1)),
    gateDelayEstimateMins,
    yardCrossesThresholdSimMins,
    perTickSnapshots: snapshots,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Estimate average gate wait at current state using M/D/c queue approximation.
 * Wait ≈ queueLength / serviceRatePerMin (ignores inter-arrival variance for simplicity).
 */
function estimateGateDelay(state: SupplyChainState, portConfig: PortConfig): number {
  const openGates = state.gates.filter((g) => g.status !== 'CLOSED');
  if (openGates.length === 0) return 999;

  let totalDelay = 0;
  let count = 0;

  for (const gate of openGates) {
    const cfg = portConfig.gates.find((g) => g.id === gate.id);
    if (!cfg || cfg.service.activeLanes === 0) {
      totalDelay += 60; // effectively closed — long wait
      count++;
      continue;
    }
    const serviceRatePerMin = cfg.service.activeLanes / cfg.service.avgTruckProcessMins;
    totalDelay += serviceRatePerMin > 0 ? gate.queueLength / serviceRatePerMin : 60;
    count++;
  }

  return count > 0 ? parseFloat((totalDelay / count).toFixed(1)) : 0;
}
