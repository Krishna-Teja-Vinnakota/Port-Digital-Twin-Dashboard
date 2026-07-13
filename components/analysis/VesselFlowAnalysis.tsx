'use client';

/**
 * VesselFlowAnalysis — end-to-end single-vessel flow dashboard.
 * Shows lifecycle progress, cargo TEU flow, carbon emissions,
 * berth status, assigned trucks, and full event timeline.
 */

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSimulationStore } from '@/store/useSimulationStore';
import {
  Ship, Leaf, Truck as TruckIcon, Clock, AlertTriangle,
  Anchor, Activity, Banknote,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SimVessel, VesselLifecycleState, VesselClass } from '@/lib/simulationTypes';

// Dynamic import keeps HERE Maps SDK out of the SSR bundle
const VesselMiniMap = dynamic(
  () => import('@/components/map/VesselMiniMap').then(m => ({ default: m.VesselMiniMap })),
  { ssr: false, loading: () => null },
);

// ── Constants ──────────────────────────────────────────────────────────────────

const STATE_ORDER: VesselLifecycleState[] = [
  'APPROACHING', 'ANCHORED', 'BERTHING', 'LOADING', 'DEPARTING',
];

const STATE_COLORS: Record<string, string> = {
  APPROACHING: '#3b82f6',
  ANCHORED:    '#f59e0b',
  BERTHING:    '#38bdf8',
  LOADING:     '#22c55e',
  DEPARTING:   '#94a3b8',
};

const TRUCK_STATE_COLORS: Record<string, string> = {
  APPROACHING:       '#38bdf8',
  APPROACHING_PORT:  '#38bdf8',
  GATE_QUEUE:        '#ef4444',
  CUSTOMS_CHECK:     '#f97316',
  YARD_TRANSIT:      '#eab308',
  LOADING:           '#22c55e',
  LOADING_UNLOADING: '#22c55e',
  EXITING:           '#94a3b8',
};

// Each simulation tick advances the clock by 5 minutes.
const TICKS_TO_MINS = 5;

// ── Financial rate constants (illustrative Port-scale tariff) ─────────────────
// Berth hire: ₹ per hour by vessel class
const BERTH_HIRE_RATE: Partial<Record<VesselClass, number>> & { default: number } = {
  FEEDER:       18_000,
  PANAMAX:      28_000,
  POST_PANAMAX: 38_000,
  ULCV:         55_000,
  default:      28_000,
};
// Port dues: ₹ per DWT (single charge per port call)
const PORT_DUES_PER_DWT = 8;
// Wharfage: ₹ per TEU handled (discharge + load)
const WHARFAGE_PER_TEU = 280;
// Pilotage: flat ₹ by vessel class
const PILOTAGE_FEE: Partial<Record<VesselClass, number>> & { default: number } = {
  FEEDER:       8_000,
  PANAMAX:      15_000,
  POST_PANAMAX: 22_000,
  ULCV:         30_000,
  default:      15_000,
};
// Demurrage: ₹ per hour beyond the free-time allowance
const DEMURRAGE_FREE_HRS = 2;       // hrs free pre-berthing
const DEMURRAGE_RATE_PER_HR = 48_000;

// ── Helpers ────────────────────────────────────────────────────────────────────

function stateBadgeClass(state: VesselLifecycleState | string): string {
  const map: Record<string, string> = {
    APPROACHING: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
    ANCHORED:    'bg-amber-900/50 text-amber-300 border-amber-700/50',
    BERTHING:    'bg-sky-900/50 text-sky-300 border-sky-700/50',
    LOADING:     'bg-green-900/50 text-green-300 border-green-700/50',
    DEPARTING:   'bg-slate-800/50 text-slate-300 border-slate-600/50',
    REMOVED:     'bg-red-900/50 text-red-300 border-red-700/50',
  };
  return `text-[10px] font-bold px-2 py-0.5 rounded border ${map[state] ?? map.APPROACHING}`;
}

function carbonBadge(tons: number): { label: string; color: string } {
  if (tons < 2) return { label: 'LOW',      color: '#22c55e' };
  if (tons < 6) return { label: 'MODERATE', color: '#f59e0b' };
  return               { label: 'HIGH',     color: '#ef4444' };
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ── Vessel Header ──────────────────────────────────────────────────────────────

function VesselHeader({ vessel }: { vessel: SimVessel }) {
  const color = STATE_COLORS[vessel.lifecycleState] ?? '#94a3b8';

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${color}18`, border: `1.5px solid ${color}44` }}
          >
            <Ship className="w-5 h-5" style={{ color }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-100 truncate">{vessel.name}</h2>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="text-[10px] text-slate-400">{vessel.type}</span>
              {vessel.vesselClass && (
                <>
                  <span className="text-slate-700">·</span>
                  <span className="text-[10px] text-slate-400">{vessel.vesselClass}</span>
                </>
              )}
              <span className="text-slate-700">·</span>
              <span className="text-[10px] text-slate-400">Flag: {vessel.flag}</span>
              <span className="text-slate-700">·</span>
              <span className="text-[10px] text-slate-400">DWT: {vessel.dwt.toLocaleString()} t</span>
            </div>
          </div>
        </div>
        <span className={stateBadgeClass(vessel.lifecycleState)}>
          {vessel.lifecycleState}
        </span>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-5 flex-wrap">
        {vessel.eta && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-slate-500" />
            <span className="text-[10px] text-slate-500">ETA:</span>
            <span className="text-[10px] text-slate-300 font-mono">
              {new Date(vessel.eta).toLocaleString()}
            </span>
          </div>
        )}
        {vessel.berthNumber && (
          <div className="flex items-center gap-1.5">
            <Anchor className="w-3 h-3 text-amber-500/70" />
            <span className="text-[10px] text-slate-500">Berth:</span>
            <span className="text-[10px] text-amber-300 font-mono">{vessel.berthNumber}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">Position:</span>
          <span className="text-[10px] text-slate-300 font-mono">
            {vessel.position.lat.toFixed(4)}°N, {vessel.position.lng.toFixed(4)}°E
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Lifecycle Progress Strip ───────────────────────────────────────────────────

function LifecycleStrip({ vessel }: { vessel: SimVessel }) {
  const currentIdx = STATE_ORDER.indexOf(vessel.lifecycleState as VesselLifecycleState);

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-4">
        Lifecycle Progress
      </p>
      <div className="flex items-start gap-1">
        {STATE_ORDER.map((state, idx) => {
          const complete = idx < currentIdx;
          const active   = idx === currentIdx;
          const pending  = idx > currentIdx;
          const color    = STATE_COLORS[state];
          const isLast   = idx === STATE_ORDER.length - 1;

          return (
            <React.Fragment key={state}>
              <div className="flex-1 min-w-0">
                <div
                  className="py-3 rounded-lg text-center mb-1.5 transition-all duration-500"
                  style={{
                    background: active ? `${color}18` : complete ? `${color}0a` : '#0f172a',
                    border:     `1.5px solid ${active ? color : complete ? `${color}44` : '#1e293b'}`,
                    boxShadow:  active ? `0 0 18px ${color}20` : undefined,
                  }}
                >
                  <span
                    className="text-sm font-mono"
                    style={{ color: pending ? '#334155' : color }}
                  >
                    {complete ? '✓' : active ? '●' : '○'}
                  </span>
                </div>
                <p className={`text-[9px] font-medium text-center leading-tight ${pending ? 'text-slate-600' : 'text-slate-300'}`}>
                  {state.charAt(0) + state.slice(1).toLowerCase()}
                </p>
                {active && (
                  <p className="text-[9px] text-center mt-0.5 text-slate-500">
                    {vessel.ticksInState * TICKS_TO_MINS}m elapsed
                  </p>
                )}
              </div>
              {!isLast && (
                <div className={`text-xs mt-3 shrink-0 px-0.5 ${complete ? 'text-slate-500' : 'text-slate-700'}`}>
                  →
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── Cargo Flow Card ────────────────────────────────────────────────────────────

function CargoFlowCard({ vessel, vesselId }: { vessel: SimVessel; vesselId: string }) {
  const cargoAggregates = useSimulationStore(s => s.cargoAggregates);
  const cargo = cargoAggregates.find(c => c.vesselId === vesselId);
  const teuEst = vessel.teuEstimate?.value ?? 0;

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-3.5 h-3.5 text-cyan-400" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Cargo Flow</p>
      </div>

      {cargo ? (
        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[10px] text-slate-400">Discharge</span>
              <span className="text-[10px] font-mono text-slate-200">
                {cargo.teuDischarged.toLocaleString()} / {cargo.teuToDischarge.toLocaleString()} TEU
              </span>
            </div>
            <ProgressBar value={cargo.teuDischarged} max={cargo.teuToDischarge} color="#22c55e" />
            <p className="text-[9px] text-slate-600 mt-0.5">
              {cargo.teuToDischarge > 0
                ? `${Math.min(100, (cargo.teuDischarged / cargo.teuToDischarge) * 100).toFixed(0)}% complete`
                : 'No discharge planned'}
            </p>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[10px] text-slate-400">Load</span>
              <span className="text-[10px] font-mono text-slate-200">
                {cargo.teuLoaded.toLocaleString()} / {cargo.teuToLoad.toLocaleString()} TEU
              </span>
            </div>
            <ProgressBar value={cargo.teuLoaded} max={cargo.teuToLoad} color="#38bdf8" />
            <p className="text-[9px] text-slate-600 mt-0.5">
              {cargo.teuToLoad > 0
                ? `${Math.min(100, (cargo.teuLoaded / cargo.teuToLoad) * 100).toFixed(0)}% complete`
                : 'No load planned'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {teuEst > 0 && (
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-500">Est. TEU capacity</span>
              <span className="text-[10px] font-mono text-cyan-300">~{teuEst.toLocaleString()}</span>
            </div>
          )}
          <p className="text-[10px] text-slate-600 mt-1">
            {vessel.lifecycleState === 'APPROACHING' || vessel.lifecycleState === 'ANCHORED'
              ? 'Cargo ops not yet started — vessel not berthed.'
              : vessel.lifecycleState === 'DEPARTING' || vessel.lifecycleState === 'REMOVED'
              ? 'Cargo ops complete — vessel departed.'
              : 'Cargo aggregate not yet available.'}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Carbon Emissions Card ──────────────────────────────────────────────────────

function CarbonCard({ vessel }: { vessel: SimVessel }) {
  const totalCarbon = vessel.waitHours * vessel.emissionsRate;
  const ci = carbonBadge(totalCarbon);

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Leaf className="w-3.5 h-3.5 text-emerald-400" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Carbon Emissions</p>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-end">
          <span className="text-[10px] text-slate-400">Total (est.)</span>
          <span className="text-sm font-bold text-slate-100">{totalCarbon.toFixed(2)} t CO₂</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">Rate</span>
          <span
            className="text-[10px] font-mono"
            style={{ color: vessel.emissionsRate > 2 ? '#f97316' : '#94a3b8' }}
          >
            {vessel.emissionsRate.toFixed(2)} t CO₂/hr
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">Time in port</span>
          <span className="text-[10px] font-mono text-slate-300">
            {vessel.waitHours.toFixed(1)} hrs
          </span>
        </div>
        <div className="flex justify-between items-center pt-1.5 border-t border-slate-800">
          <span className="text-[10px] text-slate-400">Carbon index</span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{
              color:      ci.color,
              background: `${ci.color}18`,
              border:     `1px solid ${ci.color}44`,
            }}
          >
            {ci.label}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Berth & Operations Card ────────────────────────────────────────────────────

function BerthCard({ vessel, vesselId }: { vessel: SimVessel; vesselId: string }) {
  const berthLines = useSimulationStore(s => s.berthLines);
  const bl = berthLines.find(b => b.vesselId === vesselId);

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Anchor className="w-3.5 h-3.5 text-amber-400" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Berth & Ops</p>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">Berth</span>
          <span className="text-[10px] font-mono text-slate-100">
            {vessel.berthNumber ?? 'Unassigned'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">STS Cranes</span>
          <span
            className="text-[10px] font-mono"
            style={{ color: vessel.assignedCranes === 1 ? '#ef4444' : '#e2e8f0' }}
          >
            {vessel.assignedCranes} assigned
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">Pilot</span>
          <span
            className="text-[10px] font-mono"
            style={{ color: vessel.pilotAssigned ? '#22c55e' : '#f59e0b' }}
          >
            {vessel.pilotAssigned ? 'Assigned' : 'Pending'}
          </span>
        </div>
        {bl && (
          <>
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Ops started</span>
              <span className="text-[10px] font-mono text-slate-300">t+{bl.opsStartSimMins}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Projected end</span>
              <span className="text-[10px] font-mono text-slate-300">
                t+{bl.opsEndProjectedSimMins}m
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-slate-400">Eff. cranes</span>
              <span className="text-[10px] font-mono text-slate-300">
                {bl.assignedCranesEffective}
              </span>
            </div>
          </>
        )}
        <div className="flex justify-between pt-1.5 border-t border-slate-800">
          <span className="text-[10px] text-slate-400">Wait time</span>
          <span
            className="text-[10px] font-mono"
            style={{ color: vessel.waitHours > 3 ? '#ef4444' : '#e2e8f0' }}
          >
            {vessel.waitHours.toFixed(1)} hrs
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Assigned Trucks ────────────────────────────────────────────────────────────

function AssignedTrucks({ vessel, vesselId }: { vessel: SimVessel; vesselId: string }) {
  const trucks = useSimulationStore(s => s.trucks);

  const assignedTrucks = useMemo(
    () => trucks.filter(t =>
      t.assignedVesselId === vesselId ||
      t.assignedVessel   === vesselId ||
      (vessel.berthNumber && t.destination === vessel.berthNumber)
    ),
    [trucks, vesselId, vessel.berthNumber],
  );

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TruckIcon className="w-3.5 h-3.5 text-slate-400" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Assigned Trucks
          </p>
        </div>
        <span className="text-[10px] font-mono text-slate-500">{assignedTrucks.length} active</span>
      </div>

      {assignedTrucks.length === 0 ? (
        <p className="text-[10px] text-slate-600">
          No trucks currently assigned to this vessel or berth.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 pb-1.5 mb-1 border-b border-slate-800">
            {['Truck ID', 'State', 'Cargo', 'Container'].map(h => (
              <span key={h} className="text-[9px] font-bold uppercase tracking-wide text-slate-600">
                {h}
              </span>
            ))}
          </div>
          <ScrollArea className="max-h-40">
            <div className="space-y-0.5">
              {assignedTrucks.map(t => {
                const stateColor = TRUCK_STATE_COLORS[t.state] ?? '#94a3b8';
                return (
                  <div key={t.id} className="grid grid-cols-4 gap-2 py-1 border-b border-slate-800/30">
                    <span className="text-[10px] font-mono text-cyan-300 truncate">
                      {t.plateNumber}
                    </span>
                    <span className="text-[10px] truncate" style={{ color: stateColor }}>
                      {t.state.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] text-slate-300 truncate">{t.cargoType}</span>
                    <span className="text-[10px] font-mono text-slate-500 truncate">
                      {t.assignedContainer ?? '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

// ── Event Timeline ─────────────────────────────────────────────────────────────

function EventTimeline({ vesselId }: { vesselId: string }) {
  const eventLog = useSimulationStore(s => s.eventLog);

  const events = useMemo(
    () =>
      eventLog
        .filter(e => e.entityId === vesselId)
        .sort((a, b) => b.simTime - a.simTime),
    [eventLog, vesselId],
  );

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Event Timeline
          </p>
        </div>
        <span className="text-[10px] font-mono text-slate-500">{events.length} events</span>
      </div>

      {events.length === 0 ? (
        <p className="text-[10px] text-slate-600">
          No state transitions recorded yet. Events appear as simulation ticks advance.
        </p>
      ) : (
        <ScrollArea className="h-52">
          <ol className="space-y-2.5 border-l border-slate-700/50 ml-2 pl-4">
            {events.map(e => {
              const color = STATE_COLORS[e.toState] ?? '#94a3b8';
              return (
                <li key={e.id} className="relative">
                  <span
                    className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border"
                    style={{ background: `${color}44`, borderColor: color }}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-cyan-500/90">t+{e.simTime}m</span>
                    <span className="text-[9px] text-slate-600">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-slate-400">{e.fromState}</span>
                    <span className="text-[10px] text-slate-600">→</span>
                    <span className="text-[10px] font-semibold" style={{ color }}>
                      {e.toState}
                    </span>
                  </div>
                  {e.reason && (
                    <p className="text-[9px] text-slate-600 mt-0.5">{e.reason}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      )}
    </div>
  );
}

// ── Financial Estimate Card ────────────────────────────────────────────────────

function fmtINR(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString()}`;
}

function FinancialCard({ vessel, vesselId }: { vessel: SimVessel; vesselId: string }) {
  const cargoAggregates = useSimulationStore(s => s.cargoAggregates);
  const berthLines      = useSimulationStore(s => s.berthLines);

  const cargo = cargoAggregates.find(c => c.vesselId === vesselId);
  const bl    = berthLines.find(b => b.vesselId === vesselId);
  const vc    = vessel.vesselClass ?? 'PANAMAX';

  // Berth time: use projected ops window if available, else ticks-in-state
  const berthHrs = bl
    ? (bl.opsEndProjectedSimMins - bl.opsStartSimMins) / 60
    : (vessel.lifecycleState === 'LOADING' || vessel.lifecycleState === 'BERTHING')
      ? (vessel.ticksInState * TICKS_TO_MINS) / 60
      : Math.max(vessel.waitHours, 0.5);

  const teuHandled = cargo
    ? cargo.teuDischarged + cargo.teuLoaded
    : vessel.teuEstimate?.value ?? 0;

  const berthHire  = berthHrs * (BERTH_HIRE_RATE[vc] ?? BERTH_HIRE_RATE.default);
  const portDues   = vessel.dwt * PORT_DUES_PER_DWT;
  const wharfage   = teuHandled * WHARFAGE_PER_TEU;
  const pilotage   = PILOTAGE_FEE[vc] ?? PILOTAGE_FEE.default;
  const demurrageHrs  = Math.max(0, vessel.waitHours - DEMURRAGE_FREE_HRS);
  const delayCost  = demurrageHrs * DEMURRAGE_RATE_PER_HR;
  const portRevenue = berthHire + portDues + wharfage + pilotage;
  const totalCall   = portRevenue + delayCost;

  return (
    <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Banknote className="w-3.5 h-3.5 text-yellow-400" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Financial Estimate
        </p>
        <span className="text-[9px] text-slate-600 ml-auto">indicative · Port tariff</span>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600 mb-1">
          Port Revenue
        </p>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">Berth hire ({berthHrs.toFixed(1)} hrs)</span>
          <span className="text-[10px] font-mono text-slate-200">{fmtINR(berthHire)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">Port dues (DWT-based)</span>
          <span className="text-[10px] font-mono text-slate-200">{fmtINR(portDues)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">
            Wharfage ({teuHandled.toLocaleString()} TEU)
          </span>
          <span className="text-[10px] font-mono text-slate-200">{fmtINR(wharfage)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-slate-400">Pilotage</span>
          <span className="text-[10px] font-mono text-slate-200">{fmtINR(pilotage)}</span>
        </div>

        {delayCost > 0 && (
          <>
            <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600 mt-2 mb-1">
              Delay Costs (shipowner)
            </p>
            <div className="flex justify-between">
              <span className="text-[10px] text-red-400">
                Pre-berthing detention ({demurrageHrs.toFixed(1)} hrs over {DEMURRAGE_FREE_HRS}h SLA)
              </span>
              <span className="text-[10px] font-mono text-red-400">{fmtINR(delayCost)}</span>
            </div>
          </>
        )}

        <div className="flex justify-between pt-2 border-t border-slate-700 mt-1">
          <span className="text-[10px] font-bold text-slate-300">Port Revenue (est.)</span>
          <span className="text-sm font-bold text-yellow-400">{fmtINR(portRevenue)}</span>
        </div>
        {delayCost > 0 && (
          <div className="flex justify-between">
            <span className="text-[10px] text-slate-500">Total incl. delay costs</span>
            <span className="text-[10px] font-mono text-slate-400">{fmtINR(totalCall)}</span>
          </div>
        )}
      </div>

      <p className="text-[9px] text-slate-700 mt-2 border-t border-slate-800/60 pt-1.5">
        * Illustrative. Actual per Port Schedule of Rates & Charges.
      </p>
    </div>
  );
}

// ── Root Export ────────────────────────────────────────────────────────────────

export function VesselFlowAnalysis({ vesselId }: { vesselId: string }) {
  const vessels   = useSimulationStore(s => s.vessels);
  const isLoading = useSimulationStore(s => s.isLoading);
  const vessel    = vessels.find(v => v.id === vesselId);

  if (isLoading && !vessel) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Loading simulation state…
        </div>
      </div>
    );
  }

  if (!vessel) {
    return (
      <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Vessel Not Found</h3>
        <p className="text-xs text-slate-500 mb-2">
          Vessel{' '}
          <code className="font-mono text-cyan-400 bg-slate-900 px-1 rounded">{vesselId}</code>{' '}
          is not currently active in the simulation.
        </p>
        <p className="text-[10px] text-slate-600">
          It may have departed, been removed, or the simulation has not loaded yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <VesselHeader vessel={vessel} />
      <LifecycleStrip vessel={vessel} />
      <VesselMiniMap vesselId={vesselId} height={270} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <CargoFlowCard vessel={vessel} vesselId={vesselId} />
        <CarbonCard vessel={vessel} />
        <BerthCard vessel={vessel} vesselId={vesselId} />
        <FinancialCard vessel={vessel} vesselId={vesselId} />
      </div>
      <AssignedTrucks vessel={vessel} vesselId={vesselId} />
      <EventTimeline vesselId={vesselId} />
    </div>
  );
}
