/**
 * BerthForecast.tsx
 * 21-day berth occupancy forecast panel for Port Digital Twin.
 * Calendar heatmap, vessel schedule table, and weekly summary.
 */

'use client';

import { useEffect, useState } from 'react';
import { Ship, RefreshCw, Calendar, AlertTriangle, Warehouse, Timer, Anchor } from 'lucide-react';
import { format } from 'date-fns';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

interface DayOccupancy {
  date: string;
  dayLabel: string;
  occupancyPercent: number;
  vessels: number;
  isWeekend: boolean;
}

interface ScheduledVessel {
  id: string;
  vesselName: string;
  eta: string;
  etd: string;
  berthNumber: string;
  status: string;
  teus: number;
  vesselType: string;
}

interface ForecastData {
  occupancyGrid: DayOccupancy[];
  vesselSchedule: ScheduledVessel[];
  avgOccupancy21Day: number;
  congestion4h?: Congestion4h;
  upcomingVessels4h?: Array<{
    id: string;
    name: string;
    lifecycleState: string;
    eta: string;
    berthNumber: string | null;
    assignedCranes: number | null;
  }>;
  upcomingTrucks4h?: {
    totalTrucks: number;
    byState: Record<string, number>;
  };
}

interface Congestion4h {
  horizonMins: number;
  snapshotSimMins: number;
  horizonSimMins: number;
  projectedYardUtilizationPct: number;
  gateDelayEstimateMins: number;
  yardCrossesThresholdInMins: number | null;
  bottleneckAtHorizon: string;
  berthUtilizationPctAtHorizon: number;
  berthWindows: Array<{
    berthId: string;
    berthCode: string;
    berthName: string;
    vesselId: string | null;
    vacancyInMins: number;
  }>;
  perTickSnapshots: Array<{
    simTimeMins: number;
    yardOccPct: number;
    gateQueueTotal: number;
    berthOccupied: number;
    bottleneck: string;
  }>;
  congestionIndex: number;
  drivers: string[];
  source: string;
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40',
  EXPECTED: 'text-cyan-400 bg-cyan-900/30 border-cyan-700/40',
  TENTATIVE: 'text-slate-400 bg-slate-800/50 border-slate-600/40',
  BERTHED: 'text-blue-400 bg-blue-900/30 border-blue-700/40',
  DEPARTED: 'text-slate-600 bg-slate-900/30 border-slate-700/30',
};

function occupancyColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 75) return 'bg-amber-500';
  if (pct >= 50) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

function occupancyBg(pct: number): string {
  if (pct >= 90) return 'bg-red-900/40 border-red-700/40 text-red-300';
  if (pct >= 75) return 'bg-amber-900/40 border-amber-700/40 text-amber-300';
  if (pct >= 50) return 'bg-yellow-900/30 border-yellow-700/30 text-yellow-300';
  return 'bg-emerald-900/30 border-emerald-700/30 text-emerald-300';
}

function minsToLabel(mins: number) {
  if (mins <= 0) return 'Now';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function congestionLevel(index: number) {
  if (index >= 70) return { label: 'HIGH', color: 'bg-red-950/60 border-red-700/60 text-red-300' };
  if (index >= 40) return { label: 'WATCH', color: 'bg-amber-950/50 border-amber-700/50 text-amber-300' };
  return { label: 'NORMAL', color: 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300' };
}

export function BerthForecast() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetch('/api/berth/forecast').then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading berth forecast...
      </div>
    </div>
  );

  const upcoming = data.vesselSchedule.filter(v => ['CONFIRMED', 'EXPECTED', 'BERTHED'].includes(v.status)).slice(0, 12);
  const congestion = data.congestion4h;
  const cLevel = congestion ? congestionLevel(congestion.congestionIndex) : null;
  const chartData = congestion
    ? congestion.perTickSnapshots.map((s) => ({
      t: s.simTimeMins - congestion.snapshotSimMins,
      yardOccPct: s.yardOccPct,
      gateQueueTotal: s.gateQueueTotal,
      berthOccupied: s.berthOccupied,
    }))
    : [];

  async function refreshNow() {
    try {
      setRefreshing(true);
      const res = await fetch('/api/berth/forecast', { cache: 'no-store' });
      if (!res.ok) return;
      const next = await res.json();
      setData(next);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="p-4 space-y-6">
      {/* Summary header */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 col-span-2">
          <p className="text-xs text-slate-500 mb-1">21-Day Average Occupancy</p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-slate-100">{data.avgOccupancy21Day}%</span>
            <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden mb-1">
              <div
                className={`h-full rounded-full ${occupancyColor(data.avgOccupancy21Day)}`}
                style={{ width: `${data.avgOccupancy21Day}%` }}
              />
            </div>
          </div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
          <p className="text-xs text-slate-500 mb-1">Total Berths</p>
          <p className="text-3xl font-bold text-slate-100">23</p>
          <p className="text-[10px] text-slate-600">NSICT + JNPCT + GTI</p>
        </div>
      </div>

      {congestion && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-slate-200">Congestion Forecast (Next {Math.round(congestion.horizonMins / 60)} Hours)</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700/60 bg-slate-900/40 text-slate-400">
              {congestion.source}
            </span>
            <button
              onClick={refreshNow}
              className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-200 border border-slate-700/60 rounded-md px-2 py-1 hover:bg-slate-900/40"
              disabled={refreshing}
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-3">
              <p className="text-xs text-slate-500 mb-1">Congestion Index</p>
              <div className="flex items-end justify-between gap-2">
                <span className="text-3xl font-bold text-slate-100">{congestion.congestionIndex}</span>
                {cLevel && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cLevel.color}`}>
                    {cLevel.label}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-1 truncate" title={congestion.drivers.join(' • ')}>
                {congestion.drivers.join(' • ')}
              </p>
            </div>

            <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Warehouse className="w-4 h-4 text-cyan-400" />
                <p className="text-xs text-slate-500">Yard Utilization (Projected)</p>
              </div>
              <p className="text-3xl font-bold text-slate-100">{congestion.projectedYardUtilizationPct}%</p>
              <p className="text-[10px] text-slate-500 mt-1">
                Threshold crossing: {congestion.yardCrossesThresholdInMins == null ? 'Not in 4h' : minsToLabel(congestion.yardCrossesThresholdInMins)}
              </p>
            </div>

            <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="w-4 h-4 text-cyan-400" />
                <p className="text-xs text-slate-500">Gate Delay (Projected)</p>
              </div>
              <p className="text-3xl font-bold text-slate-100">{Math.round(congestion.gateDelayEstimateMins)}m</p>
              <p className="text-[10px] text-slate-500 mt-1">Bottleneck: {congestion.bottleneckAtHorizon}</p>
            </div>

            <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Anchor className="w-4 h-4 text-cyan-400" />
                <p className="text-xs text-slate-500">Berth Utilization (Projected)</p>
              </div>
              <p className="text-3xl font-bold text-slate-100">{congestion.berthUtilizationPctAtHorizon}%</p>
              <p className="text-[10px] text-slate-500 mt-1">Availability windows below</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-slate-900/30 border border-slate-700/40 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-2">Trend (Yard % / Gate Queue)</p>
              <ChartContainer
                config={{
                  yardOccPct: { label: 'Yard %', color: 'hsl(142.1 76.2% 36.3%)' },
                  gateQueueTotal: { label: 'Gate Queue', color: 'hsl(199 89% 48%)' },
                }}
                className="h-44 aspect-auto"
              >
                <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}m`}
                  />
                  <YAxis
                    yAxisId="left"
                    tickLine={false}
                    axisLine={false}
                    width={28}
                    domain={[0, 100]}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={34}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="yardOccPct"
                    stroke="var(--color-yardOccPct)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="gateQueueTotal"
                    stroke="var(--color-gateQueueTotal)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            </div>

            <div className="bg-slate-900/30 border border-slate-700/40 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-700/40 flex items-center justify-between">
                <p className="text-xs text-slate-400">Berth Availability (Projected)</p>
                <p className="text-[10px] text-slate-500">{congestion.berthWindows.length} berths</p>
              </div>
              <div className="max-h-44 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/30">
                      {['Berth', 'Free In', 'Occupancy'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {congestion.berthWindows.map((b) => (
                      <tr key={b.berthId} className="border-b border-slate-700/20 hover:bg-slate-800/30 transition-colors">
                        <td className="px-3 py-2 text-slate-200 font-medium" title={b.berthName}>
                          {b.berthCode}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{minsToLabel(b.vacancyInMins)}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {b.vesselId ? 'OCCUPIED' : 'FREE'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-slate-900/30 border border-slate-700/40 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-700/40 flex items-center justify-between">
                <p className="text-xs text-slate-400">Upcoming Vessels (Ops-Relevant)</p>
                <p className="text-[10px] text-slate-500">{(data.upcomingVessels4h || []).length} shown</p>
              </div>
              <div className="max-h-44 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/30">
                      {['Vessel', 'State', 'ETA', 'Berth'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.upcomingVessels4h || []).map((v) => (
                      <tr key={v.id} className="border-b border-slate-700/20 hover:bg-slate-800/30 transition-colors">
                        <td className="px-3 py-2 text-slate-200 font-medium">{v.name}</td>
                        <td className="px-3 py-2 text-slate-500">{v.lifecycleState}</td>
                        <td className="px-3 py-2 text-slate-400">{v.eta ? format(new Date(v.eta), 'dd MMM HH:mm') : '-'}</td>
                        <td className="px-3 py-2 text-cyan-400 font-semibold">{v.berthNumber || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-slate-900/30 border border-slate-700/40 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-2">Truck Snapshot</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500">Total Trucks (Live/Sim)</p>
                  <p className="text-2xl font-bold text-slate-100">{data.upcomingTrucks4h?.totalTrucks ?? 0}</p>
                </div>
                <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500">Gate Delay (Projected)</p>
                  <p className="text-2xl font-bold text-slate-100">{Math.round(congestion.gateDelayEstimateMins)}m</p>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[10px] text-slate-500 mb-1">Truck states (count)</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(data.upcomingTrucks4h?.byState || {})
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([k, v]) => (
                      <span key={k} className="text-[10px] px-2 py-0.5 rounded border border-slate-700/50 bg-slate-900/40 text-slate-300">
                        {k}: {v}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 21-day heatmap calendar */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">21-Day Berth Occupancy Calendar</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {data.occupancyGrid.map(day => (
            <div
              key={day.date}
              title={`${day.dayLabel}: ${day.occupancyPercent}% (${day.vessels} vessels)`}
              className={`rounded-lg p-1.5 border cursor-default transition-all hover:scale-105 ${
                occupancyBg(day.occupancyPercent)
              } ${day.isWeekend ? 'opacity-75' : ''}`}
            >
              <p className="text-[9px] font-semibold leading-none">{format(new Date(day.date), 'd')}</p>
              <p className="text-[8px] opacity-80 mt-0.5">{format(new Date(day.date), 'MMM')}</p>
              <p className="text-[9px] font-bold mt-1">{Math.round(day.occupancyPercent)}%</p>
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 mt-3">
          {[
            { label: '< 50%', color: 'bg-emerald-500' },
            { label: '50-75%', color: 'bg-yellow-500' },
            { label: '75-90%', color: 'bg-amber-500' },
            { label: '> 90%', color: 'bg-red-500' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${l.color}`} />
              <span className="text-[10px] text-slate-500">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Vessel schedule table */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/60">
          <Ship className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">Vessel Schedule</span>
          <span className="text-xs text-slate-500 ml-auto">{upcoming.length} upcoming</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/60">
                {['Vessel', 'ETA', 'ETD', 'Berth', 'Type', 'TEUs', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upcoming.map(v => (
                <tr key={v.id} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                  <td className="px-3 py-2 font-medium text-slate-200">{v.vesselName}</td>
                  <td className="px-3 py-2 text-slate-400">{format(new Date(v.eta), 'dd MMM HH:mm')}</td>
                  <td className="px-3 py-2 text-slate-400">{format(new Date(v.etd), 'dd MMM HH:mm')}</td>
                  <td className="px-3 py-2 text-cyan-400 font-semibold">{v.berthNumber}</td>
                  <td className="px-3 py-2 text-slate-500">{v.vesselType}</td>
                  <td className="px-3 py-2 text-slate-300">{v.teus.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${STATUS_COLORS[v.status] || 'text-slate-400'}`}>
                      {v.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
