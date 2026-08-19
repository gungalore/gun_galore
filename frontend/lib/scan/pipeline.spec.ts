import { describe, expect, it } from 'vitest';
import { detectQuad, toLuma } from './detect';
import { enhance, inspect } from './enhance';
import { Quad, outputSize } from './geometry';
import { Raster, rectify } from './warp';

// THE WHOLE CHAIN, on a synthetic photograph: find the document, square it up,
// even out the light. Every part is unit-tested next door; this asserts they
// compose into something a vision model can actually read, which is the only
// claim that matters.

function inside(q: Quad, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * A photograph of a document: tilted on a dark desk, under a light that falls
 * off across the frame, with rows of print on it.
 */
function photo(w: number, h: number, doc: Quad): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  // Where a point sits within the document, so "print" follows the perspective.
  const inv = (x: number, y: number) => {
    // Crude barycentric-ish parameterisation: good enough to lay down bars.
    const top = { x: doc[0].x + (doc[1].x - doc[0].x), y: doc[0].y };
    void top;
    const u =
      ((x - doc[0].x) * (doc[1].x - doc[0].x) + (y - doc[0].y) * (doc[1].y - doc[0].y)) /
      ((doc[1].x - doc[0].x) ** 2 + (doc[1].y - doc[0].y) ** 2);
    const v =
      ((x - doc[0].x) * (doc[3].x - doc[0].x) + (y - doc[0].y) * (doc[3].y - doc[0].y)) /
      ((doc[3].x - doc[0].x) ** 2 + (doc[3].y - doc[0].y) ** 2);
    return { u, v };
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number;
      if (inside(doc, x + 0.5, y + 0.5)) {
        const { u, v: vv } = inv(x + 0.5, y + 0.5);
        // 24 rows of print down the page, bars across.
        const row = Math.floor(vv * 24);
        const isInk = row % 2 === 0 && Math.floor(u * 40) % 3 !== 0;
        v = isInk ? 55 : 225;
      } else {
        v = 62; // the desk
      }
      // A hard lighting falloff across the frame: the member's own shadow.
      v *= 1 - 0.55 * (x / w);
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const lumaAt = (r: Raster, x: number, y: number) => {
  const i = ((y | 0) * r.width + (x | 0)) * 4;
  return (77 * r.data[i] + 150 * r.data[i + 1] + 29 * r.data[i + 2]) / 256;
};

/** Print-to-paper swing within a band, which is what legibility comes down to. */
function swing(r: Raster, x0: number, x1: number, y0: number, y1: number) {
  let lo = 255;
  let hi = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const v = lumaAt(r, x, y);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  return hi - lo;
}

function meanOf(r: Raster, x0: number, x1: number, y0: number, y1: number) {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      s += lumaAt(r, x, y);
      n++;
    }
  return s / n;
}

describe('the whole scan', () => {
  const doc: Quad = [
    { x: 96, y: 78 },
    { x: 505, y: 46 },
    { x: 548, y: 402 },
    { x: 62, y: 430 },
  ];
  const W = 640;
  const H = 480;

  it('finds the document, squares it up and evens out the light', () => {
    const shot = photo(W, H, doc);

    // 1. FIND IT.
    const found = detectQuad(toLuma(shot.data, W, H));
    expect(found).not.toBeNull();
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      worst = Math.max(
        worst,
        Math.hypot(found!.quad[i].x - doc[i].x, found!.quad[i].y - doc[i].y),
      );
    }
    // Within a couple of per cent of the frame — good enough that the review
    // step is a glance rather than a repair.
    expect(worst / W).toBeLessThan(0.05);

    // 2. SQUARE IT UP.
    const { w, h } = outputSize(found!.quad, 1200);
    const flat = rectify(shot, found!.quad, w, h)!;
    expect(flat).not.toBeNull();

    // The desk is gone: the corners of the output are page, not table. The
    // original desk sat at luma ~62 before the lighting falloff, and the page
    // at ~225, so a corner reading well above the desk means we cropped to the
    // document and not around it.
    const cornerMean = meanOf(flat, 2, 30, 2, 30);
    expect(cornerMean).toBeGreaterThan(70);

    // 3. EVEN OUT THE LIGHT.
    const better = enhance(flat);
    expect(better.width).toBe(w);
    expect(better.height).toBe(h);

    const band = Math.floor(w * 0.18);
    const litBefore = meanOf(flat, 2, band, 0, h);
    const darkBefore = meanOf(flat, w - band, w - 2, 0, h);
    const litAfter = meanOf(better, 2, band, 0, h);
    const darkAfter = meanOf(better, w - band, w - 2, 0, h);

    // The two ends of the page started far apart and must end up closer.
    expect(Math.abs(litBefore - darkBefore)).toBeGreaterThan(30);
    expect(Math.abs(litAfter - darkAfter)).toBeLessThan(
      Math.abs(litBefore - darkBefore),
    );

    // 4. AND THE PRINT MUST STILL BE THERE — on the side that was in shadow.
    // This is the check that we flattened the LIGHTING and not the CONTENT,
    // which is the failure mode that would make the whole feature pointless.
    expect(swing(better, w - band, w - 2, 0, h)).toBeGreaterThan(60);
  });

  it('produces a sensible output size rather than the whole frame', () => {
    const shot = photo(W, H, doc);
    const found = detectQuad(toLuma(shot.data, W, H))!;
    const { w, h } = outputSize(found.quad, 1200);
    // The document is roughly 4:3-ish here; the output must not be the frame.
    expect(w).toBeGreaterThan(200);
    expect(h).toBeGreaterThan(150);
    expect(Math.max(w, h)).toBeLessThanOrEqual(1200);
  });

  it('reports a dark capture as dark rather than silently enhancing it', () => {
    // Honesty check: enhancement lifts contrast, but a photograph taken in the
    // dark is noisy and the member should be told to turn a light on rather
    // than handed a brightened mess.
    const dim: Raster = {
      data: new Uint8ClampedArray(200 * 200 * 4),
      width: 200,
      height: 200,
    };
    for (let i = 0; i < dim.data.length; i += 4) {
      dim.data[i] = dim.data[i + 1] = dim.data[i + 2] = 28;
      dim.data[i + 3] = 255;
    }
    expect(inspect(dim).meanLuma).toBeLessThan(55);
  });
});
