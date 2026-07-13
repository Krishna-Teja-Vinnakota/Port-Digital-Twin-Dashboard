/**
 * lib/portConfigApply.ts
 *
 * Compute an effective PortConfig by overlaying SimulationFlags and active
 * scenarios onto the static base blueprint.
 *
 * ── Double-counting prevention ───────────────────────────────────────────────
 * Weather timing multipliers (gateProcessMultiplier, craneUnloadMultiplier …)
 * remain exclusively in lib/timingMatrix.ts / mergeScenarioParameterOverrides.
 * This module handles only STRUCTURAL changes:
 *   • Gate lane count  → 0 for closed gates (no service)
 *   • Berth status     → reserved for future maintenance-window overrides
 *
 * Rates such as movesPerCranePerHour are NOT adjusted here for weather; doing so
 * would double-count the multipliers already applied in the timing matrix path.
 *
 * ── Crane breakdown ──────────────────────────────────────────────────────────
 * The per-vessel `assignedCranes` field (set to 1 by applySimulationAction for
 * the crane_breakdown scenario) is the authoritative crane count for the affected
 * vessel. supplyChainEngine.ts uses `vessel.assignedCranes` directly and does NOT
 * rely on portConfig crane overrides. portConfigApply therefore leaves
 * `nominalStsCranes` unchanged, avoiding a second reduction path.
 *
 * ── Yard near-saturation ─────────────────────────────────────────────────────
 * The `yard_near_saturation` scenario changes runtime `yard.currentTEU` in
 * simulationStore.js (APPLY_SCENARIO handler). portConfig yardBlocks are
 * structural (static maxTeu, throughput rates) and are not modified here.
 *
 * NEVER mutate Port_PORT_CONFIG / PORT_CONFIG. Always return a new object.
 */

import type { PortConfig, StaticGateConfig } from './portConfig.types';
import type { SimulationFlags, ScenarioId } from './simulationTypes';

/**
 * Return an effective PortConfig for the current simulation context.
 *
 * @param base            - Immutable base config (Port_PORT_CONFIG)
 * @param simulationFlags - Current runtime flags (gateClosures, craneBreakdown …)
 * @param activeScenarioIds - Active what-if scenario ids
 */
export function getEffectivePortConfig(
  base: PortConfig,
  simulationFlags: SimulationFlags,
  activeScenarioIds: ScenarioId[],
): PortConfig {
  // activeScenarioIds reserved for future rate overrides (e.g. strike scenario
  // that reduces gate lanes port-wide). Currently scenarios change timing
  // multipliers only (handled in timingMatrix) or initial state (handled in store).
  void activeScenarioIds;

  // ── Gate closures: zero activeLanes for closed gates ────────────────────
  // Queue redistribution / accumulation is handled by the store and
  // supplyChainEngine; portConfig only signals "no service capacity here".
  const closedSet = new Set(simulationFlags.gateClosures);
  const effectiveGates: StaticGateConfig[] =
    closedSet.size === 0
      ? base.gates
      : base.gates.map((g) =>
          closedSet.has(g.id)
            ? { ...g, service: { ...g.service, activeLanes: 0, nominalTrucksPerHour: 0 } }
            : g,
        );

  return {
    ...base,
    gates: effectiveGates,
    // berths / yardBlocks / railSidings: structural — unchanged at runtime
  };
}
