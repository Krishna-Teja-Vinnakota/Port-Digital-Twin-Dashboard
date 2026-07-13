/**
 * lib/scenarios.ts
 * Named what-if scenarios: parameter overrides and metadata for demos.
 */

import type {
  ScenarioDefinition,
  ScenarioId,
  ScenarioParameterOverrides,
} from './simulationTypes';

export const SCENARIO_DEFINITIONS: Record<ScenarioId, ScenarioDefinition> = {
  heavy_rain: {
    id: 'heavy_rain',
    title: 'Heavy rain',
    description: 'Slower gate processing, customs checks, and yard operations.',
    parameterOverrides: {
      gateProcessMultiplier: 1.5,
      customsCheckMultiplier: 1.45,
      yardTransitMultiplier: 1.4,
    },
    expectedImpacts: {
      gateQueueDelta: '↑ gate queues',
      avgTruckTATDelta: '↑ truck turnaround',
    },
  },
  crane_breakdown: {
    id: 'crane_breakdown',
    title: 'Crane breakdown',
    description: 'One active vessel’s STS cranes drop from 3 to 1 (unloading time rises).',
    parameterOverrides: {
      craneUnloadMultiplier: 1.0, // per-vessel assignedCranes handles ops; keep matrix neutral
    },
    expectedImpacts: {
      throughputDelta: '↓ berth throughput for affected vessel',
    },
  },
  truck_inbound_surge: {
    id: 'truck_inbound_surge',
    title: 'Truck inbound surge',
    description: 'Extra gate arrivals per tick (NH-348 style congestion).',
    parameterOverrides: {
      truckArrivalRateMultiplier: 2.0,
    },
    expectedImpacts: {
      gateQueueDelta: '↑ gate queues',
    },
  },
  yard_near_saturation: {
    id: 'yard_near_saturation',
    title: 'Yard near saturation',
    description: 'Start yard at high occupancy — retrieval and yard transit slow via matrix.',
    parameterOverrides: {
      yardInitialOccupancyPct: 92,
    },
    expectedImpacts: {
      yardOccupancyDelta: 'yard ~90%+; knock-on to trucks',
    },
  },
};

/**
 * Merge active scenario parameter overrides. Multipliers combine by multiplication.
 */
export function mergeScenarioParameterOverrides(
  activeIds: ScenarioId[],
): ScenarioParameterOverrides {
  const out: ScenarioParameterOverrides = {};
  for (const id of activeIds) {
    const def = SCENARIO_DEFINITIONS[id];
    if (!def) continue;
    const o = def.parameterOverrides;
    if (o.gateProcessMultiplier != null) {
      out.gateProcessMultiplier = (out.gateProcessMultiplier ?? 1) * o.gateProcessMultiplier;
    }
    if (o.customsCheckMultiplier != null) {
      out.customsCheckMultiplier = (out.customsCheckMultiplier ?? 1) * o.customsCheckMultiplier;
    }
    if (o.yardTransitMultiplier != null) {
      out.yardTransitMultiplier = (out.yardTransitMultiplier ?? 1) * o.yardTransitMultiplier;
    }
    if (o.craneUnloadMultiplier != null) {
      out.craneUnloadMultiplier = (out.craneUnloadMultiplier ?? 1) * o.craneUnloadMultiplier;
    }
    if (o.berthTurnaroundMultiplier != null) {
      out.berthTurnaroundMultiplier = (out.berthTurnaroundMultiplier ?? 1) * o.berthTurnaroundMultiplier;
    }
    if (o.truckArrivalRateMultiplier != null) {
      out.truckArrivalRateMultiplier = (out.truckArrivalRateMultiplier ?? 1) * o.truckArrivalRateMultiplier;
    }
    if (o.yardInitialOccupancyPct != null) {
      out.yardInitialOccupancyPct = Math.max(
        out.yardInitialOccupancyPct ?? 0,
        o.yardInitialOccupancyPct,
      );
    }
  }
  return out;
}

export function getScenarioOrThrow(id: ScenarioId): ScenarioDefinition {
  const d = SCENARIO_DEFINITIONS[id];
  if (!d) throw new Error(`Unknown scenario: ${id}`);
  return d;
}
