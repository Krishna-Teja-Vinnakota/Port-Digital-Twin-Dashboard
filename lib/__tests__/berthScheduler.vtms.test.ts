import { describe, expect, it } from 'vitest';
import { generateBerthForecastData } from '@/lib/berthScheduler';

describe('berthScheduler VTMS overlays', () => {
  it('keeps response schema while accepting live overlays', () => {
    const result = generateBerthForecastData({
      liveOverlays: [
        {
          id: 'VTMS-1',
          name: 'TEST VESSEL',
          eta: new Date(Date.now() + 3600_000).toISOString(),
          lifecycleState: 'BERTHING',
          berthNumber: 'B2',
          confidence: 0.92,
          teus: 1800,
          vesselType: 'CONTAINER',
        },
      ],
    });

    expect(Array.isArray(result.occupancyGrid)).toBe(true);
    expect(Array.isArray(result.vesselSchedule)).toBe(true);
    expect(Array.isArray(result.weeklySummary)).toBe(true);
    expect(typeof result.avgOccupancy21Day).toBe('number');
    expect(result.vesselSchedule.some((v: { vesselName: string }) => v.vesselName === 'TEST VESSEL')).toBe(true);
  });
});
