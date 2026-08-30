import { describe, expect, it } from 'vitest';
import type { Gray } from './detect';
import type { Quad } from './geometry';
import { blur3, cornerSnap, findEdgeLine, seededCorners } from './edges';

// ────────────────────────────────────────────────────────────────────
// SYNTHETIC SCENES, NOT PHOTOGRAPHS.
//
// The scanner's real calibration images carry a name, an ID number and
// serials; they live in scan-fixtures/, are gitignored, and must never be
// committed. scripts/scan-diag.cjs states the rule and the answer: what gets
// committed is "synthetic regression tests that reproduce the MEASURED
// conditions with generated content". These do that — every scene below is
// built from a condition the operator actually hit.
// ────────────────────────────────────────────────────────────────────

/** A page on a background, optionally tilted, at a known rectangle. */
function scene(
  w: number,
  h: number,
  doc: { x0: number; y0: number; x1: number; y1: number },
  o: { bg?: number; paper?: number; slope?: number } = {},
): Gray {
  const bg = o.bg ?? 60;
  const paper = o.paper ?? 210;
  const slope = o.slope ?? 0;
  const d = new Uint8Array(w * h).fill(bg);
  for (let y = 0; y < h; y++) {
    // A tilt shifts the document sideways as we go down the page.
    const shift = Math.round(slope * (y - doc.y0));
    for (let x = 0; x < w; x++) {
      const inX = x >= doc.x0 + shift && x <= doc.x1 + shift;
      if (inX && y >= doc.y0 && y <= doc.y1) d[y * w + x] = paper;
    }
  }
  return { data: d, width: w, height: h };
}

const quadOf = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('⚠️ blur3 does not blacken the outside columns', () => {
  it('leaves a flat image flat, edges included', () => {
    const flat: Gray = { data: new Uint8Array(40 * 30).fill(120), width: 40, height: 30 };
    const out = blur3(flat);
    // The reference implementation this replaces wrote its horizontal pass
    // only for x in [1, w-1) into a zero-filled scratch, then read EVERY
    // column back — so the first and last columns returned 0. That is a
    // full-strength false gradient in the one function feeding a gradient
    // search.
    for (let y = 0; y < 30; y++) {
      expect(out.data[y * 40], `column 0, row ${y}`).toBeGreaterThan(100);
      expect(out.data[y * 40 + 39], `last column, row ${y}`).toBeGreaterThan(100);
    }
  });

  it('still smooths a single bright pixel', () => {
    const g: Gray = { data: new Uint8Array(20 * 20).fill(0), width: 20, height: 20 };
    g.data[10 * 20 + 10] = 255;
    const out = blur3(g);
    expect(out.data[10 * 20 + 10]).toBeLessThan(255);
    expect(out.data[10 * 20 + 11]).toBeGreaterThan(0);
  });
});

describe('finding one edge', () => {
  it('lands on a straight edge to within a pixel', () => {
    const g = blur3(scene(200, 200, { x0: 40, y0: 60, x1: 160, y1: 150 }));
    const fit = findEdgeLine(g, 'horizontal', 62, 20, 50, 150);
    // y = m*x + c, and the edge is flat at y = 60.
    expect(fit.line.d).toBeGreaterThan(58);
    expect(fit.line.d).toBeLessThan(62);
    expect(fit.hitFrac).toBeGreaterThan(0.9);
    expect(fit.residual).toBeLessThan(1.5);
  });

  it('⚠️ hitFrac NEVER EXCEEDS 1', () => {
    // Deriving the denominator as floor((to-from)/step) is one short of the
    // loop's real iteration count, which inflates every confidence built on it.
    const g = blur3(scene(200, 200, { x0: 40, y0: 60, x1: 160, y1: 150 }));
    for (const step of [1, 3, 4, 7]) {
      const fit = findEdgeLine(g, 'horizontal', 62, 20, 50, 150, step);
      expect(fit.hitFrac, `step ${step}`).toBeLessThanOrEqual(1);
    }
  });

  it('reports no confidence on a blank band rather than inventing a line', () => {
    const blank: Gray = { data: new Uint8Array(100 * 100).fill(90), width: 100, height: 100 };
    const fit = findEdgeLine(blank, 'horizontal', 50, 15, 10, 90);
    expect(fit.hitFrac).toBe(0);
    expect(fit.residual).toBeGreaterThan(10);
  });

  it('⚠️ PREFERS THE EDGE NEAR THE PRIOR OVER A STRONGER ONE FURTHER OFF', () => {
    // The operator's certificate sits on a dark mount AND has a printed black
    // border inside its own paper edge — parallel strong transitions within
    // millimetres. Gradient alone picks whichever is sharpest under the light.
    const w = 200;
    const h = 200;
    const d = new Uint8Array(w * h).fill(60);
    for (let y = 70; y < 160; y++) for (let x = 40; x < 160; x++) d[y * w + x] = 200; // paper
    for (let y = 40; y < 190; y++) for (let x = 20; x < 180; x++) {
      if (y < 70 || y >= 160) d[y * w + x] = 5; // a very dark mount, stronger edge
    }
    const g = blur3({ data: d, width: w, height: h });
    // Prior says the top edge is near 70; the mount's edge at 40 is stronger.
    const fit = findEdgeLine(g, 'horizontal', 70, 45, 50, 150);
    expect(fit.line.d).toBeGreaterThan(64);
    expect(fit.line.d).toBeLessThan(76);
  });
});

describe('seeded corners', () => {
  const aim = quadOf(50, 70, 150, 140);

  it('finds a document that overflows the aim box', () => {
    // Exactly the operator's case: the page framed slightly larger than the
    // box, so cropping to the box loses its ends. The detector has to be able
    // to reach OUTSIDE the prior.
    const g = blur3(scene(200, 220, { x0: 42, y0: 58, x1: 158, y1: 152 }));
    const r = seededCorners(g, aim);
    expect(r.confidence).toBeGreaterThan(0.55);
    expect(r.corners).not.toBeNull();
    const c = r.corners!;
    expect(c[0].x).toBeCloseTo(42, -0.7);
    expect(c[0].y).toBeCloseTo(58, -0.7);
    expect(c[2].x).toBeCloseTo(158, -0.7);
    expect(c[2].y).toBeCloseTo(152, -0.7);
  });

  it('handles a tilted page, which is what corners are for', () => {
    const g = blur3(scene(220, 220, { x0: 50, y0: 60, x1: 150, y1: 150 }, { slope: 0.15 }));
    const r = seededCorners(g, quadOf(50, 60, 160, 150));
    expect(r.confidence).toBeGreaterThan(0.4);
    if (r.corners) {
      // The bottom of a right-leaning page sits further right than its top.
      expect(r.corners[3].x).toBeGreaterThan(r.corners[0].x);
    }
  });

  it('⚠️ DECLINES ON A BLANK SCENE INSTEAD OF GUESSING', () => {
    const blank: Gray = { data: new Uint8Array(200 * 200).fill(90), width: 200, height: 200 };
    const r = seededCorners(blank, aim);
    expect(r.confidence).toBe(0);
    expect(r.corners).toBeNull();
  });

  it('⚠️ DECLINES WHEN THE RESULT IS THE WRONG SIZE, rather than scoring it low', () => {
    // A quad half or double the framed area is not a worse answer, it is a
    // different object — and a low score invites a caller to use it anyway.
    const g = blur3(scene(400, 400, { x0: 10, y0: 10, x1: 390, y1: 390 }));
    const tiny = quadOf(180, 180, 220, 220);
    const r = seededCorners(g, tiny);
    expect(r.confidence).toBe(0);
    expect(r.corners).toBeNull();
  });

  it('never throws on a degenerate prior', () => {
    const g = blur3(scene(100, 100, { x0: 20, y0: 20, x1: 80, y1: 80 }));
    expect(() => seededCorners(g, quadOf(50, 50, 50, 50))).not.toThrow();
  });
});

describe('corner snapping', () => {
  it('pulls a near miss onto the corner', () => {
    const g = blur3(scene(160, 160, { x0: 40, y0: 40, x1: 120, y1: 120 }));
    const snapped = cornerSnap(g, { x: 46, y: 47 }, 20);
    expect(Math.hypot(snapped.x - 40, snapped.y - 40)).toBeLessThan(
      Math.hypot(46 - 40, 47 - 40),
    );
  });

  it('⚠️ LEAVES THE POINT ALONE WHERE THERE IS NO CORNER', () => {
    // A snap that always moves the dot is a snap that fights the member on a
    // document whose corner is genuinely soft.
    const flat: Gray = { data: new Uint8Array(120 * 120).fill(140), width: 120, height: 120 };
    const pt = { x: 60, y: 60 };
    expect(cornerSnap(flat, pt, 20)).toEqual(pt);
  });

  it('does not snap to a plain edge', () => {
    // Strong in one gradient direction only — an edge, not a corner.
    const w = 120;
    const h = 120;
    const d = new Uint8Array(w * h).fill(40);
    for (let y = 0; y < h; y++) for (let x = 60; x < w; x++) d[y * w + x] = 220;
    const g = blur3({ data: d, width: w, height: h });
    const pt = { x: 60, y: 60 };
    const out = cornerSnap(g, pt, 15);
    expect(Math.abs(out.y - pt.y)).toBeLessThan(6);
  });

  it('stays inside the buffer near a border', () => {
    const g = blur3(scene(80, 80, { x0: 5, y0: 5, x1: 70, y1: 70 }));
    const out = cornerSnap(g, { x: 2, y: 2 }, 20);
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.x).toBeLessThan(80);
    expect(out.y).toBeLessThan(80);
  });
});

describe('⚠️ a printed border must not be mistaken for the paper edge', () => {
  // The failure the operator photographed. His certificate carries a printed
  // black rectangle about a centimetre inside its own paper edge, and
  // black-on-white is a far stronger transition than white paper against brown
  // carpet. On his iPhone the detector returned four lines with residuals of
  // 0.3-0.7px — beautifully straight, and all four on the BORDER, leaving the
  // paper's margin outside the crop. On his Samsung the same competition read
  // as a residual of 6.3 on the top edge: a fit that could not decide.
  function certificate(): Gray {
    const w = 320;
    const h = 440;
    const d = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        d[y * w + x] = 70 + (((x >> 1) + (y >> 1)) % 2 ? 20 : -20); // carpet
    const p = { x0: 60, y0: 70, x1: 260, y1: 370 }; // the paper
    for (let y = p.y0; y <= p.y1; y++)
      for (let x = p.x0; x <= p.x1; x++) d[y * w + x] = 205;
    // A printed border 12px inside the paper, far stronger than paper/carpet.
    for (let y = p.y0 + 12; y <= p.y1 - 12; y++)
      for (let x = p.x0 + 12; x <= p.x1 - 12; x++) {
        const onBorder =
          y <= p.y0 + 14 || y >= p.y1 - 14 || x <= p.x0 + 14 || x >= p.x1 - 14;
        if (onBorder) d[y * w + x] = 15;
      }
    return { data: d, width: w, height: h };
  }

  it('takes the paper edge, not the stronger line printed on it', () => {
    const g = blur3(certificate());
    const r = seededCorners(g, quadOf(62, 72, 258, 368));
    expect(r.corners).not.toBeNull();
    const c = r.corners!;
    // The paper is at 60/70; the printed border at 72/82. Landing on the
    // border would put every corner ~12px in.
    expect(c[0].x).toBeLessThan(66);
    expect(c[0].y).toBeLessThan(76);
    expect(c[2].x).toBeGreaterThan(254);
    expect(c[2].y).toBeGreaterThan(364);
  });

  it('⚠️ AND STRONGEST-WINS WOULD HAVE TAKEN THE BORDER', () => {
    // The rule this replaced, reconstructed: pick the largest gradient in the
    // band and the printed line wins on every scanline.
    const g = blur3(certificate());
    const band = 30;
    let strongestAt = -1;
    let peak = 0;
    for (let u = 70 - band; u <= 70 + band; u++) {
      const gr = Math.abs(g.data[(u + 1) * g.width + 160] - g.data[(u - 1) * g.width + 160]);
      if (gr > peak) {
        peak = gr;
        strongestAt = u;
      }
    }
    // The strongest transition on that column really is the printed border.
    expect(strongestAt).toBeGreaterThan(76);
  });

  it('still refuses when there is no paper at all, only printing', () => {
    const w = 200;
    const h = 200;
    const d = new Uint8Array(w * h).fill(200);
    const g = blur3({ data: d, width: w, height: h });
    expect(seededCorners(g, quadOf(50, 50, 150, 150)).corners).toBeNull();
  });
});
