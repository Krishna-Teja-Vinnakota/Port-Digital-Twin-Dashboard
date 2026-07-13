/**
 * EntityDeepDive — rich entity inspector + event timeline.
 * Shows vessel/truck/gate metadata + scenario impact + state history.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSimulationStore } from '@/store/useSimulationStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Ship, Truck, Clock, Filter, Gauge, AlertTriangle, Container, ExternalLink } from 'lucide-react';

// ── small helpers ─────────────────────────────────────────────────────────────

function StatRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`text-[10px] font-semibold ${color ?? 'text-slate-200'}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mt-2 mb-1 border-t border-slate-800/60 pt-1.5">
      {label}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EntityDeepDive() {
  const { eventLog, vessels, trucks, gates, selectedEntity, activeScenarioIds, kpis } =
    useSimulationStore();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (selectedEntity?.id) setQuery(selectedEntity.id);
  }, [selectedEntity?.id, selectedEntity?.type]);

  const entityId = (query.trim() || selectedEntity?.id || '').trim();
  const kind = useMemo<'vessel' | 'truck' | 'gate'>(() => {
    if (selectedEntity?.type === 'gate') return 'gate';
    if (selectedEntity?.type === 'vessel' || /^V/i.test(entityId) || entityId.startsWith('AIS-')) return 'vessel';
    if (selectedEntity?.type === 'truck' || /^TRK-/i.test(entityId)) return 'truck';
    return 'vessel';
  }, [entityId, selectedEntity?.type]);

  const filtered = useMemo(() => {
    if (!entityId) return [];
    return eventLog.filter(e => e.entityId === entityId || e.entityId.toLowerCase() === entityId.toLowerCase());
  }, [eventLog, entityId]);

  // ── Entity-specific metadata ────────────────────────────────────────────
  const vessel = useMemo(() => vessels.find(x => x.id === entityId), [vessels, entityId]);
  const truck  = useMemo(() => trucks.find(x => x.id === entityId), [trucks, entityId]);
  const gate   = useMemo(() => gates.find(x => x.id === parseInt(entityId, 10)), [gates, entityId]);

  const entityLabel = (vessel?.name ?? truck?.plateNumber ?? (gate ? gate.name : null) ?? entityId) || '—';
  const entitySub   = vessel?.lifecycleState
    ?? truck?.state
    ?? (gate ? `${gate.status} · ${gate.congestionLevel}` : null)
    ?? 'Select or click a map marker';

  // Scenario impact flag — crane breakdown
  const craneBreakdown = activeScenarioIds?.includes('crane_breakdown') && vessel != null;
  const isCraneVessel  = craneBreakdown && vessel?.assignedCranes === 1;

  return (
    <div className="flex flex-col gap-1.5 h-full min-h-0 p-2 border-b border-slate-800/80">
      {/* Header */}
      <div className="flex items-center gap-2 text-slate-400 text-[10px] uppercase font-semibold tracking-wider">
        {kind === 'vessel' ? <Ship className="w-3.5 h-3.5" /> : kind === 'truck' ? <Truck className="w-3.5 h-3.5" /> : <Gauge className="w-3.5 h-3.5" />}
        Entity Deep-Dive
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-slate-950/80 border border-slate-700/60 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-600/50"
          placeholder="V001, TRK-0001, Gate 1"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="shrink-0 px-2 py-1.5 rounded-lg border border-slate-700/60 text-slate-400 hover:text-slate-200"
          title="Use selected from map"
          onClick={() => { if (selectedEntity) setQuery(selectedEntity.id); }}
        >
          <Filter className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Entity name + current state chip */}
      <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 px-2 py-1.5">
        <p className="text-xs font-semibold text-slate-100 truncate">{entityLabel}</p>
        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{entitySub}</p>
        {isCraneVessel && (
          <div className="flex items-center gap-1 mt-1">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[9px] text-red-400 font-semibold">CRANE BREAKDOWN — 1 crane active</span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-[80px] pr-1">
        {/* ── Vessel details ─────────────────────────────────────────────── */}
        {vessel && (
          <div className="space-y-0.5">
            <SectionHeader label="Vessel" />
            <StatRow label="Type"       value={vessel.type} />
            <StatRow label="Flag"       value={vessel.flag ?? '—'} />
            <StatRow label="DWT"        value={`${vessel.dwt.toLocaleString()} t`} />
            <StatRow label="Lifecycle"  value={vessel.lifecycleState}
              color={vessel.lifecycleState === 'LOADING' ? 'text-green-400' : vessel.lifecycleState === 'ANCHORED' ? 'text-amber-400' : 'text-slate-200'} />
            <StatRow label="Wait"       value={`${vessel.waitHours.toFixed(1)} hrs`}
              color={vessel.waitHours > 3 ? 'text-red-400' : 'text-slate-200'} />
            {vessel.berthNumber && <StatRow label="Berth" value={vessel.berthNumber} />}
            {vessel.teuEstimate && (
              <StatRow label="Est. TEU" value={`~${vessel.teuEstimate.value.toLocaleString()}`} color="text-cyan-300" />
            )}
            <StatRow label="Cranes"     value={vessel.assignedCranes}
              color={vessel.assignedCranes === 1 ? 'text-red-400' : 'text-slate-200'} />
            <StatRow label="Pilot"      value={vessel.pilotAssigned ? 'Assigned' : 'Pending'}
              color={vessel.pilotAssigned ? 'text-green-400' : 'text-amber-400'} />
            <StatRow label="Emissions"  value={`${vessel.emissionsRate.toFixed(2)} t CO₂/hr`}
              color={vessel.emissionsRate > 2 ? 'text-orange-400' : 'text-slate-200'} />

            {activeScenarioIds?.length > 0 && (
              <>
                <SectionHeader label="Active Scenarios" />
                {activeScenarioIds.map(id => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="text-[10px] text-amber-300">{id.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </>
            )}

            <div className="mt-2 pt-2 border-t border-slate-800/60">
              <Link
                href={`/analysis/vessel/${encodeURIComponent(entityId)}`}
                className="flex items-center justify-center gap-1.5 w-full px-2 py-1.5 text-[10px] font-medium text-cyan-400 border border-cyan-800/50 rounded-lg hover:bg-cyan-950/30 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Full Flow Analysis →
              </Link>
            </div>
          </div>
        )}

        {/* ── Truck details ──────────────────────────────────────────────── */}
        {truck && (
          <div className="space-y-0.5">
            <SectionHeader label="Truck" />
            <StatRow label="State"       value={truck.state}
              color={truck.state === 'GATE_QUEUE' ? 'text-red-400' : truck.state === 'LOADING_UNLOADING' ? 'text-green-400' : 'text-slate-200'} />
            <StatRow label="Cargo"       value={truck.cargoType} />
            <StatRow label="Destination" value={truck.destination} />
            {truck.assignedContainer && <StatRow label="Container" value={truck.assignedContainer} color="text-cyan-300" />}
            {truck.entryTimestamp && <StatRow label="Entry" value={new Date(truck.entryTimestamp).toLocaleTimeString()} />}
          </div>
        )}

        {/* ── Gate details ───────────────────────────────────────────────── */}
        {gate && (
          <div className="space-y-0.5">
            <SectionHeader label="Gate" />
            <StatRow label="Status"    value={gate.status}
              color={gate.status === 'CLOSED' ? 'text-red-400' : 'text-green-400'} />
            <StatRow label="Queue"     value={`${gate.queueLength} trucks`}
              color={gate.queueLength >= 50 ? 'text-red-400' : gate.queueLength >= 25 ? 'text-amber-400' : 'text-slate-200'} />
            <StatRow label="Congestion" value={gate.congestionLevel}
              color={gate.congestionLevel === 'HIGH' ? 'text-red-400' : gate.congestionLevel === 'MEDIUM' ? 'text-amber-400' : 'text-green-400'} />
            <StatRow label="Processed Today" value={`${gate.trucksTodayProcessed} trucks`} />
            <StatRow label="Avg Processing"  value={`${gate.avgProcessingTimeMins} min`} />
          </div>
        )}

        {/* ── Port-wide context (when nothing selected) ──────────────────── */}
        {!vessel && !truck && !gate && kpis && (
          <div className="space-y-0.5">
            <SectionHeader label="Port Overview" />
            <StatRow label="Vessel TAT"        value={`${kpis.avgVesselTAT?.toFixed(1)} hrs`} />
            <StatRow label="Berth Occupancy"   value={`${kpis.berthOccupancy?.toFixed(0)}%`} />
            <StatRow label="Gate Congestion"   value={kpis.gateCongestionLevel ?? '—'} />
            <StatRow label="Carbon Index"      value={kpis.carbonIndex ?? '—'}
              color={kpis.carbonIndex === 'HIGH' ? 'text-red-400' : kpis.carbonIndex === 'MODERATE' ? 'text-amber-400' : 'text-green-400'} />
            <StatRow label="Crane Moves/hr"    value={`${kpis.craneMoves?.toFixed(0) ?? 0}`} />
            <p className="text-[10px] text-slate-600 mt-2">Click any vessel, truck, or gate marker on the map to inspect it.</p>
          </div>
        )}

        {/* ── Event timeline ─────────────────────────────────────────────── */}
        {entityId && (
          <>
            <SectionHeader label={`State Timeline (${filtered.length} events)`} />
            {filtered.length === 0 ? (
              <p className="text-[10px] text-slate-600 py-1">No transitions recorded yet. Events appear as simulation ticks advance.</p>
            ) : (
              <ol className="space-y-1.5 border-l border-slate-700/50 ml-1.5 pl-3 mt-1">
                {filtered.slice(-40).map(e => (
                  <li key={e.id} className="text-[10px] text-slate-400 relative">
                    <span className="absolute -left-[15px] top-1 w-2 h-2 rounded-full bg-cyan-600/80" />
                    <span className="text-cyan-500/90 font-mono">t+{e.simTime}m</span>
                    <div className="text-slate-300 mt-0.5">{e.fromState} → {e.toState}</div>
                    {e.reason && <div className="text-slate-600">{e.reason}</div>}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </ScrollArea>

      <p className="text-[9px] text-slate-600 flex items-center gap-1 shrink-0">
        <Clock className="w-3 h-3" />
        Sim clock in minutes · click map marker to auto-select
      </p>
    </div>
  );
}
