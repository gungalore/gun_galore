import type { Pt } from './letterbox';
import {
  HEATMAP_SIZE,
  MODEL_SIZE,
  PAD_VALUE,
  cellToModelSpace,
  insideContent,
  letterboxFor,
  quadToSourceSpace,
  toModelSpace,
  toSourceSpace,
} from './letterbox';

// ────────────────────────────────────────────────────────────────────
// ⚠️ THE ROUND TRIP IS THE POINT OF THIS FILE.
//
// Four measurement harnesses in this project produced confident, wrong
// numbers, and two of them were this transform — one with no inverse at all
// (predictions left in 256-space, scored against ground truth in original
// pixels, reported as "the model cannot see the document"), one mapping back
// through an intermediate size that no longer existed. Neither threw.
//
// A forward-then-back assertion catches both instantly and costs nothing.
// ────────────────────────────────────────────────────────────────────

const FRAMES: Array<[number, number, string]> = [
  [1920, 1080, 'landscape HD'],
  [1080, 1920, 'portrait HD'],
  [2048, 1536, 'fixture landscape'],
  [1536, 2048, 'fixture portrait'],
  [3840, 2160, 'landscape 4K'],
  [256, 256, 'already square'],
  [4032, 3024, 'phone stills 4:3'],
];

describe('letterbox round trip', () => {
  it('⚠️ BRINGS EVERY POINT BACK TO WHERE IT STARTED', () => {
    for (const [w, h, label] of FRAMES) {
      const lb = letterboxFor(w, h);
      // Corners, centre, and a few awkward interior points.
      const points: Pt[] = [
        { x: 0, y: 0 },
        { x: w, y: h },
        { x: w / 2, y: h / 2 },
        { x: w * 0.13, y: h * 0.87 },
        { x: w * 0.999, y: h * 0.001 },
      ];
      for (const p of points) {
        const back = toSourceSpace(lb, toModelSpace(lb, p));
        // The label goes in the round-trip payload rather than as an expect()
        // message: jest's expect takes no second argument, and a silent
        // failure that does not say WHICH frame size broke is half a test.
        expect({ label, x: back.x, y: back.y }).toEqual({
          label,
          x: expect.closeTo(p.x, 9),
          y: expect.closeTo(p.y, 9),
        });
      }
    }
  });

  it('brings a whole quad back, corner order preserved', () => {
    const lb = letterboxFor(2048, 1536);
    const q = [
      { x: 100, y: 200 },
      { x: 1900, y: 260 },
      { x: 1850, y: 1300 },
      { x: 140, y: 1240 },
    ] as const;
    const back = quadToSourceSpace(lb, q.map((p) => toModelSpace(lb, p)) as never);
    for (let i = 0; i < 4; i++) {
      expect(back[i].x).toBeCloseTo(q[i].x, 9);
      expect(back[i].y).toBeCloseTo(q[i].y, 9);
    }
  });
});

describe('the letterbox itself', () => {
  it('fits the whole frame inside the square, never crops it', () => {
    for (const [w, h] of FRAMES) {
      const lb = letterboxFor(w, h);
      expect(w * lb.scale).toBeLessThanOrEqual(MODEL_SIZE + 1e-9);
      expect(h * lb.scale).toBeLessThanOrEqual(MODEL_SIZE + 1e-9);
      // And one axis fills it exactly — otherwise we are wasting resolution.
      const fills = Math.abs(w * lb.scale - MODEL_SIZE) < 1e-9 || Math.abs(h * lb.scale - MODEL_SIZE) < 1e-9;
      expect(fills).toBe(true);
    }
  });

  it('centres the content, so padding is equal on both sides', () => {
    const lb = letterboxFor(1920, 1080);
    expect(lb.offsetY).toBeGreaterThan(0);
    expect(lb.offsetX).toBeCloseTo(0, 9); // the wide axis fills
    const usedHeight = 1080 * lb.scale;
    expect(lb.offsetY * 2 + usedHeight).toBeCloseTo(MODEL_SIZE, 9);
  });

  it('is the identity for a frame that is already the model size', () => {
    const lb = letterboxFor(MODEL_SIZE, MODEL_SIZE);
    expect(lb.scale).toBe(1);
    expect(lb.offsetX).toBe(0);
    expect(lb.offsetY).toBe(0);
  });

  it('survives a camera that reports nothing, rather than producing NaN', () => {
    const lb = letterboxFor(0, 0);
    const back = toSourceSpace(lb, { x: 10, y: 10 });
    expect(Number.isFinite(back.x)).toBe(true);
    expect(Number.isFinite(back.y)).toBe(true);
  });
});

describe('heatmap cells', () => {
  it('⚠️ MAPS THE CELL CENTRE, NOT ITS TOP-LEFT CORNER', () => {
    // 64 cells over 256 pixels is 4 pixels a cell. Using (i/64)*256 gives the
    // corner and is biased up-left by half a cell — two pixels on every corner
    // of every detection, in the same direction, so it never averages out.
    expect(cellToModelSpace(0, 0)).toEqual({ x: 2, y: 2 });
    expect(cellToModelSpace(63, 63)).toEqual({ x: 254, y: 254 });
    // The naive version would put cell 0 at 0 and cell 63 at 252.
    expect(cellToModelSpace(0, 0).x).not.toBe(0);
  });

  it('keeps every cell inside the input square', () => {
    for (const i of [0, 1, 31, 62, HEATMAP_SIZE - 1]) {
      const p = cellToModelSpace(i, i);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(MODEL_SIZE);
    }
  });
});

describe('padding', () => {
  it('⚠️ IS MID-GREY, NOT BLACK', () => {
    // Black manufactures a hard rectangular edge exactly where a corner
    // detector is looking, and the model latches onto it instead of the
    // document. The reference implementation pads 128 and documents why.
    expect(PAD_VALUE).toBe(128);
  });

  it('can tell a corner predicted on the padding from one on the document', () => {
    const lb = letterboxFor(1920, 1080); // pads top and bottom
    expect(insideContent(lb, { x: 128, y: 128 })).toBe(true);
    // Out on the grey band above the content.
    expect(insideContent(lb, { x: 128, y: lb.offsetY / 2 })).toBe(false);
  });
});
