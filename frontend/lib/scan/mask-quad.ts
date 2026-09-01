import type { Quad } from './geometry';
import { type Letterbox, MODEL_SIZE } from './letterbox';

// ────────────────────────────────────────────────────────────────────
// A QUAD FROM THE MASK, NOT FROM THE CORNER PEAKS.
//
// ⚠️ THE MODEL EMITS `mask_logits` ON EVERY INFERENCE AND WE THREW IT AWAY.
// docquad-postprocess.ts says why it matters: the four corner heads ALWAYS
// produce four peaks — there are four planes and each has a maximum — so the
// corners alone can never say "there is nothing here", and they can never say
// "the thing I found is not a document shape". The mask can say both.
//
// ⚠️ CORNERS COME FROM EDGE LINES, NEVER FROM A PEAK. A heatmap peak is a
// PROPOSAL. The authority is the mask boundary, fitted as four lines and
// intersected. Two consequences fall out of that and both are wanted:
//
//   1. An intersection may land OUTSIDE the document's pixels. On a rounded
//      corner that is not an error, it is the right answer — the true corner
//      of the rectangle is where the two straight edges WOULD have met, and
//      the arc is a chamfer taken off it.
//   2. It degrades gracefully. A smeared or absent peak costs nothing,
//      because no peak was ever consulted.
//
// ⚠️ EVERY LINE FIT EXCLUDES THE ENDS OF ITS EDGE. See EDGE_TRIM. Arc pixels
// near a corner curve inward, and including them tilts the fitted line into
// the document — which shaves the crop on all four sides, worst exactly where
// the document is most rounded.
// ────────────────────────────────────────────────────────────────────

/** The mask plane is 64x64, like the corner heatmaps. */
export const MASK_SIZE = 64;

/** Logit above which a cell is called document. 0 is the even-odds point. */
export const MASK_AT = 0;

/**
 * How much of each edge span to ignore at both ends, as a fraction.
 *
 * ⚠️ THIS IS A2, AND IT IS NOT OPTIONAL ON A ROUNDED DOCUMENT. An ID-1 card
 * is rounded to 3.18 mm on an 85.6 mm edge, so the arc occupies roughly the
 * outer 4% of each edge — but the boundary pixels there run diagonally, and a
 * least-squares fit weights them like any other. 20% a side is a generous
 * margin that costs nothing: the middle 60% of a straight edge determines the
 * line perfectly well, and extrapolating a line is exact.
 */
export const EDGE_TRIM = 0.2;

/** Below this fraction of the plane, there is nothing worth calling a document. */
export const MIN_COVERAGE = 0.04;

/** Worst corner angle may deviate this far from square, in degrees. */
export const MAX_SKEW = 35;

/** RMS distance from boundary to its fitted line, in mask cells. */
export const MAX_RESIDUAL = 1.6;

export interface MaskAnalysis {
  /** Fraction of the plane the largest component covers. */
  coverage: number;
  /**
   * Long-over-short of the component's oriented extent.
   *
   * ⚠️ SURFACED DELIBERATELY, EVEN THOUGH NOTHING READS IT YET. An open
   * booklet photographed as a spread presents at roughly double a single
   * page's aspect, and that is the cheapest signal that the thing in frame is
   * not one document. Whatever handles that case later needs this number.
   */
  aspect: number;
  /** Corners in SOURCE space, TL TR BR BL. Null when a gate refused. */
  quad: Quad | null;
  /** RMS distance from the kept boundary pixels to their fitted lines. */
  residual: number;
  /** 1 when perfectly square, falling to 0 at MAX_SKEW. */
  rectangularity: number;
  /** Why there is no quad. Absent on success. */
  reject?: 'empty' | 'too-small' | 'not-rectangular' | 'poor-fit' | 'degenerate';
}

interface Pt {
  x: number;
  y: number;
}

/**
 * The largest 4-connected component of the thresholded mask.
 *
 * Largest rather than all: a mask often carries specks — a hand, a shadow
 * edge, a second sheet — and fitting lines to the union of a document and a
 * speck produces a quad containing neither.
 */
function largestComponent(mask: Float32Array): { cells: number[]; area: number } {
  const seen = new Uint8Array(MASK_SIZE * MASK_SIZE);
  let best: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || mask[start] <= MASK_AT) continue;
    const cells: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      cells.push(i);
      const x = i % MASK_SIZE;
      const y = (i / MASK_SIZE) | 0;
      if (x > 0) push(i - 1);
      if (x < MASK_SIZE - 1) push(i + 1);
      if (y > 0) push(i - MASK_SIZE);
      if (y < MASK_SIZE - 1) push(i + MASK_SIZE);
    }
    if (cells.length > best.length) best = cells;
    function push(j: number) {
      if (!seen[j] && mask[j] > MASK_AT) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return { cells: best, area: best.length };
}

/** Component cells with at least one non-component 4-neighbour. */
function boundaryOf(cells: number[]): Pt[] {
  const inSet = new Uint8Array(MASK_SIZE * MASK_SIZE);
  for (const i of cells) inSet[i] = 1;
  const out: Pt[] = [];
  for (const i of cells) {
    const x = i % MASK_SIZE;
    const y = (i / MASK_SIZE) | 0;
    const edge =
      x === 0 ||
      y === 0 ||
      x === MASK_SIZE - 1 ||
      y === MASK_SIZE - 1 ||
      !inSet[i - 1] ||
      !inSet[i + 1] ||
      !inSet[i - MASK_SIZE] ||
      !inSet[i + MASK_SIZE];
    if (edge) out.push({ x: x + 0.5, y: y + 0.5 });
  }
  return out;
}

/** Andrew's monotone chain. */
function hull(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * The hull, walked as an outline, with points spread evenly along each edge.
 *
 * ⚠️ THE LINES ARE FITTED TO THIS, NOT TO THE RAW BOUNDARY, AND IT IS THE
 * WHOLE FIX. A document is CONVEX. Every concavity in its mask is therefore a
 * segmentation error, and the raw boundary is full of them: bites taken out of
 * an edge where the model lost the paper against the background, and rings of
 * boundary cells around interior holes that sit in the MIDDLE of the page.
 * Grouping those by nearest side and least-squares fitting them drags each
 * line inward by however much was missing — which is why the rung reported
 * corners tens of degrees off square on pages the corner heads read as 1.7°
 * off, and why it has been rejecting its own quad on every capture since it
 * shipped.
 *
 * Taking the hull removes both classes by construction: a bite is bridged, and
 * a hole's ring is interior so it can never be a hull vertex. Measured on 34
 * real fixtures, against the raw boundary:
 *
 *                       accepted   median residual   median worst corner
 *     raw boundary      14 / 34         1.5              41 deg
 *     hull outline      29 / 34         0.2              13 deg
 *
 * ⚠️ AND IT MUST BE RESAMPLED, NOT JUST THE VERTICES. A hull is a handful of
 * points bunched wherever the outline turns, so fitting to vertices alone
 * weights the corners — the exact places EDGE_TRIM exists to discard — and
 * leaves a long straight edge represented by its two endpoints. Spreading
 * points along each edge by its LENGTH gives every side the weight it earned.
 *
 * The one thing this is worse at is a PROTRUSION — a thumb on a card, a
 * shadow bridging to something else — which the hull follows outward instead
 * of averaging away. That is deliberate and it is safe here: arbitration in
 * capture.ts scores every candidate against real intensity steps in the
 * photograph, so an inflated quad simply loses to the corner path. A mask quad
 * can only ever win on evidence.
 */
function hullOutline(h: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // Two samples per mask cell of edge — dense enough that a long side
    // outweighs a short one in proportion to its actual length.
    const n = Math.max(1, Math.round(len * 2));
    for (let t = 0; t < n; t++) {
      out.push({ x: a.x + ((b.x - a.x) * t) / n, y: a.y + ((b.y - a.y) * t) / n });
    }
  }
  return out;
}

/**
 * Orientation of the minimum-area rectangle, by rotating calipers.
 *
 * Only the ANGLE is wanted. The rectangle itself is a scaffold: it tells each
 * boundary pixel which of the four sides it belongs to, and then the real
 * lines are fitted to those groups.
 */
function minAreaAngle(h: Pt[]): number {
  let bestArea = Infinity;
  let bestTheta = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const theta = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-theta);
    const s = Math.sin(-theta);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of h) {
      const rx = p.x * c - p.y * s;
      const ry = p.x * s + p.y * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) {
      bestArea = area;
      bestTheta = theta;
    }
  }
  return bestTheta;
}

interface Line {
  /** Unit normal. */
  nx: number;
  ny: number;
  /** nx*x + ny*y = c */
  c: number;
  residual: number;
  n: number;
}

/** Total-least-squares line through points — PCA, not y-on-x. */
function fitLine(pts: Pt[]): Line | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Smaller eigenvector of the covariance is the normal.
  const t = (sxx + syy) / 2;
  const d = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const lambda = t - d;
  let nx = sxy;
  let ny = lambda - sxx;
  const len = Math.hypot(nx, ny);
  if (len < 1e-9) {
    // Perfectly axis-aligned: covariance is diagonal, pick by variance.
    if (sxx >= syy) {
      nx = 0;
      ny = 1;
    } else {
      nx = 1;
      ny = 0;
    }
  } else {
    nx /= len;
    ny /= len;
  }
  const c = nx * mx + ny * my;
  let sq = 0;
  for (const p of pts) sq += (nx * p.x + ny * p.y - c) ** 2;
  return { nx, ny, c, residual: Math.sqrt(sq / n), n };
}

function intersect(a: Line, b: Line): Pt | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (a.c * b.ny - a.ny * b.c) / det,
    y: (a.nx * b.c - a.c * b.nx) / det,
  };
}

/**
 * Fit a quad to the mask and report how well it fitted.
 *
 * `mask` is the raw 64x64 logit plane. Coordinates come back in SOURCE space
 * via the letterbox, so the result is directly comparable with the corner-head
 * quad and usable as a crop.
 */
export function analyseMask(mask: Float32Array, lb: Letterbox): MaskAnalysis {
  const empty: MaskAnalysis = {
    coverage: 0,
    aspect: 0,
    quad: null,
    residual: Infinity,
    rectangularity: 0,
    reject: 'empty',
  };
  if (!mask || mask.length < MASK_SIZE * MASK_SIZE) return empty;

  const comp = largestComponent(mask);
  const coverage = comp.area / (MASK_SIZE * MASK_SIZE);
  if (!comp.area) return empty;

  const raw = boundaryOf(comp.cells);
  const h = hull(raw);
  if (h.length < 4) return { ...empty, coverage, reject: 'degenerate' };

  // ⚠️ EVERYTHING BELOW FITS THE HULL OUTLINE, NEVER `raw`. See hullOutline.
  // The extents are unchanged by the swap — a hull contains every extreme
  // point of the set it was built from — so the scaffold rectangle, and with
  // it the side assignment, are measured against exactly the same box.
  const bound = hullOutline(h);

  const theta = minAreaAngle(h);
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);
  const rot = (p: Pt) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of bound) {
    const r = rot(p);
    if (r.x < minX) minX = r.x;
    if (r.x > maxX) maxX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.y > maxY) maxY = r.y;
  }
  const w = maxX - minX;
  const hgt = maxY - minY;
  const aspect = Math.max(w, hgt) / Math.max(1e-6, Math.min(w, hgt));
  if (coverage < MIN_COVERAGE) {
    return { coverage, aspect, quad: null, residual: Infinity, rectangularity: 0, reject: 'too-small' };
  }

  // Assign each boundary pixel to the nearest side of the scaffold rectangle,
  // in the rotated frame where the sides are axis-aligned.
  const groups: Pt[][] = [[], [], [], []]; // top, right, bottom, left
  for (const p of bound) {
    const r = rot(p);
    const d = [r.y - minY, maxX - r.x, maxY - r.y, r.x - minX];
    let k = 0;
    for (let i = 1; i < 4; i++) if (d[i] < d[k]) k = i;
    groups[k].push(p);
  }

  // ⚠️ TRIM THE ENDS BEFORE FITTING — this is the whole of A2. Sorting along
  // the side's own direction and dropping EDGE_TRIM from each end removes the
  // arc pixels that would otherwise tilt the line into the document.
  const lines: (Line | null)[] = groups.map((g, k) => {
    if (g.length < 5) return null;
    const along = (p: Pt) => {
      const r = rot(p);
      return k === 0 || k === 2 ? r.x : r.y;
    };
    const sorted = g.slice().sort((a, b) => along(a) - along(b));
    const cut = Math.floor(sorted.length * EDGE_TRIM);
    const kept = sorted.slice(cut, sorted.length - cut);
    return fitLine(kept.length >= 3 ? kept : sorted);
  });

  // ⚠️ PUSH EACH LINE OUT BY HALF A CELL. Boundary pixels are sampled at cell
  // CENTRES, so a region filling cells 12..50 has its outermost samples at
  // 12.5 and 50.5 while the region genuinely spans 12.0 to 51.0. A line fitted
  // through those centres therefore sits half a cell inside the true edge — on
  // all four sides at once, which is a systematic shave of the crop and
  // exactly the class of error the end-trim above exists to prevent. Half a
  // mask cell is 2 model pixels, and on a 4K frame that is a real strip of
  // document.
  //
  // The sign of a fitted normal is arbitrary, so orient it away from the
  // component's centre first — that is what makes "outward" mean anything.
  let ccx = 0;
  let ccy = 0;
  for (const p of bound) {
    ccx += p.x;
    ccy += p.y;
  }
  ccx /= bound.length;
  ccy /= bound.length;
  for (const l of lines) {
    if (!l) continue;
    // Signed distance from the centroid to the line, along the normal.
    if (l.nx * ccx + l.ny * ccy - l.c > 0) {
      l.nx = -l.nx;
      l.ny = -l.ny;
      l.c = -l.c;
    }
    l.c += 0.5;
  }

  if (lines.some((l) => !l)) {
    return { coverage, aspect, quad: null, residual: Infinity, rectangularity: 0, reject: 'poor-fit' };
  }
  const [top, right, bottom, left] = lines as Line[];
  const residual = Math.max(top.residual, right.residual, bottom.residual, left.residual);

  const tl = intersect(top, left);
  const tr = intersect(top, right);
  const br = intersect(bottom, right);
  const bl = intersect(bottom, left);
  if (!tl || !tr || !br || !bl) {
    return { coverage, aspect, quad: null, residual, rectangularity: 0, reject: 'degenerate' };
  }
  const modelQuad = [tl, tr, br, bl];

  // Rectangularity from the worst corner's deviation from square.
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const c0 = modelQuad[i];
    const a = modelQuad[(i + 3) % 4];
    const b = modelQuad[(i + 1) % 4];
    const v1 = { x: a.x - c0.x, y: a.y - c0.y };
    const v2 = { x: b.x - c0.x, y: b.y - c0.y };
    const n1 = Math.hypot(v1.x, v1.y) || 1;
    const n2 = Math.hypot(v2.x, v2.y) || 1;
    const cosA = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)));
    worst = Math.max(worst, Math.abs((Math.acos(cosA) * 180) / Math.PI - 90));
  }
  const rectangularity = Math.max(0, 1 - worst / MAX_SKEW);

  if (worst > MAX_SKEW) {
    return { coverage, aspect, quad: null, residual, rectangularity, reject: 'not-rectangular' };
  }
  if (residual > MAX_RESIDUAL) {
    return { coverage, aspect, quad: null, residual, rectangularity, reject: 'poor-fit' };
  }

  // Mask cell -> model pixel -> source pixel.
  const cell = MODEL_SIZE / MASK_SIZE;
  const quad = modelQuad.map((p) => ({
    x: (p.x * cell - lb.offsetX) / lb.scale,
    y: (p.y * cell - lb.offsetY) / lb.scale,
  })) as unknown as Quad;

  return { coverage, aspect, quad, residual, rectangularity };
}
