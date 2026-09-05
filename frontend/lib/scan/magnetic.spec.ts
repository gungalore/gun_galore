import { describe, expect, it } from 'vitest';
import type { Quad } from './geometry';
import {
  edgeLinesNear,
  magneticBand,
  snapCorner,
  snapEdge,
  type LumaRaster,
} from './magnetic';

const W = 400;
const H = 500;

/** A page from x0..x1, y0..y1 inclusive, white on a mid-grey ground. */
const PAGE = { x0: 100, y0: 120, x1: 300, y1: 400 };
const GROUND = 150;
const PAPER = 228;
/**
 * A ruler, dark, thin and OUTSIDE the page — the distractor this whole module
 * is tuned against. Black-on-desk measures 110 levels against the page edge's
 * 78, so on strength alone it wins; it must not.
 */
const RULER = 40;

/**
 * The step from ground to paper sits BETWEEN pixel centres x0-1 and x0, so the
 * true edge is at x0 - 0.5. Every assertion below is against that, not x0.
 */
const trueLeft = PAGE.x0 - 0.5;
const trueTop = PAGE.y0 - 0.5;
const trueRight = PAGE.x1 + 0.5;
const trueBottom = PAGE.y1 + 0.5;

interface SceneOpts {
  /** Distance outside the LEFT page edge to lay a 3px-wide dark ruler. */
  ruler?: number;
  /** Print inside the page, so the fixture is a document and not a card. */
  print?: boolean;
}

function scene(opts: SceneOpts = {}): LumaRaster {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = GROUND;
      const on =
        x >= PAGE.x0 && x <= PAGE.x1 && y >= PAGE.y0 && y <= PAGE.y1;
      if (on) {
        v = PAPER;
        // Print with a real margin. refine-edges.spec.ts records why: a
        // fixture with ink flush to the paper edge is not a document, and the
        // strongest step along that side is then correctly the print.
        if (opts.print) {
          const margin = 24;
          if (
            x - PAGE.x0 > margin &&
            PAGE.x1 - x > margin &&
            y - PAGE.y0 > margin &&
            PAGE.y1 - y > margin &&
            (y - PAGE.y0) % 20 < 5
          ) {
            v = 64;
          }
        }
      } else if (opts.ruler !== undefined) {
        const rx = PAGE.x0 - opts.ruler;
        if (x >= rx - 1 && x <= rx + 1 && y >= PAGE.y0 - 40 && y <= PAGE.y1 + 40) {
          v = RULER;
        }
      }
      data[y * W + x] = v;
    }
  }
  return { data, width: W, height: H };
}

/** Flat, featureless, faintly noisy — a bare desk. */
function plain(): LumaRaster {
  const data = new Uint8Array(W * H);
  // A fixed LCG rather than Math.random: a test that fails one run in fifty
  // teaches nobody anything.
  let s = 12345;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = 150 + ((s >> 16) % 9) - 4;
  }
  return { data, width: W, height: H };
}

const quadOf = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The quad sitting exactly on the page. */
const onPage = () => quadOf(trueLeft, trueTop, trueRight, trueBottom);

describe('magneticBand', () => {
  it('is 3% of the short edge, clamped to a thumb-sized correction', () => {
    expect(magneticBand({ data: new Uint8Array(1), width: 900, height: 1200 })).toBe(27);
    // A tiny thumbnail still gets a reachable band…
    expect(magneticBand({ data: new Uint8Array(1), width: 100, height: 140 })).toBe(8);
    // …and a huge one does not turn the snap into a detector.
    expect(magneticBand({ data: new Uint8Array(1), width: 4000, height: 3000 })).toBe(40);
  });
});

describe('edgeLinesNear', () => {
  it('finds the page edge from six pixels away', () => {
    const g = scene({ print: true });
    // Top edge of a quad drawn 6px above the page.
    const q = quadOf(trueLeft, trueTop - 6, trueRight, trueBottom);
    const lines = edgeLinesNear(g, q, 0, 20);
    expect(lines.length).toBeGreaterThan(0);
    // Horizontal line: normal is (0, ±1) and c is ±y.
    const y = lines[0].c / lines[0].ny;
    expect(Math.abs(y - trueTop)).toBeLessThan(1);
    expect(lines[0].support).toBeGreaterThanOrEqual(0.6);
  });

  it('finds nothing on a plain surface', () => {
    const q = quadOf(100, 120, 300, 400);
    for (let e = 0; e < 4; e++) {
      expect(edgeLinesNear(plain(), q, e, 20)).toEqual([]);
    }
  });

  it('hands back drawable endpoints spanning the member’s own edge', () => {
    const g = scene();
    const q = quadOf(trueLeft, trueTop - 6, trueRight, trueBottom);
    const [best] = edgeLinesNear(g, q, 0, 20);
    expect(best).toBeTruthy();
    expect(best.a.x).toBeCloseTo(trueLeft, 3);
    expect(best.b.x).toBeCloseTo(trueRight, 3);
    expect(Math.abs(best.a.y - trueTop)).toBeLessThan(1);
    expect(Math.abs(best.b.y - trueTop)).toBeLessThan(1);
  });
});

describe('snapCorner', () => {
  it('pulls a corner dropped 6px out onto the page corner', () => {
    const g = scene({ print: true });
    const q = quadOf(trueLeft - 6, trueTop - 6, trueRight, trueBottom);
    const p = snapCorner(g, q, 0, 20);
    expect(p).not.toBeNull();
    expect(Math.abs(p!.x - trueLeft)).toBeLessThan(1);
    expect(Math.abs(p!.y - trueTop)).toBeLessThan(1);
  });

  it('leaves a corner that is already on the edge where it is', () => {
    const g = scene({ print: true });
    const q = onPage();
    const p = snapCorner(g, q, 0, 20);
    expect(p).not.toBeNull();
    expect(Math.hypot(p!.x - trueLeft, p!.y - trueTop)).toBeLessThan(1);
  });

  it('refuses a plain surface rather than inventing a corner', () => {
    const q = quadOf(100, 120, 300, 400);
    expect(snapCorner(plain(), q, 0, 20)).toBeNull();
  });
});

describe('snapEdge', () => {
  it('drops a whole side onto the page edge', () => {
    const g = scene({ print: true });
    const q = quadOf(trueLeft, trueTop, trueRight, trueBottom - 6);
    const r = snapEdge(g, q, 2, 20);
    expect(r).not.toBeNull();
    // Edge 2 runs BR → BL, so `a` is the bottom-right corner.
    expect(Math.abs(r!.a.y - trueBottom)).toBeLessThan(1);
    expect(Math.abs(r!.b.y - trueBottom)).toBeLessThan(1);
    // Sliding along the adjacent sides, which are vertical here, must not
    // move the corners sideways.
    expect(r!.a.x).toBeCloseTo(trueRight, 3);
    expect(r!.b.x).toBeCloseTo(trueLeft, 3);
  });

  it('leaves a side already on the edge where it is', () => {
    const g = scene({ print: true });
    const r = snapEdge(g, onPage(), 3, 20);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.a.x - trueLeft)).toBeLessThan(1);
    expect(Math.abs(r!.b.x - trueLeft)).toBeLessThan(1);
  });

  it('refuses a plain surface', () => {
    expect(snapEdge(plain(), quadOf(100, 120, 300, 400), 0, 20)).toBeNull();
  });

  it('ignores a dark ruler 15px outside the page when the page is nearer', () => {
    // The ruler is 110 levels against the page edge's 78 — 1.4x stronger — so
    // this is the case that decided PROX_POWER. The left edge of the quad is
    // dropped 6px outside the page, which leaves the ruler 9px further out
    // still, both comfortably inside the band.
    const g = scene({ ruler: 15, print: true });
    const q = quadOf(trueLeft - 6, trueTop, trueRight, trueBottom);
    const [best] = edgeLinesNear(g, q, 3, 20);
    expect(best).toBeTruthy();
    // Edge 3 runs BL → TL: a vertical line, normal (±1, 0).
    const x = best.c / best.nx;
    expect(Math.abs(x - trueLeft)).toBeLessThan(1);

    const r = snapEdge(g, q, 3, 20);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.a.x - trueLeft)).toBeLessThan(1);
    expect(Math.abs(r!.b.x - trueLeft)).toBeLessThan(1);
  });

  it('still offers the ruler as the SECOND candidate, not the first', () => {
    const g = scene({ ruler: 15 });
    const q = quadOf(trueLeft - 6, trueTop, trueRight, trueBottom);
    const lines = edgeLinesNear(g, q, 3, 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].strength).toBeGreaterThan(lines[1].strength);
  });
});
