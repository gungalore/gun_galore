import { Raster } from './warp';

// ────────────────────────────────────────────────────────────────────
// MAKING THE PRINT LEGIBLE.
//
// Pure: RGBA in, RGBA out. Runs ONCE, on the rectified document, where we can
// afford to be slow and accurate — not per frame.
//
// ⚠️ THE CONSUMER IS A VISION MODEL, NOT TESSERACT. That single fact decides
// everything here, and it is why this file does the opposite of what a
// classical scanner app does:
//
//   NO BINARISATION. No Otsu, no Sauvola. A multimodal model reads a
//   well-exposed grey image better than a 1-bit one; binarising destroys the
//   colour and security print the CLASSIFIER uses to tell a firearm licence
//   from a competency certificate; and it fails catastrophically on the glossy
//   laminate of an SA licence card, where a specular highlight becomes a white
//   hole with a hard black rim.
//
//   NO GLARE REMOVAL. You cannot recover data from a blown highlight in a
//   single exposure. What we can do is SEE it and say so — a member tilting
//   the phone fixes it completely, which is worth more than any filter.
//
// What is left is the part that genuinely helps: divide out the lighting, lift
// local contrast, and put back the sharpness the warp cost.
// ────────────────────────────────────────────────────────────────────

export interface EnhanceOptions {
  flatten?: boolean;
  localContrast?: boolean;
  sharpen?: boolean;
}

export interface EnhanceReport {
  /** Fraction of the page that is blown out. Above ~0.015 is worth saying. */
  glare: number;
  /** Rough focus measure: mean absolute Laplacian. Low means soft. */
  sharpness: number;
  /** Mean luma before flattening. Very low means it will be noisy. */
  meanLuma: number;
}

/** Where bare paper lands. Just off true white, so nothing clips. */
const WHITE = 245;
/**
 * The most any pixel may be brightened.
 *
 * ⚠️ THIS NUMBER IS A TREATY between two enemies. A shadowed page at 45% of
 * its lit brightness needs 2.4x to reach white — any real hand shadow under a
 * ceiling light sits above that. An ID photograph must NOT reach white: at a
 * cap of 3 the synthetic photo block came out at 177 luma, light enough to
 * start reading as background. 2.5 satisfies the deepest plausible shadow and
 * keeps the photograph a photograph.
 */
const GAIN_CAP = 2.5;

const DEFAULTS: Required<EnhanceOptions> = {
  flatten: true,
  localContrast: true,
  sharpen: true,
};

/** Luma plane from RGBA, as floats so the division below keeps precision. */
function lumaPlane(r: Raster): Float32Array {
  const out = new Float32Array(r.width * r.height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (77 * r.data[i] + 150 * r.data[i + 1] + 29 * r.data[i + 2]) / 256;
  }
  return out;
}

/** Separable box blur, in place over a scratch buffer. O(n) per pass. */
export function boxBlur(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
  passes = 3,
): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(a.length);
  const r = Math.max(1, Math.round(radius));

  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
      const n = 2 * r + 1;
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / n;
        const out = row + Math.min(w - 1, Math.max(0, x - r));
        const inn = row + Math.min(w - 1, Math.max(0, x + r + 1));
        sum += a[inn] - a[out];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      const n = 2 * r + 1;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / n;
        const out = Math.min(h - 1, Math.max(0, y - r)) * w + x;
        const inn = Math.min(h - 1, Math.max(0, y + r + 1)) * w + x;
        sum += b[inn] - b[out];
      }
    }
  }
  return a;
}

/** Nearest-power downsample of a float plane, by simple averaging. */
function shrink(
  src: Float32Array,
  w: number,
  h: number,
  tw: number,
  th: number,
): Float32Array {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
      let s = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++) {
        for (let xx = x0; xx < x1 && xx < w; xx++) {
          s += src[yy * w + xx];
          n++;
        }
      }
      out[y * tw + x] = n ? s / n : 0;
    }
  }
  return out;
}

/** Bilinear upsample of a float plane. */
function grow(
  src: Float32Array,
  sw: number,
  sh: number,
  tw: number,
  th: number,
): Float32Array {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    const fy = ((y + 0.5) * sh) / th - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < tw; x++) {
      const fx = ((x + 0.5) * sw) / tw - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = Math.max(0, Math.min(1, fx - x0));
      const v =
        src[y0 * sw + x0] * (1 - wx) * (1 - wy) +
        src[y0 * sw + x1] * wx * (1 - wy) +
        src[y1 * sw + x0] * (1 - wx) * wy +
        src[y1 * sw + x1] * wx * wy;
      out[y * tw + x] = v;
    }
  }
  return out;
}

/** Separable max filter — each pixel becomes the brightest within `radius`. */
export function dilate(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const a = new Float32Array(src.length);
  const b = new Float32Array(src.length);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        if (src[row + xx] > m) m = src[row + xx];
      }
      a[row + x] = m;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        if (a[yy * w + x] > m) m = a[yy * w + x];
      }
      b[y * w + x] = m;
    }
  }
  return b;
}

/**
 * THE PAPER, WHEREVER IT IS — the local brightness the page itself would have,
 * shadows and all, with the ink removed.
 *
 * A max filter wide enough to jump every glyph replaces each pixel with the
 * nearest patch of bare paper; a small blur then smooths the blocks the max
 * leaves behind. ⚠️ THIS IS WHAT A BLUR ALONE COULD NOT DO: a blurred field
 * mixes the ink into its estimate and glides straight across a hard shadow
 * boundary, so dividing by it left the operator's hand-shadow sitting on the
 * page and the paper a resolute grey. The max filter's estimate is bare paper
 * on BOTH sides of a shadow edge, tracking the shadow exactly — so dividing
 * up to white removes the shadow and lands every part of the page on the same
 * background, which is precisely the "uniform background" that was asked for.
 *
 * Computed at 512px on the long edge: fine enough that a photograph or a
 * security emblem is still its own dark region rather than averaged away,
 * coarse enough to cost milliseconds.
 */
export function paperField(
  luma: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const long = Math.max(w, h);
  const scale = Math.min(1, 512 / long);
  const tw = Math.max(8, Math.round(w * scale));
  const th = Math.max(8, Math.round(h * scale));
  const small = shrink(luma, w, h, tw, th);
  // Radius 6 at 512 clears a text stroke and a table rule with margin; a
  // photograph is fifty times wider and stays a dark region of its own.
  const maxed = dilate(small, tw, th, 6);
  const smooth = boxBlur(maxed, tw, th, 3, 2);
  return grow(smooth, tw, th, w, h);
}

/**
 * The illumination field: a heavily blurred copy of the luma.
 *
 * ⚠️ COMPUTED SMALL, THEN GROWN. A genuine 150-pixel-radius blur over two and
 * a half megapixels is a non-starter on a phone. Shrinking to 128px, blurring
 * there, and growing back is the same field to within a pixel and costs
 * single-digit milliseconds — the field is by definition smooth, so nothing is
 * lost by computing it at low resolution.
 *
 * The radius has to be large enough to contain the lighting gradient and the
 * phone's own shadow, and small enough to contain no glyphs. An eighth of the
 * short edge is both.
 */
export function illuminationField(
  luma: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const long = Math.max(w, h);
  const tw = Math.max(8, Math.round((w / long) * 128));
  const th = Math.max(8, Math.round((h / long) * 128));
  const small = shrink(luma, w, h, tw, th);
  const blurred = boxBlur(small, tw, th, Math.max(2, Math.round(Math.min(tw, th) / 8)), 3);
  return grow(blurred, tw, th, w, h);
}

/**
 * Contrast-limited adaptive histogram equalisation, cut down.
 *
 * 8x8 tiles, 64 bins, clipped at 3x the mean so a flat background does not get
 * amplified into noise, and the four surrounding tile curves blended per pixel
 * so no tile boundary shows.
 *
 * This is the single technique that most improves a photograph taken under a
 * ceiling light with the member's own shadow across a corner — which is the
 * most common real shooting condition there is.
 */
export function claheLut(
  luma: Float32Array,
  w: number,
  h: number,
  tiles = 8,
  bins = 64,
  clip = 3,
): Float32Array[] {
  const luts: Float32Array[] = [];
  const tw = Math.ceil(w / tiles);
  const th = Math.ceil(h / tiles);

  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const hist = new Float32Array(bins);
      let n = 0;
      const x0 = tx * tw;
      const x1 = Math.min(w, x0 + tw);
      const y0 = ty * th;
      const y1 = Math.min(h, y0 + th);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = luma[y * w + x];
          const b = Math.max(0, Math.min(bins - 1, Math.floor((v / 256) * bins)));
          hist[b]++;
          n++;
        }
      }
      if (n === 0) {
        luts.push(identityLut(bins));
        continue;
      }
      // Clip, and give the excess back evenly. Without this a uniform patch of
      // paper becomes a uniform patch of amplified sensor noise.
      const limit = (clip * n) / bins;
      let excess = 0;
      for (let b = 0; b < bins; b++) {
        if (hist[b] > limit) {
          excess += hist[b] - limit;
          hist[b] = limit;
        }
      }
      const give = excess / bins;
      const lut = new Float32Array(bins);
      let cum = 0;
      for (let b = 0; b < bins; b++) {
        cum += hist[b] + give;
        lut[b] = (cum / n) * 255;
      }
      luts.push(lut);
    }
  }
  return luts;
}

function identityLut(bins: number): Float32Array {
  const l = new Float32Array(bins);
  for (let b = 0; b < bins; b++) l[b] = ((b + 0.5) / bins) * 255;
  return l;
}

/** Sample the four surrounding tile curves and blend. */
function claheAt(
  luts: Float32Array[],
  tiles: number,
  bins: number,
  w: number,
  h: number,
  x: number,
  y: number,
  v: number,
): number {
  const fx = (x / w) * tiles - 0.5;
  const fy = (y / h) * tiles - 0.5;
  const tx0 = Math.max(0, Math.min(tiles - 1, Math.floor(fx)));
  const ty0 = Math.max(0, Math.min(tiles - 1, Math.floor(fy)));
  const tx1 = Math.min(tiles - 1, tx0 + 1);
  const ty1 = Math.min(tiles - 1, ty0 + 1);
  const wx = Math.max(0, Math.min(1, fx - tx0));
  const wy = Math.max(0, Math.min(1, fy - ty0));
  const b = Math.max(0, Math.min(bins - 1, Math.floor((v / 256) * bins)));
  return (
    luts[ty0 * tiles + tx0][b] * (1 - wx) * (1 - wy) +
    luts[ty0 * tiles + tx1][b] * wx * (1 - wy) +
    luts[ty1 * tiles + tx0][b] * (1 - wx) * wy +
    luts[ty1 * tiles + tx1][b] * wx * wy
  );
}

/** What is wrong with this capture, in numbers the UI turns into words. */
export function inspect(r: Raster): EnhanceReport {
  const luma = lumaPlane(r);
  let blown = 0;
  let sum = 0;
  for (let i = 0; i < luma.length; i++) {
    sum += luma[i];
    if (luma[i] > 250) blown++;
  }
  // Mean absolute Laplacian: high on crisp print, low on a soft photograph.
  let lap = 0;
  let n = 0;
  const w = r.width;
  for (let y = 1; y < r.height - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      lap += Math.abs(
        4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w],
      );
      n++;
    }
  }
  return {
    glare: blown / luma.length,
    sharpness: n ? lap / n : 0,
    meanLuma: sum / luma.length,
  };
}

/**
 * The whole enhancement.
 *
 * ⚠️ THE GAIN IS APPLIED TO R, G AND B, not to a greyscale copy. Colour has to
 * survive: the classifier uses it to tell a firearm licence card from a
 * competency certificate before the reader ever looks at the text.
 */
export function enhance(r: Raster, opts: EnhanceOptions = {}): Raster {
  const o = { ...DEFAULTS, ...opts };
  const w = r.width;
  const h = r.height;
  const luma = lumaPlane(r);
  const out = new Uint8ClampedArray(r.data.length);

  // (a) Divide the paper up to white. Illumination is MULTIPLICATIVE —
  // reflectance times illuminant — so this divides rather than subtracting.
  //
  // ⚠️ UP TO WHITE, NOT TO THE MEAN. The first version normalised to the
  // field's own mean, which removed the gradient and then carefully preserved
  // the overall murk: a dim photograph came out as a uniformly dim scan, and
  // the operator's side-by-side against the plain camera app made the point
  // better than any argument. Paper is white; the estimate under `paperField`
  // IS the paper; dividing by it and scaling to WHITE sends every patch of
  // bare page — lit, shaded, or under his hand's shadow — to the same bright
  // background, while ink keeps its ratio against the paper around it.
  //
  // The gain cap is what stops the genuinely dark parts — a photograph, hair,
  // a black emblem — from being dragged up to white along with everything
  // else: where the true background is far darker than paper, the cap wins
  // and the region keeps its identity.
  let corrected = luma;
  if (o.flatten) {
    const field = paperField(luma, w, h);
    corrected = new Float32Array(luma.length);
    for (let i = 0; i < luma.length; i++) {
      const b = Math.max(20, field[i]);
      const gain = Math.min(GAIN_CAP, WHITE / b);
      corrected[i] = Math.min(255, luma[i] * gain);
    }
  }

  // (b) Local contrast.
  let lifted = corrected;
  if (o.localContrast) {
    const TILES = 8;
    const BINS = 64;
    // ⚠️ CLIP 2, DOWN FROM 3, since the paper started reaching true white.
    // CLAHE was tuned against the old grey-mean output, where it had murk to
    // dig detail out of; run at the same strength on a properly whitened page
    // it turned the ID photograph crunchy and rang halos around print — the
    // real flat.jpg outputs made it obvious. With the lighting gone its only
    // remaining job is a gentle lift of faint stamps and security print.
    const luts = claheLut(corrected, w, h, TILES, BINS, 2);
    lifted = new Float32Array(corrected.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        lifted[i] = claheAt(luts, TILES, BINS, w, h, x, y, corrected[i]);
      }
    }
  }

  // (c) A restrained unsharp mask, to put back what the warp's bilinear cost.
  // Kept low on purpose: over-sharpening rings around glyph strokes, and a
  // vision model reads ringing as noise.
  let finalL = lifted;
  if (o.sharpen) {
    const blur = boxBlur(lifted, w, h, 1, 1);
    finalL = new Float32Array(lifted.length);
    for (let i = 0; i < lifted.length; i++) {
      finalL[i] = Math.max(0, Math.min(255, lifted[i] + 0.6 * (lifted[i] - blur[i])));
    }
  }

  // Re-apply as a per-pixel GAIN so hue survives.
  for (let i = 0, p = 0; p < finalL.length; i += 4, p++) {
    const before = luma[p];
    const gain = before > 1 ? finalL[p] / before : 1;
    out[i] = r.data[i] * gain;
    out[i + 1] = r.data[i + 1] * gain;
    out[i + 2] = r.data[i + 2] * gain;
    out[i + 3] = r.data[i + 3];
  }

  return { data: out, width: w, height: h };
}
