import { describe, expect, it } from 'vitest';
import { letterboxFor } from './letterbox';
import {
  EDGE_TRIM,
  MASK_SIZE,
  MAX_RESIDUAL,
  MIN_COVERAGE,
  analyseMask,
} from './mask-quad';

// A letterbox for a square source, so mask cells map to source pixels by a
// clean factor and the arithmetic in the assertions stays readable.
const LB = letterboxFor(512, 512);

/** Build a 64x64 logit plane from a predicate. Inside +6, outside -6. */
function plane(inside: (x: number, y: number) => boolean): Float32Array {
  const m = new Float32Array(MASK_SIZE * MASK_SIZE);
  for (let y = 0; y < MASK_SIZE; y++) {
    for (let x = 0; x < MASK_SIZE; x++) {
      m[y * MASK_SIZE + x] = inside(x + 0.5, y + 0.5) ? 6 : -6;
    }
  }
  return m;
}

const rect = (x0: number, y0: number, x1: number, y1: number) =>
  plane((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

/** A rectangle with the corners rounded off by `r` cells. */
function rounded(x0: number, y0: number, x1: number, y1: number, r: number) {
  return plane((x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    // Outside the inset box on BOTH axes means we are in a corner quadrant.
    if (Math.abs(x - cx) > 0 && Math.abs(y - cy) > 0) {
      return Math.hypot(x - cx, y - cy) <= r;
    }
    return true;
  });
}

/** Corners back in mask-cell space, for comparison with the fixture. */
function inCells(quad: NonNullable<ReturnType<typeof analyseMask>['quad']>) {
  return quad.map((p) => ({
    x: (p.x * LB.scale + LB.offsetX) / (256 / MASK_SIZE),
    y: (p.y * LB.scale + LB.offsetY) / (256 / MASK_SIZE),
  }));
}

describe('analyseMask', () => {
  it('finds a clean rectangle to within a cell', () => {
    const a = analyseMask(rect(12, 8, 50, 54), LB);
    expect(a.reject).toBeUndefined();
    expect(a.quad).not.toBeNull();
    const c = inCells(a.quad!);
    expect(c[0].x).toBeCloseTo(12, 0);
    expect(c[0].y).toBeCloseTo(8, 0);
    // ⚠️ 50 AND 54, NOT 51 AND 55. The fixture tests cell CENTRES (x+0.5), so
    // `x <= 50` fills cells 12..49 and the region's true continuous span is
    // 12.0 to 50.0. Getting this wrong is how a half-cell offset in the code
    // hid behind a half-cell error in the test.
    expect(c[2].x).toBeCloseTo(50, 0);
    expect(c[2].y).toBeCloseTo(54, 0);
    expect(a.residual).toBeLessThan(MAX_RESIDUAL);
    expect(a.rectangularity).toBeGreaterThan(0.9);
  });

  it('⚠️ PUTS A ROUNDED CORNER WHERE THE EDGES WOULD HAVE MET', () => {
    // The whole reason this module exists. On an arc there is no corner pixel
    // to peak on — the true corner is the intersection of the two straight
    // edges, which lies OUTSIDE the document. Fitting lines and intersecting
    // finds it; a heatmap argmax cannot.
    const r = 6;
    const a = analyseMask(rounded(10, 10, 52, 52, r), LB);
    expect(a.reject).toBeUndefined();
    const c = inCells(a.quad!);
    // Within ~1.5 cells of the true rectangle corner, NOT pulled in by r.
    expect(Math.abs(c[0].x - 10)).toBeLessThan(1.5);
    expect(Math.abs(c[0].y - 10)).toBeLessThan(1.5);
    expect(Math.abs(c[2].x - 52)).toBeLessThan(1.5);
    expect(Math.abs(c[2].y - 52)).toBeLessThan(1.5);
  });

  it('⚠️ A2: trimming the ends is what stops the arc shaving the crop', () => {
    // With the trim in force the rounded fixture lands on the true corner.
    // If EDGE_TRIM were ever set to 0 the fitted lines would tilt inward and
    // every side would come in by roughly the corner radius. Pin the constant
    // so that change cannot be made silently.
    expect(EDGE_TRIM).toBeGreaterThanOrEqual(0.15);
    const tight = analyseMask(rounded(10, 10, 52, 52, 9), LB);
    const c = inCells(tight.quad!);
    // A 9-cell radius must still not pull the corner in by 9 cells.
    expect(Math.abs(c[0].x - 10)).toBeLessThan(2.5);
  });

  it('reports an empty frame rather than inventing a quad', () => {
    const a = analyseMask(plane(() => false), LB);
    expect(a.quad).toBeNull();
    expect(a.reject).toBe('empty');
    expect(a.coverage).toBe(0);
  });

  it('refuses a speck', () => {
    const a = analyseMask(rect(30, 30, 34, 34), LB);
    expect(a.quad).toBeNull();
    expect(a.reject).toBe('too-small');
    expect(a.coverage).toBeLessThan(MIN_COVERAGE);
  });

  it('takes the largest component and ignores clutter', () => {
    const doc = rect(8, 8, 44, 56);
    const speck = rect(52, 4, 60, 12);
    const both = new Float32Array(MASK_SIZE * MASK_SIZE);
    for (let i = 0; i < both.length; i++) both[i] = Math.max(doc[i], speck[i]);
    const c = inCells(analyseMask(both, LB).quad!);
    // The quad must be the document, not the union — a union would reach x=61.
    expect(c[1].x).toBeLessThan(48);
  });

  it('⚠️ REJECTS A SHAPE THAT IS NOT A RECTANGLE', () => {
    // A quad straddling a book spine, or a mask spilling across two documents,
    // is exactly what must NOT be handed to a crop. The corner heads would
    // still report four confident peaks here.
    const tri = plane((x, y) => y > 8 && y < 56 && x > 8 && x - 8 < (y - 8) * 1.1);
    const a = analyseMask(tri, LB);
    expect(a.quad).toBeNull();
    expect(['not-rectangular', 'poor-fit']).toContain(a.reject);
  });

  it('surfaces the aspect of a double-page spread', () => {
    // Nothing reads this yet. It is the cheapest signal that the thing in
    // frame is a spread rather than one page, and whatever handles booklets
    // later needs it.
    const single = analyseMask(rect(20, 8, 44, 56), LB);
    const spread = analyseMask(rect(6, 8, 58, 56), LB);
    expect(single.aspect).toBeGreaterThan(1.8);
    expect(spread.aspect).toBeLessThan(1.3);
  });

  it('survives a short or malformed plane', () => {
    expect(() => analyseMask(new Float32Array(4), LB)).not.toThrow();
    expect(analyseMask(new Float32Array(4), LB).reject).toBe('empty');
  });

  it('handles a rotated document without shearing it', () => {
    const cx = 32;
    const cy = 32;
    const th = 0.28;
    const a = analyseMask(
      plane((x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const rx = dx * Math.cos(-th) - dy * Math.sin(-th);
        const ry = dx * Math.sin(-th) + dy * Math.cos(-th);
        return Math.abs(rx) <= 15 && Math.abs(ry) <= 21;
      }),
      LB,
    );
    expect(a.reject).toBeUndefined();
    expect(a.rectangularity).toBeGreaterThan(0.85);
    const c = inCells(a.quad!);
    const top = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
    const bottom = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
    expect(Math.abs(top - bottom)).toBeLessThan(2);
  });
});

describe('⚠️ A DEGRADED MASK IS THE NORMAL CASE, NOT THE EXCEPTION', () => {
  // This rung rejected its own quad on EVERY capture from the day it shipped.
  // The reports always said the same thing — `mask rect 0.00`, meaning a
  // corner more than MAX_SKEW off square — on pages whose corner-head quad
  // measured 1.7° off square. Two readings of one document, one of them
  // impossible.
  //
  // The cause was that lines were fitted to the raw component boundary. A real
  // mask is not a clean rectangle: it has bites where the model lost the paper
  // against the background, and interior holes over dark print and stamps. A
  // hole's boundary ring sits in the MIDDLE of the page, and nearest-side
  // assignment hands those points to a side, which then fits through them.
  //
  // Measured on 34 real fixtures: 14/34 accepted at a median worst corner of
  // 41°, against 29/34 at 13° once the lines are fitted to the hull outline.

  /** A rectangle with a bite out of one edge and two holes in the middle. */
  function degraded(): Float32Array {
    return plane((x, y) => {
      const inside = x >= 14 && x <= 50 && y >= 6 && y <= 58;
      if (!inside) return false;
      // A bite: the model lost the left edge over part of its run.
      if (x < 22 && y > 20 && y < 34) return false;
      // Holes over dark print.
      if (x > 28 && x < 34 && y > 14 && y < 20) return false;
      if (x > 24 && x < 40 && y > 40 && y < 46) return false;
      return true;
    });
  }

  it('recovers the rectangle a bite and two holes were hiding', () => {
    const a = analyseMask(degraded(), LB);
    expect(a.reject).toBeUndefined();
    expect(a.quad).not.toBeNull();
    // Squarer than the gate by a wide margin, not scraping past it.
    expect(a.rectangularity).toBeGreaterThan(0.8);
    expect(a.residual).toBeLessThan(MAX_RESIDUAL);
  });

  it('puts the bitten edge back where the paper actually is', () => {
    // The point of the hull: the crop must not shrink to the bite. The left
    // edge belongs at cell 14, not at 22 where the segmentation gave up.
    const a = analyseMask(degraded(), LB);
    expect(a.quad).not.toBeNull();
    const q = a.quad!;
    const leftX = Math.min(q[0].x, q[3].x);
    // A mask cell is 4 model px, and LB (512 -> 256) halves the scale, so a
    // cell is 8 source px. The paper's left edge is cell 14 = 112; the bite
    // would put it at cell 22 = 176. Anything under 160 means the hull bridged
    // the bite rather than following it in.
    expect(leftX).toBeLessThan(160);
    expect(leftX).toBeCloseTo(14 * 8, -1);
  });

  it('still refuses a shape that is genuinely not a rectangle', () => {
    // The hull must not turn the veto off. A spread across a book spine, or a
    // mask spilling onto a second document, still has to be declined.
    const tri = plane((x, y) => y > 8 && y < 56 && x > 8 && x - 8 < (y - 8) * 1.1);
    expect(analyseMask(tri, LB).quad).toBeNull();
  });
});
