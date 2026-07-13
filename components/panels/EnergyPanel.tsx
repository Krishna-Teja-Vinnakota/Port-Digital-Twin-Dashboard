/**
 * EnergyPanel.tsx
 * Energy management dashboard for Port Digital Twin.
 * Displays 13 substation cards, green energy ratio, and consumption sparkline.
 */

'use client';

import { useEffect, useState } from 'react';
import { Zap, RefreshCw, Flame, TriangleAlert as AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts';

interface Substation {
  id: string;
  name: string;
  loadPercent: number;
  status: string;
  currentMW: number;
  maxCapacityMW: number;
  voltage: number;
}

interface EnergyData {
  substations: Substation[];
  totalConsumptionMW: number;
  greenEnergyRatio: number;
  consumption24h: Array<{ hour: string; mw: number }>;
  peakLoadToday: number;
  gridFrequency: number;
  _sources?: Record<string, 'LIVE' | 'SIMULATION'>;
  _liveCoverage?: {
    liveMetrics: number;
    totalMetrics: number;
    isFullyLive: boolean;
  };
  _iotStatus?: {
    configured: boolean;
    label: string;
    substationsLive?: number;
  };
}

const STATUS_STYLE: Record<string, string> = {
  NORMAL: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/50',
  HIGH_LOAD: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  OVERLOAD: 'bg-red-900/40 text-red-400 border-red-700/50',
  FAULT: 'bg-red-950/60 text-red-300 border-red-600 animate-pulse',
};

const LOAD_COLOR = (pct: number) => pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#22c55e';

function SubstationCard({ ss }: { ss: Substation }) {
  const color = LOAD_COLOR(ss.loadPercent);
  return (
    <div className={`bg-slate-800/60 border rounded-lg p-3 transition-all hover:border-slate-600/60 ${
      ss.status === 'FAULT' ? 'border-red-600/60' : 'border-slate-700/50'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-slate-400 font-medium truncate flex-1 mr-1">{ss.name}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${STATUS_STYLE[ss.status] || STATUS_STYLE.NORMAL}`}>
          {ss.status}
        </span>
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-bold" style={{ color }}>{ss.loadPercent}%</span>
        <span className="text-[10px] text-slate-500">{ss.currentMW.toFixed(1)} MW</span>
      </div>
      <div className="w-full bg-slate-700/60 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${ss.loadPercent}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function EnergyPanel() {
  const [data, setData] = useState<EnergyData | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchEnergy() {
    try {
      const res = await fetch('/api/energy');
      const d = await res.json();
      setData(d);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchEnergy();
    const id = setInterval(fetchEnergy, 10000);
    return () => clearInterval(id);
  }, []);

  if (loading || !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading energy data...
      </div>
    </div>
  );

  const faultCount = data.substations.filter(ss => ss.status === 'FAULT').length;
  const overloadCount = data.substations.filter(ss => ss.status === 'OVERLOAD').length;
  const coverage = data._liveCoverage;

  return (
    <div className="p-4 space-y-6">
      {(coverage || data._iotStatus) && (
        <div className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 py-2">
          <span className="text-xs text-slate-300">
            {coverage
              ? `Live coverage: ${coverage.liveMetrics}/${coverage.totalMetrics} metrics`
              : 'Live coverage unavailable'}
          </span>
          <span
            className={`text-[11px] font-semibold px-2 py-1 rounded ${
              coverage?.isFullyLive
                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                : 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
            }`}
          >
            {coverage?.isFullyLive ? 'FULLY LIVE' : 'PARTIAL/SIMULATION'}
          </span>
        </div>
      )}

      {/* Header metrics */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Load', value: `${data.totalConsumptionMW.toFixed(1)} MW`, icon: <Zap className="w-4 h-4 text-yellow-400" /> },
          { label: 'Green Energy', value: `${data.greenEnergyRatio}%`, icon: <span className="text-green-400 text-base">♻️</span> },
          { label: 'Grid Freq.', value: `${data.gridFrequency} Hz`, icon: <Zap className="w-4 h-4 text-cyan-400" /> },
          { label: 'Peak Today', value: `${data.peakLoadToday.toFixed(1)} MW`, icon: <Flame className="w-4 h-4 text-orange-400" /> },
        ].map(m => (
          <div key={m.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">{m.icon}<span className="text-xs text-slate-500">{m.label}</span></div>
            <p className="text-lg font-bold text-slate-100">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Alerts summary */}
      {(faultCount > 0 || overloadCount > 0) && (
        <div className="flex items-center gap-3 bg-red-950/30 border border-red-700/50 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <p className="text-sm text-red-300">
            {faultCount > 0 && <span>{faultCount} substation fault{faultCount > 1 ? 's' : ''} detected. </span>}
            {overloadCount > 0 && <span>{overloadCount} substation{overloadCount > 1 ? 's' : ''} overloaded. </span>}
            Immediate attention required.
          </p>
        </div>
      )}

      {/* Green energy gauge */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-200">Renewable Energy Ratio</span>
          <span className="text-sm font-bold text-emerald-400">{data.greenEnergyRatio}%</span>
        </div>
        <div className="relative h-4 bg-slate-700/60 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all"
            style={{ width: `${data.greenEnergyRatio}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-600">0% Fossil</span>
          <span className="text-[10px] text-slate-600">100% Renewable</span>
        </div>
      </div>

      {/* 24hr consumption chart */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">24-Hour Consumption (MW)</h3>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data.consumption24h} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#eab308" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 9 }} tickLine={false} axisLine={false} interval={3} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
              labelStyle={{ color: '#94a3b8', fontSize: '11px' }}
              itemStyle={{ color: '#eab308', fontSize: '11px' }}
            />
            <Area type="monotone" dataKey="mw" stroke="#eab308" strokeWidth={1.5} fill="url(#energyGrad)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Substation grid */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Substations (13 nodes)</h3>
        <div className="grid grid-cols-3 gap-2">
          {data.substations.map(ss => <SubstationCard key={ss.id} ss={ss} />)}
        </div>
      </div>
    </div>
  );
}
