import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchVTMSVessels } from '@/lib/vtmsClient';

describe('vtmsClient', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.VTMS_BASE_URL = 'https://vtms.example.com';
    process.env.VTMS_MAX_STALE_MS = '120000';
    process.env.VTMS_FILTER_TO_Port = 'true';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns normalized vessels on a clean VTMS payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        timestamp: new Date().toISOString(),
        vessels: [
          {
            mmsi: 419001111,
            vesselName: 'MSC GAIA',
            latitude: 18.92,
            longitude: 72.98,
            statusText: 'anchored',
            berthNumber: 'B4',
            confidence: 0.9,
          },
        ],
      }),
    } as Response);

    const result = await fetchVTMSVessels();
    expect(result.ok).toBe(true);
    expect(result.vessels).toHaveLength(1);
    expect(result.vessels[0].id).toContain('VTMS-419001111');
    expect(result.vessels[0].lifecycleState).toBe('ANCHORED');
    expect(result.vessels[0].source).toBe('VTMS_LIVE');
  });

  it('returns fallback when VTMS snapshot is stale', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        timestamp: '2020-01-01T00:00:00.000Z',
        vessels: [{ name: 'OLD TRACK', lat: 18.9, lng: 72.96 }],
      }),
    } as Response);

    const result = await fetchVTMSVessels();
    expect(result.ok).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.fallbackReason).toMatch(/stale/i);
  });

  it('returns fallback when VTMS is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    const result = await fetchVTMSVessels();
    expect(result.ok).toBe(false);
    expect(result.source).toBe('VTMS_UNAVAILABLE');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('ignores malformed rows and reports no usable vessels', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        timestamp: new Date().toISOString(),
        vessels: [{ vesselName: 'BROKEN' }, { x: 'bad', y: 'bad' }],
      }),
    } as Response);
    const result = await fetchVTMSVessels();
    expect(result.ok).toBe(false);
    expect(result.vessels).toHaveLength(0);
    expect(result.fallbackReason).toMatch(/no usable/i);
  });

  it('uses VTMS web snapshot when API base URL is missing', async () => {
    process.env.VTMS_BASE_URL = '';
    process.env.VTMS_WEB_SNAPSHOT_URL = 'https://example.com/vtms-snapshot.json';
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        timestamp: new Date().toISOString(),
        vessels: [
          {
            mmsi: 419009999,
            vesselName: 'WEB SNAP VESSEL',
            latitude: 18.93,
            longitude: 72.99,
            statusText: 'berthing',
            confidence: 0.9,
          },
        ],
      }),
    } as Response);

    const result = await fetchVTMSVessels();
    expect(result.ok).toBe(true);
    expect(result.source).toBe('VTMS_WEB_SNAPSHOT');
    expect(result.vessels).toHaveLength(1);
    expect(result.vessels[0].source).toBe('VTMS_WEB_SNAPSHOT');
    expect(result.vessels[0].confidence).toBeLessThan(0.9);
  });
});
