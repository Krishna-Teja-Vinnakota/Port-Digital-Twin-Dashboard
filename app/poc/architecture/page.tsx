/**
 * Pre-bid POC: integration architecture (static, in-app).
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function PocArchitecturePage() {
  return (
    <div className="min-h-screen bg-[#050810] text-slate-200 p-6 md:p-10">
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="text-cyan-400 text-sm hover:underline mb-6 inline-block">
          ← Port ICCC
        </Link>
        <h1 className="text-2xl font-bold text-slate-100 mb-2">Integration architecture (POC)</h1>
        <p className="text-slate-500 text-sm mb-10 max-w-2xl">
          High-level data path for the technical capability POC. Phase 2+ extends the platform with production
          TOS, VTMS, SCADA, ULIP, and national stack interfaces—this view is narrative, not an inventory of
          every future connector.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <Column title="Sources">
            <SourceBox label="AIS relay" detail="Live vessel positions where available" />
            <SourceBox label="OpenCV / cameras" detail="Geofence truck signals" />
            <SourceBox label="Simulated TOS" detail="TEU, dwell, crane defaults" />
            <SourceBox label="Environment APIs" detail="AQI, NDVI, water (live or fallback)" />
          </Column>
          <Column title="Platform">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="rounded-xl border border-cyan-700/50 bg-cyan-950/40 px-4 py-6 w-full">
                <p className="text-cyan-300 font-semibold text-sm">Port Digital Twin core</p>
                <p className="text-[11px] text-slate-500 mt-2">
                  Simulation engine, timing matrix, KPI merge, scenario layer, ICCC UI
                </p>
              </div>
              <FlowArrows />
            </div>
          </Column>
          <Column title="C3 / ICCC">
            <SourceBox label="Command center" detail="Map, KPIs, alerts, what-if" />
            <SourceBox label="Provenance" detail="Live vs simulated surfaced in UI" />
            <SourceBox label="Scenario impact" detail="Baseline vs scenario KPI delta" />
          </Column>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-sm font-semibold text-cyan-400 mb-3">Phase 1 (this POC)</h2>
            <ul className="list-disc pl-5 space-y-2 text-slate-400 text-sm">
              <li>AIS relay + simulation merge for vessel layer</li>
              <li>Simulated terminal / TOS-style KPI enrichment</li>
              <li>OpenCV path for truck analytics when service is available</li>
              <li>Environment strip with honest source labelling</li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-400 mb-3">Phase 2 (programme)</h2>
            <ul className="list-disc pl-5 space-y-2 text-slate-500 text-sm">
              <li>Production TOS / PCS feeds and authoritative manifest</li>
              <li>VTMS, pilots, berth allocation systems</li>
              <li>SCADA / energy, rail FOIS, ULIP and national logistics platforms</li>
              <li>Hardened hosting, IAM, and operational runbooks</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SourceBox({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
      <p className="text-sm text-slate-200 font-medium">{label}</p>
      <p className="text-[11px] text-slate-600 mt-0.5">{detail}</p>
    </div>
  );
}

function FlowArrows() {
  return (
    <div className="flex flex-col items-center gap-1 text-slate-600 py-2">
      <ArrowRight className="w-4 h-4 rotate-[-90deg]" />
      <ArrowRight className="w-4 h-4 rotate-[-90deg]" />
    </div>
  );
}
