'use client';

import { Suspense } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { WarRoom } from '@/components/workflow/WarRoom';

function WarRoomShell() {
  useSimulation();
  return <WarRoom />;
}

export default function WorkflowPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-[#050810] text-slate-500 text-sm">
          Loading War Room…
        </div>
      }
    >
      <WarRoomShell />
    </Suspense>
  );
}
