import type { Gray } from './detect';
import { isConvex, minInteriorAngle, type Pt, type Quad } from './geometry';
import { intersectLines } from './magnetic';

// ────────────────────────────────────────────────────────────────────
// EDGE-SNAP CORNER REFINEMENT, ON THE FULL-RESOLUTION STILL.
//
// Every rung that produces a quad works small. DocCornerNet reasons on a
// 224x224 stretch — its median corner error is ~2.3px THERE, which is ~30px on
// the 3100px still it came from — and the classical detector halves the image
// until print blurs away. Thirty pixels of corner error on an A4 is a visibly
// skew crop, and the operator's phone produced exactly that.
//
// ⚠️ THIS EXISTS BECAUSE refine-edges.ts COULD NOT FIX IT, AND THE REASON IS
// WORTH KEEPING. That function searched ±60px (SEARCH_MAX), took the NEAREST
// step over MIN_STEP on each of 32 profiles, and fitted all 32 by total least
// squares with NO OUTLIER REJECTION. On the operator's captures it reported
// "refined 28.3px moved" and the crop was still skew — because on a real desk
// a handful of those 32 profiles latch onto a crease, a ruler, a table edge or
// a shadow, and in a plain TLS fit six bad points out of thirty-two tilt the
// line by degrees. It moved the edge; it moved it to the wrong place, and it
// had no way to know.
//
// The three changes that matter, in order of how much they buy:
//
//   1. RANSAC, not TLS-over-everything. A crease crossing one side contributes
//      candidates that do not lie on any single straight line with the rest,
//      so it lands outside the 2px inlier band and never reaches the refit.
//   2. SEVERAL CANDIDATES PER PROFILE, not one. "The nearest step" is a
//      commitment made before we know where the edge is; keeping the nearest
//      six and letting the consensus choose defers that decision to the point
//      where there is evidence for it.
//   3. A SUPPORT FLOOR AND A FLANK TEST. Below 55% agreement the side is left
//      exactly where the detector put it — see MIN_SUPPORT — and a line with
//      PAPER ON BOTH SIDES is not a document boundary however straight it is,
//      which is what stops a wide band snapping onto the first line of print.
//
// ⚠️ EDGES, NEVER CORNERS — inherited unchanged from refine-edges.ts and still
// true. A cornerSubPix-family search near a rounded document corner locks onto
// the ARC, which is the strongest local structure there, and drags the corner
// inward by roughly the radius. The true corner is not on the document at all:
// it is where two straight edges would have met. So fit the edges, which are
// real, and intersect them, which is exact.
//
// ⚠️ AND ONLY THE MIDDLE OF EACH EDGE, for the same reason: near a corner the
// arc curves away from the line and those samples tilt the fit inward.
//
// Pure — buffers in, numbers out. No DOM, no canvas, so all of it is reachable
// from a unit test with no phone.
// ────────────────────────────────────────────────────────────────────

// ── the tuned numbers, and what each one is paying for ───────────────

/** Fraction of each side ignored at EACH end. Middle 80% is sampled. */
export const TRIM = 0.1;

/**
 * Profiles across the kept span.
 *
 * 64, up from refine-edges.ts's 32, because RANSAC spends samples that a plain
 * fit does not: at a 55% support floor, 64 profiles still means thirty-five
 * separate agreeing measurements after the outliers are thrown away, where 32
 * would leave eighteen. The cost is nothing that matters — measured over the
 * eighteen fixture photographs, the whole four-side fit runs 39ms median /
 * 61ms worst at 4032x3024 and 22ms median at 2048, against a 150ms budget.
 */
export const PROFILES = 64;

/**
 * How far either side of the current edge to look, as a fraction of the
 * RASTER's short edge, with a floor and a ceiling in pixels.
 *
 * ⚠️ THE RASTER'S SHORT EDGE, NOT THE QUAD'S. The error to be corrected comes
 * from the model, and the model's error scales with the IMAGE it was handed —
 * 2.3px on its own 224px view is 3.5% of that view whatever size the document
 * happens to be inside it. refine-edges.ts scaled its band off the quad and
 * then clamped at 60px, so on a 3024px-short still it searched 60px for an
 * error that is routinely 30 and occasionally 90. A band that cannot reach the
 * true edge does not refine anything; it silently votes zero.
 */
export const BAND_FRAC = 0.035;
export const BAND_MIN = 40;
export const BAND_MAX = 160;

/**
 * A hard cap at a quarter of the quad's own short side.
 *
 * Only bites on a document that is small in a big frame, where 3.5% of the
 * frame would be a large fraction of the document itself and the band would
 * swallow its print. It does not bind on any real framing measured here (a
 * card at 20% of frame area on a 4032px still: cap 225px against a band of
 * 105) — it is there so a badly-framed capture degrades into "found nothing"
 * rather than "found the wrong thing".
 */
export const BAND_QUAD_CAP = 0.25;

/** Sampling pitch along a profile. Half-pixel, so a step lands sub-pixel. */
const PITCH = 0.5;

/**
 * A step must be at least this many levels to be a candidate.
 *
 * The same 12 refine-edges.ts and magnetic.ts use, and measured the same way:
 * a grey desk against white paper is about 78 levels, a black ruler on that
 * desk about 110, sensor noise on flat lit paper 4-6 peak to peak.
 */
export const MIN_STEP = 12;

/** Candidate steps kept per profile, NEAREST first. */
const MAX_CANDIDATES = 6;

/** How many profiles at each end of the span may SEED a hypothesis. */
const SEED_PROFILES = 8;

/** How far a candidate may sit from a hypothesised line and still vote. */
export const INLIER_PX = 2;

/**
 * The support floor. Below this the side is left exactly as the detector had
 * it and counted in `skipped`.
 *
 * ⚠️ A REFINEMENT THAT CANNOT SEE THE EDGE MUST NOT MOVE IT. A confident wrong
 * crop is worse than an approximate right one: the member can see and fix a
 * quad that is obviously off, and cannot see one that is subtly off.
 */
export const MIN_SUPPORT = 0.55;

/**
 * How hard proximity outranks strength. Squared, for magnetic.ts's measured
 * reason: a page edge 6px out scores 0.549 on strength alone and a black ruler
 * 9px out scores 0.630, so linear proximity (0.82 against 0.73) does not close
 * the gap and the fit lands on the ruler. Squaring makes the ruler have to be
 * nearer as well as darker.
 */
const PROX_POWER = 2;

/**
 * How far past the step the flank test looks, and the difference that earns
 * full credit.
 *
 * ⚠️ THE FLANK TEST IS WHAT KEEPS A WIDE BAND OFF THE PRINT AND OFF THE RULER,
 * AND IT TAKES BOTH HALVES TO DO IT. Two things in a band look exactly like a
 * document edge to a consensus fit — they are straight, strong and supported
 * along the whole side — and each needs a different half of this test:
 *
 *   A LINE OF PRINT is not a BOUNDARY. It has paper on both sides, so its two
 *   flanks read the same; the document's own edge has paper on one and desk on
 *   the other. Measured on the fixtures: a page border shows 60-90 levels
 *   across its flanks, a text line 4-10.
 *
 *   A RULER'S EDGE passes that test — it genuinely is a boundary, ruler against
 *   desk — and proximity alone does not beat it. Worked through on the numbers:
 *   with the model's corner 20px outside the page and a ruler edge 10px out, the
 *   ruler scores 0.283 on support x strength x proximity and the page 0.175, so
 *   the fit lands on the ruler. What separates them is that the ruler has DESK
 *   on the side facing the document and the document does not. So the inward
 *   flank is compared against the document's own interior, sampled once per
 *   quad; the ruler scores zero on that and is refused outright at FLANK_MIN.
 *
 * Deliberately sign-agnostic: `inner` is measured, never assumed, so a dark
 * cover on a light desk works exactly as a white page on a dark one.
 */
const FLANK_GAP = 2;
const FLANK_SPAN = 12;
const FLANK_FULL = 60;

/**
 * How far the inward flank may drift from the document's interior tone before
 * it stops counting as "the document is on this side".
 *
 * ⚠️ 90, NOT FLANK_FULL's 60, AND THAT GAP IS PAYING FOR SHADOW. A page lit
 * from one side is genuinely darker at its far edge than at its middle — 40 to
 * 60 levels on the fixtures — and at a 60-level tolerance that page fails its
 * own interior test and loses the refinement on exactly the captures that need
 * it most. 90 still puts a ruler (138 levels of desk against paper) at zero.
 */
const MATCH_FULL = 90;

/**
 * The flank floor. Below this a line is not a document boundary at all and is
 * refused outright, whatever its support, strength or proximity.
 *
 * ⚠️ A GATE, NOT A PENALTY, AND IT HAD TO BECOME ONE. As a score term it was
 * not enough: a line of print sitting exactly where the detector guessed scores
 * proximity 1.0 and a 164-level step against the paper border's 138, so at a
 * 0.35 floor it beat the true edge 25px away (0.269 against 0.099) and the
 * synthetic regression caught it. Weighting cannot fix that — the print is
 * genuinely nearer and genuinely stronger. It is simply not an edge of the
 * document, and the flank is the only thing in the image that says so.
 */
const FLANK_MIN = 0.1;

/** Guards on the answer. */
export const MIN_ANGLE = 50;
export const ASPECT_TOL = 0.08;

/**
 * How far a corner may travel, as a multiple of the band.
 *
 * ⚠️ 1.5x, NOT 1x, and magnetic.ts paid for this number: a corner is where two
 * refined lines cross, and on an obliquely-meeting pair it travels further than
 * the perpendicular gap either line closed — at 48° off square, half again as
 * far. Capping at the band itself would refuse exactly the skewed pages this
 * function exists for.
 */
const MOVE_CAP = 1.5;

interface Line {
  nx: number;
  ny: number;
  c: number;
}

/** What one side's fit came back with. Exported for the harness and tests. */
export interface SideFit {
  line: Line | null;
  /** Share of profiles that voted for the winning line, 0-1. */
  support: number;
  /** Signed perpendicular offset of the fitted line from the input edge, px. */
  offset: number;
  /** Mean step height of the inliers, in levels. */
  step: number;
  /** Mean flank score of the inliers, 0-1. See FLANK_FULL. */
  flank: number;
  /** Whether this side needed the wide second pass. */
  widened: boolean;
}

export interface CornerRefineResult {
  quad: Quad;
  /** Per side, in the quad's own side order: side s runs corner s → s+1. */
  sides: [SideFit, SideFit, SideFit, SideFit];
  /** Per side support, 0-1 — the short form the ScanResult carries. */
  support: [number, number, number, number];
  /** How far each corner moved, in pixels. */
  moved: [number, number, number, number];
  /** Sides left as the detector had them. */
  skipped: number;
  /** The band used for the first pass, in raster pixels. */
  band: number;
  /** Which guard, if any, vetoed a refined side. */
  vetoed: null | 'move' | 'convex' | 'angle' | 'aspect';
}

export interface CornerRefineOptions {
  /** Long/short of the document, when the member has told us the shape. */
  expectAspect?: number;
  /** Override the band, in raster pixels. Tests and the harness only. */
  band?: number;
}

// ── sampling ────────────────────────────────────────────────────────

function at(g: Gray, x: number, y: number): number {
  const cx = Math.min(g.width - 1, Math.max(0, x));
  const cy = Math.min(g.height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const a = g.data[y0 * g.width + x0] * (1 - tx) + g.data[y0 * g.width + x1] * tx;
  const b = g.data[y1 * g.width + x0] * (1 - tx) + g.data[y1 * g.width + x1] * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Total least squares by PCA.
 *
 * ⚠️ TLS, NOT LEAST SQUARES IN y. A vertical edge has infinite slope in y-on-x
 * and the ordinary fit blows up on exactly the two sides of a portrait
 * document. PCA has no preferred axis. (The same twenty lines live privately in
 * refine-edges.ts and magnetic.ts. Both are on paths other people are editing;
 * a fourth copy is cheaper than a merge conflict on the capture path.)
 */
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
  const t = (sxx + syy) / 2;
  const d = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  let nx = sxy;
  let ny = t - d - sxx;
  const len = Math.hypot(nx, ny);
  if (len < 1e-9) {
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
  return { nx, ny, c: nx * mx + ny * my };
}

function sideLine(quad: Quad, s: number): Line {
  const a = quad[s];
  const b = quad[(s + 1) % 4];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return { nx, ny, c: nx * a.x + ny * a.y };
}

interface Candidate {
  /** Signed perpendicular offset from the input edge, in pixels. */
  off: number;
  /** Step height in levels. */
  mag: number;
  /** Which way the intensity went across it. */
  sign: number;
  /**
   * 0-1. How much this step looks like the document's own boundary: it is a
   * boundary at all, AND the side of it facing the document reads like the
   * document's interior. See FLANK_FULL.
   */
  flank: number;
}

/**
 * The document's own interior tone, in levels.
 *
 * A median over a grid across the middle 60% of the quad, so print, a
 * photograph on an ID, a signature or a stamp are all outvoted by the paper
 * around them, and so a quad that is thirty pixels out still samples nothing
 * but document. Median, not mean, for exactly that reason.
 *
 * ⚠️ THE GRID IS SKEWED BY THE GOLDEN RATIO, AND IT HAS TO BE. A plain 11x11
 * grid over a 500px page steps 30px, and ruled or typeset print repeats on a
 * pitch of its own — 20px in the regression fixture. When the two are
 * commensurate the grid samples the SAME PHASE every row, and six of eleven
 * rows landed in ink: the reference came back 64 instead of 228 and every
 * flank test downstream inverted. An irrational stride cannot resonate with
 * any print pitch.
 */
function interiorRef(g: Gray, quad: Quad): number {
  const vals: number[] = [];
  const N = 15;
  const PHI = 0.6180339887;
  for (let i = 0; i < N; i++) {
    const v = 0.2 + 0.6 * (((i + 0.5) / N + PHI * i) % 1);
    for (let j = 0; j < N; j++) {
      const u = 0.2 + 0.6 * (((j + 0.5) / N + PHI * j) % 1);
      // Bilinear across the quad's corners — good enough for a tone reference,
      // and it needs no homography.
      const top = { x: lerp(quad[0].x, quad[1].x, u), y: lerp(quad[0].y, quad[1].y, u) };
      const bot = { x: lerp(quad[3].x, quad[2].x, u), y: lerp(quad[3].y, quad[2].y, u) };
      vals.push(at(g, lerp(top.x, bot.x, v), lerp(top.y, bot.y, v)));
    }
  }
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The steps crossing one perpendicular profile, nearest to the input edge
 * first.
 *
 * `span` widens BOTH the difference the gradient is taken over and the lateral
 * average along the edge, and both are scaled with the raster. At 3000px a
 * photographed paper edge is not a one-pixel step — lens blur, sensor AA and
 * JPEG spread it over three or four — so a one-pixel central difference reads a
 * 78-level edge as 25 and MIN_STEP starts refusing real edges. Averaging three
 * samples ALONG the edge costs nothing and removes most of the paper texture
 * that would otherwise emit spurious local maxima.
 */
function profileSteps(
  g: Gray,
  px: number,
  py: number,
  nx: number,
  ny: number,
  ux: number,
  uy: number,
  band: number,
  span: number,
  inward: number,
  inner: number,
): Candidate[] {
  const steps = Math.round(band / PITCH);
  const n = 2 * steps + 1;
  const lum: number[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const o = (k - steps) * PITCH;
    const x = px + nx * o;
    const y = py + ny * o;
    lum[k] =
      (at(g, x - ux * span, y - uy * span) +
        at(g, x, y) +
        at(g, x + ux * span, y + uy * span)) /
      3;
  }

  const step = Math.max(1, Math.round(span / PITCH));
  const grad: number[] = new Array(n).fill(0);
  for (let k = step; k < n - step; k++) grad[k] = lum[k + step] - lum[k - step];

  const flankGap = Math.round((span + FLANK_GAP) / PITCH);
  const flankLen = Math.round((FLANK_SPAN * span) / PITCH);
  const buf: number[] = [];
  // ⚠️ MEDIAN, NOT MEAN, AND OVER A LONG SPAN. Measured over 8px as a mean, the
  // BOTTOM EDGE OF A 5px LINE OF PRINT read as a perfect document boundary —
  // ink on one side, paper matching the interior on the other — and scored
  // 0.94 where the true page edge scored 1.0. Nothing in an 8px window can
  // tell that block from the desk. A median over ~12px (scaled with the
  // raster) sees past any thin structure: three ink samples in twelve leave
  // the median on paper, so print collapses to a boundary of ~0, while the
  // desk outside a real page edge is a median all the way out.
  const flankMedian = (k: number, dir: number): number | null => {
    buf.length = 0;
    for (let d = flankGap; d < flankGap + flankLen; d++) {
      const kk = k + dir * d;
      if (kk >= 0 && kk < n) buf.push(lum[kk]);
    }
    if (buf.length < flankLen / 2) return null;
    buf.sort((p, q) => p - q);
    return buf[buf.length >> 1];
  };
  const flankAt = (k: number): number => {
    // `inward` is +1 when the profile's +n direction points into the document,
    // so "inside" is always the document side of the candidate whatever the
    // winding of the quad.
    const inM = flankMedian(k, inward);
    const outM = flankMedian(k, -inward);
    if (inM === null || outM === null) return 0;
    const boundary = Math.min(1, Math.abs(inM - outM) / FLANK_FULL);
    const match = 1 - Math.min(1, Math.abs(inM - inner) / MATCH_FULL);
    return boundary * match;
  };

  const out: Candidate[] = [];
  for (let k = step + 1; k < n - step - 1; k++) {
    const m = Math.abs(grad[k]);
    if (m < MIN_STEP) continue;
    // Local maximum, so one wide step contributes one candidate rather than
    // six. Ties broken to the left so a plateau does not emit two.
    if (m < Math.abs(grad[k - 1]) || m <= Math.abs(grad[k + 1])) continue;
    // ⚠️ THE CENTROID OF THE PEAK, NOT THE SAMPLE IT WAS FOUND AT. The
    // gradient is taken over ±span pixels, so a step that is genuinely 3px wide
    // produces a PLATEAU several samples long and the local-maximum test lands
    // on whichever end of it floating-point noise put first. That is a ±2px
    // wobble between neighbouring profiles, which is the whole 2px inlier band:
    // measured, it cost two of four sides their support on a 3000px raster and
    // nothing at 1536px, i.e. it looked like a resolution bug and was not.
    let lo = k;
    let hi = k;
    const thr = m * 0.7;
    while (lo - 1 > 0 && Math.abs(grad[lo - 1]) >= thr) lo--;
    while (hi + 1 < n - 1 && Math.abs(grad[hi + 1]) >= thr) hi++;
    let wsum = 0;
    let psum = 0;
    for (let t = lo; t <= hi; t++) {
      const w = Math.abs(grad[t]);
      wsum += w;
      psum += w * t;
    }
    const kc = wsum > 0 ? psum / wsum : k;
    out.push({ off: (kc - steps) * PITCH, mag: m, sign: Math.sign(grad[k]), flank: 0 });
  }
  // NEAREST FIRST, then truncate. Keeping the strongest six instead would drop
  // a faint paper edge in favour of six lines of print — the failure
  // refine-edges.ts documented and this file inherits. The flanks are measured
  // only on the survivors: it is the expensive half of this function and a busy
  // band can offer forty candidates.
  out.sort((p, q) => Math.abs(p.off) - Math.abs(q.off));
  const kept = out.slice(0, MAX_CANDIDATES);
  for (const c of kept) c.flank = flankAt(Math.round(c.off / PITCH) + steps);
  return kept;
}

// ── one side ────────────────────────────────────────────────────────

interface Consensus {
  line: Line;
  support: number;
  offset: number;
  step: number;
  flank: number;
  score: number;
}

function consensus(
  bases: Pt[],
  cands: Candidate[][],
  nx: number,
  ny: number,
  sign: number,
  predict: (k: number) => number,
  band: number,
): Consensus | null {
  const gather = (want: (k: number) => number) => {
    const pts: Pt[] = [];
    const offs: number[] = [];
    let mag = 0;
    let flank = 0;
    for (let k = 0; k < PROFILES; k++) {
      let best: Candidate | null = null;
      let bestD = INLIER_PX;
      for (const c of cands[k]) {
        if (c.sign !== sign) continue;
        const d = Math.abs(c.off - want(k));
        if (d <= bestD) {
          bestD = d;
          best = c;
        }
      }
      if (!best) continue;
      pts.push({ x: bases[k].x + nx * best.off, y: bases[k].y + ny * best.off });
      offs.push(best.off);
      mag += best.mag;
      flank += best.flank;
    }
    return { pts, offs, mag, flank };
  };

  let got = gather(predict);
  if (got.pts.length < PROFILES * MIN_SUPPORT) return null;
  let line = fitLine(got.pts);
  if (!line) return null;

  // One refit pass. The seed pair fixes the slope from two measurements; the
  // refit fixes it from thirty-five, which is what makes the answer independent
  // of which pair happened to seed it.
  const den = line.nx * nx + line.ny * ny;
  if (Math.abs(den) > 0.5) {
    const fitted = line;
    const again = gather((k) => {
      const p = bases[k];
      return (fitted.c - (fitted.nx * p.x + fitted.ny * p.y)) / den;
    });
    if (again.pts.length >= got.pts.length) {
      const refit = fitLine(again.pts);
      if (refit) {
        got = again;
        line = refit;
      }
    }
  }

  const support = got.pts.length / PROFILES;
  if (support < MIN_SUPPORT) return null;

  const sorted = [...got.offs].sort((p, q) => p - q);
  const offset = sorted[sorted.length >> 1];
  const step = got.mag / got.pts.length;
  const flank = got.flank / got.pts.length;
  if (flank < FLANK_MIN) return null;
  const prox = Math.max(0, 1 - Math.abs(offset) / band);
  // ⚠️ THE 0.35 FLOORS ARE DELIBERATE, on both terms. Without them a faint but
  // perfectly straight paper edge — which is what a white document on a light
  // desk actually is — scores near zero and loses to anything darker anywhere
  // in the band. They cap the penalty at ~3x rather than making it decisive.
  const score =
    support *
    (0.35 + 0.65 * Math.min(1, step / 255)) *
    (0.35 + 0.65 * flank) *
    prox ** PROX_POWER;

  return { line, support, offset, step, flank, score };
}

/**
 * Fit one side of the quad.
 *
 * ⚠️ EXHAUSTIVE OVER SEED PAIRS, NOT RANDOM SAMPLING. Textbook RANSAC draws
 * random pairs, and this runs once per capture on a still that never changes —
 * so the same photograph must produce the same crop every time it is opened,
 * and a random seed cannot promise that. One end from the first third of the
 * span and one from the last, so every hypothesis has a long baseline: two
 * candidates a pixel apart define a slope of anything. The cost is bounded by
 * MAX_CANDIDATES (6) squared times SEED_PROFILES (8) squared — see the note at
 * the loop for what that stride is paying for — and comes to about 10ms a side
 * on a 4032x3024 still.
 */
function fitSide(
  g: Gray,
  quad: Quad,
  s: number,
  band: number,
  span: number,
  inner: number,
): Consensus | null {
  const a = quad[s];
  const b = quad[(s + 1) % 4];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  // Below about ten pixels there is no span to fit a direction along, and the
  // "line" would be whatever the noise at one point suggested.
  if (!(len >= 10) || !(band > 0)) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  // Which way is into the document. Derived from the centroid rather than
  // assumed from the winding, so a quad that arrives wound either way still
  // gets its flanks the right way round.
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const mid = { x: a.x + dx / 2, y: a.y + dy / 2 };
  const inward = nx * (cx - mid.x) + ny * (cy - mid.y) >= 0 ? 1 : -1;

  const bases: Pt[] = [];
  const cands: Candidate[][] = [];
  for (let i = 0; i < PROFILES; i++) {
    const t = TRIM + ((1 - 2 * TRIM) * i) / (PROFILES - 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    bases.push({ x: px, y: py });
    cands.push(profileSteps(g, px, py, nx, ny, ux, uy, band, span, inward, inner));
  }

  const third = Math.max(1, Math.floor(PROFILES / 3));
  // ⚠️ SEEDS ARE STRIDED, INLIERS ARE NOT. Every profile still votes; this only
  // thins the profiles a hypothesis may be BUILT from. Measured: seeding from
  // all 21 profiles in each third is 126 candidates a side squared — 15,876
  // hypotheses — and cost 122ms median on a 2048px still, so the whole budget
  // was gone before the raster even grew. A hypothesis only has to be roughly
  // right, since consensus() re-fits it from all its inliers, so eight starting
  // points at each end find the same line as twenty-one: 22ms median, and the
  // refined quad is unchanged to under a pixel on all eighteen fixtures.
  const stride = Math.max(1, Math.ceil(third / SEED_PROFILES));
  let best: Consensus | null = null;
  for (let i = 0; i < third; i += stride) {
    for (const ci of cands[i]) {
      for (let j = PROFILES - third; j < PROFILES; j += stride) {
        for (const cj of cands[j]) {
          if (ci.sign !== cj.sign) continue;
          const slope = (cj.off - ci.off) / (j - i);
          const got = consensus(
            bases,
            cands,
            nx,
            ny,
            ci.sign,
            (k) => ci.off + slope * (k - i),
            band,
          );
          if (got && (!best || got.score > best.score)) best = got;
        }
      }
    }
  }
  return best;
}

// ── the whole quad ──────────────────────────────────────────────────

function cornersFrom(lines: (Line | null)[], quad: Quad): Pt[] {
  const final: Line[] = [0, 1, 2, 3].map((s) => lines[s] ?? sideLine(quad, s));
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    // Corner i is where side (i-1) meets side i.
    const p = intersectLines(final[(i + 3) % 4], final[i]);
    out.push(p ?? quad[i]);
  }
  return out;
}

function ratioOf(q: Quad | Pt[]): number {
  const d = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const w = Math.max(d(q[0], q[1]), d(q[3], q[2]));
  const h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  return Math.max(w, h) / Math.max(1e-6, Math.min(w, h));
}

/**
 * Snap a detected quad onto the document's real edges, at full resolution.
 *
 * Returns the input unchanged (with `skipped: 4`) when nothing can be improved.
 * Every side is independent: a partial refinement is still an improvement,
 * which is what lets a document running off the edge of the photograph gain
 * three good sides instead of none.
 */
export function refineCorners(
  g: Gray,
  quad: Quad,
  opts: CornerRefineOptions = {},
): CornerRefineResult {
  let shortSide = Infinity;
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    shortSide = Math.min(shortSide, Math.hypot(b.x - a.x, b.y - a.y));
  }
  const rasterShort = Math.min(g.width, g.height);
  const band =
    opts.band ??
    Math.max(
      8,
      Math.round(
        Math.min(
          Math.max(BAND_MIN, Math.min(BAND_MAX, rasterShort * BAND_FRAC)),
          shortSide * BAND_QUAD_CAP,
        ),
      ),
    );
  // The gradient/lateral span, scaled with the raster. 1px below ~1800px on the
  // short edge, 3px on a 3024px iPhone still — see profileSteps.
  const span = Math.max(1, Math.min(4, Math.round(rasterShort / 1200)));

  const inner = interiorRef(g, quad);
  const fits: (Consensus | null)[] = [];
  const widened: boolean[] = [false, false, false, false];
  for (let s = 0; s < 4; s++) fits.push(fitSide(g, quad, s, band, span, inner));

  // ⚠️ ONE WIDER PASS, ONLY FOR THE SIDES THAT FOUND NOTHING. The commonest
  // reason a side finds nothing is that the true edge is further out than the
  // band reached — the model's corner error is not symmetric across a capture,
  // and one side is routinely twice as wrong as the other three. Doubling for
  // everything would be the wrong trade: a wide band is more chances to be
  // wrong, and the three sides that already agreed have nothing to gain.
  const wide = Math.min(BAND_MAX * 2, Math.round(band * 2));
  if (wide > band) {
    for (let s = 0; s < 4; s++) {
      if (fits[s]) continue;
      const again = fitSide(g, quad, s, wide, span, inner);
      if (again) {
        fits[s] = again;
        widened[s] = true;
      }
    }
  }

  const lines: (Line | null)[] = fits.map((f) => f?.line ?? null);
  const moveCap = band * MOVE_CAP;
  const wideCap = wide * MOVE_CAP;

  // ── the guards ────────────────────────────────────────────────────
  //
  // ⚠️ THEY DROP THE WEAKEST SIDE, THEY DO NOT THROW THE ANSWER AWAY. Three
  // good sides and one that snapped onto a table edge is the common failure,
  // and discarding all four for it would hand back the model's quad complete
  // with the thirty pixels this function exists to remove. So on a veto the
  // least-supported refined side goes back to the detector's line and the
  // corners are recomputed — at most four times, which is once per side.
  let vetoed: CornerRefineResult['vetoed'] = null;
  let out = cornersFrom(lines, quad);
  const inRatio = ratioOf(quad);
  for (let guard = 0; guard < 4; guard++) {
    let why: CornerRefineResult['vetoed'] = null;
    for (let i = 0; i < 4; i++) {
      const cap = widened[i] || widened[(i + 3) % 4] ? wideCap : moveCap;
      if (Math.hypot(out[i].x - quad[i].x, out[i].y - quad[i].y) > cap) why = 'move';
    }
    const q = out as Quad;
    if (!why && !isConvex(q)) why = 'convex';
    if (!why && minInteriorAngle(q) < MIN_ANGLE) why = 'angle';
    if (!why && opts.expectAspect) {
      // ⚠️ DEVIATION FROM "WITHIN 8% OF THE EXPECTED RATIO", DELIBERATE. A quad
      // photographed at an angle does not measure its document's ratio: an A4
      // shot from 30° off-axis measures 1.28 against 1.414, which is 9.4% out
      // before anything is refined. Vetoing on the absolute number alone would
      // refuse good refinements of exactly the skewed captures this exists for.
      // So the guard fires only when the refined quad is BOTH outside the
      // tolerance AND further out than the quad it started from — it can stop
      // this function making the shape worse, and never blames it for
      // perspective it inherited.
      const err = Math.abs(ratioOf(out) - opts.expectAspect) / opts.expectAspect;
      const was = Math.abs(inRatio - opts.expectAspect) / opts.expectAspect;
      if (err > ASPECT_TOL && err > was + 1e-6) why = 'aspect';
    }
    if (!why) break;
    vetoed = why;
    let worst = -1;
    let worstSupport = Infinity;
    for (let s = 0; s < 4; s++) {
      if (!lines[s]) continue;
      const sup = fits[s]?.support ?? 0;
      if (sup < worstSupport) {
        worstSupport = sup;
        worst = s;
      }
    }
    if (worst < 0) {
      // Nothing left to drop: hand back exactly what came in.
      out = quad.map((p) => ({ x: p.x, y: p.y }));
      break;
    }
    lines[worst] = null;
    out = cornersFrom(lines, quad);
  }

  const sides = [0, 1, 2, 3].map((s) => {
    const f = lines[s] ? fits[s] : null;
    return {
      line: lines[s],
      support: f?.support ?? 0,
      offset: f?.offset ?? 0,
      step: f?.step ?? 0,
      flank: f?.flank ?? 0,
      widened: lines[s] ? widened[s] : false,
    } as SideFit;
  }) as [SideFit, SideFit, SideFit, SideFit];

  return {
    quad: out as Quad,
    sides,
    support: sides.map((f) => f.support) as [number, number, number, number],
    moved: out.map((p, i) => Math.hypot(p.x - quad[i].x, p.y - quad[i].y)) as [
      number,
      number,
      number,
      number,
    ],
    skipped: lines.filter((l) => !l).length,
    band,
    vetoed,
  };
}

