import type { Point, Quad } from './geometry';
import { dist } from './geometry';

/**
 * Corner refinement on the full-resolution still.
 *
 * The detector answers on a 256 px view, so its corners are several pixels
 * off at 3000 px. Along each coarse edge we cut short profiles across the
 * edge, find the document's brightness or colour step in each (sub-pixel),
 * fit a line through those points with RANSAC so fingers, shadows and print
 * are ignored, refit the inliers by total least squares, and intersect the
 * four lines. A side that finds too little support keeps the detector's
 * line. Runs twice by default: the second pass searches a narrower band
 * around the first answer.
 */

export interface EdgeFit {
  /** Line as a point and a unit direction. */
  p: Point;
  d: Point;
  /** Fraction of profiles that agreed with the fitted line. */
  support: number;
  /** Whether the refinement was used or the coarse edge kept. */
  refined: boolean;
}

export interface RefineResult {
  quad: Quad;
  edges: EdgeFit[];
  /** Mean corner shift in pixels, for diagnostics. */
  shift: number;
}

export interface RefineOptions {
  /** Profiles per edge. */
  samples?: number;
  /** Half-width of the search band across the edge, as a fraction of the short image side. */
  bandFraction?: number;
  /** Ends of each edge to ignore, as a fraction of its length (rounded corners, corner error). */
  endMargin?: number;
  /** RANSAC inlier distance in pixels. */
  inlierPx?: number;
  /** Minimum fraction of samples that must support a line to accept it. */
  minSupport?: number;
  /** A corner may not move more than this many bands; otherwise keep the coarse corner. */
  maxShiftBands?: number;
  /**
   * Prefer steps near the detector's line over stronger ones further away:
   * step score = magnitude * exp(-(distance / (band * distanceSigma))^2).
   * 0 disables it. Print lines and blanket texture are strong but far; the
   * paper edge is where the detector said, give or take.
   */
  distanceSigma?: number;
  /** Look at each colour channel, not just luma: a white card on a pink blanket has little luma contrast. */
  channels?: 'grey' | 'rgb';
  /** Passes. The second uses half the band around the first result. */
  iterations?: 1 | 2;
}

const DEFAULTS: Required<RefineOptions> = {
  samples: 64,
  bandFraction: 0.035,
  endMargin: 0.08,
  inlierPx: 1.5,
  minSupport: 0.4,
  maxShiftBands: 1.5,
  distanceSigma: 0.6,
  channels: 'rgb',
  iterations: 2,
};

export interface RefineImage {
  /** RGBA pixels (from ImageData) or one grey byte per pixel. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  channels: 1 | 4;
}

function sampleAt(img: RefineImage, x: number, y: number, c: number): number {
  const { data, width: w, height: h } = img;
  const cx = Math.min(w - 1.001, Math.max(0, x));
  const cy = Math.min(h - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const s = img.channels;
  const i = (y0 * w + x0) * s + c;
  const top = data[i] * (1 - fx) + data[i + s] * fx;
  const bot = data[i + w * s] * (1 - fx) + data[i + w * s + s] * fx;
  return top * (1 - fy) + bot * fy;
}

// Derivative of Gaussian, sigma 1.5, radius 4.
const DOG = [0.0044, 0.0304, 0.0994, 0.1618, 0, -0.1618, -0.0994, -0.0304, -0.0044];

/** Gradient of a profile (positive = values rise with t). */
function gradient(profile: Float32Array): Float32Array {
  const n = profile.length;
  const g = new Float32Array(n);
  for (let i = 4; i < n - 4; i++) {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += profile[i + k] * -DOG[k + 4];
    g[i] = s;
  }
  return g;
}

/** Window (in profile samples) on each side of a step over which contrast must hold. */
const SUSTAIN_NEAR = 3;
const SUSTAIN_FAR = 12;

/**
 * Sustained contrast at each position: mean of the window beyond the step
 * minus mean of the window before it. A paper edge keeps its contrast for
 * many pixels on both sides; a printed line or a thread of blanket texture
 * flips back within a few, so it scores low here however sharp it is.
 */
function sustained(profile: Float32Array): Float32Array {
  const n = profile.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + profile[i];
  const mean = (a: number, b: number): number => (pre[Math.min(n, b)] - pre[Math.max(0, a)]) / Math.max(1, Math.min(n, b) - Math.max(0, a));
  const c = new Float32Array(n);
  for (let i = SUSTAIN_FAR; i < n - SUSTAIN_FAR; i++) c[i] = mean(i + SUSTAIN_NEAR, i + SUSTAIN_FAR + 1) - mean(i - SUSTAIN_FAR, i - SUSTAIN_NEAR + 1);
  return c;
}

interface Candidate {
  x: number;
  y: number;
  mag: number;
}

function fitLineTLS(pts: Candidate[]): { p: Point; d: Point } {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
}

function pointLineDistance(p: { x: number; y: number }, line: { p: Point; d: Point }): number {
  return Math.abs((p.x - line.p.x) * line.d.y - (p.y - line.p.y) * line.d.x);
}

function ransacLine(pts: Candidate[], inlierPx: number, iters = 150): { line: { p: Point; d: Point }; inliers: Candidate[] } | null {
  if (pts.length < 4) return null;
  let bestInliers: Candidate[] = [];
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let it = 0; it < iters; it++) {
    const a = pts[Math.floor(rnd() * pts.length)];
    const b = pts[Math.floor(rnd() * pts.length)];
    if (a === b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const line = { p: { x: a.x, y: a.y }, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
    const inl = pts.filter((p) => pointLineDistance(p, line) <= inlierPx);
    if (inl.length > bestInliers.length) bestInliers = inl;
  }
  if (bestInliers.length < 3) return null;
  const line = fitLineTLS(bestInliers);
  const inliers = pts.filter((p) => pointLineDistance(p, line) <= inlierPx);
  return { line: fitLineTLS(inliers.length >= 3 ? inliers : bestInliers), inliers };
}

function intersect(a: { p: Point; d: Point }, b: { p: Point; d: Point }): Point | null {
  const det = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(det) < 1e-9) return null;
  const dx = b.p.x - a.p.x;
  const dy = b.p.y - a.p.y;
  const t = (dx * b.d.y - dy * b.d.x) / det;
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
}

/** Up to this many candidate steps per profile, so the paper edge is kept even when a printed line is stronger. */
const CANDIDATES_PER_PROFILE = 3;

interface Cand extends Candidate {
  /** Signed distance from the coarse line along its outward normal. */
  along: number;
  sample: number;
}

function refineOnce(img: RefineImage, coarse: Quad, o: Required<RefineOptions>, band: number): RefineResult {
  const edges: EdgeFit[] = [];
  const chans = o.channels === 'rgb' && img.channels === 4 ? [0, 1, 2] : [0];
  const profileLen = 2 * band + 1;
  const profiles = chans.map(() => new Float32Array(profileLen));
  const weight = o.distanceSigma > 0 ? (i: number): number => Math.exp(-(((i - band) / (band * o.distanceSigma)) ** 2)) : null;
  const cx0 = (coarse[0].x + coarse[1].x + coarse[2].x + coarse[3].x) / 4;
  const cy0 = (coarse[0].y + coarse[1].y + coarse[2].y + coarse[3].y) / 4;

  for (let e = 0; e < 4; e++) {
    const a = coarse[e];
    const b = coarse[(e + 1) % 4];
    const len = dist(a, b);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // Normal pointing away from the document.
    let nrm = { x: -dir.y, y: dir.x };
    if ((a.x - cx0) * nrm.x + (a.y - cy0) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y };
    const coarseLine = { p: { x: a.x, y: a.y }, d: dir };

    // Per sample and per sign: the local maxima of gradient x sustained contrast.
    type Local = { t: number; score: number; mag: number };
    const perSample: { pos: number; plus: Local[]; minus: Local[] }[] = [];
    let globalMax = 0;
    for (let s = 0; s < o.samples; s++) {
      const u = o.endMargin + ((1 - 2 * o.endMargin) * (s + 0.5)) / o.samples;
      const cx = a.x + dir.x * len * u;
      const cy = a.y + dir.y * len * u;
      for (let k = 0; k < profileLen; k++) {
        const t = k - band;
        const px = cx + nrm.x * t;
        const py = cy + nrm.y * t;
        for (let c = 0; c < chans.length; c++) profiles[c][k] = sampleAt(img, px, py, chans[c]);
      }
      const gs = profiles.map((p) => gradient(p));
      const cs = profiles.map((p) => sustained(p));
      const locals = (sign: 1 | -1): Local[] => {
        const score = new Float32Array(profileLen);
        const mags = new Float32Array(profileLen);
        for (let i = SUSTAIN_FAR; i < profileLen - SUSTAIN_FAR; i++) {
          let best = 0;
          let mag = 0;
          for (let c = 0; c < chans.length; c++) {
            const gv = gs[c][i] * sign;
            const cv = cs[c][i] * sign;
            if (gv <= 0 || cv <= 0) continue;
            const v = gv * cv;
            if (v > best) {
              best = v;
              mag = cv;
            }
          }
          score[i] = weight ? best * weight(i) : best;
          mags[i] = mag;
        }
        const found: Local[] = [];
        for (let i = SUSTAIN_FAR + 1; i < profileLen - SUSTAIN_FAR - 1; i++) {
          if (score[i] <= 0 || score[i] < score[i - 1] || score[i] < score[i + 1]) continue;
          const g = gs[0];
          const aa = g[i - 1] * sign;
          const bb = g[i] * sign;
          const cc = g[i + 1] * sign;
          const denom = aa - 2 * bb + cc;
          const off = denom !== 0 ? (0.5 * (aa - cc)) / denom : 0;
          found.push({ t: i + (Math.abs(off) < 1 ? off : 0), score: score[i], mag: mags[i] });
        }
        found.sort((x, y) => y.score - x.score);
        return found.slice(0, CANDIDATES_PER_PROFILE);
      };
      const plus = locals(1);
      const minus = locals(-1);
      for (const l of plus) globalMax = Math.max(globalMax, l.score);
      for (const l of minus) globalMax = Math.max(globalMax, l.score);
      perSample.push({ pos: u, plus, minus });
    }
    // Which sign dominates along this edge (paper brighter than the table, or darker).
    let sumPlus = 0;
    let sumMinus = 0;
    for (const s of perSample) {
      if (s.plus[0]) sumPlus += s.plus[0].score;
      if (s.minus[0]) sumMinus += s.minus[0].score;
    }
    const usePlus = sumPlus >= sumMinus;
    const floor = 0.08 * globalMax;

    let candidates: Cand[] = [];
    perSample.forEach((s, si) => {
      for (const l of usePlus ? s.plus : s.minus) {
        if (l.score < floor) continue;
        const t = l.t - band;
        const cx = a.x + dir.x * len * s.pos;
        const cy = a.y + dir.y * len * s.pos;
        candidates.push({ x: cx + nrm.x * t, y: cy + nrm.y * t, mag: l.mag, along: t, sample: si });
      }
    });

    // Extract straight lines one at a time; keep every line with enough distinct samples behind it.
    const lines: { line: { p: Point; d: Point }; support: number; along: number; mag: number }[] = [];
    for (let round = 0; round < 3 && candidates.length >= 4; round++) {
      const fit = ransacLine(candidates, o.inlierPx);
      if (!fit) break;
      const distinct = new Set(fit.inliers.map((c) => (c as Cand).sample)).size;
      const support = distinct / o.samples;
      const alongMean = fit.inliers.reduce((acc, c) => acc + (c as Cand).along, 0) / fit.inliers.length;
      const magMean = fit.inliers.reduce((acc, c) => acc + c.mag, 0) / fit.inliers.length;
      if (support >= o.minSupport) lines.push({ line: fit.line, support, along: alongMean, mag: magMean });
      const inl = new Set(fit.inliers);
      candidates = candidates.filter((c) => !inl.has(c));
    }
    if (lines.length) {
      // The paper edge is the outermost supported line: a printed frame sits inside
      // it. But a soft shadow just outside the paper is also a line; only go outward
      // to a line that carries a fair share of the strongest line's contrast.
      const strongest = Math.max(...lines.map((l) => l.mag));
      const worthy = lines.filter((l) => l.mag >= 0.25 * strongest);
      worthy.sort((x, y) => y.along - x.along);
      const pick = worthy[0];
      edges.push({ p: pick.line.p, d: pick.line.d, support: pick.support, refined: true });
    } else {
      edges.push({ p: coarseLine.p, d: coarseLine.d, support: 0, refined: false });
    }
  }

  const out: Point[] = [];
  let shiftSum = 0;
  for (let c = 0; c < 4; c++) {
    const prev = edges[(c + 3) % 4];
    const next = edges[c];
    const p = intersect(prev, next);
    const coarsePt = coarse[c];
    if (!p || dist(p, coarsePt) > o.maxShiftBands * band) out.push(coarsePt);
    else {
      out.push(p);
      shiftSum += dist(p, coarsePt);
    }
  }
  return { quad: out as Quad, edges, shift: shiftSum / 4 };
}

/**
 * Refine `coarse` (TL, TR, BR, BL in image pixels). `img` is RGBA ImageData
 * or a one-byte-per-pixel grey image with `channels: 1`.
 */
export function refineQuad(img: RefineImage, coarse: Quad, options?: RefineOptions): RefineResult;
export function refineQuad(grey: Uint8ClampedArray, width: number, height: number, coarse: Quad, options?: RefineOptions): RefineResult;
export function refineQuad(a: RefineImage | Uint8ClampedArray, b: number | Quad, c?: number | RefineOptions, d?: Quad, e?: RefineOptions): RefineResult {
  let image: RefineImage;
  let coarse: Quad;
  let options: RefineOptions;
  if (a instanceof Uint8ClampedArray) {
    image = { data: a, width: b as number, height: c as number, channels: 1 };
    coarse = d as Quad;
    options = e ?? {};
  } else {
    image = a;
    coarse = b as Quad;
    options = (c as RefineOptions | undefined) ?? {};
  }
  const o = { ...DEFAULTS, ...options };
  // Inlier distance scales with resolution: 1.5 px on a 1500 px still is 3 px on a 3000 px one.
  if (options.inlierPx === undefined) o.inlierPx = Math.max(1.5, 0.001 * Math.min(image.width, image.height));
  const band = Math.max(6, Math.round(Math.min(image.width, image.height) * o.bandFraction));
  let result = refineOnce(image, coarse, o, band);
  if (o.iterations === 2) {
    const second = refineOnce(image, result.quad, o, Math.max(4, Math.round(band / 2)));
    // Keep the first pass where the second found nothing better.
    const quad = second.quad.map((p, i) => (second.edges[i].refined || second.edges[(i + 3) % 4].refined ? p : result.quad[i])) as Quad;
    let shift = 0;
    for (let i = 0; i < 4; i++) shift += dist(quad[i], coarse[i]);
    result = { quad, edges: second.edges.map((e, i) => (e.refined ? e : result.edges[i])), shift: shift / 4 };
  }
  return result;
}

/** Move every corner toward the centroid by `px`: a hairline trim so no background sliver survives. */
export function shrinkQuad(q: Quad, px: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((cx - p.x) / d) * px, y: p.y + ((cy - p.y) / d) * px };
  }) as Quad;
}
