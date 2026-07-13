/**
 * useSimulation.ts
 * Simulation state consumer hook for Port Digital Twin.
 * Handles initial load and 5-second polling for all port state data.
 */

'use client';

import { useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useInterval } from './useInterval';
import { useSimulationStore } from '@/store/useSimulationStore';
import type { PocDataStatus } from '@/lib/pocDataStatusTypes';

const POLL_INTERVAL = 5000;

/**
 * Initialize simulation state and start 5-second polling.
 * Called once in the root dashboard layout.
 */
export function useSimulation() {
  const lastVesselFallbackRef = useRef<string | null>(null);
  const lastVesselToastAt = useRef(0);

  const {
    setVessels, setGates, setTrucks, setAlerts, setKPIs,
    setIsLoading, setLastUpdated, hydrateFromState, setDataProvenance,
  } = useSimulationStore();

  const fetchFullState = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation/state');
      if (!res.ok) return;
      const data = await res.json();
      hydrateFromState({
        vessels: data.vessels || [],
        gates: data.gates || [],
        trucks: data.trucks || [],
        alerts: data.alerts || [],
        kpis: data.kpis,
        simTime: data.simTime,
        yard: data.yard,
        eventLog: data.eventLog,
        simulationFlags: data.simulationFlags,
        lastTimingProfile: data.lastTimingProfile,
      });
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('Failed to fetch simulation state:', err);
    }
  }, [hydrateFromState, setLastUpdated]);

  const pollKPIs = useCallback(async () => {
    try {
      const res = await fetch('/api/kpi');
      if (!res.ok) return;
      const data = await res.json();
      setKPIs(data);
    } catch { /* silent fail */ }
  }, [setKPIs]);

  const pollAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(data);
    } catch { /* silent fail */ }
  }, [setAlerts]);

  const pollVessels = useCallback(async () => {
    try {
      const res = await fetch('/api/vessels');
      if (!res.ok) return;
      const reason = res.headers.get('X-Data-Fallback-Reason');
      const data = await res.json();
      setVessels(data);
      if (reason) {
        const now = Date.now();
        if (reason !== lastVesselFallbackRef.current || now - lastVesselToastAt.current > 60_000) {
          lastVesselFallbackRef.current = reason;
          lastVesselToastAt.current = now;
          toast.info(`Vessel feed: using simulation — ${reason}`, { duration: 5000, id: 'poc-vessel-fallback' });
        }
      } else {
        lastVesselFallbackRef.current = null;
      }
    } catch { /* silent fail */ }
  }, [setVessels]);

  const pollGates = useCallback(async () => {
    try {
      const res = await fetch('/api/gates');
      if (!res.ok) return;
      const data = await res.json();
      setGates(data);
    } catch { /* silent fail */ }
  }, [setGates]);

  const pollTrucks = useCallback(async () => {
    try {
      const res = await fetch('/api/trucks');
      if (!res.ok) return;
      const data = await res.json();
      setTrucks(data);
    } catch { /* silent fail */ }
  }, [setTrucks]);

  const pollDataProvenance = useCallback(async () => {
    try {
      const res = await fetch('/api/poc/data-status');
      if (!res.ok) return;
      const data = (await res.json()) as PocDataStatus;
      setDataProvenance(data);
    } catch {
      setDataProvenance(null);
    }
  }, [setDataProvenance]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    fetchFullState().finally(() => setIsLoading(false));
    pollDataProvenance();
  }, [fetchFullState, setIsLoading, pollDataProvenance]);

  // 5-second polling for live updates
  useInterval(pollKPIs, POLL_INTERVAL);
  useInterval(pollAlerts, POLL_INTERVAL);
  useInterval(pollVessels, POLL_INTERVAL + 1000);
  useInterval(pollGates, POLL_INTERVAL + 1200);
  useInterval(pollTrucks, POLL_INTERVAL + 1400);
  useInterval(pollDataProvenance, POLL_INTERVAL);
}
