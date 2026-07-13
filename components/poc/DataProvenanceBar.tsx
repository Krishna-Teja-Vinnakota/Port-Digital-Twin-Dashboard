/**
 * DataProvenanceBar — pre-bid POC: show what is live vs simulated without DevTools.
 */

'use client';

import { useSimulationStore } from '@/store/useSimulationStore';

function ModeBadge({ mode }: { mode: string }) {
  const style =
    mode === 'LIVE'
      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
      : mode === 'MERGED'
        ? 'bg-cyan-950/80 text-cyan-200 border border-cyan-700/50'
        : mode === 'MIXED'
          ? 'bg-amber-950/80 text-amber-200 border border-amber-700/50'
          : 'bg-slate-800 text-slate-400 border border-slate-600/50';
  return <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded ${style}`}>{mode}</span>;
}

export function DataProvenanceBar() {
  const d = useSimulationStore((s) => s.dataProvenance);
  if (!d) {
    return (
      <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800/80 text-[10px] text-slate-500">
        Data sources: loading…
      </div>
    );
  }

  return (
    <div className="px-3 py-1.5 bg-slate-950/90 border-b border-slate-800/80 text-[10px] text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-slate-500 font-semibold uppercase tracking-wide shrink-0">Data</span>
      <span className="inline-flex items-center gap-1">
        <span className="text-slate-500">Vessels</span>
        <ModeBadge mode={d.vessels.mode} />
        <span className="text-slate-600 hidden sm:inline" title={d.vessels.detail}>({d.vessels.detail})</span>
      </span>
      <span className="text-slate-600">|</span>
      <span className="inline-flex items-center gap-1">
        <span className="text-slate-500">Trucks</span>
        <ModeBadge mode={d.trucks.mode} />
        <span className="text-slate-600 hidden md:inline" title={d.trucks.detail}>({d.trucks.detail})</span>
      </span>
      <span className="text-slate-600">|</span>
      <span className="inline-flex items-center gap-1">
        <span className="text-slate-500">TOS/TEU</span>
        <ModeBadge mode={d.tosManifest.mode} />
      </span>
      <span className="text-slate-600">|</span>
      <span className="inline-flex items-center gap-1">
        <span className="text-slate-500">KPIs</span>
        <ModeBadge mode={d.kpi.mode} />
      </span>
      <span className="text-slate-600 hidden lg:inline">|</span>
      <span
        className="hidden lg:inline text-slate-500 max-w-[280px] truncate"
        title={`AQI: ${d.environment.aqi} · NDVI: ${d.environment.ndvi} · Water: ${d.environment.water}`}
      >
        Env: mixed (AQI/NDVI/water — see Environment tab)
      </span>
    </div>
  );
}
