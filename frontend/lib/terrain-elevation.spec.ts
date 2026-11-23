import { describe, expect, it, vi } from 'vitest';
import type { FeedRoutePoint } from './community-api';
import {
  applyTerrainElevations,
  fetchTerrainElevations,
  sampleRouteForTerrain,
  terrainElevationAt,
  terrainElevationStats,
} from './terrain-elevation';

function point(overrides: Partial<FeedRoutePoint> = {}): FeedRoutePoint {
  return {
    lat: 40,
    lon: -73,
    ele: 10,
    speedKph: 5,
    gradientPct: 1,
    distM: 0,
    ...overrides,
  };
}

describe('sampleRouteForTerrain', () => {
  it('keeps the first and last points and respects the 50-position cap', () => {
    const points = Array.from({ length: 120 }, (_, i) =>
      point({ lat: 40 + i * 0.0001, lon: -73, distM: i * 10 }),
    );
    const samples = sampleRouteForTerrain([points], 50);
    expect(samples).toHaveLength(50);
    expect(samples[0]).toMatchObject({ lat: points[0].lat, distM: 0 });
    expect(samples[samples.length - 1]).toMatchObject({
      lat: points[points.length - 1].lat,
      distM: points[points.length - 1].distM,
    });
  });

  it('returns one sample for a one-point route and handles empty input', () => {
    expect(sampleRouteForTerrain([], 50)).toEqual([]);
    const one = sampleRouteForTerrain([[point({ lat: 1, lon: 2 })]], 50);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ lat: 1, lon: 2 });
  });
});

describe('fetchTerrainElevations', () => {
  it('asks MapTiler for lng,lat positions and returns the elevations in order', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [
        [-73, 40, 12.5],
        [-72.9, 40.1, 18],
      ],
    })) as unknown as typeof fetch;
    const samples = [
      { lat: 40, lon: -73, distM: 0 },
      { lat: 40.1, lon: -72.9, distM: 100 },
    ];
    await expect(fetchTerrainElevations(samples, 'key-1', fetchImpl)).resolves.toEqual([
      12.5, 18,
    ]);
    const url = String(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(url).toContain('/elevation/-73,40;-72.9,40.1.json');
    expect(url).toContain('key=key-1');
  });

  it('returns null on a failed, malformed or partial response', async () => {
    const responses = [
      { ok: false, json: async () => [] },
      { ok: true, json: async () => [[-73, 40]] },
      { ok: true, json: async () => [[-73, 40, 12.5]] },
    ];
    const samples = [
      { lat: 40, lon: -73, distM: 0 },
      { lat: 40.1, lon: -72.9, distM: 100 },
    ];
    for (const response of responses) {
      const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
      await expect(fetchTerrainElevations(samples, 'key', fetchImpl)).resolves.toBeNull();
    }
  });
});

describe('terrain interpolation and stats', () => {
  const samples = [
    { lat: 40, lon: -73, distM: 0 },
    { lat: 40.01, lon: -73, distM: 100 },
  ];

  it('interpolates elevation by distance', () => {
    expect(terrainElevationAt(samples, [10, 20], 50)).toBe(15);
    expect(terrainElevationAt(samples, [10, 20], -10)).toBe(10);
    expect(terrainElevationAt(samples, [10, 20], 200)).toBe(20);
  });

  it('replaces elevation and gradient from terrain while preserving speed', () => {
    const dense = [
      [
        point({ distM: 0, ele: 1, speedKph: 7, gradientPct: -99 }),
        point({ distM: 50, ele: 2, speedKph: 7, gradientPct: -99 }),
        point({ distM: 100, ele: 3, speedKph: 7, gradientPct: -99 }),
      ],
    ];
    const out = applyTerrainElevations(dense, samples, [10, 20]);
    expect(out[0].map((p) => p.ele)).toEqual([10, 15, 20]);
    expect(out[0].map((p) => p.speedKph)).toEqual([7, 7, 7]);
    // 10 m rise over 100 m run = 10%.
    expect(out[0][0].gradientPct).toBeCloseTo(10, 0);
    expect(out[0][1].gradientPct).toBeCloseTo(10, 0);
  });

  it('computes terrain ascent, descent, min and max', () => {
    const stats = terrainElevationStats([
      [
        point({ distM: 0, ele: 10 }),
        point({ distM: 100, ele: 20 }),
        point({ distM: 200, ele: 15 }),
      ],
    ]);
    expect(stats).toEqual({
      ascentM: 10,
      descentM: 5,
      minElevationM: 10,
      maxElevationM: 20,
    });
  });

  it('returns nulls when there is no terrain elevation', () => {
    expect(terrainElevationStats([[point({ ele: null })]])).toEqual({
      ascentM: null,
      descentM: null,
      minElevationM: null,
      maxElevationM: null,
    });
  });
});
