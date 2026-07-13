/**
 * manifestEnricher.ts
 * AIS provides position only; TOS/PCS cargo data is simulated here for the digital twin.
 */

import type { SimVessel, VesselClass, VesselType, Sourced } from './simulationTypes';

function inferVesselClass(dwt: number): VesselClass {
  if (dwt >= 100_000) return 'ULCV';
  if (dwt >= 70_000) return 'POST_PANAMAX';
  if (dwt >= 40_000) return 'PANAMAX';
  return 'FEEDER';
}

function estimateDwtFromShipType(type: VesselType): number {
  switch (type) {
    case 'CONTAINER':
      return 55_000 + Math.floor(Math.random() * 25_000);
    case 'BULK_CARRIER':
      return 75_000 + Math.floor(Math.random() * 30_000);
    case 'TANKER':
      return 80_000 + Math.floor(Math.random() * 40_000);
    case 'RO_RO':
      return 25_000 + Math.floor(Math.random() * 15_000);
    default:
      return 35_000 + Math.floor(Math.random() * 20_000);
  }
}

/**
 * Rough TEU capacity from DWT — demo-only heuristic (not charter party data).
 */
export function estimateTeuFromDwt(dwt: number, type: VesselType): number {
  if (type === 'CONTAINER') {
    return Math.max(800, Math.min(24_000, Math.floor(dwt * 0.12 + 400)));
  }
  if (type === 'RO_RO') {
    return Math.max(200, Math.floor(dwt * 0.04));
  }
  return Math.max(0, Math.floor(dwt * 0.02));
}

function cargoLabel(type: VesselType): string {
  switch (type) {
    case 'CONTAINER':
      return 'ISO containers (mixed FCL/LCL)';
    case 'BULK_CARRIER':
      return 'Iron ore / coal (simulated split)';
    case 'TANKER':
      return 'Liquid bulk (SIM — not from AIS)';
    case 'RO_RO':
      return 'Ro-Ro units + high & heavy (simulated)';
    default:
      return 'General / breakbulk (simulated)';
  }
}

/**
 * Attach simulated TOS-style manifest fields. Live AIS only supplies position/MMSI upstream.
 */
export function enrichVesselManifest(v: SimVessel): SimVessel {
  const dwt = v.dwt > 0 ? v.dwt : estimateDwtFromShipType(v.type);
  const teu = estimateTeuFromDwt(dwt, v.type);
  const vesselClass = inferVesselClass(dwt);

  const teuEstimate: Sourced<number> = v.teuEstimate
    ? v.teuEstimate
    : { value: teu, source: 'simulated_manifest' };

  const cargoType: Sourced<string> = v.cargoType
    ? v.cargoType
    : { value: cargoLabel(v.type), source: 'simulated_manifest' };

  const berthPriority: Sourced<number> = v.berthPriority
    ? v.berthPriority
    : { value: Math.min(10, Math.max(1, Math.floor(teu / 1_200) + 1)), source: 'estimated' };

  return {
    ...v,
    dwt,
    vesselClass,
    teuEstimate,
    cargoType,
    berthPriority,
    assignedCranes: v.assignedCranes ?? 3,
  };
}

/**
 * Read TEU for simulation (yard load, crane time).
 */
export function getVesselTeuForOps(v: SimVessel): number {
  if (v.teuEstimate?.value != null) return Math.max(100, v.teuEstimate.value);
  return Math.max(100, estimateTeuFromDwt(v.dwt, v.type));
}
