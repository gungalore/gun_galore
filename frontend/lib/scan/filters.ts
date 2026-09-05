import { Raster } from './warp';
import {
  enhance,
  flattenLuma,
  lumaPlane,
  meanAbsLaplacian,
  sharpenPlan,
  shrink,
  suppressCreases,
  unsharp,
} from './enhance';

// ────────────────────────────────────────────────────────────────────
// THE FILTER SET.
//
// Pure: RGBA in, RGBA out, no DOM. Runs ONCE on the rectified page, so it can
// afford to be accurate — but it runs on a PHONE, on a raster that can be
// 3000px on the long edge, and a member watching a spinner counts every
// hundred milliseconds. Every pass below is either separable, integral-image
// based, or done on a downsampled plane and grown back.
//
// ⚠️ enhance.ts SAYS "NO BINARISATION" AND IT IS STILL RIGHT — about ITSELF.
// The default cleanup that feeds the vision model must not binarise: a
// multimodal model reads a well-exposed grey image better than a 1-bit one,
// and 1 bit destroys the colour and security print the CLASSIFIER uses to
// tell a firearm licence from a competency certificate. What changed is that
// the member now also gets a CHOICE. `bw` exists because a photocopy of a
// typed form, a fax, or a form somebody wants to print is genuinely better
// 1-bit, and because every scanner app they have ever used offers it. It is
// opt-in and it is never what `auto` picks for a card with a photograph on it.
//
// The four modes, in the words the member sees:
//
//   Auto    — look at the page and pick one of the three below.
//   Colour  — white-balance, then flatten the lighting. The default.
//   Grey    — flatten, drop the colour, stretch what is left.
//   B&W     — adaptive threshold. Text becomes ink, paper becomes paper.
//
// "Original" is not a filter, it is the absence of one, and it lives in
// capture.ts's `ScanFilter` rather than here.
// ────────────────────────────────────────────────────────────────────

/** A filter that actually processes pixels. `auto` resolves to one of these. */
export type FilterMode = 'colour' | 'grey' | 'bw';

/**
 * Everything the review screen can ask for.
 *
 * ⚠️ 'shadow' IS A STORED VALUE, NOT A MODE. It was the original name for what
 * is now `colour`, it is what every ScanResult built before this change
 * carries, and `document-scanner.tsx` still defaults to it. Accepting it as an
 * alias costs one line and is the difference between an old page re-filtering
 * and an old page throwing.
 */
export type FilterChoice = FilterMode | 'auto' | 'none' | 'shadow';

// ────────────────────────────────────────────────────────────────────
// WHITE BALANCE
// ────────────────────────────────────────────────────────────────────

/**
 * Sampling stride. We are estimating three numbers and a histogram, not
 * measuring anything per-pixel, so a quarter of a million samples is already
 * far more than the estimate can use. At 3000x2250 this looks at one pixel in
 * 27 and turns a 6.75-megapixel pass into a 250k one.
 */
const STAT_SAMPLES = 250_000;

function statStride(pixels: number): number {
  return Math.max(1, Math.floor(pixels / STAT_SAMPLES));
}

export interface PaperColour {
  /** The colour bare paper came out as, per channel. */
  r: number;
  g: number;
  b: number;
  /** What to multiply each channel by to make that paper neutral. */
  gain: [number, number, number];
}

/**
 * THE COLOUR OF THE PAPER, AND WHAT IT TAKES TO NEUTRALISE IT.
 *
 * Estimated from the brightest quarter of the page, because on a document that
 * is the paper — ink is dark by construction and a photograph is a small
 * minority of the area. A mean over "bright pixels" is far more robust here
 * than the usual grey-world assumption, which a page of black text on white
 * paper violates completely (grey-world would read the page as too bright and
 * do nothing useful).
 *
 * ⚠️ THE TARGET IS THE MEAN OF THE THREE CHANNELS, NOT THE BRIGHTEST OF THEM,
 * AND THAT IS THE WHOLE POINT ON A GREEN ID BOOK. Balancing to the brightest
 * channel means every gain is ≥ 1, so on a green page the red and blue
 * channels get multiplied by 1.5 and the green stays where it is — and then
 * the flattening in enhance() lifts the luma to white on top of that, and
 * green is the channel that clips, because green is 59% of luma. Balancing to
 * the MEAN pulls the strong channel DOWN and pushes the weak ones up, so the
 * page arrives at the flattening step already neutral and no channel has
 * anywhere to clip to.
 *
 * ⚠️ WHAT THIS COSTS, SAID OUT LOUD. A page whose paper is GENUINELY green
 * comes back with neutral paper, and CLAUDE.md is right that our classifier
 * reads colour to tell a firearm licence from a competency certificate. That
 * cue is the paper's overall tint, and a single photograph cannot separate a
 * green page under white light from a white page under green light — it is the
 * colour-constancy ambiguity, not an oversight. What survives is every colour
 * that DIFFERS from the paper: the photograph, the security overprint, a red
 * stamp, coloured ink. And WITHOUT this step that page is not better off,
 * it is worse: its green channel clips, so the tint is not preserved, it is
 * caricatured. Meanwhile `chooseMode` still routes such a page to `colour`
 * rather than to B&W, so every one of those differences is still there to be
 * read.
 *
 * Estimated from the brightest quarter rather than from a per-channel
 * `paperField`: three fields cost three times what one does and the answer is
 * a single triple, not a map. If a page ever needs a per-region balance —
 * half of it under a lamp, half under a window — that is where to start.
 */
export function paperColour(r: Raster): PaperColour {
  const px = r.width * r.height;
  const step = statStride(px);
  const d = r.data;

  // Pass one: where is the bright quarter?
  const hist = new Float64Array(256);
  let n = 0;
  for (let p = 0; p < px; p += step) {
    const i = p * 4;
    const l = (77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8;
    hist[l]++;
    n++;
  }
  let cum = 0;
  let cut = 0;
  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (cum >= n * 0.75) {
      cut = b;
      break;
    }
  }

  // Pass two: the mean colour up there.
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let m = 0;
  for (let p = 0; p < px; p += step) {
    const i = p * 4;
    const l = (77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8;
    if (l < cut) continue;
    sr += d[i];
    sg += d[i + 1];
    sb += d[i + 2];
    m++;
  }
  if (m === 0) return { r: 255, g: 255, b: 255, gain: [1, 1, 1] };

  const pr = sr / m;
  const pg = sg / m;
  const pb = sb / m;
  const target = (pr + pg + pb) / 3;
  const hi = Math.max(pr, pg, pb);
  const lo = Math.max(1, Math.min(pr, pg, pb));

  // ⚠️ A NEUTRAL PAGE IS LEFT ALONE. Below a 2% cast the "correction" is
  // sensor noise and JPEG chroma subsampling, and multiplying by it only
  // moves the noise around. Doing nothing is a real answer.
  if (hi / lo < 1.02) return { r: pr, g: pg, b: pb, gain: [1, 1, 1] };

  // Clamped because a genuinely coloured SUBJECT — a page that really is
  // green card stock, photographed for what it is — should be neutralised,
  // not erased. 0.6/1.8 is roughly a full cast either way and stops a badly
  // estimated paper colour from inventing a cast of its own.
  const clamp = (v: number) => Math.max(0.6, Math.min(1.8, v));
  return {
    r: pr,
    g: pg,
    b: pb,
    gain: [clamp(target / pr), clamp(target / pg), clamp(target / pb)],
  };
}

/**
 * Neutralise the paper.
 *
 * Applied through three 256-entry lookup tables rather than three multiplies
 * per pixel: the input is 8-bit, so the table IS the function, and at 6.75
 * megapixels that is 20 million multiplies saved for 768 bytes.
 */
export function whiteBalance(r: Raster): Raster {
  const { gain } = paperColour(r);
  if (gain[0] === 1 && gain[1] === 1 && gain[2] === 1) return r;

  const lut = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  for (let c = 0; c < 3; c++) {
    for (let v = 0; v < 256; v++) lut[c][v] = v * gain[c];
  }
  const out = new Uint8ClampedArray(r.data.length);
  const d = r.data;
  const l0 = lut[0];
  const l1 = lut[1];
  const l2 = lut[2];
  for (let i = 0; i < d.length; i += 4) {
    out[i] = l0[d[i]];
    out[i + 1] = l1[d[i + 1]];
    out[i + 2] = l2[d[i + 2]];
    out[i + 3] = d[i + 3];
  }
  return { data: out, width: r.width, height: r.height };
}

// ────────────────────────────────────────────────────────────────────
// COLOUR
// ────────────────────────────────────────────────────────────────────

/**
 * The default. White-balance, then everything enhance() has always done.
 *
 * ⚠️ THE ORDER IS NOT NEGOTIABLE. enhance() re-applies its result as a
 * per-pixel GAIN so that hue survives — which means whatever cast the paper
 * had survives too, multiplied. Correcting the cast afterwards would be
 * correcting a clipped image: on the green ID book the green channel has
 * already hit 255 and there is nothing left in it to scale.
 */
export function colour(r: Raster): Raster {
  return enhance(whiteBalance(r));
}

// ────────────────────────────────────────────────────────────────────
// GREY
// ────────────────────────────────────────────────────────────────────

export interface GreyOptions {
  /** Divide the lighting out first. On unless you want the raw tones. */
  flatten?: boolean;
  /** The restrained unsharp mask, as in enhance(). */
  sharpen?: boolean;
  /** Take out a fold, as in enhance(). Needs `flatten`. */
  creases?: boolean;
  /** Percentile to pin to black / white. 0.01 is one percent at each end. */
  clip?: number;
}

/**
 * Greyscale with an automatic contrast stretch.
 *
 * ⚠️ FLATTENED FIRST, AND THAT IS NOT WHAT "AUTO-CONTRAST" USUALLY MEANS. A
 * percentile stretch is a GLOBAL operation: it finds one black point and one
 * white point for the whole page. Run on a page with the operator's hand
 * shadow across a corner, the shadowed paper is darker than the lit page's ink
 * and there is no pair of numbers that fixes both — you get either a grey
 * shadow or crushed text. Dividing the lighting out first makes the histogram
 * mean something, and only then is a global stretch the right tool.
 *
 * The 1%/99% clip is what makes it robust: a single blown specular pixel or
 * one black speck must not define the ends of the range, and on a real page
 * there are always a few of both.
 */
export function grey(r: Raster, opts: GreyOptions = {}): Raster {
  const flatten = opts.flatten ?? true;
  const sharpen = opts.sharpen ?? true;
  const creases = opts.creases ?? true;
  const clip = opts.clip ?? 0.01;
  const w = r.width;
  const h = r.height;

  const luma = lumaPlane(r);
  const plane = flatten ? flattenLuma(luma, w, h) : luma;

  // ⚠️ THE FOLD COMES OUT HERE TOO. Grey is not a lesser mode — it is what
  // `auto` picks for a photocopied form, which is exactly the kind of document
  // that arrives folded into three. Only when the flatten produced its own
  // plane: with flatten off, `plane` IS `luma`, which the stretch below still
  // needs unmodified.
  if (creases && plane !== luma) suppressCreases(plane, w, h);

  if (sharpen) {
    // ⚠️ THE SAME HALO-SUPPRESSED MASK enhance() USES, and on the same
    // schedule. This was a hand-rolled copy of the old symmetric 0.6-at-
    // radius-1, so a soft capture got the grey ring round every glyph here
    // whichever mode the member picked. Measured on the source luma, because
    // the question is how soft the OPTICS were and the flatten has already
    // moved the contrast.
    // `luma` is dead once the flatten has read it, so lend it to the blur
    // instead of letting it allocate — the same trade enhance() makes.
    const spare = plane !== luma ? luma : undefined;
    const sharpened = unsharp(
      plane,
      w,
      h,
      sharpenPlan(meanAbsLaplacian(luma, w, h, 2)),
      spare,
    );
    plane.set(sharpened);
  }

  // The stretch. One 256-bin histogram over a sampled subset — a percentile
  // does not get more accurate for looking at every pixel.
  const px = w * h;
  const step = statStride(px);
  const hist = new Float64Array(256);
  let n = 0;
  for (let p = 0; p < px; p += step) {
    hist[Math.max(0, Math.min(255, plane[p] | 0))]++;
    n++;
  }
  let lo = 0;
  let hi = 255;
  let cum = 0;
  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (cum >= n * clip) {
      lo = b;
      break;
    }
  }
  cum = 0;
  for (let b = 255; b >= 0; b--) {
    cum += hist[b];
    if (cum >= n * clip) {
      hi = b;
      break;
    }
  }
  // ⚠️ A NEARLY EMPTY PAGE MUST NOT BE STRETCHED. If the whole histogram fits
  // in a few levels the "contrast" being amplified is sensor noise, and the
  // member gets a snowstorm where they photographed a blank sheet.
  const span = hi - lo;
  const scale = span >= 12 ? 255 / span : 1;
  const shift = span >= 12 ? lo : 0;

  const out = new Uint8ClampedArray(r.data.length);
  for (let i = 0, p = 0; p < plane.length; i += 4, p++) {
    const v = (plane[p] - shift) * scale;
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = r.data[i + 3];
  }
  return { data: out, width: w, height: h };
}

// ────────────────────────────────────────────────────────────────────
// BLACK AND WHITE
// ────────────────────────────────────────────────────────────────────

/**
 * A summed-area table. `out[(y+1)*(w+1) + (x+1)]` is the sum of everything
 * above and left of (x,y) inclusive, so any rectangle's sum is four lookups
 * regardless of its size — which is what makes a window of a hundred-odd
 * pixels cost the same as a window of three.
 *
 * ⚠️ Float64, NOT Float32, AND IT IS NOT A LUXURY. The bottom-right entry of a
 * megapixel plane of 8-bit values is around 1.7e9; Float32 carries 24 bits of
 * mantissa, so it cannot represent that to better than about ±100. Every box
 * sum is a difference of two such numbers, so the error lands undiminished on
 * a quantity whose whole range is 0-255. The table is built on a DOWNSAMPLED
 * plane (see `bw`), which is what keeps the 8-bytes-per-pixel affordable.
 */
export function integral(src: Float32Array, w: number, h: number): Float64Array {
  const iw = w + 1;
  const out = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const o = (y + 1) * iw;
    const u = y * iw;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      out[o + x + 1] = out[u + x + 1] + row;
    }
  }
  return out;
}

/** Sum over the inclusive rectangle (x0,y0)-(x1,y1) of an `integral` table. */
export function boxSum(
  t: Float64Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const iw = w + 1;
  const a = y0 * iw;
  const b = (y1 + 1) * iw;
  return t[b + x1 + 1] - t[b + x0] - t[a + x1 + 1] + t[a + x0];
}

export interface BwOptions {
  /** Sauvola's k. Higher strips more faint ink. 0.2-0.34 is the useful range. */
  k?: number;
  /** Soft threshold, so glyph edges are grey rather than staircased. */
  antialias?: boolean;
  /** Divide the lighting out first. */
  flatten?: boolean;
  /** Take out a fold before thresholding, as in enhance(). Needs `flatten`. */
  creases?: boolean;
}

/**
 * The plane the threshold field is computed on, in pixels on the long edge.
 *
 * ⚠️ THE THRESHOLD FIELD IS SMOOTH; THE IMAGE IS NOT. Sauvola's window is a
 * sixteenth of the short edge — roughly 140px on a 3000px page — so the local
 * mean and standard deviation it produces vary over hundreds of pixels, not
 * over one. Computing them at 1024 and interpolating back is the same field to
 * within a fraction of a luma step, and it turns a 6.75-megapixel pair of
 * summed-area tables (108MB) into a 0.8-megapixel pair (13MB). The COMPARISON
 * still happens at full resolution, against every original pixel, so no
 * sharpness is lost — only the threshold is coarse, and it is meant to be.
 */
const BW_FIELD_EDGE = 1024;

/**
 * ADAPTIVE BINARISATION, SAUVOLA.
 *
 *     t = m · (1 + k · (s/R − 1))
 *
 * where m and s are the local mean and standard deviation over a window a
 * sixteenth of the short edge, and R = 128 is the dynamic range s is measured
 * against.
 *
 * ⚠️ WHY SAUVOLA AND NOT OTSU. Otsu picks ONE threshold for the page, and a
 * page with a lighting gradient has no such number: the lit half's paper is
 * brighter than the shadowed half's ink, so any global cut turns a third of
 * the page solid black. That is the "large black region" failure everybody has
 * seen in a scanner app, and it is not a tuning problem — it is what a global
 * threshold IS. Sauvola's threshold follows the illumination because m does.
 *
 * ⚠️ WHY THE s TERM MATTERS MORE THAN THE MEAN. On blank paper s ≈ 0, so
 * t → m·(1−k) — about 0.7 of the paper's own brightness, comfortably below it,
 * so blank paper stays blank. That single property is why Sauvola does not
 * speckle empty margins the way a plain "below the local mean" rule (Bradley)
 * does, and empty margins are most of a document.
 *
 * ⚠️ THE FLOOR IS WHAT KEEPS A PHOTOGRAPH BLACK. Sauvola is scale-free: the
 * interior of a large solid dark region looks exactly like blank paper to it —
 * uniform, s ≈ 0 — so t → 0.7 of the dark value, the pixels sit above it, and
 * an ID photograph comes out WHITE. Clamping the threshold up to a fraction of
 * the page's own paper level fixes it in one line: anything much darker than
 * paper is ink no matter how uniform it is.
 */
export function bw(r: Raster, opts: BwOptions = {}): Raster {
  const k = opts.k ?? 0.28;
  const antialias = opts.antialias ?? true;
  const flatten = opts.flatten ?? true;
  const creases = opts.creases ?? true;
  const w = r.width;
  const h = r.height;

  const luma = lumaPlane(r);
  const base = flatten ? flattenLuma(luma, w, h) : luma;

  // ⚠️ AND IT MATTERS MOST HERE. Everywhere else a fold is a grey smear; under
  // an adaptive threshold it is a candidate for INK, and a fold printed solid
  // black across a licence is the worst output this file can produce. Same
  // guard as in `grey`: only when the flatten made its own plane.
  if (creases && base !== luma) suppressCreases(base, w, h);

  const long = Math.max(w, h);
  const scale = Math.min(1, BW_FIELD_EDGE / long);
  const sw = Math.max(8, Math.round(w * scale));
  const sh = Math.max(8, Math.round(h * scale));
  const small = scale === 1 ? base : shrink(base, w, h, sw, sh);

  const sq = new Float32Array(small.length);
  for (let i = 0; i < small.length; i++) sq[i] = small[i] * small[i];
  const t1 = integral(small, sw, sh);
  const t2 = integral(sq, sw, sh);

  // Window = a sixteenth of the short edge, so the radius is a thirty-second.
  // Floor of 3 keeps it meaningful on a thumbnail.
  const rad = Math.max(3, Math.round(Math.min(sw, sh) / 32));

  // The paper level, for the floor. 90th percentile of the small plane rather
  // than the maximum: one blown pixel must not set it.
  const hist = new Float64Array(256);
  for (let i = 0; i < small.length; i++) {
    hist[Math.max(0, Math.min(255, small[i] | 0))]++;
  }
  let cum = 0;
  let paper = 245;
  for (let b = 255; b >= 0; b--) {
    cum += hist[b];
    if (cum >= small.length * 0.1) {
      paper = b;
      break;
    }
  }
  const floor = paper * 0.45;

  const thr = new Float32Array(small.length);
  const soft = new Float32Array(small.length);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.max(0, y - rad);
    const y1 = Math.min(sh - 1, y + rad);
    for (let x = 0; x < sw; x++) {
      const x0 = Math.max(0, x - rad);
      const x1 = Math.min(sw - 1, x + rad);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s1 = boxSum(t1, sw, x0, y0, x1, y1);
      const s2 = boxSum(t2, sw, x0, y0, x1, y1);
      const m = s1 / area;
      const varr = Math.max(0, s2 / area - m * m);
      const sd = Math.sqrt(varr);
      const i = y * sw + x;
      thr[i] = Math.max(floor, m * (1 + k * (sd / 128 - 1)));
      // ⚠️ THE SOFT WIDTH FOLLOWS THE LOCAL CONTRAST, it is not a constant.
      // Antialiasing is only ever meant to cover the ramp between paper and
      // ink; where that ramp is 150 luma steps wide a 4-step blend is a hard
      // edge with extra work, and where the page is faint a fixed wide blend
      // turns the text to fog. 6 is the floor because below that JPEG ringing
      // alone can staircase an edge.
      soft[i] = Math.max(6, 0.35 * sd);
    }
  }

  // Grow the two fields back and compare, in one pass, without materialising
  // either at full resolution: the bilinear weights for x depend only on x, so
  // they are computed once for the whole image and reused on every row.
  const xi0 = new Int32Array(w);
  const xi1 = new Int32Array(w);
  const xwt = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const fx = ((x + 0.5) * sw) / w - 0.5;
    const a = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
    xi0[x] = a;
    xi1[x] = Math.min(sw - 1, a + 1);
    xwt[x] = Math.max(0, Math.min(1, fx - a));
  }

  const out = new Uint8ClampedArray(r.data.length);
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) * sh) / h - 0.5;
    const ya = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const yb = Math.min(sh - 1, ya + 1);
    const wy = Math.max(0, Math.min(1, fy - ya));
    const ra = ya * sw;
    const rb = yb * sw;
    for (let x = 0; x < w; x++) {
      const a = xi0[x];
      const b = xi1[x];
      const wx = xwt[x];
      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;
      const t =
        thr[ra + a] * w00 + thr[ra + b] * w10 + thr[rb + a] * w01 + thr[rb + b] * w11;
      const p = y * w + x;
      let v: number;
      if (antialias) {
        const sft =
          soft[ra + a] * w00 + soft[ra + b] * w10 + soft[rb + a] * w01 + soft[rb + b] * w11;
        let u = (base[p] - (t - sft)) / (2 * sft);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        // smoothstep, so the ramp has no corner at either end — a linear blend
        // leaves a visible band along every stroke at print size.
        v = 255 * u * u * (3 - 2 * u);
      } else {
        v = base[p] >= t ? 255 : 0;
      }
      const i = p * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = r.data[i + 3];
    }
  }
  return { data: out, width: w, height: h };
}

// ────────────────────────────────────────────────────────────────────
// AUTO
// ────────────────────────────────────────────────────────────────────

export interface PageStats {
  /** Where bare paper sits, as the 90th percentile of luma. */
  paperLuma: number;
  /** 99th minus 1st percentile of luma. Low means there is nothing on it. */
  contrast: number;
  /**
   * Fraction of the page whose luma sits between ink and paper. Print is
   * bimodal and scores near zero; a photograph fills the middle.
   */
  midtoneFraction: number;
  /** Fraction of legible pixels carrying real colour. */
  colourFraction: number;
  /** Mean saturation, 0-1, over those same pixels. */
  meanSaturation: number;
}

/**
 * ⚠️ CHROMA IS MEASURED ONLY WHERE THERE IS LIGHT. Below about luma 40 the
 * channels are noise and the sensor's own colour filter array bias, so a dark
 * page reliably reports a chroma it does not have. Every real cue — a green
 * ID book, a blue security print, a red stamp, a colour photograph — is in the
 * lit part of the image.
 */
const CHROMA_FLOOR_LUMA = 40;
/**
 * Saturation above this is a colour a person would name.
 *
 * ⚠️ RELATIVE, NOT ABSOLUTE, AND THAT DISTINCTION IS THE WHOLE TEST. The
 * first cut compared max-minus-min against a flat 22 luma steps. On paper at
 * 225 that is a 10% cast — ordinary warm room light — so a plain printed form
 * photographed indoors was being sent to `colour` instead of B&W. Dividing by
 * the brightest channel makes the measure independent of how bright the page
 * is, and separates the two cases cleanly: an indoor cast measures about 0.10,
 * a green ID book 0.40, a strong tungsten cast 0.42, a blue stamp 0.57.
 */
const SATURATION_AT = 0.18;

/**
 * The edge the statistics are measured on.
 *
 * ⚠️ SAMPLED, NOT AVERAGED, AND THE DIFFERENCE DECIDES THE ANSWER. Box-
 * averaging a page of 4px text strokes down to 512 mixes every stroke with the
 * paper beside it and manufactures exactly the midtones this function is
 * looking for — a printed form would come back reading like a photograph.
 * Nearest-neighbour sampling keeps each sample a real pixel that was really
 * either ink or paper, which is the property the bimodality test rests on.
 */
const STAT_EDGE = 512;

/**
 * WHAT KIND OF PAGE IS THIS.
 *
 * ⚠️ MEASURED AFTER FLATTENING, because a histogram of a page with a shadow
 * on it describes the shadow and nothing else. On a 400x300 synthetic form
 * with a 55% gradient across it the raw midtone fraction was 0.494 — the same
 * page without the shadow scored 0.000. Both are the same printed form and
 * both must reach the same answer; the shadowed one was being sent to `grey`
 * purely because its lit paper and its shaded paper sat on opposite sides of
 * the band. Dividing the lighting out first is what every one of the three
 * filters does anyway, so the statistics are measured on the same page the
 * filter will see.
 *
 * Chroma is taken from the ORIGINAL pixels rather than the flattened plane:
 * flattening is a per-pixel gain, so it barely moves hue, and reading colour
 * off the raw sample avoids carrying a second colour plane around.
 */
export function pageStats(r: Raster): PageStats {
  const w = r.width;
  const h = r.height;
  const scale = Math.min(1, STAT_EDGE / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const d = r.data;

  const small = new Float32Array(sw * sh);
  let lit = 0;
  let coloured = 0;
  let satSum = 0;
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / sh));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / sw));
      const i = (sy * w + sx) * 4;
      const R = d[i];
      const G = d[i + 1];
      const B = d[i + 2];
      const l = (77 * R + 150 * G + 29 * B) / 256;
      small[y * sw + x] = l;
      if (l >= CHROMA_FLOOR_LUMA) {
        const mx = R > G ? (R > B ? R : B) : G > B ? G : B;
        const mn = R < G ? (R < B ? R : B) : G < B ? G : B;
        const sat = (mx - mn) / mx;
        lit++;
        satSum += sat;
        if (sat > SATURATION_AT) coloured++;
      }
    }
  }

  const flat = flattenLuma(small, sw, sh);
  const n = flat.length;
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, flat[i] | 0))]++;

  const at = (q: number) => {
    let c = 0;
    for (let b = 0; b < 256; b++) {
      c += hist[b];
      if (c >= n * q) return b;
    }
    return 255;
  };
  const p1 = at(0.01);
  const p90 = at(0.9);
  const p99 = at(0.99);

  // Midtones, measured RELATIVE TO THE PAPER rather than to 0-255: after
  // flattening the paper is around 245, but a page photographed in a cellar
  // still lands lower, and an absolute band would call every pixel on it a
  // midtone.
  const loBand = 0.35 * p90;
  const hiBand = 0.82 * p90;
  let mid = 0;
  for (let b = Math.ceil(loBand); b <= Math.floor(hiBand) && b < 256; b++) mid += hist[b];

  return {
    paperLuma: p90,
    contrast: p99 - p1,
    midtoneFraction: mid / n,
    colourFraction: lit ? coloured / lit : 0,
    meanSaturation: lit ? satSum / lit : 0,
  };
}

/**
 * WHICH FILTER THIS PAGE WANTS.
 *
 * Three questions in order, and the order is the argument:
 *
 * 1. Does it carry colour anybody would miss? A green ID book, a blue
 *    security overprint, a colour photograph, a red SAPS stamp. If so, colour
 *    — because everything below throws that away and cannot get it back, and
 *    because our own classifier reads colour to tell one document from
 *    another. This is the expensive mistake, so it is asked first and its
 *    thresholds are the loose ones.
 * 2. Is it print? Bimodal (almost nothing between ink and paper) with real
 *    contrast means a typed or printed form, which is exactly what B&W was
 *    invented for and what a member wants to print or fax.
 * 3. Otherwise grey — the safe middle. Anything with tone in it that is not
 *    coloured: a pencil signature, a photocopy of a photograph, a receipt.
 */
export function chooseMode(s: PageStats): FilterMode {
  if (s.colourFraction > 0.1 || s.meanSaturation > 0.22) return 'colour';
  if (s.contrast > 55 && s.midtoneFraction < 0.14) return 'bw';
  return 'grey';
}

/** Pick a mode from the page itself, and run it. */
export function autoFilter(r: Raster): { raster: Raster; mode: FilterMode } {
  const mode = chooseMode(pageStats(r));
  return { raster: applyMode(r, mode), mode };
}

/** Run one named mode. */
export function applyMode(r: Raster, mode: FilterMode): Raster {
  switch (mode) {
    case 'grey':
      return grey(r);
    case 'bw':
      return bw(r);
    default:
      return colour(r);
  }
}

/**
 * Everything the review screen can ask for, resolved.
 *
 * `mode` is null only for 'none' — for 'auto' it is what auto actually chose,
 * which is the one thing the UI cannot work out for itself.
 */
export function applyChoice(
  r: Raster,
  choice: FilterChoice,
): { raster: Raster; mode: FilterMode | null } {
  if (choice === 'none') return { raster: r, mode: null };
  if (choice === 'auto') return autoFilter(r);
  // 'shadow' is the stored spelling of 'colour'. See FilterChoice.
  const mode: FilterMode = choice === 'shadow' ? 'colour' : choice;
  return { raster: applyMode(r, mode), mode };
}
