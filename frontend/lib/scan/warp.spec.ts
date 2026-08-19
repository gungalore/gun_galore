import { describe, expect, it } from 'vitest';
import { Quad } from './geometry';
import {
  Raster,
  SAFE_MINIFICATION,
  halveRGBA,
  prefilterFor,
  rectify,
  warpQuad,
} from './warp';

function blank(w: number, h: number, fill = 0): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(fill);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: w, height: h };
}

function put(r: Raster, x: number, y: number, v: number) {
  const o = (y * r.width + x) * 4;
  r.data[o] = v;
  r.data[o + 1] = v;
  r.data[o + 2] = v;
  r.data[o + 3] = 255;
}

function lumaAt(r: Raster, x: number, y: number): number {
  const o = (Math.round(y) * r.width + Math.round(x)) * 4;
  return r.data[o];
}

/** Alternating one-pixel bars — the pattern that exposes aliasing. */
function bars(w: number, h: number, period = 2): Raster {
  const r = blank(w, h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      put(r, x, y, x % period < period / 2 ? 0 : 255);
    }
  }
  return r;
}

/**
 * The quad covering the whole raster.
 *
 * Corners at w and h, NOT w-1 and h-1: the quad describes the continuous
 * region the pixels cover, and an image w pixels wide covers [0, w]. Using
 * w-1 makes this a slight downscale rather than an identity, which is a
 * subtle enough difference to waste an afternoon on.
 */
const wholeFrame = (w: number, h: number): Quad => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

describe('halveRGBA', () => {
  it('averages each 2x2 block', () => {
    const r = blank(2, 2, 0);
    put(r, 0, 0, 0);
    put(r, 1, 0, 100);
    put(r, 0, 1, 200);
    put(r, 1, 1, 40);
    const h = halveRGBA(r);
    expect(h.width).toBe(1);
    expect(h.height).toBe(1);
    expect(lumaAt(h, 0, 0)).toBe(85); // (0+100+200+40+2)>>2
  });

  it('keeps alpha opaque and does not shift on odd dimensions', () => {
    const r = bars(7, 5);
    const h = halveRGBA(r);
    expect(h.width).toBe(3);
    expect(h.height).toBe(2);
    for (let i = 3; i < h.data.length; i += 4) expect(h.data[i]).toBe(255);
  });

  it('never produces a zero dimension', () => {
    const h = halveRGBA(blank(1, 1));
    expect(h.width).toBe(1);
    expect(h.height).toBe(1);
  });
});

describe('prefilterFor — the anti-aliasing guard', () => {
  it('halves until the remaining minification is mild', () => {
    const { raster, scale } = prefilterFor(blank(4000, 3000), 500, 375);
    expect(raster.width / 500).toBeLessThanOrEqual(SAFE_MINIFICATION);
    expect(scale).toBeCloseTo(raster.width / 4000, 6);
  });

  it('leaves a magnification alone', () => {
    const { raster, scale } = prefilterFor(blank(400, 300), 800, 600);
    expect(raster.width).toBe(400);
    expect(scale).toBe(1);
  });

  const spread = (r: Raster) => {
    let lo = 255;
    let hi = 0;
    for (let x = 5; x < r.width - 5; x++) {
      const v = lumaAt(r, x, r.height >> 1);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return hi - lo;
  };

  it('⚠️ IS WHAT STOPS THE OUTPUT LOOKING WORSE THAN THE PHOTOGRAPH', () => {
    // Fine bars minified ~3.75x. Sampling without pre-filtering steps over
    // whole bars and beats against the pattern — the output swings the full
    // range in a pattern that is not in the source at all. That moiré is what
    // turns 8-point print to mush, and pre-filtering is the whole answer.
    //
    // The ratio is deliberately NOT a power of two: at an exact 4x the naive
    // sample lands on the same phase every time and comes out clean by luck,
    // which would make this test pass while proving nothing.
    const src = bars(1024, 716, 5);
    const quad = wholeFrame(1024, 716);

    const naive = warpQuad(src, quad, 273, 191)!;
    const guarded = rectify(src, quad, 273, 191)!;

    expect(spread(naive)).toBeGreaterThan(200);
    expect(spread(guarded)).toBeLessThan(100);
    // And the guard must genuinely improve it, not merely differ.
    expect(spread(guarded)).toBeLessThan(spread(naive) / 2);
  });

  it('halves only when BOTH axes are over-minified', () => {
    // halveRGBA is isotropic, so shrinking because one axis needs it would
    // squash the other. For a real document the two ratios track each other;
    // this pins the reason the condition is an AND rather than an OR.
    const wide = prefilterFor(blank(2000, 100), 200, 100);
    expect(wide.scale).toBe(1);
    const both = prefilterFor(blank(2000, 1400), 200, 140);
    expect(both.scale).toBeLessThan(1);
  });
});

describe('warpQuad', () => {
  it('⚠️ IS BIT-EXACT for a full-frame quad at the same size', () => {
    // The half-pixel test. A warp that samples pixel CORNERS instead of
    // centres blurs every pixel with its neighbour even when nothing is
    // being transformed — which softens small print for no reason at all.
    const src = blank(8, 6, 0);
    put(src, 3, 2, 200);
    put(src, 7, 5, 130);
    const out = warpQuad(src, wholeFrame(8, 6), 8, 6)!;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 8; x++) {
        expect(lumaAt(out, x, y)).toBe(lumaAt(src, x, y));
      }
    }
  });

  it('straightens a rotated rectangle back to axis-aligned', () => {
    // A bright rectangle drawn in the source, sampled through a quad that
    // traces it — the output should be uniformly bright.
    const W = 200;
    const H = 200;
    const src = blank(W, H, 0);
    for (let y = 40; y < 160; y++) {
      for (let x = 30; x < 170; x++) put(src, x, y, 240);
    }
    const quad: Quad = [
      { x: 31, y: 41 },
      { x: 169, y: 41 },
      { x: 169, y: 159 },
      { x: 31, y: 159 },
    ];
    const out = warpQuad(src, quad, 100, 80)!;
    for (const [x, y] of [
      [5, 5],
      [50, 40],
      [94, 74],
    ]) {
      expect(lumaAt(out, x, y)).toBeGreaterThan(200);
    }
  });

  it('clamps at the edges rather than sampling nothing', () => {
    // A quad extending past the frame — which a corner drag can produce.
    const src = blank(50, 50, 180);
    const out = warpQuad(
      src,
      [
        { x: -20, y: -20 },
        { x: 70, y: -20 },
        { x: 70, y: 70 },
        { x: -20, y: 70 },
      ],
      40,
      40,
    )!;
    // Every pixel must be real: an unsampled one would be transparent black.
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i + 3]).toBeGreaterThan(0);
    }
  });

  it('returns null on a degenerate quad instead of NaN pixels', () => {
    const src = blank(20, 20);
    const collapsed: Quad = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(warpQuad(src, collapsed, 10, 10)).toBeNull();
  });
});

describe('rectify', () => {
  it('scales the quad by the same factor it scales the source', () => {
    // THE BUG THIS GUARDS: pre-filtering the source without scaling the quad
    // crops the wrong region entirely — and looks deliberate, so nobody
    // notices. Put a marker in one corner and check it lands in that corner.
    const W = 800;
    const H = 800;
    const src = blank(W, H, 20);
    // A bright block in the top-left quarter of the region we will ask for.
    for (let y = 400; y < 480; y++) {
      for (let x = 400; x < 480; x++) put(src, x, y, 250);
    }
    const quad: Quad = [
      { x: 400, y: 400 },
      { x: 720, y: 400 },
      { x: 720, y: 720 },
      { x: 400, y: 720 },
    ];
    const out = rectify(src, quad, 80, 80)!;
    // Top-left of the output is the bright block; bottom-right is background.
    expect(lumaAt(out, 8, 8)).toBeGreaterThan(200);
    expect(lumaAt(out, 70, 70)).toBeLessThan(80);
  });

  it('produces the size it was asked for', () => {
    const out = rectify(blank(1000, 1000), wholeFrame(1000, 1000), 137, 59)!;
    expect(out.width).toBe(137);
    expect(out.height).toBe(59);
    expect(out.data.length).toBe(137 * 59 * 4);
  });
});
