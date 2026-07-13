/**
 * useInterval.ts
 * Custom polling hook for Port ICCC real-time data refresh.
 * Used to poll API endpoints every 5 seconds for live port state updates.
 */

'use client';

import { useEffect, useRef } from 'react';

/**
 * Repeatedly calls a callback on a given interval.
 * Safely handles cleanup on unmount and interval changes.
 *
 * @param callback - Function to call on each interval tick
 * @param delay - Interval in milliseconds (null to pause)
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<() => void>(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const tick = () => savedCallback.current();
    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay]);
}
