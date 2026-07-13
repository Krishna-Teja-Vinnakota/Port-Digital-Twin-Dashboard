/**
 * simulationTypes.ts
 * Canonical type definitions for the Port Digital Twin simulation engine.
 *
 * Rule: every JS engine file references these types via JSDoc @typedef imports.
 * Do NOT duplicate type shapes across engine files.
 *
 * Unit conventions (explicitly noted per field):
 *   - Time deltas  → minutes (number)
 *   - Timestamps   → ISO-8601 string or Unix ms (number) — field-level comment clarifies
 *   - Distances    → km (unless stated)
 *   - TEU counts   → integer
 *   - Rates        → per-minute unless stated
 */

// ─────────────────────────────────────────────────────────────────────────────
// VESSEL TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type VesselLifecycleState =
  | 'APPROACHING'
  | 'ANCHORED'
  | 'BERTHING'
  | 'LOADING'
  | 'DEPARTING'
  | 'REMOVED';

export type VesselType = 'CONTAINER' | 'BULK_CARRIER' | 'TANKER' | 'RO_RO' | 'GENERAL';

export type VesselClass = 'FEEDER' | 'PANAMAX' | 'POST_PANAMAX' | 'ULCV';

export type DataSource = 'live_ais' | 'simulated_manifest' | 'estimated';

/** Provenance wrapper — every enriched field carries its data source. */
export interface Sourced<T> {
  value: T;
  source: DataSource;
}

export interface VesselPosition {
  lat: number; // decimal degrees
  lng: number; // decimal degrees
}

export interface SimVessel {
  id: string;
  name: string;
  type: VesselType;
  vesselClass?: VesselClass;
  dwt: number;                        // tons
  position: VesselPosition;
  lifecycleState: VesselLifecycleState;
  eta: string;                         // ISO-8601
  waitHours: number;                   // hours at anchorage
  emissionsRate: number;               // tons CO2 / hour
  pilotAssigned: boolean;
  berthNumber: string | null;
  flag: string;                        // 2-char ISO 3166-1 alpha-2
  ticksInState: number;
  stateEnteredAt?: number;             // Unix ms — when last state change occurred
  /** Gantry / STS cranes assigned (what-if: reduce to 1 for breakdown) */
  assignedCranes: number;
  // Enrichment (added by manifestEnricher in Phase 3)
  teuEstimate?: Sourced<number>;
  cargoType?: Sourced<string>;
  berthPriority?: Sourced<number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type GateStatus = 'OPEN' | 'CLOSED' | 'RESTRICTED';
export type CongestionLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SimGate {
  id: number;
  name: string;
  lat: number;
  lng: number;
  status: GateStatus;
  queueLength: number;                 // truck count in queue
  congestionLevel: CongestionLevel;
  trucksTodayProcessed: number;
  avgProcessingTimeMins: number;       // minutes — must match timing matrix unit
  lastUpdated: string;                 // ISO-8601
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUCK TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type TruckLifecycleState =
  // ── Mock TOS states (Phase 3 simplified engine) ────────────────────────────
  | 'APPROACHING'       // truck en-route to gate (mock TOS alias)
  | 'LOADING'           // container pickup/drop at yard block (mock TOS alias)
  // ── Full-fidelity server-side states ───────────────────────────────────────
  | 'APPROACHING_PORT'
  | 'GATE_QUEUE'
  | 'CUSTOMS_CHECK'
  | 'YARD_TRANSIT'
  | 'LOADING_UNLOADING'
  | 'EXITING';

export type CargoType = 'CONTAINER' | 'BULK' | 'LIQUID' | 'BREAK_BULK';

export interface SimTruck {
  id: string;
  plateNumber: string;
  position: VesselPosition;            // reusing lat/lng shape
  destination: string;
  entryTimestamp: string;              // ISO-8601 — when truck entered geofence
  cargoType: CargoType;
  // Lifecycle fields (Phase 2 — backfilled with defaults initially)
  state: TruckLifecycleState;
  stateEnteredAt: number;              // Unix ms
  nextEligibleTransitionAt: number;    // Unix ms — derived from timing matrix
  /** Deterministic sim clock (minutes) at which current state started */
  stateEnteredSimMins: number;
  assignedVesselId?: string;
  eta?: string;                        // ISO-8601 expected completion
  // ── Mock TOS fields (Phase 1/3) ─────────────────────────────────────────────
  /** Human-readable plate used as TOS truck identifier (e.g. "MH-04-AB-1234") */
  truckId?: string;
  /** MMSI or vessel ID this truck is collecting containers from */
  assignedVessel?: string;
  /** Yard destination block code (e.g. "IMPORT_BLOCK_A") */
  targetBlock?: string;
  /** Ticks elapsed in the current state — incremented by the client physics engine */
  timeInCurrentState?: number;
  /** Container ID currently paired with this truck (client physics / Mock TOS pairing) */
  assignedContainer?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// YARD TYPES (Phase 4 schema — declared now for forward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

export interface YardBlock {
  blockId: string;
  capacity: number;                    // TEU
  occupied: number;                    // TEU
  throughputFactor: number;            // 0.5–1.0 (1.0 = full speed)
}

export interface SimYard {
  capacityTEU: number;
  currentTEU: number;
  blocks: YardBlock[];
  occupancyFactor: number;             // computed: currentTEU / capacityTEU
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTAINER TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard cap on SimContainer rows in any store.
 * Aggregate TEU counts (VesselCargoAggregate, SimYard) are always preferred.
 */
export const MAX_CONTAINER_DETAIL = 500;

export type ContainerStatus = 'IN_YARD' | 'ON_TRUCK' | 'DELIVERED' | 'AWAITING_PICKUP';

/**
 * Lean container record for UI drill-down only.
 * Do not loop over these for physics — use VesselCargoAggregate instead.
 * @see MAX_CONTAINER_DETAIL
 */
export interface SimContainer {
  id: string;
  containerNumber?: string;  // e.g. MSCU1234567
  /** 1 = 20 ft (1 TEU), 2 = 40 ft (2 TEU) */
  teus: number;
  status: ContainerStatus;
  vesselId?: string;
  truckId?: string;
  rakeId?: string;
  yardBlockId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLY CHAIN AGGREGATE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Per-vessel TEU flow aggregate (preferred over per-container rows for physics). */
export interface VesselCargoAggregate {
  vesselId: string;
  teuToDischarge: number;   // from manifest
  teuToLoad: number;
  teuDischarged: number;    // running total this berth call
  teuLoaded: number;
}

/**
 * Live berth-line state — one record per StaticBerthConfig.id at all times.
 *
 * Berth assignment rule (documented here; enforced in supplyChainEngine.ts):
 *   FIRST-FIT BY ETA — assign the first OPERATIONAL berth whose vesselId is null,
 *   iterating berths in portConfig.berths order, tie-breaking by vessel ETA (ISO-8601
 *   lexicographic = chronological).
 */
export interface BerthLineState {
  berthId: string;                  // matches StaticBerthConfig.id
  vesselId: string | null;          // null = berth vacant
  /** Simulation clock (minutes) when ops started on this call. */
  opsStartSimMins: number;
  /** Projected simulation clock (minutes) when discharge+load will complete. */
  opsEndProjectedSimMins: number;
  /** Post-scenario effective STS crane count (may differ from vessel.assignedCranes). */
  assignedCranesEffective: number;
}

/** Live rail rake state — one record per rake currently active at the facility. */
export interface RailRakeState {
  rakeId: string;
  /** Matches StaticRailSidingConfig.id */
  sidingId: string;
  stage: 'ALLOCATED' | 'IN_TRANSIT' | 'PORT_ENTRY' | 'SIDING' | 'TERMINAL' | 'EXIT';
  /** Current TEU on this rake. */
  teuOnboard: number;
  /** Simulation clock (minutes) for next stage arrival. */
  etaSimMins: number;
  /** Yard block this rake will drain into or draw from. */
  yardHandoffBlockId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LOG TYPES (Phase 2 schema — declared now)
// ─────────────────────────────────────────────────────────────────────────────

export type EntityType = 'truck' | 'vessel' | 'gate' | 'yard' | 'scenario';

export interface SimEvent {
  id: string;
  timestamp: number;                   // Unix ms
  simTime: number;                     // simulation clock minutes since epoch
  entityType: EntityType;
  entityId: string;
  fromState: string;
  toState: string;
  reason: string;                      // human-readable cause
  metadata: Record<string, unknown>;   // context-specific payload
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CarbonIndex = 'LOW' | 'MODERATE' | 'HIGH';

export interface SimKPIs {
  avgVesselTAT: number;                // hours
  preBerthingDetention: number;        // hours
  berthOccupancy: number;              // percent 0–100
  avgImportDwellTime: number;          // hours
  avgExportDwellTime: number;          // hours
  dpdPercent: number;                  // percent
  dpePercent: number;                  // percent
  gateCongestionLevel: CongestionLevel;
  trucksInGeoFence: number;
  carbonIndex: CarbonIndex;
  craneMoves: number;                  // moves / hour
  pilotPerformanceTime: number;        // hours
  yardOccupancyPct?: number;           // percent (Phase 4)
  avgTruckTAT?: number;                // minutes (Phase 2)
  throughputTEUPerHour?: number;       // TEU/hr (Phase 2+)
  gateQueueLength?: number;            // total across all gates (Phase 2)
  history: Record<string, number[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertOrigin = 'LIVE' | 'SIMULATED';

export interface SimAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  color: string;
  message: string;
  affectedEntity: string;
  timestamp: string;                   // ISO-8601
  dismissed: boolean;
  origin?: AlertOrigin;
  source?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION FLAGS & SCENARIO TYPES (Phase 5 schema — declared now)
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulationFlags {
  gateClosures: number[];
  extraVessels: number;
  truckSurge: number;
  bunchingActive: boolean;
  /** Weather for timing matrix (what-if: heavy_rain) */
  weather: 'clear' | 'rain' | 'heavy_rain' | 'storm';
  /** When set, one vessel has reduced crane capacity (per-vessel LOADING dwell) */
  craneBreakdownVesselId: string | null;
  activeScenarioIds: ScenarioId[];
}

export type ScenarioId =
  | 'heavy_rain'
  | 'crane_breakdown'
  | 'truck_inbound_surge'
  | 'yard_near_saturation';

export interface ScenarioParameterOverrides {
  /** Multiplier applied on top of timing matrix base values */
  gateProcessMultiplier?: number;
  customsCheckMultiplier?: number;
  yardTransitMultiplier?: number;
  craneUnloadMultiplier?: number;
  berthTurnaroundMultiplier?: number;
  truckArrivalRateMultiplier?: number;
  yardInitialOccupancyPct?: number;
}

export interface ScenarioExpectedImpacts {
  gateQueueDelta?: string;
  avgTruckTATDelta?: string;
  yardOccupancyDelta?: string;
  throughputDelta?: string;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  title: string;
  description: string;
  parameterOverrides: ScenarioParameterOverrides;
  expectedImpacts: ScenarioExpectedImpacts;
  durationMinutes?: number;            // null = runs until manually cleared
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION STATE (top-level store shape)
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulationState {
  vessels: SimVessel[];
  gates: SimGate[];
  trucks: SimTruck[];
  kpis: SimKPIs;
  alerts: SimAlert[];
  yard: SimYard;
  eventLog: SimEvent[];
  simulationFlags: SimulationFlags;
  activeScenarioIds: ScenarioId[];
  scenarioSeed: number;
  simTime: number;                    // minutes since simulation epoch (deterministic clock)
  lastUpdated: number;                // Unix ms (wall clock)
  eventIdSeq: number;
  /** Last resolved timing profile (for API clients / UI) */
  lastTimingProfile: TimingProfile | null;

  // ── Supply-chain aggregates (added by supplyChainEngine / Phase 5) ────────
  /** One record per StaticBerthConfig; length always equals portConfig.berths.length. */
  berthLines: BerthLineState[];
  /** One record per active rail rake. */
  railRakes: RailRakeState[];
  /** Per-vessel TEU flow aggregates (preferred for physics). */
  cargoAggregates: VesselCargoAggregate[];
  /**
   * UI drill-down container detail — capped at MAX_CONTAINER_DETAIL.
   * Do not use for physics calculations; use cargoAggregates instead.
   */
  containers: SimContainer[];
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMING MATRIX TYPES (consumed by timingMatrix.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** A single timing modifier with an optional descriptive label. */
export interface TimingModifier {
  factor: number;       // multiplicative — e.g. 1.35 means +35% delay
  label?: string;       // human-readable cause, used in delay attribution
}

/** Named groups of modifiers returned by getCurrentTimingProfile(). */
export interface TimingProfile {
  gateProcess: number;      // effective minutes
  customsCheck: number;
  yardTransit: number;
  craneUnloadPerTEU: number;
  berthTurnaround: number;
  /** Flat list of all applied modifiers for attribution strings */
  appliedModifiers: TimingModifier[];
}

/** Context passed to getCurrentTimingProfile(). */
export interface TimingContext {
  weather?: 'clear' | 'rain' | 'heavy_rain' | 'storm';
  incidentType?: 'none' | 'crane_breakdown' | 'gate_closure' | 'custom_delay';
  yardOccupancyPct?: number;            // 0–100
  vesselType?: VesselType;
  scenarioOverrides?: ScenarioParameterOverrides;
}
