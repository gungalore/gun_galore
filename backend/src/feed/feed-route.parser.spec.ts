import {
  FEED_MAX_ROUTE_POINTS,
  FEED_MAX_ROUTE_SOURCE_POINTS,
} from './feed.types';
import { GpxRouteError, parseGpxRoute } from './feed-route.parser';

// ─────────────────────────────────────────────────────────────────────
// The GPX parser is the security and correctness boundary for route uploads:
// it is the only thing that reads member-supplied XML. These fixtures are
// inline strings (no binary files in the repo) and cover both the happy path
// shapes (track/route, namespaces, multi-segment) and every rejection rule.
// ─────────────────────────────────────────────────────────────────────

const GPX_1_1 = 'http://www.topografix.com/GPX/1/1';
const GPX_1_0 = 'http://www.topografix.com/GPX/1/0';

function doc(body: string, version: '1.1' | '1.0' = '1.1'): string {
  const ns = version === '1.1' ? GPX_1_1 : GPX_1_0;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="${version}" creator="test" xmlns="${ns}">${body}</gpx>`;
}

function pt(
  lat: number,
  lon: number,
  ele?: number | null,
  time?: string | null,
): string {
  return `<trkpt lat="${lat}" lon="${lon}">${ele !== undefined && ele !== null ? `<ele>${ele}</ele>` : ''}${time ? `<time>${time}</time>` : ''}</trkpt>`;
}

function rtePt(
  lat: number,
  lon: number,
  ele?: number | null,
  time?: string | null,
): string {
  return `<rtept lat="${lat}" lon="${lon}">${ele !== undefined && ele !== null ? `<ele>${ele}</ele>` : ''}${time ? `<time>${time}</time>` : ''}</rtept>`;
}

/** 2026-01-01T00:00:00Z plus `minutes`. */
function stamp(minutes: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + minutes * 60_000).toISOString();
}

interface Pt {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

/**
 * A usable hike: 21 points, ~11 m of northing per step and a ±10 m lateral
 * zigzag so Douglas–Peucker (>2 m deviation) keeps the interior points. Total
 * distance is ~400 m, i.e. comfortably over the 100 m floor.
 */
function hikePoints(
  count = 21,
  opts: { ele?: boolean; time?: boolean; minutesPerPoint?: number } = {},
): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push({
      lat: -33.1 + i * 0.0001,
      lon: 18.1 + (i % 2 === 0 ? 0.0001 : -0.0001),
      ele: opts.ele === false ? undefined : 100 + i * 2,
      time:
        opts.time === false
          ? undefined
          : stamp(i * (opts.minutesPerPoint ?? 1)),
    });
  }
  return points;
}

function trkseg(points: Pt[]): string {
  return `<trkseg>${points.map((p) => pt(p.lat, p.lon, p.ele, p.time)).join('')}</trkseg>`;
}

function routePoints(points: Pt[]): string {
  return points.map((p) => rtePt(p.lat, p.lon, p.ele, p.time)).join('');
}

function expectRouteError(text: string, pattern: RegExp): void {
  let thrown: unknown;
  try {
    parseGpxRoute(text);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(GpxRouteError);
  expect((thrown as Error).message).toMatch(pattern);
}

describe('parseGpxRoute', () => {
  describe('accepted shapes', () => {
    it('parses a single-segment track and derives metrics', () => {
      const route = parseGpxRoute(doc(`<trk>${trkseg(hikePoints())}</trk>`));

      expect(route.segmentCount).toBe(1);
      expect(route.segments).toHaveLength(1);
      // Douglas–Peucker keeps every zigzag point at 2 m tolerance.
      expect(route.pointCount).toBe(21);
      expect(route.segments[0]).toHaveLength(21);
      expect(route.distanceM).toBeGreaterThan(100);
      expect(route.distanceM).toBeLessThan(1_000);
      expect(route.hasElevation).toBe(true);
      expect(route.minElevationM).toBe(100);
      expect(route.maxElevationM).toBe(140);
      // +2 m every point, with a 2 m threshold: the whole climb counts.
      expect(route.ascentM).toBe(40);
      expect(route.descentM).toBe(0);
      expect(route.durationSeconds).toBe(20 * 60);
      expect(route.hasSpeed).toBe(true);
      // ~80-sample sparkline, in metres.
      expect(route.profile).toHaveLength(80);
      expect(route.profile?.[0]).toBe(100);
      expect(route.profile?.[79]).toBe(140);
      expect(route.bounds).toEqual({
        south: -33.1,
        west: 18.0999,
        north: -33.1 + 20 * 0.0001,
        east: 18.1001,
      });
    });

    it('parses a route (rte) as well as a track', () => {
      const route = parseGpxRoute(
        doc(`<rte>${routePoints(hikePoints(21, { ele: false, time: false }))}</rte>`),
      );
      expect(route.segmentCount).toBe(1);
      expect(route.distanceM).toBeGreaterThan(100);
      // togeojson does not export rte times; the route is still valid.
      expect(route.durationSeconds).toBeNull();
      expect(route.hasSpeed).toBe(false);
    });

    it('accepts GPX 1.0 and 1.1 default namespaces', () => {
      const body = `<trk>${trkseg(hikePoints())}</trk>`;
      expect(parseGpxRoute(doc(body, '1.0')).segmentCount).toBe(1);
      expect(parseGpxRoute(doc(body, '1.1')).segmentCount).toBe(1);
    });

    it('handles a multi-segment track and sums each segment duration', () => {
      const first = hikePoints(11);
      const second = hikePoints(11, { minutesPerPoint: 1 }).map((p, i) => ({
        ...p,
        lat: p.lat - 0.02,
        time: stamp(100 + i),
      }));
      const route = parseGpxRoute(
        doc(`<trk>${trkseg(first)}${trkseg(second)}</trk>`),
      );

      expect(route.segmentCount).toBe(2);
      expect(route.pointCount).toBeGreaterThanOrEqual(20);
      expect(route.segments).toHaveLength(2);
      // Each segment spans 10 minutes; the gap between segments is not travel.
      expect(route.durationSeconds).toBe(2 * 10 * 60);
      // Cumulative distance carries across the boundary (the jump between
      // two segments is not counted as distance walked).
      expect(route.segments[1][0].distM).toBeGreaterThanOrEqual(
        route.segments[0][route.segments[0].length - 1].distM,
      );
    });

    it('prefers the recorded track over a planned route in the same file', () => {
      const track = hikePoints().map((p) => ({ ...p, ele: 100 + 0 }));
      const planned = hikePoints().map((p) => ({ ...p, ele: 9_000 }));
      const route = parseGpxRoute(
        doc(
          `<rte>${routePoints(planned)}</rte><trk>${trkseg(track)}</trk>`,
        ),
      );
      // The 9000 m route must not win: elevation comes from the track.
      expect(route.maxElevationM).toBe(100);
      expect(route.minElevationM).toBe(100);
      expect(route.ascentM).toBe(0);
    });

    it('treats a track with no elevation as a valid, flat route', () => {
      const route = parseGpxRoute(
        doc(`<trk>${trkseg(hikePoints(21, { ele: false }))}</trk>`),
      );
      expect(route.hasElevation).toBe(false);
      expect(route.ascentM).toBeNull();
      expect(route.descentM).toBeNull();
      expect(route.minElevationM).toBeNull();
      expect(route.maxElevationM).toBeNull();
      expect(route.profile).toBeNull();
      expect(route.segments[0].every((p) => p.ele === null)).toBe(true);
      // Times are still there, so speed survives.
      expect(route.hasSpeed).toBe(true);
    });

    it('treats a track with no timestamps as a valid route without speed', () => {
      const route = parseGpxRoute(
        doc(`<trk>${trkseg(hikePoints(21, { time: false }))}</trk>`),
      );
      expect(route.durationSeconds).toBeNull();
      expect(route.hasSpeed).toBe(false);
      expect(route.segments[0].every((p) => p.speedKph === null)).toBe(true);
      // Elevation gradient does not need timestamps.
      expect(route.segments[0][10].gradientPct).not.toBeNull();
    });

    it('never returns the absolute timestamps it read for speed/duration', () => {
      const route = parseGpxRoute(
        doc(`<trk>${trkseg(hikePoints())}</trk>`),
      );
      const serialised = JSON.stringify(route);
      expect(serialised).not.toContain('2026-01-01T');
      expect(Object.keys(route.segments[0][0]).sort()).toEqual([
        'distM',
        'ele',
        'gradientPct',
        'lat',
        'lon',
        'speedKph',
      ]);
    });

    it('drops invalid coordinates instead of failing the whole route', () => {
      const valid = hikePoints(21);
      const xml = valid
        .map((p) => pt(p.lat, p.lon, p.ele, p.time))
        .join('') +
        '<trkpt lat="999" lon="18.1"></trkpt>' +
        '<trkpt lat="-33.2" lon="999"></trkpt>' +
        '<trkpt lat="abc" lon="18.2"></trkpt>';
      const route = parseGpxRoute(doc(`<trk><trkseg>${xml}</trkseg></trk>`));
      expect(route.pointCount).toBe(21);
    });

    it('rounds coordinates and keeps the first/last point of each segment', () => {
      const route = parseGpxRoute(
        doc(`<trk>${trkseg(hikePoints())}</trk>`),
      );
      const first = route.segments[0][0];
      const last = route.segments[0][route.segments[0].length - 1];
      expect(first.distM).toBe(0);
      expect(first.lat).toBe(-33.1);
      expect(last.lat).toBeCloseTo(-33.1 + 20 * 0.0001, 6);
      // Cumulative distance is monotonic.
      for (let i = 1; i < route.segments[0].length; i += 1) {
        expect(route.segments[0][i].distM).toBeGreaterThan(
          route.segments[0][i - 1].distM,
        );
      }
    });

    it('accepts a short hand-drawn track of 16 points', () => {
      // The operator's 1 KB Central Park sample: 16 points, ~8 km, elevation,
      // no timestamps. A high point-count floor rejected this as a real file.
      const points = [
        [40.7681, -73.9819, 15],
        [40.77, -73.974, 18],
        [40.775, -73.971, 23],
        [40.78, -73.968, 27],
        [40.785, -73.965, 30],
        [40.79, -73.962, 35],
        [40.795, -73.959, 40],
        [40.797, -73.962, 45],
        [40.798, -73.966, 43],
        [40.794, -73.97, 38],
        [40.79, -73.972, 33],
        [40.785, -73.974, 28],
        [40.78, -73.976, 22],
        [40.775, -73.978, 19],
        [40.77, -73.98, 16],
        [40.7681, -73.9819, 15],
      ]
        .map(([lat, lon, ele]) => pt(lat, lon, ele))
        .join('');
      const route = parseGpxRoute(
        doc(`<trk><name>Central Park outer loop run</name><trkseg>${points}</trkseg></trk>`),
      );
      // Simplification keeps the shape, not every source point.
      expect(route.pointCount).toBeGreaterThanOrEqual(2);
      expect(route.pointCount).toBeLessThanOrEqual(16);
      expect(route.segmentCount).toBe(1);
      expect(route.distanceM).toBeGreaterThan(1000);
      expect(route.hasElevation).toBe(true);
      expect(route.hasSpeed).toBe(false);
      expect(route.segments[0][0].gradientPct).not.toBeNull();
    });
  });

  describe('speed and gradient', () => {
    it('derives speed from a centred window and keeps it at the ends', () => {
      const route = parseGpxRoute(
        doc(`<trk>${trkseg(hikePoints())}</trk>`),
      );
      const points = route.segments[0];
      // The window is clipped at the ends (one-sided), so the first/last points
      // still show a speed rather than an empty inspector on open.
      for (const edge of [0, 1, points.length - 2, points.length - 1]) {
        expect(points[edge].speedKph).not.toBeNull();
      }
      const middle = points[10];
      expect(middle.speedKph).not.toBeNull();
      expect(middle.speedKph as number).toBeGreaterThan(0);
      expect(middle.speedKph as number).toBeLessThan(10);
    });

    it('derives a smoothed gradient and clamps to sane bounds', () => {
      const route = parseGpxRoute(
        doc(`<trk>${trkseg(hikePoints())}</trk>`),
      );
      const points = route.segments[0];
      expect(points[0].gradientPct).not.toBeNull();
      expect(points[1].gradientPct).not.toBeNull();
      expect(points[10].gradientPct).not.toBeNull();
      // ~2 m rise per ~21 m step.
      expect(points[10].gradientPct as number).toBeGreaterThan(1);
      expect(points[10].gradientPct as number).toBeLessThan(50);
      expect(Math.abs(points[10].gradientPct as number)).toBeLessThanOrEqual(100);
    });

    it('returns null speed when a window timestamp is missing', () => {
      const points = hikePoints();
      // Index 10's centred window reaches index 12; without that timestamp the
      // centre point cannot claim a speed even though it has its own time.
      points[12].time = undefined;
      const route = parseGpxRoute(doc(`<trk>${trkseg(points)}</trk>`));
      expect(route.segments[0][10].speedKph).toBeNull();
      expect(route.segments[0][9].speedKph).not.toBeNull();
    });
  });

  describe('rejections', () => {
    it('rejects an empty upload', () => {
      expectRouteError('', /empty/i);
      expectRouteError('   ', /empty/i);
    });

    it('rejects a DOCTYPE declaration', () => {
      const body = `<!DOCTYPE gpx [<!ELEMENT gpx ANY>]>${doc('<trk></trk>')}`;
      expectRouteError(body, /document type|entity/i);
    });

    it('rejects an ENTITY declaration (XXE / billion laughs)', () => {
      const body = `<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><gpx version="1.1"><trk><trkseg><trkpt lat="&xxe;" lon="18"></trkpt></trkseg></trk></gpx>`;
      expectRouteError(body, /document type|entity/i);
    });

    it('rejects malformed XML', () => {
      expectRouteError('<gpx><trk><trkseg><trkpt lat="1" lon="2">', /parsed as XML/i);
      expectRouteError('this is not xml at all', /parsed as XML/i);
    });

    it('rejects a replacement character (invalid UTF-8)', () => {
      const body = doc(`<trk>${trkseg(hikePoints())}</trk>`).replace(
        'creator="test"',
        'creator="te\uFFFDst"',
      );
      expectRouteError(body, /UTF-8/i);
    });

    it('rejects a file with no track or route', () => {
      expectRouteError(
        doc('<wpt lat="-33.1" lon="18.1"><name>Start</name></wpt>'),
        /no track or route/i,
      );
    });

    it('rejects a route too short to be a hike', () => {
      const points = hikePoints().map((p, i) => ({
        ...p,
        lat: -33.1 + i * 0.00001,
        lon: 18.1,
      }));
      expectRouteError(doc(`<trk>${trkseg(points)}</trk>`), /too short/i);
    });

    it('rejects a track with a single point', () => {
      expectRouteError(
        doc(`<trk><trkseg>${pt(-33.1, 18.1)}</trkseg></trk>`),
        /at least two|no track/i,
      );
    });

    it('rejects a route whose coordinates are all unusable', () => {
      const bad = Array.from(
        { length: 21 },
        () => '<trkpt lat="999" lon="18.1"></trkpt>',
      ).join('');
      expectRouteError(doc(`<trk><trkseg>${bad}</trkseg></trk>`), /at least two/i);
    });

    it('rejects more than the allowed number of segments', () => {
      const segments = Array.from({ length: 21 }, (_, i) => {
        const pts = hikePoints(3).map((p) => ({
          ...p,
          lat: p.lat + i * 0.01,
        }));
        return trkseg(pts);
      }).join('');
      expectRouteError(doc(`<trk>${segments}</trk>`), /too many segments/i);
    });

    it(`rejects more than ${FEED_MAX_ROUTE_SOURCE_POINTS} source points`, () => {
      const points = Array.from(
        { length: FEED_MAX_ROUTE_SOURCE_POINTS + 1 },
        (_, i) => `<trkpt lat="${-33.1 + i * 0.000001}" lon="18.1"/>`,
      ).join('');
      expectRouteError(
        doc(`<trk><trkseg>${points}</trkseg></trk>`),
        /at most .* points/i,
      );
    });
  });

  describe('simplification', () => {
    it('reduces a dense route to the point cap while keeping its shape', () => {
      // A 2 100-point zigzag survives the 2 m and 4 m passes (>2 m of lateral
      // deviation), forcing the tolerance to double until it fits.
      const dense: Pt[] = [];
      const count = 2_100;
      for (let i = 0; i < count; i += 1) {
        dense.push({
          lat: -33.1 + i * 0.000002,
          lon: 18.1 + (i % 2 === 0 ? 0.0001 : -0.0001),
          ele: 100 + (i % 50),
          time: stamp(i * 0.02),
        });
      }
      const route = parseGpxRoute(doc(`<trk>${trkseg(dense)}</trk>`));
      expect(route.pointCount).toBeLessThanOrEqual(FEED_MAX_ROUTE_POINTS);
      expect(route.pointCount).toBeGreaterThanOrEqual(2);
      expect(route.segmentCount).toBe(1);
      expect(route.segments[0].length).toBe(route.pointCount);
      // The endpoints survive simplification, so the route still starts and
      // ends where the member's did.
      expect(route.segments[0][0].lat).toBeCloseTo(-33.1, 6);
      expect(route.segments[0][route.pointCount - 1].lat).toBeCloseTo(
        -33.1 + (count - 1) * 0.000002,
        6,
      );
    });
  });
});
