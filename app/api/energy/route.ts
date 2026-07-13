/**
 * app/api/energy/route.ts
 * Energy and substation data from Azure IoT Hub when configured,
 * falling back to generateEnergyData() simulation transparently.
 *
 * Response shape: identical to generateEnergyData() output + _iotStatus field.
 * Components reading substations/totalConsumptionMW/etc. require zero changes.
 * _iotStatus is the new field for the "IoT Hub Ready" badge in the Energy tab.
 */

import { NextResponse } from 'next/server';
import { generateEnergyData } from '@/lib/mockDataGen';
import { fetchIoTSubstations, getIoTHubStatus } from '@/lib/iotHub';
import { withApiLogging } from '@/lib/apiLogger';

type EnergySource = 'LIVE' | 'SIMULATION';

async function getHandler() {
  const sim       = generateEnergyData();
  const iotStatus = getIoTHubStatus();

  try {
    const liveSubstations = await fetchIoTSubstations();

    if (liveSubstations.length > 0) {
      const totalMW = liveSubstations.reduce((s, ss) => s + ss.currentMW, 0);
      const avgVoltage = liveSubstations.reduce((s, ss) => s + ss.voltage, 0) / liveSubstations.length;
      const inferredGridFreq = Math.max(
        49.5,
        Math.min(50.5, parseFloat((50 + ((avgVoltage - 11) / 11) * 0.4).toFixed(2)))
      );

      const metricSources: Record<string, EnergySource> = {
        substations: 'LIVE',
        totalConsumptionMW: 'LIVE',
        peakLoadToday: 'LIVE',
        gridFrequency: 'LIVE',
        greenEnergyRatio: 'SIMULATION',
        consumption24h: 'SIMULATION',
      };
      const totalMetrics = Object.keys(metricSources).length;
      const liveMetrics = Object.values(metricSources).filter((s) => s === 'LIVE').length;

      return NextResponse.json({
        substations:        liveSubstations,
        totalConsumptionMW: parseFloat(totalMW.toFixed(1)),
        greenEnergyRatio:   sim.greenEnergyRatio,
        consumption24h:     sim.consumption24h,
        peakLoadToday:      parseFloat((totalMW * 1.2).toFixed(1)),
        gridFrequency:      inferredGridFreq,
        _iotStatus:         { ...iotStatus, substationsLive: liveSubstations.length },
        _sources: metricSources,
        _liveCoverage: {
          liveMetrics,
          totalMetrics,
          isFullyLive: liveMetrics === totalMetrics,
        },
      }, { headers: { 'X-Data-Source': 'Azure IoT Hub LIVE' } });
    }
  } catch (err) {
    console.error('[energy/route] IoT fetch error:', err);
  }

  const metricSources: Record<string, EnergySource> = {
    substations: 'SIMULATION',
    totalConsumptionMW: 'SIMULATION',
    peakLoadToday: 'SIMULATION',
    gridFrequency: 'SIMULATION',
    greenEnergyRatio: 'SIMULATION',
    consumption24h: 'SIMULATION',
  };

  return NextResponse.json({
    ...sim,
    _iotStatus: { ...iotStatus, substationsLive: 0 },
    _sources: metricSources,
    _liveCoverage: {
      liveMetrics: 0,
      totalMetrics: Object.keys(metricSources).length,
      isFullyLive: false,
    },
  }, { headers: { 'X-Data-Source': 'Simulation (SCADA/IoT pending)' } });
}

export const GET = withApiLogging('GET', '/api/energy', getHandler);