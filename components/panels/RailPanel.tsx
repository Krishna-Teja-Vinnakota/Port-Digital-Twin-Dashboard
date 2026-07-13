/**
 * RailPanel.tsx
 * Rail freight operations dashboard for Port Digital Twin.
 * Displays rake lifecycle timeline, siding utilization, and KPIs.
 */

'use client';

import { useEffect, useState } from 'react';
import { Brain as Train, RefreshCw, CircleCheck as CheckCircle, Clock, TriangleAlert as AlertTriangle } from 'lucide-react';

interface Rake {
  id: string;
  origin: string;
  currentStage: string;
  stageIndex: number;
  wagons: number;
  teus: number;
  eta: string;
  onTime: boolean;
  delayMinutes: number;
}

interface RailData {
  rakes: Rake[];
  sidingUtilization: { occupied: number; total: number; percent: number };
  kpis: {
    rakeTAT: number;
    shuntingDuration: number;
    timeToFirstCargoMovement: number;
    onTimePerformance: number;
    totalTEUsToday: number;
  };
}

const STAGES = ['ALLOCATED', 'IN_TRANSIT', 'PORT_ENTRY', 'SIDING', 'TERMINAL', 'EXIT'];
const STAGE_COLORS: Record<string, string> = {
  ALLOCATED: '#64748b',
  IN_TRANSIT: '#3b82f6',
  PORT_ENTRY: '#8b5cf6',
  SIDING: '#f59e0b',
  TERMINAL: '#22c55e',
  EXIT: '#94a3b8',
};

function RakeTimeline({ rake }: { rake: Rake }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Train className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-200">{rake.id}</span>
          <span className="text-[10px] text-slate-500">from {rake.origin}</span>
        </div>
        <div className="flex items-center gap-2">
          {rake.onTime ? (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> On Time
            </span>
          ) : (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> +{rake.delayMinutes}m delay
            </span>
          )}
          <span className="text-[10px] text-slate-500">{rake.teus} TEUs</span>
        </div>
      </div>

      {/* Stage progress */}
      <div className="flex items-center gap-1">
        {STAGES.map((stage, i) => {
          const isCompleted = i < rake.stageIndex;
          const isCurrent = i === rake.stageIndex;
          const color = STAGE_COLORS[stage];
          return (
            <div key={stage} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`w-full h-1.5 rounded-full transition-all ${
                  isCompleted ? 'bg-emerald-500' : isCurrent ? '' : 'bg-slate-700'
                }`}
                style={isCurrent ? { background: color } : {}}
              />
              {isCurrent && (
                <span className="text-[8px] font-semibold text-center leading-tight" style={{ color }}>
                  {stage.replace('_', ' ')}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-slate-600">ALLOCATED</span>
        <span className="text-[8px] text-slate-600">EXIT</span>
      </div>
    </div>
  );
}

export function RailPanel() {
  const [data, setData] = useState<RailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/rail').then(r => r.json()).then(setData).finally(() => setLoading(false));
    const id = setInterval(() => fetch('/api/rail').then(r => r.json()).then(setData), 15000);
    return () => clearInterval(id);
  }, []);

  if (loading || !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading rail data...
      </div>
    </div>
  );

  const delayedCount = data.rakes.filter(r => !r.onTime).length;

  return (
    <div className="p-4 space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: 'Rake TAT', value: `${data.kpis.rakeTAT.toFixed(1)} hrs` },
          { label: 'Shunting Duration', value: `${data.kpis.shuntingDuration.toFixed(1)} hrs` },
          { label: 'First Cargo Move', value: `${data.kpis.timeToFirstCargoMovement.toFixed(1)} hrs` },
          { label: 'On-Time %', value: `${data.kpis.onTimePerformance.toFixed(0)}%` },
          { label: 'TEUs Today', value: data.kpis.totalTEUsToday.toLocaleString() },
        ].map(k => (
          <div key={k.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 mb-1">{k.label}</p>
            <p className="text-sm font-bold text-slate-100">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Siding utilization */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-200">Rail Siding Utilization</span>
          <span className="text-sm font-bold text-amber-400">
            {data.sidingUtilization.occupied}/{data.sidingUtilization.total} occupied
          </span>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: data.sidingUtilization.total }, (_, i) => (
            <div
              key={i}
              className={`flex-1 h-8 rounded-md flex items-center justify-center text-[9px] font-semibold ${
                i < data.sidingUtilization.occupied
                  ? 'bg-amber-900/50 border border-amber-700/50 text-amber-400'
                  : 'bg-slate-700/50 border border-slate-700/30 text-slate-600'
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {delayedCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-950/30 border border-amber-700/50 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">{delayedCount} rake{delayedCount > 1 ? 's' : ''} running late — coordinate with FOIS/Indian Railways.</p>
        </div>
      )}

      {/* Rake lifecycle timelines */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Active Rake Lifecycles</h3>
        <div className="space-y-2">
          {data.rakes.map(rake => <RakeTimeline key={rake.id} rake={rake} />)}
        </div>
      </div>
    </div>
  );
}
