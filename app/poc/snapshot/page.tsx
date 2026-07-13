/**
 * Print-friendly POC snapshot (browser Print to PDF).
 */

'use client';

import { useSimulation } from '@/hooks/useSimulation';
import { useSimulationStore } from '@/store/useSimulationStore';
import { buildDelayAttributionString, BASE_GATE_PROCESS } from '@/lib/timingMatrix';
import Link from 'next/link';

export default function PocSnapshotPrintPage() {
  useSimulation();
  const kpis = useSimulationStore((s) => s.kpis);
  const timingProfile = useSimulationStore((s) => s.timingProfile);
  const dataProvenance = useSimulationStore((s) => s.dataProvenance);
  const pocSnapshot = useSimulationStore((s) => s.pocSnapshot);
  const activeScenarioIds = useSimulationStore((s) => s.activeScenarioIds);

  const narr =
    timingProfile &&
    buildDelayAttributionString(BASE_GATE_PROCESS, timingProfile.gateProcess, timingProfile.appliedModifiers);

  return (
    <div className="min-h-screen bg-white text-slate-900 p-8 print:p-6 text-sm">
      <div className="max-w-3xl mx-auto print:max-w-none">
        <div className="flex items-center justify-between gap-4 mb-6 print:hidden">
          <Link href="/" className="text-cyan-700 underline">
            ← Back to ICCC
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 rounded border border-slate-400 text-slate-800"
          >
            Print / Save as PDF
          </button>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 border-b border-slate-300 pb-2 mb-4">
          Port ICCC — POC snapshot
        </h1>
        <p className="text-slate-600 mb-6">Generated {new Date().toLocaleString()}</p>

        <section className="mb-6">
          <h2 className="font-semibold text-slate-800 mb-2">Data provenance</h2>
          <ul className="list-disc pl-5 space-y-1 text-slate-700">
            <li>Vessels: {dataProvenance?.vessels.mode ?? '—'} — {dataProvenance?.vessels.detail ?? ''}</li>
            <li>Trucks: {dataProvenance?.trucks.mode ?? '—'} — {dataProvenance?.trucks.detail ?? ''}</li>
            <li>KPIs: {dataProvenance?.kpi.mode ?? '—'} — {dataProvenance?.kpi.detail ?? ''}</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold text-slate-800 mb-2">Active scenarios</h2>
          <p className="text-slate-700">
            {(activeScenarioIds?.length ? activeScenarioIds.join(', ') : 'None') ||
              '—'}
          </p>
        </section>

        {pocSnapshot?.baselineKpis && (
          <section className="mb-6">
            <h2 className="font-semibold text-slate-800 mb-2">Baseline (captured)</h2>
            <p className="text-slate-600 text-xs mb-2">{pocSnapshot.baselineLabel}</p>
            <pre className="bg-slate-100 p-3 rounded text-xs overflow-x-auto">
              {JSON.stringify(pocSnapshot.baselineKpis, null, 2)}
            </pre>
          </section>
        )}

        <section className="mb-6">
          <h2 className="font-semibold text-slate-800 mb-2">Current KPIs</h2>
          {kpis ? (
            <pre className="bg-slate-100 p-3 rounded text-xs overflow-x-auto">{JSON.stringify(kpis, null, 2)}</pre>
          ) : (
            <p className="text-slate-500">No KPIs loaded yet.</p>
          )}
        </section>

        <section>
          <h2 className="font-semibold text-slate-800 mb-2">Timing narrative</h2>
          <p className="text-slate-700">{narr || '—'}</p>
        </section>
      </div>
    </div>
  );
}
