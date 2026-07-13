/**
 * berthScheduler.js
 * 21-day berth forecast and occupancy calendar for Port Digital Twin.
 * Generates realistic vessel schedule based on typical Port terminal activity.
 */

const VESSEL_NAMES_FORECAST = [
  'MSC GAIA', 'EVER GIVEN', 'COSCO SHIPPING', 'MAERSK EMERALD', 'APL TURQUOISE',
  'CMA CGM MARCO POLO', 'ONE INNOVATION', 'YANG MING WITNESS', 'HAPAG BERLIN',
  'ZIM SAMMY OFER', 'MITSUI VOYAGER', 'OOCL HONG KONG', 'TRIUMPH OF SEA',
  'MUMBAI EXPRESS', 'GUJARAT TRADER', 'KONKAN STAR', 'ARABINDA', 'VINDHYAGIRI',
  'CHENNAI GATEWAY', 'COLOMBO STAR', 'KARACHI LINK', 'GULF CARRIER',
  'BAY OF BENGAL', 'INDO PACIFIC', 'WESTERN ACCORD',
];

const BERTH_NUMBERS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'];

const VESSEL_STATUSES_FORECAST = ['CONFIRMED', 'EXPECTED', 'TENTATIVE', 'BERTHED', 'DEPARTED'];

let scheduleIdCounter = 1;

function clamp(min, val, max) {
  return Math.min(max, Math.max(min, val));
}

function statusFromLifecycle(lifecycleState = 'APPROACHING', confidence = 0.6) {
  const state = String(lifecycleState).toUpperCase();
  if (state === 'LOADING') return 'BERTHED';
  if (state === 'BERTHING') return confidence >= 0.75 ? 'CONFIRMED' : 'EXPECTED';
  if (state === 'ANCHORED') return confidence >= 0.8 ? 'EXPECTED' : 'TENTATIVE';
  if (state === 'DEPARTING') return 'DEPARTED';
  return confidence >= 0.75 ? 'CONFIRMED' : 'EXPECTED';
}

/**
 * Generate a 21-day berth occupancy heatmap grid.
 * Each cell = { date: string, occupancyPercent: number, vessels: number }
 * @param {Array<{ eta: string, status?: string }>} [schedule]
 * @returns {DayOccupancy[]}
 */
export function generate21DayOccupancy(schedule = []) {
  const days = [];
  const today = new Date();
  const liveByDate = new Map();
  for (const vessel of schedule) {
    const date = new Date(vessel.eta);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().split('T')[0];
    liveByDate.set(key, (liveByDate.get(key) || 0) + 1);
  }

  for (let d = 0; d < 21; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);

    // Realistic Port occupancy pattern: weekends slightly lower
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const baseOccupancy = isWeekend ? 55 : 72;
    let occupancyPercent = clamp(30, baseOccupancy + (Math.random() - 0.5) * 30, 98);
    const key = date.toISOString().split('T')[0];
    const liveVessels = liveByDate.get(key) || 0;
    if (liveVessels > 0) {
      occupancyPercent = clamp(30, occupancyPercent + liveVessels * 1.8, 98);
    }

    // More vessels = higher occupancy
    const vessels = Math.round((occupancyPercent / 100) * 23);

    days.push({
      date: date.toISOString().split('T')[0],
      dayLabel: date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      occupancyPercent: parseFloat(occupancyPercent.toFixed(1)),
      vessels,
      isWeekend,
    });
  }

  return days;
}

/**
 * Build schedule rows from live VTMS overlays.
 * @param {Array<{id?: string, name?: string, eta?: string, lifecycleState?: string, berthNumber?: string|null, confidence?: number, teus?: number, vesselType?: string}>} overlays
 */
export function buildLiveOverlaySchedule(overlays = []) {
  const now = Date.now();
  return overlays
    .map((ov, idx) => {
      const etaDate = ov?.eta ? new Date(ov.eta) : new Date(now + (idx + 1) * 3600000);
      if (Number.isNaN(etaDate.getTime())) return null;
      const etd = new Date(etaDate.getTime() + (14 + Math.random() * 24) * 3600000);
      const confidence = typeof ov?.confidence === 'number' ? ov.confidence : 0.65;
      return {
        id: ov.id || `VTMS-SCHED-${String(scheduleIdCounter++).padStart(4, '0')}`,
        vesselName: ov.name || VESSEL_NAMES_FORECAST[Math.floor(Math.random() * VESSEL_NAMES_FORECAST.length)],
        eta: etaDate.toISOString(),
        etd: etd.toISOString(),
        berthNumber: ov.berthNumber || BERTH_NUMBERS[Math.floor(Math.random() * BERTH_NUMBERS.length)],
        status: statusFromLifecycle(ov.lifecycleState, confidence),
        teus: Math.floor(ov.teus || (1000 + Math.random() * 2800)),
        vesselType: ov.vesselType || ['CONTAINER', 'BULK', 'TANKER', 'RO_RO'][Math.floor(Math.random() * 4)],
      };
    })
    .filter(Boolean);
}

/**
 * Generate vessel schedule table for the next 21 days.
 * @param {number} [count=18]
 * @param {{ liveOverlays?: Array<{id?: string, name?: string, eta?: string, lifecycleState?: string, berthNumber?: string|null, confidence?: number, teus?: number, vesselType?: string}> }} [opts]
 * @returns {ScheduledVessel[]}
 */
export function generateVesselSchedule(count = 18, opts = {}) {
  const schedule = buildLiveOverlaySchedule(opts.liveOverlays || []);
  const today = new Date();
  const extraCount = Math.max(0, count - schedule.length);

  for (let i = 0; i < extraCount; i++) {
    const etaDaysFromNow = Math.random() * 21;
    const eta = new Date(today.getTime() + etaDaysFromNow * 86400000);
    const etd = new Date(eta.getTime() + (18 + Math.random() * 30) * 3600000);

    const statusIndex = Math.floor(Math.random() * VESSEL_STATUSES_FORECAST.length);
    const daysFromNow = etaDaysFromNow;

    let status = VESSEL_STATUSES_FORECAST[statusIndex];
    // Past ETAs = either BERTHED or DEPARTED
    if (eta < today) {
      status = Math.random() > 0.4 ? 'DEPARTED' : 'BERTHED';
    } else if (daysFromNow < 2) {
      status = 'CONFIRMED';
    } else if (daysFromNow < 7) {
      status = Math.random() > 0.3 ? 'CONFIRMED' : 'EXPECTED';
    } else {
      status = Math.random() > 0.5 ? 'EXPECTED' : 'TENTATIVE';
    }

    schedule.push({
      id: `SCHED-${String(scheduleIdCounter++).padStart(4, '0')}`,
      vesselName: VESSEL_NAMES_FORECAST[Math.floor(Math.random() * VESSEL_NAMES_FORECAST.length)],
      eta: eta.toISOString(),
      etd: etd.toISOString(),
      berthNumber: BERTH_NUMBERS[Math.floor(Math.random() * BERTH_NUMBERS.length)],
      status,
      teus: Math.floor(800 + Math.random() * 3200),
      vesselType: ['CONTAINER', 'BULK', 'TANKER', 'RO_RO'][Math.floor(Math.random() * 4)],
    });
  }

  return schedule.sort((a, b) => new Date(a.eta) - new Date(b.eta));
}

/**
 * Generate weekly occupancy summary (7 days).
 * @param {Array<{ date: string, dayLabel: string, occupancyPercent: number, vessels: number, isWeekend: boolean }>} [daysInput]
 * @returns {WeeklyOccupancy[]}
 */
export function generateWeeklySummary(daysInput) {
  const days = (daysInput || generate21DayOccupancy()).slice(0, 7);
  return days.map(d => ({
    ...d,
    avgTAT: parseFloat((16 + Math.random() * 10).toFixed(1)),
    totalVesselsHandled: Math.floor(d.vessels * 0.8),
  }));
}

/**
 * Generate full berth forecast dataset.
 * @param {{ liveOverlays?: Array<{id?: string, name?: string, eta?: string, lifecycleState?: string, berthNumber?: string|null, confidence?: number, teus?: number, vesselType?: string}> }} [opts]
 * @returns {BerthForecastData}
 */
export function generateBerthForecastData(opts = {}) {
  const vesselSchedule = generateVesselSchedule(18, opts);
  const occupancyGrid = generate21DayOccupancy(vesselSchedule);
  const weeklySummary = generateWeeklySummary(occupancyGrid);
  return {
    occupancyGrid,
    vesselSchedule,
    weeklySummary,
    avgOccupancy21Day: parseFloat(
      (occupancyGrid.reduce((s, d) => s + d.occupancyPercent, 0) / 21).toFixed(1)
    ),
    lastUpdated: new Date().toISOString(),
  };
}
