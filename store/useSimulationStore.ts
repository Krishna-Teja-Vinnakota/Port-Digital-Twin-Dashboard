/**
 * useSimulationStore.ts
 * Zustand global state store for Port Digital Twin ICCC client-side state.
 * Shared across all dashboard components and panels.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Phase 1 additions:
 *   - Types now import from simulationTypes.ts (single source of truth).
 *   - Re-exported for backward-compat with existing component imports.
 *   - Added: simTime, timingProfile, activeScenarioIds fields.
 *   - hydrateFromState accepts simTime from server.
 * ══════════════════════════════════════════════════════════════════════════════
 */

'use client';

import { create } from 'zustand';

// ─────────────────────────────────────────────────────────────────────────────
// Re-export all canonical types from simulationTypes (single source of truth).
// Components that previously imported directly from this file continue to work.
// ─────────────────────────────────────────────────────────────────────────────
export type {
  VesselLifecycleState as VesselState, // backward-compat alias
  VesselLifecycleState,
  VesselType,
  VesselClass,
  DataSource,
  Sourced,
  SimVessel as Vessel,                 // backward-compat alias
  SimVessel,
  SimGate as Gate,                     // backward-compat alias
  SimGate,
  SimTruck as Truck,                   // backward-compat alias
  SimTruck,
  TruckLifecycleState,
  CargoType,
  SimAlert as Alert,                   // backward-compat alias
  SimAlert,
  AlertSeverity,
  AlertOrigin,
  SimKPIs as KPIs,                     // backward-compat alias
  SimKPIs,
  CarbonIndex,
  CongestionLevel,
  SimYard,
  YardBlock,
  SimEvent,
  EntityType,
  SimulationFlags,
  ScenarioId,
  ScenarioDefinition,
  ScenarioParameterOverrides,
  TimingProfile,
  TimingContext,
  TimingModifier,
  // Supply-chain aggregate types (Phase 6)
  SimContainer,
  ContainerStatus,
  BerthLineState,
  RailRakeState,
  VesselCargoAggregate,
} from '@/lib/simulationTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Local-only types (UI concerns not in simulationTypes)
// ─────────────────────────────────────────────────────────────────────────────
// Note: SimContainer, ContainerStatus, BerthLineState, RailRakeState,
// VesselCargoAggregate are canonical in simulationTypes and re-exported above.

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  parsed?: {
    summary: string;
    impact: {
      tat_delta: string;
      congestion_change: string;
      carbon_delta: string;
      affected_vessels: number;
    };
    recommendations: string[];
    severity: string;
    confidence: number;
  };
}

export type UserRole =
  | 'Port Authority'
  | 'Traffic Controller'
  | 'Energy Manager'
  | 'Environmental Officer';

export type ActiveTab = 'main' | 'energy' | 'environment' | 'rail' | 'berth';

// ─────────────────────────────────────────────────────────────────────────────
// Import the canonical types for use in this file's interface definitions
// ─────────────────────────────────────────────────────────────────────────────
import type {
  SimVessel,
  SimGate,
  SimTruck,
  SimAlert,
  SimKPIs,
  SimYard,
  SimEvent,
  ScenarioId,
  TimingProfile,
  SimContainer,
  ContainerStatus,
  BerthLineState,
  RailRakeState,
  VesselCargoAggregate,
} from '@/lib/simulationTypes';
import type { PocDataStatus } from '@/lib/pocDataStatusTypes';
import { tickTrucksSimple } from '@/lib/truckEngine';

/** Pre-bid POC: baseline vs scenario comparison */
export interface PocSnapshot {
  baselineKpis: SimKPIs | null;
  baselineLabel: string;
  activeScenarioIds: string[];
  capturedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store interface
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulationStore {
  // ── Simulation state ────────────────────────────────────────────────────
  vessels: SimVessel[];
  gates: SimGate[];
  trucks: SimTruck[];
  alerts: SimAlert[];
  kpis: SimKPIs | null;

  // ── Phase 1 additions ───────────────────────────────────────────────────
  /** Deterministic simulation clock — minutes since simulation epoch. */
  simTime: number;
  /** Current resolved timing profile (forwarded from server tick context). */
  timingProfile: TimingProfile | null;
  /** Active scenario IDs (Phase 5 — declared now for forward compat). */
  activeScenarioIds: ScenarioId[];

  // ── Phase 2 additions (declared for forward compat) ──────────────────────
  eventLog: SimEvent[];

  // ── Phase 4 additions (declared for forward compat) ──────────────────────
  yard: SimYard | null;

  // ── Supply-chain aggregates (Phase 6) ────────────────────────────────────
  /** One entry per portConfig berth; hydrated from server state. */
  berthLines: BerthLineState[];
  /** Active rail rakes; hydrated from server state. */
  railRakes: RailRakeState[];
  /** Per-vessel TEU flow aggregates; preferred over per-container rows for physics. */
  cargoAggregates: VesselCargoAggregate[];
  /** Live container inventory — capped at MAX_CONTAINER_DETAIL on the server (500).
   *  Client cap is 2 000 to accommodate ephemeral spawning. */
  containers: SimContainer[];

  /** Pre-bid POC: live vs simulated data summary from /api/poc/data-status */
  dataProvenance: PocDataStatus | null;
  /** Pre-bid POC: KPI baseline before what-if (for delta display) */
  pocSnapshot: PocSnapshot | null;

  /**
   * Set when a what-if scenario is applied. Prompts the user in the AI Advisor
   * to click "Analyze" — no automatic API call is fired; the user initiates it.
   */
  pendingScenarioAdvice: {
    scenarioId: string;
    scenarioLabel: string;
    triggeredAt: number;
  } | null;

  // ── Mock TOS physics (Phase 6) ────────────────────────────────────────────
  /** Current weather scenario driving the client-side physics tick. */
  weatherScenario: string;

  // ── UI state ─────────────────────────────────────────────────────────────
  userRole: UserRole;
  activeTab: ActiveTab;
  chatMessages: AIMessage[];
  isLoading: boolean;
  lastUpdated: number;
  selectedEntity: { type: string; id: string } | null;
  mapLayersVisible: Record<string, boolean>;

  // ── Actions ───────────────────────────────────────────────────────────────
  setVessels: (vessels: SimVessel[]) => void;
  setGates: (gates: SimGate[]) => void;
  setTrucks: (trucks: SimTruck[]) => void;
  setAlerts: (alerts: SimAlert[]) => void;
  setKPIs: (kpis: SimKPIs) => void;
  setSimTime: (simTime: number) => void;
  setTimingProfile: (profile: TimingProfile) => void;
  setUserRole: (role: UserRole) => void;
  setActiveTab: (tab: ActiveTab) => void;
  addChatMessage: (msg: AIMessage) => void;
  dismissAlert: (alertId: string) => void;
  setSelectedEntity: (entity: { type: string; id: string } | null) => void;
  toggleMapLayer: (layer: string) => void;
  setIsLoading: (loading: boolean) => void;
  setLastUpdated: (ts: number) => void;
  appendEvents: (events: SimEvent[]) => void;
  setYard: (yard: SimYard) => void;
  setActiveScenarios: (ids: ScenarioId[]) => void;
  setEventLog: (events: SimEvent[]) => void;
  setDataProvenance: (d: PocDataStatus | null) => void;
  setPocSnapshot: (s: PocSnapshot | null) => void;
  clearPocSnapshot: () => void;
  setPendingScenarioAdvice: (advice: { scenarioId: string; scenarioLabel: string; triggeredAt: number } | null) => void;
  clearPendingScenarioAdvice: () => void;
  addEvents: (events: SimEvent[]) => void;

  // ── Container (Mock TOS) actions (Phase 6) ────────────────────────────────
  /**
   * Spawn N containers into the yard when a vessel docks and begins unloading.
   * @param vesselId  The vessel producing the containers
   * @param teuCount  Number of TEU-equivalent container units to create
   */
  spawnContainersForVessel: (vesselId: string, teuCount: number) => void;
  /** Directly replace the full containers list (e.g. hydration). */
  setContainers: (containers: SimContainer[]) => void;
  /** Transition a specific container to a new status and optionally pair with a truck. */
  updateContainerStatus: (containerId: string, status: ContainerStatus, truckId?: string) => void;
  setBerthLines: (lines: BerthLineState[]) => void;
  setRailRakes: (rakes: RailRakeState[]) => void;
  setCargoAggregates: (aggregates: VesselCargoAggregate[]) => void;

  // ── Mock TOS physics actions (Phase 6) ────────────────────────────────────
  /** Advance truck positions one tick using the client-side physics engine. */
  tickSimulation: () => void;
  /** Set the active weather scenario for the physics tick. */
  triggerScenario: (scenarioName: string) => void;

  /** Bulk hydrate from a server-side state snapshot. */
  hydrateFromState: (state: {
    vessels: SimVessel[];
    gates: SimGate[];
    trucks: SimTruck[];
    alerts: SimAlert[];
    kpis: SimKPIs;
    simTime?: number;
    yard?: SimYard;
    eventLog?: SimEvent[];
    simulationFlags?: { activeScenarioIds?: ScenarioId[]; weather?: string };
    lastTimingProfile?: TimingProfile | null;
    // Supply-chain aggregates (Phase 6 — present when USE_AGGREGATE_SUPPLY_CHAIN=true)
    berthLines?: BerthLineState[];
    railRakes?: RailRakeState[];
    cargoAggregates?: VesselCargoAggregate[];
    containers?: SimContainer[];
  }) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default values
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAP_LAYERS: Record<string, boolean> = {
  vessels:     true,
  gates:       true,
  trucks:      true,
  roads:       false,
  substations: true,
  greencover:  false,
  yard:        true,   // Phase 4 yard blocks
};

// ─────────────────────────────────────────────────────────────────────────────
// Store creation
// ─────────────────────────────────────────────────────────────────────────────

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  // State
  vessels:           [],
  gates:             [],
  trucks:            [],
  alerts:            [],
  kpis:              null,
  simTime:           0,
  timingProfile:     null,
  activeScenarioIds: [],
  eventLog:          [],
  yard:              null,
  berthLines:        [],
  railRakes:         [],
  cargoAggregates:   [],
  containers:        [],
  dataProvenance:         null,
  pocSnapshot:            null,
  pendingScenarioAdvice:  null,
  weatherScenario:   'CLEAR',
  userRole:          'Port Authority',
  activeTab:         'main',
  chatMessages:      [],
  isLoading:         false,
  lastUpdated:       0,
  selectedEntity:    null,
  mapLayersVisible:  DEFAULT_MAP_LAYERS,

  // Actions
  setVessels:      (vessels)      => set({ vessels }),
  setGates:        (gates)        => set({ gates }),
  setTrucks:       (trucks)       => set({ trucks }),
  setAlerts:       (alerts)       => set({ alerts }),
  setKPIs:         (kpis)         => set({ kpis }),
  setSimTime:      (simTime)      => set({ simTime }),
  setTimingProfile:(timingProfile)=> set({ timingProfile }),
  setUserRole:     (userRole)     => set({ userRole }),
  setActiveTab:    (activeTab)    => set({ activeTab }),
  setIsLoading:    (isLoading)    => set({ isLoading }),
  setLastUpdated:  (lastUpdated)  => set({ lastUpdated }),
  setYard:         (yard)         => set({ yard }),
  setActiveScenarios: (ids)       => set({ activeScenarioIds: ids }),
  setEventLog:     (eventLog)    => set({ eventLog }),
  setDataProvenance:         (dataProvenance)         => set({ dataProvenance }),
  setPocSnapshot:            (pocSnapshot)             => set({ pocSnapshot }),
  clearPocSnapshot:          ()                        => set({ pocSnapshot: null }),
  setPendingScenarioAdvice:  (pendingScenarioAdvice)  => set({ pendingScenarioAdvice }),
  clearPendingScenarioAdvice: ()                       => set({ pendingScenarioAdvice: null }),
  addEvents: (events) =>
    set((state) => ({
      eventLog: [...(state.eventLog || []), ...(events || [])].slice(-500),
    })),

  spawnContainersForVessel: (vesselId, teuCount) => {
    const newContainers: SimContainer[] = Array.from({ length: teuCount }, (_, i) => ({
      id: `CONT-${vesselId}-${String(i + 1).padStart(4, '0')}`,
      status: 'IN_YARD' as ContainerStatus,
      vesselId,
      yardBlockId: 'IMPORT_BLOCK_A',
      teus: 1,
    }));
    set((state) => ({
      // Cap at 2 000 containers in client memory to prevent bloat
      containers: [...state.containers, ...newContainers].slice(-2_000),
    }));
  },

  setContainers:       (containers)   => set({ containers }),
  setBerthLines:       (berthLines)   => set({ berthLines }),
  setRailRakes:        (railRakes)    => set({ railRakes }),
  setCargoAggregates:  (cargoAggregates) => set({ cargoAggregates }),

  updateContainerStatus: (containerId, status, truckId) =>
    set((state) => ({
      containers: state.containers.map((c) =>
        c.id === containerId
          ? { ...c, status, ...(truckId !== undefined && { truckId }) }
          : c
      ),
    })),

  tickSimulation: () => {
    const state = get();
    // physicsLog is a local string buffer — transitions from the client physics
    // engine are human-readable strings, separate from the SimEvent[] server log.
    const physicsLog: string[] = [];
    const updatedTrucks = tickTrucksSimple(
      state.trucks,
      state.yard ?? { capacityTEU: 50_000, currentTEU: 29_000 },
      state.weatherScenario,
      physicsLog,
    );

    // ── Container-truck pairing ───────────────────────────────────────────────
    // Trucks that have just entered LOADING state get paired with an IN_YARD
    // container. When a truck exits LOADING the container transitions to ON_TRUCK.
    let containers = [...state.containers];

    for (const truck of updatedTrucks) {
      if (truck.state === 'LOADING' && !truck.assignedContainer) {
        const available = containers.find(
          (c) => c.status === 'IN_YARD' && !c.truckId
        );
        if (available) {
          // Mutate the truck reference copy to attach the container id
          (truck as SimTruck & { assignedContainer?: string }).assignedContainer = available.id;
          containers = containers.map((c) =>
            c.id === available.id ? { ...c, status: 'ON_TRUCK', truckId: truck.id } : c
          );
        }
      }

      // Truck exiting → mark container DELIVERED
      if (truck.state === 'EXITING') {
        const paired = (truck as SimTruck & { assignedContainer?: string }).assignedContainer;
        if (paired) {
          containers = containers.map((c) =>
            c.id === paired && c.status === 'ON_TRUCK'
              ? { ...c, status: 'DELIVERED' }
              : c
          );
        }
      }
    }

    set({ trucks: updatedTrucks, containers });
  },

  triggerScenario: (scenarioName) => set({ weatherScenario: scenarioName }),

  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages.slice(-15), msg],
    })),

  dismissAlert: (alertId) =>
    set((state) => ({
      alerts: state.alerts.map((a) =>
        a.id === alertId ? { ...a, dismissed: true } : a
      ),
    })),

  setSelectedEntity: (entity) => set({ selectedEntity: entity }),

  toggleMapLayer: (layer) =>
    set((state) => ({
      mapLayersVisible: {
        ...state.mapLayersVisible,
        [layer]: !state.mapLayersVisible[layer],
      },
    })),

  appendEvents: (events) =>
    set((state) => ({
      // Keep last 500 events in client store to prevent memory bloat
      eventLog: [...state.eventLog, ...events].slice(-500),
    })),

  hydrateFromState: ({
    vessels, gates, trucks, alerts, kpis, simTime, yard, eventLog,
    simulationFlags, lastTimingProfile,
    berthLines, railRakes, cargoAggregates, containers: serverContainers,
  }) => {
    const state = get();

    // ── E2E flow: auto-spawn containers when a vessel transitions to LOADING ──
    // Compare incoming vessels against current store vessels. Any vessel that
    // has just moved into the LOADING state gets ~1 000 synthetic containers
    // pushed into the yard so the truck → container lifecycle can proceed.
    const existingVesselMap = new Map(state.vessels.map((v) => [v.id, v]));
    const newlyLoadingVessels = vessels.filter((v) => {
      const prev = existingVesselMap.get(v.id);
      return v.lifecycleState === 'LOADING' && prev?.lifecycleState !== 'LOADING';
    });

    // If server provides containers directly, use those; otherwise manage locally.
    let containers = serverContainers !== undefined ? serverContainers : state.containers;
    if (serverContainers === undefined && newlyLoadingVessels.length > 0) {
      const spawned: SimContainer[] = newlyLoadingVessels.flatMap((v) => {
        const teuCount = Math.min(v.teuEstimate?.value ?? 1000, 500);
        return Array.from({ length: teuCount }, (_, i) => ({
          id: `CONT-${v.id}-${String(i + 1).padStart(4, '0')}`,
          status: 'IN_YARD' as ContainerStatus,
          vesselId: v.id,
          yardBlockId: 'IMPORT_BLOCK_A',
          teus: 1,
        }));
      });
      containers = [...containers, ...spawned].slice(-2_000);
    }

    // ── E2E flow: pair newly-APPROACHING trucks with an available container ──
    // Trucks just spawned in APPROACHING get a container ID reservation so that
    // when they transition to LOADING the pairing is instant.
    const existingTruckMap = new Map(state.trucks.map((t) => [t.id, t]));
    let updatedContainers = containers;
    const trucksWithContainers = trucks.map((t) => {
      const isNew = !existingTruckMap.has(t.id);
      const alreadyAssigned = (t as SimTruck & { assignedContainer?: string }).assignedContainer;
      if (isNew && t.state === 'APPROACHING' && !alreadyAssigned) {
        const available = updatedContainers.find((c) => c.status === 'IN_YARD' && !c.truckId);
        if (available) {
          updatedContainers = updatedContainers.map((c) =>
            c.id === available.id ? { ...c, status: 'ON_TRUCK' as ContainerStatus, truckId: t.id } : c
          );
          return { ...t, assignedContainer: available.id };
        }
      }
      return t;
    });

    set({
      vessels,
      gates,
      trucks: trucksWithContainers,
      alerts,
      kpis,
      containers: updatedContainers,
      lastUpdated: Date.now(),
      ...(simTime        !== undefined && { simTime }),
      ...(yard           !== undefined && { yard }),
      ...(eventLog       !== undefined && { eventLog }),
      ...(berthLines     !== undefined && { berthLines }),
      ...(railRakes      !== undefined && { railRakes }),
      ...(cargoAggregates !== undefined && { cargoAggregates }),
      ...(simulationFlags?.activeScenarioIds && { activeScenarioIds: simulationFlags.activeScenarioIds }),
      ...(simulationFlags?.weather           && { weatherScenario: simulationFlags.weather }),
      ...(lastTimingProfile !== undefined    && { timingProfile: lastTimingProfile }),
    });
  },
}));
