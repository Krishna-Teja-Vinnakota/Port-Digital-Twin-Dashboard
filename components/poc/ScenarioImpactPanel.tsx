/**
 * Pre-bid POC: baseline vs current KPI delta + timing-matrix narration.
 */

'use client';

import { useSimulationStore } from '@/store/useSimulationStore';
import { buildDelayAttributionString, BASE_GATE_PROCESS } from '@/lib/timingMatrix';
import { Download, XCircle } from 'lucide-react';
import { useCallback } from 'react';
import type { PocDataStatus } from '@/lib/pocDataStatusTypes';
import type { SimKPIs, TimingProfile } from '@/lib/simulationTypes';
import { useRouter } from 'next/navigation';

function congToNum(c: string): number {
  if (c === 'HIGH') return 3;
  if (c === 'MEDIUM') return 2;
  return 1;
}

function formatDelta(
  key: string,
  cur: string | number | undefined,
  base: string | number | undefined,
): { line: string; up: 'good' | 'bad' | 'neutral' } {
  if (cur === undefined || base === undefined) {
    return { line: `${key}: —`, up: 'neutral' };
  }
  if (key === 'Congestion') {
    const d = congToNum(String(cur)) - congToNum(String(base));
    const up = d > 0 ? 'bad' : d < 0 ? 'good' : 'neutral';
    return { line: `Congestion: ${base} → ${cur}${d ? ` (Δ${d > 0 ? '+' : ''}${d})` : ''}`, up };
  }
  if (typeof cur === 'string' || typeof base === 'string') {
    return { line: `${key}: ${base} → ${cur}`, up: 'neutral' };
  }
  const delta = cur - base;
  const sign = delta > 0 ? '+' : '';
  const isHighBad = !['DPD %', 'DPE %'].includes(key);
  let up: 'good' | 'bad' | 'neutral' = 'neutral';
  if (Math.abs(delta) > 0.0001) {
    if (isHighBad) {
      up = delta > 0 ? 'bad' : 'good';
    } else {
      up = delta > 0 ? 'good' : 'bad';
    }
  }
  return { line: `${key}: ${base.toFixed?.(1) ?? base} → ${cur.toFixed?.(1) ?? cur} (${sign}${delta.toFixed(1)})`, up };
}

function timingNarration(tp: TimingProfile | null) {
  if (!tp) return 'Timing: —';
  if (!tp.appliedModifiers?.length) {
    return `Gate process: ${tp.gateProcess.toFixed(1)} min (no extra modifiers)`;
  }
  return buildDelayAttributionString(BASE_GATE_PROCESS, tp.gateProcess, tp.appliedModifiers);
}

function buildSnapshotCsv(
  d: PocDataStatus | null,
  kpis: SimKPIs | null,
  poc: { baselineKpis: SimKPIs | null; baselineLabel: string; activeScenarioIds: string[]; capturedAt: number } | null,
  tp: TimingProfile | null,
) {
  const t = new Date().toISOString();
  const rows: string[] = [
    'field,value',
    `exportedAt,${t}`,
    `dataVessels,${d?.vessels.mode ?? ''}`,
    `dataKpis,${d?.kpi.mode ?? ''}`,
    `baselineLabel,${poc?.baselineLabel ?? ''}`,
    `baselineCapturedAt,${poc ? new Date(poc.capturedAt).toISOString() : ''}`,
    `activeScenarios,${(poc?.activeScenarioIds ?? []).join(';')}`,
    `timingNarration,"${timingNarration(tp).replace(/"/g, '""')}"`,
  ];
  const keys: (keyof SimKPIs)[] = [
    'avgVesselTAT',
    'preBerthingDetention',
    'berthOccupancy',
    'trucksInGeoFence',
    'yardOccupancyPct',
    'gateQueueLength',
  ];
  for (const k of keys) {
    const cur = kpis?.[k];
    const b = poc?.baselineKpis?.[k];
    if (cur !== undefined) rows.push(`current_${String(k)},${cur}`);
    if (b !== undefined) rows.push(`baseline_${String(k)},${b}`);
  }
  if (kpis) rows.push(`gateCongestion,${kpis.gateCongestionLevel}`);
  if (poc?.baselineKpis) rows.push(`baseline_gateCongestion,${poc.baselineKpis.gateCongestionLevel}`);
  if (tp?.appliedModifiers) {
    rows.push(`timingModifiers,${JSON.stringify(tp.appliedModifiers).replace(/"/g, '""')}`);
  }
  return rows.join('\n');
}

export function ScenarioImpactPanel() {
  const kpis = useSimulationStore((s) => s.kpis);
  const timingProfile = useSimulationStore((s) => s.timingProfile);
  const pocSnapshot = useSimulationStore((s) => s.pocSnapshot);
  const dataProvenance = useSimulationStore((s) => s.dataProvenance);
  const clearPocSnapshot = useSimulationStore((s) => s.clearPocSnapshot);
  const router = useRouter();

  const onExport = useCallback(() => {
    const csv = buildSnapshotCsv(dataProvenance, kpis, pocSnapshot, timingProfile);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poc-snapshot-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [dataProvenance, kpis, pocSnapshot, timingProfile]);

  if (!pocSnapshot?.baselineKpis) {
    return (
      <div className="px-3 py-2 bg-slate-950/80 border-b border-slate-800/80 text-[10px] text-slate-500 flex items-center justify-between gap-2">
        <span>
          <span className="text-slate-400 font-medium">What-if impact:</span> apply a <strong>scenario</strong> below to capture a
          baseline and see KPI deltas.
        </span>
        <button
          type="button"
          onClick={() => router.push('/poc/snapshot')}
          className="shrink-0 text-cyan-500 hover:text-cyan-300"
        >
          Print snapshot
        </button>
      </div>
    );
  }

  const base = pocSnapshot.baselineKpis;
  if (!base || !kpis) return null;

  const lines = [
    formatDelta('TAT (hrs)', kpis.avgVesselTAT, base.avgVesselTAT),
    formatDelta('Pre-berth (hrs)', kpis.preBerthingDetention, base.preBerthingDetention),
    formatDelta('Berth %', kpis.berthOccupancy, base.berthOccupancy),
    formatDelta('Congestion', kpis.gateCongestionLevel, base.gateCongestionLevel),
    formatDelta('Trucks', kpis.trucksInGeoFence, base.trucksInGeoFence),
    formatDelta('Yard %', kpis.yardOccupancyPct, base.yardOccupancyPct),
    formatDelta('Gate queue', kpis.gateQueueLength, base.gateQueueLength),
  ];
  const narr = timingNarration(timingProfile);

  return (
    <div className="px-3 py-2 bg-slate-950/90 border-b border-cyan-900/30 text-[10px] text-slate-300">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-cyan-400 font-semibold shrink-0">Scenario impact</span>
          <span className="text-slate-500 truncate" title={pocSnapshot.baselineLabel}>
            vs {pocSnapshot.baselineLabel} · {pocSnapshot.activeScenarioIds.join(', ') || 'scenario active'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-800/60 text-cyan-300 hover:bg-cyan-950/50"
          >
            <Download className="w-3 h-3" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={clearPocSnapshot}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800/50"
            title="Clear comparison baseline"
          >
            <XCircle className="w-3 h-3" />
            Clear
          </button>
          <button
            type="button"
            onClick={() => router.push('/poc/snapshot')}
            className="text-cyan-500 hover:text-cyan-300"
          >
            Print
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-400 font-mono">
        {lines.map((x, i) => (
          <span
            key={i}
            className={x.up === 'bad' ? 'text-amber-300' : x.up === 'good' ? 'text-emerald-300' : 'text-slate-400'}
          >
            {x.line}
          </span>
        ))}
      </div>
      <p className="mt-1 text-slate-500 border-t border-slate-800/80 pt-1">{narr}</p>
    </div>
  );
}
