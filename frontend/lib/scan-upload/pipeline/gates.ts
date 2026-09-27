import type { Quad } from './geometry';
import { dist, linearFill, perspectiveScore, touchesEdge } from './geometry';
import { cropImageData } from './locate';

/** Luma from RGBA, one byte per pixel. */
export function toGrey(img: ImageData): Uint8ClampedArray {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8;
  }
  return out;
}

/**
 * Sharpness: variance of the Laplacian, computed per block, averaged over
 * the sharpest fifth of blocks so blank margins do not drag the number down.
 * Absolute values depend on the camera; calibrate the thresholds per device
 * class, never trust them across phones.
 */
export function sharpness(grey: Uint8ClampedArray, width: number, height: number, block = 32): number {
  const scores: number[] = [];
  for (let by = 1; by + block < height - 1; by += block) {
    for (let bx = 1; bx + block < width - 1; bx += block) {
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let y = by; y < by + block; y++) {
        const row = y * width;
        for (let x = bx; x < bx + block; x++) {
          const i = row + x;
          const lap = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
          sum += lap;
          sum2 += lap * lap;
          n++;
        }
      }
      const mean = sum / n;
      scores.push(sum2 / n - mean * mean);
    }
  }
  if (scores.length === 0) return 0;
  scores.sort((a, b) => b - a);
  const top = scores.slice(0, Math.max(1, Math.floor(scores.length / 5)));
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/**
 * How crisp the document's print is, free of contrast and of how much of it
 * there is: the second derivative over the first, summed over edge pixels.
 * A step edge blurred wider gives the same gradient but a smaller Laplacian,
 * so the ratio falls as focus is lost. Scaled by 100. On 63 phone stills the
 * blurry ones measured 115-150 on their preview and the readable ones 160-250.
 * `null` when the region has too few edges to say (a blank patch).
 */
export function edgeCrispness(grey: Uint8ClampedArray, width: number, height: number): number | null {
  if (width < 3 || height < 3) return null;
  let sumLap = 0;
  let sumGrad = 0;
  let edges = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const gx = grey[i + 1] - grey[i - 1];
      const gy = grey[i + width] - grey[i - width];
      const grad = Math.sqrt(gx * gx + gy * gy) / 2;
      if (grad < EDGE_FLOOR) continue;
      const l = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
      sumLap += l < 0 ? -l : l;
      sumGrad += grad;
      edges++;
    }
  }
  if (edges < MIN_EDGE_SHARE * (width - 2) * (height - 2) || sumGrad === 0) return null;
  return (100 * sumLap) / sumGrad;
}
/** Gradient (per pixel) below which a pixel is flat, not an edge: sensor noise sits under this. */
const EDGE_FLOOR = 6;
/** Fewer edge pixels than this share and there is nothing to judge focus on. */
const MIN_EDGE_SHARE = 0.005;

/**
 * Width, in pixels, the document's outline is scaled to before its text is
 * measured. Text strokes then have the same pixel width whatever the phone
 * or the distance, so one threshold serves all. Never upscaled: a small
 * outline is measured as it is.
 */
export const TEXT_MEASURE_WIDTH = 400;
/** Share of the outline's box left out on each side: the border and the edge of the table. */
export const TEXT_INSET = 0.12;

export interface Exposure {
  mean: number;
  /** Fraction of pixels at or above 250. */
  clippedHigh: number;
  /** Fraction of pixels at or below 10. */
  clippedLow: number;
  /** P95 - P5 of luma. */
  contrast: number;
}

export function exposure(grey: Uint8ClampedArray): Exposure {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;
  const n = grey.length;
  let sum = 0;
  let high = 0;
  let low = 0;
  for (let v = 0; v < 256; v++) {
    sum += v * hist[v];
    if (v >= 250) high += hist[v];
    if (v <= 10) low += hist[v];
  }
  const pct = (p: number): number => {
    let acc = 0;
    const target = n * p;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  return { mean: sum / n, clippedHigh: high / n, clippedLow: low / n, contrast: pct(0.95) - pct(0.05) };
}

/**
 * Fraction of pixels that are fully blown out AND colourless: specular glare,
 * not bright white paper. Measure it on camera pixels, never on a normalised
 * page (normalisation pushes paper up to white and would count all of it).
 */
export function glareFraction(img: ImageData, minLuma = 250, maxSaturation = 0.12): number {
  const { data } = img;
  let hits = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    if (max < minLuma) continue;
    const min = Math.min(r, g, b);
    if ((max - min) / max < maxSaturation) hits++;
  }
  return hits / n;
}

export type Hint =
  | 'searching'
  | 'closer'
  | 'flat'
  | 'edge'
  | 'dark'
  | 'glare'
  | 'blur'
  | 'focus'
  | 'far'
  | 'ok';

export const HINT_TEXT: Record<Hint, string> = {
  searching: 'Point your phone at the page',
  closer: 'Move a bit closer',
  flat: 'Hold the phone flat above the page',
  edge: 'Move back a little',
  dark: 'Too dark - find more light',
  glare: 'Glare - tilt the phone a little',
  blur: 'Hold still...',
  focus: 'Hold still, focusing...',
  far: 'Too close to focus - move back a little',
  ok: 'Hold still...',
};

export interface GateThresholds {
  /** Fallback linear fill when the still size is unknown. */
  minFill: number;
  minPerspective: number;
  minBrightness: number;
  maxGlare: number;
  minSharpness: number;
  /** Edge crispness of the document's text (see `edgeCrispness`) below which the print is out of focus. */
  minCrispness: number;
  /** Fill this far beyond what the still needs, with soft text, means the phone is inside its focus distance. */
  tooCloseFactor: number;
  /**
   * The crispness bar for a preview that is softer than the photo it stands
   * for. Android's 1080p preview is scaled and noise-reduced on the way out of
   * the sensor; a Samsung whose photo grades crisp shows 115-145 in its
   * preview, and 100-110 when it is too close. The photo itself is judged at
   * `minCrispness` again before it is accepted.
   */
  minCrispnessSoftPreview: number;
  /** Whether soft print holds the shutter. A preview that cannot be trusted only says "too close". */
  holdForFocus: boolean;
  /** The bar for the photo itself, judged where the live outline says the print is, before it is accepted. */
  minPhotoCrispness: number;
}

/**
 * Defaults. Fill is the linear share of the frame (60%, the operator's
 * number; Scanbot ships 80 of either side). Sharpness is a placeholder to
 * calibrate on real phones.
 */
export const DEFAULT_GATES: GateThresholds = {
  minFill: 0.6,
  minPerspective: 0.75,
  minBrightness: 70,
  maxGlare: 0.02,
  minSharpness: 40,
  // From 63 phone stills: blurry ones measured 115-150 on their preview, readable ones 160-250.
  minCrispness: 155,
  tooCloseFactor: 1.3,
  minCrispnessSoftPreview: 115,
  holdForFocus: true,
  // On 84 archived photos: blurry ones (grade under 500) measured 111-170, readable ones 153-253.
  minPhotoCrispness: 175,
};

/**
 * The thresholds for a live preview that is softer than the still it stands
 * for (Android). Its crispness is too noisy to hold the shutter on, so it
 * only warns when the phone is plainly too close; the photo is judged instead.
 */
export function softPreviewGates(th: GateThresholds = DEFAULT_GATES): GateThresholds {
  return { ...th, minCrispness: th.minCrispnessSoftPreview, holdForFocus: false };
}

/**
 * Box downscale by a whole or fractional factor, area-averaged. The crispness
 * measure needs a true low-pass downscale: a canvas draw at 'low' quality
 * keeps aliased high frequencies that read as crisp edges.
 */
export function boxDownscale(img: ImageData, factor: number): ImageData {
  if (factor <= 1.001) return img;
  const W = Math.max(1, Math.floor(img.width / factor));
  const H = Math.max(1, Math.floor(img.height / factor));
  const out = new ImageData(W, H);
  const src = img.data;
  const dst = out.data;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * factor);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * factor)));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * factor);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * factor)));
      let r = 0;
      let gg = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++) {
          r += src[i];
          gg += src[i + 1];
          b += src[i + 2];
          n++;
          i += 4;
        }
      }
      const o = (y * W + x) * 4;
      dst[o] = r / n;
      dst[o + 1] = gg / n;
      dst[o + 2] = b / n;
      dst[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Crispness of the print in the inside of a document's box, where the box
 * (before the inset) was `outlineWidth` pixels wide: scaled so that width is
 * `TEXT_MEASURE_WIDTH`, never up, then `edgeCrispness`.
 */
export function regionCrispness(region: ImageData, outlineWidth: number): number | null {
  const small = boxDownscale(region, outlineWidth / TEXT_MEASURE_WIDTH);
  return edgeCrispness(toGrey(small), small.width, small.height);
}

/** Crispness of a document's print in an image, given its outline (see `regionCrispness`). */
export function documentCrispness(image: ImageData, quad: Quad): number | null {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  const x0 = Math.max(0, Math.round(Math.min(...xs) + bw * TEXT_INSET));
  const y0 = Math.max(0, Math.round(Math.min(...ys) + bh * TEXT_INSET));
  const x1 = Math.min(image.width, Math.round(Math.max(...xs) - bw * TEXT_INSET));
  const y1 = Math.min(image.height, Math.round(Math.max(...ys) - bh * TEXT_INSET));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  return regionCrispness(cropImageData(image, { x0, y0, x1, y1 }), bw);
}

/** Pixels a document should span in the still along its longer side: enough for OCR at ~300 dpi. */
export const WANTED_PX = { card: 1100, page: 1700 };

/**
 * How much of the frame the document must fill, from what the still will
 * deliver. A 12 MP photo needs far less fill than a 1080p frame for the same
 * pixels on the card, and asking for more just pushes the phone inside its
 * focus distance. Clamped so the live outline stays big enough to track.
 */
export function requiredFill(quad: Quad, frameW: number, frameH: number, still: { width: number; height: number } | undefined, fallback: number): number {
  if (!still || still.width < 64 || still.height < 64) return fallback;
  const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const cardLike = w / h > 1.2 || h / w > 1.2 ? (w > h ? w / h : h / w) > 1.5 : false;
  // The fill measure is the larger of the width and height shares; the still's
  // matching dimension times that share is the document's pixel span. Where the
  // preview is a centred crop of a wider still (a 16:9 preview of a 4:3 photo),
  // only the part of the still the preview shows counts.
  const widthLimited = w / frameW >= h / frameH;
  const scale = Math.min(still.width / frameW, still.height / frameH);
  const stillSpan = widthLimited ? frameW * scale : frameH * scale;
  const wanted = cardLike ? WANTED_PX.card : WANTED_PX.page;
  return Math.min(fallback, Math.max(0.3, wanted / stillSpan));
}

export interface GateResult {
  pass: boolean;
  hint: Hint;
  fill: number;
  /** The fill this frame needed to pass. */
  fillNeeded: number;
  perspective: number;
  brightness: number;
  glare: number;
  sharpness: number;
  /** Edge crispness of the document's text, when it was measured. */
  crispness: number | null;
}

/** Evaluate every gate on the live frame. One hint at a time, most actionable first. */
export function evaluateGates(
  quad: Quad | null,
  frame: ImageData,
  grey: Uint8ClampedArray,
  th: GateThresholds = DEFAULT_GATES,
  still?: { width: number; height: number },
  /** Crispness of the document's text from the native-resolution preview, when measured. */
  crispness: number | null = null,
): GateResult {
  const exp = exposure(grey);
  const glare = glareFraction(frame);
  const sharp = sharpness(grey, frame.width, frame.height);
  const base = { fill: 0, fillNeeded: th.minFill, perspective: 0, brightness: exp.mean, glare, sharpness: sharp, crispness };
  if (!quad) {
    // With nothing found, only complain about light when it is really dark: a dark
    // table with no page on it is normal, and "Too dark" would nag on every desk.
    return { ...base, pass: false, hint: exp.mean < th.minBrightness * 0.6 ? 'dark' : 'searching' };
  }
  const fill = linearFill(quad, frame.width, frame.height);
  const fillNeeded = requiredFill(quad, frame.width, frame.height, still, th.minFill);
  const persp = perspectiveScore(quad);
  const r = { ...base, fill, fillNeeded, perspective: persp };
  if (exp.mean < th.minBrightness) return { ...r, pass: false, hint: 'dark' };
  if (touchesEdge(quad, frame.width, frame.height)) return { ...r, pass: false, hint: 'edge' };
  if (fill < fillNeeded) return { ...r, pass: false, hint: 'closer' };
  if (persp < th.minPerspective) return { ...r, pass: false, hint: 'flat' };
  if (glare > th.maxGlare) return { ...r, pass: false, hint: 'glare' };
  if (sharp < th.minSharpness) return { ...r, pass: false, hint: 'blur' };
  if (crispness !== null && crispness < th.minCrispness) {
    // Soft print with the document much bigger than the still needs: the lens
    // cannot focus this close. Otherwise the camera is still hunting; give it
    // a moment, where the preview can be trusted to say so.
    if (fill > fillNeeded * th.tooCloseFactor) return { ...r, pass: false, hint: 'far' };
    if (th.holdForFocus) return { ...r, pass: false, hint: 'focus' };
  }
  return { ...r, pass: true, hint: 'ok' };
}
