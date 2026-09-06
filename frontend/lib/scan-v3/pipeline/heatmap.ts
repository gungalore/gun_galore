import type { Point, Quad } from './geometry';
import { orderQuad, quadArea } from './geometry';

export interface Peak {
  /** Position in heatmap cell units, sub-cell refined. */
  x: number;
  y: number;
  value: number;
}

/**
 * Find the strongest response in one heatmap channel and refine it to a
 * sub-cell position with the intensity-weighted centroid of the cells around
 * the peak that exceed `threshold`. One cell is several pixels of the live
 * frame, so an integer argmax would only ever twitch between cells.
 */
export function findPeak(hm: Float32Array, w: number, h: number, offset: number, threshold: number, radius = 2): Peak {
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < h; y++) {
    const row = offset + y * w;
    for (let x = 0; x < w; x++) {
      const v = hm[row + x];
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = Math.max(0, by - radius); y <= Math.min(h - 1, by + radius); y++) {
    for (let x = Math.max(0, bx - radius); x <= Math.min(w - 1, bx + radius); x++) {
      const v = hm[offset + y * w + x];
      if (v < threshold) continue;
      sx += (x + 0.5) * v;
      sy += (y + 0.5) * v;
      sw += v;
    }
  }
  if (sw <= 0) return { x: bx + 0.5, y: by + 0.5, value: best };
  return { x: sx / sw, y: sy / sw, value: best };
}

export interface HeatmapResult {
  /** Corners in normalised 0..1 coordinates of the model input, TL TR BR BL. */
  quad: Quad;
  /** Mean peak value across the four corners, 0..1. */
  confidence: number;
  peaks: Peak[];
}

/**
 * Turn a (1, 4, H, W) corner heatmap into a quad. Returns null when any
 * corner's peak is under `threshold` (a corner is missing or off frame) or
 * the four points do not make a sensible convex shape.
 */
export function quadFromHeatmap(data: Float32Array, dims: readonly number[], threshold = 0.3): HeatmapResult | null {
  if (dims.length !== 4 || dims[1] !== 4) throw new Error(`unexpected heatmap dims ${dims.join('x')}`);
  const h = dims[2];
  const w = dims[3];
  const peaks: Peak[] = [];
  for (let c = 0; c < 4; c++) peaks.push(findPeak(data, w, h, c * w * h, threshold));
  if (peaks.some((p) => p.value < threshold)) return null;
  const pts: Point[] = peaks.map((p) => ({ x: p.x / w, y: p.y / h }));
  const quad = orderQuad(pts);
  // Reject degenerate shapes: tiny area or self-intersecting.
  if (quadArea(quad) < 0.01) return null;
  if (!isConvex(quad)) return null;
  const confidence = peaks.reduce((a, p) => a + Math.min(1, p.value), 0) / 4;
  return { quad, confidence, peaks };
}

function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const s = Math.sign(cross);
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}
