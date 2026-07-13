/**
 * lib/supplyChainEngine.ts
 * Pure supply-chain simulation step — no side effects, no globals.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PHASE 0 CONTRACTS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── Simulation tick ──────────────────────────────────────────────────────────
 * One server tick fires every 30 real seconds (TICK_INTERVAL_MS = 30_000 ms in
 * simulationStore.js). Each tick advances the simulation clock by
 * SIM_TICK_MINUTES = 5. All throughput rates in portConfig are per-hour; scale
 * by (simDeltaMins / 60) to get per-tick deltas.
 *
 * ── Berth assignment rule ─────────────────────────────────────────────────────
 * FIRST-FIT BY ETA: when a vessel transitions to BERTHING and no berthLine has
 * it, iterate portConfig.berths in declaration order and assign the first whose
 * berthLine.vesselId === null AND whose portConfig entry has status OPERATIONAL.
 * Tie-break: lowest vessel.eta string (ISO-8601 lexicographic = chronological).
 * This rule is the ONLY berth assignment path — do not add a second rule.
 *
 * ── Live AIS merge ────────────────────────────────────────────────────────────
 * softSyncSimulationVessels (simulationStore.js) updates position/state/eta/berth
 * from AIS/VTMS. It does NOT reset cargoAggregates or berthLines; those persist
 * their accumulated TEU totals. If AIS transitions a vessel to LOADING and the
 * berthLine is vacant, the next stepSupplyChain call will call assignBerthIfNeeded
 * and ops continue from the current teuDischarged baseline (0 for new arrivals).
 *
 * ── Surface inventory ─────────────────────────────────────────────────────────
 * Surface                    Reads
 * ──────────────────────────────────────────────────────────────────────────────
 * GET /api/simulation/state  ALL fields (full snapshot)
 * GET /api/kpi               vessels, gates, trucks, yard, kpis, derivedMetrics
 * GET /api/vessels           vessels (+ AIS merge)
 * GET /api/gates             gates (+ geofence)
 * GET /api/trucks            trucks (+ OpenCV overlay)
 * GET /api/berth/forecast    berthLines, cargoAggregates, berthScheduler
 * GET /api/rail              railRakes
 * GET /api/energy            substations (standalone from yard)
 * GET /api/environment       standalone sensors
 * POST /api/ai/chat          vessels, kpis, yard, derivedMetrics (AI context)
 *
 * ── Feature flag ──────────────────────────────────────────────────────────────
 * Set USE_AGGREGATE_SUPPLY_CHAIN=true in .env.local to enable this engine in the
 * server tick. When false (default), simulationStore.js falls back to the legacy
 * advanceVesselState + advanceGateQueues path. The flag keeps the new engine
 * isolated until golden tests pass.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { PortConfig } from './portConfig.types';
import type {
  SimVessel,
  SimGate,
  SimTruck,
  SimYard,
  YardBlock,
  BerthLineState,
  RailRakeState,
  VesselCargoAggregate,
  SimContainer,
  SimulationFlags,
  ScenarioId,
  CongestionLevel,
} from './simulationTypes';
import { getCongestionLevel } from './gateEngine.js';
import { getEffectivePortConfig } from './portConfigApply';

// ─── Supply-chain state slice ─────────────────────────────────────────────────

/** The slice of SimulationState that stepSupplyChain reads and returns. */
export interface SupplyChainState {
  vessels: SimVessel[];
  gates: SimGate[];
  trucks: SimTruck[];
  yard: SimYard;
  berthLines: BerthLineState[];
  railRakes: RailRakeState[];
  cargoAggregates: VesselCargoAggregate[];
  containers: SimContainer[];
  simTime: number;                 // minutes since simulation epoch
}

/** Derived metrics returned alongside the next state. */
export interface SupplyChainMetrics {
  /** Which sub-system is the current bottleneck (heuristic). */
  bottleneck: 'BERTH' | 'YARD' | 'GATE' | 'RAIL' | 'NONE';
  /** Total yard occupancy 0–100 (%). */
  totalYardOccupancyPct: number;
  /** Fraction of berths currently occupied (0–1). */
  berthUtilizationFraction: number;
  /** Total truck service rate across all open gates (trucks / minute). */
  gateServiceRateTrucksPerMin: number;
  /** Estimated minutes until yard crosses congestion threshold at current net inflow. */
  projectedYardFillMins: number;
}

export interface StepResult {
  nextState: SupplyChainState;
  derivedMetrics: SupplyChainMetrics;
}

// ─── Berth helpers ────────────────────────────────────────────────────────────

/**
 * Assign BERTHING vessels to vacant OPERATIONAL berths (first-fit by ETA).
 * Returns updated berthLines and cargoAggregates (new aggregate rows added).
 */
function assignBerthIfNeeded(
  vessels: SimVessel[],
  berthLines: BerthLineState[],
  cargoAggregates: VesselCargoAggregate[],
  portConfig: PortConfig,
  simTimeMins: number,
): { berthLines: BerthLineState[]; cargoAggregates: VesselCargoAggregate[] } {
  // Collect vessels needing assignment (BERTHING or LOADING, no berthLine yet)
  const assignedVesselIds = new Set(berthLines.map((b) => b.vesselId).filter(Boolean));
  const needsAssignment = vessels
    .filter(
      (v) =>
        (v.lifecycleState === 'BERTHING' || v.lifecycleState === 'LOADING') &&
        !assignedVesselIds.has(v.id),
    )
    .sort((a, b) => (a.eta < b.eta ? -1 : 1)); // sort by ETA (first-fit tie-break)

  if (needsAssignment.length === 0) {
    return { berthLines, cargoAggregates };
  }

  let updatedLines = [...berthLines];
  let updatedAggregates = [...cargoAggregates];

  for (const vessel of needsAssignment) {
    // First-fit: first OPERATIONAL berth with no vessel
    const vacantIdx = updatedLines.findIndex((bl) => {
      if (bl.vesselId !== null) return false;
      const cfg = portConfig.berths.find((b) => b.id === bl.berthId);
      return cfg?.status === 'OPERATIONAL';
    });
    if (vacantIdx === -1) continue; // no vacant berth — vessel queues

    const berth = portConfig.berths.find((b) => b.id === updatedLines[vacantIdx]!.berthId)!;
    const effectiveCranes = Math.min(vessel.assignedCranes ?? berth.nominalStsCranes, berth.nominalStsCranes);
    const teu = getTeuForVessel(vessel, updatedAggregates);
    const movesPerMin = (berth.movesPerCranePerHour * effectiveCranes) / 60;
    const opsEndProjected = movesPerMin > 0
      ? simTimeMins + Math.ceil(teu / movesPerMin)
      : simTimeMins + 1200; // fallback 20 hrs

    updatedLines[vacantIdx] = {
      ...updatedLines[vacantIdx]!,
      vesselId: vessel.id,
      opsStartSimMins: simTimeMins,
      opsEndProjectedSimMins: opsEndProjected,
      assignedCranesEffective: effectiveCranes,
    };

    // Seed cargo aggregate if not present
    if (!updatedAggregates.find((a) => a.vesselId === vessel.id)) {
      updatedAggregates.push({
        vesselId: vessel.id,
        teuToDischarge: teu,
        teuToLoad: Math.floor(teu * 0.6),  // nominal 60% reload
        teuDischarged: 0,
        teuLoaded: 0,
      });
    }
  }

  return { berthLines: updatedLines, cargoAggregates: updatedAggregates };
}

/** Get TEU for a vessel, preferring the cargo aggregate (already discharged TEU). */
function getTeuForVessel(vessel: SimVessel, aggregates: VesselCargoAggregate[]): number {
  const agg = aggregates.find((a) => a.vesselId === vessel.id);
  if (agg) return Math.max(0, agg.teuToDischarge - agg.teuDischarged);
  const raw = (vessel.teuEstimate?.value ?? 0);
  return raw > 0 ? raw : 1800; // fallback TEU for vessels without manifest
}

/** Advance TEU discharge for all occupied berths. Returns yard TEU inflow delta. */
function stepBerths(
  vessels: SimVessel[],
  berthLines: BerthLineState[],
  cargoAggregates: VesselCargoAggregate[],
  portConfig: PortConfig,
  simDeltaMins: number,
): { updatedAggregates: VesselCargoAggregate[]; yardTeuInflow: number } {
  let yardTeuInflow = 0;
  const updatedAggregates = cargoAggregates.map((agg) => {
    const line = berthLines.find((b) => b.vesselId === agg.vesselId);
    if (!line) return agg;

    const berth = portConfig.berths.find((b) => b.id === line.berthId);
    if (!berth) return agg;

    const movesPerMin = (berth.movesPerCranePerHour * line.assignedCranesEffective) / 60;
    const teuThisTick = movesPerMin * simDeltaMins;
    const remaining = agg.teuToDischarge - agg.teuDischarged;
    const discharged = Math.min(remaining, teuThisTick);
    yardTeuInflow += Math.floor(discharged);

    return {
      ...agg,
      teuDischarged: agg.teuDischarged + discharged,
    };
  });
  return { updatedAggregates, yardTeuInflow };
}

/** Release berth lines for fully-discharged vessels. */
function releaseBerths(
  berthLines: BerthLineState[],
  cargoAggregates: VesselCargoAggregate[],
): BerthLineState[] {
  return berthLines.map((bl) => {
    if (!bl.vesselId) return bl;
    const agg = cargoAggregates.find((a) => a.vesselId === bl.vesselId);
    if (!agg) return bl;
    const dischargeDone = agg.teuDischarged >= agg.teuToDischarge;
    const loadDone = agg.teuLoaded >= agg.teuToLoad;
    if (dischargeDone && loadDone) {
      return { ...bl, vesselId: null, opsStartSimMins: 0, opsEndProjectedSimMins: 0, assignedCranesEffective: 0 };
    }
    return bl;
  });
}

// ─── Yard helpers ─────────────────────────────────────────────────────────────

/**
 * Update yard TEU totals and per-block throughputFactor.
 * Congestion threshold from effectivePortConfig.defaults.
 */
function stepYard(
  yard: SimYard,
  portConfig: PortConfig,
  incomingTeu: number,
  outgoingTeu: number,
): SimYard {
  const newTotal = Math.max(0, Math.min(yard.capacityTEU, yard.currentTEU + incomingTeu - outgoingTeu));
  const newOccupancy = newTotal / yard.capacityTEU;
  const threshold = portConfig.defaults.yardCongestionUtilizationThresholdPct / 100;

  // Per-block proportional update + throughputFactor degradation above threshold
  const updatedBlocks: YardBlock[] = yard.blocks.map((block) => {
    const blockFraction = block.capacity > 0 ? block.capacity / yard.capacityTEU : 0;
    const blockOccupied = Math.min(block.capacity, Math.round(newTotal * blockFraction));
    const blockOccupancyFraction = blockOccupied / block.capacity;

    // throughputFactor degrades linearly from 1.0 at threshold to 0.5 at 100% full
    const throughputFactor =
      blockOccupancyFraction > threshold
        ? Math.max(0.5, 1.0 - (blockOccupancyFraction - threshold) / (1 - threshold) * 0.5)
        : 1.0;

    return { ...block, occupied: blockOccupied, throughputFactor };
  });

  return {
    ...yard,
    currentTEU: newTotal,
    occupancyFactor: newOccupancy,
    blocks: updatedBlocks,
  };
}

// ─── Gate helpers ─────────────────────────────────────────────────────────────

/**
 * Advance gate queues using effective config service rates.
 * Uses M/M/c–style simplified formula: service = activeLanes / avgTruckProcessMins.
 */
function stepGates(
  gates: SimGate[],
  portConfig: PortConfig,
  simDeltaMins: number,
): SimGate[] {
  const { gateQueueMediumThreshold, gateQueueHighThreshold } = portConfig.defaults;

  return gates.map((gate) => {
    const cfgGate = portConfig.gates.find((g) => g.id === gate.id);
    if (!gate || gate.status === 'CLOSED' || !cfgGate) return gate;

    const lanesOpen = Math.max(0, cfgGate.service.activeLanes);
    if (lanesOpen === 0) {
      // Gate effectively closed per effective config — accumulate inflow only
      const inflow = Math.round(simDeltaMins * 1.5); // ~1.5 trucks/min ambient
      return {
        ...gate,
        queueLength: gate.queueLength + inflow,
        congestionLevel: 'HIGH' as CongestionLevel,
        lastUpdated: new Date().toISOString(),
      };
    }

    // Service rate (trucks / minute) from config
    const serviceRatePerMin = lanesOpen / cfgGate.service.avgTruckProcessMins;
    const served = Math.floor(serviceRatePerMin * simDeltaMins);
    // Ambient inflow: proportional to gate's nominal load (~70% of service rate)
    const inflow = Math.round(serviceRatePerMin * simDeltaMins * 0.7);
    const newQueue = Math.max(0, gate.queueLength - served + inflow);
    const congestion = getCongestionLevel(
      newQueue,
      gate.status,
      gateQueueMediumThreshold,
      gateQueueHighThreshold,
    ) as CongestionLevel;

    return {
      ...gate,
      queueLength: newQueue,
      congestionLevel: congestion,
      trucksTodayProcessed: gate.trucksTodayProcessed + served,
      avgProcessingTimeMins: cfgGate.service.avgTruckProcessMins,
      lastUpdated: new Date().toISOString(),
    };
  });
}

// ─── Rail helpers ─────────────────────────────────────────────────────────────

/**
 * Advance rail rake stages and exchange TEU with yard.
 * Returns updated rakes and yard TEU delta (positive = yard receives TEU from rail).
 */
function stepRail(
  railRakes: RailRakeState[],
  portConfig: PortConfig,
  simTimeMins: number,
  simDeltaMins: number,
): { updatedRakes: RailRakeState[]; yardTeuFromRail: number } {
  let yardTeuFromRail = 0;

  const updatedRakes: RailRakeState[] = railRakes.map((rake) => {
    const siding = portConfig.railSidings.find((s) => s.id === rake.sidingId);
    if (!siding) return rake;

    // Stage transitions: advance when etaSimMins reached
    if (simTimeMins < rake.etaSimMins) return rake;

    const STAGE_ORDER: RailRakeState['stage'][] = [
      'ALLOCATED', 'IN_TRANSIT', 'PORT_ENTRY', 'SIDING', 'TERMINAL', 'EXIT',
    ];
    const currentIdx = STAGE_ORDER.indexOf(rake.stage);
    const nextStage = STAGE_ORDER[currentIdx + 1];
    if (!nextStage) return rake; // already at EXIT

    // TEU transfer happens at TERMINAL stage
    let teuDelta = 0;
    if (rake.stage === 'SIDING' && nextStage === 'TERMINAL') {
      const transferCapacity = (siding.teuTransferPerHour / 60) * simDeltaMins;
      teuDelta = Math.min(rake.teuOnboard, Math.floor(transferCapacity));
      yardTeuFromRail += teuDelta;
    }

    // Nominal stage duration: 30–60 mins per stage
    const nextEta = simTimeMins + 45;

    return {
      ...rake,
      stage: nextStage,
      teuOnboard: rake.teuOnboard - teuDelta,
      etaSimMins: nextEta,
    };
  });

  return { updatedRakes, yardTeuFromRail };
}

// ─── Main step function ───────────────────────────────────────────────────────

/**
 * Advance the supply chain by one simulation tick.
 *
 * Pure function: no global state, no I/O. Takes a snapshot, returns the next
 * snapshot plus derived metrics. simulationStore.js calls this inside tickSimulation
 * when USE_AGGREGATE_SUPPLY_CHAIN=true.
 *
 * @param state            - Current supply-chain state slice
 * @param effectivePortConfig - Result of getEffectivePortConfig(base, flags, scenarios)
 * @param simDeltaMins     - Simulation minutes to advance (SIM_TICK_MINUTES = 5)
 */
export function stepSupplyChain(
  state: SupplyChainState,
  effectivePortConfig: PortConfig,
  simDeltaMins: number,
): StepResult {
  const nextSimTime = state.simTime + simDeltaMins;

  // 1. Assign berths to vessels entering BERTHING / LOADING
  const { berthLines: linesAfterAssign, cargoAggregates: aggAfterAssign } =
    assignBerthIfNeeded(
      state.vessels,
      state.berthLines,
      state.cargoAggregates,
      effectivePortConfig,
      state.simTime,
    );

  // 2. Advance TEU discharge at berths → yard receives TEU
  const { updatedAggregates, yardTeuInflow } = stepBerths(
    state.vessels,
    linesAfterAssign,
    aggAfterAssign,
    effectivePortConfig,
    simDeltaMins,
  );

  // 3. Release berths for completed ops
  const releasedLines = releaseBerths(linesAfterAssign, updatedAggregates);

  // 4. Rail TEU handoff to yard
  const { updatedRakes, yardTeuFromRail } = stepRail(
    state.railRakes,
    effectivePortConfig,
    state.simTime,
    simDeltaMins,
  );

  // 5. Truck outflow from yard: EXITING trucks each remove 2 TEU
  const exitingTrucks = state.trucks.filter((t) => t.state === 'EXITING').length;
  const yardTeuOutflow = exitingTrucks * 2;

  // 6. Update yard
  const nextYard = stepYard(
    state.yard,
    effectivePortConfig,
    yardTeuInflow + yardTeuFromRail,
    yardTeuOutflow,
  );

  // 7. Advance gate queues
  const nextGates = stepGates(state.gates, effectivePortConfig, simDeltaMins);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const yardOccPct = nextYard.occupancyFactor * 100;
  const threshold = effectivePortConfig.defaults.yardCongestionUtilizationThresholdPct;
  const occupiedBerths = releasedLines.filter((b) => b.vesselId !== null).length;
  const berthUtilFraction =
    releasedLines.length > 0 ? occupiedBerths / releasedLines.length : 0;

  const openGateRate = nextGates.reduce((sum, gate) => {
    if (gate.status === 'CLOSED') return sum;
    const cfg = effectivePortConfig.gates.find((g) => g.id === gate.id);
    if (!cfg || cfg.service.activeLanes === 0) return sum;
    return sum + cfg.service.activeLanes / cfg.service.avgTruckProcessMins;
  }, 0);

  const totalGateQueue = nextGates.reduce((s, g) => s + g.queueLength, 0);

  // Projected fill: (threshold_teu - currentTEU) / net_inflow_per_min
  const thresholdTeu = effectivePortConfig.defaults.yardCongestionUtilizationThresholdPct / 100
    * state.yard.capacityTEU;
  const netInflowPerMin =
    simDeltaMins > 0 ? (yardTeuInflow + yardTeuFromRail - yardTeuOutflow) / simDeltaMins : 0;
  const projectedFillMins =
    netInflowPerMin > 0 && nextYard.currentTEU < thresholdTeu
      ? Math.round((thresholdTeu - nextYard.currentTEU) / netInflowPerMin)
      : Infinity;

  const bottleneck: SupplyChainMetrics['bottleneck'] =
    yardOccPct >= threshold ? 'YARD'
    : totalGateQueue >= effectivePortConfig.defaults.gateQueueHighThreshold * nextGates.length ? 'GATE'
    : occupiedBerths === releasedLines.length && releasedLines.length > 0 ? 'BERTH'
    : updatedRakes.filter((r) => r.stage === 'SIDING' || r.stage === 'TERMINAL').length
        >= effectivePortConfig.railSidings.reduce((s, rs) => s + rs.maxConcurrentRakes, 0) ? 'RAIL'
    : 'NONE';

  const derivedMetrics: SupplyChainMetrics = {
    bottleneck,
    totalYardOccupancyPct: parseFloat(yardOccPct.toFixed(1)),
    berthUtilizationFraction: parseFloat(berthUtilFraction.toFixed(3)),
    gateServiceRateTrucksPerMin: parseFloat(openGateRate.toFixed(3)),
    projectedYardFillMins: isFinite(projectedFillMins) ? projectedFillMins : -1,
  };

  const nextState: SupplyChainState = {
    vessels: state.vessels,       // vessel lifecycle driven by simulationStore
    gates: nextGates,
    trucks: state.trucks,         // truck lifecycle driven by tickTrucks
    yard: nextYard,
    berthLines: releasedLines,
    railRakes: updatedRakes,
    cargoAggregates: updatedAggregates,
    containers: state.containers, // container pairing driven by client store tick
    simTime: nextSimTime,
  };

  return { nextState, derivedMetrics };
}

// ─── Phase 8: Congestion snapshot schema + emitter ───────────────────────────

/** JSON snapshot schema for the analytics / congestion export dataset. */
export interface CongestionSnapshot {
  /** ISO-8601 wall-clock timestamp when the snapshot was taken. */
  timestamp: string;
  /** Simulation clock (minutes) at snapshot time. */
  simTimeMins: number;
  /** Active scenario IDs at snapshot time. */
  scenarioIds: ScenarioId[];
  totalYardOccupancyPct: number;
  berthUtilizationFraction: number;
  gateQueueTotal: number;
  railRakesActive: number;
  bottleneck: SupplyChainMetrics['bottleneck'];
  perGate: Array<{
    gateId: number;
    queueLength: number;
    congestion: CongestionLevel;
    serviceRateTrucksPerHour: number;
  }>;
  perBerth: Array<{
    berthId: string;
    vesselId: string | null;
    teuDischargePct: number;       // 0–100
  }>;
}

/**
 * Build a CongestionSnapshot from current state + metrics.
 * Emit on each tick or on scenario change for analytics consumers.
 *
 * @param state          - Current SupplyChainState (post-step)
 * @param simulationFlags - Runtime flags for scenario id list
 * @param portConfig     - Effective port config for service rates
 * @param metrics        - Derived metrics from the same step
 */
export function buildCongestionSnapshot(
  state: SupplyChainState,
  simulationFlags: SimulationFlags,
  portConfig: PortConfig,
  metrics: SupplyChainMetrics,
): CongestionSnapshot {
  const perGate = state.gates.map((gate) => {
    const cfg = portConfig.gates.find((g) => g.id === gate.id);
    const lanes = cfg?.service.activeLanes ?? 0;
    const processMins = cfg?.service.avgTruckProcessMins ?? 1;
    const ratePerHour = lanes > 0 ? (lanes / processMins) * 60 : 0;
    return {
      gateId: gate.id,
      queueLength: gate.queueLength,
      congestion: gate.congestionLevel,
      serviceRateTrucksPerHour: parseFloat(ratePerHour.toFixed(1)),
    };
  });

  const perBerth = state.berthLines.map((bl) => {
    const agg = state.cargoAggregates.find((a) => a.vesselId === bl.vesselId);
    const teuDischargePct =
      agg && agg.teuToDischarge > 0
        ? parseFloat(((agg.teuDischarged / agg.teuToDischarge) * 100).toFixed(1))
        : 0;
    return { berthId: bl.berthId, vesselId: bl.vesselId, teuDischargePct };
  });

  return {
    timestamp: new Date().toISOString(),
    simTimeMins: state.simTime,
    scenarioIds: simulationFlags.activeScenarioIds,
    totalYardOccupancyPct: metrics.totalYardOccupancyPct,
    berthUtilizationFraction: metrics.berthUtilizationFraction,
    gateQueueTotal: state.gates.reduce((s, g) => s + g.queueLength, 0),
    railRakesActive: state.railRakes.filter((r) =>
      r.stage === 'SIDING' || r.stage === 'TERMINAL',
    ).length,
    bottleneck: metrics.bottleneck,
    perGate,
    perBerth,
  };
}

// ─── timingMatrix wrappers ────────────────────────────────────────────────────

/**
 * Effective TEU throughput per hour for a berth given crane count and vessel class.
 * One place to change when crane_breakdown or vessel class affects throughput.
 *
 * @param portConfig     - effective (post-scenario) port config
 * @param berthId        - target berth id
 * @param assignedCranes - effective crane count (vessel.assignedCranes after scenario)
 */
export function berthTeuPerHour(
  portConfig: PortConfig,
  berthId: string,
  assignedCranes: number,
): number {
  const berth = portConfig.berths.find((b) => b.id === berthId);
  if (!berth) return 0;
  const cranes = Math.min(assignedCranes, berth.nominalStsCranes);
  return berth.movesPerCranePerHour * cranes;
}

/**
 * Yard transit multiplier for a given block occupancy fraction.
 * Delegates to yard threshold from portConfig; no hardcoded percentages.
 *
 * @param portConfig      - effective port config
 * @param blockOccupancy  - fraction 0–1 (occupied / capacity)
 */
export function yardTransitMultiplierForBlock(
  portConfig: PortConfig,
  blockOccupancy: number,
): number {
  const threshold = portConfig.defaults.yardCongestionUtilizationThresholdPct / 100;
  if (blockOccupancy <= threshold) return 1.0;
  // Linear scale: 1.0 at threshold → 1.7 at 100% (matching YARD_FACTORS.critical)
  return Math.min(1.7, 1.0 + (blockOccupancy - threshold) / (1 - threshold) * 0.7);
}
