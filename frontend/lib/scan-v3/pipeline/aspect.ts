import type { Quad } from './geometry';
import { dist, perspectiveScore } from './geometry';
import type { DocShape } from '../types';

/** Physical width/height ratios, landscape orientation (always >= 1). */
export const SHAPE_RATIOS: Record<Exclude<DocShape, 'other'>, number> = {
  a4: 297 / 210, // 1.414
  card: 85.6 / 53.98, // 1.586, ISO/IEC 7810 ID-1
};

/** Above this perspective score (1 = perfect rectangle) the view counts as fronto-parallel. */
export const FRONTO_PARALLEL_SCORE = 0.93;

export interface AspectEstimate {
  /** width / height of the physical rectangle, as seen from the top edge to the left edge. */
  ratio: number;
  /** Estimated focal length in pixels, when the view allowed it. */
  focal: number | null;
  method: 'perspective' | 'pixels';
}

/**
 * Recover the physical aspect ratio of a rectangle from one perspective view
 * (Zhang and He, "Whiteboard scanning and image enhancement", MSR-TR-2003-39).
 * Assumes square pixels and the principal point at the image centre.
 * Falls back to the pixel edge ratio when the view is (nearly) fronto-parallel,
 * where the closed form is ill-conditioned (a few pixels of corner error turn
 * into a 5-10% ratio error) and the pixel ratio is right anyway. Members are
 * coached to hold the phone flat, so that is the common case.
 */
export function estimateAspect(quad: Quad, imageW: number, imageH: number): AspectEstimate {
  const pixel = (): AspectEstimate => {
    const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
    const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
    return { ratio: w / h, focal: null, method: 'pixels' };
  };
  if (perspectiveScore(quad) >= FRONTO_PARALLEL_SCORE) return pixel();
  const cx = imageW / 2;
  const cy = imageH / 2;
  // Zhang's corner order: m1 top-left, m2 top-right, m3 bottom-left, m4 bottom-right.
  const m = (i: number): [number, number, number] => [quad[i].x - cx, quad[i].y - cy, 1];
  const m1 = m(0);
  const m2 = m(1);
  const m3 = m(3);
  const m4 = m(2);
  const cross = (a: number[], b: number[]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const m14 = cross(m1, m4);
  const k2 = dot(m14, m3) / dot(cross(m2, m4), m3);
  const k3 = dot(m14, m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];

  const pixelRatio = pixel;

  const denom = n2[2] * n3[2];
  if (Math.abs(denom) < 1e-6) return pixelRatio();
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / denom;
  if (!(f2 > 0) || !Number.isFinite(f2)) return pixelRatio();
  // A phone camera's focal length is roughly 0.7-1.5x the image diagonal; anything
  // wildly outside that means the geometry did not constrain it.
  const diag = Math.hypot(imageW, imageH);
  const f = Math.sqrt(f2);
  if (f < 0.4 * diag || f > 4 * diag) return pixelRatio();
  const num = (n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2];
  const den = (n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2];
  if (!(den > 0) || !(num > 0)) return pixelRatio();
  const ratio = Math.sqrt(num / den);
  if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 5) return pixelRatio();
  return { ratio, focal: Math.sqrt(f2), method: 'perspective' };
}

/** Nearest known shape within `tolerance` (fraction), else 'other'. Orientation is ignored. */
export function classifyShape(ratio: number, tolerance = 0.06): DocShape {
  const r = ratio >= 1 ? ratio : 1 / ratio;
  let best: DocShape = 'other';
  let bestErr = Infinity;
  for (const [shape, target] of Object.entries(SHAPE_RATIOS) as [Exclude<DocShape, 'other'>, number][]) {
    const err = Math.abs(Math.log(r / target));
    if (err < bestErr) {
      bestErr = err;
      best = shape;
    }
  }
  return bestErr <= Math.log(1 + tolerance) ? best : 'other';
}
