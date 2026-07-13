/**
 * AlertsPanel.tsx
 * Real-time alert feed for Port ICCC using RFP-defined alert types.
 * Polled every 5 seconds. Shows chronological alert card stack with dismiss action.
 */

'use client';

import { useSimulationStore, Alert } from '@/store/useSimulationStore';
import { Bell, X, TriangleAlert as AlertTriangle, Info, OctagonAlert as AlertOctagon, Flame } from 'lucide-react';
import { format } from 'date-fns';

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'border-l-red-500 bg-red-950/30',
  HIGH: 'border-l-red-400 bg-red-900/20',
  MEDIUM: 'border-l-amber-400 bg-amber-900/20',
  LOW: 'border-l-blue-400 bg-blue-900/20',
};

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-900 text-red-300 border border-red-700',
  HIGH: 'bg-red-900/60 text-red-300 border border-red-700/50',
  MEDIUM: 'bg-amber-900/60 text-amber-300 border border-amber-700/50',
  LOW: 'bg-blue-900/60 text-blue-300 border border-blue-700/50',
};

const ORIGIN_BADGE: Record<string, string> = {
  LIVE: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50',
  SIMULATED: 'bg-slate-800 text-slate-300 border border-slate-600/60',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  GATE_OVERLOAD: 'Gate Overload',
  VESSEL_BUNCHING: 'Vessel Bunching',
  HIGH_EMISSIONS: 'High Emissions',
  PRE_BERTHING_DELAY: 'Pre-Berthing Delay',
  POWER_FAULT: 'Power Fault',
  FIRE_HAZARD: 'Fire Hazard',
  PERIMETER_BREACH: 'Perimeter Breach',
  ENCROACHMENT: 'Encroachment',
  RAKE_DELAY: 'Rake Delay',
  VESSEL_DELAY: 'Vessel Delay',
  HIGH_BERTH_OCCUPANCY: 'High Berth Occupancy',
  TRUCK_SURGE: 'Truck Surge',
};

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'CRITICAL') return <Flame className="w-3.5 h-3.5 text-red-400" />;
  if (severity === 'HIGH') return <AlertOctagon className="w-3.5 h-3.5 text-red-400" />;
  if (severity === 'MEDIUM') return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
  return <Info className="w-3.5 h-3.5 text-blue-400" />;
}

function AlertCard({ alert, onDismiss }: { alert: Alert; onDismiss: (id: string) => void }) {
  return (
    <div className={`border-l-2 rounded-r-lg p-3 mb-2 transition-all ${SEVERITY_STYLES[alert.severity] || 'border-l-slate-500 bg-slate-800'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SeverityIcon severity={alert.severity} />
          <span className="text-xs font-semibold text-slate-200 truncate">
            {ALERT_TYPE_LABELS[alert.type] || alert.type}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${SEVERITY_BADGE[alert.severity]}`}>
            {alert.severity}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
              ORIGIN_BADGE[alert.origin || 'SIMULATED']
            }`}
          >
            {alert.origin || 'SIMULATED'}
          </span>
        </div>
        <button
          onClick={() => onDismiss(alert.id)}
          className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors p-0.5 rounded"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">{alert.message}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-slate-500 truncate flex-1 mr-2">{alert.affectedEntity}</span>
        <span className="text-[10px] text-slate-600 shrink-0">
          {format(new Date(alert.timestamp), 'HH:mm:ss')}
        </span>
      </div>
      {alert.source && (
        <div className="mt-1 text-[10px] text-slate-600">
          Source: {alert.source}
        </div>
      )}
    </div>
  );
}

export function AlertsPanel() {
  const { alerts, dismissAlert } = useSimulationStore();
  const activeAlerts = alerts.filter(a => !a.dismissed);

  const critical = activeAlerts.filter(a => a.severity === 'CRITICAL').length;
  const high = activeAlerts.filter(a => a.severity === 'HIGH').length;

  async function handleDismiss(id: string) {
    dismissAlert(id);
    await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' }).catch(() => {});
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className={`w-4 h-4 ${critical > 0 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`} />
          <span className="text-sm font-semibold text-slate-200">Alert Feed</span>
        </div>
        <div className="flex items-center gap-2">
          {critical > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900 text-red-300 font-bold animate-pulse">
              {critical} CRITICAL
            </span>
          )}
          {high > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/50 text-red-300 font-bold">
              {high} HIGH
            </span>
          )}
          <span className="text-xs text-slate-500">{activeAlerts.length} active</span>
        </div>
      </div>

      {/* Alert stack */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0">
        {activeAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Bell className="w-8 h-8 text-slate-700 mb-2" />
            <p className="text-xs text-slate-500">All clear — no active alerts</p>
          </div>
        ) : (
          activeAlerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} onDismiss={handleDismiss} />
          ))
        )}
      </div>
    </div>
  );
}
