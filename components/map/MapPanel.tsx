'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimulationStore } from '@/store/useSimulationStore';
import { Port_PORT_CONFIG } from '@/lib/portConfig';

// ─── SVG markers (filled for better map visibility) ───────────────────────────

function shipSVG(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.5"/>` +
    `<path d="M4 17l2-7h12l2 7H4z" fill="${color}" fill-opacity="0.85"/>` +
    `<rect x="10" y="5" width="4" height="7" rx="0.5" fill="${color}"/>` +
    `<path d="M3 21c3-2 6-2 9 0s6 2 9 0" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `</svg>`
  );
}

function anchorSVG(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>` +
    `<circle cx="12" cy="6" r="2.5" fill="${color}"/>` +
    `<line x1="12" y1="9" x2="12" y2="21" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M6 12H3a9 9 0 0 0 18 0h-3" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `</svg>`
  );
}

function gateSVG(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">` +
    `<rect x="2" y="2" width="20" height="20" rx="3" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="2"/>` +
    `<path d="M9 2v20M15 2v20M2 9h20M2 15h20" stroke="${color}" stroke-width="1.5"/>` +
    `</svg>`
  );
}

function coloredTruckSVG(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">` +
    `<rect x="1" y="1" width="22" height="22" rx="3" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1"/>` +
    `<path d="M1 4h14v10H1z" fill="${color}" fill-opacity="0.55"/>` +
    `<path d="M15 8h5l3 5v3h-8V8z" fill="${color}" fill-opacity="0.65"/>` +
    `<circle cx="5.5" cy="17.5" r="2" fill="${color}"/>` +
    `<circle cx="18.5" cy="17.5" r="2" fill="${color}"/>` +
    `</svg>`
  );
}

// ─── Color maps ───────────────────────────────────────────────────────────────

const VESSEL_COLORS: Record<string, string> = {
  APPROACHING: '#3b82f6',
  ANCHORED:    '#f59e0b',
  BERTHING:    '#38bdf8',
  LOADING:     '#22c55e',
  DEPARTING:   '#94a3b8',
};

const TRUCK_COLORS: Record<string, string> = {
  APPROACHING:        '#38bdf8',
  APPROACHING_PORT:   '#38bdf8',
  GATE_QUEUE:         '#ef4444',
  CUSTOMS_CHECK:      '#f97316',
  YARD_TRANSIT:       '#eab308',
  LOADING:            '#22c55e',
  LOADING_UNLOADING:  '#22c55e',
  EXITING:            '#94a3b8',
};

const VESSEL_STATE_LABELS: [string, string][] = [
  ['APPROACHING', 'Approaching'],
  ['ANCHORED',    'Anchored'],
  ['BERTHING',    'Berthing'],
  ['LOADING',     'Loading'],
  ['DEPARTING',   'Departing'],
];

const TRUCK_STATE_LABELS: [string, string][] = [
  ['APPROACHING_PORT',  'Approaching'],
  ['GATE_QUEUE',        'Gate Queue'],
  ['CUSTOMS_CHECK',     'Customs'],
  ['YARD_TRANSIT',      'Yard Transit'],
  ['LOADING_UNLOADING', 'Loading/Ops'],
  ['EXITING',           'Exiting'],
];

// ─── Port geometry ────────────────────────────────────────────────────────────

const PORT_CENTER    = { lat: 18.9442, lng: 72.9479 };
const BERTH_CENTER   = { lat: 18.9510, lng: 72.9420 };
// Point vessels aim for when departing — into the open Arabian Sea
const SEA_DEPARTURE  = { lat: 18.820, lng: 72.720 };
// Exit point on NH348 where trucks leave the port estate
const TRUCK_EXIT_PT  = { lat: 18.9610, lng: 72.9740 };

function nearestGatePos(lat: number, lng: number) {
  let best = Port_PORT_CONFIG.gates[0]!;
  let bestD = Infinity;
  for (const g of Port_PORT_CONFIG.gates) {
    const d = (g.position.lat - lat) ** 2 + (g.position.lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = g; }
  }
  return best.position;
}

// ─── CDN helpers ──────────────────────────────────────────────────────────────

const HERE_CDN = 'https://js.api.here.com/v3/3.1';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
}

function loadCSS(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

function addPolyline(H: any, map: any, points: { lat: number; lng: number }[], color: string, width = 2, dash = true) {
  const ls = new H.geo.LineString();
  points.forEach(p => ls.pushPoint(p));
  return map.addObject(
    new H.map.Polyline(ls, {
      style: { strokeColor: color, lineWidth: width, ...(dash ? { lineDash: [4, 5] } : {}) },
    }),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Duration (ms) to interpolate vessel markers between each 5-second server poll.
const VESSEL_ANIM_MS = 4200;

export default function MapPanel() {
  const mapRef      = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersRef  = useRef<Record<string, any>>({});
  const HRef        = useRef<any>(null);
  const bubbleRef   = useRef<any>(null);
  const dlRef       = useRef<any>(null); // defaultLayers ref for UI

  // Per-vessel animation state: from-position and to-position for the current tween.
  const vesselAnimFromRef = useRef<Record<string, { lat: number; lng: number }>>({});
  const vesselAnimToRef   = useRef<Record<string, { lat: number; lng: number }>>({});
  const vesselAnimFrameRef = useRef<number>(0);
  const vesselAnimStartRef = useRef<number>(0);

  const [coords,   setCoords]   = useState<{ lat: number; lng: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { vessels, trucks, gates, mapLayersVisible, toggleMapLayer } = useSimulationStore();
  const apiKey = process.env.NEXT_PUBLIC_HERE_API_KEY;

  // ── Initialise HERE Maps ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !apiKey) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;

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

        const hMap = new H.Map(mapRef.current, base, {
          center: PORT_CENTER, zoom: 13,
          pixelRatio: window.devicePixelRatio || 1,
        });

        hMap.addEventListener('pointermove', (ev: any) => {
          const c = hMap.screenToGeo(ev.currentPointer.viewportX, ev.currentPointer.viewportY);
          if (c) setCoords({ lat: c.lat, lng: c.lng });
        });

        hMap.addEventListener('tap', (ev: any) => {
          const d = (ev.target as any)?.getData?.();
          if (d?.id && d?.type) {
            useSimulationStore.getState().setSelectedEntity({ type: String(d.type), id: String(d.id) });
            const st   = useSimulationStore.getState();
            const id   = String(d.id);
            const type = String(d.type);
            let title  = '';
            const rows: { k: string; v: string }[] = [];

            if (type === 'truck') {
              const t = st.trucks.find(x => x.id === id);
              title = `Truck ${t?.plateNumber ?? id}`;
              if (t?.state)        rows.push({ k: 'State',       v: t.state });
              if (t?.destination)  rows.push({ k: 'Destination', v: t.destination });
              if (t?.cargoType)    rows.push({ k: 'Cargo',       v: t.cargoType });
              if (t?.entryTimestamp) rows.push({ k: 'Entry', v: new Date(t.entryTimestamp).toLocaleTimeString() });
              if (t?.assignedContainer) rows.push({ k: 'Container', v: t.assignedContainer });
            } else if (type === 'vessel') {
              const v = st.vessels.find(x => x.id === id);
              title = `Vessel ${v?.name ?? id}`;
              if (v?.lifecycleState) rows.push({ k: 'State',  v: v.lifecycleState });
              if (v?.type)           rows.push({ k: 'Type',   v: v.type });
              if (v?.berthNumber)    rows.push({ k: 'Berth',  v: v.berthNumber! });
              if (v?.flag)           rows.push({ k: 'Flag',   v: v.flag });
              if (v?.teuEstimate)    rows.push({ k: 'TEU',    v: `~${v.teuEstimate.value}` });
              if (v?.waitHours)      rows.push({ k: 'Wait',   v: `${v.waitHours.toFixed(1)} hrs` });
              if (v?.assignedCranes) rows.push({ k: 'Cranes', v: String(v.assignedCranes) });
              if (v?.eta)            rows.push({ k: 'ETA',    v: new Date(v.eta).toLocaleTimeString() });
            } else if (type === 'gate') {
              const g = st.gates.find(x => x.id === parseInt(id, 10));
              title = g?.name ?? `Gate ${id}`;
              if (g?.status)                  rows.push({ k: 'Status',          v: g.status });
              if (g?.queueLength != null)     rows.push({ k: 'Queue',           v: `${g.queueLength} trucks` });
              if (g?.congestionLevel)         rows.push({ k: 'Congestion',      v: g.congestionLevel });
              if (g?.trucksTodayProcessed != null) rows.push({ k: 'Processed Today', v: `${g.trucksTodayProcessed} trucks` });
              if (g?.avgProcessingTimeMins)   rows.push({ k: 'Avg Processing',  v: `${g.avgProcessingTimeMins} min` });
            }

            const html =
              `<div style="min-width:220px;font-family:ui-sans-serif,system-ui;background:#1e293b;padding:10px;border-radius:8px;color:#e2e8f0;">` +
              `<div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#f1f5f9;border-bottom:1px solid #334155;padding-bottom:6px;">${title}</div>` +
              rows.map(r =>
                `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;padding:3px 0;">` +
                `<span style="color:#94a3b8;">${r.k}</span>` +
                `<span style="color:#f1f5f9;font-weight:600;">${r.v}</span></div>`
              ).join('') + `</div>`;

            const ui   = H.ui.UI.getInstance?.(hMap) ?? H.ui.UI.createDefault(hMap, dl);
            const coord = hMap.screenToGeo(ev.currentPointer.viewportX, ev.currentPointer.viewportY);
            if (coord) {
              if (bubbleRef.current) ui.removeBubble(bubbleRef.current);
              bubbleRef.current = new H.ui.InfoBubble(coord, { content: html });
              ui.addBubble(bubbleRef.current);
            }
            return;
          }
          useSimulationStore.getState().setSelectedEntity(null);
          const ui = H.ui.UI.getInstance?.(hMap);
          if (ui && bubbleRef.current) { ui.removeBubble(bubbleRef.current); bubbleRef.current = null; }
        });

        ro = new ResizeObserver(() => hMap?.getViewPort()?.resize());
        if (mapRef.current) ro.observe(mapRef.current);

        new H.mapevents.Behavior(new H.mapevents.MapEvents(hMap));
        H.ui.UI.createDefault(hMap, dl);
        mapInstance.current = hMap;
        setTimeout(() => hMap?.getViewPort()?.resize(), 100);
        setMapReady(true);
      } catch (err) {
        console.error('[HERE Maps] init failed:', err);
      }
    }

    init();
    return () => {
      cancelled = true;
      ro?.disconnect();
      if (mapInstance.current) { mapInstance.current.dispose(); mapInstance.current = null; markersRef.current = {}; }
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // ── Vessel markers + approach routes (with smooth position interpolation) ────
  useEffect(() => {
    const H   = HRef.current;
    const map = mapInstance.current;
    if (!H || !map || !mapReady) return;

    // Cancel any running animation before processing the new frame.
    cancelAnimationFrame(vesselAnimFrameRef.current);

    if (!mapLayersVisible.vessels) {
      Object.keys(markersRef.current).filter(k => k.startsWith('vessel-') || k.startsWith('rv-')).forEach(k => {
        map.removeObject(markersRef.current[k]); delete markersRef.current[k];
      });
      return;
    }

    const desired = new Set<string>();

    vessels.forEach((v) => {
      if (!v.position) return;
      const targetPos  = { lat: v.position.lat, lng: v.position.lng };
      const color      = VESSEL_COLORS[v.lifecycleState] ?? '#3b82f6';
      const isAnchored = v.lifecycleState === 'ANCHORED';
      const svg        = isAnchored ? anchorSVG(color) : shipSVG(color);
      const mk         = `vessel-${v.id}`;
      const rk         = `rv-${v.id}`;
      desired.add(mk); desired.add(rk);

      if (markersRef.current[mk]) {
        // Capture wherever the marker currently sits (may be mid-animation)
        // as the new interpolation start, so movement is always smooth.
        const geo = markersRef.current[mk].getGeometry() as { lat: number; lng: number };
        vesselAnimFromRef.current[v.id] = { lat: geo.lat, lng: geo.lng };
        vesselAnimToRef.current[v.id]   = targetPos;
        markersRef.current[mk].setIcon(new H.map.Icon(svg, { size: { w: 28, h: 28 } }));
      } else {
        const m = new H.map.Marker(targetPos, { icon: new H.map.Icon(svg, { size: { w: 28, h: 28 } }) });
        m.setData({ id: v.id, type: 'vessel' });
        map.addObject(m);
        markersRef.current[mk] = m;
        // New marker — no movement to animate yet.
        vesselAnimFromRef.current[v.id] = targetPos;
        vesselAnimToRef.current[v.id]   = targetPos;
      }

      // Route lines always drawn from the target (final) position as a
      // direction indicator — they don't need to follow the animation.
      let vesselDest: { lat: number; lng: number } | null = null;
      if (v.lifecycleState === 'APPROACHING' || v.lifecycleState === 'ANCHORED' || v.lifecycleState === 'BERTHING') {
        vesselDest = BERTH_CENTER;
      } else if (v.lifecycleState === 'DEPARTING') {
        vesselDest = SEA_DEPARTURE;
      }
      if (vesselDest) {
        if (markersRef.current[rk]) { map.removeObject(markersRef.current[rk]); delete markersRef.current[rk]; }
        markersRef.current[rk] = addPolyline(H, map, [targetPos, vesselDest], color + '77', 2, true);
      } else {
        if (markersRef.current[rk]) { map.removeObject(markersRef.current[rk]); delete markersRef.current[rk]; desired.delete(rk); }
      }
    });

    Object.keys(markersRef.current).forEach(k => {
      if (!k.startsWith('vessel-') && !k.startsWith('rv-')) return;
      if (!desired.has(k)) { map.removeObject(markersRef.current[k]); delete markersRef.current[k]; }
    });

    // Kick off the interpolation loop.
    vesselAnimStartRef.current = performance.now();

    function animateVessels(now: number) {
      const elapsed = now - vesselAnimStartRef.current;
      const t       = Math.min(elapsed / VESSEL_ANIM_MS, 1);
      // Ease-out cubic: starts fast, decelerates into place.
      const ease    = 1 - Math.pow(1 - t, 3);

      for (const vId of Object.keys(vesselAnimToRef.current)) {
        const marker = markersRef.current[`vessel-${vId}`];
        if (!marker) continue;
        const from = vesselAnimFromRef.current[vId];
        const to   = vesselAnimToRef.current[vId];
        if (!from || !to) continue;
        marker.setGeometry({
          lat: from.lat + (to.lat - from.lat) * ease,
          lng: from.lng + (to.lng - from.lng) * ease,
        });
      }

      if (t < 1) {
        vesselAnimFrameRef.current = requestAnimationFrame(animateVessels);
      }
    }

    vesselAnimFrameRef.current = requestAnimationFrame(animateVessels);

    return () => cancelAnimationFrame(vesselAnimFrameRef.current);
  }, [vessels, mapLayersVisible.vessels, mapReady]);

  // ── Truck markers + transit routes ───────────────────────────────────────
  useEffect(() => {
    const H   = HRef.current;
    const map = mapInstance.current;
    if (!H || !map || !mapReady) return;

    if (!mapLayersVisible.trucks) {
      Object.keys(markersRef.current).filter(k => k.startsWith('truck-') || k.startsWith('rt-')).forEach(k => {
        map.removeObject(markersRef.current[k]); delete markersRef.current[k];
      });
      return;
    }

    const desired = new Set<string>();

    trucks.slice(0, 50).forEach((t) => {
      if (!t.position) return;
      const pos   = { lat: t.position.lat, lng: t.position.lng };
      const color = TRUCK_COLORS[t.state] ?? '#94a3b8';
      const svg   = coloredTruckSVG(color);
      const mk    = `truck-${t.id}`;
      const rk    = `rt-${t.id}`;
      desired.add(mk); desired.add(rk);

      if (markersRef.current[mk]) {
        markersRef.current[mk].setGeometry(pos);
        markersRef.current[mk].setIcon(new H.map.Icon(svg, { size: { w: 22, h: 22 } }));
        markersRef.current[mk].setData({ id: t.id, type: 'truck' });
      } else {
        const m = new H.map.Marker(pos, { icon: new H.map.Icon(svg, { size: { w: 22, h: 22 } }) });
        m.setData({ id: t.id, type: 'truck' });
        map.addObject(m);
        markersRef.current[mk] = m;
      }

      let routePts: { lat: number; lng: number }[] | null = null;
      const nearGate = nearestGatePos(pos.lat, pos.lng);
      if (t.state === 'APPROACHING' || t.state === 'APPROACHING_PORT') {
        // Heading to the nearest gate
        routePts = [pos, nearGate];
      } else if (t.state === 'GATE_QUEUE') {
        // Queued at gate, heading into the port yard
        routePts = [pos, PORT_CENTER];
      } else if (t.state === 'CUSTOMS_CHECK') {
        // Cleared customs, moving toward the yard
        routePts = [pos, PORT_CENTER];
      } else if (t.state === 'YARD_TRANSIT' || t.state === 'LOADING' || t.state === 'LOADING_UNLOADING') {
        // In the yard or at a loading point
        routePts = [pos, PORT_CENTER];
      } else if (t.state === 'EXITING') {
        // Leaving the terminal via NH348
        routePts = [pos, TRUCK_EXIT_PT];
      }

      if (routePts) {
        if (markersRef.current[rk]) { map.removeObject(markersRef.current[rk]); delete markersRef.current[rk]; }
        markersRef.current[rk] = addPolyline(H, map, routePts, color + '77', 2, true);
      } else {
        if (markersRef.current[rk]) { map.removeObject(markersRef.current[rk]); delete markersRef.current[rk]; desired.delete(rk); }
      }
    });

    Object.keys(markersRef.current).forEach(k => {
      if (!k.startsWith('truck-') && !k.startsWith('rt-')) return;
      if (!desired.has(k)) { map.removeObject(markersRef.current[k]); delete markersRef.current[k]; }
    });
  }, [trucks, mapLayersVisible.trucks, mapReady]);

  // ── Gate markers ──────────────────────────────────────────────────────────
  useEffect(() => {
    const H   = HRef.current;
    const map = mapInstance.current;
    if (!H || !map || !mapReady) return;

    if (!mapLayersVisible.gates) {
      Object.keys(markersRef.current).filter(k => k.startsWith('gate-')).forEach(k => {
        map.removeObject(markersRef.current[k]); delete markersRef.current[k];
      });
      return;
    }

    const { gateQueueMediumThreshold: med, gateQueueHighThreshold: high } = Port_PORT_CONFIG.defaults;
    const desired = new Set<string>();

    Port_PORT_CONFIG.gates.forEach(cfg => {
      const live  = gates.find(g => g.id === cfg.id);
      const q     = live?.queueLength ?? 0;
      const level = live?.congestionLevel ?? (q >= high ? 'HIGH' : q >= med ? 'MEDIUM' : 'LOW');
      const color = level === 'HIGH' ? '#ef4444' : level === 'MEDIUM' ? '#eab308' : '#22c55e';
      const pos   = live ? { lat: live.lat, lng: live.lng } : cfg.position;
      const key   = `gate-${cfg.id}`;
      desired.add(key);

      if (markersRef.current[key]) {
        markersRef.current[key].setGeometry(pos);
        markersRef.current[key].setIcon(new H.map.Icon(gateSVG(color), { size: { w: 26, h: 26 } }));
      } else {
        const m = new H.map.Marker(pos, { icon: new H.map.Icon(gateSVG(color), { size: { w: 26, h: 26 } }) });
        m.setData({ id: String(cfg.id), type: 'gate' });
        map.addObject(m);
        markersRef.current[key] = m;
      }
    });

    Object.keys(markersRef.current).filter(k => k.startsWith('gate-')).forEach(k => {
      if (!desired.has(k)) { map.removeObject(markersRef.current[k]); delete markersRef.current[k]; }
    });
  }, [gates, mapLayersVisible.gates, mapReady]);

  if (!apiKey) {
    return (
      <div className="relative w-full h-full rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center bg-slate-900">
        <p className="text-slate-400 text-sm text-center px-4">
          HERE Maps requires{' '}
          <code className="font-mono text-xs bg-slate-800 px-1 py-0.5 rounded">NEXT_PUBLIC_HERE_API_KEY</code>
        </p>
      </div>
    );
  }

  // ── Legend data ───────────────────────────────────────────────────────────
  const vesselCounts = Object.fromEntries(
    VESSEL_STATE_LABELS.map(([s]) => [s, vessels.filter(v => v.lifecycleState === s).length])
  );
  const truckCounts = Object.fromEntries(
    TRUCK_STATE_LABELS.map(([s]) => [
      s,
      trucks.filter(t => t.state === s || (s === 'APPROACHING_PORT' && t.state === 'APPROACHING')).length,
    ])
  );

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
      <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#0f172a' }} className="absolute inset-0" />

      {coords && (
        <div className="absolute bottom-4 left-4 z-10 bg-slate-900/85 backdrop-blur-sm border border-slate-700 px-2 py-1 rounded text-[10px] font-mono text-slate-200 pointer-events-none select-none">
          {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </div>
      )}

      {/* ── Legend panel ──────────────────────────────────────────────────── */}
      <div className="absolute top-4 right-4 z-10">
        <div className="bg-slate-950/95 backdrop-blur-md border border-slate-600 rounded-lg p-3 shadow-2xl w-52">

          {/* Layer toggles */}
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold text-slate-200 uppercase tracking-widest">Map Layers</h4>
          </div>
          <div className="space-y-1 mb-3">
            {([
              { id: 'vessels', label: 'Vessels',     count: vessels.length },
              { id: 'trucks',  label: 'Trucks',      count: trucks.length },
              { id: 'gates',   label: 'Gates',       count: gates.length },
            ] as const).map(layer => (
              <div key={layer.id}
                className="flex items-center justify-between cursor-pointer group px-1 py-0.5 rounded hover:bg-slate-800"
                onClick={() => toggleMapLayer(layer.id)}>
                <span className={`text-[11px] font-semibold transition-colors ${mapLayersVisible[layer.id] ? 'text-white' : 'text-slate-500 line-through'} group-hover:text-white`}>
                  {layer.label}
                </span>
                <span className="text-[10px] text-slate-300 font-mono tabular-nums">{layer.count}</span>
              </div>
            ))}
          </div>

          {/* Vessel states */}
          <div className="border-t border-slate-700 pt-2 mb-2">
            <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-1.5">
              Vessels (click to hide)
            </h4>
            <div className="space-y-1">
              {VESSEL_STATE_LABELS.map(([state, label]) => (
                <div key={state} className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: VESSEL_COLORS[state] }} />
                    <span className="text-[10px] text-white truncate">{label}</span>
                  </div>
                  <span className="text-[10px] text-slate-300 font-mono tabular-nums ml-2">{vesselCounts[state] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Truck states */}
          <div className="border-t border-slate-700 pt-2 mb-2">
            <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-1.5">Trucks</h4>
            <div className="space-y-1">
              {TRUCK_STATE_LABELS.map(([state, label]) => (
                <div key={state} className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TRUCK_COLORS[state] ?? '#94a3b8' }} />
                    <span className="text-[10px] text-white truncate">{label}</span>
                  </div>
                  <span className="text-[10px] text-slate-300 font-mono tabular-nums ml-2">{truckCounts[state] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Gate congestion */}
          <div className="border-t border-slate-700 pt-2 mb-2">
            <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-1.5">Gates</h4>
            <div className="space-y-1">
              {gates.map(g => {
                const c = g.congestionLevel === 'HIGH' ? '#ef4444' : g.congestionLevel === 'MEDIUM' ? '#eab308' : '#22c55e';
                return (
                  <div key={g.id} className="flex items-center justify-between px-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: c }} />
                      <span className="text-[10px] text-white">G{g.id}</span>
                      <span className={`text-[9px] px-1 rounded font-mono ${g.status === 'CLOSED' ? 'bg-red-900/50 text-red-300' : 'bg-slate-700 text-slate-200'}`}>
                        {g.status === 'CLOSED' ? 'CLOSED' : `Q:${g.queueLength}`}
                      </span>
                    </div>
                    <span className="text-[9px] font-bold" style={{ color: c }}>{g.congestionLevel}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Route legend */}
          <div className="border-t border-slate-700 pt-2">
            <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-1.5">Routes</h4>
            <div className="flex items-center gap-2">
              <svg width="24" height="8" viewBox="0 0 24 8">
                <line x1="0" y1="4" x2="24" y2="4" stroke="#60a5fa" strokeWidth="2" strokeDasharray="4 4" />
              </svg>
              <span className="text-[10px] text-white">Approach / transit path</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
