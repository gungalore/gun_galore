import { describe, expect, it } from 'vitest';
import type { Gray } from './detect';
import type { Quad } from './geometry';
import { refineEdges } from './refine-edges';

const W = 400;
const H = 500;

/** A page on a darker ground, optionally with rounded corners. */
function scene(
  doc = { x0: 80, y0: 100, x1: 320, y1: 400 },
  radius = 0,
  print = true,
): Gray {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let on = x >= doc.x0 && x <= doc.x1 && y >= doc.y0 && y <= doc.y1;
      if (on && radius > 0) {
        const cx = Math.min(Math.max(x, doc.x0 + radius), doc.x1 - radius);
        const cy = Math.min(Math.max(y, doc.y0 + radius), doc.y1 - radius);
        if (x !== cx && y !== cy) on = Math.hypot(x - cx, y - cy) <= radius;
      }
      let v = on ? 228 : 90;
      // ⚠️ THE PRINT NEEDS A MARGIN, or the fixture is not a document. The
      // first version ran lines from `y % 20 < 5` with y0 = 100, so rows
      // 100-104 — the document's own top edge — were solid ink. The strongest
      // step along the top was then ink-to-paper 4.5px inside the page, and
      // refineEdges correctly found it. No real page has print flush to the
      // paper edge; the fixture was wrong, not the refinement.
      const inY = y - doc.y0;
      const inX = x - doc.x0;
      const margin = 24;
      if (
        on && print &&
        inY > margin && doc.y1 - y > margin &&
        inX > margin && doc.x1 - x > margin &&
        inY % 20 < 5
      ) {
        v = 64;
      }
      data[y * W + x] = v;
    }
  }
  return { data, width: W, height: H } as Gray;
}

const quadOf = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Worst corner distance between two quads. */
function worst(a: Quad, b: Quad): number {
  let d = 0;
  for (let i = 0; i < 4; i++) d = Math.max(d, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  return d;
}

const TRUTH = quadOf(80, 100, 320, 400);

describe('refineEdges', () => {
  it('pulls a quad that is several pixels off onto the real edge', () => {
    // What every rung hands it: a scaled-up answer from reduced resolution.
    const rough = quadOf(85, 106, 315, 394);
    expect(worst(rough, TRUTH)).toBeGreaterThan(6);
    const r = refineEdges(scene(), rough);
    expect(worst(r.quad, TRUTH)).toBeLessThan(1.5);
    expect(r.skipped).toBe(0);
  });

  it('lands sub-pixel on an edge that is already close', () => {
    const r = refineEdges(scene(), quadOf(81, 101, 319, 399));
    expect(worst(r.quad, TRUTH)).toBeLessThan(1);
  });

  it('⚠️ DOES NOT PULL A ROUNDED CORNER IN ONTO ITS ARC', () => {
    // The cornerSubPix failure this module exists to avoid. With a 14px radius
    // a corner-based refinement would find the arc — the strongest local
    // structure — and drag the corner inward by roughly the radius. Refining
    // the EDGES and intersecting must still land on the true rectangle corner,
    // which is not on the document at all.
    const g = scene({ x0: 80, y0: 100, x1: 320, y1: 400 }, 14);
    const r = refineEdges(g, quadOf(86, 107, 314, 393));
    expect(worst(r.quad, TRUTH)).toBeLessThan(2.5);
    // Specifically: nowhere near pulled in by the radius.
    expect(Math.abs(r.quad[0].x - 80)).toBeLessThan(2.5);
    expect(Math.abs(r.quad[0].y - 100)).toBeLessThan(2.5);
  });

  it('⚠️ LEAVES AN EDGE ALONE WHEN IT CANNOT FIND ONE', () => {
    // A refinement that cannot see the edge must not move it. A confident
    // wrong crop is worse than an approximate right one.
    const flat: Gray = {
      data: new Uint8Array(W * H).fill(140),
      width: W,
      height: H,
    } as Gray;
    const start = quadOf(80, 100, 320, 400);
    const r = refineEdges(flat, start);
    expect(r.skipped).toBe(4);
    expect(worst(r.quad, start)).toBeLessThan(1e-6);
  });

  it('refines the sides it can and keeps the ones it cannot', () => {
    // Document runs off the right of the frame: that edge has no step to find,
    // the other three do. A partial refinement is still an improvement.
    const g = scene({ x0: 80, y0: 100, x1: W + 50, y1: 400 });
    const r = refineEdges(g, quadOf(86, 106, W - 2, 394));
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.skipped).toBeLessThan(4);
    // The left edge, which is real, must have been found.
    expect(Math.abs(r.quad[0].x - 80)).toBeLessThan(2);
  });

  it('is not dragged onto lines of print', () => {
    // Print runs parallel to the top and bottom edges and is higher contrast
    // than nothing — but it sits inside the search band only if the start is
    // badly wrong. From a reasonable start the border must win.
    const r = refineEdges(scene(), quadOf(84, 104, 316, 396));
    expect(Math.abs(r.quad[0].y - 100)).toBeLessThan(2);
  });

  it('reports how far it moved each corner', () => {
    const r = refineEdges(scene(), quadOf(85, 106, 315, 394));
    expect(r.moved.every((m) => m > 2)).toBe(true);
    expect(r.votes.every((v) => v > 0.5)).toBe(true);
  });

  it('survives a degenerate quad', () => {
    const q = quadOf(10, 10, 12, 12);
    expect(() => refineEdges(scene(), q)).not.toThrow();
    expect(refineEdges(scene(), q).skipped).toBe(4);
  });
});
