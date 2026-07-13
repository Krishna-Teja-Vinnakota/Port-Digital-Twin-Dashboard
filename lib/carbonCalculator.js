/**
 * carbonCalculator.js
 * Carbon emissions and KPI calculation engine for Port Digital Twin.
 * Implements Port RFP Section VIII emissions formula and all 12 KPI metrics.
 */

/**
 * IMO-aligned carbon factors (tons CO2 per ton fuel).
 * Reference: IMO MEPC guidelines for fuel-specific conversion factors.
 */
const IMO_CARBON_FACTORS = {
  HFO: 3.114,
  MDO: 3.206,
};

/**
 * Vessel-class auxiliary-engine fuel burn approximations (tons fuel/hour).
 * Intended for anchorage/berthing "hotel load" conditions.
 */
const VESSEL_CLASS_CONSUMPTION = {
  FEEDER: 0.15, // < 3000 TEU equivalent class
  PANAMAX: 0.25, // 3000-5000 TEU equivalent class
  POST_PANAMAX: 0.4, // 5000-10000 TEU equivalent class
  ULCV: 0.6, // > 10000 TEU equivalent class
};

function normalizeFuelType(fuelType = 'HFO') {
  const key = String(fuelType || 'HFO').toUpperCase();
  return IMO_CARBON_FACTORS[key] ? key : 'HFO';
}

/**
 * Map simulation vessel metadata to a practical vessel class.
 * If class is already provided use it, otherwise infer from DWT.
 * @param {object} vessel
 * @returns {'FEEDER'|'PANAMAX'|'POST_PANAMAX'|'ULCV'}
 */
function inferVesselClass(vessel = {}) {
  const explicit = String(vessel.vesselClass || '').toUpperCase();
  if (VESSEL_CLASS_CONSUMPTION[explicit]) return explicit;

  const dwt = Number(vessel.dwt || 0);
  if (dwt >= 100000) return 'ULCV';
  if (dwt >= 70000) return 'POST_PANAMAX';
  if (dwt >= 40000) return 'PANAMAX';
  return 'FEEDER';
}

/**
 * Determine underway state from lifecycle state unless explicitly passed.
 * @param {object} vessel
 * @param {boolean|undefined} isUnderway
 * @returns {boolean}
 */
function resolveUnderway(vessel = {}, isUnderway) {
  if (typeof isUnderway === 'boolean') return isUnderway;
  const state = String(vessel.lifecycleState || '').toUpperCase();
  return state === 'APPROACHING' || state === 'DEPARTING';
}

/**
 * Carbon emission formula using IMO factors:
 * CO2 = time(hours) * fuelConsumption(tons/hour) * carbonFactor(tons CO2/ton fuel)
 *
 * @param {number} hours
 * @param {object} [options]
 * @param {string} [options.vesselClass='PANAMAX'] - FEEDER|PANAMAX|POST_PANAMAX|ULCV
 * @param {boolean} [options.isUnderway=false] - Main engine proxy when true
 * @param {string} [options.fuelType='HFO'] - HFO|MDO
 * @returns {number} CO2 tons
 */
export function calcVesselEmissions(hours, options = {}) {
  const safeHours = Math.max(0, Number(hours || 0));
  const vesselClass = String(options.vesselClass || 'PANAMAX').toUpperCase();
  const classKey = VESSEL_CLASS_CONSUMPTION[vesselClass] ? vesselClass : 'PANAMAX';
  const fuelType = normalizeFuelType(options.fuelType);

  // Auxiliary engine consumption at berth/anchorage.
  let hourlyFuelConsumption = VESSEL_CLASS_CONSUMPTION[classKey];

  // Underway operation uses main engine and materially higher fuel burn.
  if (options.isUnderway === true) {
    hourlyFuelConsumption *= 10;
  }

  const totalCO2 = safeHours * hourlyFuelConsumption * IMO_CARBON_FACTORS[fuelType];
  return parseFloat(totalCO2.toFixed(2));
}

/**
 * Estimate cumulative CO2 from anchored vessels using IMO factors.
 * This is useful for "carbon today" style metrics in environment APIs.
 *
 * @param {object[]} vessels
 * @param {object} [options]
 * @param {string} [options.fuelType='HFO']
 * @param {number} [options.minHoursPerAnchored=0.5]
 * @returns {{ totalCarbonTons: number, avgRatePerVesselPerHour: number, anchoredVesselCount: number }}
 */
export function calcAnchoredFleetCarbon(vessels = [], options = {}) {
  const fuelType = normalizeFuelType(options.fuelType || 'HFO');
  const minHoursPerAnchored = Math.max(0, Number(options.minHoursPerAnchored ?? 0.5));
  const anchored = vessels.filter((v) => v.lifecycleState === 'ANCHORED');

  if (!anchored.length) {
    return {
      totalCarbonTons: 0,
      avgRatePerVesselPerHour: 0,
      anchoredVesselCount: 0,
    };
  }

  let totalCarbonTons = 0;
  let totalHourlyRate = 0;
  for (const vessel of anchored) {
    const vesselClass = inferVesselClass(vessel);
    const hours = Math.max(minHoursPerAnchored, Number(vessel.waitHours || 0));
    const cumulative = calcVesselEmissions(hours, {
      vesselClass,
      isUnderway: resolveUnderway(vessel, false),
      fuelType,
    });
    const hourlyRate = calcVesselEmissions(1, {
      vesselClass,
      isUnderway: resolveUnderway(vessel, false),
      fuelType,
    });
    totalCarbonTons += cumulative;
    totalHourlyRate += hourlyRate;
  }

  return {
    totalCarbonTons: parseFloat(totalCarbonTons.toFixed(1)),
    avgRatePerVesselPerHour: parseFloat((totalHourlyRate / anchored.length).toFixed(2)),
    anchoredVesselCount: anchored.length,
  };
}

/**
 * Classify carbon index based on total hourly emissions.
 * @param {number} totalEmissionsPerHour
 * @returns {'LOW'|'MODERATE'|'HIGH'}
 */
function classifyCarbonIndex(totalEmissionsPerHour) {
  if (totalEmissionsPerHour > 80) return 'HIGH';
  if (totalEmissionsPerHour > 40) return 'MODERATE';
  return 'LOW';
}

/**
 * Gate congestion aggregate across all gates.
 * @param {Gate[]} gates
 * @returns {'LOW'|'MEDIUM'|'HIGH'}
 */
function aggregateGateCongestion(gates) {
  const highCount = gates.filter(g => g.congestionLevel === 'HIGH' || g.status === 'CLOSED').length;
  const medCount = gates.filter(g => g.congestionLevel === 'MEDIUM').length;
  if (highCount >= 1) return 'HIGH';
  if (medCount >= 2) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate average vessel turnaround time (TAT).
 * TAT = time from pilot boarding to last line let go.
 * Approximated from vessel lifecycle stages.
 * @param {Vessel[]} vessels
 * @returns {number} Hours
 */
function calcAvgTAT(vessels) {
  const completed = vessels.filter(v => ['LOADING', 'DEPARTING'].includes(v.lifecycleState));
  if (!completed.length) return 18.4;
  const avg = completed.reduce((sum, v) => sum + v.waitHours + 12, 0) / completed.length;
  return parseFloat(avg.toFixed(1));
}

/**
 * Calculate pre-berthing detention time.
 * Pre-berthing detention = time vessel waits at anchorage before berth assigned.
 * @param {Vessel[]} vessels
 * @param {SimulationFlags} flags
 * @returns {number} Hours
 */
function calcPreBerthingDetention(vessels, flags) {
  const anchored = vessels.filter(v => v.lifecycleState === 'ANCHORED');
  if (!anchored.length) return 1.8;
  const base = anchored.reduce((sum, v) => sum + v.waitHours, 0) / anchored.length;
  const bunchingMultiplier = flags?.bunchingActive ? 2.1 : 1;
  return parseFloat((base * bunchingMultiplier).toFixed(1));
}

/**
 * Calculate berth occupancy percentage.
 * Total berths at Port: ~23 (NSICT + JNPCT + GTI + CFS).
 * @param {Vessel[]} vessels
 * @returns {number} Percentage 0-100
 */
function calcBerthOccupancy(vessels) {
  const TOTAL_BERTHS = 23;
  const occupied = vessels.filter(v => ['BERTHING', 'LOADING'].includes(v.lifecycleState)).length;
  return Math.min(100, parseFloat(((occupied / TOTAL_BERTHS) * 100).toFixed(1)));
}

/**
 * Calculate crane moves per hour.
 * Port target: ~35-40 moves/crane/hour for container terminals.
 * @param {Vessel[]} vessels
 * @returns {number}
 */
function calcCraneMoves(vessels) {
  const loading = vessels.filter(v => v.lifecycleState === 'LOADING').length;
  return Math.max(0, Math.round(28 + loading * 4 + Math.random() * 6));
}

/**
 * Heuristic average truck turnaround (minutes) from lifecycle mix + optional timing profile.
 * @param {object[]} trucks
 * @param {object | null} profile
 * @returns {number}
 */
function estimateAvgTruckTAT(trucks, profile) {
  const weights = {
    APPROACHING_PORT: 18,
    GATE_QUEUE: 25,
    CUSTOMS_CHECK: 30,
    YARD_TRANSIT: 35,
    LOADING_UNLOADING: 55,
    EXITING: 12,
  };
  if (!trucks.length) return 45;
  let sum = 0;
  for (const t of trucks) {
    const w = weights[t.state] || 40;
    sum += w;
  }
  let base = sum / trucks.length;
  if (profile && profile.gateProcess) {
    base = (base + profile.gateProcess + (profile.yardTransit || 12)) / 1.2;
  }
  return Math.min(200, Math.max(20, parseFloat(base.toFixed(1))));
}

/**
 * Generate 24-hour history array for sparklines.
 * @param {number} currentValue
 * @param {number} variance
 * @param {number} [points=24]
 * @returns {number[]}
 */
export function generateHistory(currentValue, variance, points = 24) {
  const history = [];
  let val = currentValue;
  for (let i = points; i >= 0; i--) {
    val = Math.max(0, val + (Math.random() - 0.5) * variance);
    history.unshift(parseFloat(val.toFixed(1)));
  }
  history[history.length - 1] = currentValue;
  return history;
}

/**
 * Calculate all 12 KPI metrics from current simulation state.
 * @param {Vessel[]} vessels
 * @param {Gate[]} gates
 * @param {Truck[]} trucks
 * @param {SimulationFlags} [flags]
 * @param {object | null} [yard] - yard snapshot (optional)
 * @param {object | null} [timingProfile] - resolved profile for truck TAT estimate (optional)
 * @returns {KPIs}
 */
export function calculateKPIs(vessels, gates, trucks, flags = {}, yard = null, timingProfile = null) {
  const avgTAT = calcAvgTAT(vessels);
  const preBerthingDetention = calcPreBerthingDetention(vessels, flags);
  const berthOccupancy = calcBerthOccupancy(vessels);
  const trucksInGeoFence = trucks.length;
  const gateCongestionLevel = aggregateGateCongestion(gates);
  const gateQueueLength = gates.reduce((s, g) => s + (g.queueLength || 0), 0);
  const yardOccupancyPct = yard
    ? Math.min(100, (yard.currentTEU / Math.max(1, yard.capacityTEU)) * 100)
    : 0;
  const avgTruckTAT = estimateAvgTruckTAT(trucks, timingProfile);
  const throughputTEUPerHour = yard
    ? parseFloat(((yard.currentTEU * 0.02) / 10 + 40 + Math.random() * 12).toFixed(1))
    : 40;

  // IMO-based emissions estimate for currently anchored vessels.
  const anchoredEmissions = vessels
    .filter(v => v.lifecycleState === 'ANCHORED')
    .reduce((sum, v) => {
      const vesselClass = inferVesselClass(v);
      const estimated = calcVesselEmissions(v.waitHours || 1, {
        vesselClass,
        isUnderway: resolveUnderway(v, false),
        fuelType: 'HFO',
      });
      return sum + estimated;
    }, 0);
  const carbonIndex = classifyCarbonIndex(anchoredEmissions + (flags?.truckSurge || 0) * 0.1);

  // DPD/DPE - Direct Port Delivery/Entry percentages (Port targets ~40-55%)
  const dpdPercent = Math.max(
    20,
    Math.min(70, 42 + Math.random() * 10 - (flags?.truckSurge || 0) * 0.1)
  );
  const dpePercent = Math.max(
    15,
    Math.min(65, 38 + Math.random() * 8 - (flags?.truckSurge || 0) * 0.08)
  );

  return {
    avgVesselTAT: avgTAT,
    preBerthingDetention,
    berthOccupancy,
    yardOccupancyPct: parseFloat(yardOccupancyPct.toFixed(1)),
    gateQueueLength,
    avgTruckTAT,
    throughputTEUPerHour,
    avgImportDwellTime: parseFloat((18 + Math.random() * 6).toFixed(1)),
    avgExportDwellTime: parseFloat((24 + Math.random() * 8).toFixed(1)),
    dpdPercent: parseFloat(dpdPercent.toFixed(1)),
    dpePercent: parseFloat(dpePercent.toFixed(1)),
    gateCongestionLevel,
    trucksInGeoFence,
    carbonIndex,
    craneMoves: calcCraneMoves(vessels),
    pilotPerformanceTime: parseFloat((1.2 + Math.random() * 0.8).toFixed(1)),

    // 24-hour history for sparklines
    history: {
      avgVesselTAT: generateHistory(avgTAT, 3),
      preBerthingDetention: generateHistory(preBerthingDetention, 0.8),
      berthOccupancy: generateHistory(berthOccupancy, 8),
      trucksInGeoFence: generateHistory(trucksInGeoFence, 20),
      craneMoves: generateHistory(calcCraneMoves(vessels), 5),
    },
  };
}
