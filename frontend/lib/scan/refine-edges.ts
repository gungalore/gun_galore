import type { Gray } from './detect';
import type { Quad } from './geometry';

// ────────────────────────────────────────────────────────────────────
// SUB-PIXEL REFINEMENT, AT FULL RESOLUTION, JUST BEFORE THE WARP.
//
// ⚠️ SUPERSEDED ON THE CAPTURE PATH 2026-09-05 BY corner-refine.ts, AND KEPT
// FOR THE ARGUMENT IT RECORDS RATHER THAN FOR THE CODE. Everything below about
// EDGES-NEVER-CORNERS and about the nearest step rather than the strongest is
// still true and is carried over verbatim. What failed is the fit: 32 profiles,
// one candidate each, plain total least squares, no outlier rejection and a
// 60px ceiling on the search. On the operator's iPhone that reported "refined
// 28.3px moved" over an A4 crop that was still visibly skew — a crease or a
// table edge tilting a side is invisible to a fit that has no way to reject a
// point. corner-refine.ts keeps several candidates per profile and picks the
// line by RANSAC with a support floor and a flank test.
//
// Every rung that produces a quad works at reduced scale: the model reasons on
// a 64x64 mask (one cell ≈ 30 source pixels on a 4K frame), and the classical
// detector halves the image until print blurs away. Both then scale their
// answer back up, so a half-cell error becomes fifteen pixels of misplaced
// crop on a statutory document.
//
// This walks each edge at FULL resolution and finds where the intensity step
// actually is, then refits and re-intersects.
//
// ⚠️ EDGES, NEVER CORNERS. The tempting move is a corner refinement of the
// cornerSubPix family, and on a rounded document it does exactly the wrong
// thing: it hunts the strongest local gradient structure near the corner,
// which IS the arc, and pulls the corner inward onto it. The true corner is
// not on the document at all — it is where two straight edges would have met.
// So refine the edges, which are real, and intersect them, which is exact.
//
// ⚠️ AND ONLY THE MIDDLE OF EACH EDGE, for the same reason as everywhere else
// in this pipeline: near a corner the arc curves away from the line, and
// including those samples tilts the fit inward.
// ────────────────────────────────────────────────────────────────────

/** Fraction of each edge ignored at both ends. */
export const REFINE_TRIM = 0.2;

/** Profiles taken along the kept span of each edge. */
export const PROFILES = 32;

/**
 * How far either side of the current edge to search, as a fraction of the
 * quad's shorter side — with a floor and a ceiling in pixels.
 *
 * ⚠️ A FIXED WIDTH CANNOT WORK, AND 6px WAS FAR TOO NARROW. The quads reaching
 * this function come from reduced resolution: the mask is 64x64, so one cell
 * is roughly 47 source pixels on a 4K frame and the incoming error is tens of
 * pixels, not single ones. A band that cannot reach the true edge does not
 * refine anything — it silently votes zero and leaves the edge where it was,
 * which is exactly what the rounded-corner test caught.
 */
export const SEARCH_FRAC = 0.035;
export const SEARCH_MIN = 6;
export const SEARCH_MAX = 60;

/** A profile must show at least this much step to vote. */
export const MIN_STEP = 12;

/** At least this fraction of profiles must vote, or the edge is left alone. */
export const MIN_VOTES = 0.35;

interface Pt {
  x: number;
  y: number;
}

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

interface Line {
  nx: number;
  ny: number;
  c: number;
}

/** Total least squares — PCA, so a vertical edge is as fittable as a horizontal one. */
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

function intersect(a: Line, b: Line): Pt | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (a.c * b.ny - a.ny * b.c) / det,
    y: (a.nx * b.c - a.c * b.nx) / det,
  };
}

export interface RefineResult {
  quad: Quad;
  /** Per side, the fraction of profiles that found a step. */
  votes: [number, number, number, number];
  /** How far each corner moved, in pixels. */
  moved: [number, number, number, number];
  /** Sides left as they were because too few profiles agreed. */
  skipped: number;
}

/**
 * Walk each edge at full resolution, find the true intensity step, refit.
 *
 * Returns the input unchanged (with `skipped: 4`) when nothing can be
 * improved — a refinement that cannot find the edge must never move it, since
 * a confident wrong crop is worse than an approximate right one.
 */
export function refineEdges(g: Gray, quad: Quad): RefineResult {
  const lines: (Line | null)[] = [];
  const votes: number[] = [];
  let skipped = 0;

  // Search width from the quad's own scale, so this works the same on a
  // thumbnail and on a 4K frame.
  let shortSide = Infinity;
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    shortSide = Math.min(shortSide, Math.hypot(b.x - a.x, b.y - a.y));
  }
  const search = Math.round(
    Math.min(SEARCH_MAX, Math.max(SEARCH_MIN, shortSide * SEARCH_FRAC)),
  );

  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) {
      lines.push(null);
      votes.push(0);
      skipped++;
      continue;
    }
    const nx = -dy / len;
    const ny = dx / len;

    const found: Pt[] = [];
    for (let i = 0; i < PROFILES; i++) {
      const t = REFINE_TRIM + ((1 - 2 * REFINE_TRIM) * i) / Math.max(1, PROFILES - 1);
      const px = a.x + dx * t;
      const py = a.y + dy * t;

      // ⚠️ THE NEAREST STRONG STEP, NOT THE STRONGEST. Widening the search
      // band far enough to reach the true edge also brings PRINT into it, and
      // print is the stronger step: ink on paper is 64 against 228 while the
      // paper's border against a desk is 138 against 228. Taking the maximum
      // would snap the edge onto the first line of text.
      //
      // The incoming quad is approximately right — that is the whole premise
      // of refining rather than detecting — so the nearest qualifying step is
      // the one it meant. Sampling at half-pixel steps and taking the pair's
      // midpoint gives sub-pixel placement with no curve fitting.
      let bestOff: number | null = null;
      let bestDist = Infinity;
      let prev = at(g, px - nx * (search + 0.5), py - ny * (search + 0.5));
      for (let k = -search * 2; k <= search * 2; k++) {
        const o = k / 2;
        const v = at(g, px + nx * o, py + ny * o);
        if (Math.abs(v - prev) >= MIN_STEP) {
          const mid = o - 0.25;
          const dist = Math.abs(mid);
          if (dist < bestDist) {
            bestDist = dist;
            bestOff = mid;
          }
        }
        prev = v;
      }
      if (bestOff !== null) {
        found.push({ x: px + nx * bestOff, y: py + ny * bestOff });
      }
    }

    const frac = found.length / PROFILES;
    votes.push(frac);
    if (frac < MIN_VOTES) {
      lines.push(null);
      skipped++;
      continue;
    }
    lines.push(fitLine(found));
    if (!lines[s]) skipped++;
  }

  // Any side that could not be refined keeps its original line, so a partial
  // refinement is still an improvement rather than an all-or-nothing gamble.
  const asLine = (s: number): Line => {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { nx, ny, c: nx * a.x + ny * a.y };
  };
  const final: Line[] = [0, 1, 2, 3].map((s) => lines[s] ?? asLine(s));

  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    // Corner i is where side (i-1) meets side i.
    const p = intersect(final[(i + 3) % 4], final[i]);
    out.push(p ?? quad[i]);
  }

  const moved = out.map((p, i) => Math.hypot(p.x - quad[i].x, p.y - quad[i].y));
  return {
    quad: out as unknown as Quad,
    votes: votes as [number, number, number, number],
    moved: moved as [number, number, number, number],
    skipped,
  };
}
