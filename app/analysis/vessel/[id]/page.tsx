'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSimulation } from '@/hooks/useSimulation';
import { Shield, ArrowLeft } from 'lucide-react';
import { VesselFlowAnalysis } from '@/components/analysis/VesselFlowAnalysis';

function AnalysisShell() {
  useSimulation();
  const params = useParams();
  const vesselId = typeof params.id === 'string' ? decodeURIComponent(params.id) : '';

  return (
    <div className="min-h-screen bg-[#050810] text-slate-100">
      <header className="bg-[#0a0f1e]/95 border-b border-slate-700/60 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
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
        <span className="text-xs text-slate-300 font-medium">Vessel Flow Analysis</span>
        {vesselId && (
          <>
            <span className="text-slate-700">·</span>
            <span className="text-xs text-cyan-400 font-mono">{vesselId}</span>
          </>
        )}
      </header>
      <main className="max-w-6xl mx-auto p-4">
        <VesselFlowAnalysis vesselId={vesselId} />
      </main>
    </div>
  );
}

export default function VesselAnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-[#050810] text-slate-500 text-sm">
          Loading vessel analysis…
        </div>
      }
    >
      <AnalysisShell />
    </Suspense>
  );
}
