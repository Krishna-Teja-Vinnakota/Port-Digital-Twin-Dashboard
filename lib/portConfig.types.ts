/**
 * Static port configuration types (the physical/operational blueprint).
 *
 * These describe nominal capacities and service rates for congestion modelling and
 * what-if simulation. They do NOT include live queues — that belongs in
 * lib/simulationStore.js and simulationTypes.ts.
 *
 * Units: minutes for times, TEU for container-equivalent, meters for distances.
 */

// ── Metadata ───────────────────────────────────────────────────────────────

export interface PortConfigMeta {
  /** Stable id, e.g. "port" */
  id: string;
  /** Short display name */
  name: string;
  /** Full port name */
  fullName: string;
  /** Schema / dataset version (bump when you change shape or units) */
  version: string;
  /** When values were last reviewed (ISO date string) */
  lastReviewed: string;
  /**
   * Human disclaimer: these are representative estimates for the digital twin
   * unless replaced by operations-sourced data.
   */
  notes: string;
}

// ── Gates ──────────────────────────────────────────────────────────────────

export type GateFlow = 'IMPORT' | 'EXPORT' | 'BOTH';

export interface StaticGateConfig {
  /** Numeric id — must match SimGate.id and gateEngine (1–4) */
  id: number;
  /** Short code for APIs/UI */
  code: string;
  displayName: string;
  /** Primary direction (Port gates are often import- or export-biased) */
  primaryFlow: GateFlow;
  position: { lat: number; lng: number };
  /**
   * Nominal service: how long one truck is served at the gate (processing).
   * Congestion engine can derive queue wait from queue length and parallel lanes.
   */
  service: {
    /** Average time from arrival at booth to release (minutes) */
    avgTruckProcessMins: number;
    /**
     * Effective completion rate if gates ran back-to-back with this service time
     * and parallelism (trucks / hour, informational).
     */
    nominalTrucksPerHour: number;
    /** Lanes that can be active simultaneously (parallelism) */
    activeLanes: number;
  };
  /** Notional max trucks waiting before “yard design” is stressed (tuning) */
  designMaxQueueTrucks: number;
}

// ── Berths / quay ─────────────────────────────────────────────────────────

export type BerthStatusNominal = 'OPERATIONAL' | 'MAINTENANCE' | 'DEEPENING';

export interface StaticBerthConfig {
  id: string;
  code: string;
  displayName: string;
  /** Quay or terminal name for UI grouping */
  quay: string;
  maxDraftM: number;
  quayLengthM: number;
  /** How many full vessels you model alongside this berth id (usually 1) */
  maxConcurrentVessels: number;
  /** Nominal ship-to-shore gantries (STS) available when line is active */
  nominalStsCranes: number;
  /**
   * Net crane moves per hour per STS (combined cycle import/export).
   * Unload time scales roughly as: teu / (movesPerHour * activeCranes).
   */
  movesPerCranePerHour: number;
  /** ULCV / post-panamax compatibility flag for scheduling */
  maxLoaM: number;
  status: BerthStatusNominal;
}

// ── Yard ───────────────────────────────────────────────────────────────────

export type YardBlockCategory =
  | 'IMPORT'
  | 'EXPORT'
  | 'REEFER'
  | 'MIXED'
  | 'CFS'
  | 'EMPTY_DEPOT';

export interface StaticYardBlockConfig {
  blockId: string;
  displayName: string;
  category: YardBlockCategory;
  /** Maximum TEU the block can hold (stacking + footprint modelled as a single cap) */
  maxTeu: number;
  /**
   * Nominal “normal day” starting occupancy for seeding simulation (0–1 fraction of maxTeu).
   * Override with scenario `yardInitialOccupancyPct` when running what-ifs.
   */
  initialOccupiedFraction: number;
  /**
   * Nominal net TEU that can move in+out of this block per hour (RTG/RMG, reach stacker).
   * Drives yard-handling time under congestion.
   */
  nominalThroughputTeuPerHour: number;
  /** Optional: reefer points if category includes REEFER */
  reeferPlugs?: number;
}

// ── Rail ───────────────────────────────────────────────────────────────────

export interface StaticRailSidingConfig {
  id: string;
  code: string;
  displayName: string;
  /** How many rakes you model as simultaneously at the facility */
  maxConcurrentRakes: number;
  /**
   * Net TEU per hour that can be exchanged between train and yard (gross of dwell).
   * Use with RAIL_STAGES in mockDataGen for coherent flow.
   */
  teuTransferPerHour: number;
  /**
   * Yard block ids that this siding primarily serves (for interconnect logic).
   */
  connectedYardBlockIds: string[];
}

// ── Global defaults for interconnect math ──────────────────────────────────

export interface PortOperationalDefaults {
  /**
   * If berth config omits a value, use this STS productivity (moves per crane per hour).
   */
  defaultMovesPerCranePerHour: number;
  /**
   * Yard block utilization (0–100) above which yard transit / retrieval slows.
   * Aligns with "yard near saturation" scenarios.
   */
  yardCongestionUtilizationThresholdPct: number;
  /**
   * Gate queue truck counts — align with getCongestionLevel in gateEngine.js (25/50).
   * Static copy here lets portConfig drive UI thresholds in one place later.
   */
  gateQueueMediumThreshold: number;
  gateQueueHighThreshold: number;
  /**
   * Nominal hours for vessel pre-berthing / anchorage in baseline schedule generation.
   */
  anchorageNominalWaitHours: { min: number; max: number };
  /**
   * Rail KPI baselines (for display / export dataset; not real-time).
   */
  railBaseline: {
    rakeTatHours: { min: number; max: number };
    onTimePercent: { min: number; max: number };
  };
}

// ── Root static config ─────────────────────────────────────────────────────

export interface PortConfig {
  meta: PortConfigMeta;
  gates: StaticGateConfig[];
  berths: StaticBerthConfig[];
  yardBlocks: StaticYardBlockConfig[];
  railSidings: StaticRailSidingConfig[];
  defaults: PortOperationalDefaults;
}
