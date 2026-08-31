import type { Gray } from './detect';
import type { Quad } from './geometry';

// ────────────────────────────────────────────────────────────────────
// SCORING A CANDIDATE QUAD AGAINST THE IMAGE IT CAME FROM.
//
// ⚠️ THE OBVIOUS TIE-BREAK IS CIRCULAR AND DOES NOT WORK. "Warp with each
// candidate homography and measure how straight the edges are in the result"
// sounds right and is worthless: a homography maps the candidate's own quad
// onto the output rectangle BY CONSTRUCTION, so every candidate — including a
// trapezoid straddling a book spine — produces perfectly straight edges. It
// measures the transform, not the document.
//
// So the scoring happens in the SOURCE image, where the evidence is: does a
// real intensity edge actually run along each side of this quad? A spine-
// straddling trapezoid fails immediately, because one of its sides runs
// through the middle of a printed page where there is no edge to find.
//
// ⚠️ SAMPLED ONLY ALONG THE MIDDLE OF EACH SIDE. Same reason as the mask
// module's EDGE_TRIM: near a corner the document's edge curves away, or the
// adjacent side's gradient bleeds in, and both corrupt the measurement of the
// side we are asking about.
// ────────────────────────────────────────────────────────────────────

/** Fraction of each side to ignore at both ends. */
export const SIDE_TRIM = 0.2;

/** Sample points along the kept span of each side. */
export const SAMPLES = 24;

/** How far to look either way across the edge, in pixels. */
export const PROBE = 4;

/** Gradient magnitude counting as real edge support, in luma levels. */
export const STRONG = 18;

export interface QuadScore {
  /** Fraction of sample points with real edge support, 0..1. */
  support: number;
  /** The weakest single side. A quad is only as good as its worst edge. */
  worstSide: number;
  /** Per side, TL-TR, TR-BR, BR-BL, BL-TL. */
  sides: [number, number, number, number];
}

/** Bilinear sample of a luma plane. Outside the frame reads as its edge. */
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
 * How much of this quad's boundary is supported by a real edge in the image.
 *
 * For each sample point on the middle span of each side, take the intensity a
 * few pixels either side ALONG THE NORMAL and call it supported when the
 * difference clears STRONG. That is a direct question about the photograph:
 * "is the document's border actually here?"
 */
export function scoreQuad(g: Gray, quad: Quad): QuadScore {
  const sides: number[] = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      sides.push(0);
      continue;
    }
    // Unit normal to this side.
    const nx = -dy / len;
    const ny = dx / len;
    let hit = 0;
    for (let i = 0; i < SAMPLES; i++) {
      // Middle span only.
      const t = SIDE_TRIM + ((1 - 2 * SIDE_TRIM) * i) / Math.max(1, SAMPLES - 1);
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const inside = at(g, px - nx * PROBE, py - ny * PROBE);
      const outside = at(g, px + nx * PROBE, py + ny * PROBE);
      if (Math.abs(outside - inside) >= STRONG) hit++;
    }
    sides.push(hit / SAMPLES);
  }
  const four = sides as [number, number, number, number];
  return {
    support: four.reduce((n, v) => n + v, 0) / 4,
    worstSide: Math.min(...four),
    sides: four,
  };
}

/**
 * Overlap between a quad and the thresholded mask, both in source space.
 *
 * Rasterising is unnecessary: sample a grid over the quad's bounding box and
 * count agreement. The mask is 64x64, so precision beyond that is imaginary.
 */
export function maskIoU(
  quad: Quad,
  inMask: (x: number, y: number) => boolean,
  /**
   * The region to integrate over.
   *
   * ⚠️ PASS THE WHOLE FRAME. Sampling only around the quad counts mask area
   * outside it as if it did not exist, so a quad covering half the document
   * scored 0.8 instead of 0.5 — the union was truncated to the intersection's
   * neighbourhood. The default pads generously for callers that have no frame
   * to hand, but it is a fallback, not the right answer.
   */
  bounds?: { x0: number; y0: number; x1: number; y1: number },
  grid = 48,
): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of quad) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!(maxX > minX) || !(maxY > minY)) return 0;

  const insideQuad = (x: number, y: number) => {
    // Winding test against the four edges; the quad is convex in practice.
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      const s = cross > 0 ? 1 : cross < 0 ? -1 : 0;
      if (s === 0) continue;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };

  let both = 0;
  let either = 0;
  const b = bounds ?? {
    x0: minX - (maxX - minX),
    y0: minY - (maxY - minY),
    x1: maxX + (maxX - minX),
    y1: maxY + (maxY - minY),
  };
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = b.x0 + ((b.x1 - b.x0) * (i + 0.5)) / grid;
      const y = b.y0 + ((b.y1 - b.y0) * (j + 0.5)) / grid;
      const q = insideQuad(x, y);
      const m = inMask(x, y);
      if (q && m) both++;
      if (q || m) either++;
    }
  }
  return either ? both / either : 0;
}

/**
 * Pick between candidate quads on evidence rather than on the confidence of
 * whichever head proposed them.
 *
 * ⚠️ THE WORST SIDE DECIDES, NOT THE AVERAGE. Three excellent edges and one
 * running through open page is exactly the spine-straddling failure, and it
 * averages to a respectable score. The whole point is to catch that.
 */
export function bestCandidate<T extends { quad: Quad }>(
  g: Gray,
  candidates: readonly T[],
  inMask?: (x: number, y: number) => boolean,
  bounds?: { x0: number; y0: number; x1: number; y1: number },
): { pick: T; score: QuadScore; iou: number } | null {
  let best: { pick: T; score: QuadScore; iou: number } | null = null;
  for (const c of candidates) {
    const score = scoreQuad(g, c.quad);
    const iou = inMask ? maskIoU(c.quad, inMask, bounds) : 1;
    // Worst side dominates; IoU breaks near-ties.
    const total = score.worstSide * 0.7 + score.support * 0.2 + iou * 0.1;
    const bestTotal = best
      ? best.score.worstSide * 0.7 + best.score.support * 0.2 + best.iou * 0.1
      : -1;
    if (total > bestTotal) best = { pick: c, score, iou };
  }
  return best;
}
