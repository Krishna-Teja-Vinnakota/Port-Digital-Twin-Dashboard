/**
 * EnvironmentPanel.tsx
 * Environmental monitoring dashboard for Port Digital Twin.
 * NDVI health, AQI breakdown, water quality index, and carbon cost calculator.
 */

'use client';

import { useEffect, useState } from 'react';
import { Leaf, Wind, Droplets, Calculator, RefreshCw } from 'lucide-react';

interface EnvironmentData {
  ndviScore: number;
  ndviCategory: string;
  aqi: {
    overall: number;
    category: string;
    pm25: number;
    pm10: number;
    co2: number;
    no2: number;
    so2: number;
  };
  waterQuality: {
    ph: number;
    salinity: number;
    dissolvedOxygen: number;
    turbidity: number;
    overallIndex: number;
  };
  carbonCostData: {
    baseRatePerHour: number;
    currentAnchoredVessels: number;
    totalCarbonToday: number;
  };
}

const AQI_COLORS: Record<string, string> = {
  GOOD: '#22c55e',
  SATISFACTORY: '#84cc16',
  MODERATE: '#eab308',
  POOR: '#f97316',
  VERY_POOR: '#ef4444',
};

function NDVIGauge({ score }: { score: number }) {
  const pct = score * 100;
  const color = pct > 60 ? '#22c55e' : pct > 40 ? '#eab308' : '#ef4444';
  const label = pct > 60 ? 'HEALTHY' : pct > 40 ? 'MODERATE' : 'LOW';

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Leaf className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-slate-200">NDVI Health Score</span>
        <span className="ml-auto text-xs font-bold" style={{ color }}>{label}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r="32" fill="none" stroke="#1e293b" strokeWidth="8" />
            <circle
              cx="40" cy="40" r="32"
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 32 * (pct / 100)} ${2 * Math.PI * 32}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-slate-100">{score.toFixed(2)}</span>
            <span className="text-[9px] text-slate-500">/ 1.0</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-xs text-slate-400">
            NDVI measures green cover health using satellite imagery.
            Current reading indicates <span style={{ color }} className="font-medium">{label.toLowerCase()}</span> vegetation
            within Port port boundary.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { range: '< 0.35', label: 'Low', color: '#ef4444' },
              { range: '0.35-0.60', label: 'Moderate', color: '#eab308' },
              { range: '> 0.60', label: 'Healthy', color: '#22c55e' },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                <span className="text-[10px] text-slate-500">{r.range} = {r.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AQIPanel({ aqi }: { aqi: EnvironmentData['aqi'] }) {
  const color = AQI_COLORS[aqi.category] || '#eab308';
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wind className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-slate-200">Air Quality Index (AQI)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold" style={{ color }}>{aqi.overall}</span>
          <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: color + '30', color }}>{aqi.category}</span>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: 'PM2.5', value: aqi.pm25, unit: 'μg/m³', threshold: 60 },
          { label: 'PM10', value: aqi.pm10, unit: 'μg/m³', threshold: 100 },
          { label: 'CO₂', value: aqi.co2, unit: 'ppm', threshold: 450 },
          { label: 'NO₂', value: aqi.no2, unit: 'μg/m³', threshold: 80 },
          { label: 'SO₂', value: aqi.so2, unit: 'μg/m³', threshold: 50 },
        ].map(p => {
          const isHigh = p.value > p.threshold;
          return (
            <div key={p.label} className="text-center bg-slate-900/50 rounded-lg p-2">
              <p className="text-[9px] text-slate-500 mb-1">{p.label}</p>
              <p className={`text-sm font-bold ${isHigh ? 'text-red-400' : 'text-slate-200'}`}>{p.value.toFixed(0)}</p>
              <p className="text-[9px] text-slate-600">{p.unit}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WaterQualityPanel({ wq }: { wq: EnvironmentData['waterQuality'] }) {
  const indexColor = wq.overallIndex > 75 ? '#22c55e' : wq.overallIndex > 50 ? '#eab308' : '#ef4444';
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Droplets className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-slate-200">Water Quality Index</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold" style={{ color: indexColor }}>{wq.overallIndex}</span>
          <span className="text-xs text-slate-500">/ 100</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'pH', value: wq.ph.toFixed(2), note: '6.5-8.5 target' },
          { label: 'Salinity', value: `${wq.salinity.toFixed(1)} PSU`, note: 'Arabian Sea avg' },
          { label: 'DO', value: `${wq.dissolvedOxygen.toFixed(1)} mg/L`, note: '> 5 optimal' },
          { label: 'Turbidity', value: `${wq.turbidity.toFixed(0)} NTU`, note: '< 10 normal' },
        ].map(p => (
          <div key={p.label} className="bg-slate-900/50 rounded-lg p-2 text-center">
            <p className="text-[10px] text-slate-500 mb-1">{p.label}</p>
            <p className="text-xs font-bold text-slate-200">{p.value}</p>
            <p className="text-[9px] text-slate-600 mt-0.5">{p.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CarbonCalculator({ data }: { data: EnvironmentData['carbonCostData'] }) {
  const [hours, setHours] = useState(4);
  const [vessels, setVessels] = useState(data.currentAnchoredVessels || 3);
  const co2 = (hours * vessels * data.baseRatePerHour).toFixed(1);

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-slate-200">Carbon Cost Calculator</span>
        <span className="text-[10px] text-slate-500 ml-auto">Per RFP Section VIII</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Vessel Wait Hours</label>
          <input
            type="number"
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            min={0} max={72} step={0.5}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Anchored Vessels</label>
          <input
            type="number"
            value={vessels}
            onChange={e => setVessels(Number(e.target.value))}
            min={0} max={20}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Rate (tons/hr/vessel)</label>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-400">
            {data.baseRatePerHour}
          </div>
        </div>
      </div>
      <div className="bg-red-950/30 border border-red-800/40 rounded-lg px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-slate-300">Estimated CO₂ Emissions</span>
        <div className="text-right">
          <span className="text-xl font-bold text-red-400">{co2}</span>
          <span className="text-xs text-slate-500 ml-1">tons CO₂</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-600 mt-2">
        Formula: CO₂ = wait_hours × vessels × {data.baseRatePerHour} (avg emission rate per vessel/hr)
      </p>
      <p className="text-[10px] text-slate-500 mt-1">
        Today&apos;s total carbon: <span className="text-amber-400 font-medium">{data.totalCarbonToday} tons</span>
      </p>
    </div>
  );
}

export function EnvironmentPanel() {
  const [data, setData] = useState<EnvironmentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/environment').then(r => r.json()).then(setData).finally(() => setLoading(false));
    const id = setInterval(() => {
      fetch('/api/environment').then(r => r.json()).then(setData);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  if (loading || !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading environmental data...
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <NDVIGauge score={data.ndviScore} />
      <AQIPanel aqi={data.aqi} />
      <WaterQualityPanel wq={data.waterQuality} />
      <CarbonCalculator data={data.carbonCostData} />
    </div>
  );
}
