// ⚠️ MIRRORED FROM backend/src/scan/docquad-postprocess.ts — KEEP THE TWO IN STEP.
// The backend runs this per capture and the browser worker runs it per
// frame, and there is no shared package between the two. The tests live
// on the BACKEND copy (jest); if you change the maths here, change it
// there and let those tests judge it.

import {
  HEATMAP_SIZE,
  type Letterbox,
  type Quad,
  cellToModelSpace,
  insideContent,
  toSourceSpace,
} from './letterbox';

// ────────────────────────────────────────────────────────────────────
// Turning DocQuadNet256's output into a quad.
//
// The model emits `corner_heatmaps`, [1, 4, 64, 64] of LOGITS — one 64x64
// plane per corner, in the order TL, TR, BR, BL, which is the same order
// geometry.ts's Quad uses. The peak of each plane is where that corner is.
//
// Two numbers come out of each plane and they answer different questions:
//
//   CONFIDENCE — sigmoid(peak). "How sure is the model there is a corner
//   here." Calibrated by training, and it drifts if the model is re-exported.
//
//   PEAK SIGMA — (peak - mean) / std over the plane. "Is there a peak at all,
//   or is this plane diffuse?" Scale-free and calibration-free, so it survives
//   a re-export. The reference implementation computes exactly this.
//
// ⚠️ DO NOT GATE ON SIGMA AT 5.0. The reference has a PEAK_SIGMA_THRESHOLD of
// 5.0 and the check that used it is COMMENTED OUT in their shipping code —
// they wrote it, tried it, and disabled it. Measured on our own fixtures:
// 640 corner-measurements, min 1.79, median 3.14, max 4.47, and not one
// reaches 5.0 — including on the eleven photographs where the model finds the
// document correctly. A gate at 5.0 would refuse everything. Sigma is worth
// reporting and worth watching; it is not a threshold to accept or reject on.
// What the reference actually gates on is GEOMETRY, and so should we.
// ────────────────────────────────────────────────────────────────────

/** One corner, as the model sees it. */
export interface CornerReading {
  /** sigmoid of the peak logit — the model's own calibrated confidence. */
  confidence: number;
  /** (peak - mean) / std over this corner's plane. Diffuseness, scale-free. */
  sigma: number;
  /** Was the peak out on the letterbox padding rather than on the frame? */
  onPadding: boolean;
}

export interface DocQuadReading {
  /** The four corners in SOURCE frame coordinates, TL TR BR BL. */
  quad: Quad;
  corners: [CornerReading, CornerReading, CornerReading, CornerReading];
  /** The weakest corner's confidence — min over parts, never a mean. */
  minConfidence: number;
  /** The weakest corner's sigma. */
  minSigma: number;
}

function sigmoid(x: number): number {
  // Split by sign so neither branch can overflow exp() on a large logit.
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Peak, mean and standard deviation over one 64x64 plane.
 *
 * One pass for the peak and the sums, a second for the variance — the
 * numerically naive single-pass form loses precision on logits that can sit
 * far from zero, and this runs a handful of times per frame, not per pixel.
 */
function planeStats(
  heatmaps: Float32Array,
  channel: number,
): { peak: number; col: number; row: number; mean: number; std: number } {
  const n = HEATMAP_SIZE * HEATMAP_SIZE;
  const base = channel * n;
  let peak = -Infinity;
  let col = 0;
  let row = 0;
  let sum = 0;
  for (let y = 0; y < HEATMAP_SIZE; y++) {
    for (let x = 0; x < HEATMAP_SIZE; x++) {
      const v = heatmaps[base + y * HEATMAP_SIZE + x];
      sum += v;
      if (v > peak) {
        peak = v;
        col = x;
        row = y;
      }
    }
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = heatmaps[base + i] - mean;
    varSum += d * d;
  }
  return { peak, col, row, mean, std: Math.sqrt(varSum / n) };
}

/**
 * Read the four corners out of the model's heatmaps.
 *
 * Returns them in the SOURCE frame's own coordinates — the letterbox is
 * undone here so no caller ever has to remember to do it. Forgetting that
 * step has silently broken this project's measurements more than once, and a
 * function that returns coordinates in an intermediate space is an invitation
 * to forget it again.
 */
/**
 * Half-width of the window the sub-cell peak is refined over. 2 = a 5x5 patch.
 */
export const REFINE_RADIUS = 2;

/**
 * Where the peak sits WITHIN its cell, as a fractional (col, row).
 *
 * ⚠️ THE ARGMAX ALONE QUANTISES EVERY CORNER TO A 64-CELL GRID. One cell is 4
 * model pixels, which is ~17 source pixels on a 1080-wide frame and ~6 CSS
 * pixels on a phone screen. A corner sitting near a cell boundary flips
 * between the two cells on sensor noise, so a perfectly still document
 * produced a quad that stepped 6px at a time — the twitch every smoothing
 * pass since has been fighting, and no filter setting removes a signal that
 * only ever lands on a grid.
 *
 * The heatmap is a blurred peak, so its mass around the argmax says where the
 * true maximum is between cells. Weights are exp(logit - peak): the peak cell
 * weighs 1, a cell one nat below it 0.37, and the background (typically ten
 * or more nats down) contributes nothing. That last property is what makes
 * this safe on an isolated peak — it reads exactly the cell centre, so every
 * fixture measured on the integer readout still measures the same.
 *
 * The window clips at the plane edge rather than wrapping. A peak on the edge
 * row is pulled a fraction of a cell inward by the missing rows, which is the
 * right direction for a corner the model is placing on the letterbox padding.
 */
export function refinePeak(
  heatmaps: Float32Array,
  channel: number,
  col: number,
  row: number,
  peak: number,
): { col: number; row: number } {
  const n = HEATMAP_SIZE * HEATMAP_SIZE;
  const base = channel * n;
  let wsum = 0;
  let cx = 0;
  let cy = 0;
  for (let dy = -REFINE_RADIUS; dy <= REFINE_RADIUS; dy++) {
    const y = row + dy;
    if (y < 0 || y >= HEATMAP_SIZE) continue;
    for (let dx = -REFINE_RADIUS; dx <= REFINE_RADIUS; dx++) {
      const x = col + dx;
      if (x < 0 || x >= HEATMAP_SIZE) continue;
      const w = Math.exp(heatmaps[base + y * HEATMAP_SIZE + x] - peak);
      wsum += w;
      cx += w * x;
      cy += w * y;
    }
  }
  if (!(wsum > 0) || !Number.isFinite(wsum)) return { col, row };
  return { col: cx / wsum, row: cy / wsum };
}

export function readCorners(
  heatmaps: Float32Array,
  lb: Letterbox,
): DocQuadReading {
  const pts = [];
  const corners = [];
  for (let c = 0; c < 4; c++) {
    const s = planeStats(heatmaps, c);
    const fine = refinePeak(heatmaps, c, s.col, s.row, s.peak);
    const modelPt = cellToModelSpace(fine.col, fine.row);
    pts.push(toSourceSpace(lb, modelPt));
    corners.push({
      confidence: sigmoid(s.peak),
      // A flat plane has no peak to speak of; report 0 rather than dividing
      // by a vanishing std and reporting a spectacular one.
      sigma: s.std > 1e-6 ? (s.peak - s.mean) / s.std : 0,
      onPadding: !insideContent(lb, modelPt),
    });
  }
  const cs = corners as DocQuadReading['corners'];
  return {
    quad: pts as unknown as Quad,
    corners: cs,
    minConfidence: Math.min(...cs.map((c) => c.confidence)),
    minSigma: Math.min(...cs.map((c) => c.sigma)),
  };
}

/**
 * Does the mask output say a document is present at all?
 *
 * ⚠️ THE MODEL'S SECOND OUTPUT, WHICH WE HAVE BEEN THROWING AWAY. It emits
 * `mask_logits` [1, 1, 64, 64] alongside the corners, and every harness so
 * far has discarded it. The corner heads always produce four peaks — they
 * have to, there are four planes and each has a maximum — so the corners
 * alone can never say "there is nothing here". The mask can.
 *
 * Returns the fraction of the plane the model thinks is document. An empty
 * frame should read near zero; a framed document a substantial fraction.
 * No threshold is applied here on purpose: nothing has measured what the
 * right one is on our documents, and inventing one is how the sigma gate
 * ended up in the code.
 */
export function maskCoverage(maskLogits: Float32Array): number {
  const n = HEATMAP_SIZE * HEATMAP_SIZE;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    // logit > 0 is probability > 0.5
    if (maskLogits[i] > 0) hits++;
  }
  return hits / n;
}
