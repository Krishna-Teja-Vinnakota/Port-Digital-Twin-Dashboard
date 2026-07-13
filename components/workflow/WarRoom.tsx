'use client';

/**
 * WarRoom — 5-step guided what-if analysis workflow.
 * Step 1: Select up to 2 vessels
 * Step 2: Capture KPI baseline
 * Step 3: Apply what-if scenario
 * Step 4: View impact analysis (KPI delta + vessel flow)
 * Step 5: Get AI recommendations
 */

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSimulationStore } from '@/store/useSimulationStore';
import { VesselFlowAnalysis } from '@/components/analysis/VesselFlowAnalysis';

const VesselMiniMap = dynamic(
  () => import('@/components/map/VesselMiniMap').then(m => ({ default: m.VesselMiniMap })),
  { ssr: false, loading: () => null },
);
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Shield, ArrowLeft, ArrowRight, Check, Ship,
  CloudRain, Wrench, Truck as TruckIcon, Container,
  Brain, Loader2, AlertTriangle, ChevronDown, ChevronUp,
  Swords,
} from 'lucide-react';
import type { SimVessel, SimKPIs, ScenarioId } from '@/lib/simulationTypes';

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5;

interface AIResult {
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
}

// ── Scenario definitions ────────────────────────────────────────────────────────

interface ScenarioDef {
  id: ScenarioId;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const SCENARIOS: ScenarioDef[] = [
  {
    id: 'heavy_rain',
    label: 'Heavy Rain',
    description: 'Slower gate & yard operations (+35% timing)',
    icon: <CloudRain className="w-4 h-4" />,
    color: '#38bdf8',
  },
  {
    id: 'crane_breakdown',
    label: 'Crane Breakdown',
    description: 'One LOADING vessel reduced to 1 STS crane',
    icon: <Wrench className="w-4 h-4" />,
    color: '#a78bfa',
  },
  {
    id: 'truck_inbound_surge',
    label: 'Truck Surge',
    description: 'Higher truck arrival rate → gate congestion',
    icon: <TruckIcon className="w-4 h-4" />,
    color: '#f97316',
  },
  {
    id: 'yard_near_saturation',
    label: 'Yard Saturation',
    description: 'Yard occupancy starts at ~90%',
    icon: <Container className="w-4 h-4" />,
    color: '#f59e0b',
  },
];

// ── Vessel state colors ────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  APPROACHING: '#3b82f6',
  ANCHORED:    '#f59e0b',
  BERTHING:    '#38bdf8',
  LOADING:     '#22c55e',
  DEPARTING:   '#94a3b8',
};

const STATE_PRIORITY: Record<string, number> = {
  LOADING: 0, BERTHING: 1, ANCHORED: 2, APPROACHING: 3, DEPARTING: 4,
};

// ── KPI delta helpers ──────────────────────────────────────────────────────────

interface KpiRow {
  label: string;
  before: number | string;
  after: number | string;
  unit: string;
  delta?: number;
  higherIsBetter?: boolean;
}

function buildKpiRows(baseline: SimKPIs, current: SimKPIs): KpiRow[] {
  function numRow(
    label: string,
    key: keyof SimKPIs,
    unit: string,
    higherIsBetter = false,
  ): KpiRow {
    const before = typeof baseline[key] === 'number' ? (baseline[key] as number) : 0;
    const after  = typeof current[key]  === 'number' ? (current[key]  as number) : 0;
    return { label, before, after, unit, delta: after - before, higherIsBetter };
  }

  return [
    numRow('Avg Vessel TAT',        'avgVesselTAT',          'hrs'),
    numRow('Pre-Berthing Detention','preBerthingDetention',   'hrs'),
    numRow('Berth Occupancy',       'berthOccupancy',        '%'),
    numRow('Gate Queue',            'gateQueueLength',       'trucks'),
    numRow('Yard Occupancy',        'yardOccupancyPct',      '%'),
    numRow('TEU Throughput',        'throughputTEUPerHour',  'TEU/hr', true),
    numRow('Truck TAT',             'avgTruckTAT',           'min'),
    {
      label: 'Gate Congestion',
      before: baseline.gateCongestionLevel ?? '—',
      after:  current.gateCongestionLevel  ?? '—',
      unit:   '',
    },
  ];
}

function deltaColor(delta: number | undefined, higherIsBetter = false): string {
  if (delta === undefined || delta === 0) return 'text-slate-400';
  const worse = higherIsBetter ? delta < 0 : delta > 0;
  return worse ? 'text-red-400' : 'text-green-400';
}

function fmtDelta(delta: number | undefined, unit: string): string {
  if (delta === undefined || delta === 0) return '—';
  const sign = delta > 0 ? '+' : '';
  const val  = Math.abs(delta) >= 10 ? delta.toFixed(1) : delta.toFixed(2);
  return `${sign}${val} ${unit}`.trim();
}

// ── Stepper ────────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<Step, string> = {
  1: 'Select Vessels',
  2: 'Capture Baseline',
  3: 'Apply Scenario',
  4: 'Impact Analysis',
  5: 'AI Recommendations',
};

function Stepper({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-0 py-4 px-6 overflow-x-auto">
      {([1, 2, 3, 4, 5] as Step[]).map((step, idx) => {
        const done   = step < current;
        const active = step === current;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center shrink-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all"
                style={{
                  background:   done ? '#0e7490' : active ? '#164e63' : '#0f172a',
                  borderColor:  done || active ? '#22d3ee' : '#1e293b',
                  color:        done || active ? '#e2e8f0' : '#475569',
                }}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : step}
              </div>
              <span
                className="text-[9px] font-medium mt-1 whitespace-nowrap hidden sm:block"
                style={{ color: active ? '#22d3ee' : done ? '#94a3b8' : '#475569' }}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {idx < 4 && (
              <div
                className="h-px w-8 sm:w-16 mx-1 mt-[-14px] shrink-0 transition-all"
                style={{ background: done ? '#0e7490' : '#1e293b' }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Step 1: Select Vessels ─────────────────────────────────────────────────────

function VesselCard({
  vessel,
  selected,
  disabled,
  onToggle,
}: {
  vessel: SimVessel;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const color = STATE_COLORS[vessel.lifecycleState] ?? '#94a3b8';
  return (
    <button
      onClick={onToggle}
      disabled={disabled && !selected}
      className="text-left w-full rounded-xl p-3 transition-all"
      style={{
        background:   selected ? `${color}12` : '#0a0f1e',
        border:       `${selected ? 2 : 1}px solid ${selected ? color : '#1e293b'}`,
        boxShadow:    selected ? `0 0 16px ${color}18` : undefined,
        opacity:      disabled && !selected ? 0.4 : 1,
        cursor:       disabled && !selected ? 'not-allowed' : 'pointer',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Ship className="w-3.5 h-3.5 shrink-0" style={{ color }} />
          <span className="text-xs font-semibold text-slate-100 truncate">{vessel.name}</span>
        </div>
        {selected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color }} />}
      </div>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: `${color}22`, color }}
        >
          {vessel.lifecycleState}
        </span>
        <span className="text-[9px] text-slate-500">{vessel.type}</span>
        {vessel.berthNumber && (
          <span className="text-[9px] text-slate-400 font-mono">Berth {vessel.berthNumber}</span>
        )}
        <span className="text-[9px] text-slate-600">DWT {(vessel.dwt / 1000).toFixed(0)}K</span>
      </div>
    </button>
  );
}

function Step1({
  selectedIds,
  onToggle,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const vessels = useSimulationStore(s => s.vessels);
  const [search, setSearch] = useState('');

  const sorted = useMemo(
    () =>
      [...vessels]
        .filter(v => v.lifecycleState !== 'REMOVED')
        .filter(v =>
          search.trim() === '' ||
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          v.id.toLowerCase().includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            (STATE_PRIORITY[a.lifecycleState] ?? 5) - (STATE_PRIORITY[b.lifecycleState] ?? 5),
        ),
    [vessels, search],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-100">Select Vessels for Analysis</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Pick up to 2 vessels. The workflow will track their journey through the what-if scenario.
        </p>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-500">Selected:</span>
          {selectedIds.map(id => {
            const v = vessels.find(x => x.id === id);
            const c = STATE_COLORS[v?.lifecycleState ?? ''] ?? '#94a3b8';
            return (
              <span
                key={id}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: `${c}22`, color: c, border: `1px solid ${c}44` }}
              >
                {v?.name ?? id}
              </span>
            );
          })}
        </div>
      )}

      <input
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-600/50"
        placeholder="Search by name or ID…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <ScrollArea className="h-[380px] pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {sorted.map(v => (
            <VesselCard
              key={v.id}
              vessel={v}
              selected={selectedIds.includes(v.id)}
              disabled={selectedIds.length >= 2}
              onToggle={() => onToggle(v.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Step 2: Capture Baseline ───────────────────────────────────────────────────

const KPI_DISPLAY = [
  { key: 'avgVesselTAT',         label: 'Avg Vessel TAT',         unit: 'hrs' },
  { key: 'preBerthingDetention', label: 'Pre-Berthing Detention',  unit: 'hrs' },
  { key: 'berthOccupancy',       label: 'Berth Occupancy',         unit: '%'   },
  { key: 'gateQueueLength',      label: 'Gate Queue',              unit: 'trucks' },
  { key: 'yardOccupancyPct',     label: 'Yard Occupancy',          unit: '%'   },
  { key: 'throughputTEUPerHour', label: 'TEU Throughput',          unit: 'TEU/hr' },
  { key: 'avgTruckTAT',          label: 'Avg Truck TAT',           unit: 'min' },
  { key: 'gateCongestionLevel',  label: 'Gate Congestion',         unit: ''    },
] as const;

function Step2({
  captured,
  baselineKpis,
  baselineSimTime,
  onCapture,
}: {
  captured: boolean;
  baselineKpis: SimKPIs | null;
  baselineSimTime: number;
  onCapture: () => void;
}) {
  const kpis    = useSimulationStore(s => s.kpis);
  const simTime = useSimulationStore(s => s.simTime);
  const display = kpis ?? baselineKpis;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-100">Capture KPI Baseline</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Snapshot the current port KPIs before applying any scenario — this gives you a before/after
          comparison in Step 4.
        </p>
      </div>

      {captured && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-950/40 border border-green-700/40 rounded-lg">
          <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
          <span className="text-xs text-green-300 font-medium">
            Baseline captured at simulation clock t+{baselineSimTime}m
          </span>
        </div>
      )}

      {display && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {KPI_DISPLAY.map(k => {
            const val = display[k.key as keyof SimKPIs];
            return (
              <div
                key={k.key}
                className="bg-[#0a0f1e]/80 border border-slate-700/40 rounded-lg p-3"
              >
                <p className="text-[9px] text-slate-500 font-medium uppercase tracking-wide">
                  {k.label}
                </p>
                <p className="text-sm font-bold text-slate-100 mt-1">
                  {typeof val === 'number' ? val.toFixed(1) : String(val ?? '—')}
                  {k.unit && <span className="text-[10px] text-slate-500 ml-1">{k.unit}</span>}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {!captured && (
        <button
          onClick={onCapture}
          className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-cyan-900/40 border border-cyan-700/60 text-cyan-300 hover:bg-cyan-800/40 transition-colors"
        >
          Capture Baseline Now (t+{simTime}m)
        </button>
      )}
    </div>
  );
}

// ── Step 3: Apply Scenario ─────────────────────────────────────────────────────

function Step3({
  appliedId,
  onApply,
  isApplying,
  onSkip,
}: {
  appliedId: ScenarioId | null;
  onApply: (id: ScenarioId) => void;
  isApplying: boolean;
  onSkip: () => void;
}) {
  const activeScenarioIds = useSimulationStore(s => s.activeScenarioIds);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-100">Apply What-If Scenario</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Choose a disruption scenario to simulate. The KPI delta in Step 4 will show the impact
          against the baseline you captured.
        </p>
      </div>

      {activeScenarioIds.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/40 border border-amber-700/40 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300 font-medium">
            Active scenarios: {activeScenarioIds.join(', ')}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SCENARIOS.map(s => {
          const active = appliedId === s.id || activeScenarioIds.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onApply(s.id)}
              disabled={isApplying}
              className="text-left p-4 rounded-xl border transition-all"
              style={{
                background:  active ? `${s.color}15` : '#0a0f1e',
                borderColor: active ? s.color : '#1e293b',
                boxShadow:   active ? `0 0 16px ${s.color}18` : undefined,
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span style={{ color: s.color }}>{s.icon}</span>
                <span className="text-xs font-semibold text-slate-100">{s.label}</span>
                {active && <Check className="w-3 h-3 ml-auto" style={{ color: s.color }} />}
              </div>
              <p className="text-[10px] text-slate-500">{s.description}</p>
            </button>
          );
        })}
      </div>

      <button
        onClick={onSkip}
        className="text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
      >
        Skip — proceed without a scenario
      </button>
    </div>
  );
}

// ── Step 4: Impact Analysis ────────────────────────────────────────────────────

function Step4({
  selectedVesselIds,
  baselineKpis,
}: {
  selectedVesselIds: string[];
  baselineKpis: SimKPIs | null;
}) {
  const kpis      = useSimulationStore(s => s.kpis);
  const [expanded, setExpanded] = useState<string | null>(selectedVesselIds[0] ?? null);

  const rows = useMemo(
    () => (baselineKpis && kpis ? buildKpiRows(baselineKpis, kpis) : []),
    [baselineKpis, kpis],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-100">Impact Analysis</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          KPI delta vs your captured baseline, plus full flow analysis for each selected vessel.
        </p>
      </div>

      {/* Live mini-maps — one per selected vessel, side-by-side when 2 selected */}
      {selectedVesselIds.length > 0 && (
        <div
          className={`grid gap-3 ${selectedVesselIds.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
        >
          {selectedVesselIds.map(id => (
            <VesselMiniMap key={id} vesselId={id} height={220} />
          ))}
        </div>
      )}

      {/* KPI delta table */}
      {rows.length > 0 ? (
        <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
            KPI Delta — Baseline vs Current
          </p>
          <div className="space-y-1">
            <div className="grid grid-cols-4 gap-2 pb-1 border-b border-slate-800">
              {['Metric', 'Baseline', 'Current', 'Change'].map(h => (
                <span key={h} className="text-[9px] font-bold uppercase text-slate-600">{h}</span>
              ))}
            </div>
            {rows.map(r => (
              <div key={r.label} className="grid grid-cols-4 gap-2 py-0.5">
                <span className="text-[10px] text-slate-400">{r.label}</span>
                <span className="text-[10px] font-mono text-slate-300">
                  {typeof r.before === 'number' ? r.before.toFixed(1) : r.before}
                  {r.unit && <span className="text-slate-600 ml-0.5">{r.unit}</span>}
                </span>
                <span className="text-[10px] font-mono text-slate-200">
                  {typeof r.after === 'number' ? r.after.toFixed(1) : r.after}
                  {r.unit && <span className="text-slate-600 ml-0.5">{r.unit}</span>}
                </span>
                <span className={`text-[10px] font-mono font-semibold ${deltaColor(r.delta, r.higherIsBetter)}`}>
                  {r.delta !== undefined ? fmtDelta(r.delta, r.unit) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-600 px-1">
          No baseline captured — showing live data only. Go back to Step 2 to capture a baseline.
        </div>
      )}

      {/* Vessel flow analysis, collapsible per vessel */}
      <div className="space-y-3">
        {selectedVesselIds.map(id => (
          <div key={id} className="border border-slate-700/50 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(prev => (prev === id ? null : id))}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/60 hover:bg-slate-800/60 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-200">
                Vessel Flow — {id}
              </span>
              {expanded === id
                ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </button>
            {expanded === id && (
              <div className="p-3 bg-[#050810]">
                <VesselFlowAnalysis vesselId={id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 5: AI Recommendations ─────────────────────────────────────────────────

function Step5({
  selectedVesselIds,
  appliedScenarioId,
  baselineKpis,
}: {
  selectedVesselIds: string[];
  appliedScenarioId: ScenarioId | null;
  baselineKpis: SimKPIs | null;
}) {
  const vessels   = useSimulationStore(s => s.vessels);
  const kpis      = useSimulationStore(s => s.kpis);
  const [result,     setResult]     = useState<AIResult | null>(null);
  const [isLoading,  setIsLoading]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const selectedVessels = selectedVesselIds
    .map(id => vessels.find(v => v.id === id))
    .filter(Boolean) as SimVessel[];

  const scenarioDef = SCENARIOS.find(s => s.id === appliedScenarioId);

  const prompt = useMemo(() => {
    const vesselLines = selectedVessels.map(v =>
      `- ${v.name} (${v.type}, ${v.lifecycleState}${v.berthNumber ? `, Berth ${v.berthNumber}` : ''}, ` +
      `Wait: ${v.waitHours.toFixed(1)} hrs, Cranes: ${v.assignedCranes}, Emissions: ${v.emissionsRate.toFixed(2)} t CO₂/hr)`
    ).join('\n');

    const kpiLines = kpis && baselineKpis
      ? buildKpiRows(baselineKpis, kpis)
          .filter(r => r.delta !== undefined && Math.abs(r.delta) > 0.01)
          .map(r => `  ${r.label}: ${typeof r.before === 'number' ? r.before.toFixed(1) : r.before}${r.unit} → ${typeof r.after === 'number' ? r.after.toFixed(1) : r.after}${r.unit} (${fmtDelta(r.delta, r.unit)})`)
          .join('\n')
      : '  No baseline comparison available.';

    return `Port Authority scenario analysis — Port Digital Twin

Selected vessels:
${vesselLines || '  None selected.'}

${appliedScenarioId
  ? `Active scenario: ${scenarioDef?.label ?? appliedScenarioId} — ${scenarioDef?.description ?? ''}`
  : 'No scenario applied — normal operating conditions.'}

KPI impact vs baseline:
${kpiLines}

As Port Authority at Port, what immediate operational actions should be taken to minimize disruption? Provide specific, prioritised recommendations.`;
  }, [selectedVessels, appliedScenarioId, kpis, baselineKpis, scenarioDef]);

  async function getAdvice() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages:  [{ role: 'user', content: prompt }],
          context:   { vessels: selectedVessels, kpis, scenario: appliedScenarioId },
          userRole:  'Port Authority',
        }),
      });
      const data = (await res.json()) as AIResult;
      setResult(data);
    } catch {
      setError('Failed to reach AI advisor. Check your connection and retry.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-100">AI Recommendations</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          The Gemini AI advisor will analyse the scenario impact and provide prioritised actions.
        </p>
      </div>

      {/* Prompt preview */}
      <details className="group">
        <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300 transition-colors list-none flex items-center gap-1">
          <span className="group-open:hidden">▶ Show prompt sent to AI</span>
          <span className="hidden group-open:inline">▼ Hide prompt</span>
        </summary>
        <pre className="mt-2 text-[9px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg p-3 whitespace-pre-wrap font-mono overflow-x-auto max-h-40">
          {prompt}
        </pre>
      </details>

      {!result && !isLoading && (
        <button
          onClick={getAdvice}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold bg-cyan-900/40 border border-cyan-700/60 text-cyan-300 hover:bg-cyan-800/50 transition-colors"
        >
          <Brain className="w-4 h-4" />
          Get AI Recommendations
        </button>
      )}

      {isLoading && (
        <div className="flex items-center gap-3 py-6 justify-center">
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          <span className="text-sm text-slate-400">Analysing with Gemini 2.5 Pro…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/40 border border-red-700/40 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-xs text-red-300">{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <div
            className="px-4 py-3 rounded-xl border"
            style={{
              background: result.severity === 'HIGH' ? '#450a0a40' : result.severity === 'MEDIUM' ? '#431407aa' : '#052e1640',
              borderColor: result.severity === 'HIGH' ? '#991b1b' : result.severity === 'MEDIUM' ? '#92400e' : '#065f46',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                AI Summary
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: result.severity === 'HIGH' ? '#991b1b55' : '#92400e55',
                    color:      result.severity === 'HIGH' ? '#fca5a5'   : '#fcd34d',
                  }}
                >
                  {result.severity}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">{result.summary}</p>
          </div>

          {/* KPI impact from AI */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'TAT Delta',      val: result.impact.tat_delta },
              { label: 'Congestion',     val: result.impact.congestion_change },
              { label: 'Carbon Delta',   val: result.impact.carbon_delta },
              { label: 'Affected Vessels', val: String(result.impact.affected_vessels) },
            ].map(item => (
              <div
                key={item.label}
                className="bg-[#0a0f1e]/80 border border-slate-700/40 rounded-lg p-3"
              >
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">{item.label}</p>
                <p className="text-sm font-bold text-slate-100 mt-1 truncate">{item.val}</p>
              </div>
            ))}
          </div>

          {/* Recommendations */}
          <div className="bg-[#0a0f1e]/80 border border-slate-700/50 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
              Prioritised Recommendations
            </p>
            <ol className="space-y-2">
              {result.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-950/60 border border-cyan-700/40 flex items-center justify-center text-[9px] font-bold text-cyan-400 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">{rec}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={getAdvice}
              className="text-xs text-slate-500 hover:text-cyan-400 underline transition-colors"
            >
              Re-run analysis
            </button>
            <Link
              href="/"
              className="text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
            >
              Back to ICCC Dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main WarRoom ───────────────────────────────────────────────────────────────

export function WarRoom() {
  const kpis    = useSimulationStore(s => s.kpis);
  const simTime = useSimulationStore(s => s.simTime);

  const [step,               setStep]               = useState<Step>(1);
  const [selectedVesselIds,  setSelectedVesselIds]  = useState<string[]>([]);
  const [baselineKpis,       setBaselineKpis]       = useState<SimKPIs | null>(null);
  const [baselineSimTime,    setBaselineSimTime]     = useState<number>(0);
  const [baselineCaptured,   setBaselineCaptured]   = useState(false);
  const [appliedScenarioId,  setAppliedScenarioId]  = useState<ScenarioId | null>(null);
  const [isApplyingScenario, setIsApplyingScenario] = useState(false);

  function toggleVessel(id: string) {
    setSelectedVesselIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : prev,
    );
  }

  function captureBaseline() {
    if (!kpis) return;
    setBaselineKpis({ ...kpis });
    setBaselineSimTime(simTime);
    setBaselineCaptured(true);
  }

  async function applyScenario(id: ScenarioId) {
    setIsApplyingScenario(true);
    try {
      const res = await fetch('/api/simulation/action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'APPLY_SCENARIO', scenarioId: id }),
      });
      const data = await res.json();
      if (data.success) {
        setAppliedScenarioId(id);
        if (data.updatedState) {
          useSimulationStore.getState().hydrateFromState(data.updatedState);
        }
      }
    } finally {
      setIsApplyingScenario(false);
    }
  }

  function skipScenario() {
    setStep(4);
  }

  // Navigation guards
  const canNext: Record<Step, boolean> = {
    1: selectedVesselIds.length >= 1,
    2: baselineCaptured,
    3: appliedScenarioId !== null,
    4: true,
    5: true,
  };

  function next() { if (step < 5 && canNext[step]) setStep((step + 1) as Step); }
  function prev() { if (step > 1) setStep((step - 1) as Step); }

  return (
    <div className="h-screen bg-[#050810] text-slate-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-[#0a0f1e]/95 border-b border-slate-700/60 backdrop-blur-sm px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-950 border border-cyan-700/50 shrink-0">
          <Shield className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          ICCC Dashboard
        </Link>
        <span className="text-slate-700">·</span>
        <div className="flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs text-slate-200 font-semibold">War Room</span>
        </div>
        <span className="text-slate-700 hidden sm:inline">·</span>
        <span className="text-[10px] text-slate-500 hidden sm:inline">
          Guided What-If Analysis
        </span>
      </header>

      {/* Stepper */}
      <div className="bg-[#0a0f1e]/60 border-b border-slate-800/60 shrink-0">
        <Stepper current={step} />
      </div>

      {/* Step content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {step === 1 && (
            <Step1 selectedIds={selectedVesselIds} onToggle={toggleVessel} />
          )}
          {step === 2 && (
            <Step2
              captured={baselineCaptured}
              baselineKpis={baselineKpis}
              baselineSimTime={baselineSimTime}
              onCapture={captureBaseline}
            />
          )}
          {step === 3 && (
            <Step3
              appliedId={appliedScenarioId}
              onApply={applyScenario}
              isApplying={isApplyingScenario}
              onSkip={skipScenario}
            />
          )}
          {step === 4 && (
            <Step4
              selectedVesselIds={selectedVesselIds}
              baselineKpis={baselineKpis}
            />
          )}
          {step === 5 && (
            <Step5
              selectedVesselIds={selectedVesselIds}
              appliedScenarioId={appliedScenarioId}
              baselineKpis={baselineKpis}
            />
          )}
        </div>
      </main>

      {/* Navigation footer */}
      <footer className="bg-[#0a0f1e]/80 border-t border-slate-800/60 px-6 py-3 flex items-center justify-between shrink-0">
        <button
          onClick={prev}
          disabled={step === 1}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-700/50 text-slate-400 hover:text-slate-200 hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ArrowLeft className="w-3 h-3" />
          Back
        </button>

        <div className="text-[10px] text-slate-600">
          Step {step} of 5 · {STEP_LABELS[step]}
        </div>

        {step < 5 ? (
          <button
            onClick={next}
            disabled={!canNext[step]}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-900/50 border border-cyan-700/60 text-cyan-300 hover:bg-cyan-800/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {STEP_LABELS[(step + 1) as Step]}
            <ArrowRight className="w-3 h-3" />
          </button>
        ) : (
          <Link
            href="/"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800/60 border border-slate-600/50 text-slate-300 hover:bg-slate-700/60 transition-all"
          >
            Back to Dashboard
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </footer>
    </div>
  );
}
