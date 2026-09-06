import type { DocShape } from '../types';
import { toGrey } from './gates';

/** Nearest-neighbour downscale, canvas-free so this module runs in node for the bench. */
function downscale(img: ImageData, maxEdge: number): ImageData {
  const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
  if (s === 1) return img;
  const W = Math.max(1, Math.round(img.width * s));
  const H = Math.max(1, Math.round(img.height * s));
  const out = new ImageData(W, H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / s));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / s));
      const i = (sy * img.width + sx) * 4;
      const oi = (y * W + x) * 4;
      out.data[oi] = img.data[i];
      out.data[oi + 1] = img.data[i + 1];
      out.data[oi + 2] = img.data[i + 2];
      out.data[oi + 3] = 255;
    }
  }
  return out;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Rotate RGBA pixels clockwise by a multiple of 90 degrees. */
export function rotateImageData(img: ImageData, rot: Rotation): ImageData {
  if (rot === 0) return img;
  const { width: w, height: h, data: s } = img;
  const out = rot === 180 ? new ImageData(w, h) : new ImageData(h, w);
  const d = out.data;
  const ow = out.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let ox: number;
      let oy: number;
      if (rot === 90) {
        ox = h - 1 - y;
        oy = x;
      } else if (rot === 180) {
        ox = w - 1 - x;
        oy = h - 1 - y;
      } else {
        ox = y;
        oy = w - 1 - x;
      }
      const o = (oy * ow + ox) * 4;
      d[o] = s[i];
      d[o + 1] = s[i + 1];
      d[o + 2] = s[i + 2];
      d[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Upright score for a page whose text runs horizontally: positive when the
 * text reads the right way up. Printed Latin lines put more ink above the
 * dense x-height band (capitals, ascenders, accents) than below it
 * (descenders only), so for each text line we compare the ink just above the
 * band with the ink just below it. Summed over the lines, the sign says
 * which way is up; the magnitude says how sure.
 */
export function uprightScore(grey: Uint8ClampedArray, width: number, height: number): number {
  // Ink mask from a global threshold: pages reach here normalised, paper near white.
  let sum = 0;
  for (let i = 0; i < grey.length; i++) sum += grey[i];
  const mean = sum / grey.length;
  const thr = Math.min(180, mean - 45);
  const rows = new Float32Array(height);
  // Ignore a border band: frames and edges are not text.
  const mx = Math.round(width * 0.04);
  for (let y = 0; y < height; y++) {
    let n = 0;
    const row = y * width;
    for (let x = mx; x < width - mx; x++) if (grey[row + x] < thr) n++;
    rows[y] = n;
  }
  let max = 0;
  for (let y = 0; y < height; y++) if (rows[y] > max) max = rows[y];
  if (max === 0) return 0;
  // Text lines: runs of rows with ink, separated by near-empty rows.
  const lineThr = 0.06 * max;
  let score = 0;
  let y = 0;
  while (y < height) {
    if (rows[y] <= lineThr) {
      y++;
      continue;
    }
    const start = y;
    while (y < height && rows[y] > lineThr) y++;
    const end = y; // exclusive
    const len = end - start;
    if (len < 6 || len > height * 0.25) continue; // not a text line (rule, box, picture)
    let runMax = 0;
    for (let r = start; r < end; r++) if (rows[r] > runMax) runMax = rows[r];
    // The dense band (x-height) is where most of the line's ink sits.
    const coreThr = 0.55 * runMax;
    let coreStart = start;
    while (coreStart < end && rows[coreStart] < coreThr) coreStart++;
    let coreEnd = end - 1;
    while (coreEnd > coreStart && rows[coreEnd] < coreThr) coreEnd--;
    let above = 0;
    for (let r = start; r < coreStart; r++) above += rows[r];
    let below = 0;
    for (let r = coreEnd + 1; r < end; r++) below += rows[r];
    // Weight by line prominence, and cap so one heavy title does not decide alone.
    const weight = Math.min(1, runMax / (0.5 * max));
    score += weight * (above - below) / Math.max(1, runMax);
  }
  return score;
}

/**
 * Decide how to rotate a rectified page so it reads naturally:
 * cards are landscape, pages keep their orientation, and both get the
 * right way up from the text.
 */
/** Below this |score| the text gives no clear answer and the page is left as it was held. */
export const UPRIGHT_MIN_CONFIDENCE = 0.5;

export function chooseRotation(img: ImageData, shape: DocShape): Rotation {
  const small = downscale(img, 900);
  const portrait = small.height > small.width;
  // First the coarse orientation: a card is landscape.
  let base: ImageData = small;
  let rot: Rotation = 0;
  if (shape === 'card' && portrait) {
    base = rotateImageData(small, 90);
    rot = 90;
  }
  // Then up versus down from the text.
  const grey = toGrey(base);
  const s = uprightScore(grey, base.width, base.height);
  // A page or card held the way it was is never turned over. The text
  // asymmetry was meant to catch an upside-down page on clear evidence, and on
  // real documents it is not evidence: on the operator's certificates it scored
  // -19 on an upright statement of results and -2 on an upright SAPS 524
  // (boxed fields, watermarks, arched titles), and on licence cards +21 and -4
  // for the same card. Nine of nineteen finished pages would have been turned
  // the wrong way. Members almost always hold a document upright, a wrong flip
  // is worse than none, and Rotate on the review screen is one tap away. A
  // sideways card still has to be turned one way or the other, so the sign
  // decides there and nowhere else.
  const flip = rot === 90 ? s < 0 : false;
  if (flip) rot = ((rot + 180) % 360) as Rotation;
  return rot;
}
