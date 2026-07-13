/**
 * RoleSelector.tsx
 * Role-based access panel switcher for Port ICCC operators.
 * Changes which dashboard panels are foregrounded based on operator role.
 */

'use client';

import { useSimulationStore, UserRole } from '@/store/useSimulationStore';
import { ChevronDown, Shield, Truck, Zap, Leaf } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const ROLES: { role: UserRole; icon: React.ReactNode; desc: string }[] = [
  { role: 'Port Authority', icon: <Shield className="w-4 h-4" />, desc: 'Full access — all panels' },
  { role: 'Traffic Controller', icon: <Truck className="w-4 h-4" />, desc: 'Map + Gates + Trucks' },
  { role: 'Energy Manager', icon: <Zap className="w-4 h-4" />, desc: 'Substation grid + Consumption' },
  { role: 'Environmental Officer', icon: <Leaf className="w-4 h-4" />, desc: 'NDVI + AQI + Water quality' },
];

export function RoleSelector() {
  const { userRole, setUserRole } = useSimulationStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = ROLES.find(r => r.role === userRole) || ROLES[0];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-700/60 hover:border-cyan-500/50 hover:bg-slate-700/80 transition-all text-sm font-medium text-slate-200 min-w-[180px]"
      >
        <span className="text-cyan-400">{current.icon}</span>
        <span className="flex-1 text-left">{current.role}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/60">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Operator Role</p>
          </div>
          {ROLES.map(({ role, icon, desc }) => (
            <button
              key={role}
              onClick={() => { setUserRole(role); setOpen(false); }}
              className={`w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-slate-800 transition-colors ${
                userRole === role ? 'bg-cyan-950/50 border-l-2 border-cyan-400' : 'border-l-2 border-transparent'
              }`}
            >
              <span className={`mt-0.5 ${userRole === role ? 'text-cyan-400' : 'text-slate-400'}`}>{icon}</span>
              <div>
                <p className={`text-sm font-medium ${userRole === role ? 'text-cyan-300' : 'text-slate-200'}`}>{role}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
