/**
 * KPIDashboard.tsx
 * Live KPI metrics dashboard for Port ICCC.
 * Displays all 12 RFP-defined KPIs with Recharts sparklines and threshold alerts.
 * Polled every 5 seconds via GET /api/kpi.
 */

'use client';

import { useSimulationStore } from '@/store/useSimulationStore';
import { rfpRefForKpiLabel } from '@/lib/rfpKpiLabels';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';
import { TrendingUp, TrendingDown, TriangleAlert as AlertTriangle, Ship, Truck, Gauge, Clock, Leaf, Package } from 'lucide-react';

const POC_KPI_EXTRAS = process.env.NEXT_PUBLIC_POC_MODE === 'true';

interface KPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  history?: number[];
  threshold?: number;
  thresholdLabel?: string;
  isHighBad?: boolean;
  color?: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  rfpRef?: string;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${color})`}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={() => null}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function KPICard({ label, value, unit, history, threshold, thresholdLabel, isHighBad = true, color = '#22d3ee', icon, badge, badgeColor, rfpRef }: KPICardProps) {
  const numVal = typeof value === 'number' ? value : parseFloat(String(value));
  const isAlert = threshold !== undefined && (isHighBad ? numVal > threshold : numVal < threshold);

  const trend = history && history.length >= 2
    ? history[history.length - 1] > history[0] ? 'up' : 'down'
    : null;

  return (
    <div
      className={`
      bg-slate-800/60 rounded-xl border p-3 flex flex-col gap-2 transition-all
      ${isAlert ? 'border-amber-500/50 shadow-amber-500/10 shadow-lg' : 'border-slate-700/50 hover:border-slate-600/60'}
    `}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">{icon}</span>
            <span className="text-[11px] text-slate-400 font-medium leading-tight" title={rfpRef}>
              {label}
            </span>
          </div>
          {rfpRef && (
            <p className="text-[9px] text-slate-600 leading-tight pl-5 line-clamp-2">{rfpRef}</p>
          )}
        </div>
        {isAlert && threshold !== undefined && (
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
        )}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          {badge ? (
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${badgeColor || 'text-slate-200 bg-slate-700'}`}>
              {badge}
            </span>
          ) : (
            <div className="flex items-baseline gap-1">
              <span className={`text-lg font-bold ${isAlert ? 'text-amber-300' : 'text-slate-100'}`}>
                {typeof value === 'number' ? value.toFixed(value % 1 !== 0 ? 1 : 0) : value}
              </span>
              {unit && <span className="text-[11px] text-slate-500">{unit}</span>}
            </div>
          )}
          {threshold !== undefined && (
            <p className="text-[10px] text-slate-600 mt-0.5">
              {thresholdLabel || `Threshold: ${threshold}`}
            </p>
          )}
        </div>

        {trend && (
          <div className={`flex items-center gap-0.5 ${
            (isHighBad && trend === 'up') || (!isHighBad && trend === 'down')
              ? 'text-red-400' : 'text-emerald-400'
          }`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          </div>
        )}
      </div>

      {history && history.length > 0 && (
        <div className="-mx-1 -mb-1">
          <Sparkline data={history} color={isAlert ? '#f59e0b' : color} />
        </div>
      )}
    </div>
  );
}

function getCongestionBadge(level: string) {
  if (level === 'HIGH') return { badge: 'HIGH', badgeColor: 'bg-red-900 text-red-300' };
  if (level === 'MEDIUM') return { badge: 'MED', badgeColor: 'bg-amber-900 text-amber-300' };
  return { badge: 'LOW', badgeColor: 'bg-emerald-900 text-emerald-300' };
}

function getCarbonBadge(level: string) {
  if (level === 'HIGH') return { badge: 'HIGH', badgeColor: 'bg-red-900 text-red-300' };
  if (level === 'MODERATE') return { badge: 'MOD', badgeColor: 'bg-amber-900 text-amber-300' };
  return { badge: 'LOW', badgeColor: 'bg-emerald-900 text-emerald-300' };
}

export function KPIDashboard() {
  const { kpis, vessels, dataProvenance } = useSimulationStore();

  if (!kpis) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-slate-500 animate-pulse">Loading KPIs...</div>
      </div>
    );
  }

  const congestion = getCongestionBadge(kpis.gateCongestionLevel);
  const carbon = getCarbonBadge(kpis.carbonIndex);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/60 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">KPI Dashboard</span>
        </div>
        <div className="flex flex-col items-end gap-0.5 max-w-[min(100%,16rem)]">
          <div className="text-[10px] text-slate-500">
            {vessels.length} vessels on map
          </div>
          <span
            className="text-[9px] text-slate-500 text-right leading-tight"
            title={dataProvenance?.kpi?.detail}
          >
            {dataProvenance
              ? `KPIs ${dataProvenance.kpi.mode} — sim + live merge where wired`
              : 'KPIs: merged (sim + live)'}
          </span>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-2 gap-2">
          <KPICard
            label="Avg Vessel TAT"
            rfpRef={rfpRefForKpiLabel('Avg Vessel TAT')}
            value={kpis.avgVesselTAT}
            unit="hrs"
            history={kpis.history?.avgVesselTAT}
            threshold={24}
            thresholdLabel="Alert > 24 hrs"
            color="#22d3ee"
            icon={<Ship className="w-3 h-3" />}
          />
          <KPICard
            label="Pre-Berthing Detention"
            rfpRef={rfpRefForKpiLabel('Pre-Berthing Detention')}
            value={kpis.preBerthingDetention}
            unit="hrs"
            history={kpis.history?.preBerthingDetention}
            threshold={3}
            thresholdLabel="Alert > 3 hrs"
            color="#f59e0b"
            icon={<Clock className="w-3 h-3" />}
          />
          <KPICard
            label="Berth Occupancy"
            rfpRef={rfpRefForKpiLabel('Berth Occupancy')}
            value={kpis.berthOccupancy}
            unit="%"
            history={kpis.history?.berthOccupancy}
            threshold={85}
            thresholdLabel="Alert > 85%"
            color="#8b5cf6"
            icon={<Ship className="w-3 h-3" />}
          />
          <KPICard
            label="Avg Import Dwell Time"
            rfpRef={rfpRefForKpiLabel('Avg Import Dwell Time')}
            value={kpis.avgImportDwellTime}
            unit="hrs"
            color="#06b6d4"
            icon={<Package className="w-3 h-3" />}
          />
          <KPICard
            label="Avg Export Dwell Time"
            rfpRef={rfpRefForKpiLabel('Avg Export Dwell Time')}
            value={kpis.avgExportDwellTime}
            unit="hrs"
            color="#0ea5e9"
            icon={<Package className="w-3 h-3" />}
          />
          <KPICard
            label="DPD %"
            rfpRef={rfpRefForKpiLabel('DPD %')}
            value={kpis.dpdPercent}
            unit="%"
            color="#22c55e"
            isHighBad={false}
            icon={<TrendingUp className="w-3 h-3" />}
          />
          <KPICard
            label="DPE %"
            rfpRef={rfpRefForKpiLabel('DPE %')}
            value={kpis.dpePercent}
            unit="%"
            color="#10b981"
            isHighBad={false}
            icon={<TrendingUp className="w-3 h-3" />}
          />
          <KPICard
            label="Gate Congestion"
            rfpRef={rfpRefForKpiLabel('Gate Congestion')}
            value={kpis.gateCongestionLevel}
            icon={<AlertTriangle className="w-3 h-3" />}
            {...congestion}
          />
          <KPICard
            label="Trucks in Geo-Fence"
            rfpRef={rfpRefForKpiLabel('Trucks in Geo-Fence')}
            value={kpis.trucksInGeoFence}
            unit="trucks"
            history={kpis.history?.trucksInGeoFence}
            threshold={200}
            thresholdLabel="Alert > 200"
            color="#f97316"
            icon={<Truck className="w-3 h-3" />}
          />
          <KPICard
            label="Carbon Emissions Index"
            rfpRef={rfpRefForKpiLabel('Carbon Emissions Index')}
            value={kpis.carbonIndex}
            icon={<Leaf className="w-3 h-3" />}
            {...carbon}
          />
          <KPICard
            label="Crane Moves/hr"
            rfpRef={rfpRefForKpiLabel('Crane Moves/hr')}
            value={kpis.craneMoves}
            unit="moves/hr"
            history={kpis.history?.craneMoves}
            color="#a78bfa"
            icon={<Gauge className="w-3 h-3" />}
          />
          <KPICard
            label="Pilot Performance Time"
            rfpRef={rfpRefForKpiLabel('Pilot Performance Time')}
            value={kpis.pilotPerformanceTime}
            unit="hrs"
            color="#67e8f9"
            icon={<Clock className="w-3 h-3" />}
          />
          {POC_KPI_EXTRAS && typeof kpis.yardOccupancyPct === 'number' && (
            <KPICard
              label="Yard Utilization %"
              rfpRef={rfpRefForKpiLabel('Yard Utilization %')}
              value={kpis.yardOccupancyPct}
              unit="%"
              threshold={90}
              thresholdLabel="Alert > 90% fill"
              color="#eab308"
              icon={<Package className="w-3 h-3" />}
            />
          )}
          {POC_KPI_EXTRAS && typeof kpis.gateQueueLength === 'number' && (
            <KPICard
              label="Gate Queue (total)"
              rfpRef={rfpRefForKpiLabel('Gate Queue (total)')}
              value={kpis.gateQueueLength}
              unit="trucks"
              threshold={80}
              thresholdLabel="Queue pressure"
              color="#fb7185"
              icon={<Truck className="w-3 h-3" />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
