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

// ────────────────────────────────────────────────────────────────────
// UPLOAD-FORK ONLY: page-aware orientation for the file picker.
//
// The scanner leaves a page exactly as it was held, because its
// upside-down heuristic was not trustworthy (see the comment above). A
// portrait certificate uploaded from the gallery is the case that
// exposes it: the member photographed it upright, but the phone stored
// it with the long edge first, so the page lands sideways and the
// annexure renders it rotated 90°.
//
// Unlike "which end is up", "which way is sideways" IS decidable from
// the text, because the property that separates the two axes is the
// blank rows between lines — and it is one-sided. A page of text set
// horizontally has, as it is read down, wide blank bands between the
// lines: the fraction of rows carrying no ink is large (most of the
// page). Turn that same page a quarter turn and the lines become tall
// vertical bands; every scan row now crosses those bands, so almost no
// row is blank and the fraction collapses toward zero. Upright text:
// 0.5–0.8 blank. The same text on its side: ~0.00. That gap is the
// axis, and it is wide enough to survive noise and skew.
//
// ⚠️ WHY NOT uprightScore() ITSELF. Its magnitude looked like the
// natural reading measure, but its per-line term is (above − below) /
// runMax — a signed quantity. On the heavy documents this exists for
// (a certificate whose capital/ascender band is dense) the x-height
// "core" run swallows that band, and the term cancels to ≈0; a plain
// upright page then scores as if it had no line structure at all,
// which is exactly the condition for being turned. That is the
// verifier's counterexample: an upright page returned 180. The sign
// was never the problem to fix and the magnitude does not survive the
// case the function is for, so neither is used here.
//
// ⚠️ AND WHY NOT A LINE-COUNT. Counting runs of inked rows seemed the
// obvious form of the same idea, but it does not separate the axes:
// rotating the text turns the inter-line gaps into *column* gaps, so a
// scan row crosses ~N glyph gaps and the sideways page scores ~N
// against the upright page's ~N lines. The count is almost axis-blind;
// the blank-row fraction is not.
//
// So the job here is narrowed to the axis alone, which is the bug that
// was reported: a page whose text is on its side gets a quarter turn
// to bring the lines back horizontal, and a page already reading
// horizontally is LEFT EXACTLY AS IT WAS HELD. Which of the two
// quarter turns is the right way up cannot be told from the ink —
// nothing here distinguishes a page from its own 180° flip, which is
// why 180 is never applied — so half the time the quarter turn picks
// the wrong end and Rotate on the review screen fixes it. A wrong flip
// is worse than none; a sideways page is worse than either.
//
// This lives only in the upload's copy; nothing here is exported into
// the scanner.
// ────────────────────────────────────────────────────────────────────

/** A row is "blank" when its ink falls below this share of the busiest row. */
const BLANK_ROW_FLOOR = 0.06;

/** The reading axis must show at least this share of blank rows; less is no reading. */
const MIN_BLANK_FRACTION = 0.15;

/** And it must beat the other axis by this factor, or the page is left alone. */
const AXIS_EDGE = 1.5;

/**
 * How strongly a page reads as horizontal text: of the rows the text actually
 * spans, the fraction left blank between the lines.
 *
 * ⚠️ THE SPAN MATTERS. A first cut took the blank fraction over the WHOLE page,
 * and that silently measured text-width rather than line structure. A page
 * whose text is a narrow centred column has blank side margins; turn it a
 * quarter turn and those margins become blank *rows* above and below the
 * block, so the sideways page reports a HIGH blank fraction and the comparison
 * inverts — an upright page gets turned and a sideways one is missed. Measuring
 * only from the first inked row to the last ignores the margins and looks at
 * the gaps that are the line structure, which survive the transpose.
 *
 * This is the *axis* measure and it is deliberately one-sided — it measures
 * line structure, it does not ask which way up the lines read.
 */
function horizontalBlankFraction(
  grey: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let sum = 0;
  for (let i = 0; i < grey.length; i++) sum += grey[i];
  const mean = sum / grey.length;
  const thr = Math.min(180, mean - 45);
  const rows = new Float32Array(height);
  const mx = Math.round(width * 0.04); // frames and edges are not text
  for (let y = 0; y < height; y++) {
    let n = 0;
    const row = y * width;
    for (let x = mx; x < width - mx; x++) if (grey[row + x] < thr) n++;
    rows[y] = n;
  }
  let max = 0;
  for (let y = 0; y < height; y++) if (rows[y] > max) max = rows[y];
  if (max === 0) return 1; // a blank page is all blank; no reading either way
  const floor = BLANK_ROW_FLOOR * max;
  // The span the text occupies: first to last row carrying ink.
  let first = -1;
  let last = -1;
  for (let y = 0; y < height; y++) {
    if (rows[y] > floor) {
      if (first < 0) first = y;
      last = y;
    }
  }
  const span = last - first + 1;
  let blank = 0;
  for (let y = first; y <= last; y++) if (rows[y] <= floor) blank++;
  return blank / span;
}

/**
 * Choose a rotation for an A4 page or an unrecognised document: if the text
 * only shows its line structure after a quarter turn, turn the page to bring
 * the lines back horizontal; otherwise leave it exactly as it was held.
 *
 * Never returns 180: "which end is up" is not answerable from the ink (see
 * the note above), and a wrong flip is the failure this whole function exists
 * to avoid.
 */
export function chooseRotationPage(img: ImageData, shape: DocShape): Rotation {
  // A card keeps the scanner's rule exactly: landscape, sign decides up/down.
  if (shape === 'card') return chooseRotation(img, shape);

  const small = downscale(img, 900);
  const grey = toGrey(small);
  /** Blank-row fraction after turning the page by `rot` — high means it reads horizontally. */
  const reading = (rot: Rotation): number => {
    if (rot === 0) return horizontalBlankFraction(grey, small.width, small.height);
    const turned = rotateImageData(small, rot);
    return horizontalBlankFraction(toGrey(turned), turned.width, turned.height);
  };

  // As held (0 or 180 — the same axis) versus on its side (90 or 270). The two
  // in a pair score identically: a half turn preserves the row profile, and
  // nothing here can tell a page from its own 180° flip.
  const held = reading(0);
  const sideways = reading(90);

  if (sideways < MIN_BLANK_FRACTION || sideways < AXIS_EDGE * held) return 0;
  // Its text is on its side, so a quarter turn restores it. Which of the two
  // is the right way up is not decidable; 90 and 270 are equivalent here.
  return 90;
}
