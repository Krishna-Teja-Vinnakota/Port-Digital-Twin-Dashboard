'use client';

/**
 * VesselMiniMap — embedded HERE Maps panel scoped to a single vessel.
 *
 * Renders the vessel marker + its assigned trucks, auto-pans to follow
 * the vessel each poll, and applies the same ease-out position interpolation
 * used in the main MapPanel. Falls back gracefully without an API key.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSimulationStore } from '@/store/useSimulationStore';

// ── SVG markers (identical to MapPanel) ───────────────────────────────────────

function shipSVG(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.5"/>` +
    `<path d="M4 17l2-7h12l2 7H4z" fill="${color}" fill-opacity="0.85"/>` +
    `<rect x="10" y="5" width="4" height="7" rx="0.5" fill="${color}"/>` +
    `<path d="M3 21c3-2 6-2 9 0s6 2 9 0" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `</svg>`
  );
}

function anchorSVG(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>` +
    `<circle cx="12" cy="6" r="2.5" fill="${color}"/>` +
    `<line x1="12" y1="9" x2="12" y2="21" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M6 12H3a9 9 0 0 0 18 0h-3" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `</svg>`
  );
}

function truckSVG(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">` +
    `<rect x="1" y="1" width="22" height="22" rx="3" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1"/>` +
    `<path d="M1 4h14v10H1z" fill="${color}" fill-opacity="0.55"/>` +
    `<path d="M15 8h5l3 5v3h-8V8z" fill="${color}" fill-opacity="0.65"/>` +
    `<circle cx="5.5" cy="17.5" r="2" fill="${color}"/>` +
    `<circle cx="18.5" cy="17.5" r="2" fill="${color}"/>` +
    `</svg>`
  );
}

// ── Color maps ────────────────────────────────────────────────────────────────

const VESSEL_COLORS: Record<string, string> = {
  APPROACHING: '#3b82f6',
  ANCHORED:    '#f59e0b',
  BERTHING:    '#38bdf8',
  LOADING:     '#22c55e',
  DEPARTING:   '#94a3b8',
};

const TRUCK_COLORS: Record<string, string> = {
  APPROACHING:       '#38bdf8',
  APPROACHING_PORT:  '#38bdf8',
  GATE_QUEUE:        '#ef4444',
  CUSTOMS_CHECK:     '#f97316',
  YARD_TRANSIT:      '#eab308',
  LOADING:           '#22c55e',
  LOADING_UNLOADING: '#22c55e',
  EXITING:           '#94a3b8',
};

// Zoom level per lifecycle state — closer when operational, wider when at sea
const LIFECYCLE_ZOOM: Record<string, number> = {
  APPROACHING: 11,
  ANCHORED:    12,
  BERTHING:    13,
  LOADING:     14,
  DEPARTING:   11,
};

// ── Port geometry ─────────────────────────────────────────────────────────────

const BERTH_CENTER  = { lat: 18.9510, lng: 72.9420 };
const SEA_DEPARTURE = { lat: 18.820,  lng: 72.720  };

// ── HERE CDN helpers (idempotent — safe to call alongside MapPanel) ───────────

const HERE_CDN = 'https://js.api.here.com/v3/3.1';

// Module-level cache prevents duplicate <script> tags when multiple maps mount simultaneously
const _scriptCache = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  if (_scriptCache.has(src)) return _scriptCache.get(src)!;

  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if ((existing as any).dataset.loaded === 'true') { resolve(); return; }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`HERE: failed ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = () => { (s as any).dataset.loaded = 'true'; resolve(); };
    s.onerror = () => reject(new Error(`HERE: failed ${src}`));
    document.head.appendChild(s);
  });

  _scriptCache.set(src, p);
  return p;
}

function loadCSS(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

function addPolyline(H: any, map: any, pts: { lat: number; lng: number }[], color: string, w = 2) {
  const ls = new H.geo.LineString();
  pts.forEach(p => ls.pushPoint(p));
  return map.addObject(
    new H.map.Polyline(ls, { style: { strokeColor: color, lineWidth: w, lineDash: [4, 5] } }),
  );
}

// ── Animation duration — matches main MapPanel ────────────────────────────────
const ANIM_MS = 4200;

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  vesselId: string;
  /** Container height in px. Default 260. */
  height?: number;
  className?: string;
}

export function VesselMiniMap({ vesselId, height = 260, className = '' }: Props) {
  const mapRef       = useRef<HTMLDivElement>(null);
  const mapInstance  = useRef<any>(null);
  const markersRef   = useRef<Record<string, any>>({});
  const HRef         = useRef<any>(null);
  const dlRef        = useRef<any>(null);

  // Per-vessel interpolation state
  const animFromRef  = useRef<{ lat: number; lng: number } | null>(null);
  const animToRef    = useRef<{ lat: number; lng: number } | null>(null);
  const animFrameRef = useRef<number>(0);
  const animStartRef = useRef<number>(0);
  const lastStateRef = useRef<string>('');

  const [mapReady, setMapReady] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_HERE_API_KEY;
  const vessel    = useSimulationStore(s => s.vessels.find(v => v.id === vesselId));
  const allTrucks = useSimulationStore(s => s.trucks);
  const trucks    = useMemo(
    () => allTrucks.filter(t => t.assignedVesselId === vesselId || t.assignedVessel === vesselId),
    [allTrucks, vesselId],
  );

  // ── Initialise HERE Maps ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !apiKey || !vessel) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    // Capture vessel at effect invocation time — safe inside async closure
    const v0 = vessel;

    async function init() {
      try {
        loadCSS(`${HERE_CDN}/mapsjs-ui.css`);
        await loadScript(`${HERE_CDN}/mapsjs-core.js`);
        let t = 0;
        while (!(window as any).H && t++ < 10) await new Promise(r => setTimeout(r, 100));
        if (!(window as any).H) throw new Error('H not defined');

        await loadScript(`${HERE_CDN}/mapsjs-service.js`);
        await loadScript(`${HERE_CDN}/mapsjs-ui.js`);
        await loadScript(`${HERE_CDN}/mapsjs-mapevents.js`);
        if (cancelled || !mapRef.current) return;

        const H = (window as any).H;
        HRef.current = H;

        const platform = new H.service.Platform({ apikey: apiKey });
        const dl = platform.createDefaultLayers();
        dlRef.current = dl;

        const base =
          dl.vector?.normal?.truck ??
          dl.vector?.normal?.map ??
          dl.raster?.normal?.map;
        if (!base) throw new Error('No base layer');

        const zoom = LIFECYCLE_ZOOM[v0.lifecycleState] ?? 13;
        const hMap = new H.Map(mapRef.current, base, {
          center: { lat: v0.position.lat, lng: v0.position.lng },
          zoom,
          pixelRatio: window.devicePixelRatio || 1,
        });

        // Enable pan/zoom gestures (read-only is fine — users can explore)
        new H.mapevents.Behavior(new H.mapevents.MapEvents(hMap));

        ro = new ResizeObserver(() => hMap?.getViewPort()?.resize());
        if (mapRef.current) ro.observe(mapRef.current);

        mapInstance.current = hMap;
        lastStateRef.current = v0.lifecycleState;
        setTimeout(() => hMap?.getViewPort()?.resize(), 100);
        setMapReady(true);
      } catch (err) {
        console.error('[VesselMiniMap] init failed:', err);
      }
    }

    init();

    return () => {
      cancelled = true;
      ro?.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      if (mapInstance.current) {
        mapInstance.current.dispose();
        mapInstance.current = null;
        markersRef.current = {};
      }
      setMapReady(false);
    };
  // Re-init only if the vessel being tracked or the API key changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, vesselId]);

  // ── Vessel marker + auto-follow ─────────────────────────────────────────────
  useEffect(() => {
    const H   = HRef.current;
    const map = mapInstance.current;
    if (!H || !map || !mapReady || !vessel) return;

    cancelAnimationFrame(animFrameRef.current);

    const targetPos  = { lat: vessel.position.lat, lng: vessel.position.lng };
    const color      = VESSEL_COLORS[vessel.lifecycleState] ?? '#3b82f6';
    const svg        = vessel.lifecycleState === 'ANCHORED' ? anchorSVG(color) : shipSVG(color);
    const ICON_SIZE  = { w: 32, h: 32 };

    if (markersRef.current['v']) {
      // Capture mid-animation position as new interpolation start
      const geo = markersRef.current['v'].getGeometry() as { lat: number; lng: number };
      animFromRef.current = { lat: geo.lat, lng: geo.lng };
      animToRef.current   = targetPos;
      markersRef.current['v'].setIcon(new H.map.Icon(svg, { size: ICON_SIZE }));
    } else {
      const m = new H.map.Marker(targetPos, { icon: new H.map.Icon(svg, { size: ICON_SIZE }) });
      m.setData({ id: vessel.id, type: 'vessel' });
      map.addObject(m);
      markersRef.current['v'] = m;
      animFromRef.current = targetPos;
      animToRef.current   = targetPos;
    }

    // Route line (direction indicator to berth / open sea)
    if (markersRef.current['route']) {
      map.removeObject(markersRef.current['route']);
      delete markersRef.current['route'];
    }
    if (['APPROACHING', 'ANCHORED', 'BERTHING'].includes(vessel.lifecycleState)) {
      markersRef.current['route'] = addPolyline(H, map, [targetPos, BERTH_CENTER], color + '66');
    } else if (vessel.lifecycleState === 'DEPARTING') {
      markersRef.current['route'] = addPolyline(H, map, [targetPos, SEA_DEPARTURE], color + '66');
    }

    // Auto-zoom when lifecycle state changes (smooth visual cue)
    if (vessel.lifecycleState !== lastStateRef.current) {
      map.setZoom(LIFECYCLE_ZOOM[vessel.lifecycleState] ?? 13);
      lastStateRef.current = vessel.lifecycleState;
    }

    // Auto-pan: re-center on the target position each poll
    map.setCenter(targetPos);

    // Ease-out cubic marker interpolation (4.2 s, same as MapPanel)
    animStartRef.current = performance.now();

    function animate(now: number) {
      const t    = Math.min((now - animStartRef.current) / ANIM_MS, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const from = animFromRef.current;
      const to   = animToRef.current;
      const mk   = markersRef.current['v'];
      if (from && to && mk) {
        mk.setGeometry({
          lat: from.lat + (to.lat - from.lat) * ease,
          lng: from.lng + (to.lng - from.lng) * ease,
        });
      }
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [vessel, mapReady]);

  // ── Truck markers ───────────────────────────────────────────────────────────
  useEffect(() => {
    const H   = HRef.current;
    const map = mapInstance.current;
    if (!H || !map || !mapReady) return;

    const desired = new Set<string>();

    trucks.slice(0, 20).forEach(t => {
      if (!t.position) return;
      const pos   = { lat: t.position.lat, lng: t.position.lng };
      const color = TRUCK_COLORS[t.state] ?? '#94a3b8';
      const mk    = `t-${t.id}`;
      desired.add(mk);

      if (markersRef.current[mk]) {
        markersRef.current[mk].setGeometry(pos);
        markersRef.current[mk].setIcon(
          new H.map.Icon(truckSVG(color), { size: { w: 20, h: 20 } }),
        );
      } else {
        const m = new H.map.Marker(pos, {
          icon: new H.map.Icon(truckSVG(color), { size: { w: 20, h: 20 } }),
        });
        map.addObject(m);
        markersRef.current[mk] = m;
      }
    });

    Object.keys(markersRef.current).forEach(k => {
      if (!k.startsWith('t-')) return;
      if (!desired.has(k)) {
        map.removeObject(markersRef.current[k]);
        delete markersRef.current[k];
      }
    });
  }, [trucks, mapReady]);

  // ── No API key fallback ─────────────────────────────────────────────────────
  if (!apiKey) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-900/60 rounded-xl border border-slate-700/50 ${className}`}
        style={{ height }}
      >
        <p className="text-[10px] text-slate-500 text-center px-4">
          Map requires{' '}
          <code className="font-mono text-[10px] bg-slate-800 px-1 rounded">
            NEXT_PUBLIC_HERE_API_KEY
          </code>
        </p>
      </div>
    );
  }

  if (!vessel) return null;

  const stateColor = VESSEL_COLORS[vessel.lifecycleState] ?? '#94a3b8';

  return (
    <div
      className={`relative rounded-xl overflow-hidden border border-slate-700/50 ${className}`}
      style={{ height }}
    >
      {/* Map canvas */}
      <div
        ref={mapRef}
        className="absolute inset-0"
        style={{ background: '#0f172a' }}
      />

      {/* LIVE badge — top left */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-sm px-2 py-1 rounded-full border border-slate-700/60 pointer-events-none select-none">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[9px] font-bold text-emerald-400 tracking-wider">LIVE</span>
      </div>

      {/* Vessel info overlay — bottom left */}
      <div className="absolute bottom-2 left-2 z-10 bg-slate-950/85 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-slate-700/60 pointer-events-none select-none">
        <p className="text-[10px] font-semibold text-slate-100 leading-tight">{vessel.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="text-[9px] font-bold"
            style={{ color: stateColor }}
          >
            {vessel.lifecycleState}
          </span>
          {vessel.berthNumber && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-[9px] text-slate-400 font-mono">Berth {vessel.berthNumber}</span>
            </>
          )}
        </div>
        <p className="text-[9px] text-slate-500 mt-0.5 font-mono">
          {vessel.position.lat.toFixed(4)}°N {vessel.position.lng.toFixed(4)}°E
        </p>
      </div>

      {/* Truck count — bottom right */}
      {trucks.length > 0 && (
        <div className="absolute bottom-2 right-2 z-10 bg-slate-950/85 backdrop-blur-sm px-2 py-1 rounded-lg border border-slate-700/60 pointer-events-none select-none">
          <p className="text-[9px] text-slate-400">
            <span className="font-bold text-slate-200">{trucks.length}</span>
            {' '}truck{trucks.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Loading shimmer while map initialises */}
      {!mapReady && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0f172a]">
          <div className="flex items-center gap-2 text-slate-500 text-xs">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            Loading map…
          </div>
        </div>
      )}
    </div>
  );
}
