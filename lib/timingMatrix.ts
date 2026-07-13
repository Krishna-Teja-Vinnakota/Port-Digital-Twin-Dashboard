/**
 * timingMatrix.ts
 * Port Digital Twin — Centralized Timing Matrix
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * GUIDING PRINCIPLE: Single source of truth for ALL operational delay logic.
 * No engine file should contain hardcoded timing values. Import and call
 * getEffectiveTime() or getCurrentTimingProfile() instead.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Unit convention: ALL base timing values are in MINUTES.
 * Modifiers are dimensionless multipliers (1.0 = no change).
 */

import type {
  TimingModifier,
  TimingProfile,
  TimingContext,
  VesselType,
  ScenarioParameterOverrides,
} from './simulationTypes';

// ─────────────────────────────────────────────────────────────────────────────
// BASE TIMING CONSTANTS  (minutes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Time to fully process one truck at gate (documentation check, RFID, log).
 * Port target: ≤5 min per RFP gate throughput requirement.
 */
export const BASE_GATE_PROCESS = 4.5; // minutes

/**
 * Time for customs inspection per truck at the gate.
 * Includes EDI verification + physical check sampling.
 */
export const BASE_CUSTOMS_CHECK = 8.0; // minutes

/**
 * Time for a truck to transit from gate to assigned yard block.
 * Based on internal road network speed (~15 km/h average).
 */
export const BASE_YARD_TRANSIT = 6.0; // minutes

/**
 * Time per TEU for crane unload/load operation.
 * Port container terminals: ~25–30 moves/crane/hour ≈ 2–2.4 min/TEU.
 */
export const BASE_CRANE_UNLOAD_PER_TEU = 2.2; // minutes per TEU

/**
 * Full berth turnaround time baseline — berth assignment to vessel departure.
 * Includes mooring, pilot operations, all cargo ops, unmooring.
 * Port RFP target: ≤18 hours for standard container vessel.
 */
export const BASE_BERTH_TURNAROUND = 18 * 60; // 1080 minutes (18 hours)

/**
 * Baseline pre-berthing wait at anchorage.
 * Includes VTMS clearance, pilot boarding, berth availability.
 */
export const BASE_PREBERTHING_WAIT = 90; // minutes

/**
 * Baseline truck loading/unloading time at terminal yard.
 * Container: one 20ft or 40ft unit — crane + chassis positioning.
 */
export const BASE_LOADING_UNLOADING = 35; // minutes

/**
 * Truck approaching the port — transit from highway to gate.
 * Models external road network and geofence perimeter entry.
 */
export const BASE_APPROACHING_PORT = 20; // minutes

// ─────────────────────────────────────────────────────────────────────────────
// WEATHER MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multiplicative delay factors for each weather condition.
 * Applied to gate, customs, yard, and crane operations.
 * Vessel approach delay modeled separately via base wait multiplier.
 */
export const WEATHER_FACTORS: Record<string, TimingModifier[]> = {
  clear: [
    { factor: 1.0, label: 'Clear weather' },
  ],
  rain: [
    { factor: 1.15, label: 'Rain — reduced visibility & road traction' },
  ],
  heavy_rain: [
    { factor: 1.40, label: 'Heavy rain — gate slowdown + crane ops restricted' },
  ],
  storm: [
    { factor: 1.75, label: 'Storm — partial gate closure + crane suspension' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// INCIDENT MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delay factors for operational incidents.
 * Crane breakdown affects crane ops; gate closure redistributes queue.
 */
export const INCIDENT_FACTORS: Record<string, TimingModifier[]> = {
  none: [
    { factor: 1.0, label: 'No active incident' },
  ],
  crane_breakdown: [
    { factor: 1.0,  label: 'Crane breakdown — gate ops unaffected' }, // gate
    { factor: 1.0,  label: 'Crane breakdown — customs unaffected' },  // customs
    { factor: 1.0,  label: 'Crane breakdown — yard transit unaffected' }, // yard
    { factor: 2.20, label: 'Crane breakdown — unload time doubled+' }, // crane ops
    { factor: 1.35, label: 'Crane breakdown — berth turnaround up ×1.35' }, // berth
  ],
  gate_closure: [
    { factor: 1.60, label: 'Gate closure — queue redistribution surge' },
  ],
  custom_delay: [
    { factor: 1.30, label: 'Customs delay — additional document checks' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// YARD OCCUPANCY MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Threshold-band multipliers for yard congestion feedback.
 * Each band returns an array of modifiers for attribution clarity.
 *
 * Applied to: yard transit, loading/unloading, and gate inflow throttling.
 */
/**
 * Yard occupancy band definitions.
 * Each entry: lowerBoundPct (inclusive) → factor.
 * Bands are checked highest-first in getYardFactor().
 */
export const YARD_FACTORS = {
  /** occupancy < 70 % — free flow */
  low:      { lowerBound: 0,  upperBound: 70, factor: 1.0,  label: 'Yard <70% — free flow' },
  /** 70 % ≤ occupancy < 85 % — moderate congestion */
  moderate: { lowerBound: 70, upperBound: 85, factor: 1.15, label: 'Yard 70–85% — moderate congestion' },
  /** 85 % ≤ occupancy < 95 % — heavy congestion */
  heavy:    { lowerBound: 85, upperBound: 95, factor: 1.35, label: 'Yard 85–95% — heavy congestion' },
  /** occupancy ≥ 95 % — near saturation, queue penalties applied */
  critical: { lowerBound: 95, upperBound: 100, factor: 1.70, label: 'Yard >95% — near saturation + queue penalty' },
} as const;

/** Convenience threshold aliases used for integrity checks in tests. */
export const YARD_THRESHOLDS = {
  low:      YARD_FACTORS.low.lowerBound,
  moderate: YARD_FACTORS.moderate.lowerBound,
  heavy:    YARD_FACTORS.heavy.lowerBound,
  critical: YARD_FACTORS.critical.lowerBound,
} as const;

/**
 * Resolve yard factor modifier from an occupancy percentage (0–100).
 * Bands checked from highest to lowest — first match wins.
 * @param occupancyPct - current TEU occupancy percentage
 * @returns TimingModifier for attribution + factor lookup
 */
export function getYardFactor(occupancyPct: number): TimingModifier {
  const pct = Math.max(0, Math.min(100, occupancyPct));
  if (pct >= YARD_FACTORS.critical.lowerBound) {
    return { factor: YARD_FACTORS.critical.factor, label: YARD_FACTORS.critical.label };
  }
  if (pct >= YARD_FACTORS.heavy.lowerBound) {
    return { factor: YARD_FACTORS.heavy.factor, label: YARD_FACTORS.heavy.label };
  }
  if (pct >= YARD_FACTORS.moderate.lowerBound) {
    return { factor: YARD_FACTORS.moderate.factor, label: YARD_FACTORS.moderate.label };
  }
  return { factor: YARD_FACTORS.low.factor, label: YARD_FACTORS.low.label };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY-SPECIFIC MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-vessel-type crane unload speed adjustment.
 * Containers have best crane efficiency; RO_RO uses ramps (different ops).
 */
export const VESSEL_TYPE_CRANE_FACTORS: Record<VesselType, TimingModifier> = {
  CONTAINER:    { factor: 1.00, label: 'Container — standard crane ops' },
  BULK_CARRIER: { factor: 0.85, label: 'Bulk carrier — grab unload faster per TEU-eq' },
  TANKER:       { factor: 0.70, label: 'Tanker — pipeline discharge, minimal crane use' },
  RO_RO:        { factor: 0.90, label: 'RO-RO — ramp ops, crane partially idle' },
  GENERAL:      { factor: 1.10, label: 'General cargo — mixed handling, slower cycle' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE UTILITY: getEffectiveTime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute effective operation time by applying all modifiers to a base value.
 *
 * @param baseMins - base duration in minutes (from BASE_* constants above)
 * @param modifiers - ordered list of multiplicative modifiers to apply
 * @returns effective duration in minutes (rounded to 2 decimal places)
 *
 * @example
 * const effectiveGateTime = getEffectiveTime(BASE_GATE_PROCESS, [
 *   ...WEATHER_FACTORS.heavy_rain,
 *   getYardFactor(88),
 * ]);
 * // Returns 4.5 × 1.40 × 1.35 = 8.505 → 8.51 mins
 */
export function getEffectiveTime(
  baseMins: number,
  modifiers: TimingModifier[],
): number {
  if (!modifiers || modifiers.length === 0) return baseMins;
  const combined = modifiers.reduce((acc, m) => acc * m.factor, 1.0);
  return parseFloat((baseMins * combined).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE UTILITY: getCurrentTimingProfile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a complete timing profile for the current simulation context.
 * This is the primary call site for any engine that needs operational delays.
 *
 * All five base timings are resolved through applicable modifier chains.
 * The returned `appliedModifiers` array feeds the UI delay-attribution strings.
 *
 * @param context - current simulation environment snapshot
 * @returns TimingProfile with effective minutes per operation + attribution list
 *
 * @example
 * const profile = getCurrentTimingProfile({
 *   weather: 'heavy_rain',
 *   incidentType: 'none',
 *   yardOccupancyPct: 88,
 *   vesselType: 'CONTAINER',
 * });
 * // profile.gateProcess   → 4.5 × 1.40 × 1.15 = 7.25 mins (yard at 88%)
 * // profile.craneUnloadPerTEU → 2.2 × 1.40 × 1.00 = 3.08 mins
 */
export function getCurrentTimingProfile(context: TimingContext = {}): TimingProfile {
  const {
    weather = 'clear',
    incidentType = 'none',
    yardOccupancyPct = 0,
    vesselType = 'CONTAINER',
    scenarioOverrides,
  } = context;

  // Resolve modifier sets
  const weatherMods = WEATHER_FACTORS[weather] ?? WEATHER_FACTORS.clear;
  const yardMod = getYardFactor(yardOccupancyPct);
  const vesselCraneMod = VESSEL_TYPE_CRANE_FACTORS[vesselType] ?? VESSEL_TYPE_CRANE_FACTORS.CONTAINER;

  // Incident modifiers are indexed by operation if crane_breakdown
  const incidentMods = INCIDENT_FACTORS[incidentType] ?? INCIDENT_FACTORS.none;
  const incidentGateMod: TimingModifier = incidentType === 'gate_closure'
    ? (INCIDENT_FACTORS.gate_closure[0])
    : { factor: 1.0, label: 'No incident' };
  const incidentCustomsMod: TimingModifier = incidentType === 'custom_delay'
    ? (INCIDENT_FACTORS.custom_delay[0])
    : { factor: 1.0, label: 'No incident' };
  const incidentCraneMod: TimingModifier = incidentType === 'crane_breakdown'
    ? (incidentMods[3] ?? { factor: 1.0, label: 'No incident' })
    : { factor: 1.0, label: 'No incident' };
  const incidentBerthMod: TimingModifier = incidentType === 'crane_breakdown'
    ? (incidentMods[4] ?? { factor: 1.0, label: 'No incident' })
    : { factor: 1.0, label: 'No incident' };

  // Scenario overrides (Phase 5) expressed as additional multiplier modifiers
  const scenarioGateMod: TimingModifier = scenarioOverrides?.gateProcessMultiplier
    ? { factor: scenarioOverrides.gateProcessMultiplier, label: 'Scenario override — gate' }
    : { factor: 1.0, label: 'No scenario' };
  const scenarioCustomsMod: TimingModifier = scenarioOverrides?.customsCheckMultiplier
    ? { factor: scenarioOverrides.customsCheckMultiplier, label: 'Scenario override — customs' }
    : { factor: 1.0, label: 'No scenario' };
  const scenarioYardMod: TimingModifier = scenarioOverrides?.yardTransitMultiplier
    ? { factor: scenarioOverrides.yardTransitMultiplier, label: 'Scenario override — yard transit' }
    : { factor: 1.0, label: 'No scenario' };
  const scenarioCraneMod: TimingModifier = scenarioOverrides?.craneUnloadMultiplier
    ? { factor: scenarioOverrides.craneUnloadMultiplier, label: 'Scenario override — crane' }
    : { factor: 1.0, label: 'No scenario' };
  const scenarioBerthMod: TimingModifier = scenarioOverrides?.berthTurnaroundMultiplier
    ? { factor: scenarioOverrides.berthTurnaroundMultiplier, label: 'Scenario override — berth TAT' }
    : { factor: 1.0, label: 'No scenario' };

  // Build per-operation modifier chains
  const gateMods    = [...weatherMods, incidentGateMod,    yardMod,  scenarioGateMod];
  const customsMods = [...weatherMods, incidentCustomsMod, yardMod,  scenarioCustomsMod];
  const yardMods    = [...weatherMods, yardMod,            scenarioYardMod];
  const craneMods   = [...weatherMods, incidentCraneMod,   vesselCraneMod, scenarioCraneMod];
  const berthMods   = [...weatherMods, incidentBerthMod,   scenarioBerthMod];

  // Collect all non-trivial modifiers for delay attribution
  const allApplied: TimingModifier[] = [
    ...weatherMods,
    yardMod,
    vesselCraneMod,
    incidentGateMod,
    incidentCustomsMod,
    incidentCraneMod,
    incidentBerthMod,
    scenarioGateMod,
    scenarioCustomsMod,
    scenarioYardMod,
    scenarioCraneMod,
    scenarioBerthMod,
  ].filter(m => m.factor !== 1.0);

  return {
    gateProcess:       getEffectiveTime(BASE_GATE_PROCESS,         gateMods),
    customsCheck:      getEffectiveTime(BASE_CUSTOMS_CHECK,        customsMods),
    yardTransit:       getEffectiveTime(BASE_YARD_TRANSIT,         yardMods),
    craneUnloadPerTEU: getEffectiveTime(BASE_CRANE_UNLOAD_PER_TEU, craneMods),
    berthTurnaround:   getEffectiveTime(BASE_BERTH_TURNAROUND,     berthMods),
    appliedModifiers:  allApplied,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: buildDelayAttributionString
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert applied modifiers into a human-readable delay explanation.
 * Used by EntityDeepDive panel (Phase 6) and event log metadata.
 *
 * @param baseMinutes - the unmodified baseline duration
 * @param effectiveMinutes - the actual computed duration
 * @param modifiers - the modifiers that were applied
 * @returns formatted string, e.g. "+12.5m due to Heavy rain; Yard 85–95%"
 *
 * @example
 * buildDelayAttributionString(4.5, 8.51, appliedModifiers)
 * // → "+4.01m due to Heavy rain; Yard 85–95% — heavy congestion"
 */
export function buildDelayAttributionString(
  baseMinutes: number,
  effectiveMinutes: number,
  modifiers: TimingModifier[],
): string {
  const delta = effectiveMinutes - baseMinutes;
  if (Math.abs(delta) < 0.05) return 'On baseline schedule';

  const sign = delta > 0 ? '+' : '';
  const causes = modifiers
    .filter(m => m.factor !== 1.0 && m.label)
    .map(m => m.label!)
    .join('; ');

  return `${sign}${delta.toFixed(1)}m${causes ? ` due to ${causes}` : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT: complete timing matrix snapshot for debugging / unit tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return a flat snapshot of all base constants for inspection or testing.
 */
export function getBaseTimingSnapshot() {
  return {
    BASE_GATE_PROCESS,
    BASE_CUSTOMS_CHECK,
    BASE_YARD_TRANSIT,
    BASE_CRANE_UNLOAD_PER_TEU,
    BASE_BERTH_TURNAROUND,
    BASE_PREBERTHING_WAIT,
    BASE_LOADING_UNLOADING,
    BASE_APPROACHING_PORT,
  } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK TOS PHYSICS — simplified constants for the client-side truck engine
// ─────────────────────────────────────────────────────────────────────────────

/** Flat timing constants used by the Mock TOS truck physics engine. */
export const BASE_TIMES = {
  APPROACH_TIME: 15, // minutes to reach port gate from highway
  GATE_PROCESS:   3, // minutes per truck at gate (doc check + RFID)
  YARD_TRANSIT:  12, // minutes to drive from gate to stack
  CRANE_UNLOAD:  1.5, // minutes per TEU per crane
} as const;

/** Weather and incident multipliers for the simplified physics formula. */
export const MULTIPLIERS = {
  WEATHER:  { CLEAR: 1.0, HEAVY_RAIN: 1.6, FOG: 2.0 },
  INCIDENT: { NORMAL: 1.0, ACCIDENT: 3.0 },
} as const;

/**
 * Core physics formula for the Mock TOS engine.
 *
 * Yard congestion above 80% scales exponentially:
 *   congestionFactor = 1 + (occupancy − 0.80) × 5
 *
 * @param baseTime            - base duration in minutes (from BASE_TIMES)
 * @param weatherFactor       - multiplier from MULTIPLIERS.WEATHER
 * @param yardOccupancyPercent - fractional occupancy 0.0–1.0 (e.g. 0.85)
 * @returns effective duration in minutes, ceiling-rounded
 */
export function calculateEffectiveTime(
  baseTime: number,
  weatherFactor: number,
  yardOccupancyPercent: number,
): number {
  const congestionFactor =
    yardOccupancyPercent > 0.80
      ? 1 + (yardOccupancyPercent - 0.80) * 5
      : 1.0;
  return Math.ceil(baseTime * weatherFactor * congestionFactor);
}
