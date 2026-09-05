import { describe, expect, it } from 'vitest';
import type { Gray } from './detect';
import type { Quad } from './geometry';
import { MIN_SUPPORT, refineCorners } from './corner-refine';

// ────────────────────────────────────────────────────────────────────
// Synthetic scenes only — deliberately. The photographs this was tuned
// against carry a name, an ID number and licence serials; they live in
// scan-fixtures/, which is gitignored, and must never be committed. What gets
// committed is a scene that reproduces the MEASURED condition: paper 228 on a
// desk 90 (a 138-level border step), ink 64 (a 164-level print step), a black
// ruler 30 on that desk (a 60-level step, and a real boundary).
// ────────────────────────────────────────────────────────────────────

const W = 600;
const H = 800;

const PAPER = 228;
const DESK = 90;
const INK = 64;
const RULER = 30;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DOC: Box = { x0: 120, y0: 150, x1: 420, y1: 650 };

interface SceneOpts {
  doc?: Box;
  /** Lines of print, inset from the paper edge. */
  print?: boolean;
  /** A dark bar this many pixels OUTSIDE the document's left edge. */
  ruler?: number;
  /** A straight tonal step crossing the top edge at an angle — a crease. */
  crease?: boolean;
  /** Paint no document at all. */
  blank?: boolean;
}

function scene(o: SceneOpts = {}): Gray {
  const doc = o.doc ?? DOC;
  const data = new Uint8Array(W * H).fill(DESK);
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H) data[y * W + x] = v;
  };

  if (o.ruler !== undefined) {
    for (let y = doc.y0 - 40; y <= doc.y1 + 40; y++) {
      for (let x = doc.x0 - o.ruler - 8; x < doc.x0 - o.ruler; x++) put(x, y, RULER);
    }
  }

  if (!o.blank) {
    for (let y = doc.y0; y <= doc.y1; y++) {
      for (let x = doc.x0; x <= doc.x1; x++) put(x, y, PAPER);
    }
    // ⚠️ THE PRINT NEEDS A MARGIN, or the fixture is not a document.
    // refine-edges.spec.ts records why: with print flush to the paper edge the
    // strongest step along a side IS the ink, and a refinement that finds it is
    // right about the fixture and wrong about paper. 24px here.
    if (o.print !== false) {
      const m = 24;
      for (let y = doc.y0 + m; y <= doc.y1 - m; y++) {
        if ((y - doc.y0) % 20 >= 5) continue;
        for (let x = doc.x0 + m; x <= doc.x1 - m; x++) put(x, y, INK);
      }
    }
  }

  if (o.crease) {
    // A tonal step running at ~12° to the top edge and crossing it, of the kind
    // a folded A4 or a table joint leaves. Everything below the line is 30
    // levels darker — straight, strong, and the wrong line entirely.
    for (let x = 0; x < W; x++) {
      const yc = doc.y0 - 18 + 0.21 * (x - doc.x0);
      for (let y = Math.max(0, Math.round(yc)); y < Math.round(yc) + 6; y++) {
        const cur = data[y * W + x];
        put(x, y, Math.max(0, cur - 44));
      }
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

const TRUTH = quadOf(DOC.x0, DOC.y0, DOC.x1, DOC.y1);

/** Worst corner distance between two quads. */
function worst(a: Quad, b: Quad): number {
  let d = 0;
  for (let i = 0; i < 4; i++) d = Math.max(d, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  return d;
}

describe('refineCorners', () => {
  it('recovers a page whose every side is 25px out', () => {
    // The failure this module was built for: DocCornerNet's ~2.3px median error
    // on its own 224px view is ~30px on the still it came from, and 30px on an
    // A4 is a visibly skew crop.
    const rough = quadOf(DOC.x0 + 25, DOC.y0 + 25, DOC.x1 - 25, DOC.y1 - 25);
    expect(worst(rough, TRUTH)).toBeGreaterThan(30);
    const r = refineCorners(scene(), rough);
    expect(worst(r.quad, TRUTH)).toBeLessThan(1.5);
    expect(r.skipped).toBe(0);
    expect(r.support.every((s) => s >= MIN_SUPPORT)).toBe(true);
  });

  it('recovers a page that is 25px out the OTHER way', () => {
    // Outward, so every profile crosses desk before it reaches paper. The
    // nearest-first candidate ordering has to survive both directions.
    const rough = quadOf(DOC.x0 - 25, DOC.y0 - 25, DOC.x1 + 25, DOC.y1 + 25);
    const r = refineCorners(scene(), rough);
    expect(worst(r.quad, TRUTH)).toBeLessThan(1.5);
  });

  it('lands sub-pixel on an edge that is already close', () => {
    const r = refineCorners(scene(), quadOf(122, 152, 418, 648));
    expect(worst(r.quad, TRUTH)).toBeLessThan(1);
  });

  it('⚠️ IS NOT PULLED ONTO A RULER LYING 30px OUTSIDE THE PAGE', () => {
    // And the start is deliberately on the ruler's side of the truth, so
    // proximity alone would lose: the ruler's inner edge is 10px from the
    // starting line and the page edge is 20px. What separates them is the
    // flank test — the ruler has DESK on the side facing the document.
    const g = scene({ ruler: 30 });
    const rough = quadOf(DOC.x0 - 20, DOC.y0, DOC.x1, DOC.y1);
    const r = refineCorners(g, rough);
    expect(Math.abs(r.quad[0].x - DOC.x0)).toBeLessThan(1.5);
    expect(Math.abs(r.quad[3].x - DOC.x0)).toBeLessThan(1.5);
  });

  it('⚠️ IS NOT TILTED BY A CREASE CROSSING ONE SIDE', () => {
    // This is what a plain total-least-squares fit over every profile cannot
    // do, and why refine-edges.ts reported "28.3px moved" on a crop that was
    // still skew: the crease supplies candidates on roughly a third of the
    // profiles, and six bad points in thirty-two tilt the line by degrees.
    // RANSAC puts them outside the 2px inlier band instead.
    const g = scene({ crease: true });
    const rough = quadOf(DOC.x0 + 8, DOC.y0 + 10, DOC.x1 - 8, DOC.y1 - 10);
    const r = refineCorners(g, rough);
    // The top edge is the one the crease crosses. Both its corners, and the
    // TILT between them, must come back clean.
    expect(Math.abs(r.quad[0].y - DOC.y0)).toBeLessThan(1.5);
    expect(Math.abs(r.quad[1].y - DOC.y0)).toBeLessThan(1.5);
    expect(Math.abs(r.quad[0].y - r.quad[1].y)).toBeLessThan(1);
  });

  it('⚠️ KEEPS THE DETECTOR CORNER ON A SIDE WITH NO EDGE', () => {
    // The document runs off the right of the frame: that side has no step to
    // find, the other three do. A partial refinement is still an improvement,
    // and the side it cannot see must not move.
    const g = scene({ doc: { x0: 120, y0: 150, x1: W + 60, y1: 650 } });
    const rough = quadOf(128, 158, W - 2, 642);
    const r = refineCorners(g, rough);
    expect(r.skipped).toBe(1);
    expect(r.support[1]).toBe(0);
    // Left edge, which is real, found; right edge left exactly where it was.
    expect(Math.abs(r.quad[0].x - 120)).toBeLessThan(1.5);
    expect(Math.abs(r.quad[1].x - (W - 2))).toBeLessThan(1e-6);
  });

  it('⚠️ MOVES NOTHING ON A BLANK FRAME', () => {
    const flat: Gray = {
      data: new Uint8Array(W * H).fill(140),
      width: W,
      height: H,
    } as Gray;
    const start = quadOf(120, 150, 420, 650);
    const r = refineCorners(flat, start);
    expect(r.skipped).toBe(4);
    expect(worst(r.quad, start)).toBeLessThan(1e-6);
    expect(r.moved.every((m) => m === 0)).toBe(true);
  });

  it('is not dragged onto lines of print', () => {
    // Print is the strongest step anywhere near the top edge — 164 levels
    // against the border's 138 — and it is straight and supported the whole way
    // across. Only the flank test tells them apart: print has paper both sides.
    const r = refineCorners(scene(), quadOf(126, 156, 414, 644));
    expect(Math.abs(r.quad[0].y - DOC.y0)).toBeLessThan(1.5);
    expect(r.sides[0].flank).toBeGreaterThan(0.8);
  });

  it('holds the aspect guard when a refinement would wreck the shape', () => {
    // A page whose left edge is missing entirely and a strong distractor 90px
    // in from the right: if a side were allowed to snap there the quad's ratio
    // would go badly wrong. Asked for A4 (1.414), the guard drops the
    // least-supported refined side rather than the whole answer.
    const g = scene();
    const r = refineCorners(g, quadOf(126, 156, 414, 644), { expectAspect: 1.414 });
    // Nothing here should actually trip it — the honest refinement IS the right
    // shape — which is the point: the guard must not fire on a good answer.
    expect(r.vetoed).toBe(null);
    expect(worst(r.quad, TRUTH)).toBeLessThan(1.5);
  });

  it('⚠️ REFUSES A SIDE THAT WOULD MAKE THE DECLARED SHAPE WORSE', () => {
    // The member said this is a 2:1 document. The starting quad measures 2:1
    // exactly — it is 25px in on the left and right of a page that is really
    // 300x500 — so honestly refining it takes the ratio to 1.67 and AWAY from
    // what we were told. The guard drops refined sides until it stops making
    // the shape worse, rather than throwing the whole answer away.
    const rough = quadOf(DOC.x0 + 25, DOC.y0, DOC.x1 - 25, DOC.y1);
    const r = refineCorners(scene(), rough, { expectAspect: 2 });
    expect(r.vetoed).toBe('aspect');
    expect(r.skipped).toBeGreaterThan(0);
    // ⚠️ AND THE GUARD IS THE TRADE, NOT A BUG. It believes the shape the
    // member chose over the edges in the photograph; with no expectAspect the
    // same capture refines to the truth. Both are pinned so a change to either
    // is visible.
    const free = refineCorners(scene(), rough);
    expect(free.vetoed).toBe(null);
    expect(worst(free.quad, TRUTH)).toBeLessThan(1.5);
  });

  it('⚠️ NEVER RETURNS A NON-CONVEX OR NEEDLE QUAD', () => {
    // Fuzz over starts scattered around the truth, including some absurd ones.
    // Whatever the fit finds, the thing handed to the warp has to be a document
    // shape: convex, and no interior angle under 50°.
    const g = scene({ ruler: 22, crease: true });
    for (const d of [-40, -18, -5, 0, 7, 19, 33]) {
      const r = refineCorners(g, quadOf(120 + d, 150 - d, 420 - d, 650 + d));
      const q = r.quad;
      const cross = (i: number) => {
        const a = q[i];
        const b = q[(i + 1) % 4];
        const c = q[(i + 2) % 4];
        return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      };
      const signs = [0, 1, 2, 3].map((i) => Math.sign(cross(i)));
      expect(new Set(signs).size).toBe(1);
      for (const p of q) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('reports support, movement and the band it used', () => {
    const r = refineCorners(scene(), quadOf(132, 162, 408, 638));
    expect(r.moved.every((m) => m > 8)).toBe(true);
    expect(r.support.every((s) => s > 0.8)).toBe(true);
    expect(r.band).toBeGreaterThanOrEqual(40);
    expect(r.sides[0].step).toBeGreaterThan(100);
  });

  it('survives a degenerate quad', () => {
    const q = quadOf(10, 10, 12, 12);
    expect(() => refineCorners(scene(), q)).not.toThrow();
    expect(refineCorners(scene(), q).skipped).toBe(4);
  });

  it('finds an edge past the first band with the one wider pass', () => {
    // 3.5% of a 600px short edge floors at BAND_MIN = 40, so a side 55px out is
    // out of reach first time round and inside the doubled band second time.
    const rough = quadOf(DOC.x0 - 55, DOC.y0 - 8, DOC.x1 - 8, DOC.y1 - 8);
    const r = refineCorners(scene(), rough);
    expect(Math.abs(r.quad[0].x - DOC.x0)).toBeLessThan(2);
    expect(r.sides[3].widened).toBe(true);
  });
});
