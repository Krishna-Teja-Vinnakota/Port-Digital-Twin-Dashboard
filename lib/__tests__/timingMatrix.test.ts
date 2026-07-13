/**
 * timingMatrix.test.ts
 * Unit tests for lib/timingMatrix.ts — Phase 1 acceptance criteria.
 *
 * Coverage:
 *   ✓ Base constants are positive numbers in expected ranges
 *   ✓ getEffectiveTime — identity (no modifiers), multiplicative chain, edge cases
 *   ✓ getYardFactor — correct band resolution at every threshold boundary
 *   ✓ getCurrentTimingProfile — clear baseline, weather modifiers, incident modifiers
 *   ✓ getCurrentTimingProfile — scenario overrides composed correctly
 *   ✓ getCurrentTimingProfile — compound modifiers (rain + yard + scenario)
 *   ✓ buildDelayAttributionString — on-baseline, positive delay, negative delta
 *   ✓ getBaseTimingSnapshot — shape check
 *
 * Run: npx vitest run
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants
  BASE_GATE_PROCESS,
  BASE_CUSTOMS_CHECK,
  BASE_YARD_TRANSIT,
  BASE_CRANE_UNLOAD_PER_TEU,
  BASE_BERTH_TURNAROUND,
  BASE_PREBERTHING_WAIT,
  BASE_LOADING_UNLOADING,
  BASE_APPROACHING_PORT,
  // Modifier data
  WEATHER_FACTORS,
  INCIDENT_FACTORS,
  YARD_FACTORS,
  VESSEL_TYPE_CRANE_FACTORS,
  // Utilities
  getEffectiveTime,
  getYardFactor,
  getCurrentTimingProfile,
  buildDelayAttributionString,
  getBaseTimingSnapshot,
} from '../timingMatrix';

// ─────────────────────────────────────────────────────────────────────────────
// 1. BASE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Base timing constants', () => {
  it('BASE_GATE_PROCESS is a positive number (minutes)', () => {
    expect(BASE_GATE_PROCESS).toBeGreaterThan(0);
    expect(typeof BASE_GATE_PROCESS).toBe('number');
  });

  it('BASE_CUSTOMS_CHECK is a positive number (minutes)', () => {
    expect(BASE_CUSTOMS_CHECK).toBeGreaterThan(0);
  });

  it('BASE_YARD_TRANSIT is a positive number (minutes)', () => {
    expect(BASE_YARD_TRANSIT).toBeGreaterThan(0);
  });

  it('BASE_CRANE_UNLOAD_PER_TEU is 1–5 minutes (realistic crane cycle range)', () => {
    expect(BASE_CRANE_UNLOAD_PER_TEU).toBeGreaterThanOrEqual(1);
    expect(BASE_CRANE_UNLOAD_PER_TEU).toBeLessThanOrEqual(5);
  });

  it('BASE_BERTH_TURNAROUND equals 18 hours in minutes', () => {
    expect(BASE_BERTH_TURNAROUND).toBe(18 * 60);
  });

  it('BASE_PREBERTHING_WAIT is a positive number', () => {
    expect(BASE_PREBERTHING_WAIT).toBeGreaterThan(0);
  });

  it('BASE_LOADING_UNLOADING is a positive number', () => {
    expect(BASE_LOADING_UNLOADING).toBeGreaterThan(0);
  });

  it('BASE_APPROACHING_PORT is a positive number', () => {
    expect(BASE_APPROACHING_PORT).toBeGreaterThan(0);
  });

  it('getBaseTimingSnapshot returns all 8 constants', () => {
    const snap = getBaseTimingSnapshot();
    expect(snap).toHaveProperty('BASE_GATE_PROCESS', BASE_GATE_PROCESS);
    expect(snap).toHaveProperty('BASE_CUSTOMS_CHECK', BASE_CUSTOMS_CHECK);
    expect(snap).toHaveProperty('BASE_YARD_TRANSIT', BASE_YARD_TRANSIT);
    expect(snap).toHaveProperty('BASE_CRANE_UNLOAD_PER_TEU', BASE_CRANE_UNLOAD_PER_TEU);
    expect(snap).toHaveProperty('BASE_BERTH_TURNAROUND', BASE_BERTH_TURNAROUND);
    expect(snap).toHaveProperty('BASE_PREBERTHING_WAIT', BASE_PREBERTHING_WAIT);
    expect(snap).toHaveProperty('BASE_LOADING_UNLOADING', BASE_LOADING_UNLOADING);
    expect(snap).toHaveProperty('BASE_APPROACHING_PORT', BASE_APPROACHING_PORT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. getEffectiveTime
// ─────────────────────────────────────────────────────────────────────────────

describe('getEffectiveTime()', () => {
  it('returns base unchanged when no modifiers provided', () => {
    expect(getEffectiveTime(10, [])).toBe(10);
  });

  it('returns base unchanged when modifier array is empty', () => {
    expect(getEffectiveTime(BASE_GATE_PROCESS, [])).toBe(BASE_GATE_PROCESS);
  });

  it('applies a single multiplier correctly', () => {
    const result = getEffectiveTime(10, [{ factor: 1.5 }]);
    expect(result).toBe(15);
  });

  it('chains multiple multipliers (order-independent multiplication)', () => {
    // 10 × 1.4 × 1.15 = 16.1
    const result = getEffectiveTime(10, [
      { factor: 1.4 },
      { factor: 1.15 },
    ]);
    expect(result).toBeCloseTo(16.1, 2);
  });

  it('identity modifier (factor=1.0) does not change output', () => {
    const result = getEffectiveTime(BASE_CUSTOMS_CHECK, [
      { factor: 1.0, label: 'No change' },
    ]);
    expect(result).toBe(BASE_CUSTOMS_CHECK);
  });

  it('handles zero base gracefully', () => {
    expect(getEffectiveTime(0, [{ factor: 2.0 }])).toBe(0);
  });

  it('returns value rounded to 2 decimal places', () => {
    // 10 × 1.3 = 13.0 exactly, but 7 × 1.3 = 9.1 (repeating in float)
    const result = getEffectiveTime(7, [{ factor: 1.3 }]);
    const decimals = result.toString().split('.')[1];
    expect(!decimals || decimals.length <= 2).toBe(true);
  });

  it('factor < 1 reduces effective time (improvement scenario)', () => {
    const result = getEffectiveTime(10, [{ factor: 0.85 }]);
    expect(result).toBeCloseTo(8.5, 2);
  });

  it('compound: weather(1.4) × yard(1.35) × scenario(1.2) on gate base', () => {
    const expected = parseFloat((BASE_GATE_PROCESS * 1.4 * 1.35 * 1.2).toFixed(2));
    const result = getEffectiveTime(BASE_GATE_PROCESS, [
      { factor: 1.4 },
      { factor: 1.35 },
      { factor: 1.2 },
    ]);
    expect(result).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. getYardFactor — threshold boundary tests
// ─────────────────────────────────────────────────────────────────────────────

describe('getYardFactor()', () => {
  it('returns factor 1.0 at 0% occupancy (free flow)', () => {
    expect(getYardFactor(0).factor).toBe(1.0);
  });

  it('returns factor 1.0 just below 70% threshold', () => {
    expect(getYardFactor(69.9).factor).toBe(1.0);
  });

  it('returns factor 1.15 at exactly 70% (moderate band)', () => {
    expect(getYardFactor(70).factor).toBe(1.15);
  });

  it('returns factor 1.15 at 80% (within moderate band)', () => {
    expect(getYardFactor(80).factor).toBe(1.15);
  });

  it('returns factor 1.15 just below 85%', () => {
    expect(getYardFactor(84.9).factor).toBe(1.15);
  });

  it('returns factor 1.35 at exactly 85% (heavy band)', () => {
    expect(getYardFactor(85).factor).toBe(1.35);
  });

  it('returns factor 1.35 at 90% (within heavy band)', () => {
    expect(getYardFactor(90).factor).toBe(1.35);
  });

  it('returns factor 1.35 just below 95%', () => {
    expect(getYardFactor(94.9).factor).toBe(1.35);
  });

  it('returns factor 1.70 at exactly 95% (critical band)', () => {
    expect(getYardFactor(95).factor).toBe(1.70);
  });

  it('returns factor 1.70 at 100% (fully saturated)', () => {
    expect(getYardFactor(100).factor).toBe(1.70);
  });

  it('clamps values above 100% to critical band', () => {
    expect(getYardFactor(110).factor).toBe(1.70);
  });

  it('clamps negative values to free-flow band', () => {
    expect(getYardFactor(-10).factor).toBe(1.0);
  });

  it('each band modifier has a non-empty label', () => {
    [0, 70, 85, 95].forEach(pct => {
      const mod = getYardFactor(pct);
      expect(typeof mod.label).toBe('string');
      expect(mod.label!.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. getCurrentTimingProfile — baseline
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentTimingProfile() — baseline (clear, no incident, empty yard)', () => {
  const profile = getCurrentTimingProfile({
    weather: 'clear',
    incidentType: 'none',
    yardOccupancyPct: 0,
    vesselType: 'CONTAINER',
  });

  it('returns all five timing fields', () => {
    expect(profile).toHaveProperty('gateProcess');
    expect(profile).toHaveProperty('customsCheck');
    expect(profile).toHaveProperty('yardTransit');
    expect(profile).toHaveProperty('craneUnloadPerTEU');
    expect(profile).toHaveProperty('berthTurnaround');
  });

  it('gateProcess equals BASE_GATE_PROCESS at baseline', () => {
    expect(profile.gateProcess).toBe(BASE_GATE_PROCESS);
  });

  it('customsCheck equals BASE_CUSTOMS_CHECK at baseline', () => {
    expect(profile.customsCheck).toBe(BASE_CUSTOMS_CHECK);
  });

  it('yardTransit equals BASE_YARD_TRANSIT at baseline', () => {
    expect(profile.yardTransit).toBe(BASE_YARD_TRANSIT);
  });

  it('craneUnloadPerTEU equals BASE_CRANE_UNLOAD_PER_TEU at baseline (CONTAINER)', () => {
    // CONTAINER vessel type factor = 1.0, so effective = base × 1.0 = base
    expect(profile.craneUnloadPerTEU).toBe(BASE_CRANE_UNLOAD_PER_TEU);
  });

  it('berthTurnaround equals BASE_BERTH_TURNAROUND at baseline', () => {
    expect(profile.berthTurnaround).toBe(BASE_BERTH_TURNAROUND);
  });

  it('appliedModifiers is empty at full baseline (all factors = 1.0)', () => {
    expect(profile.appliedModifiers).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. getCurrentTimingProfile — weather modifiers
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentTimingProfile() — weather modifiers', () => {
  it('rain increases gateProcess by ×1.15', () => {
    const profile = getCurrentTimingProfile({ weather: 'rain' });
    const expected = parseFloat((BASE_GATE_PROCESS * 1.15).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('heavy_rain increases gateProcess by ×1.40', () => {
    const profile = getCurrentTimingProfile({ weather: 'heavy_rain' });
    const expected = parseFloat((BASE_GATE_PROCESS * 1.40).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('storm increases gateProcess by ×1.75', () => {
    const profile = getCurrentTimingProfile({ weather: 'storm' });
    const expected = parseFloat((BASE_GATE_PROCESS * 1.75).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('heavy_rain also increases craneUnloadPerTEU by ×1.40', () => {
    const profile = getCurrentTimingProfile({
      weather: 'heavy_rain',
      vesselType: 'CONTAINER',
    });
    const expected = parseFloat((BASE_CRANE_UNLOAD_PER_TEU * 1.40).toFixed(2));
    expect(profile.craneUnloadPerTEU).toBe(expected);
  });

  it('weather modifiers appear in appliedModifiers with labels', () => {
    const profile = getCurrentTimingProfile({ weather: 'heavy_rain' });
    const labels = profile.appliedModifiers.map(m => m.label);
    expect(labels.some(l => l?.toLowerCase().includes('rain'))).toBe(true);
  });

  it('worse weather always gives higher effective time than milder weather', () => {
    const clear     = getCurrentTimingProfile({ weather: 'clear' });
    const rain      = getCurrentTimingProfile({ weather: 'rain' });
    const heavyRain = getCurrentTimingProfile({ weather: 'heavy_rain' });
    const storm     = getCurrentTimingProfile({ weather: 'storm' });
    expect(rain.gateProcess).toBeGreaterThan(clear.gateProcess);
    expect(heavyRain.gateProcess).toBeGreaterThan(rain.gateProcess);
    expect(storm.gateProcess).toBeGreaterThan(heavyRain.gateProcess);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. getCurrentTimingProfile — incident modifiers
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentTimingProfile() — incident modifiers', () => {
  it('crane_breakdown increases craneUnloadPerTEU significantly (×2.20)', () => {
    const profile = getCurrentTimingProfile({
      weather: 'clear',
      incidentType: 'crane_breakdown',
      vesselType: 'CONTAINER',
    });
    const expected = parseFloat((BASE_CRANE_UNLOAD_PER_TEU * 2.20).toFixed(2));
    expect(profile.craneUnloadPerTEU).toBe(expected);
  });

  it('crane_breakdown increases berthTurnaround by ×1.35', () => {
    const profile = getCurrentTimingProfile({
      weather: 'clear',
      incidentType: 'crane_breakdown',
    });
    const expected = parseFloat((BASE_BERTH_TURNAROUND * 1.35).toFixed(2));
    expect(profile.berthTurnaround).toBe(expected);
  });

  it('crane_breakdown does NOT affect gateProcess', () => {
    const profile = getCurrentTimingProfile({
      weather: 'clear',
      incidentType: 'crane_breakdown',
    });
    // gate is not affected by crane breakdown
    expect(profile.gateProcess).toBe(BASE_GATE_PROCESS);
  });

  it('gate_closure increases gateProcess by ×1.60', () => {
    const profile = getCurrentTimingProfile({
      weather: 'clear',
      incidentType: 'gate_closure',
    });
    const expected = parseFloat((BASE_GATE_PROCESS * 1.60).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('custom_delay increases customsCheck by ×1.30', () => {
    const profile = getCurrentTimingProfile({
      weather: 'clear',
      incidentType: 'custom_delay',
    });
    const expected = parseFloat((BASE_CUSTOMS_CHECK * 1.30).toFixed(2));
    expect(profile.customsCheck).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. getCurrentTimingProfile — yard occupancy feedback
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentTimingProfile() — yard occupancy feedback', () => {
  it('empty yard (0%) gives baseline gateProcess', () => {
    const profile = getCurrentTimingProfile({ yardOccupancyPct: 0 });
    expect(profile.gateProcess).toBe(BASE_GATE_PROCESS);
  });

  it('yard at 88% (heavy band) inflates gateProcess by ×1.35', () => {
    const profile = getCurrentTimingProfile({ yardOccupancyPct: 88 });
    const expected = parseFloat((BASE_GATE_PROCESS * 1.35).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('yard at 97% (critical band) inflates gateProcess by ×1.70', () => {
    const profile = getCurrentTimingProfile({ yardOccupancyPct: 97 });
    const expected = parseFloat((BASE_GATE_PROCESS * 1.70).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('higher occupancy always yields higher effective yard transit time', () => {
    // 50% = low band, 78% = moderate, 92% = heavy, 98% = critical
    const low  = getCurrentTimingProfile({ yardOccupancyPct: 50 });
    const mid  = getCurrentTimingProfile({ yardOccupancyPct: 78 });
    const high = getCurrentTimingProfile({ yardOccupancyPct: 92 });
    const crit = getCurrentTimingProfile({ yardOccupancyPct: 98 });
    expect(mid.yardTransit).toBeGreaterThan(low.yardTransit);
    expect(high.yardTransit).toBeGreaterThan(mid.yardTransit);
    expect(crit.yardTransit).toBeGreaterThan(high.yardTransit);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. getCurrentTimingProfile — scenario overrides
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentTimingProfile() — scenario overrides', () => {
  it('gateProcessMultiplier override compounds with weather', () => {
    // heavy_rain(1.40) × scenario(1.25) × yard(1.0)
    const profile = getCurrentTimingProfile({
      weather: 'heavy_rain',
      incidentType: 'none',
      yardOccupancyPct: 0,
      scenarioOverrides: { gateProcessMultiplier: 1.25 },
    });
    const expected = parseFloat((BASE_GATE_PROCESS * 1.40 * 1.25).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('berthTurnaroundMultiplier override applies cleanly at baseline', () => {
    const profile = getCurrentTimingProfile({
      weather: 'clear',
      scenarioOverrides: { berthTurnaroundMultiplier: 1.5 },
    });
    const expected = parseFloat((BASE_BERTH_TURNAROUND * 1.5).toFixed(2));
    expect(profile.berthTurnaround).toBe(expected);
  });

  it('craneUnloadMultiplier override compounds with weather modifier', () => {
    const profile = getCurrentTimingProfile({
      weather: 'rain',
      vesselType: 'CONTAINER',
      scenarioOverrides: { craneUnloadMultiplier: 2.0 },
    });
    // rain(1.15) × incident(1.0) × CONTAINER(1.0) × scenario(2.0)
    const expected = parseFloat((BASE_CRANE_UNLOAD_PER_TEU * 1.15 * 2.0).toFixed(2));
    expect(profile.craneUnloadPerTEU).toBe(expected);
  });

  it('scenario override appears in appliedModifiers list', () => {
    const profile = getCurrentTimingProfile({
      scenarioOverrides: { gateProcessMultiplier: 1.3 },
    });
    const labels = profile.appliedModifiers.map(m => m.label ?? '');
    expect(labels.some(l => l.toLowerCase().includes('scenario'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. getCurrentTimingProfile — compound modifiers (worst-case stress)
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentTimingProfile() — compound modifier stress test', () => {
  it('storm + crane breakdown + critical yard compounds on berthTurnaround', () => {
    const profile = getCurrentTimingProfile({
      weather: 'storm',
      incidentType: 'crane_breakdown',
      yardOccupancyPct: 97,
    });
    // storm(1.75) × craneBreakdown(1.35) — berthTurnaround
    const expected = parseFloat((BASE_BERTH_TURNAROUND * 1.75 * 1.35).toFixed(2));
    expect(profile.berthTurnaround).toBe(expected);
  });

  it('storm + yard critical × scenario compounds on gate', () => {
    const profile = getCurrentTimingProfile({
      weather: 'storm',
      yardOccupancyPct: 97,
      scenarioOverrides: { gateProcessMultiplier: 1.2 },
    });
    // storm(1.75) × gateIncident(1.0) × yard(1.70) × scenario(1.2)
    const expected = parseFloat((BASE_GATE_PROCESS * 1.75 * 1.70 * 1.2).toFixed(2));
    expect(profile.gateProcess).toBe(expected);
  });

  it('all five timings are always positive numbers', () => {
    const profile = getCurrentTimingProfile({
      weather: 'storm',
      incidentType: 'crane_breakdown',
      yardOccupancyPct: 99,
    });
    expect(profile.gateProcess).toBeGreaterThan(0);
    expect(profile.customsCheck).toBeGreaterThan(0);
    expect(profile.yardTransit).toBeGreaterThan(0);
    expect(profile.craneUnloadPerTEU).toBeGreaterThan(0);
    expect(profile.berthTurnaround).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. buildDelayAttributionString
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDelayAttributionString()', () => {
  it('returns "On baseline schedule" when effective equals base (±0.04 tolerance)', () => {
    const result = buildDelayAttributionString(10, 10, []);
    expect(result).toBe('On baseline schedule');
  });

  it('shows positive delta with + prefix', () => {
    const result = buildDelayAttributionString(10, 15, [{ factor: 1.5, label: 'Heavy rain' }]);
    expect(result).toMatch(/^\+5\.0m/);
  });

  it('includes cause labels in attribution text', () => {
    const result = buildDelayAttributionString(10, 15, [
      { factor: 1.3, label: 'Heavy rain' },
      { factor: 1.15, label: 'Yard 85–95%' },
    ]);
    expect(result).toContain('Heavy rain');
    expect(result).toContain('Yard 85–95%');
  });

  it('ignores identity modifiers (factor=1.0) in attribution text', () => {
    const result = buildDelayAttributionString(10, 13, [
      { factor: 1.3, label: 'Rain' },
      { factor: 1.0, label: 'No incident' },
    ]);
    expect(result).not.toContain('No incident');
  });

  it('shows negative delta (improvement) correctly', () => {
    const result = buildDelayAttributionString(10, 8.5, [{ factor: 0.85, label: 'Priority vessel' }]);
    expect(result).toMatch(/^-1\.5m/);
  });

  it('handles empty modifier list gracefully', () => {
    const result = buildDelayAttributionString(5, 7.5, []);
    expect(result).toMatch(/^\+2\.5m$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Modifier data integrity checks
// ─────────────────────────────────────────────────────────────────────────────

describe('Modifier data integrity', () => {
  it('WEATHER_FACTORS has entries for all four weather types', () => {
    ['clear', 'rain', 'heavy_rain', 'storm'].forEach(w => {
      expect(WEATHER_FACTORS).toHaveProperty(w);
      expect(Array.isArray(WEATHER_FACTORS[w])).toBe(true);
    });
  });

  it('all WEATHER_FACTORS have factor >= 1.0 (weather only delays)', () => {
    Object.values(WEATHER_FACTORS).flat().forEach(m => {
      expect(m.factor).toBeGreaterThanOrEqual(1.0);
    });
  });

  it('INCIDENT_FACTORS has entries for all four incident types', () => {
    ['none', 'crane_breakdown', 'gate_closure', 'custom_delay'].forEach(i => {
      expect(INCIDENT_FACTORS).toHaveProperty(i);
    });
  });

  it('VESSEL_TYPE_CRANE_FACTORS covers all five vessel types', () => {
    ['CONTAINER', 'BULK_CARRIER', 'TANKER', 'RO_RO', 'GENERAL'].forEach(t => {
      expect(VESSEL_TYPE_CRANE_FACTORS).toHaveProperty(t);
      expect(VESSEL_TYPE_CRANE_FACTORS[t as keyof typeof VESSEL_TYPE_CRANE_FACTORS].factor).toBeGreaterThan(0);
    });
  });

  it('YARD_FACTORS thresholds are in strictly increasing order', () => {
    const { low, moderate, heavy, critical } = YARD_FACTORS;
    expect(low.lowerBound).toBeLessThan(moderate.lowerBound);
    expect(moderate.lowerBound).toBeLessThan(heavy.lowerBound);
    expect(heavy.lowerBound).toBeLessThan(critical.lowerBound);
  });

  it('YARD_FACTORS multipliers are in strictly non-decreasing order', () => {
    const { low, moderate, heavy, critical } = YARD_FACTORS;
    expect(moderate.factor).toBeGreaterThanOrEqual(low.factor);
    expect(heavy.factor).toBeGreaterThanOrEqual(moderate.factor);
    expect(critical.factor).toBeGreaterThanOrEqual(heavy.factor);
  });
});
