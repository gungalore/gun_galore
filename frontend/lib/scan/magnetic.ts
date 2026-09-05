import { dist, type Pt, type Quad } from './geometry';

// ────────────────────────────────────────────────────────────────────
// MAGNETIC LINES FOR THE MANUAL CROP EDITOR.
//
// The member drags a corner or an edge handle and lets go. If a strong,
// straight document edge is sitting within a few pixels of where they dropped
// it, the handle jumps onto it. While they drag, the candidate lines are drawn
// faintly, so nothing about the jump is a surprise.
//
// ⚠️ THIS IS NOT DETECTION AND MUST NEVER BECOME IT. detect.ts hunts
// rectangles across a whole frame and its own skipped regression records what
// that costs on a real licence card: "the card is never a CANDIDATE at all",
// because seeds land on the mat and growQuad walks out to the outermost ridge.
// Nothing in the image says which of two nested rectangles is the document.
//
// Here the member has already said. They have put the handle within a
// thumb's width of the edge they mean, so the search is one narrow band around
// ONE line they drew, and the answer only has to beat the other things inside
// that band. That is a question with an answer; "which rectangle is the
// document" is not.
//
// ⚠️ NEAREST-AND-STRONG, NOT STRONGEST. refine-edges.ts already paid for this
// lesson at full resolution: widen a band far enough to reach the true edge
// and you also bring PRINT into it, and print is the stronger step (ink on
// paper measures 64 against 228; the paper's own border against a desk
// measures 138 against 228). The same holds for the thing this editor is most
// often used near — a ruler, a phone, a dark table edge lying a centimetre
// outside the page. So proximity is squared into the score below, and the
// numbers behind that are written out at PROX_POWER.
//
// Everything except lumaFromBlob is pure: buffers in, numbers out, so it runs
// in a test with no phone and no DOM.
// ────────────────────────────────────────────────────────────────────

/** A single-channel raster. Structurally the same as detect.ts's `Gray`. */
export interface LumaRaster {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * A downscaled luma copy of a capture, plus how much it was shrunk.
 *
 * `scale` is MEASURED, not requested: image pixels times `scale` are luma
 * pixels. Rounding the target width to a whole pixel moves the true ratio by
 * up to half a pixel in a thousand, which is nothing on its own and is
 * something once a corner is multiplied back up at the far end.
 */
export interface Luma extends LumaRaster {
  scale: number;
}

/**
 * A fitted straight edge, in the raster's own pixels.
 *
 * `nx*x + ny*y = c` with a unit normal, matching the form refine-edges.ts and
 * detect.ts already use, so the intersection maths is the same everywhere.
 * `a` and `b` are the fitted line clipped to the span of the quad edge it came
 * from — purely so the editor has something to draw without redoing the maths.
 */
export interface MagneticLine {
  nx: number;
  ny: number;
  c: number;
  /** 0-1. Support, step strength and proximity, combined — see `score`. */
  strength: number;
  /** Share of profiles that voted for this line, 0-1. */
  support: number;
  /** Signed perpendicular offset from the quad edge, in raster pixels. */
  offset: number;
  a: Pt;
  b: Pt;
}

// ── the tuned numbers, and what each one is paying for ───────────────

/**
 * Profiles taken across the middle 80% of the edge.
 *
 * The ends are dropped for the reason every rung of this pipeline drops them:
 * near a corner the paper's arc curves away from the line, and those samples
 * tilt the fit inward. 24 is enough that the 60% support floor still means
 * fifteen separate agreeing measurements.
 */
export const PROFILES = 24;

/** Fraction of the edge ignored at EACH end. */
export const TRIM = 0.1;

/**
 * A step must be at least this many levels to count as a candidate.
 *
 * The same 12 refine-edges.ts uses. A grey desk against white paper measures
 * about 78 levels and a black ruler on the same desk about 110, so 12 is far
 * below anything real and far above sensor noise on a lit document (measured
 * peak-to-peak on flat paper: 4-6 levels).
 */
export const MIN_STEP = 12;

/** How far a candidate may sit from the hypothesised line and still vote. */
export const INLIER_PX = 1.5;

/**
 * The support floor. Below this the fit is refused outright and the handle
 * stays exactly where the member put it.
 *
 * ⚠️ A SNAP THAT IS WRONG IS WORSE THAN NO SNAP. The member dropped the corner
 * where they meant it; moving it somewhere else on weak evidence takes work
 * away from them and does it silently. Refusing costs them nothing they were
 * not already paying.
 */
export const MIN_SUPPORT = 0.6;

/** Candidate steps kept per profile, nearest first. */
const MAX_CANDIDATES = 4;

/**
 * How hard proximity outranks strength.
 *
 * ⚠️ WITHOUT THIS THE RULER WINS. Worked through on the numbers above: a page
 * edge 6px from the dropped handle scores (0.35 + 0.65 x 78/255) = 0.549 on
 * strength; a black ruler 9px out scores 0.630 — 1.15x more. Linear proximity
 * (0.82 against 0.73) does not close that gap and the snap lands on the ruler.
 * Squaring it does: the ruler now has to be nearer than 6.9px as well as
 * darker, which at 15mm off the page it is not.
 */
const PROX_POWER = 2;

/** Sampling pitch along the profile. Half-pixel, so a step lands sub-pixel. */
const PITCH = 0.5;

// ── decoding ────────────────────────────────────────────────────────

/**
 * Decode a capture and hand back a downscaled luma buffer.
 *
 * The editor works on a downscale for one reason: a 4000px capture would make
 * every drag-frame's line fit cost sixteen times what it needs to, and an edge
 * is an edge at 1200px. `maxEdge` is the LONG side; a portrait A4 photograph
 * comes back about 900x1200.
 *
 * ⚠️ BROWSER ONLY. It throws rather than returning null so a caller cannot
 * accidentally treat "no decoder here" as "no document here".
 */
export async function lumaFromBlob(blob: Blob, maxEdge = 1200): Promise<Luma> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('lumaFromBlob needs a browser with createImageBitmap');
  }
  const bmp = await createImageBitmap(blob);
  try {
    const long = Math.max(bmp.width, bmp.height);
    const want = long > maxEdge ? maxEdge / long : 1;
    const w = Math.max(1, Math.round(bmp.width * want));
    const h = Math.max(1, Math.round(bmp.height * want));
    const ctx = context2d(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h);
    // Rec. 601, integer — byte-identical to detect.ts's toLuma, so a quad
    // measured against one buffer means the same thing against the other.
    for (let i = 0, p = 0; p < data.length; i += 4, p++) {
      data[p] = (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8;
    }
    return { data, width: w, height: h, scale: w / bmp.width };
  } finally {
    bmp.close?.();
  }
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function context2d(w: number, h: number): Ctx2D {
  // willReadFrequently, because getImageData on a GPU-backed canvas otherwise
  // stalls the pipeline for a readback we make exactly once per capture.
  if (typeof OffscreenCanvas === 'function') {
    const ctx = new OffscreenCanvas(w, h).getContext('2d', {
      willReadFrequently: true,
    });
    if (ctx) return ctx as OffscreenCanvasRenderingContext2D;
  }
  if (typeof document === 'undefined') {
    throw new Error('lumaFromBlob needs a canvas');
  }
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('lumaFromBlob could not get a 2d context');
  return ctx;
}

// ── coordinate helpers, so the caller never guesses the direction ────

/** Image pixels to raster pixels. */
export function toLumaPt(p: Pt, scale: number): Pt {
  return { x: p.x * scale, y: p.y * scale };
}

/** Raster pixels back to image pixels. */
export function fromLumaPt(p: Pt, scale: number): Pt {
  return { x: p.x / scale, y: p.y / scale };
}

export function toLumaQuad(q: Quad, scale: number): Quad {
  return q.map((p) => toLumaPt(p, scale)) as Quad;
}

/**
 * The search band, in raster pixels.
 *
 * 3% of the SHORT edge, because that is the dimension a document is framed
 * against on a phone held the natural way round, clamped so it stays a
 * thumb-sized correction rather than a search: below 8px a snap cannot reach
 * past the member's own aiming error, and above 40px it stops being a snap and
 * starts being a detector that moves corners the member did not ask it to.
 */
export function magneticBand(raster: LumaRaster): number {
  const short = Math.min(raster.width, raster.height);
  return Math.max(8, Math.min(40, Math.round(short * 0.03)));
}

// ── the raster ──────────────────────────────────────────────────────

function sample(g: LumaRaster, x: number, y: number): number {
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
 * document. PCA has no preferred axis.
 *
 * Written out here rather than imported from refine-edges.ts, where the same
 * twenty lines live privately: that file is on the full-resolution warp path
 * and is being edited elsewhere, and widening its API for a second caller is
 * not worth a merge conflict on the money path.
 */
function fitLine(pts: Pt[]): { nx: number; ny: number; c: number } | null {
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

/** Where two lines cross, or null when they are parallel. */
export function intersectLines(
  a: { nx: number; ny: number; c: number },
  b: { nx: number; ny: number; c: number },
): Pt | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (a.c * b.ny - a.ny * b.c) / det,
    y: (a.nx * b.c - a.c * b.nx) / det,
  };
}

/** The nearest point on a line to `p`. */
function projectOnto(p: Pt, l: { nx: number; ny: number; c: number }): Pt {
  const k = l.nx * p.x + l.ny * p.y - l.c;
  return { x: p.x - l.nx * k, y: p.y - l.ny * k };
}

// ── the search ──────────────────────────────────────────────────────

interface Candidate {
  /** Signed perpendicular offset from the quad edge, raster pixels. */
  off: number;
  /** Step height in levels. */
  mag: number;
  /** Which way the intensity went. A page edge and a ruler differ here. */
  sign: number;
}

/**
 * Candidate straight edges within `band` pixels of one side of `quad`.
 *
 * `edge` is 0-3, the side running from corner `edge` to corner `edge + 1`.
 * Everything — quad, band, returned lines — is in the raster's own pixels; use
 * `toLumaQuad` / `fromLumaPt` to cross the boundary.
 *
 * At most two lines come back, strongest first, and a plain surface returns
 * none. That is the point: a function that always answers would move corners
 * off blank desk.
 */
export function edgeLinesNear(
  raster: LumaRaster,
  quad: Quad,
  edge: number,
  band: number,
): MagneticLine[] {
  const i0 = ((edge % 4) + 4) % 4;
  const a = quad[i0];
  const b = quad[(i0 + 1) % 4];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  // Below about ten pixels there is no span to fit a direction along, and the
  // "line" would be whatever the noise at one point suggested.
  if (!(len >= 10) || !(band > 0)) return [];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const bases: Pt[] = [];
  const cands: Candidate[][] = [];
  for (let i = 0; i < PROFILES; i++) {
    const t = TRIM + ((1 - 2 * TRIM) * i) / (PROFILES - 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    bases.push({ x: px, y: py });
    cands.push(profile(raster, px, py, nx, ny, band));
  }

  const lines: MagneticLine[] = [];
  const used: Array<{ off: number; ang: number }> = [];

  // ⚠️ EXHAUSTIVE PAIRS, NOT RANDOM SAMPLING. This runs on pointer-up and
  // once a frame while dragging, so it has to give the SAME answer twice for
  // the same quad — a snap that lands somewhere else on a second identical
  // drag reads as a bug even when both answers are defensible. One end from
  // the first third and one from the last, so every hypothesis has a long
  // baseline: two candidates a pixel apart define a slope of anything.
  const third = Math.max(1, Math.floor(PROFILES / 3));
  for (let pass = 0; pass < 2; pass++) {
    let best: MagneticLine | null = null;
    let bestScore = 0;
    for (let i = 0; i < third; i++) {
      for (const ci of cands[i]) {
        for (let j = PROFILES - third; j < PROFILES; j++) {
          for (const cj of cands[j]) {
            if (ci.sign !== cj.sign) continue;
            const slope = (cj.off - ci.off) / (j - i);
            const fitted = consensus(
              bases,
              cands,
              nx,
              ny,
              ci.sign,
              (k) => ci.off + slope * (k - i),
              band,
            );
            if (!fitted) continue;
            if (
              used.some(
                (u) =>
                  Math.abs(u.off - fitted.offset) < INLIER_PX * 2 &&
                  Math.abs(u.ang - Math.atan2(fitted.ny, fitted.nx)) < 0.05,
              )
            ) {
              continue;
            }
            if (fitted.strength > bestScore) {
              bestScore = fitted.strength;
              best = fitted;
            }
          }
        }
      }
    }
    if (!best) break;
    // Endpoints are only for drawing: the fitted line dropped onto the span
    // the member's own edge covers, so the hint sits over the document rather
    // than running off across the photograph.
    best.a = projectOnto(a, best);
    best.b = projectOnto(b, best);
    lines.push(best);
    used.push({ off: best.offset, ang: Math.atan2(best.ny, best.nx) });
  }
  return lines;
}

/** Steps along one perpendicular profile, nearest to the quad edge first. */
function profile(
  raster: LumaRaster,
  px: number,
  py: number,
  nx: number,
  ny: number,
  band: number,
): Candidate[] {
  const steps = Math.round(band / PITCH);
  const grad: number[] = [];
  for (let k = -steps; k <= steps; k++) {
    const o = k * PITCH;
    // A signed central difference over one whole pixel. Over half a pixel it
    // reads a hard step at half height and MIN_STEP would have to halve too,
    // which lets sensor noise in.
    grad.push(
      sample(raster, px + nx * (o + 0.5), py + ny * (o + 0.5)) -
        sample(raster, px + nx * (o - 0.5), py + ny * (o - 0.5)),
    );
  }
  const out: Candidate[] = [];
  for (let k = 1; k < grad.length - 1; k++) {
    const m = Math.abs(grad[k]);
    if (m < MIN_STEP) continue;
    // Local maximum, so a single wide step contributes one candidate rather
    // than six. Ties broken to the left so a plateau does not emit two.
    if (m < Math.abs(grad[k - 1]) || m <= Math.abs(grad[k + 1])) continue;
    out.push({
      off: (k - steps) * PITCH,
      mag: m,
      sign: Math.sign(grad[k]),
    });
  }
  // NEAREST FIRST, then truncate — see the header. Keeping the strongest four
  // instead would drop a paper edge in favour of four lines of print.
  out.sort((p, q) => Math.abs(p.off) - Math.abs(q.off));
  return out.slice(0, MAX_CANDIDATES);
}

/**
 * Count the profiles that agree with a hypothesis, refit on those, and score.
 *
 * Returns null below `MIN_SUPPORT` — the whole function exists to be able to
 * say no.
 */
function consensus(
  bases: Pt[],
  cands: Candidate[][],
  nx: number,
  ny: number,
  sign: number,
  predict: (k: number) => number,
  band: number,
): MagneticLine | null {
  const pick = (k: number, want: number): Candidate | null => {
    let best: Candidate | null = null;
    let bestD = INLIER_PX;
    for (const c of cands[k]) {
      if (c.sign !== sign) continue;
      const d = Math.abs(c.off - want);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  const gather = (want: (k: number) => number) => {
    const pts: Pt[] = [];
    const offs: number[] = [];
    let mag = 0;
    for (let k = 0; k < PROFILES; k++) {
      const c = pick(k, want(k));
      if (!c) continue;
      pts.push({ x: bases[k].x + nx * c.off, y: bases[k].y + ny * c.off });
      offs.push(c.off);
      mag += c.mag;
    }
    return { pts, offs, mag };
  };

  let got = gather(predict);
  if (got.pts.length < PROFILES * MIN_SUPPORT) return null;

  // One refit pass. The seed pair fixes the slope from two measurements; the
  // refit fixes it from fifteen, which is what makes a snap land on the same
  // sub-pixel whichever pair happened to seed it.
  let line = fitLine(got.pts);
  if (!line) return null;
  // Where the fitted line crosses profile k, expressed as an offset along the
  // profile direction — solving n·(base + u·o) = c for o.
  const den = line.nx * nx + line.ny * ny;
  const fitted = line;
  const perp = (k: number) => {
    const p = bases[k];
    return (fitted.c - (fitted.nx * p.x + fitted.ny * p.y)) / den;
  };
  // Only re-gather when the fitted line is not running ALONG the profiles —
  // otherwise the division above is unstable, and a fit that parallel is not
  // the edge we were looking for anyway.
  if (Math.abs(den) > 0.5) {
    const again = gather(perp);
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
  const meanMag = got.mag / got.pts.length;
  const prox = Math.max(0, 1 - Math.abs(offset) / band);
  // ⚠️ THE 0.35 FLOOR IS DELIBERATE. Without it a faint but perfectly straight
  // paper edge — which is what a white document on a light desk actually is —
  // scores near zero and loses to anything darker anywhere in the band.
  const strength =
    support * (0.35 + 0.65 * Math.min(1, meanMag / 255)) * prox ** PROX_POWER;

  return {
    nx: line.nx,
    ny: line.ny,
    c: line.c,
    strength,
    support,
    offset,
    a: { x: 0, y: 0 },
    b: { x: 0, y: 0 },
  };
}

// ── what the editor actually calls ──────────────────────────────────

/**
 * Where the corner would land if it snapped: the crossing of the best line
 * found for each of the two sides that meet there.
 *
 * ⚠️ TWO EDGES INTERSECTED, NEVER A CORNER HUNTED DIRECTLY. refine-edges.ts
 * makes the argument in full: a cornerSubPix-family search near a rounded
 * document corner locks onto the ARC, which is the strongest local structure
 * there, and pulls the corner inward onto it. The true corner is not on the
 * document at all — it is where two straight edges would have met.
 *
 * Returns null when either side is unconvincing, or when the crossing is more
 * than `band` away: past that it is not the edge the member was aiming at.
 */
export function snapCorner(
  raster: LumaRaster,
  quad: Quad,
  corner: number,
  band: number,
): Pt | null {
  const i = ((corner % 4) + 4) % 4;
  const before = edgeLinesNear(raster, quad, (i + 3) % 4, band)[0];
  const after = edgeLinesNear(raster, quad, i, band)[0];
  if (!before || !after) return null;
  const p = intersectLines(before, after);
  if (!p) return null;
  if (dist(p, quad[i]) > band) return null;
  return p;
}

/**
 * Both corners of one side, moved onto the best line for that side.
 *
 * Each corner SLIDES ALONG ITS OTHER EDGE rather than dropping perpendicular.
 * On a skewed page the two are different by several pixels, and sliding is the
 * one that leaves the adjacent sides where the member left them — otherwise
 * snapping the top edge silently re-aims the left and right ones too.
 */
export function snapEdge(
  raster: LumaRaster,
  quad: Quad,
  edge: number,
  band: number,
): { a: Pt; b: Pt } | null {
  const i = ((edge % 4) + 4) % 4;
  const line = edgeLinesNear(raster, quad, i, band)[0];
  if (!line) return null;
  const ia = i;
  const ib = (i + 1) % 4;
  const a = slide(quad[ia], quad[ia], quad[(i + 3) % 4], line);
  const b = slide(quad[ib], quad[ib], quad[(i + 2) % 4], line);
  // ⚠️ 1.5x, NOT 1x. A slide along an adjacent edge that meets this one
  // obliquely travels further than the perpendicular gap it is closing — at
  // 48° off square, half again as far. Capping at the band itself would refuse
  // exactly the skewed pages this handle exists for.
  const cap = band * 1.5;
  if (dist(a, quad[ia]) > cap || dist(b, quad[ib]) > cap) return null;
  return { a, b };
}

/** Slide `p` along the direction `from → p` until it meets `line`. */
function slide(
  p: Pt,
  head: Pt,
  from: Pt,
  line: { nx: number; ny: number; c: number },
): Pt {
  const dx = head.x - from.x;
  const dy = head.y - from.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return projectOnto(p, line);
  const ux = dx / l;
  const uy = dy / l;
  const den = line.nx * ux + line.ny * uy;
  // Nearly parallel: the slide would run for hundreds of pixels to close a
  // gap of three. Drop perpendicular instead.
  if (Math.abs(den) < 0.2) return projectOnto(p, line);
  const t = (line.c - (line.nx * p.x + line.ny * p.y)) / den;
  return { x: p.x + ux * t, y: p.y + uy * t };
}
