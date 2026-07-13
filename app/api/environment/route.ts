/**
 * app/api/environment/route.ts
 * Live environmental data — always falls back to simulation on any error.
 * Uses Promise.allSettled throughout so no individual source can crash the route.
 */

import { NextResponse } from 'next/server';
import { generateEnvironmentData } from '@/lib/mockDataGen';
import { getSimulationState } from '@/lib/simulationStore';
import { fetchLiveAirQuality } from '@/lib/airQuality';
import { fetchLiveWaterQuality } from '@/lib/weatherOcean';
import { fetchLiveNDVI } from '@/lib/ndvi';
import { withApiLogging } from '@/lib/apiLogger';
import { calcAnchoredFleetCarbon } from '@/lib/carbonCalculator';

async function getHandler() {
  // Simulation baseline — instant, never fails
  const sim    = generateEnvironmentData();
  const state  = getSimulationState();
  const anchoredCarbon = calcAnchoredFleetCarbon(state.vessels, {
    fuelType: 'HFO',
    minHoursPerAnchored: 0.5,
  });

  // Fire all live fetches in parallel — allSettled means none can throw
  const [liveAQI, liveWater, liveNDVI] = await Promise.allSettled([
    fetchLiveAirQuality().catch(e => { console.error('[env/route] AQI error:', e?.message); return null; }),
    fetchLiveWaterQuality().catch(e => { console.error('[env/route] Water error:', e?.message); return null; }),
    fetchLiveNDVI().catch(e => { console.error('[env/route] NDVI error:', e?.message); return null; }),
  ]);

  // ── NDVI ──
  const ndviVal  = liveNDVI.status === 'fulfilled' && liveNDVI.value;
  const ndviScore    = ndviVal ? ndviVal.ndviScore    : sim.ndviScore;
  const ndviCategory = ndviVal ? ndviVal.ndviCategory : sim.ndviCategory;
  const ndviSource   = ndviVal ? ndviVal.source       : 'SIMULATION';

  // ── AQI ──
  const aqiVal = liveAQI.status === 'fulfilled' && liveAQI.value;
  const aqi = aqiVal
    ? {
        overall:  aqiVal.overall,
        category: aqiVal.category,
        pm25:     aqiVal.pm25,
        pm10:     aqiVal.pm10,
        co2:      aqiVal.co2,
        no2:      aqiVal.no2,
        so2:      aqiVal.so2,
        _station: aqiVal.station,
        _source:  aqiVal.source,
      }
    : { ...sim.aqi, _source: 'SIMULATION' };

  // ── Water Quality ──
  const waterVal = liveWater.status === 'fulfilled' && liveWater.value;
  const waterQuality = waterVal
    ? {
        ph:              waterVal.ph,
        salinity:        waterVal.salinity,
        dissolvedOxygen: waterVal.dissolvedOxygen,
        turbidity:       waterVal.turbidity,
        overallIndex:    waterVal.overallIndex,
        _source:         'Open-Meteo Marine + NOAA ERDDAP LIVE',
      }
    : { ...sim.waterQuality, _source: 'SIMULATION' };

  return NextResponse.json({
    ndviScore,
    ndviCategory,
    aqi,
    waterQuality,
    carbonCostData: {
      baseRatePerHour: anchoredCarbon.avgRatePerVesselPerHour || sim.carbonCostData.baseRatePerHour,
      currentAnchoredVessels: anchoredCarbon.anchoredVesselCount,
      totalCarbonToday: anchoredCarbon.totalCarbonTons,
      _source: 'IMO_ESTIMATED_FROM_VESSEL_STATE',
    },
    lastUpdated: new Date().toISOString(),
    _sources: {
      ndvi:         ndviSource,
      aqi:          aqi._source,
      waterQuality: waterQuality._source,
    },
  });
}

export const GET = withApiLogging('GET', '/api/environment', getHandler);