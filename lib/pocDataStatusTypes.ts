/**
 * Shared JSON shape for GET /api/poc/data-status (client + server).
 */

export type PocDataMode = 'LIVE' | 'SIMULATED' | 'MIXED' | 'MERGED';

export interface PocDataSourceInfo {
  mode: PocDataMode;
  detail: string;
  lastChecked?: string;
}

export interface PocEnvironmentSources {
  aqi: string;
  ndvi: string;
  water: string;
}

export interface PocDataStatus {
  vessels: PocDataSourceInfo;
  trucks: PocDataSourceInfo;
  tosManifest: PocDataSourceInfo;
  environment: PocEnvironmentSources;
  kpi: PocDataSourceInfo;
  lastUpdated: string;
}
