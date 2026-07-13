/**
 * simulationStore.js
 * Server-side singleton simulation state for Port Digital Twin ICCC.
 * Timing matrix, truck state machine, yard capacity, event log, scenarios.
 *
 * @typedef {import('./simulationTypes').SimulationState} SimulationState
 * @typedef {import('./simulationTypes').SimVessel} SimVessel
 * @typedef {import('./simulationTypes').SimEvent} SimEvent
 */

import seedrandom from 'seedrandom';
import { generateInitialVessels } from './vesselEngine.js';
import { generateInitialGates } from './gateEngine.js';
import { generateTruck, generateInitialTrucks } from './mockDataGen.js';
import { checkAllAlerts } from './alertEngine.js';
import { calculateKPIs } from './carbonCalculator.js';
import { tickTrucks } from './truckEngine';
import { getVesselTeuForOps } from './manifestEnricher';
import { mergeScenarioParameterOverrides, SCENARIO_DEFINITIONS } from './scenarios';
import { getCurrentTimingProfile } from './timingMatrix';
import { Port_PORT_CONFIG } from './portConfig';
import { getEffectivePortConfig } from './portConfigApply';
import { stepSupplyChain } from './supplyChainEngine';

const USE_AGGREGATE_SUPPLY_CHAIN = process.env.USE_AGGREGATE_SUPPLY_CHAIN === 'true';

/** @type {SimulationState | null} */
let state = null;
let tickInterval = null;
let globalSimTime = 0;

const SIM_TICK_MINUTES = 5;
const TICK_INTERVAL_MS = 30_000;

// ── Yard --------------------------------------------------------------------

/**
 * Build initial yard state from portConfig block definitions.
 * Blocks use portConfig blockIds (e.g. 'IMPORT_BLOCK_A') as authoritative IDs.
 * @param {import('./portConfig.types').PortConfig} portConfig
 * @param {number} [occupancyPctOverride] - override all blocks to this % (0–100)
 */
function createInitialYardFromConfig(portConfig, occupancyPctOverride) {
  const blocks = portConfig.yardBlocks.map((bc) => {
    const fraction =
      occupancyPctOverride !== undefined
        ? occupancyPctOverride / 100
        : bc.initialOccupiedFraction;
    return {
      blockId: bc.blockId,
      capacity: bc.maxTeu,
      occupied: Math.floor(bc.maxTeu * fraction),
      throughputFactor: 1.0,
    };
  });
  const capacityTEU = blocks.reduce((s, b) => s + b.capacity, 0);
  const currentTEU = blocks.reduce((s, b) => s + b.occupied, 0);
  return {
    capacityTEU,
    currentTEU,
    occupancyFactor: capacityTEU > 0 ? currentTEU / capacityTEU : 0,
    blocks,
  };
}

/** Seed vacant BerthLineState entries for each berth in portConfig. */
function createInitialBerthLines(portConfig) {
  return portConfig.berths.map((b) => ({
    berthId: b.id,
    vesselId: null,
    opsStartSimMins: 0,
    opsEndProjectedSimMins: 0,
    assignedCranesEffective: 0,
  }));
}

/** Cargo aggregates are seeded on-demand by assignBerthIfNeeded in supplyChainEngine. */
function createInitialCargoAggregates() {
  return [];
}

/**
 * Seed one ALLOCATED rake per siding staggered in arrival time.
 * @param {import('./portConfig.types').PortConfig} portConfig
 * @param {number} simTime
 */
function createInitialRailRakes(portConfig, simTime) {
  return portConfig.railSidings.flatMap((siding, i) =>
    Array.from({ length: Math.min(1, siding.maxConcurrentRakes) }, (_, j) => ({
      rakeId: `RAKE-${siding.id}-${String(j + 1).padStart(2, '0')}`,
      sidingId: siding.id,
      stage: 'ALLOCATED',
      teuOnboard: Math.floor(siding.teuTransferPerHour * 1.5),
      etaSimMins: simTime + 60 + i * 30 + j * 15,
      yardHandoffBlockId: siding.connectedYardBlockIds[0] ?? null,
    })),
  );
}

function clampYardTeu(yard, nextTeu) {
  return Math.min(yard.capacityTEU, Math.max(0, nextTeu));
}

function syncYardFactor(yard) {
  return {
    ...yard,
    occupancyFactor: yard.currentTEU / yard.capacityTEU,
  };
}

// ── Public API --------------------------------------------------------------

export function getSimulationState() {
  if (!state) {
    state = createInitialState();
    startTickEngine();
  }
  return /** @type {import('./simulationTypes').SimulationState} */ (state);
}

/**
 * @param {string} action
 * @param {object} payload
 * @returns {{ updatedState: SimulationState, triggeredAlerts: import('./simulationTypes').SimAlert[], toastMessage?: string }}
 */
export function applySimulationAction(action, payload = {}) {
  if (!state) getSimulationState();
  const { generateInitialVessels: genVessels } = require('./vesselEngine.js');
  const { generateTruck: genTruck } = require('./mockDataGen.js');

  let toastMessage = '';

  switch (action) {
    case 'CLOSE_GATE': {
      const gateId = payload.gateId || 3;
      state.gates = state.gates.map(g =>
        g.id === gateId ? { ...g, status: 'CLOSED', queueLength: 0 } : g
      );
      state.simulationFlags.gateClosures = [
        ...state.simulationFlags.gateClosures.filter(id => id !== gateId),
        gateId,
      ];
      const closedGate = state.gates.find(g => g.id === gateId);
      const closedQueue = closedGate?.queueLength || 30;
      state.gates = state.gates.map(g =>
        g.id !== gateId && g.status !== 'CLOSED'
          ? { ...g, queueLength: g.queueLength + Math.ceil(closedQueue / 2) }
          : g
      );
      if (!state.simulationFlags.activeScenarioIds.includes('CLOSE_GATE')) {
        state.simulationFlags.activeScenarioIds = [...state.simulationFlags.activeScenarioIds, 'CLOSE_GATE'];
      }
      toastMessage = `Gate ${gateId} closed — queues redistributed.`;
      break;
    }

    case 'OPEN_GATE': {
      const gateId = payload.gateId || 3;
      state.gates = state.gates.map(g =>
        g.id === gateId ? { ...g, status: 'OPEN', queueLength: 10 } : g
      );
      state.simulationFlags.gateClosures =
        state.simulationFlags.gateClosures.filter(id => id !== gateId);
      // Remove CLOSE_GATE from active what-ifs once all gates are reopened
      if (state.simulationFlags.gateClosures.length === 0) {
        state.simulationFlags.activeScenarioIds =
          state.simulationFlags.activeScenarioIds.filter(id => id !== 'CLOSE_GATE');
      }
      toastMessage = `Gate ${gateId} reopened.`;
      break;
    }

    case 'ADD_VESSELS': {
      const count = payload.count || 3;
      const newVessels = genVessels(count, 'APPROACHING');
      state.vessels = [...state.vessels, ...newVessels];
      state.simulationFlags.extraVessels += count;
      if (!state.simulationFlags.activeScenarioIds.includes('ADD_VESSELS')) {
        state.simulationFlags.activeScenarioIds = [...state.simulationFlags.activeScenarioIds, 'ADD_VESSELS'];
      }
      toastMessage = `Added ${count} approaching vessel(s).`;
      break;
    }

    case 'INCREASE_TRUCKS': {
      const delta = payload.delta || 50;
      const rng = seedrandom(String((state.scenarioSeed || 1) + state.trucks.length + action));
      const newTrucks = Array.from({ length: delta }, (_, i) =>
        genTruck({ simTime: state.simTime, stateEnteredSimMins: state.simTime - Math.floor(rng() * 20) + i * 0.01 })
      );
      state.trucks = [...state.trucks, ...newTrucks];
      state.simulationFlags.truckSurge += delta;
      if (!state.simulationFlags.activeScenarioIds.includes('INCREASE_TRUCKS')) {
        state.simulationFlags.activeScenarioIds = [...state.simulationFlags.activeScenarioIds, 'INCREASE_TRUCKS'];
      }
      toastMessage = `+${delta} trucks injected (seeded).`;
      break;
    }

    case 'BUNCH_SHIPS': {
      const count = payload.count || 5;
      const newVessels = genVessels(count, 'ANCHORED');
      const now = Date.now();
      const bunchedVessels = newVessels.map((v, i) => ({
        ...v,
        eta: new Date(now + i * 20 * 60 * 1000).toISOString(),
        waitHours: 2 + i,
      }));
      state.vessels = [...state.vessels, ...bunchedVessels];
      state.simulationFlags.bunchingActive = true;
      state.kpis = { ...state.kpis, preBerthingDetention: 5.2 };
      if (!state.simulationFlags.activeScenarioIds.includes('BUNCH_SHIPS')) {
        state.simulationFlags.activeScenarioIds = [...state.simulationFlags.activeScenarioIds, 'BUNCH_SHIPS'];
      }
      toastMessage = 'Ship bunching at anchorage.';
      break;
    }

    case 'APPLY_SCENARIO': {
      const scenarioId = payload.scenarioId;
      if (!scenarioId || !SCENARIO_DEFINITIONS[scenarioId]) {
        toastMessage = 'Unknown scenario.';
        break;
      }
      if (!state.simulationFlags.activeScenarioIds.includes(scenarioId)) {
        state.simulationFlags.activeScenarioIds = [...state.simulationFlags.activeScenarioIds, scenarioId];
      }
      if (scenarioId === 'heavy_rain') {
        state.simulationFlags.weather = 'heavy_rain';
      }
      if (scenarioId === 'yard_near_saturation') {
        const pct = SCENARIO_DEFINITIONS.yard_near_saturation.parameterOverrides.yardInitialOccupancyPct || 92;
        state.yard = {
          ...state.yard,
          currentTEU: clampYardTeu(state.yard, Math.floor((state.yard.capacityTEU * pct) / 100)),
        };
        state.yard = syncYardFactor(state.yard);
      }
      if (scenarioId === 'crane_breakdown') {
        const target = payload.vesselId
          ? state.vessels.find(v => v.id === payload.vesselId)
          : state.vessels.find(v => v.lifecycleState === 'LOADING');
        if (target) {
          state.simulationFlags.craneBreakdownVesselId = target.id;
          state.vessels = state.vessels.map(v =>
            v.id === target.id ? { ...v, assignedCranes: 1 } : v
          );
        }
      }
      toastMessage = `Scenario: ${SCENARIO_DEFINITIONS[scenarioId].title}`;
      break;
    }

    case 'CLEAR_SCENARIOS': {
      state.simulationFlags.activeScenarioIds = [];
      state.simulationFlags.weather = 'clear';
      state.simulationFlags.craneBreakdownVesselId = null;
      state.vessels = state.vessels.map(v => ({ ...v, assignedCranes: 3 }));
      toastMessage = 'Scenarios cleared — restored baseline multipliers.';
      break;
    }

    case 'RESET_SIMULATION': {
      globalSimTime = 0;
      state = createInitialState();
      return { updatedState: state, triggeredAlerts: [], toastMessage: 'Simulation reset.' };
    }

    default:
      break;
  }

  const scenarioMerge = mergeScenarioParameterOverrides(state.simulationFlags.activeScenarioIds);
  const occPct = (state.yard.currentTEU / state.yard.capacityTEU) * 100;
  const timing = getCurrentTimingProfile({
    weather: state.simulationFlags.weather,
    incidentType: 'none',
    yardOccupancyPct: occPct,
    scenarioOverrides: Object.keys(scenarioMerge).length ? scenarioMerge : undefined,
  });
  state.lastTimingProfile = timing;
  state.kpis = calculateKPIs(state.vessels, state.gates, state.trucks, state.simulationFlags, state.yard, timing);
  const triggeredAlerts = checkAllAlerts(state);
  const existingIds = new Set(state.alerts.map(a => a.id));
  for (const alert of triggeredAlerts) {
    if (!existingIds.has(alert.id)) {
      state.alerts.unshift(alert);
    }
  }
  state.alerts = state.alerts.slice(0, 50);
  state.lastUpdated = Date.now();

  return { updatedState: state, triggeredAlerts, toastMessage: toastMessage || undefined };
}

export function dismissAlert(alertId) {
  if (!state) return;
  state.alerts = state.alerts.map(a =>
    a.id === alertId ? { ...a, dismissed: true } : a
  );
}

/**
 * Soft-sync simulation vessels from an external snapshot (VTMS/AIS) without
 * overriding scenario controls. Only position/state/eta/berth are aligned.
 * @param {Array<{ id?: string, name?: string, position?: { lat: number, lng: number }, lifecycleState?: string, eta?: string, berthNumber?: string|null, confidence?: number, source?: string }>} externalVessels
 * @param {{ sourceLabel?: string, minConfidence?: number }} [opts]
 */
export function softSyncSimulationVessels(externalVessels = [], opts = {}) {
  if (!state || !Array.isArray(externalVessels) || externalVessels.length === 0) return;
  const sourceLabel = opts.sourceLabel || 'EXTERNAL';
  const minConfidence = typeof opts.minConfidence === 'number' ? opts.minConfidence : 0.55;
  const simTime = state.simTime || globalSimTime;
  const byId = new Map();
  const byName = new Map();
  for (const v of externalVessels) {
    if (!v) continue;
    const confidence = typeof v.confidence === 'number' ? v.confidence : 0.7;
    if (confidence < minConfidence) continue;
    if (v.id) byId.set(String(v.id).toLowerCase(), v);
    if (v.name) byName.set(String(v.name).trim().toLowerCase(), v);
  }
  if (byId.size === 0 && byName.size === 0) return;

  /** @type {import('./simulationTypes').SimEvent[]} */
  const events = [];
  let nextSeq = state.eventIdSeq;
  let changed = 0;

  state.vessels = state.vessels.map(v => {
    const match = byId.get(String(v.id).toLowerCase()) || byName.get(String(v.name).trim().toLowerCase());
    if (!match) return v;

    const nextLifecycle = match.lifecycleState || v.lifecycleState;
    const nextPosition = match.position || v.position;
    const nextEta = match.eta || v.eta;
    const nextBerth = match.berthNumber ?? v.berthNumber;
    const hasLifecycleChange = nextLifecycle !== v.lifecycleState;
    const hasPosChange =
      Math.abs((nextPosition?.lat ?? v.position.lat) - v.position.lat) > 0.00005 ||
      Math.abs((nextPosition?.lng ?? v.position.lng) - v.position.lng) > 0.00005;
    const hasEtaChange = !!nextEta && nextEta !== v.eta;
    const hasBerthChange = nextBerth !== v.berthNumber;
    if (!hasLifecycleChange && !hasPosChange && !hasEtaChange && !hasBerthChange) {
      return v;
    }

    changed += 1;
    events.push({
      id: `evt-${nextSeq++}`,
      timestamp: Date.now(),
      simTime,
      entityType: 'vessel',
      entityId: v.id,
      fromState: v.lifecycleState,
      toState: nextLifecycle,
      reason: `${sourceLabel} soft sync`,
      metadata: {
        source: match.source || sourceLabel,
        confidence: typeof match.confidence === 'number' ? match.confidence : 0.7,
        eta: nextEta,
        berthNumber: nextBerth,
      },
    });

    return {
      ...v,
      position: nextPosition,
      lifecycleState: nextLifecycle,
      eta: nextEta,
      berthNumber: nextBerth,
      stateEnteredAt: hasLifecycleChange ? Date.now() : v.stateEnteredAt,
      ticksInState: hasLifecycleChange ? 0 : v.ticksInState,
    };
  });

  if (changed > 0) {
    state.eventIdSeq = nextSeq;
    state.eventLog = [...(state.eventLog || []), ...events].slice(-500);
    state.lastUpdated = Date.now();
  }
}

// ── Initial state -----------------------------------------------------------

function buildSimulationFlags() {
  return {
    gateClosures: [],
    extraVessels: 0,
    truckSurge: 0,
    bunchingActive: false,
    weather: 'clear',
    craneBreakdownVesselId: null,
    activeScenarioIds: [],
  };
}

function createInitialState() {
  const vessels = generateInitialVessels(80);
  const gates = generateInitialGates();
  const trucks = generateInitialTrucks(48);

  const yard = createInitialYardFromConfig(Port_PORT_CONFIG);
  const flags = buildSimulationFlags();

  const occPct = (yard.currentTEU / yard.capacityTEU) * 100;
  const scenarioMerge = mergeScenarioParameterOverrides(flags.activeScenarioIds);
  const baselineProfile = getCurrentTimingProfile({
    weather: flags.weather,
    incidentType: 'none',
    yardOccupancyPct: occPct,
    scenarioOverrides: Object.keys(scenarioMerge).length ? scenarioMerge : undefined,
  });

  const timedGates = gates.map(g => ({
    ...g,
    avgProcessingTimeMins: parseFloat(
      (baselineProfile.gateProcess + baselineProfile.customsCheck).toFixed(1)
    ),
  }));

  const kpis = calculateKPIs(vessels, timedGates, trucks, flags, yard, baselineProfile);
  const alerts = checkAllAlerts({ vessels, gates: timedGates, trucks, kpis, alerts: [], yard });

  return {
    vessels,
    gates: timedGates,
    trucks,
    kpis,
    alerts,
    yard: syncYardFactor(yard),
    eventLog: [],
    simulationFlags: flags,
    scenarioSeed: 42,
    simTime: globalSimTime,
    lastUpdated: Date.now(),
    eventIdSeq: 1,
    lastTimingProfile: baselineProfile,
    // ── Supply-chain aggregates (Phase 4) ──────────────────────────────────
    berthLines: createInitialBerthLines(Port_PORT_CONFIG),
    railRakes: createInitialRailRakes(Port_PORT_CONFIG, globalSimTime),
    cargoAggregates: createInitialCargoAggregates(),
    containers: [],
    derivedMetrics: null,
  };
}


// ── Tick engine -------------------------------------------------------------

function startTickEngine() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    if (!state) return;
    tickSimulation();
  }, TICK_INTERVAL_MS);
}

/**
 * @param {import('./simulationTypes').SimulationFlags} flags
 * @param {import('./simulationTypes').SimYard} yard
 */
function buildTimingContext(flags, yard) {
  const occPct = (yard.currentTEU / yard.capacityTEU) * 100;
  const scenarioMerge = mergeScenarioParameterOverrides(flags.activeScenarioIds);
  return {
    weather: flags.weather,
    incidentType: flags.gateClosures.length > 0 ? 'gate_closure' : 'none',
    yardOccupancyPct: occPct,
    scenarioOverrides: Object.keys(scenarioMerge).length ? scenarioMerge : undefined,
  };
}

/**
 * @param {SimVessel} vessel
 * @param {import('./simulationTypes').TimingProfile} profile
 * @param {number} tickMins
 * @param {number} simTimeMins
 * @param {import('./simulationTypes').SimulationFlags} flags
 * @returns {{ vessel: SimVessel, events: SimEvent[], yardTeuDelta: number }}
 */
function advanceVesselState(vessel, profile, tickMins, simTimeMins, flags) {
  const teu = getVesselTeuForOps(vessel);
  const cranes = Math.max(1, vessel.assignedCranes || 3);
  const breakdownId = flags.craneBreakdownVesselId;
  const effectiveCranes = breakdownId && vessel.id === breakdownId ? Math.min(cranes, 1) : cranes;

  const dwellThresholds = {
    APPROACHING: profile.berthTurnaround * 0.08,
    ANCHORED: profile.berthTurnaround * 0.12,
    BERTHING: profile.berthTurnaround * 0.05,
    LOADING: (profile.craneUnloadPerTEU * teu) / effectiveCranes,
    DEPARTING: profile.berthTurnaround * 0.04,
  };

  const transitions = {
    APPROACHING: 'ANCHORED',
    ANCHORED: 'BERTHING',
    BERTHING: 'LOADING',
    LOADING: 'DEPARTING',
    DEPARTING: 'REMOVED',
  };

  const nextState = transitions[vessel.lifecycleState];
  if (!nextState) return { vessel, events: [], yardTeuDelta: 0 };

  const threshold = dwellThresholds[vessel.lifecycleState] ?? 60;
  const dwellMinutes = ((vessel.ticksInState || 0) + 1) * tickMins;

  /** @type {import('./simulationTypes').SimEvent[]} */
  const events = [];
  let yardTeuDelta = 0;
  const updatedVessel = { ...vessel, ticksInState: (vessel.ticksInState || 0) + 1 };

  if (dwellMinutes >= threshold) {
    const from = vessel.lifecycleState;
    updatedVessel.lifecycleState = nextState;
    updatedVessel.ticksInState = 0;
    updatedVessel.stateEnteredAt = Date.now();
    if (nextState === 'ANCHORED') {
      updatedVessel.waitHours = (vessel.waitHours || 0) + parseFloat((dwellMinutes / 60).toFixed(2));
    }
    if (from === 'LOADING' && nextState === 'DEPARTING') {
      yardTeuDelta = Math.min(2_000, Math.floor(teu * 0.22));
    }
    events.push({
      id: `evt-v-${state.eventIdSeq + events.length}`,
      timestamp: Date.now(),
      simTime: simTimeMins,
      entityType: 'vessel',
      entityId: vessel.id,
      fromState: from,
      toState: nextState,
      reason: 'Vessel lifecycle',
      metadata: { name: vessel.name, yardTeuDelta },
    });
  }

  updatedVessel.position = {
    lat: vessel.position.lat + (Math.random() - 0.5) * 0.001,
    lng: vessel.position.lng + (Math.random() - 0.5) * 0.001,
  };

  return { vessel: updatedVessel, events, yardTeuDelta };
}

function advanceGateQueues(gates, profile, tickMins) {
  const drainPerGate = Math.max(0.2, tickMins / profile.gateProcess);
  return gates.map(gate => {
    if (gate.status === 'CLOSED') return gate;
    const inflow = Math.max(0, Math.floor(drainPerGate * 0.7 + Math.random() * 2));
    const drain = Math.floor(drainPerGate + Math.random() * 1);
    const newQueue = Math.max(0, gate.queueLength - drain + inflow);
    const congestion = newQueue >= 50 ? 'HIGH' : newQueue >= 25 ? 'MEDIUM' : 'LOW';
    return {
      ...gate,
      queueLength: newQueue,
      congestionLevel: congestion,
      trucksTodayProcessed: gate.trucksTodayProcessed + drain,
      avgProcessingTimeMins: parseFloat(
        (profile.gateProcess + profile.customsCheck).toFixed(1)
      ),
      lastUpdated: new Date().toISOString(),
    };
  });
}

function tickSimulation() {
  if (!state) return;
  globalSimTime += SIM_TICK_MINUTES;
  state.simTime = globalSimTime;

  const flags = state.simulationFlags;
  const ctx = buildTimingContext(flags, state.yard);
  const timingProfile = getCurrentTimingProfile(ctx);
  state.lastTimingProfile = timingProfile;

  const boost =
    (mergeScenarioParameterOverrides(flags.activeScenarioIds).truckArrivalRateMultiplier || 1) *
    (1 + (flags.truckSurge > 0 ? 0.25 : 0));

  /** @type {import('./simulationTypes').SimEvent[]} */
  let allEvents = [];
  let nextSeq = state.eventIdSeq;

  const TARGET_VESSEL_COUNT = 80;
  let vesselYardDelta = 0;

  state.vessels = state.vessels
    .map(v => {
      const r = advanceVesselState(v, timingProfile, SIM_TICK_MINUTES, globalSimTime, flags);
      for (const ev of r.events) {
        ev.id = `evt-${nextSeq++}`;
      }
      allEvents = allEvents.concat(r.events);
      vesselYardDelta += r.yardTeuDelta;
      return r.vessel;
    })
    .filter(v => v.lifecycleState !== 'REMOVED');

  if (state.vessels.length < TARGET_VESSEL_COUNT) {
    const { generateInitialVessels: genVessels } = require('./vesselEngine.js');
    state.vessels.push(...genVessels(TARGET_VESSEL_COUNT - state.vessels.length));
  }

  const truckRes = tickTrucks(state.trucks, timingProfile, globalSimTime, nextSeq);
  allEvents = allEvents.concat(truckRes.events);
  nextSeq = truckRes.nextEventSeq;
  state.trucks = truckRes.trucks;

  // ── Phase 5: supply-chain engine step (feature-flagged) ──────────────────
  if (USE_AGGREGATE_SUPPLY_CHAIN) {
    const effectivePortConfig = getEffectivePortConfig(
      Port_PORT_CONFIG,
      state.simulationFlags,
      state.simulationFlags.activeScenarioIds,
    );
    const scState = {
      vessels: state.vessels,
      gates: state.gates,
      trucks: state.trucks,
      yard: state.yard,
      berthLines: state.berthLines ?? createInitialBerthLines(Port_PORT_CONFIG),
      railRakes: state.railRakes ?? createInitialRailRakes(Port_PORT_CONFIG, globalSimTime),
      cargoAggregates: state.cargoAggregates ?? [],
      containers: state.containers ?? [],
      simTime: globalSimTime,
    };
    const { nextState: sc, derivedMetrics } = stepSupplyChain(scState, effectivePortConfig, SIM_TICK_MINUTES);
    state.gates = sc.gates;
    state.yard = sc.yard;
    state.berthLines = sc.berthLines;
    state.railRakes = sc.railRakes;
    state.cargoAggregates = sc.cargoAggregates;
    state.derivedMetrics = derivedMetrics;
  } else {
    state.yard = syncYardFactor({
      ...state.yard,
      currentTEU: clampYardTeu(
        state.yard,
        state.yard.currentTEU + vesselYardDelta + truckRes.yardTeuDelta,
      ),
    });
    state.gates = advanceGateQueues(state.gates, timingProfile, SIM_TICK_MINUTES);
  }

  const { generateTruck: genT } = require('./mockDataGen.js');
  const rng = seedrandom(String(state.scenarioSeed + globalSimTime));
  const spawnCount = Math.min(3, Math.floor((boost - 1) * 2 + rng() * 2.5));
  for (let i = 0; i < spawnCount; i++) {
    if (state.trucks.length < 100) {
      state.trucks.push(genT({ simTime: globalSimTime, stateEnteredSimMins: globalSimTime - Math.floor(rng() * 15) }));
    }
  }

  state.eventIdSeq = nextSeq;
  state.eventLog = [...(state.eventLog || []), ...allEvents].slice(-500);

  state.kpis = calculateKPIs(
    state.vessels,
    state.gates,
    state.trucks,
    state.simulationFlags,
    state.yard,
    timingProfile,
  );

  const newAlerts = checkAllAlerts(state);
  const existingIds = new Set(state.alerts.map(a => a.id));
  for (const alert of newAlerts) {
    if (!existingIds.has(alert.id)) {
      state.alerts.unshift(alert);
    }
  }
  state.alerts = state.alerts.slice(0, 50);
  state.lastUpdated = Date.now();
}