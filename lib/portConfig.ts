/**
 * Port static port blueprint (nominal capacities, service rates, geometry links).
 *
 * Replace numbers with operations-sourced values over time. This module is safe to
 * import from engines, APIs, and future `getEffectivePortConfig(base, scenarios)`.
 */

import type { PortConfig } from './portConfig.types';

export type {
  PortConfig,
  PortConfigMeta,
  StaticGateConfig,
  StaticBerthConfig,
  StaticYardBlockConfig,
  StaticRailSidingConfig,
  PortOperationalDefaults,
} from './portConfig.types';

/**
 * Representative Nhava Sheva / Port digital-twin baseline.
 * Gate positions match lib/gateEngine.js (keep in sync if you move gates on the map).
 */
export const Port_PORT_CONFIG: PortConfig = {
  meta: {
    id: 'port',
    name: 'Port',
    fullName: 'the Port Authority (Nhava Sheva)',
    version: '1.0.0',
    lastReviewed: '2026-04-27',
    notes:
      'Nominal estimates for simulation. Calibrate maxTeu, crane rates, and gate service ' +
      'times with terminal ops or published planning parameters before production decisions.',
  },

  gates: [
    {
      id: 1,
      code: 'G1',
      displayName: 'Gate 1 - Import (North)',
      primaryFlow: 'IMPORT',
      position: { lat: 18.952, lng: 72.964 },
      service: {
        avgTruckProcessMins: 4.2,
        nominalTrucksPerHour: 12,
        activeLanes: 2,
      },
      designMaxQueueTrucks: 40,
    },
    {
      id: 2,
      code: 'G2',
      displayName: 'Gate 2 - Export (North)',
      primaryFlow: 'EXPORT',
      position: { lat: 18.948, lng: 72.968 },
      service: {
        avgTruckProcessMins: 4.0,
        nominalTrucksPerHour: 14,
        activeLanes: 2,
      },
      designMaxQueueTrucks: 40,
    },
    {
      id: 3,
      code: 'G3',
      displayName: 'Gate 3 - Import (South)',
      primaryFlow: 'IMPORT',
      position: { lat: 18.94, lng: 72.972 },
      service: {
        avgTruckProcessMins: 4.5,
        nominalTrucksPerHour: 11,
        activeLanes: 2,
      },
      designMaxQueueTrucks: 45,
    },
    {
      id: 4,
      code: 'G4',
      displayName: 'Gate 4 - Export (South)',
      primaryFlow: 'EXPORT',
      position: { lat: 18.936, lng: 72.97 },
      service: {
        avgTruckProcessMins: 4.0,
        nominalTrucksPerHour: 13,
        activeLanes: 2,
      },
      designMaxQueueTrucks: 50,
    },
  ],

  berths: [
    {
      id: 'B01',
      code: 'B1',
      displayName: 'NSICT Main Berth 1',
      quay: 'NSICT',
      maxDraftM: 14.5,
      quayLengthM: 350,
      maxConcurrentVessels: 1,
      nominalStsCranes: 4,
      movesPerCranePerHour: 30,
      maxLoaM: 366,
      status: 'OPERATIONAL',
    },
    {
      id: 'B02',
      code: 'B2',
      displayName: 'NSICT Main Berth 2',
      quay: 'NSICT',
      maxDraftM: 15.0,
      quayLengthM: 360,
      maxConcurrentVessels: 1,
      nominalStsCranes: 4,
      movesPerCranePerHour: 30,
      maxLoaM: 400,
      status: 'OPERATIONAL',
    },
    {
      id: 'B03',
      code: 'B3',
      displayName: 'JNPCT Berth 1',
      quay: 'JNPCT',
      maxDraftM: 14.0,
      quayLengthM: 300,
      maxConcurrentVessels: 1,
      nominalStsCranes: 3,
      movesPerCranePerHour: 28,
      maxLoaM: 320,
      status: 'OPERATIONAL',
    },
    {
      id: 'B04',
      code: 'B4',
      displayName: 'GTI Berth 1',
      quay: 'GTI',
      maxDraftM: 16.0,
      quayLengthM: 400,
      maxConcurrentVessels: 1,
      nominalStsCranes: 5,
      movesPerCranePerHour: 32,
      maxLoaM: 400,
      status: 'OPERATIONAL',
    },
    {
      id: 'B05',
      code: 'B5',
      displayName: 'JNPCT Berth 2',
      quay: 'JNPCT',
      maxDraftM: 14.0,
      quayLengthM: 320,
      maxConcurrentVessels: 1,
      nominalStsCranes: 3,
      movesPerCranePerHour: 28,
      maxLoaM: 340,
      status: 'OPERATIONAL',
    },
    {
      id: 'B06',
      code: 'B6',
      displayName: 'NSICT Main Berth 3',
      quay: 'NSICT',
      maxDraftM: 14.5,
      quayLengthM: 350,
      maxConcurrentVessels: 1,
      nominalStsCranes: 4,
      movesPerCranePerHour: 30,
      maxLoaM: 366,
      status: 'OPERATIONAL',
    },
    {
      id: 'B07',
      code: 'B7',
      displayName: 'GTI Berth 2',
      quay: 'GTI',
      maxDraftM: 16.0,
      quayLengthM: 380,
      maxConcurrentVessels: 1,
      nominalStsCranes: 4,
      movesPerCranePerHour: 32,
      maxLoaM: 400,
      status: 'OPERATIONAL',
    },
    {
      id: 'B08',
      code: 'B8',
      displayName: 'NSICT Main Berth 4',
      quay: 'NSICT',
      maxDraftM: 15.0,
      quayLengthM: 360,
      maxConcurrentVessels: 1,
      nominalStsCranes: 4,
      movesPerCranePerHour: 30,
      maxLoaM: 400,
      status: 'OPERATIONAL',
    },
  ],

  yardBlocks: [
    {
      blockId: 'IMPORT_BLOCK_A',
      displayName: 'Import stack A (NSICT hinterland)',
      category: 'IMPORT',
      maxTeu: 14000,
      initialOccupiedFraction: 0.78,
      nominalThroughputTeuPerHour: 120,
    },
    {
      blockId: 'IMPORT_BLOCK_B',
      displayName: 'Import stack B (consolidation)',
      category: 'IMPORT',
      maxTeu: 12000,
      initialOccupiedFraction: 0.72,
      nominalThroughputTeuPerHour: 110,
    },
    {
      blockId: 'EXPORT_BLOCK_C',
      displayName: 'Export pre-stack C',
      category: 'EXPORT',
      maxTeu: 16000,
      initialOccupiedFraction: 0.75,
      nominalThroughputTeuPerHour: 130,
    },
    {
      blockId: 'REEFER_D',
      displayName: 'Reefer plug zone D',
      category: 'REEFER',
      maxTeu: 4500,
      initialOccupiedFraction: 0.42,
      nominalThroughputTeuPerHour: 60,
      reeferPlugs: 800,
    },
    {
      blockId: 'EMPTY_E',
      displayName: 'Empty container depot E',
      category: 'EMPTY_DEPOT',
      maxTeu: 9000,
      initialOccupiedFraction: 0.55,
      nominalThroughputTeuPerHour: 90,
    },
    {
      blockId: 'CFS_MH01',
      displayName: 'CFS Nhava Sheva interface',
      category: 'CFS',
      maxTeu: 6000,
      initialOccupiedFraction: 0.65,
      nominalThroughputTeuPerHour: 70,
    },
  ],

  railSidings: [
    {
      id: 'RAIL_01',
      code: 'RS1',
      displayName: 'Port north rail head',
      maxConcurrentRakes: 2,
      teuTransferPerHour: 40,
      connectedYardBlockIds: ['IMPORT_BLOCK_A', 'EXPORT_BLOCK_C'],
    },
    {
      id: 'RAIL_02',
      code: 'RS2',
      displayName: 'South siding (ICD handoff)',
      maxConcurrentRakes: 1,
      teuTransferPerHour: 32,
      connectedYardBlockIds: ['IMPORT_BLOCK_B', 'CFS_MH01'],
    },
  ],

  defaults: {
    defaultMovesPerCranePerHour: 30,
    yardCongestionUtilizationThresholdPct: 90,
    gateQueueMediumThreshold: 25,
    gateQueueHighThreshold: 50,
    anchorageNominalWaitHours: { min: 2, max: 18 },
    railBaseline: {
      rakeTatHours: { min: 12, max: 28 },
      onTimePercent: { min: 68, max: 92 },
    },
  },
};

/** Default export for simple imports: `import PORT_CONFIG from '@/lib/portConfig'`. */
export const PORT_CONFIG = Port_PORT_CONFIG;

/**
 * Return the static blueprint (single port today). Later: choose by tenant or env.
 */
export function getBasePortConfig(): PortConfig {
  return Port_PORT_CONFIG;
}
