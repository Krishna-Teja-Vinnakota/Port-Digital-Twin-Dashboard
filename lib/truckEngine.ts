/**
 * lib/truckEngine.ts
 * Truck lifecycle state machine — transitions driven by timing matrix dwell times.
 *
 * Exports two tick functions:
 *   tickTrucks       — server-side, full fidelity (used by simulationStore.js)
 *   tickTrucksSimple — client-side, Mock TOS physics (used by useSimulationStore)
 */

import type { SimTruck, SimEvent, TruckLifecycleState, TimingProfile } from './simulationTypes';
import {
  BASE_APPROACHING_PORT,
  BASE_LOADING_UNLOADING,
  BASE_YARD_TRANSIT,
  BASE_TIMES,
  MULTIPLIERS,
  calculateEffectiveTime,
} from './timingMatrix';
import { snapToTruckLand } from './geoBounds.js';

// ─── Mock TOS snap coordinates ───────────────────────────────────────────────

/** Position trucks snap to when they transition to GATE_QUEUE. */
export const GATE_COORDS = { lat: 18.9480, lng: 72.9680 } as const;
/** Position trucks snap to when they transition to LOADING. */
export const YARD_COORDS = { lat: 18.9400, lng: 72.9500 } as const;

const EXITING_MINS = 10;

const NEXT: Record<TruckLifecycleState, TruckLifecycleState | 'DONE'> = {
  // Mock TOS aliases (simplified path — no CUSTOMS_CHECK)
  APPROACHING:      'GATE_QUEUE',
  LOADING:          'EXITING',
  // Full-fidelity server path
  APPROACHING_PORT: 'GATE_QUEUE',
  GATE_QUEUE:       'CUSTOMS_CHECK',
  CUSTOMS_CHECK:    'YARD_TRANSIT',
  YARD_TRANSIT:     'LOADING_UNLOADING',
  LOADING_UNLOADING:'EXITING',
  EXITING:          'DONE',
};

function dwellForState(state: TruckLifecycleState, profile: TimingProfile): number {
  const yardSlowdown = profile.yardTransit / BASE_YARD_TRANSIT;
  switch (state) {
    case 'APPROACHING':
    case 'APPROACHING_PORT':
      return BASE_APPROACHING_PORT;
    case 'GATE_QUEUE':
      return profile.gateProcess;
    case 'CUSTOMS_CHECK':
      return profile.customsCheck;
    case 'YARD_TRANSIT':
      return profile.yardTransit;
    case 'LOADING':
    case 'LOADING_UNLOADING':
      return BASE_LOADING_UNLOADING * yardSlowdown;
    case 'EXITING':
      return EXITING_MINS;
    default:
      return 15;
  }
}

function nudge(pos: { lat: number; lng: number }): { lat: number; lng: number } {
  const jittered = {
    lat: pos.lat + (Math.random() - 0.5) * 0.0004,
    lng: pos.lng + (Math.random() - 0.5) * 0.0004,
  };
  return snapToTruckLand(jittered) ?? pos;
}

function makeEvent(
  simTimeMins: number,
  truck: SimTruck,
  from: string,
  to: string,
  reason: string,
  id: string,
  meta: Record<string, unknown> = {},
): SimEvent {
  return {
    id,
    timestamp: Date.now(),
    simTime: simTimeMins,
    entityType: 'truck',
    entityId: truck.id,
    fromState: from,
    toState: to,
    reason,
    metadata: { plate: truck.plateNumber, ...meta },
  };
}

export interface TickTrucksResult {
  trucks: SimTruck[];
  events: SimEvent[];
  yardTeuDelta: number;
  nextEventSeq: number;
}

/**
 * Advance trucks by one tick. `simTimeMins` = simulation clock in minutes (end of tick).
 * Trucks in EXITING that complete dwell are removed; yard TEU is reduced on exit.
 */
export function tickTrucks(
  trucks: SimTruck[],
  profile: TimingProfile,
  simTimeMins: number,
  eventIdSeq: number,
): TickTrucksResult {
  const events: SimEvent[] = [];
  let yardTeuDelta = 0;
  let seq = eventIdSeq;
  const out: SimTruck[] = [];

  for (const truck of trucks) {
    const entered = truck.stateEnteredSimMins ?? 0;
    const elapsed = simTimeMins - entered;
    const state = truck.state;
    const threshold = dwellForState(state, profile);

    if (state === 'EXITING') {
      if (elapsed >= threshold) {
        yardTeuDelta -= 2;
        events.push(
          makeEvent(
            simTimeMins,
            truck,
            'EXITING',
            'REMOVED',
            'Exited port (container departs yard)',
            `evt-${seq++}`,
            { teuRemoved: 2 },
          ),
        );
        continue;
      }
      out.push({ ...truck, position: nudge(truck.position) });
      continue;
    }

    const next = NEXT[state];
    if (next === 'DONE') {
      out.push({ ...truck, position: nudge(truck.position) });
      continue;
    }

    if (elapsed >= threshold) {
      const to = next;
      events.push(
        makeEvent(simTimeMins, truck, state, to, 'Lifecycle transition', `evt-${seq++}`),
      );
      out.push({
        ...truck,
        state: to,
        stateEnteredSimMins: simTimeMins,
        stateEnteredAt: Date.now(),
        nextEligibleTransitionAt: Date.now() + dwellForState(to, profile) * 60_000,
        position: nudge(truck.position),
      });
    } else {
      out.push({ ...truck, position: nudge(truck.position) });
    }
  }

  return { trucks: out, events, yardTeuDelta, nextEventSeq: seq };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE MOCK TOS PHYSICS TICK
// ─────────────────────────────────────────────────────────────────────────────

type YardArg =
  | { capacityTEU: number; currentTEU: number }
  | { capacity: number; currentTEUs: number };

function resolveYardOcc(yard: YardArg): number {
  if ('capacityTEU' in yard) return yard.currentTEU / yard.capacityTEU;
  return yard.currentTEUs / yard.capacity;
}

function resolveWeatherFactor(weather: string): number {
  const w = weather.toUpperCase();
  if (w === 'HEAVY_RAIN') return MULTIPLIERS.WEATHER.HEAVY_RAIN;
  if (w === 'FOG')        return MULTIPLIERS.WEATHER.FOG;
  return MULTIPLIERS.WEATHER.CLEAR;
}

/**
 * Client-side Mock TOS physics tick.
 *
 * Call this once per second from the Zustand store `tickSimulation` action.
 * Each call increments `timeInCurrentState` by 1 and transitions trucks when
 * their dwell threshold (from `calculateEffectiveTime`) is reached.
 *
 * State chain:  APPROACHING → GATE_QUEUE → YARD_TRANSIT → LOADING → EXITING
 * (Also handles legacy server-state aliases APPROACHING_PORT / LOADING_UNLOADING.)
 *
 * @param trucks    - current truck array from the store
 * @param yardState - yard shape from either server or client store
 * @param weather   - current weather string ('CLEAR' | 'HEAVY_RAIN' | 'FOG')
 * @param eventLog  - mutable string array; transition messages are pushed here
 * @returns updated truck array (EXITING trucks that complete dwell are removed)
 */
export function tickTrucksSimple(
  trucks: SimTruck[],
  yardState: YardArg,
  weather: string,
  eventLog: string[],
): SimTruck[] {
  const yardOcc = resolveYardOcc(yardState);
  const weatherFactor = resolveWeatherFactor(weather);

  const updated: (SimTruck | null)[] = trucks.map((truck) => {
    const t: SimTruck = {
      ...truck,
      timeInCurrentState: (truck.timeInCurrentState ?? 0) + 1,
    };
    const label = t.truckId ?? t.id;
    const ticks = t.timeInCurrentState ?? 0;

    switch (t.state) {
      case 'APPROACHING':
      case 'APPROACHING_PORT': {
        const threshold = calculateEffectiveTime(BASE_TIMES.APPROACH_TIME, weatherFactor, 1.0);
        if (ticks >= threshold) {
          eventLog.push(
            `[${new Date().toLocaleTimeString()}] Truck ${label} arrived at Port Gate.`,
          );
          return { ...t, state: 'GATE_QUEUE', timeInCurrentState: 0, position: GATE_COORDS };
        }
        break;
      }
      case 'GATE_QUEUE': {
        const threshold = calculateEffectiveTime(BASE_TIMES.GATE_PROCESS, weatherFactor, 1.0);
        if (ticks >= threshold) {
          eventLog.push(
            `[${new Date().toLocaleTimeString()}] Truck ${label} cleared gate, heading to yard.`,
          );
          return { ...t, state: 'YARD_TRANSIT', timeInCurrentState: 0 };
        }
        break;
      }
      case 'YARD_TRANSIT': {
        const threshold = calculateEffectiveTime(BASE_TIMES.YARD_TRANSIT, weatherFactor, yardOcc);
        if (ticks >= threshold) {
          const block = t.targetBlock ?? 'YARD';
          eventLog.push(
            `[${new Date().toLocaleTimeString()}] Truck ${label} arrived at block ${block}.`,
          );
          return { ...t, state: 'LOADING', timeInCurrentState: 0, position: YARD_COORDS };
        }
        break;
      }
      case 'LOADING':
      case 'LOADING_UNLOADING': {
        // Use CRANE_UNLOAD × 20 TEU equivalent as a per-truck loading dwell
        const threshold = calculateEffectiveTime(BASE_TIMES.CRANE_UNLOAD * 20, weatherFactor, yardOcc);
        if (ticks >= threshold) {
          eventLog.push(
            `[${new Date().toLocaleTimeString()}] Truck ${label} loaded, exiting port.`,
          );
          return { ...t, state: 'EXITING', timeInCurrentState: 0 };
        }
        break;
      }
      case 'EXITING': {
        if (ticks >= 10) {
          eventLog.push(
            `[${new Date().toLocaleTimeString()}] Truck ${label} exited Port.`,
          );
          return null; // remove from fleet
        }
        break;
      }
      default:
        break;
    }

    return t;
  });

  return updated.filter((t): t is SimTruck => t !== null);
}
