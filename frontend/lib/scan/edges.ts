import type { Gray } from './detect';
import { isConvex, quadArea, type Pt, type Quad } from './geometry';

// ────────────────────────────────────────────────────────────────────
// FINDING THE DOCUMENT WHEN YOU ALREADY KNOW ROUGHLY WHERE IT IS.
//
// detect.ts hunts rectangles across the whole frame and hits a wall its own
// skipped regression records honestly: "a mousepad is a PERFECT document by
// border physics", and on a real licence card "the card is never a CANDIDATE
// at all". That is not a tuning problem. Nothing in the image says which of
// two nested rectangles is the document, so a global search has no reason to
// prefer either.
//
// The member does say. They put it in the box. This searches a narrow band
// around each of the four aim-box edges and nothing else, which makes a busy
// background stop existing rather than stop mattering.
//
// ⚠️ FOUR 1-D SEARCHES AND A LINE FIT, NOT A CONTOUR. The difference is what
// happens when something goes wrong:
//
//   A finger over one corner becomes a few outlier scanlines that the median
//   fit rejects. A contour would be corrupted along its whole length.
//
//   A rounded or worn corner needs no special handling, because no corner is
//   ever detected — the corners are where two fitted EDGES intersect.
//
//   A corner outside the frame is still recoverable, for the same reason.
//   Given the operator spent a day watching pages lose 20mm off each end,
//   extrapolating past the crop is worth having.
//
// ⚠️ AND IT REPORTS ITS OWN CONFIDENCE so the caller can decline it. A
// detector that is wrong 5% of the time and says so is useful; one that is
// wrong 5% of the time silently is worse than none, because the member stops
// checking. Everything here is pure — Gray in, numbers out — so it runs in a
// test, in the browser, and on the server without changing.
// ────────────────────────────────────────────────────────────────────

/** A fitted edge in general form: a*x + b*y = d. */
export interface EdgeLine {
  a: number;
  b: number;
  d: number;
}

export interface EdgeFit {
  line: EdgeLine;
  /** Share of scanlines that found a usable transition, 0-1. */
  hitFrac: number;
  /** Mean distance of the inliers from the fitted line, in pixels. */
  residual: number;
}

export type EdgeName = 'top' | 'bottom' | 'left' | 'right';

export interface SeededResult {
  /** Ordered TL, TR, BR, BL — or null when the lines did not intersect. */
  corners: Quad | null;
  /** 0 to 1. Below about 0.55 the caller should keep its own prior. */
  confidence: number;
  edges: Record<EdgeName, EdgeFit>;
}

/**
 * How strong an outer transition must be, against the best on its scanline,
 * to be preferred over it.
 *
 * ⚠️ NOT ZERO, OR CARPET WINS. Outermost-takes-it with no floor hands the edge
 * to whatever texture happens to sit at the far side of the band. 0.55 keeps a
 * paper edge that is genuinely weaker than the printed border inside it, while
 * refusing a wisp of weave that is merely further out.
 */
const OUTER_SHARE = 0.55;

export interface SeededOptions {
  /** Half-width of the search band, as a fraction of the buffer's dimension. */
  bandFrac?: number;
  /** Sample every Nth scanline. 4 is plenty for a straight line. */
  step?: number;
}

/**
 * A 3-tap separable blur over a luma buffer.
 *
 * ⚠️ WRITTEN RATHER THAN COPIED, BECAUSE THE OBVIOUS VERSION HAS A HOLE IN IT.
 * The reference implementation blurs horizontally for x in [1, w-1) into a
 * zero-filled scratch, then reads EVERY column back — so the first and last
 * columns come back as zero and get written into the image. That is a
 * full-strength false gradient at the extreme left and right, in the one
 * function whose entire job is to feed a gradient search. Edges are clamped
 * here instead.
 */
export function blur3(g: Gray): Gray {
  const { width: w, height: h, data } = g;
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  const at = (x: number, y: number) =>
    data[y * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = (at(x - 1, y) + at(x, y) + at(x + 1, y)) / 3;
    }
  }
  const tat = (x: number, y: number) =>
    tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = (tat(x, y - 1) + tat(x, y) + tat(x, y + 1)) / 3;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Find one edge by scanning a band for the strongest transition per scanline.
 *
 * `orientation` names the edge's own direction: a 'horizontal' edge runs left
 * to right, so we walk columns and look for the y of greatest vertical change.
 *
 * ⚠️ THE OUTERMOST TRANSITION, NOT THE STRONGEST — MEASURED, NOT ASSUMED.
 *
 * This scored gradient against distance from the prior, which was too weak to
 * survive a real document. The operator's certificate carries a printed black
 * border about a centimetre inside its own paper edge, and black-on-white is a
 * far stronger transition than white paper against brown carpet. On his iPhone
 * the detector found four beautifully straight lines — residuals 0.3 to 0.7 of
 * a pixel — all four of them on the PRINTED BORDER, with the paper's margin
 * left outside the crop. On the Samsung the same competition showed up as a
 * residual of 6.3 on the top edge: points jumping between two parallel lines a
 * few pixels apart, which is what a fit does when it cannot decide.
 *
 * The rule that separates them is not about strength at all. A document's
 * boundary is the LAST transition before the background; anything printed on
 * it is by definition inside. So among candidates that clear the floor, take
 * the outermost — `outward` says which way that is — and require it to be
 * within a fraction of the strongest, so a wisp of carpet texture cannot
 * outrank a real edge simply by being further out.
 *
 * ⚠️ AND THE THRESHOLD IS RELATIVE, NOT ABSOLUTE. A fixed floor of 8 levels
 * finds nothing at all for white paper on a pale desk — which is precisely
 * the case INK_AT's note already records as inseparable by cheap statistics.
 * The floor here is a fraction of the band's own contrast.
 */
export function findEdgeLine(
  g: Gray,
  orientation: 'horizontal' | 'vertical',
  pos: number,
  band: number,
  from: number,
  to: number,
  step = 4,
  /** Which way is away from the document: -1 towards 0, +1 towards the far side. */
  outward: -1 | 1 = -1,
): EdgeFit {
  const { width: w, height: h, data } = g;
  const horizontal = orientation === 'horizontal';
  const acrossMax = (horizontal ? h : w) - 2;
  const alongMax = (horizontal ? w : h) - 1;
  const lo = Math.max(1, Math.round(pos - band));
  const hi = Math.min(acrossMax, Math.round(pos + band));

  const t0 = Math.max(0, Math.round(from));
  const t1 = Math.min(alongMax, Math.round(to));

  const hits: { t: number; u: number }[] = [];
  let scanlines = 0;
  let strongest = 0;

  // One pass to learn the band's own contrast, so the floor can be relative.
  for (let t = t0; t <= t1; t += step) {
    for (let u = lo; u <= hi; u++) {
      const gr = horizontal
        ? Math.abs(data[(u + 1) * w + t] - data[(u - 1) * w + t])
        : Math.abs(data[t * w + (u + 1)] - data[t * w + (u - 1)]);
      if (gr > strongest) strongest = gr;
    }
  }
  const floor = Math.max(6, strongest * 0.25);

  for (let t = t0; t <= t1; t += step) {
    scanlines++;
    // Two passes over the band: find the strongest real transition on this
    // scanline, then take the OUTERMOST one that is a decent fraction of it.
    let peak = 0;
    for (let u = lo; u <= hi; u++) {
      const gr = horizontal
        ? Math.abs(data[(u + 1) * w + t] - data[(u - 1) * w + t])
        : Math.abs(data[t * w + (u + 1)] - data[t * w + (u - 1)]);
      if (gr > peak) peak = gr;
    }
    if (peak < floor) continue;
    const keep = peak * OUTER_SHARE;
    let bestU = -1;
    for (let u = lo; u <= hi; u++) {
      const gr = horizontal
        ? Math.abs(data[(u + 1) * w + t] - data[(u - 1) * w + t])
        : Math.abs(data[t * w + (u + 1)] - data[t * w + (u - 1)]);
      if (gr < keep) continue;
      // Outermost wins: for a top or left edge that is the smallest index,
      // for a bottom or right edge the largest.
      if (bestU < 0 || (outward < 0 ? u < bestU : u > bestU)) bestU = u;
    }
    if (bestU >= 0) hits.push({ t, u: bestU });
  }

  if (hits.length < 4 || scanlines === 0) {
    return { line: lineFrom(orientation, pos, 0), hitFrac: 0, residual: 99 };
  }

  let { m, c } = medianFit(hits);
  const resid = hits.map((p) => Math.abs(p.u - (m * p.t + c)));
  const medR = median(resid);
  const inliers = hits.filter(
    (_, i) => resid[i] <= Math.max(2.5, medR * 2.5),
  );
  if (inliers.length >= 4) ({ m, c } = leastSquares(inliers));

  const residual = mean(inliers.map((p) => Math.abs(p.u - (m * p.t + c))));
  return {
    line: lineFrom(orientation, c, m),
    // ⚠️ COUNTED, NOT COMPUTED. Deriving the denominator as
    // floor((to-from)/step) is one short of the loop's actual iterations, so
    // hitFrac could exceed 1 and inflate the confidence it feeds.
    hitFrac: Math.min(1, inliers.length / scanlines),
    residual,
  };
}

/** u = m*t + c, in the buffer's own axes, as a*x + b*y = d. */
function lineFrom(
  orientation: 'horizontal' | 'vertical',
  c: number,
  m: number,
): EdgeLine {
  // horizontal edge: u is y, t is x  ->  y = m*x + c
  // vertical edge:   u is x, t is y  ->  x = m*y + c
  return orientation === 'horizontal'
    ? { a: -m, b: 1, d: c }
    : { a: 1, b: -m, d: c };
}

export function intersect(l1: EdgeLine, l2: EdgeLine): Pt | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (l1.d * l2.b - l2.d * l1.b) / det,
    y: (l1.a * l2.d - l2.a * l1.d) / det,
  };
}

/**
 * The document's corners, seeded by where the member aimed.
 *
 * Returns a confidence the caller is expected to act on: below roughly 0.55,
 * keep the prior. Never throws and never returns a quad it does not believe.
 */
export function seededCorners(
  g: Gray,
  aim: Quad,
  opts: SeededOptions = {},
): SeededResult {
  const bandFrac = opts.bandFrac ?? 0.12;
  const step = opts.step ?? 4;
  const xs = aim.map((p) => p.x);
  const ys = aim.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const bandX = Math.max(2, Math.round(g.width * bandFrac));
  const bandY = Math.max(2, Math.round(g.height * bandFrac));

  const edges: Record<EdgeName, EdgeFit> = {
    top: findEdgeLine(g, 'horizontal', y0, bandY, x0, x1, step, -1),
    bottom: findEdgeLine(g, 'horizontal', y1, bandY, x0, x1, step, 1),
    left: findEdgeLine(g, 'vertical', x0, bandX, y0, y1, step, -1),
    right: findEdgeLine(g, 'vertical', x1, bandX, y0, y1, step, 1),
  };

  const tl = intersect(edges.top.line, edges.left.line);
  const tr = intersect(edges.top.line, edges.right.line);
  const br = intersect(edges.bottom.line, edges.right.line);
  const bl = intersect(edges.bottom.line, edges.left.line);
  const all = [tl, tr, br, bl];

  if (all.some((p) => p === null)) {
    return { corners: null, confidence: 0, edges };
  }
  const corners = all as Quad;

  // ⚠️ EVERY CHECK HERE IS A REASON TO DECLINE, NOT A SCORE TO AVERAGE AWAY.
  // A quad that is not convex, or half the area the member framed, is not a
  // slightly worse answer — it is a different object, and shipping it as a
  // "low confidence" result invites a caller to use it anyway.
  const priorArea = quadArea(aim);
  const ratio = priorArea > 0 ? quadArea(corners) / priorArea : 0;
  if (!isConvex(corners) || ratio < 0.5 || ratio > 1.8) {
    return { corners: null, confidence: 0, edges };
  }

  const fits = [edges.top, edges.bottom, edges.left, edges.right];
  const hit = mean(fits.map((e) => e.hitFrac));
  const straight = clamp01(1 - mean(fits.map((e) => e.residual)) / 6);
  let confidence = clamp01(hit * straight);
  // One weak edge is enough to distrust the corners it helps define.
  if (fits.some((e) => e.hitFrac < 0.45)) confidence *= 0.5;

  // ⚠️ NO CORNERS WITHOUT CONFIDENCE, AND THIS IS NOT BELT-AND-BRACES.
  // When an edge finds nothing, findEdgeLine returns the PRIOR's own edge so
  // the arithmetic downstream stays finite. Four of those intersect back into
  // the aim box exactly — convex, and precisely the expected area — so every
  // structural check passes and a quad comes back looking perfectly
  // reasonable, with a confidence of zero beside it that a caller has to
  // remember to read.
  //
  // That is the failure this module's own note warns about two functions up:
  // a detector that is wrong and says so quietly is worse than none. Handing
  // back null is the version that cannot be misused.
  if (confidence <= 0) return { corners: null, confidence: 0, edges };

  return { corners, confidence, edges };
}

/**
 * Snap a dropped handle to the strongest corner near it.
 *
 * ⚠️ THIS IS THE EFFORT FIX, NOT AN ACCURACY ONE. Dragging four dots onto four
 * corners is the single most expensive thing the scanner asks of anybody, and
 * most of that cost is PRECISION — getting close is easy, landing exactly is
 * not. Snapping means near enough becomes exactly right, so the drag stops
 * having to be careful.
 *
 * Harris response over a small window: strong in both gradient directions at
 * once, which is what a corner is and an edge is not.
 *
 * ⚠️ RETURNS THE ORIGINAL POINT WHEN NOTHING IS CORNER-LIKE. A snap that
 * always moves the dot somewhere is a snap that fights the member on a
 * document whose corner is genuinely soft.
 */
export function cornerSnap(g: Gray, pt: Pt, radius = 24): Pt {
  const { width: w, height: h, data } = g;
  const win = 2;
  const x0 = Math.max(win + 1, Math.round(pt.x - radius));
  const x1 = Math.min(w - win - 2, Math.round(pt.x + radius));
  const y0 = Math.max(win + 1, Math.round(pt.y - radius));
  const y1 = Math.min(h - win - 2, Math.round(pt.y + radius));
  if (x1 <= x0 || y1 <= y0) return pt;

  let best: Pt | null = null;
  let bestScore = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let ixx = 0;
      let iyy = 0;
      let ixy = 0;
      for (let dy = -win; dy <= win; dy++) {
        for (let dx = -win; dx <= win; dx++) {
          const i = (y + dy) * w + (x + dx);
          const gx = data[i + 1] - data[i - 1];
          const gy = data[i + w] - data[i - w];
          ixx += gx * gx;
          iyy += gy * gy;
          ixy += gx * gy;
        }
      }
      const det = ixx * iyy - ixy * ixy;
      const tr = ixx + iyy;
      const score = det - 0.05 * tr * tr;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  // ⚠️ RELATIVE, NOT AN ABSOLUTE MAGIC NUMBER. Harris response scales with the
  // square of local contrast, so a fixed floor means "snaps on a crisp card,
  // never snaps on a soft photocopy". Require the winner to stand out from the
  // window's own typical response instead.
  if (!best || bestScore <= 0) return pt;
  const span = Math.max(1, (x1 - x0) * (y1 - y0));
  const perPixel = bestScore / span;
  return perPixel > 1 ? best : pt;
}

// ── small helpers ───────────────────────────────────────────────────

function medianFit(pts: { t: number; u: number }[]): { m: number; c: number } {
  const slopes: number[] = [];
  const half = Math.floor(pts.length / 2);
  for (let i = 0; i < half; i++) {
    const p = pts[i];
    const q = pts[i + half];
    if (q.t !== p.t) slopes.push((q.u - p.u) / (q.t - p.t));
  }
  const m = median(slopes.length ? slopes : [0]);
  const c = median(pts.map((p) => p.u - m * p.t));
  return { m, c };
}

function leastSquares(pts: { t: number; u: number }[]): {
  m: number;
  c: number;
} {
  let st = 0;
  let su = 0;
  let stt = 0;
  let stu = 0;
  for (const p of pts) {
    st += p.t;
    su += p.u;
    stt += p.t * p.t;
    stu += p.t * p.u;
  }
  const n = pts.length;
  const denom = n * stt - st * st;
  if (Math.abs(denom) < 1e-9) return { m: 0, c: su / n };
  const m = (n * stu - st * su) / denom;
  return { m, c: (su - m * st) / n };
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
