/**
 * mockDataGen.js
 * Generates realistic mock data for Port Digital Twin modules:
 * Energy substations, environment metrics, rail operations, and truck fleet.
 */

import { Port_TRUCK_BOUNDS } from './geoBounds.js';
const TRUCK_PLATES = ['MH-04-', 'MH-43-', 'GJ-01-', 'GJ-05-', 'RJ-14-', 'TN-09-', 'KA-01-'];
const DESTINATIONS = ['NSICT', 'JNPCT', 'GTI Terminal', 'CFS Nhava Sheva', 'ICDs', 'Dry Port'];

const TRUCK_LIFECYCLE_STATES = [
  'APPROACHING',
  'GATE_QUEUE',
  'YARD_TRANSIT',
  'LOADING',
  'EXITING',
];

let truckIdCounter = 1;

/**
 * Port Geo-fence zone — trucks operate within this bounding box.
 * Area around Port terminal, Nhava Sheva, Uran Road.
 */
const GEOFENCE = Port_TRUCK_BOUNDS;

/**
 * Generate a random truck within the Port geo-fence zone (simulated lifecycle).
 * @param {{ simTime?: number, state?: string, stateEnteredSimMins?: number }} [opts]
 * @returns {import('./simulationTypes').SimTruck}
 */
export function generateTruck(opts = {}) {
  const plateState = TRUCK_PLATES[Math.floor(Math.random() * TRUCK_PLATES.length)];
  const plateNum = String(Math.floor(Math.random() * 9000) + 1000);
  const now = Date.now();
  const entryMinsAgo = Math.floor(Math.random() * 180);
  const simTime = typeof opts.simTime === 'number' ? opts.simTime : 0;
  const state = opts.state || TRUCK_LIFECYCLE_STATES[Math.floor(Math.random() * TRUCK_LIFECYCLE_STATES.length)];
  const stateEnteredSimMins = typeof opts.stateEnteredSimMins === 'number'
    ? opts.stateEnteredSimMins
    : Math.max(0, simTime - Math.floor(Math.random() * 40));

  return {
    id: `TRK-${String(truckIdCounter++).padStart(4, '0')}`,
    plateNumber: `${plateState}${plateNum}`,
    position: {
      lat: GEOFENCE.minLat + Math.random() * (GEOFENCE.maxLat - GEOFENCE.minLat),
      lng: GEOFENCE.minLng + Math.random() * (GEOFENCE.maxLng - GEOFENCE.minLng),
    },
    destination: DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)],
    entryTimestamp: new Date(now - entryMinsAgo * 60000).toISOString(),
    cargoType: ['CONTAINER', 'BULK', 'LIQUID', 'BREAK_BULK'][Math.floor(Math.random() * 4)],
    state,
    stateEnteredAt: now,
    stateEnteredSimMins,
    nextEligibleTransitionAt: now + 3_600_000,
  };
}

/**
 * Generate initial truck fleet for the geo-fence zone.
 * @param {number} [count=45]
 * @returns {Truck[]}
 */
export function generateInitialTrucks(count = 45) {
  return Array.from({ length: count }, () => generateTruck());
}

/**
 * Truncate or grow a truck list to a target size (e.g. OpenCV live count).
 * @param {object[]} baseTrucks
 * @param {number} targetCount
 */
export function alignTruckCount(baseTrucks, targetCount) {
  const count = Math.max(0, Math.floor(targetCount));
  if (count <= baseTrucks.length) return baseTrucks.slice(0, count);

  const next = [...baseTrucks];
  while (next.length < count) {
    next.push(generateTruck());
  }
  return next;
}

// ─────────────────────────────────────────────
// ENERGY MODULE
// ─────────────────────────────────────────────

const SUBSTATION_NAMES = [
  'SS-01 North Terminal', 'SS-02 NSICT', 'SS-03 GTI', 'SS-04 JNPCT',
  'SS-05 Gate Complex', 'SS-06 Admin Block', 'SS-07 Liquid Cargo',
  'SS-08 Rail Yard', 'SS-09 South Quay', 'SS-10 CFS Zone',
  'SS-11 Workshop', 'SS-12 Pump House', 'SS-13 Emergency Grid',
];

/**
 * Generate energy data for 13 Port substations.
 * @returns {EnergyData}
 */
export function generateEnergyData() {
  const substations = SUBSTATION_NAMES.map((name, i) => {
    const loadPct = Math.floor(35 + Math.random() * 60);
    let status = 'NORMAL';
    if (loadPct > 90) status = 'OVERLOAD';
    else if (loadPct > 75) status = 'HIGH_LOAD';
    // Occasionally fault one substation
    if (i === 4 && Math.random() < 0.1) status = 'FAULT';

    return {
      id: `SS-${String(i + 1).padStart(2, '0')}`,
      name,
      loadPercent: loadPct,
      status,
      voltage: 11 + Math.random() * 0.5, // kV
      currentMW: parseFloat((loadPct * 0.25).toFixed(2)),
      maxCapacityMW: 25,
      lastUpdated: new Date().toISOString(),
    };
  });

  const totalMW = substations.reduce((s, ss) => s + ss.currentMW, 0);

  // Generate 24-hr consumption sparkline
  const consumption24h = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, '0')}:00`,
    mw: parseFloat((180 + Math.sin(i / 4) * 40 + Math.random() * 20).toFixed(1)),
  }));

  return {
    substations,
    totalConsumptionMW: parseFloat(totalMW.toFixed(1)),
    greenEnergyRatio: parseFloat((22 + Math.random() * 12).toFixed(1)), // % renewable
    consumption24h,
    peakLoadToday: parseFloat((totalMW * 1.2 + Math.random() * 20).toFixed(1)),
    gridFrequency: parseFloat((49.8 + Math.random() * 0.4).toFixed(2)), // Hz
  };
}

// ─────────────────────────────────────────────
// ENVIRONMENT MODULE
// ─────────────────────────────────────────────

/**
 * Generate environmental monitoring data for Port.
 * Includes NDVI, AQI, water quality index.
 * @returns {EnvironmentData}
 */
export function generateEnvironmentData() {
  const aqiValue = Math.floor(85 + Math.random() * 60);
  let aqiCategory = 'GOOD';
  if (aqiValue > 200) aqiCategory = 'VERY_POOR';
  else if (aqiValue > 150) aqiCategory = 'POOR';
  else if (aqiValue > 100) aqiCategory = 'MODERATE';
  else if (aqiValue > 50) aqiCategory = 'SATISFACTORY';

  return {
    ndviScore: parseFloat((0.42 + Math.random() * 0.25).toFixed(3)),
    ndviCategory: 'MODERATE', // Port has limited green cover
    aqi: {
      overall: aqiValue,
      category: aqiCategory,
      pm25: parseFloat((22 + Math.random() * 30).toFixed(1)),
      pm10: parseFloat((55 + Math.random() * 40).toFixed(1)),
      co2: parseFloat((410 + Math.random() * 20).toFixed(1)),
      no2: parseFloat((28 + Math.random() * 20).toFixed(1)),
      so2: parseFloat((12 + Math.random() * 15).toFixed(1)),
    },
    waterQuality: {
      ph: parseFloat((7.8 + Math.random() * 0.6).toFixed(2)),
      salinity: parseFloat((34 + Math.random() * 2).toFixed(1)), // PSU
      dissolvedOxygen: parseFloat((5.8 + Math.random() * 2).toFixed(1)), // mg/L
      turbidity: parseFloat((8 + Math.random() * 10).toFixed(1)), // NTU
      overallIndex: Math.floor(55 + Math.random() * 30),
    },
    // Carbon cost calculator inputs
    carbonCostData: {
      baseRatePerHour: 2.2, // tons CO2 per vessel per hour
      currentAnchoredVessels: 0, // will be populated by API
      totalCarbonToday: parseFloat((142 + Math.random() * 60).toFixed(1)),
    },
    lastUpdated: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// RAIL MODULE
// ─────────────────────────────────────────────

const RAIL_ORIGINS = [
  'Tughlakabad ICD', 'Loni ICD', 'Patparganj ICD',
  'Dadri MMLP', 'Agra ICD', 'Kanpur ICD', 'Nagpur ICD',
];

const RAIL_STAGES = ['ALLOCATED', 'IN_TRANSIT', 'PORT_ENTRY', 'SIDING', 'TERMINAL', 'EXIT'];

// ─────────────────────────────────────────────────────────────────────────────
// MOCK TOS ENRICHMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach a deterministic mock TOS manifest to a raw AIS vessel record.
 *
 * TEU count and berth assignment are derived from the vessel's MMSI so
 * the same vessel always gets the same manifest across restarts.
 *
 * @param {object} aisData - raw AIS/VTMS vessel object (must have MMSI or mmsi)
 * @returns {object} vessel with a `manifest` field attached
 */
export function enrichVesselWithMockTOS(aisData) {
  const mmsiNum = parseInt(aisData.MMSI ?? aisData.mmsi ?? '0', 10) || 0;
  const totalTEUs = (mmsiNum % 8000) + 1000;
  const berthNum = (mmsiNum % 23) + 1;

  return {
    ...aisData,
    manifest: {
      cargoType: 'CONTAINER',
      totalTEUs,
      assignedBerth: `B${berthNum}`,
      assignedCranes: 3,
      estimatedUnloadTimeBase: Math.round(totalTEUs * 2.2 / 3), // minutes (3 cranes)
      yardDestinationBlock: 'IMPORT_BLOCK_A',
    },
  };
}

/**
 * Generate rail operations data for Port Rail Freight Terminal.
 * @returns {RailData}
 */
export function generateRailData() {
  const rakes = Array.from({ length: 8 }, (_, i) => {
    const stageIndex = Math.floor(Math.random() * RAIL_STAGES.length);
    const stage = RAIL_STAGES[stageIndex];
    return {
      id: `RK-${2240 + i}`,
      origin: RAIL_ORIGINS[Math.floor(Math.random() * RAIL_ORIGINS.length)],
      currentStage: stage,
      stageIndex,
      wagons: Math.floor(30 + Math.random() * 20),
      teus: Math.floor(60 + Math.random() * 80),
      eta: new Date(Date.now() + (stageIndex < 2 ? (4 + Math.random() * 12) * 3600000 : 0)).toISOString(),
      onTime: Math.random() > 0.25,
      delayMinutes: Math.random() > 0.75 ? Math.floor(30 + Math.random() * 120) : 0,
    };
  });

  const sidingTotal = 6;
  const sidingOccupied = rakes.filter(r => ['SIDING', 'TERMINAL'].includes(r.currentStage)).length;

  return {
    rakes,
    sidingUtilization: {
      occupied: sidingOccupied,
      total: sidingTotal,
      percent: parseFloat(((sidingOccupied / sidingTotal) * 100).toFixed(1)),
    },
    kpis: {
      rakeTAT: parseFloat((18 + Math.random() * 8).toFixed(1)), // hrs
      shuntingDuration: parseFloat((1.2 + Math.random() * 1.5).toFixed(1)), // hrs
      timeToFirstCargoMovement: parseFloat((2.5 + Math.random() * 2).toFixed(1)), // hrs
      onTimePerformance: parseFloat((72 + Math.random() * 18).toFixed(1)), // %
      totalTEUsToday: Math.floor(420 + Math.random() * 180),
    },
    lastUpdated: new Date().toISOString(),
  };
}
