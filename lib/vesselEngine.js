/**
 * vesselEngine.js
 * Vessel lifecycle state machine for Port Digital Twin.
 * Manages vessel positions, states, and realistic maritime data.
 *
 * Port anchorage area is offshore in the Arabian Sea (18.85-18.90°N, 72.75-72.85°E).
 * Berths are at the terminal (18.94-18.96°N, 72.94-72.98°E).
 */

import { enrichVesselManifest } from './manifestEnricher';

const VESSEL_NAMES = [
  'MSC GAIA', 'EVER GIVEN', 'COSCO SHIPPING', 'MAERSK EMERALD',
  'APL TURQUOISE', 'CMA CGM MARCO POLO', 'ONE INNOVATION', 'YANG MING WITNESS',
  'HAPAG-LLOYD BERLIN', 'ZIM SAMMY OFER', 'MITSUI VOYAGER', 'OOCL HONG KONG',
  'TRIUMPH OF THE SEA', 'Port CARRIER', 'MUMBAI EXPRESS', 'GUJARAT TRADER',
  'KONKAN STAR', 'ARABINDA', 'VINDHYAGIRI', 'CHENNAI GATEWAY',
];

const VESSEL_TYPES = [
  { type: 'CONTAINER', emissionRatePerHour: 2.8, dwt: 65000 },
  { type: 'BULK_CARRIER', emissionRatePerHour: 1.9, dwt: 45000 },
  { type: 'TANKER', emissionRatePerHour: 2.2, dwt: 55000 },
  { type: 'RO_RO', emissionRatePerHour: 1.5, dwt: 25000 },
];

let vesselIdCounter = 1;

/**
 * Anchorage positions — offshore Port anchorage area in Arabian Sea.
 * @returns {{ lat: number, lng: number }}
 */
function anchoragePosition() {
  return {
    lat: 18.85 + Math.random() * 0.05,
    lng: 72.76 + Math.random() * 0.06,
  };
}

// Fixed berth slots along the Port quayside (western / seaward face of terminal).
// B1–B4 on the northern quay; B5–B8 on the southern quay.
const BERTH_SLOT_POSITIONS = {
  B1: { lat: 18.9562, lng: 72.9408 },
  B2: { lat: 18.9546, lng: 72.9418 },
  B3: { lat: 18.9530, lng: 72.9428 },
  B4: { lat: 18.9514, lng: 72.9438 },
  B5: { lat: 18.9495, lng: 72.9468 },
  B6: { lat: 18.9479, lng: 72.9490 },
  B7: { lat: 18.9462, lng: 72.9512 },
  B8: { lat: 18.9445, lng: 72.9534 },
};

/**
 * Berth position — snapped to a specific quayside berth slot.
 * @param {string} [berthNumber] - e.g. 'B3'; random slot used if omitted
 * @returns {{ lat: number, lng: number }}
 */
function berthPosition(berthNumber) {
  const slot = BERTH_SLOT_POSITIONS[berthNumber] ?? BERTH_SLOT_POSITIONS[`B${Math.floor(Math.random() * 8) + 1}`];
  // Small jitter so multiple vessels at the same berth remain individually distinguishable
  return {
    lat: slot.lat + (Math.random() - 0.5) * 0.0006,
    lng: slot.lng + (Math.random() - 0.5) * 0.0006,
  };
}

/**
 * Approaching positions — 10-15 nautical miles out from Port.
 * @returns {{ lat: number, lng: number }}
 */
function approachingPosition() {
  return {
    lat: 18.80 + Math.random() * 0.04,
    lng: 72.68 + Math.random() * 0.06,
  };
}

/**
 * Get a random unique vessel name.
 * @param {number} index
 * @returns {string}
 */
function getVesselName(index) {
  return VESSEL_NAMES[index % VESSEL_NAMES.length];
}

/**
 * Get position for a vessel based on its lifecycle state.
 * @param {string} lifecycleState
 * @param {string} [berthNumber]
 * @returns {{ lat: number, lng: number }}
 */
function positionForState(lifecycleState, berthNumber) {
  switch (lifecycleState) {
    case 'APPROACHING': return approachingPosition();
    case 'ANCHORED': return anchoragePosition();
    case 'BERTHING':
    case 'LOADING':
    case 'DEPARTING': return berthPosition(berthNumber);
    default: return approachingPosition();
  }
}

/**
 * Generate a single vessel with realistic Port-domain values.
 * @param {string} [forceState] - Optional forced lifecycle state
 * @param {number} [index] - Index for name selection
 * @returns {Vessel}
 */
export function generateVessel(forceState = null, index = 0) {
  const vesselType = VESSEL_TYPES[Math.floor(Math.random() * VESSEL_TYPES.length)];
  const states = ['APPROACHING', 'ANCHORED', 'BERTHING', 'LOADING', 'DEPARTING'];
  const lifecycleState = forceState || states[Math.floor(Math.random() * (states.length - 1))];

  const now = Date.now();
  const etaOffsetMs = {
    APPROACHING: (2 + Math.random() * 8) * 3600000,
    ANCHORED: (0.5 + Math.random() * 3) * 3600000,
    BERTHING: (0 + Math.random() * 1) * 3600000,
    LOADING: (-2 - Math.random() * 4) * 3600000,
    DEPARTING: (-6 - Math.random() * 8) * 3600000,
  };

  const waitHoursMap = {
    APPROACHING: 0,
    ANCHORED: Math.random() * 4 + 0.5,
    BERTHING: Math.random() * 2 + 1,
    LOADING: Math.random() * 6 + 4,
    DEPARTING: Math.random() * 2,
  };

  const id = `V${String(vesselIdCounter++).padStart(3, '0')}`;
  const atBerth = ['BERTHING', 'LOADING', 'DEPARTING'].includes(lifecycleState);
  const berthNumber = atBerth ? `B${Math.floor(Math.random() * 8) + 1}` : null;

  const base = {
    id,
    name: getVesselName(index + vesselIdCounter),
    type: vesselType.type,
    dwt: vesselType.dwt + Math.floor(Math.random() * 10000),
    position: positionForState(lifecycleState, berthNumber),
    lifecycleState,
    eta: new Date(now + (etaOffsetMs[lifecycleState] || 0)).toISOString(),
    waitHours: parseFloat((waitHoursMap[lifecycleState] || 0).toFixed(1)),
    emissionsRate: vesselType.emissionRatePerHour,
    pilotAssigned: atBerth,
    berthNumber,
    flag: ['IN', 'SG', 'HK', 'PA', 'MH', 'BS'][Math.floor(Math.random() * 6)],
    ticksInState: 0,
    assignedCranes: 3,
  };
  return enrichVesselManifest(base);
}

/**
 * Generate an initial fleet of vessels for Port simulation.
 * @param {number} [count=10] - Number of vessels to generate
 * @param {string} [forceState] - Optional state to force all vessels into
 * @returns {Vessel[]}
 */
export function generateInitialVessels(count = 10, forceState = null) {
  return Array.from({ length: count }, (_, i) => generateVessel(forceState, i));
}

/**
 * Get the color code for a vessel lifecycle state (used for map markers).
 * @param {string} lifecycleState
 * @returns {string} Hex color
 */
export function getVesselStateColor(lifecycleState) {
  const colors = {
    APPROACHING: '#3b82f6',  // blue
    ANCHORED: '#eab308',     // yellow
    BERTHING: '#f97316',     // orange
    LOADING: '#22c55e',      // green
    DEPARTING: '#94a3b8',    // slate/grey
  };
  return colors[lifecycleState] || '#94a3b8';
}
