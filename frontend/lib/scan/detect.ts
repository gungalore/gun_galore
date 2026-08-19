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

/** How many edge pixels we let through. Caps the Hough cost. */
const MAX_EDGE_PX = 1500;

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

  const diag = Math.ceil(Math.hypot(w, h));
  const rhoBins = Math.ceil((2 * diag) / RHO_STEP) + 1;
  const acc = new Int32Array(thetas.length * rhoBins);
  const pol = new Int32Array(thetas.length * rhoBins);

  for (const p of pixels) {
    for (let t = 0; t < thetas.length; t++) {
      const rho = p.x * cos[t] + p.y * sin[t];
      const bin = Math.round((rho + diag) / RHO_STEP);
      if (bin < 0 || bin >= rhoBins) continue;
      const at = t * rhoBins + bin;
      acc[at] += p.mag;
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
  return peaks.slice(0, 6);
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
export function edgeContrast(g: Gray, q: Quad): number {
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
  if (!inN || !outN) return 0;
  return inSum / inN - outSum / outN;
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
  if (frac < 0.15 || frac > 0.98) return null;

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

  // Area: peaks around half the frame. A document filling 95% is usually the
  // frame edge itself; one filling 16% is usually something on the desk.
  const areaScore = 1 - Math.min(1, Math.abs(frac - 0.5) / 0.45);
  // Contrast: 40 luma steps is a confident document-on-table.
  const contrastScore = Math.min(1, Math.abs(contrast) / 40);
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

// ── the detector ────────────────────────────────────────────────────

/**
 * Find the document in a luma buffer.
 *
 * Returns null rather than a guess when nothing scores well enough. The caller
 * falls back to the framing rectangle and opens the corner editor, which is a
 * far better outcome than a confident crop through the middle of a licence.
 */
export function detectQuad(g: Gray): Detection | null {
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
          if (!best || s.score > best.score) {
            best = { quad, score: s.score, contrast: s.contrast };
          }
        }
      }
    }
  }

  if (!best || best.score < ACCEPT_SCORE) return null;

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
