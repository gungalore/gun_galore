import { Pt, Quad, isConvex, minInteriorAngle, orderQuad, quadArea } from './geometry';

// ────────────────────────────────────────────────────────────────────
// FINDING THE DOCUMENT.
//
// Pure. A luma buffer in, four corners out. No canvas, no DOM, no imports
// beyond the geometry — which is what lets the whole detector be tested
// against synthetic documents in node, without a phone or a photograph.
//
// It is deliberately NOT a general-purpose rectangle finder. It knows one
// thing a general library has no way to be told: we are looking for a
// DOCUMENT, which is a mostly-convex quadrilateral occupying a good fraction
// of the frame, usually brighter than what is behind it, with two roughly
// horizontal and two roughly vertical edges. Every prior below is that
// sentence turned into a constraint, and together they are worth more than a
// nine-megabyte download.
//
// ⚠️ WHAT IT MUST NEVER DO IS BE CONFIDENTLY WRONG. A missed detection costs a
// corner drag; a wrong one that looks plausible crops half a licence card off
// and the member does not notice until SAPS does. So the scoring rejects hard
// and the caller always shows a review step.
// ────────────────────────────────────────────────────────────────────

export interface Gray {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Detection {
  /** In the coordinates of the luma buffer handed in. */
  quad: Quad;
  /** 0..1. Below ACCEPT_SCORE the caller should fall back to the frame. */
  score: number;
  /** How much brighter the inside is than the outside, in luma steps. */
  contrast: number;
}

/** Below this we do not claim to have found anything. */
export const ACCEPT_SCORE = 0.55;

/** Detection runs at this width; corners scale back to the full image. */
export const DETECT_WIDTH = 320;

// ── luma ────────────────────────────────────────────────────────────

/** Rec. 601 luma, integer. The eye weights green most and so does the print. */
export function toLuma(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Gray {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8;
  }
  return { data: out, width, height };
}

/**
 * 2x box downsample.
 *
 * Two jobs at once: it is the noise blur before the gradients, and it makes
 * everything after it four times cheaper. Corner precision at half resolution
 * is a pixel or two, which is invisible on a marker — and the corners are
 * measured again against the full-size still when it actually matters.
 */
export function halveGray(src: Gray): Gray {
  const w = Math.max(1, src.width >> 1);
  const h = Math.max(1, src.height >> 1);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(src.height - 1, y * 2);
    const y1 = Math.min(src.height - 1, y * 2 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(src.width - 1, x * 2);
      const x1 = Math.min(src.width - 1, x * 2 + 1);
      out[y * w + x] =
        (src.data[y0 * src.width + x0] +
          src.data[y0 * src.width + x1] +
          src.data[y1 * src.width + x0] +
          src.data[y1 * src.width + x1] +
          2) >>
        2;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Divide the lighting out before looking for edges.
 *
 * ⚠️ THE COMBINATION IS WHAT KILLS DETECTION, not either half. A densely
 * printed page is fine. A strong lighting falloff is fine. Both together are
 * not: the threshold is ONE number for the whole frame, so it keeps the
 * high-contrast print on the lit side and throws away the document's own
 * border on the shadowed side — and a border that never votes cannot be found.
 *
 * Flattening first is cheap here (the buffer is 160px across by this point)
 * and it is the same multiplicative correction the enhancement applies later,
 * for the same reason: illumination multiplies, so it divides out.
 */
export function flattenIllumination(g: Gray): Gray {
  const { width: w, height: h } = g;
  const radius = Math.max(3, Math.round(Math.min(w, h) / 8));
  const blurred = boxBlurGray(g.data, w, h, radius);
  let mean = 0;
  for (let i = 0; i < blurred.length; i++) mean += blurred[i];
  mean /= blurred.length || 1;

  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++) {
    const b = blurred[i];
    out[i] = b > 1 ? Math.max(0, Math.min(255, (g.data[i] / b) * mean)) : g.data[i];
  }
  return { data: out, width: w, height: h };
}

/** Separable box blur over a luma plane. Two passes is smooth enough here. */
function boxBlurGray(
  src: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(a.length);
  const r = Math.max(1, radius);
  const n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / n;
        sum +=
          a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / n;
        sum +=
          b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// ── edges ───────────────────────────────────────────────────────────

interface EdgePx {
  x: number;
  y: number;
  gx: number;
  gy: number;
  mag: number;
}

/**
 * How many edge pixels we let through. Caps the Hough cost.
 *
 * ⚠️ RAISED FROM 1500 AFTER THE FIRST REAL PHONE TEST. A licence card's own
 * internal black table borders are far stronger than its outer edge against a
 * light desk — and with a budget of 1500, the internal lines filled it and the
 * outer edge never got to vote. Twice the budget costs ~2ms of Hough and lets
 * the weak-but-long outer edge through alongside the loud internal print.
 */
const MAX_EDGE_PX = 3000;

/**
 * Sobel, then an ADAPTIVE threshold.
 *
 * ⚠️ THE ADAPTIVE PART IS THE WHOLE ROBUSTNESS STORY. A fixed threshold is
 * exactly why naive detectors find nothing on a dark licence card lying on a
 * dark desk, and find fifteen hundred spurious edges on a bright page under a
 * window. Taking a percentile of the actual gradient histogram makes the
 * detector indifferent to overall contrast, which is the single most variable
 * thing about a photograph taken by a member in their kitchen.
 */
export function edgePixels(g: Gray): EdgePx[] {
  const { data, width: w, height: h } = g;
  if (w < 5 || h < 5) return [];

  const mags = new Int32Array(w * h);
  const hist = new Int32Array(1024);
  let maxMag = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = data[i - w - 1];
      const t = data[i - w];
      const tr = data[i - w + 1];
      const l = data[i - 1];
      const r = data[i + 1];
      const bl = data[i + w - 1];
      const b = data[i + w];
      const br = data[i + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const m = Math.abs(gx) + Math.abs(gy);
      mags[i] = m;
      if (m > maxMag) maxMag = m;
      hist[Math.min(1023, m >> 2)]++;
    }
  }
  if (maxMag === 0) return [];

  // Walk the histogram down from the top until we have collected roughly
  // MAX_EDGE_PX of the strongest pixels.
  let want = 0;
  let bin = 1023;
  for (; bin > 0; bin--) {
    want += hist[bin];
    if (want >= MAX_EDGE_PX) break;
  }
  const threshold = Math.max(24, bin << 2);

  const out: EdgePx[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mags[i] < threshold) continue;
      const tl = data[i - w - 1];
      const t = data[i - w];
      const tr = data[i - w + 1];
      const l = data[i - 1];
      const r = data[i + 1];
      const bl = data[i + w - 1];
      const b = data[i + w];
      const br = data[i + w + 1];
      out.push({
        x,
        y,
        gx: tr + 2 * r + br - (tl + 2 * l + bl),
        gy: bl + 2 * b + br - (tl + 2 * t + tr),
        mag: mags[i],
      });
    }
  }
  return out;
}

// ── Hough ───────────────────────────────────────────────────────────

/** A line as normal angle and distance from origin: x cos0 + y sin0 = rho. */
export interface Line {
  theta: number;
  rho: number;
  votes: number;
  /** +1 when the bright side is towards the origin along the normal. */
  polarity: number;
}

/** Degrees either side of axis-aligned that a document edge may lie. */
const THETA_SPAN = 40;
const RHO_STEP = 2;

/**
 * Accumulate one orientation class.
 *
 * Splitting horizontal-ish from vertical-ish edges before voting halves the
 * work, and — much more importantly — turns quad assembly from "choose 4 lines
 * from N" into "choose one from each of four small sets".
 */
function hough(
  pixels: EdgePx[],
  centreDeg: number,
  w: number,
  h: number,
): Line[] {
  const thetas: number[] = [];
  for (let d = centreDeg - THETA_SPAN; d <= centreDeg + THETA_SPAN; d++) {
    thetas.push((d * Math.PI) / 180);
  }
  const cos = thetas.map(Math.cos);
  const sin = thetas.map(Math.sin);

  /**
   * ⚠️ A PIXEL ONLY VOTES FOR ITS OWN ORIENTATION. Classic Hough lets every
   * pixel vote at every theta, which means a compact BLOB of strong pixels —
   * a block of text, a photo corner — paints a sinusoid across the whole
   * accumulator and shows up as ten phantom "lines" at ten different angles,
   * crowding real edges off the shortlist. That is exactly what the marbled
   * desk did. An edge pixel's gradient already says which way its edge runs,
   * so it votes only within a few degrees of that — blobs stop spraying,
   * because a blob's pixels point every which way.
   */
  const ALIGN_TOL = (12 * Math.PI) / 180;

  const diag = Math.ceil(Math.hypot(w, h));
  const rhoBins = Math.ceil((2 * diag) / RHO_STEP) + 1;
  // Float64, not Int32: the votes below are SQUARED magnitudes, and a strong
  // line's total clears what an Int32 holds.
  const acc = new Float64Array(thetas.length * rhoBins);
  const pol = new Int32Array(thetas.length * rhoBins);

  for (const p of pixels) {
    // The pixel's own normal direction, folded onto the line-orientation
    // half-circle: a normal and its opposite describe the same line.
    const phi = Math.atan2(p.gy, p.gx);
    for (let t = 0; t < thetas.length; t++) {
      let d = phi - thetas[t];
      d = d - Math.PI * Math.round(d / Math.PI);
      if (Math.abs(d) > ALIGN_TOL) continue;
      const rho = p.x * cos[t] + p.y * sin[t];
      const bin = Math.round((rho + diag) / RHO_STEP);
      if (bin < 0 || bin >= rhoBins) continue;
      const at = t * rhoBins + bin;
      // ⚠️ SQUARED. A plain sum lets a long, weak line beat a short, strong
      // one — on the operator's desk, broad soft gradients in the marbled
      // surface out-voted the card's own top edge by three to one, and an
      // edge that never becomes a line can never become a corner. Squaring is
      // the cheapest statement of the right prior: a document's edge is a
      // STRONG discontinuity, and length alone must not be able to fake that.
      acc[at] += p.mag * p.mag;
      // Does the gradient point along the normal or against it? For a bright
      // page on a dark table the two opposite edges disagree, which is the
      // signal we rank on.
      pol[at] += p.gx * cos[t] + p.gy * sin[t] > 0 ? 1 : -1;
    }
  }

  // Peaks with 5x5 non-maximum suppression in (theta, rho).
  const peaks: Line[] = [];
  for (let t = 0; t < thetas.length; t++) {
    for (let bin = 0; bin < rhoBins; bin++) {
      const v = acc[t * rhoBins + bin];
      if (v === 0) continue;
      let best = true;
      for (let dt = -2; dt <= 2 && best; dt++) {
        for (let db = -2; db <= 2; db++) {
          if (dt === 0 && db === 0) continue;
          const nt = t + dt;
          const nb = bin + db;
          if (nt < 0 || nt >= thetas.length || nb < 0 || nb >= rhoBins) continue;
          if (acc[nt * rhoBins + nb] > v) {
            best = false;
            break;
          }
        }
      }
      if (!best) continue;
      peaks.push({
        theta: thetas[t],
        rho: bin * RHO_STEP - diag,
        votes: v,
        polarity: Math.sign(pol[t * rhoBins + bin]),
      });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  // Ten, not six. On a printed card the internal table borders and text rows
  // out-vote the card's own outer edge, and with a shortlist of six the outer
  // edge never even reached quad assembly — the operator's photo proved it.
  return peaks.slice(0, 10);
}

/** Where two lines cross, or null when they are parallel. */
export function intersect(a: Line, b: Line): Pt | null {
  const c1 = Math.cos(a.theta);
  const s1 = Math.sin(a.theta);
  const c2 = Math.cos(b.theta);
  const s2 = Math.sin(b.theta);
  const det = c1 * s2 - c2 * s1;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (a.rho * s2 - b.rho * s1) / det,
    y: (c1 * b.rho - c2 * a.rho) / det,
  };
}

// ── scoring ─────────────────────────────────────────────────────────

/**
 * How much brighter the inside of the quad is than just outside it.
 *
 * THE STRONGEST SINGLE DISCRIMINATOR between the document and the seam of the
 * table behind it, and it costs about ninety array reads. A table edge has
 * strong gradients and no interior/exterior contrast; a document has both.
 */
export function edgeSurfaces(
  g: Gray,
  q: Quad,
): { inside: number; outside: number } {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const at = (x: number, y: number): number | null => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= g.width || iy >= g.height) return null;
    return g.data[iy * g.width + ix];
  };

  let inSum = 0;
  let inN = 0;
  let outSum = 0;
  let outN = 0;
  const OFFSET = 4;

  for (let e = 0; e < 4; e++) {
    const a = q[e];
    const b = q[(e + 1) % 4];
    for (let s = 1; s <= 6; s++) {
      const t = s / 7;
      const mx = a.x + (b.x - a.x) * t;
      const my = a.y + (b.y - a.y) * t;
      // Towards the centre is inside; the same distance the other way is out.
      const dx = cx - mx;
      const dy = cy - my;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const inV = at(mx + ux * OFFSET, my + uy * OFFSET);
      const outV = at(mx - ux * OFFSET, my - uy * OFFSET);
      if (inV !== null) {
        inSum += inV;
        inN++;
      }
      if (outV !== null) {
        outSum += outV;
        outN++;
      }
    }
  }
  if (!inN || !outN) return { inside: 0, outside: 0 };
  return { inside: inSum / inN, outside: outSum / outN };
}

export function edgeContrast(g: Gray, q: Quad): number {
  const s = edgeSurfaces(g, q);
  if (s.inside === 0 && s.outside === 0) return 0;
  return s.inside - s.outside;
}

/**
 * Area: rises to full marks by about a third of the frame and stays there,
 * with a mild rolloff right at the top where "the document" is usually the
 * frame edge itself. The first version peaked at HALF the frame and punished
 * everything smaller — which scored a licence card at hand distance as
 * "probably not the document" even when its corners were found exactly.
 */
function areaScoreOf(frac: number): number {
  return frac <= 0.35
    ? frac / 0.35
    : frac <= 0.85
      ? 1
      : Math.max(0.4, 1 - (frac - 0.85) * 3);
}

function scoreQuad(
  g: Gray,
  q: Quad,
  votes: number,
  maxVotes: number,
): { score: number; contrast: number } | null {
  const w = g.width;
  const h = g.height;
  const frameArea = w * h;

  for (const p of q) {
    // A corner far outside the frame means the lines crossed somewhere
    // meaningless — a vanishing point, usually.
    if (p.x < -w * 0.25 || p.x > w * 1.25) return null;
    if (p.y < -h * 0.25 || p.y > h * 1.25) return null;
  }
  if (!isConvex(q)) return null;
  if (minInteriorAngle(q) < 50) return null;

  const area = Math.abs(quadArea(q));
  const frac = area / frameArea;
  // ⚠️ THE FLOOR WAS 0.15 AND THE OPERATOR'S CARD SAT EXACTLY ON IT — an
  // ID-1 card at a measured natural distance (158mm, iPhone) fills ~15% of a
  // portrait frame, and people hold phones further away, not closer. It is
  // now low enough to admit even the card's own internal tables, because a
  // strong internal quad is a perfectly good SEED: growth walks it out to the
  // card's true border. Junk this small still has to beat the score floor on
  // contrast it does not have.
  if (frac < 0.015 || frac > 0.98) return null;

  const top = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
  const bottom = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y);
  const left = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
  const right = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y);
  if (top < 1 || bottom < 1 || left < 1 || right < 1) return null;
  const hRatio = top / bottom;
  const vRatio = left / right;
  if (hRatio < 0.4 || hRatio > 2.5) return null;
  if (vRatio < 0.4 || vRatio > 2.5) return null;

  const contrast = edgeContrast(g, q);

  const areaScore = areaScoreOf(frac);
  // Contrast: 30 luma steps is a confident document-on-table. Was 40, which
  // under-scored the white-card-on-light-desk scene — the most common desk in
  // the country is not dark wood.
  const contrastScore = Math.min(1, Math.abs(contrast) / 30);
  const voteScore = maxVotes > 0 ? Math.min(1, votes / maxVotes) : 0;
  // Squareness of opposite sides — a real rectangle seen in perspective still
  // has opposite edges within a factor of about two.
  const shapeScore =
    1 -
    Math.min(1, (Math.abs(1 - hRatio) + Math.abs(1 - vRatio)) / 2);

  const score =
    0.34 * contrastScore +
    0.26 * areaScore +
    0.22 * voteScore +
    0.18 * shapeScore;

  return { score, contrast };
}

// ── growing to the true border ──────────────────────────────────────
//
// ⚠️ WHY A SECOND STAGE EXISTS AT ALL. On a real licence card the outer edge
// runs one to three pixels from the card's own internal table border at
// working resolution — and Hough peak selection, whatever its window, keeps
// only one of two parallel lines that close. So the assembled quad reliably
// lands on the card's CONTENT (the tables, the text block) with the outer
// margin cropped away. No amount of shortlist tuning fixes a 2px separation.
//
// Growing does: from the chosen quad, walk each side outward along its
// normal, recording where strong parallel edges cross and what the luma does
// across each. The OUTERMOST crossing that still steps between two genuinely
// different surfaces is the document's edge; everything inside it is print,
// which has quiet white margin on the far side rather than a new surface.

/** Mean luma and mean gradient magnitude along a displaced edge. */
function lineStats(
  g: Gray,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { lum: number; mag: number } {
  const N = 16;
  let lum = 0;
  let mag = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    // The middle of the edge only — corners belong to the adjacent sides.
    const t = 0.15 + (0.7 * i) / (N - 1);
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    if (x < 1 || y < 1 || x >= g.width - 1 || y >= g.height - 1) continue;
    const c = y * g.width + x;
    lum += g.data[c];
    mag +=
      Math.abs(g.data[c + 1] - g.data[c - 1]) +
      Math.abs(g.data[c + g.width] - g.data[c - g.width]);
    n++;
  }
  return n ? { lum: lum / n, mag: mag / n } : { lum: 0, mag: 0 };
}

/** Where two infinite lines through (a1,b1) and (a2,b2) cross. */
function lineCross(
  a1: Pt,
  b1: Pt,
  a2: Pt,
  b2: Pt,
): Pt | null {
  const d1x = b1.x - a1.x;
  const d1y = b1.y - a1.y;
  const d2x = b2.x - a2.x;
  const d2y = b2.y - a2.y;
  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((a2.x - a1.x) * d2y - (a2.y - a1.y) * d2x) / det;
  return { x: a1.x + d1x * t, y: a1.y + d1y * t };
}

/**
 * Push each side of the quad outward to the true document border.
 *
 * ⚠️ EACH SIDE ANCHORS ITSELF. The margin reference is whatever surface the
 * walk finds immediately beyond the side's own line — not a global estimate,
 * which for a seed embedded in the middle of a card's print is an unusable
 * mixture. From that anchor the rules are physical: a run that matches the
 * anchor is more of the same surface; a crossing whose far side still matches
 * is internal print, and is crossed; a crossing whose far side differs is a
 * change of surface, which is what a document's border IS. A walk that loses
 * the surface without a crossing grows nothing.
 *
 * Returns how many sides ended at a confirmed border — the caller uses it to
 * judge whether this candidate grew into a document or just sat there.
 */
export function growQuad(
  g: Gray,
  quad: Quad,
): { quad: Quad; boundaries: number } {
  // Reach is per side, and runs to the frame: the seed is often a small
  // internal fragment whose own size says nothing about how far away the
  // document's edge is, and the walk is anchored from the OUTSIDE, so a long
  // reach costs nothing but samples.
  const frameLimit = (mx: number, my: number, nx: number, ny: number) => {
    let o = 0;
    while (
      o < Math.max(g.width, g.height) &&
      mx + nx * (o + 2) >= 1 &&
      mx + nx * (o + 2) < g.width - 1 &&
      my + ny * (o + 2) >= 1 &&
      my + ny * (o + 2) < g.height - 1
    ) {
      o++;
    }
    return o;
  };
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  let boundariesFound = 0;

  // Displaced endpoints per side, after growth.
  const sides: { a: Pt; b: Pt }[] = [];

  for (let e = 0; e < 4; e++) {
    const a = quad[e];
    const b = quad[(e + 1) % 4];
    // Outward unit normal: away from the centroid.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (nx * (cx - mx) + ny * (cy - my) > 0) {
      nx = -nx;
      ny = -ny;
    }

    const maxOut = Math.max(6, frameLimit(mx, my, nx, ny));

    // Profile the walk.
    const lums: number[] = [];
    const mags: number[] = [];
    for (let o = 0; o <= maxOut; o++) {
      const st = lineStats(g, a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o);
      lums.push(st.lum);
      mags.push(st.mag);
    }

    // ⚠️ THE BOUNDARY IS A RIDGE WITH QUIET BEYOND IT. Luma anchors failed
    // twice here — flattening leaves a shadow trench around a bright card, so
    // the desk's own brightness drifts past any tolerance; and a card whose
    // print reaches its edge reads, along that one line, like more desk. What
    // never lies is the gradient profile: the document's edge is the
    // OUTERMOST strong ridge that has only quiet desk beyond it and a genuine
    // change of surface across it. Print can be loud, but there is always
    // more of something inside it; the desk can drift, but it cannot ridge.
    const EDGE_T = 24;
    let grow = 0;
    let foundBoundary = false;

    // What "quiet" means on THIS desk: twice the far tail's own texture, so a
    // noisy surface is measured against itself rather than an ideal.
    const tailMag =
      (mags[maxOut] + mags[maxOut - 1] + mags[maxOut - 2] + mags[maxOut - 3]) /
      4;
    const quiet = Math.max(14, tailMag * 2);

    for (let o = Math.max(0, maxOut - 6); o >= 0; o--) {
      if (mags[o] < EDGE_T) continue;
      // The outer shoulder of the ridge, so a wide edge resolves outward.
      if (o + 1 <= maxOut && mags[o] < mags[o + 1]) continue;
      // Beyond it: nothing but desk.
      const beyond =
        (mags[Math.min(maxOut, o + 2)] +
          mags[Math.min(maxOut, o + 3)] +
          mags[Math.min(maxOut, o + 4)] +
          mags[Math.min(maxOut, o + 5)]) /
        4;
      if (beyond > quiet) continue;
      // And a real change of surface across it.
      const inLum =
        (lums[Math.max(0, o - 2)] + lums[Math.max(0, o - 3)]) / 2;
      const outLum =
        (lums[Math.min(maxOut, o + 2)] + lums[Math.min(maxOut, o + 3)]) / 2;
      if (Math.abs(inLum - outLum) < 15) continue;
      // Step in to the ridge's CENTRE. The scan found its outer shoulder,
      // which sits a pixel or two onto the desk — corners placed there put
      // every side just off the edge it found, which both crops a sliver of
      // desk into the scan and ruins the border measurement that selection
      // depends on.
      let centre = o;
      while (centre > 0 && mags[centre - 1] > mags[centre]) centre--;
      grow = centre;
      foundBoundary = true;
      break;
    }
    if (foundBoundary) boundariesFound++;

    sides.push({
      a: { x: a.x + nx * grow, y: a.y + ny * grow },
      b: { x: b.x + nx * grow, y: b.y + ny * grow },
    });
  }

  const unchanged = { quad, boundaries: boundariesFound };

  // New corners: adjacent displaced sides, intersected.
  const out: Pt[] = [];
  for (let e = 0; e < 4; e++) {
    const prev = sides[(e + 3) % 4];
    const cur = sides[e];
    const p = lineCross(prev.a, prev.b, cur.a, cur.b);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return unchanged;
    out.push(p);
  }

  let grown: Quad;
  try {
    grown = orderQuad(out);
  } catch {
    return unchanged;
  }
  if (!isConvex(grown) || minInteriorAngle(grown) < 45) return unchanged;
  // Growth must grow. Anything else means the walk found noise.
  if (Math.abs(quadArea(grown)) < Math.abs(quadArea(quad))) return unchanged;
  return { quad: grown, boundaries: boundariesFound };
}

/**
 * Mean gradient magnitude along a quad's four sides — the WHOLE side.
 *
 * ⚠️ FULL LENGTH, unlike the walk's sampler, which deliberately skips the
 * ends because corners belong to the adjacent sides. Here the ends are the
 * point: a slightly tilted wrong variant still rides the ridge near each
 * side's middle, but leaves it at the ends — so sampling end to end is what
 * separates the exact fit from its one-degree-off cousins.
 */
function borderMag(g: Gray, q: Quad): number {
  let sum = 0;
  let n = 0;
  for (let e = 0; e < 4; e++) {
    const a = q[e];
    const b = q[(e + 1) % 4];
    // Unit normal, for the ±1px tolerance below.
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const t = 0.03 + (0.94 * i) / (N - 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      // ⚠️ BEST OF THREE OFFSETS. A ridge here is one or two pixels wide and
      // corner placement is quantised, so a correct side can sit a single
      // pixel off its own edge — which read as "no border" and let junk
      // outrank truth. A wrong side has no ridge at ANY nearby offset, so the
      // tolerance sharpens the comparison instead of blurring it.
      let bestHere = 0;
      for (const d of [-1, 0, 1]) {
        const x = Math.round(px + nx * d);
        const y = Math.round(py + ny * d);
        if (x < 1 || y < 1 || x >= g.width - 1 || y >= g.height - 1) continue;
        const c = y * g.width + x;
        const m =
          Math.abs(g.data[c + 1] - g.data[c - 1]) +
          Math.abs(g.data[c + g.width] - g.data[c - g.width]);
        if (m > bestHere) bestHere = m;
      }
      sum += bestHere;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Are two quads the same rectangle, near enough? */
function quadNear(a: Quad, b: Quad, tol: number): boolean {
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y) > tol) return false;
  }
  return true;
}

// ── the detector ────────────────────────────────────────────────────

/**
 * Find the document in a luma buffer.
 *
 * Returns null rather than a guess when nothing scores well enough. The caller
 * falls back to the framing rectangle and opens the corner editor, which is a
 * far better outcome than a confident crop through the middle of a licence.
 */
export function detectQuad(
  g: Gray,
  opts: {
    /**
     * Override the score floor. The calibration harness passes 0 so a MISS
     * still reports its best candidate and its score — "best was 0.41, floor
     * is 0.55" is a tuning instruction; "null" is a shrug.
     */
    acceptScore?: number;
    /** Calibration tap: sees the working size, every line, every candidate. */
    debug?: (info: {
      width: number;
      height: number;
      hLines: Line[];
      vLines: Line[];
      candidates: Detection[];
    }) => void;
  } = {},
): Detection | null {
  // ⚠️ HALVE UNTIL THE PRINT IS GONE, not just once.
  //
  // A densely printed page produces far stronger gradients than its own
  // border, so the adaptive threshold fills its budget with letterforms and
  // the edge we actually want never survives to vote. Blurring the text away
  // is the fix: at ~160px across, lines of print average into flat grey while
  // the border — which is a metre of straight edge, not a serif — is
  // untouched. Halving to a fixed working size also means the detector
  // behaves identically whatever the caller hands it.
  let small = g;
  while (small.width > 200 && small.width > 40 && small.height > 40) {
    small = halveGray(small);
  }
  // Lighting out first — see flattenIllumination. The scoring below still
  // reads contrast off the FLATTENED buffer, which is what we want: it is
  // asking "is the inside brighter than the outside" about reflectance, not
  // about which end of the desk the lamp is on.
  small = flattenIllumination(small);
  const px = edgePixels(small);
  if (px.length < 40) return null;

  // Split by which way the gradient mostly points. A document held within
  // about 40 degrees of square has two near-horizontal and two near-vertical
  // edges, and this is what lets us pair them instead of searching.
  const horiz: EdgePx[] = [];
  const vert: EdgePx[] = [];
  for (const p of px) {
    if (Math.abs(p.gy) > Math.abs(p.gx)) horiz.push(p);
    else vert.push(p);
  }
  if (horiz.length < 20 || vert.length < 20) return null;

  // Horizontal edges have a vertical normal (theta near 90); vertical edges
  // have a horizontal normal (theta near 0).
  const hLines = hough(horiz, 90, small.width, small.height);
  const vLines = hough(vert, 0, small.width, small.height);
  if (hLines.length < 2 || vLines.length < 2) return null;

  const maxVotes =
    Math.max(...hLines.map((l) => l.votes)) +
    Math.max(...vLines.map((l) => l.votes));

  let best: Detection | null = null;
  const candidates: Detection[] = [];

  for (let a = 0; a < hLines.length; a++) {
    for (let b = a + 1; b < hLines.length; b++) {
      for (let c = 0; c < vLines.length; c++) {
        for (let d = c + 1; d < vLines.length; d++) {
          const corners: Pt[] = [];
          let ok = true;
          for (const hl of [hLines[a], hLines[b]]) {
            for (const vl of [vLines[c], vLines[d]]) {
              const p = intersect(hl, vl);
              if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
                ok = false;
                break;
              }
              corners.push(p);
            }
            if (!ok) break;
          }
          if (!ok) continue;

          let quad: Quad;
          try {
            quad = orderQuad(corners);
          } catch {
            continue;
          }
          const votes =
            hLines[a].votes + hLines[b].votes + vLines[c].votes + vLines[d].votes;
          const s = scoreQuad(small, quad, votes, maxVotes * 2);
          if (!s) continue;
          const det = { quad, score: s.score, contrast: s.contrast };
          candidates.push(det);
          if (!best || s.score > best.score) best = det;
        }
      }
    }
  }

  opts.debug?.({
    width: small.width,
    height: small.height,
    hLines,
    vLines,
    candidates,
  });

  const accept = opts.acceptScore ?? ACCEPT_SCORE;
  if (!best || best.score < accept) return null;

  // ⚠️ THE BEST SEED IS NOT THE BEST ANSWER. On a printed card the strongest
  // candidate is usually the card's own CONTENT — an internal table, the text
  // block — because internal edges out-shout the outer one. So the top few
  // DISTINCT candidates are each walked out to their true borders, and the
  // winner is whichever GREW into the most document-like result: real border
  // contrast, sensible size, sides that ended at a change of surface. A seed
  // that was already the whole document grows nowhere and wins on contrast; a
  // seed that was one table inside a card grows into the card and wins on
  // everything.
  candidates.sort((x, y) => y.score - x.score);
  const seeds: Detection[] = [];
  for (const c of candidates) {
    if (c.score < accept) break;
    if (seeds.some((sd) => quadNear(sd.quad, c.quad, 3))) continue;
    seeds.push(c);
    if (seeds.length >= 8) break;
  }

  let bestGrown: Detection | null = null;
  let bestRank = -Infinity;
  for (const seed of seeds) {
    const g2 = growQuad(small, seed.quad);
    const frac = Math.abs(quadArea(g2.quad)) / (small.width * small.height);
    if (frac > 0.99) continue;
    // ⚠️ RANKED ON THE BORDER ITSELF. Interior-vs-exterior contrast at a
    // fixed offset is diluted by print sitting near the edge — the true card
    // quad measured WEAKER than a tilted wrong one, because four pixels
    // inside a real card is often table, not margin. What cannot be diluted
    // is the border: a correct quad lies ON a gradient ridge for its whole
    // length, and a tilted variant cuts diagonally across quiet surface for
    // most of its. So the rank is mean gradient magnitude along the grown
    // sides, scaled by plausible size and confirmed-boundary count.
    const bm = borderMag(small, g2.quad);
    // ⚠️ NO FLOOR ON THE AREA TERM. A fragment's border is always louder than
    // the document's — black table borders against white card versus white
    // card against grey desk — so any floor under the size factor lets a
    // loud fragment out-rank the document it sits inside. Size is the one
    // thing a fragment cannot fake, and it multiplies from zero.
    const rank = bm * areaScoreOf(frac) * (1 + 0.2 * g2.boundaries);
    if (rank > bestRank) {
      bestRank = rank;
      bestGrown = {
        quad: g2.quad,
        score: seed.score,
        contrast: edgeContrast(small, g2.quad),
      };
    }
  }
  if (bestGrown && bestRank >= 15) best = bestGrown;

  // Back to the coordinates we were handed.
  const k = g.width / small.width;
  if (k !== 1) {
    best = {
      ...best,
      quad: best.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad,
    };
  }
  return best;
}
