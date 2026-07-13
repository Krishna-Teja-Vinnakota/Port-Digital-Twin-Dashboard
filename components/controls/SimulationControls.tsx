/**
 * SimulationControls.tsx
 * What-If Simulation Control Bar for Port Digital Twin ICCC.
 * Operators trigger real-time port scenarios and observe cascading effects.
 */

'use client';

import { useState } from 'react';
import { useSimulationStore } from '@/store/useSimulationStore';
import { toast } from 'sonner';
import type { ScenarioId } from '@/store/useSimulationStore';
import { Circle as XCircle, Ship, Truck, Waves, RotateCcw, Loader as Loader2, FlaskConical, ChevronRight, CloudRain, Wrench, Container, CloudOff } from 'lucide-react';

interface SimAction {
  label: string;
  icon: React.ReactNode;
  payload: { action: string; [key: string]: unknown };
  color: string;
  hoverColor: string;
  description: string;
}

const ACTIONS: SimAction[] = [
  {
    label: 'Close Gate 3',
    icon: <XCircle className="w-4 h-4" />,
    payload: { action: 'CLOSE_GATE', gateId: 3 },
    color: 'border-red-700/50 text-red-300 bg-red-950/30',
    hoverColor: 'hover:bg-red-900/40 hover:border-red-500/60',
    description: 'Redirects trucks → Gate congestion alert',
  },
  {
    label: 'Add 3 Incoming Ships',
    icon: <Ship className="w-4 h-4" />,
    payload: { action: 'ADD_VESSELS', count: 3 },
    color: 'border-amber-700/50 text-amber-300 bg-amber-950/30',
    hoverColor: 'hover:bg-amber-900/40 hover:border-amber-500/60',
    description: 'Increases berth occupancy, bunching detection',
  },
  {
    label: 'Increase Truck Volume',
    icon: <Truck className="w-4 h-4" />,
    payload: { action: 'INCREASE_TRUCKS', delta: 50 },
    color: 'border-orange-700/50 text-orange-300 bg-orange-950/30',
    hoverColor: 'hover:bg-orange-900/40 hover:border-orange-500/60',
    description: 'Gate queues rise, carbon index worsens',
  },
  {
    label: 'Simulate Ship Bunching',
    icon: <Waves className="w-4 h-4" />,
    payload: { action: 'BUNCH_SHIPS', count: 5 },
    color: 'border-rose-700/50 text-rose-300 bg-rose-950/30',
    hoverColor: 'hover:bg-rose-900/40 hover:border-rose-500/60',
    description: 'Pre-berthing detention spikes, road congestion predicted',
  },
  {
    label: 'Restore Normal State',
    icon: <RotateCcw className="w-4 h-4" />,
    payload: { action: 'RESET_SIMULATION' },
    color: 'border-emerald-700/50 text-emerald-300 bg-emerald-950/30',
    hoverColor: 'hover:bg-emerald-900/40 hover:border-emerald-500/60',
    description: 'Reset all state to baseline',
  },
  {
    label: 'Heavy rain',
    icon: <CloudRain className="w-4 h-4" />,
    payload: { action: 'APPLY_SCENARIO', scenarioId: 'heavy_rain' as ScenarioId },
    color: 'border-sky-700/50 text-sky-200 bg-sky-950/30',
    hoverColor: 'hover:bg-sky-900/40 hover:border-sky-500/60',
    description: 'Slower gate & yard (timing matrix)',
  },
  {
    label: 'Crane breakdown',
    icon: <Wrench className="w-4 h-4" />,
    payload: { action: 'APPLY_SCENARIO', scenarioId: 'crane_breakdown' as ScenarioId },
    color: 'border-violet-700/50 text-violet-200 bg-violet-950/30',
    hoverColor: 'hover:bg-violet-900/40 hover:border-violet-500/60',
    description: 'One LOADING vessel loses cranes → longer berth stay',
  },
  {
    label: 'Truck surge',
    icon: <Truck className="w-4 h-4" />,
    payload: { action: 'APPLY_SCENARIO', scenarioId: 'truck_inbound_surge' as ScenarioId },
    color: 'border-orange-600/50 text-orange-200 bg-orange-950/30',
    hoverColor: 'hover:bg-orange-900/40 hover:border-orange-500/60',
    description: 'Higher truck arrival rate at gates',
  },
  {
    label: 'Yard saturation',
    icon: <Container className="w-4 h-4" />,
    payload: { action: 'APPLY_SCENARIO', scenarioId: 'yard_near_saturation' as ScenarioId },
    color: 'border-amber-600/50 text-amber-200 bg-amber-950/30',
    hoverColor: 'hover:bg-amber-900/40 hover:border-amber-500/60',
    description: 'Start from ~90% yard occupancy',
  },
  {
    label: 'Clear scenarios',
    icon: <CloudOff className="w-4 h-4" />,
    payload: { action: 'CLEAR_SCENARIOS' },
    color: 'border-slate-600/50 text-slate-300 bg-slate-900/40',
    hoverColor: 'hover:bg-slate-800/60 hover:border-slate-500/60',
    description: 'Remove what-if multipliers and crane fault',
  },
];

export function SimulationControls() {
  const hydrateFromState         = useSimulationStore((s) => s.hydrateFromState);
  const setPocSnapshot           = useSimulationStore((s) => s.setPocSnapshot);
  const clearPocSnapshot         = useSimulationStore((s) => s.clearPocSnapshot);
  const addEvents                = useSimulationStore((s) => s.appendEvents);
  const setPendingScenarioAdvice = useSimulationStore((s) => s.setPendingScenarioAdvice);
  const [loading, setLoading] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  async function triggerAction(action: SimAction) {
    setLoading(action.label);
    try {
      const res = await fetch('/api/simulation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.payload),
      });
      const data = await res.json();
      if (data.success) {
        const u = data.updatedState;
        const a = action.payload.action as string;
        const st = useSimulationStore.getState();
        if (a === 'APPLY_SCENARIO' && !st.pocSnapshot && st.kpis) {
          const sid = (action.payload as { scenarioId?: string }).scenarioId;
          setPocSnapshot({
            baselineKpis: { ...st.kpis },
            baselineLabel: 'Pre-scenario baseline',
            activeScenarioIds:
              u.simulationFlags?.activeScenarioIds?.length
                ? u.simulationFlags.activeScenarioIds
                : sid
                  ? [sid]
                  : [],
            capturedAt: Date.now(),
          });
        }
        if (a === 'CLEAR_SCENARIOS' || a === 'RESET_SIMULATION') {
          clearPocSnapshot();
        }

        const prevIds = new Set(st.eventLog.map((e) => e.id));
        const nextEvents = Array.isArray(u.eventLog) ? u.eventLog : [];
        const newEvents = nextEvents.filter((e: any) => e?.id && !prevIds.has(e.id));

        hydrateFromState({
          vessels: u.vessels,
          gates: u.gates,
          trucks: u.trucks,
          alerts: u.alerts,
          kpis: u.kpis,
          yard: u.yard,
          eventLog: u.eventLog,
          simulationFlags: u.simulationFlags,
          lastTimingProfile: u.lastTimingProfile,
        });
        if (newEvents.length > 0) addEvents(newEvents);
        if (data.toastMessage) {
          toast.info(data.toastMessage, { duration: 5000 });
        }

        // Prompt AI Advisor (user-initiated — no auto API call)
        const noAdviceActions = new Set(['RESET_SIMULATION', 'CLEAR_SCENARIOS', 'OPEN_GATE']);
        if (!noAdviceActions.has(a)) {
          const sid = (action.payload as { scenarioId?: string }).scenarioId ?? a;
          setPendingScenarioAdvice({ scenarioId: sid, scenarioLabel: action.label, triggeredAt: Date.now() });
        }

        setLastAction(action.label);
        setTimeout(() => setLastAction(null), 3000);
      }
    } catch (err) {
      console.error('Simulation action failed:', err);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-slate-900/95 border-t border-slate-700/60 backdrop-blur-sm">
      <div className="px-4 py-2 flex items-center gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <FlaskConical className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            What-If Simulation Engine
          </span>
        </div>
        <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

        <div className="flex items-center gap-2 flex-wrap flex-1">
          {ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => triggerAction(action)}
              disabled={loading !== null}
              title={action.description}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium
                transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                ${action.color} ${action.hoverColor}
              `}
            >
              {loading === action.label ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                action.icon
              )}
              {action.label}
            </button>
          ))}
        </div>

        {lastAction && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-900/30 border border-emerald-700/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-300 font-medium">{lastAction} applied</span>
          </div>
        )}
      </div>
    </div>
  );
}
