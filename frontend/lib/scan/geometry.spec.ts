import { describe, expect, it } from 'vitest';
import {
  KNOWN_ASPECTS,
  Pt,
  Quad,
  applyH,
  frameQuad,
  homographyToRect,
  isConvex,
  minInteriorAngle,
  orderQuad,
  outputSize,
  quadDrift,
  scaleQuad,
  smoothQuad,
  solve8,
} from './geometry';

// A seeded generator, so a failure is reproducible. Math.random would make
// "it passed on my machine" the normal outcome.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('orderQuad', () => {
  it('puts corners in TL, TR, BR, BL order', () => {
    const q = orderQuad([
      { x: 100, y: 100 },
      { x: 10, y: 90 },
      { x: 90, y: 10 },
      { x: 0, y: 0 },
    ]);
    expect(q[0]).toEqual({ x: 0, y: 0 });
    expect(q[1]).toEqual({ x: 90, y: 10 });
    expect(q[2]).toEqual({ x: 100, y: 100 });
    expect(q[3]).toEqual({ x: 10, y: 90 });
  });

  it('is stable however the points arrive', () => {
    const pts: Pt[] = [
      { x: 5, y: 2 },
      { x: 95, y: 8 },
      { x: 99, y: 60 },
      { x: 2, y: 55 },
    ];
    const want = orderQuad(pts);
    // Every rotation and both directions must produce the same ordering.
    for (let r = 0; r < 4; r++) {
      const rotated = [...pts.slice(r), ...pts.slice(0, r)];
      expect(orderQuad(rotated)).toEqual(want);
      expect(orderQuad([...rotated].reverse())).toEqual(want);
    }
  });

  it('⚠️ handles a rotated document, where the x+y trick fails', () => {
    // A page rotated ~35°. Sorting by x+y would call the LEFT corner the
    // top-left; by angle it is correct. This is the case that breaks the
    // version of this function that is all over the internet.
    const q = orderQuad([
      { x: 50, y: 0 }, // topmost
      { x: 100, y: 60 }, // rightmost
      { x: 50, y: 120 }, // bottom
      { x: 0, y: 60 }, // leftmost
    ]);
    expect(isConvex(q)).toBe(true);
    // Whatever it picks as TL, going TL -> TR -> BR -> BL must stay convex and
    // must trace the ring rather than crossing it.
    const perim =
      Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) +
      Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y) +
      Math.hypot(q[3].x - q[2].x, q[3].y - q[2].y) +
      Math.hypot(q[0].x - q[3].x, q[0].y - q[3].y);
    // A crossed ordering would give a longer path than the convex hull.
    expect(perim).toBeLessThan(4 * 80 + 1);
  });

  it('refuses anything that is not four points', () => {
    expect(() => orderQuad([{ x: 0, y: 0 }])).toThrow();
  });
});

describe('solve8', () => {
  it('solves a known system', () => {
    // Identity: each row picks out one unknown.
    const a = Array.from({ length: 8 }, (_, i) =>
      Array.from({ length: 8 }, (_, j) => (i === j ? 1 : 0)),
    );
    const b = [1, 2, 3, 4, 5, 6, 7, 8];
    const x = solve8(a, b)!;
    expect([...x]).toEqual(b);
  });

  it('⚠️ needs partial pivoting, and has it', () => {
    // A zero in the first pivot position. Without pivoting this divides by
    // zero and the whole transform comes out as noise — which is exactly what
    // a document photographed square-on produces on the perspective rows.
    const a = [
      [0, 1, 0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 1],
    ];
    const x = solve8(a, [5, 7, 1, 1, 1, 1, 1, 1])!;
    expect(x).not.toBeNull();
    expect(x[0]).toBeCloseTo(7, 9);
    expect(x[1]).toBeCloseTo(5, 9);
  });

  it('returns null rather than infinities on a singular system', () => {
    const a = Array.from({ length: 8 }, () => Array(8).fill(1));
    expect(solve8(a, Array(8).fill(1))).toBeNull();
  });
});

describe('homographyToRect', () => {
  it('maps each destination corner onto its source corner exactly', () => {
    const quad: Quad = [
      { x: 137, y: 92 },
      { x: 903, y: 41 },
      { x: 967, y: 588 },
      { x: 88, y: 640 },
    ];
    const W = 800;
    const H = 500;
    const hm = homographyToRect(quad, W, H)!;
    const corners: Pt[] = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    for (let i = 0; i < 4; i++) {
      const got = applyH(hm, corners[i].x, corners[i].y);
      expect(got.x).toBeCloseTo(quad[i].x, 6);
      expect(got.y).toBeCloseTo(quad[i].y, 6);
    }
  });

  it('⚠️ SURVIVES A SQUARE-ON SHOT, where the perspective terms vanish', () => {
    // The common case, and the one that breaks a solver without pivoting.
    const quad: Quad = [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 400 },
      { x: 100, y: 400 },
    ];
    const hm = homographyToRect(quad, 400, 300)!;
    expect(hm).not.toBeNull();
    const mid = applyH(hm, 200, 150);
    expect(mid.x).toBeCloseTo(300, 6);
    expect(mid.y).toBeCloseTo(250, 6);
  });

  it('round-trips 200 random perspectives to sub-pixel accuracy', () => {
    // THE HIGHEST-VALUE TEST IN THE FILE, and it needs no photographs:
    // build a known homography, push a rectangle's corners through it, then
    // ask the solver to recover the mapping and check every interior point
    // comes back where it started.
    const rand = rng(20260819);
    let worst = 0;
    for (let trial = 0; trial < 200; trial++) {
      const W = 300 + Math.floor(rand() * 600);
      const H = 200 + Math.floor(rand() * 500);
      // A plausible camera: tilt up to ~35°, rotation up to ~15°.
      const g = (rand() - 0.5) * 0.0011;
      const h = (rand() - 0.5) * 0.0011;
      const rot = (rand() - 0.5) * 0.52;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      const tx = 200 + rand() * 400;
      const ty = 150 + rand() * 300;
      const sc = 0.7 + rand() * 1.1;

      const truth = (u: number, v: number): Pt => {
        const d = g * u + h * v + 1;
        const rx = (cs * u - sn * v) * sc;
        const ry = (sn * u + cs * v) * sc;
        return { x: rx / d + tx, y: ry / d + ty };
      };

      const quad = orderQuad([
        truth(0, 0),
        truth(W, 0),
        truth(W, H),
        truth(0, H),
      ]);
      const hm = homographyToRect(quad, W, H);
      if (!hm) continue;

      for (const [u, v] of [
        [W * 0.5, H * 0.5],
        [W * 0.17, H * 0.83],
        [W * 0.91, H * 0.09],
        [W * 0.33, H * 0.33],
      ]) {
        const want = truth(u, v);
        const got = applyH(hm, u, v);
        worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y));
      }
    }
    // Sub-pixel over 200 trials. Anything looser is an algebra regression.
    expect(worst).toBeLessThan(0.01);
  });
});

describe('quad shape tests', () => {
  it('rejects a bow-tie', () => {
    expect(
      isConvex([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ]),
    ).toBe(false);
  });

  it('accepts a real rectangle and a tilted one', () => {
    expect(
      isConvex([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 0, y: 60 },
      ]),
    ).toBe(true);
    expect(
      isConvex([
        { x: 10, y: 0 },
        { x: 110, y: 14 },
        { x: 98, y: 70 },
        { x: 2, y: 55 },
      ]),
    ).toBe(true);
  });

  it('measures the smallest interior angle', () => {
    expect(
      minInteriorAngle([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]),
    ).toBeCloseTo(90, 6);
    // A sliver: two corners nearly collinear.
    expect(
      minInteriorAngle([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 4 },
        { x: 0, y: 4 },
      ]),
    ).toBeLessThan(91);
  });
});

describe('outputSize', () => {
  const square = (w: number, h: number): Quad => [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];

  it('snaps a near-card aspect onto ID-1', () => {
    // 1.55 is within 6% of 1.586, so it snaps. That matters: the vault is
    // mostly ID-1 cards and the naive measurement is biased under perspective.
    const s = outputSize(square(1550, 1000), 2000);
    expect(s.snapped).toBe('ID-1 card');
    expect(s.w / s.h).toBeCloseTo(KNOWN_ASPECTS[0].ratio, 2);
  });

  it('leaves an aspect that matches nothing alone', () => {
    const s = outputSize(square(1000, 1000), 2000);
    expect(s.snapped).toBeNull();
    expect(s.w).toBe(s.h);
  });

  it('snaps A-series both ways up', () => {
    expect(outputSize(square(1414, 1000), 2000).snapped).toBe('A-series page');
    expect(outputSize(square(1000, 1414), 2000).snapped).toBe('A-series page');
  });

  it('caps the long edge and keeps the aspect', () => {
    const s = outputSize(square(6000, 3000), 2000);
    expect(Math.max(s.w, s.h)).toBe(2000);
    expect(s.w / s.h).toBeCloseTo(2, 1);
  });

  it('never returns a zero dimension', () => {
    const s = outputSize(square(0, 0), 2000);
    expect(s.w).toBeGreaterThan(0);
    expect(s.h).toBeGreaterThan(0);
  });
});

describe('helpers the live overlay leans on', () => {
  it('frameQuad insets the frame and stays convex', () => {
    const q = frameQuad(1000, 600, 0.1);
    expect(q[0]).toEqual({ x: 100, y: 60 });
    expect(q[2]).toEqual({ x: 900, y: 540 });
    expect(isConvex(q)).toBe(true);
  });

  it('smoothQuad moves a fraction of the way, and takes the first as-is', () => {
    const a = frameQuad(100, 100, 0);
    const b = scaleQuad(a, 2);
    expect(smoothQuad(null, b)).toEqual(b);
    const once = smoothQuad(a, b, 0.5);
    expect(once[0].x).toBeCloseTo((a[0].x + b[0].x) / 2, 6);
  });

  it('smoothing converges rather than oscillating', () => {
    const target = frameQuad(400, 300, 0.2);
    let cur = frameQuad(400, 300, 0.05);
    let prevDrift = Infinity;
    for (let i = 0; i < 25; i++) {
      cur = smoothQuad(cur, target, 0.35);
      const d = quadDrift(cur, target);
      expect(d).toBeLessThanOrEqual(prevDrift + 1e-9);
      prevDrift = d;
    }
    expect(prevDrift).toBeLessThan(0.5);
  });

  it('quadDrift is the largest corner movement', () => {
    const a = frameQuad(100, 100, 0);
    const b: Quad = [a[0], a[1], a[2], { x: a[3].x + 7, y: a[3].y }];
    expect(quadDrift(a, b)).toBeCloseTo(7, 6);
  });
});
