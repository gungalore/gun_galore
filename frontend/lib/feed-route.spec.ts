import { describe, expect, it } from 'vitest';
import type { FeedRoute, FeedRoutePoint } from './community-api';
import {
  MISSING_VALUE,
  buildElevationGeometry,
  buildProfileGeometry,
  buildRouteGeoJSON,
  buildSelectedPointGeoJSON,
  flattenRoute,
  formatAscent,
  formatDescent,
  formatDistance,
  formatDuration,
  formatElevation,
  formatGradient,
  formatPointLabel,
  formatSpeed,
  haversineMeters,
  nearestPointIndex,
  projectRoute,
} from './feed-route';

function point(overrides: Partial<FeedRoutePoint> = {}): FeedRoutePoint {
  return {
    lat: -30,
    lon: 18,
    ele: 1200,
    speedKph: 4.8,
    gradientPct: 6.3,
    distM: 0,
    ...overrides,
  };
}

function route(): FeedRoute {
  return {
    distanceM: 12400,
    ascentM: 420,
    descentM: 310,
    durationSeconds: 7800,
    pointCount: 4,
    segmentCount: 2,
    hasElevation: true,
    hasSpeed: true,
    gpxShared: true,
    profile: [1200, 1300, 1260, 1250],
    segments: [
      [point({ distM: 0 }), point({ distM: 100, lat: -30.001 })],
      [point({ distM: 120, lat: -30.002 }), point({ distM: 200, lat: -30.003 })],
    ],
    bounds: { south: -30.003, west: 18, north: -30, east: 18 },
  };
}

describe('route formatting', () => {
  it('formats distance in metres under a kilometre and in kilometres above it', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(12400)).toBe('12.4 km');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(999.6)).toBe('1.0 km');
    // Negative can only come from bad data; it still renders rather than NaN.
    expect(formatDistance(-120)).toBe('-120 m');
  });

  it('formats elevation, ascent and descent with thousands separators', () => {
    expect(formatElevation(1240)).toBe('1,240 m');
    expect(formatElevation(999)).toBe('999 m');
    expect(formatElevation(12345)).toBe('12,345 m');
    expect(formatAscent(420)).toBe('420 m');
    expect(formatDescent(310)).toBe('310 m');
  });

  it('formats duration as hours/minutes, and seconds only under a minute', () => {
    expect(formatDuration(7800)).toBe('2 h 10 m');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDuration(300)).toBe('5 m');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(0)).toBe('0 s');
  });

  it('formats speed to one decimal', () => {
    expect(formatSpeed(4.8)).toBe('4.8 km/h');
    expect(formatSpeed(4.75)).toBe('4.8 km/h');
    expect(formatSpeed(-3)).toBe('0.0 km/h');
  });

  it('formats gradient with an explicit sign, positive meaning a climb', () => {
    expect(formatGradient(6.3)).toBe('+6.3%');
    expect(formatGradient(-2.1)).toBe('-2.1%');
    expect(formatGradient(0)).toBe('0.0%');
    // Sub-0.05 noise must not flicker between -0.0 and +0.0.
    expect(formatGradient(-0.01)).toBe('0.0%');
    expect(formatGradient(12.34)).toBe('+12.3%');
  });

  it('renders every missing field as a dash instead of throwing or printing NaN', () => {
    expect(formatDistance(null)).toBe(MISSING_VALUE);
    expect(formatElevation(undefined)).toBe(MISSING_VALUE);
    expect(formatDuration(null)).toBe(MISSING_VALUE);
    expect(formatSpeed(null)).toBe(MISSING_VALUE);
    expect(formatGradient(null)).toBe(MISSING_VALUE);
    expect(formatDistance(Number.NaN)).toBe(MISSING_VALUE);
  });

  it('builds the point label in the documented order', () => {
    expect(formatPointLabel(point())).toBe('0 m · 1,200 m · 4.8 km/h · +6.3%');
    expect(
      formatPointLabel({
        distM: 4200,
        ele: 1240,
        speedKph: 4.8,
        gradientPct: 6.3,
      }),
    ).toBe('4.2 km · 1,240 m · 4.8 km/h · +6.3%');
  });

  it('uses the dash for absent fields inside a point label, not "NaN"', () => {
    expect(
      formatPointLabel({ distM: 4200, ele: null, speedKph: null, gradientPct: null }),
    ).toBe('4.2 km · — · — · —');
  });
});

describe('flattenRoute', () => {
  it('orders points across segments and keeps the provided distM', () => {
    const flat = flattenRoute(route());
    expect(flat).toHaveLength(4);
    expect(flat.map((p) => p.distM)).toEqual([0, 100, 120, 200]);
    expect(flat.map((p) => p.segmentIndex)).toEqual([0, 0, 1, 1]);
    expect(flat.map((p) => p.index)).toEqual([0, 1, 2, 3]);
  });

  it('returns [] for a missing or empty route', () => {
    expect(flattenRoute(null)).toEqual([]);
    expect(flattenRoute({ segments: [] })).toEqual([]);
    expect(flattenRoute({ segments: [[], []] })).toEqual([]);
  });

  it('derives a distance only when a point arrives without one', () => {
    const flat = flattenRoute({
      segments: [
        [
          point({ distM: 0, lat: 0, lon: 0 }),
          point({ distM: Number.NaN, lat: 0, lon: 1 }),
        ],
      ],
    });
    // ~111.2 km by haversine, not a repeat of the previous point's distance.
    expect(flat[1].distM).toBeGreaterThan(111_000);
    expect(flat[1].distM).toBeLessThan(111_400);
  });
});

describe('haversineMeters / nearestPointIndex', () => {
  it('measures one degree of longitude at the equator', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });

  it('finds the closest route point', () => {
    const points = [
      { lat: -30.0, lon: 18.0 },
      { lat: -31.0, lon: 19.0 },
      { lat: -32.0, lon: 20.0 },
    ];
    expect(nearestPointIndex(points, -30.9, 18.9)).toBe(1);
    expect(nearestPointIndex(points, -32, 20)).toBe(2);
    expect(nearestPointIndex([], -30, 18)).toBe(-1);
  });
});

describe('elevation geometry', () => {
  it('maps cumulative distance and elevation into a 0..100 viewBox', () => {
    const geometry = buildElevationGeometry([
      { distM: 0, ele: 100 },
      { distM: 1000, ele: 200 },
      { distM: 2000, ele: 150 },
    ]);
    expect(geometry).not.toBeNull();
    expect(geometry?.minEle).toBe(100);
    expect(geometry?.maxEle).toBe(200);
    expect(geometry?.points.map((p) => p.x)).toEqual([0, 50, 100]);
    expect(geometry?.points.map((p) => p.y)).toEqual([94, 6, 50]);
    expect(geometry?.linePath).toBe('M 0 94 L 50 6 L 100 50');
    expect(geometry?.areaPath).toBe('M 0 94 L 50 6 L 100 50 L 100 100 L 0 100 Z');
  });

  it('treats missing elevations as gaps rather than zeros', () => {
    const geometry = buildElevationGeometry([
      { distM: 0, ele: null },
      { distM: 500, ele: 100 },
      { distM: 1000, ele: null },
      { distM: 1500, ele: 300 },
    ]);
    expect(geometry?.points.map((p) => p.index)).toEqual([1, 3]);
    expect(geometry?.points.map((p) => p.x)).toEqual([0, 100]);
  });

  it('returns null when there is nothing to draw', () => {
    expect(buildElevationGeometry([])).toBeNull();
    expect(buildElevationGeometry([{ distM: 0, ele: 100 }])).toBeNull();
    expect(
      buildElevationGeometry([
        { distM: 0, ele: null },
        { distM: 100, ele: null },
      ]),
    ).toBeNull();
  });

  it('handles a flat profile without dividing by zero', () => {
    const geometry = buildElevationGeometry([
      { distM: 0, ele: 100 },
      { distM: 100, ele: 100 },
    ]);
    expect(geometry?.points.map((p) => p.y)).toEqual([50, 50]);
  });

  it('builds the same shape from the summary profile (evenly spaced samples)', () => {
    const geometry = buildProfileGeometry([100, 200, 150, 100]);
    expect(geometry?.points.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(geometry?.points.map((p) => p.x)).toEqual([0, 33.33, 66.67, 100]);
    expect(geometry?.points.map((p) => p.y)).toEqual([94, 6, 50, 94]);
    expect(buildProfileGeometry(null)).toBeNull();
    expect(buildProfileGeometry([])).toBeNull();
  });
});

describe('map GeoJSON', () => {
  it('emits one LineString per segment, in [lon, lat] order', () => {
    const collection = buildRouteGeoJSON(route().segments);
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].geometry.type).toBe('LineString');
    expect(collection.features[0].geometry.coordinates).toEqual([
      [18, -30],
      [18, -30.001],
    ]);
    expect(collection.features[0].properties.segmentIndex).toBe(0);
    expect(collection.features[1].properties.segmentIndex).toBe(1);
  });

  it('drops segments that cannot form a line', () => {
    const collection = buildRouteGeoJSON([
      [point()],
      [point(), point({ lat: -30.01 })],
    ]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.segmentIndex).toBe(1);
  });

  it('emits an empty collection for no route and the selected point otherwise', () => {
    expect(buildRouteGeoJSON(null).features).toEqual([]);
    const selected = buildSelectedPointGeoJSON(point({ lat: -3, lon: 4 }), 7);
    expect(selected.features).toHaveLength(1);
    expect(selected.features[0].geometry.coordinates).toEqual([4, -3]);
    expect(selected.features[0].properties.index).toBe(7);
    expect(buildSelectedPointGeoJSON(null, 0).features).toEqual([]);
  });
});

describe('projectRoute (the map fallback sketch)', () => {
  it('projects the route inside the viewBox, north at the top', () => {
    const projected = projectRoute([
      [
        { lat: -30, lon: 18 },
        { lat: -30.01, lon: 18.02 },
      ],
    ]);
    expect(projected).not.toBeNull();
    const [first, second] = projected!.segments[0].points;
    expect(projected!.segments).toHaveLength(1);
    expect(projected!.segments[0].d.startsWith('M ')).toBe(true);
    expect(first.x).toBeGreaterThanOrEqual(12);
    expect(second.x).toBeLessThanOrEqual(320 - 12);
    // Southern point sits lower on the SVG.
    expect(second.y).toBeGreaterThan(first.y);
    expect(first.y).toBeGreaterThanOrEqual(12);
    expect(second.y).toBeLessThanOrEqual(220 - 12);
  });

  it('keeps a degree square taller than wide at -30°, i.e. applies cos(latitude)', () => {
    const projected = projectRoute([[
      { lat: -30, lon: 18 },
      { lat: -30.01, lon: 18.01 },
    ]]);
    const [a, b] = projected!.segments[0].points;
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(width);
  });

  it('returns null for an empty route and tolerates a single point', () => {
    expect(projectRoute(null)).toBeNull();
    expect(projectRoute([[]])).toBeNull();
    const single = projectRoute([[{ lat: -30, lon: 18 }]]);
    expect(single?.segments[0].points).toHaveLength(1);
  });
});
