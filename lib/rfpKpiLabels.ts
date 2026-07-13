/**
 * RFP objective references for in-dashboard KPI lines (pre-bid POC).
 * Keys are KPI card label strings; values are one-line RFP cross-walks.
 */

export const RFP_KPI_LABELS: Record<string, string> = {
  'Avg Vessel TAT': 'Obj. I — marine / berth throughput monitoring',
  'Pre-Berthing Detention': 'Obj. I — queue & pilot / anchorage',
  'Berth Occupancy': 'Obj. I — berth & marine capacity',
  'Avg Import Dwell Time': 'Obj. II / IV — box dwell & hinterland',
  'Avg Export Dwell Time': 'Obj. II / IV — dwell & pre-stack',
  'DPD %': 'Obj. II — DPD & gate / yard efficiency',
  'DPE %': 'Obj. II — DPE & export flow',
  'Gate Congestion': 'Obj. II / III — gate & landside',
  'Trucks in Geo-Fence': 'Obj. III — truck & road intelligence',
  'Carbon Emissions Index': 'Obj. V — ESG & emissions',
  'Crane Moves/hr': 'Obj. II — terminal productivity (TOS proxy)',
  'Pilot Performance Time': 'Obj. I — pilotage & port calls',
  'Yard Utilization %': 'Obj. II — yard capacity',
  'Gate Queue (total)': 'Obj. II / III — gate throughput',
};

export function rfpRefForKpiLabel(label: string): string | undefined {
  return RFP_KPI_LABELS[label];
}
