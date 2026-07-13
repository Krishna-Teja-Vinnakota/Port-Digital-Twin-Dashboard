import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generate21DayOccupancy, generateVesselSchedule } from '@/lib/berthScheduler';
import { generateBerthForecastWithGemini, normalizeBerthForecastPayload } from '@/lib/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const minCreds = path.join(__dirname, 'fixtures', 'min-creds.json');

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getClient = async () => ({
      getAccessToken: async () => ({ token: 'test-access-token' }),
    });
  },
}));

describe('normalizeBerthForecastPayload', () => {
  it('rejects null and empty schedule', () => {
    expect(normalizeBerthForecastPayload(null)).toBeNull();
    expect(normalizeBerthForecastPayload({ occupancyGrid: [], vesselSchedule: [] } as never)).toBeNull();
  });

  it('normalizes a minimal valid payload', () => {
    const today = new Date();
    const ymd = (d: Date) => d.toISOString().split('T')[0];
    const occupancyGrid = Array.from({ length: 21 }, (_, d) => {
      const date = new Date(today);
      date.setDate(today.getDate() + d);
      return {
        date: ymd(date),
        dayLabel: 'Mon, 1 Jan',
        occupancyPercent: 60 + d,
        vessels: 10 + d,
        isWeekend: false,
      };
    });
    const now = new Date();
    const vesselSchedule = [
      {
        id: 'V1',
        vesselName: 'TEST SHIP',
        eta: new Date(now.getTime() + 86_400_000).toISOString(),
        etd: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
        berthNumber: 'B2',
        status: 'CONFIRMED',
        teus: 1500,
        vesselType: 'CONTAINER',
      },
    ];
    const raw = { occupancyGrid, vesselSchedule, weeklySummary: null };
    const out = normalizeBerthForecastPayload(raw);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.occupancyGrid).toHaveLength(21);
    expect(out.vesselSchedule.length).toBeGreaterThan(0);
    expect(typeof out.avgOccupancy21Day).toBe('number');
    expect(out.occupancyGrid[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('generateBerthForecastWithGemini', () => {
  const prevFetch = globalThis.fetch;
  const prevCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = minCreds;
  });

  afterEach(() => {
    globalThis.fetch = prevFetch;
    if (prevCreds === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = prevCreds;
    }
  });

  it('returns null when credentials are not set', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const out = await generateBerthForecastWithGemini({});
    expect(out).toBeNull();
  });

  it('returns normalized forecast on successful Gemini response', async () => {
    const schedule = generateVesselSchedule(2, {});
    const occ = generate21DayOccupancy(schedule);
    const payload = {
      occupancyGrid: occ,
      vesselSchedule: schedule,
      weeklySummary: occ.slice(0, 7).map((d) => ({
        ...d,
        avgTAT: 20,
        totalVesselsHandled: 5,
      })),
    };

    const body = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(payload) }],
          },
        },
      ],
    });

    globalThis.fetch = vi.fn(
      async () =>
        new Response(body, { status: 200, statusText: 'OK' })
    ) as unknown as typeof fetch;

    const out = await generateBerthForecastWithGemini({});
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.occupancyGrid).toHaveLength(21);
    expect(Array.isArray(out.weeklySummary)).toBe(true);
  });

  it('returns null on HTTP error (including when liveOverlays are provided)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 500, statusText: 'Error' })
    ) as unknown as typeof fetch;

    const failed = await generateBerthForecastWithGemini({
      liveOverlays: [
        {
          id: 'VT-99',
          name: 'LIVE VESSEL',
          eta: new Date(Date.now() + 3_600_000).toISOString(),
          lifecycleState: 'BERTHING',
          berthNumber: 'B1',
          confidence: 0.9,
          teus: 1000,
          vesselType: 'CONTAINER',
        },
      ],
    } as {
      liveOverlays: {
        id: string;
        name: string;
        eta: string;
        lifecycleState: string;
        berthNumber: string;
        confidence: number;
        teus: number;
        vesselType: string;
      }[];
    });
    expect(failed).toBeNull();
  });
});
