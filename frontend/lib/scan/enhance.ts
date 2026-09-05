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
  /** Find a fold and put the paper back inside it. See `suppressCreases`. */
  creases?: boolean;
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
  creases: true,
};

/** Luma plane from RGBA, as floats so the division below keeps precision. */
export function lumaPlane(r: Raster): Float32Array {
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
  /**
   * A dead full-resolution buffer to borrow instead of allocating one.
   *
   * ⚠️ THIS IS A MEMORY LEVER, NOT A SPEED ONE, AND IT PAYS FOR RESOLUTION.
   * boxBlur allocates TWO planes the size of its input. On the downsampled
   * calls inside paperField that is nothing — they run at 512px or less. On
   * the unsharp call it runs at FULL resolution, at the exact moment `luma`
   * and `lifted` are also live, which is where this function's peak actually
   * is. Handing it a buffer the pipeline has already finished with removes one
   * of the two, and the peak is what OUTPUT_MAX_EDGE was set to protect.
   *
   * Must be at least src.length. Its contents are overwritten.
   */
  scratch?: Float32Array,
): Float32Array {
  const a = Float32Array.from(src);
  const b =
    scratch && scratch.length >= a.length ? scratch : new Float32Array(a.length);
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
export function shrink(
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
export function grow(
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
 * Separable min filter — the counterpart to `dilate`, so the two compose into
 * a morphological CLOSING (dilate then erode).
 *
 * ⚠️ A CLOSING IS THE ONE OPERATOR THAT IS SAFE ACROSS A SHADOW EDGE, which
 * is why paperField reaches for it below rather than for a bigger blur or a
 * bigger max. Closing fills dark gaps NARROWER than its structuring element
 * and leaves everything wider than it exactly where it was — so a photograph
 * disappears into the paper around it while a shadow covering half the page
 * keeps its own level right up to its boundary. A max filter alone lifts a
 * band of its own radius on the dark side of every shadow; a closing lifts
 * none, because the erode takes the darker value back.
 */
export function erode(
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
      let m = Infinity;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        if (src[row + xx] < m) m = src[row + xx];
      }
      a[row + x] = m;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        if (a[yy * w + x] < m) m = a[yy * w + x];
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
 *
 * ────────────────────────────────────────────────────────────────────
 * ⚠️ THE SECOND SCALE EXISTS TO KILL A RING AROUND EVERY ID PHOTOGRAPH, and
 * it is not cosmetic. The max filter can only find paper within its own
 * radius. Inside a dark region WIDER than that — an ID photo, a black header
 * band, a signature block — there is no paper to find, so the estimate
 * collapses onto the dark region itself and the gain jumps to whatever the cap
 * allows. Measured on a 512px synthetic page with a 120px dark square, one
 * scale gave: paper 248, the square's rim 50, the square's centre 143. The
 * photograph came out with a dark ring drawn round the inside of it and a
 * washed-out middle — the gain was discontinuous exactly where the eye is most
 * sensitive to it.
 *
 * The fix is a SECOND, COARSER background estimate: a morphological closing at
 * 128px on the long edge, whose structuring element is wider than any
 * plausible dark region on a document. A closing fills gaps narrower than
 * itself and leaves anything wider untouched, so it reads straight across the
 * photograph at the paper level around it — and, crucially, does NOT read
 * across a shadow edge (see `erode`). Taking the brighter of the two estimates
 * gives the fine one where paper exists and the coarse one where it does not,
 * and the coarse one is smooth, so the gain is continuous across the boundary.
 *
 * The consequence for a photograph is the right one: its field becomes the
 * paper around it, so its gain is the paper's gain (~1.15) instead of the 2.5
 * cap. It keeps its tones instead of being dragged a third of the way to
 * white. GAIN_CAP is now a backstop for genuinely deep shadow, which is what
 * it was always described as.
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
  const near = dilate(small, tw, th, 6);

  // The coarse estimate. A quarter of the fine plane, because a background
  // field is smooth by definition — the same argument illuminationField makes
  // — and a closing costs O(radius) per pixel, so the sixteen-fold drop in
  // pixels is what makes a structuring element this wide free.
  const cw = Math.max(8, Math.round(tw / 4));
  const ch = Math.max(8, Math.round(th / 4));
  // ⚠️ 0.25 OF THE SHORT EDGE. The structuring element has to be wider than
  // half the widest dark region we want to read across; a licence photograph
  // runs about a quarter of the card's short edge, so this closes anything up
  // to half the page and still cannot lift a shadow (the erode takes the dark
  // value back). Erring large is the safe direction: too small leaves the
  // ring, too large only means a very wide black band keeps its own tones,
  // which is what it should do anyway.
  const cr = Math.max(4, Math.round(Math.min(cw, ch) * 0.25));
  const cSmall = shrink(small, tw, th, cw, ch);
  const closed = erode(dilate(cSmall, cw, ch, cr), cw, ch, cr);
  const coarse = grow(closed, cw, ch, tw, th);

  // Brighter of the two: the fine estimate wherever it actually found paper,
  // the coarse one wherever it collapsed.
  for (let i = 0; i < near.length; i++) {
    if (coarse[i] > near[i]) near[i] = coarse[i];
  }

  const smooth = boxBlur(near, tw, th, 3, 2);
  return grow(smooth, tw, th, w, h);
}

/**
 * Divide the paper up to white, over the field's own buffer.
 *
 * Illumination is MULTIPLICATIVE — reflectance times illuminant — so this
 * divides rather than subtracting.
 *
 * ⚠️ UP TO WHITE, NOT TO THE MEAN. The first version normalised to the
 * field's own mean, which removed the gradient and then carefully preserved
 * the overall murk: a dim photograph came out as a uniformly dim scan, and the
 * operator's side-by-side against the plain camera app made the point better
 * than any argument. Paper is white; the estimate under `paperField` IS the
 * paper; dividing by it and scaling to WHITE sends every patch of bare page —
 * lit, shaded, or under his hand's shadow — to the same bright background,
 * while ink keeps its ratio against the paper around it.
 *
 * ⚠️ THE RETURNED ARRAY IS THE FIELD'S OWN. Each field value is read exactly
 * once, so the corrected luma is written straight over it — one full-resolution
 * plane instead of two, at the point where this pipeline's peak actually is.
 */
export function flattenLuma(
  luma: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const field = paperField(luma, w, h);
  for (let i = 0; i < luma.length; i++) {
    const b = Math.max(20, field[i]);
    // The cap is what stops the genuinely dark parts of a DEEP SHADOW from
    // being dragged to white. Since the two-scale field no longer collapses
    // inside a photograph, it is a backstop rather than the load-bearing part
    // it used to be.
    const gain = Math.min(GAIN_CAP, WHITE / b);
    field[i] = Math.min(255, luma[i] * gain);
  }
  return field;
}

// ────────────────────────────────────────────────────────────────────
// CREASES
//
// A folded certificate photographs as a long, thin, FAINT dark line with a
// soft shadow band either side. Everything else in this file removes it by
// accident or not at all:
//
//   flattenLuma CANNOT. Its fine field is a max filter that jumps a 3px core
//   the way it jumps a glyph stroke, and its coarse closing reads straight
//   across the shadow band — so the field it divides by is the clean paper on
//   both sides, and the crease keeps its RATIO against that paper exactly as a
//   letter does. Flattening is a division; a division normalises the paper and
//   preserves ink, and to a division a crease IS ink.
//
//   CLAHE then makes it worse, because a long dark line is real local
//   contrast and lifting local contrast is CLAHE's entire job.
//
// So it needs its own step, and the step has to be photometric: find the band,
// and put the paper back inside it. ⚠️ GEOMETRIC DEWARPING IS OUT OF SCOPE.
// The page is genuinely bent, so the print near a fold is genuinely stretched
// and skewed; straightening THAT needs a 3D model of the sheet and a resample,
// which is a different piece of work with a different failure mode (it moves
// glyphs). This moves no pixel — it only changes how bright some of them are.
//
// ⚠️ THE ASYMMETRY OF THE RISK DECIDES EVERY THRESHOLD BELOW. A crease we miss
// is what ships today. A crease we invent erases a line of a licence. So every
// gate is set to refuse when unsure, and the numbers are quoted where used.
// ────────────────────────────────────────────────────────────────────

/** One detected fold, in FULL-RESOLUTION pixels. */
export interface CreaseBand {
  /** 'row' = runs left-to-right; 'col' = runs top-to-bottom. */
  axis: 'row' | 'col';
  /** Where the line crosses the middle of the page, on the other axis. */
  centre: number;
  /** How far the line moves across, per pixel along it. |slope| ≤ tan(3°). */
  slope: number;
  /** Half the band, core plus shadow. */
  half: number;
  /** How far below the paper the core sits, in luma levels. */
  depth: number;
  /** Fraction of the page's length the faint line covered. */
  coverage: number;
}

export interface CreaseOptions {
  /** Shallowest band worth touching. Below this it is sensor noise. */
  faintMin?: number;
  /** Deepest band we will call a crease. Above this it is print. */
  faintMax?: number;
  /** Fraction of the page's length the line must cover. */
  minCoverage?: number;
  /** Most bands to remove, per axis. A page folded in three has two. */
  maxPerAxis?: number;
}

/**
 * ⚠️ THESE FIVE NUMBERS ARE THE WHOLE SAFETY ARGUMENT.
 *
 * FAINT_MIN 6 — below six levels the "band" is JPEG blocking and sensor
 * noise, and correcting noise only moves it around.
 *
 * FAINT_MAX 45 — the top of the faint window, and the floor of "this is
 * print". Measured on the real certificate fixtures: body text sits 90–170
 * levels below its paper and a printed table rule 60–120. Nothing printed
 * lands under 45, so the window ITSELF is what keeps this off ruled lines and
 * table borders — they need no separate test.
 *
 * MIN_COVERAGE 0.45 — a fold crosses the whole sheet, margins included.
 *
 * MIN_HALF 2 (working scale) — the band must have a SOFT SKIRT. This is the
 * one test that separates a fold from a faint printed hairline: a hairline's
 * deficit is gone within a pixel, a fold's shadow is not. A printed rule at
 * full resolution is 3–4px, which is one working-scale pixel — reach 0 or 1,
 * rejected.
 *
 * MAX_INK 0.35 — a backstop against a line that is simply ink. It is NOT the
 * test that keeps this off a LINE OF TEXT, which is the only other thing on a
 * page that is long, thin and darker than paper; two better ones do that. The
 * profile below excludes ink from its medians, so a text row reports the clean
 * paper BETWEEN its letters and has no peak at all; and the p25 test asks
 * whether the line is darker than its surroundings for three quarters of its
 * LENGTH, which a text row fails on its word gaps and its margins. Set tighter
 * (0.20) this rejected a genuine tilted fold that crossed a dense form.
 */
const CREASE_FAINT_MIN = 6;
const CREASE_FAINT_MAX = 45;
const CREASE_MIN_COVERAGE = 0.45;
const CREASE_MIN_HALF = 2;
const CREASE_MAX_INK = 0.35;
/** Widest shadow we will attribute to a fold: 2% of the page, either side. */
const CREASE_MAX_HALF_FRAC = 0.02;
/** A fold is rarely square to the page, and never far from it. */
const CREASE_MAX_TILT_DEG = 3;
/**
 * ⚠️ SEVEN SEEDS, 1° APART — AND THE GRID DOES NOT NEED TO BE FINER, because
 * `fitTilt` measures the real tilt afterwards. A seed only has to land the
 * line inside the observation window over the page's length: half a degree of
 * error drifts a 1000px line by ±4px, a whole degree by ±9, and the window is
 * ±40 or more. Thirteen seeds cost the vote loop twice as much for nothing.
 */
const CREASE_TILT_STEPS = 7;
/**
 * Detection resolution.
 *
 * ⚠️ NOT COARSER, AND THE REASON IS TEXT. At 384px on the long edge a line of
 * 10pt type averages down into a uniform faint grey band spanning most of the
 * page width — indistinguishable from a fold, by construction. At 1024 the
 * glyph cores are still ~2px and still darker than FAINT_MAX, so the ink test
 * above can see them. Everything here votes only on faint pixels, so the cost
 * is a few per cent of the page rather than the page.
 */
const CREASE_SCALE = 1024;

/** Value at a percentile of a plane, from a strided 256-bin histogram. */
export function paperLevel(plane: Float32Array, pct: number): number {
  const hist = new Int32Array(256);
  // One sample in four is still a quarter of a million on a megapixel page —
  // far more than a percentile of a bimodal histogram can use.
  const step = plane.length > 1_000_000 ? 4 : 1;
  let n = 0;
  for (let i = 0; i < plane.length; i += step) {
    let v = plane[i] | 0;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    hist[v]++;
    n++;
  }
  let cum = 0;
  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (cum >= n * pct) return b;
  }
  return 255;
}

/** Along/across addressing, so one body of code handles both fold directions. */
interface Lay {
  axis: 'row' | 'col';
  nAlong: number;
  nAcross: number;
  sAlong: number;
  sAcross: number;
}
const layout = (w: number, h: number, axis: 'row' | 'col'): Lay =>
  axis === 'row'
    ? { axis, nAlong: w, nAcross: h, sAlong: 1, sAcross: w }
    : { axis, nAlong: h, nAcross: w, sAlong: w, sAcross: 1 };

/**
 * Median of a whole plane, from a strided sample — used to find the constant
 * bias in a max-filter paper estimate, where the answer is a few levels and
 * forty thousand samples settle it far past what it can use.
 */
function medianOf(plane: Float32Array): number {
  const step = Math.max(1, Math.floor(plane.length / 40_000));
  const n = Math.ceil(plane.length / step);
  const buf = new Float32Array(n);
  let m = 0;
  for (let i = 0; i < plane.length && m < n; i += step) buf[m++] = plane[i];
  const s = buf.subarray(0, m);
  s.sort();
  return m ? s[m >> 1] : 0;
}

/** p-th percentile of the first `n` entries of `buf`. Sorts in place. */
function percentileOf(buf: Float32Array, n: number, p: number): number {
  if (n === 0) return 0;
  const s = buf.subarray(0, n);
  s.sort();
  return s[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))];
}

/**
 * The same answer to the nearest level, in O(n) instead of O(n log n).
 *
 * ⚠️ THIS IS NOT PREMATURE. The band profile takes a median at each of 105
 * offsets, for each of up to eight candidates, on each of two axes — sorting
 * those cost 606ms on one real fixture, three times the rest of enhance()
 * put together. The values are luma deficits, so a 256-bin histogram over
 * −64…191 IS the sort, and one level of quantisation is far inside what any
 * threshold here cares about.
 */
const HIST_LO = -64;
function fastMedian(buf: Float32Array, n: number, hist: Int32Array): number {
  if (n === 0) return 0;
  hist.fill(0);
  for (let i = 0; i < n; i++) {
    let b = Math.round(buf[i]) - HIST_LO;
    if (b < 0) b = 0;
    else if (b > 255) b = 255;
    hist[b]++;
  }
  let cum = 0;
  const half = n >> 1;
  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (cum > half) return b + HIST_LO;
  }
  return 255 + HIST_LO;
}

/**
 * THE LOCAL PAPER, ROBUST TO A BAND ACROSS IT.
 *
 * paperField's fine max filter cannot be reused here: its radius is a glyph
 * wide, so inside a 40px shadow band it finds no paper and reports the band
 * back. This one runs the max at a QUARTER of the detection scale with a
 * radius that spans the widest band we will accept, so it always reaches clean
 * paper — and it is only ever used as a reference to SUBTRACT, never to divide
 * by, so its coarseness costs nothing.
 */
function creasePaper(small: Float32Array, sw: number, sh: number): Float32Array {
  const qw = Math.max(8, Math.round(sw / 4));
  const qh = Math.max(8, Math.round(sh / 4));
  const q = shrink(small, sw, sh, qw, qh);
  // The band reaches 2% of the page either side, so 4% overall; a radius of
  // 6% of the short edge reaches past it from anywhere inside.
  const r = Math.max(3, Math.round(Math.min(qw, qh) * 0.06 * 4));
  const lifted = dilate(q, qw, qh, r);
  return grow(boxBlur(lifted, qw, qh, 2, 2), qw, qh, sw, sh);
}

/**
 * MEASURE the tilt, rather than take the vote's word for it.
 *
 * Walks the line and, at each position along it, takes the DARKEST offset
 * within the search window that is faint rather than ink — the fold's own
 * ridge — then least-squares fits a line through those points, drops the worst
 * third of the residuals and refits. The trim is what stops a paragraph of
 * text crossing the fold from dragging the fit sideways.
 *
 * Returns the vote's own slope unchanged if too few positions had a ridge to
 * find, and never returns a tilt outside the ±3° the vote searched.
 */
function fitTilt(
  deficit: Float32Array,
  lay: Lay,
  centre: number,
  seed: number,
  maxHalf: number,
  o: Required<CreaseOptions>,
): number {
  const { nAlong, nAcross, sAlong, sAcross } = lay;
  const mid = (nAlong - 1) / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let a = 0; a < nAlong; a++) {
    const line = Math.round(centre + (a - mid) * seed);
    let bestC = 0;
    let best = 0;
    for (let d = -maxHalf; d <= maxHalf; d++) {
      const c = line + d;
      if (c < 0 || c >= nAcross) continue;
      const dv = deficit[a * sAlong + c * sAcross];
      if (dv > o.faintMax || dv < o.faintMin) continue;
      if (dv > best) {
        best = dv;
        bestC = c;
      }
    }
    if (best > 0) {
      xs.push(a - mid);
      ys.push(bestC);
    }
  }
  if (xs.length < nAlong * 0.25) return seed;

  const fit = (keep: boolean[]) => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      if (!keep[i]) continue;
      n++;
      sx += xs[i];
      sy += ys[i];
      sxx += xs[i] * xs[i];
      sxy += xs[i] * ys[i];
    }
    const den = n * sxx - sx * sx;
    if (n < 8 || Math.abs(den) < 1e-6) return null;
    const m = (n * sxy - sx * sy) / den;
    return { m, b: (sy - m * sx) / n };
  };

  const keep = new Array<boolean>(xs.length).fill(true);
  let f = fit(keep);
  if (!f) return seed;
  const res = xs.map((x, i) => Math.abs(ys[i] - (f as { m: number; b: number }).m * x - (f as { m: number; b: number }).b));
  const cut = [...res].sort((p, q) => p - q)[Math.floor(res.length * 0.67)];
  for (let i = 0; i < keep.length; i++) keep[i] = res[i] <= cut;
  f = fit(keep) ?? f;

  const lim = Math.tan((CREASE_MAX_TILT_DEG * Math.PI) / 180);
  return Math.max(-lim, Math.min(lim, f.m));
}

/**
 * Find the folds, at CREASE_SCALE, in one direction.
 *
 * The vote is a cut-down Hough: every faint pixel adds one vote to each of the
 * 13 candidate tilts, at the offset that tilt puts it on, and a position may
 * only vote once per (tilt, offset) — otherwise a 6px-thick band votes six
 * times and claims 600% coverage. Iterating ALONG the line on the outer loop
 * is what makes that dedupe a single comparison instead of a set.
 *
 * The vote only ever says WHERE to look. Every decision is taken afterwards,
 * from the band's own profile.
 */
function findAxisCreases(
  deficit: Float32Array,
  ink: Uint8Array,
  lay: Lay,
  o: Required<CreaseOptions>,
): CreaseBand[] {
  const { nAlong, nAcross, sAlong, sAcross } = lay;

  // The widest band we will accept, plus headroom — the headroom is load
  // bearing, because "the profile never came back to paper inside the window"
  // is one of the rejection tests below and it needs somewhere to be observed.
  const maxHalf = Math.max(4, Math.round(nAcross * CREASE_MAX_HALF_FRAC) + 6);

  /**
   * ⚠️ THE VOTE MUST NOT SEE AN ABSOLUTE DARKNESS, ONLY A LOCAL ONE.
   *
   * `creasePaper` is a max filter and reads high — 10.7 levels on the real
   * certificate — and the amount it reads high VARIES over the page, because
   * the page's own shading does. Subtracting one global number then puts the
   * middle of that certificate below the faint floor and its edges above:
   * the fold's own pixels stopped being "faint" and the best line on a plainly
   * folded page scored 49% coverage, under the 45% bar by a whisker and with
   * nothing else near it.
   *
   * A one-dimensional top hat has no such problem. Ask instead: is this pixel
   * darker than the cleanest bare paper one band-width away on either side?
   * Broad shading cancels — it is the same on both sides — and a fold does
   * not, because a fold is exactly the thing that is narrower than the
   * distance we look.
   */
  const faint = new Uint8Array(deficit.length);
  for (let a = 0; a < nAlong; a++) {
    const base = a * sAlong;
    for (let c = maxHalf; c < nAcross - maxHalf; c++) {
      const i = base + c * sAcross;
      if (ink[i]) continue;
      const lo = deficit[base + (c - maxHalf) * sAcross];
      const hi = deficit[base + (c + maxHalf) * sAcross];
      // The brighter shoulder is the better estimate of bare paper; a shoulder
      // that has landed on print is the darker one and would hide the fold.
      const ridge = deficit[i] - Math.min(lo, hi);
      if (ridge >= o.faintMin && ridge <= o.faintMax) faint[i] = 1;
    }
  }

  const slopes: number[] = [];
  for (let k = 0; k < CREASE_TILT_STEPS; k++) {
    const deg =
      -CREASE_MAX_TILT_DEG +
      (2 * CREASE_MAX_TILT_DEG * k) / (CREASE_TILT_STEPS - 1);
    slopes.push(Math.tan((deg * Math.PI) / 180));
  }
  // The line is anchored at its middle, so a tilt swings it by half its drift
  // in each direction; the accumulator carries that margin at both ends.
  const margin =
    Math.ceil((nAlong * Math.tan((CREASE_MAX_TILT_DEG * Math.PI) / 180)) / 2) + 2;
  const bins = nAcross + 2 * margin;
  const votes = new Int32Array(slopes.length * bins);
  const lastAlong = new Int32Array(slopes.length * bins).fill(-1);
  const mid = (nAlong - 1) / 2;

  for (let a = 0; a < nAlong; a++) {
    const base = a * sAlong;
    const drift = a - mid;
    for (let c = 0; c < nAcross; c++) {
      if (!faint[base + c * sAcross]) continue;
      for (let s = 0; s < slopes.length; s++) {
        const bin = Math.round(c - drift * slopes[s]) + margin;
        if (bin < 0 || bin >= bins) continue;
        const k = s * bins + bin;
        if (lastAlong[k] === a) continue;
        lastAlong[k] = a;
        votes[k]++;
      }
    }
  }

  // ⚠️ AND WE LOOK TWICE THAT FAR. The baseline below is read off the outer
  // ends of the window, so the window has to extend well past the widest band
  // we accept or the band flattens ITSELF: at obsHalf = maxHalf the two folds
  // drawn at 0° and 1.5° on the synthetic bench vanished, because a band 20px
  // wide in a 26px window leaves no shoulder to measure paper on.
  const obsHalf = 2 * maxHalf;
  const need = o.minCoverage * nAlong;
  const found: CreaseBand[] = [];
  const taken: number[] = [];
  const scratch = new Float32Array(nAlong);
  const profile = new Float32Array(2 * obsHalf + 1);
  const hist = new Int32Array(256);

  /**
   * The band's profile: the MEDIAN deficit at each offset over the line's
   * length, so a glyph crossing the fold is an outlier rather than a vote —
   * then flattened against its own two shoulders.
   *
   * ⚠️ AGAINST ITS OWN SHOULDERS, NOT AGAINST ZERO. A fold on a page that is
   * very slightly shaded across it would otherwise measure the shading; and a
   * page with any residual bias would measure the bias. The outer sixth at
   * each end of the window is by construction outside the widest band we
   * accept, so it IS the local paper, and a straight line between the two
   * removes both effects at once. What is left is the fold and nothing else.
   */
  const measure = (centre: number, slope: number) => {
    for (let d = -obsHalf; d <= obsHalf; d++) {
      let n = 0;
      for (let a = 0; a < nAlong; a++) {
        const c = Math.round(centre + (a - mid) * slope) + d;
        if (c < 0 || c >= nAcross) continue;
        const i = a * sAlong + c * sAcross;
        // ⚠️ INK IS NOT PAPER AND MUST NOT VOTE ON THE PAPER'S LEVEL. Without
        // this the profile of a SQUARE page aliases against its own text: at
        // exactly 0° every offset is a whole row, so the median reports "is
        // this a line of type" and oscillates ±110 levels with the line
        // pitch — and the re-centring below then walks the band onto a line of
        // type. A tilted fold never showed it, because a tilted line crosses
        // the rows and the median comes back to paper.
        if (ink[i]) continue;
        scratch[n++] = deficit[i];
      }
      // A row with no bare paper at all has nothing to say about the paper.
      profile[d + obsHalf] = n > nAlong * 0.1 ? fastMedian(scratch, n, hist) : 0;
    }
    const edge = obsHalf - maxHalf;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < edge; i++) {
      lo += profile[i];
      hi += profile[profile.length - 1 - i];
    }
    lo /= edge;
    hi /= edge;
    const span = profile.length - 1;
    for (let i = 0; i < profile.length; i++) {
      profile[i] -= lo + ((hi - lo) * i) / span;
    }
  };

  // Best-first, so two folds on one page are found independently.
  //
  // ⚠️ ONE CANDIDATE PER POSITION, AND THAT IS A PERFORMANCE FIX AS MUCH AS A
  // CORRECTNESS ONE. A page-spanning band wins its bin at all thirteen tilts
  // and at every offset inside its own width, so the raw list ran to thousands
  // of entries — and each one costs a profile (a median per offset over the
  // page) and a tilt fit. Measured on the real certificate that was 8.9
  // SECONDS for the colour path against 180ms before. Since `fitTilt` measures
  // the tilt from the pixels, one seed per position is all that is needed.
  const order: number[] = [];
  for (let k = 0; k < votes.length; k++) if (votes[k] >= need) order.push(k);
  order.sort((p, q) => votes[q] - votes[p]);
  const tried: number[] = [];

  for (const k of order) {
    if (found.length >= o.maxPerAxis || tried.length >= 8) break;
    const seedCentre = (k % bins) - margin;
    if (tried.some((t) => Math.abs(t - seedCentre) < 2 * maxHalf)) continue;
    tried.push(seedCentre);
    if (taken.some((t) => Math.abs(t - seedCentre) < 3 * maxHalf)) continue;

    // ⚠️ THE VOTE FINDS THE BAND BUT CANNOT CHOOSE THE TILT, so do not believe
    // the one it came with. A fold spanning the page scores 100% coverage at
    // EVERY tilt whose line stays inside the band over its length — on the
    // synthetic bench the vote called a 2.5° fold 3°, and a square one −0.5°,
    // purely on which bin the sort reached first. Fitting a line to the
    // darkest offset per position measures the tilt instead of guessing it,
    // and is not restricted to the 0.5° grid the vote was quantised to.
    const slope = fitTilt(deficit, lay, seedCentre, slopes[(k / bins) | 0], maxHalf, o);

    // …and the vote's OFFSET is no better than its tilt: it is the bin that
    // won, not the ridge. Re-centre on the deepest offset of the profile, once.
    measure(seedCentre, slope);
    let peakAt = 0;
    for (let d = -maxHalf; d <= maxHalf; d++) {
      if (profile[d + obsHalf] > profile[peakAt + obsHalf]) peakAt = d;
    }
    const centre = seedCentre + peakAt;
    if (peakAt !== 0) measure(centre, slope);
    const peak = profile[obsHalf];
    if (peak < o.faintMin || peak > o.faintMax) continue;

    // How far the shadow reaches: out to where the profile falls under a
    // quarter of the peak, or under 1.5 levels, whichever comes first.
    const floor = Math.max(1.5, peak * 0.25);
    let reach = obsHalf;
    for (let d = 1; d <= obsHalf; d++) {
      if (profile[obsHalf + d] < floor && profile[obsHalf - d] < floor) {
        reach = d;
        break;
      }
    }
    // ⚠️ THE BAND MUST BE A BAND. Too thin and it is a printed hairline (see
    // MIN_HALF); too wide and it never closed inside the widest fold shadow we
    // accept, which means it is shading, not a fold.
    if (reach < CREASE_MIN_HALF || reach >= maxHalf) continue;

    // Along the core: how much of it is ink, and is it darker than its OWN
    // surroundings for most of its length? The shoulder subtraction is the
    // same argument as in `measure`, applied per position rather than to the
    // median — it is what a text row fails, because a text row's ink is
    // concentrated in bursts with clean paper between the words.
    // ⚠️ THE SHOULDERS ARE READ JUST OUTSIDE THE BAND, AND THEY SKIP INK.
    // The first cut sampled a single pixel at obsHalf on each side, 51px away
    // — which on a form lands on the next line of type as often as not, and
    // reported the fold as 70 levels BRIGHTER than its surroundings. Take the
    // cleanest paper in a short window just past the band instead.
    const near = reach + 2;
    const far = Math.min(obsHalf, near + 6);
    let n = 0;
    let inked = 0;
    let seen = 0;
    for (let a = 0; a < nAlong; a++) {
      const c = Math.round(centre + (a - mid) * slope);
      if (c - far < 0 || c + far >= nAcross) continue;
      const base = a * sAlong;
      seen++;
      if (ink[base + c * sAcross]) {
        inked++;
        continue;
      }
      let lo = Infinity;
      let hi = Infinity;
      for (let d = near; d <= far; d++) {
        const iLo = base + (c - d) * sAcross;
        const iHi = base + (c + d) * sAcross;
        if (!ink[iLo] && deficit[iLo] < lo) lo = deficit[iLo];
        if (!ink[iHi] && deficit[iHi] < hi) hi = deficit[iHi];
      }
      if (lo === Infinity || hi === Infinity) continue;
      scratch[n++] = deficit[base + c * sAcross] - (lo + hi) / 2;
    }
    if (!seen || inked / seen > CREASE_MAX_INK) continue;
    if (percentileOf(scratch, n, 0.25) < o.faintMin * 0.6) continue;

    taken.push(centre);
    found.push({
      axis: lay.axis,
      centre,
      slope,
      half: reach,
      depth: peak,
      coverage: votes[k] / nAlong,
    });
  }
  return found;
}

/**
 * Every fold on the page, in full-resolution coordinates.
 *
 * Exported separately from the correction so a test — and a diagnostic — can
 * ask what was found without also asking for it to be removed.
 */
export function findCreases(
  luma: Float32Array,
  w: number,
  h: number,
  opts: CreaseOptions = {},
): CreaseBand[] {
  const o: Required<CreaseOptions> = {
    faintMin: opts.faintMin ?? CREASE_FAINT_MIN,
    faintMax: opts.faintMax ?? CREASE_FAINT_MAX,
    minCoverage: opts.minCoverage ?? CREASE_MIN_COVERAGE,
    maxPerAxis: opts.maxPerAxis ?? 2,
  };
  const long = Math.max(w, h);
  const scale = Math.min(1, CREASE_SCALE / long);
  const sw = Math.max(16, Math.round(w * scale));
  const sh = Math.max(16, Math.round(h * scale));
  if (sw < 48 || sh < 48) return [];
  const small = scale < 1 ? shrink(luma, w, h, sw, sh) : luma;

  // ⚠️ THE PAPER ESTIMATE IS A MAX FILTER AND THEREFORE READS HIGH — 10.7
  // levels on the real certificate, which is inside the faint window. The
  // median deficit over a document IS that bias (a document is mostly bare
  // paper), so subtracting it puts clean paper back near zero, which is what
  // the ink threshold below assumes. It is NOT enough on its own — the amount
  // it reads high varies over the page — and the per-axis top hat in
  // `findAxisCreases` is what actually handles that.
  //
  // Computed here rather than per axis: it took a third of this function's
  // time and both directions want the same numbers.
  const paper = creasePaper(small, sw, sh);
  const deficit = new Float32Array(small.length);
  for (let i = 0; i < small.length; i++) deficit[i] = paper[i] - small[i];
  const bias = medianOf(deficit);
  for (let i = 0; i < deficit.length; i++) deficit[i] -= bias;
  // Ink: much darker than the paper. A coarse call, so a global de-bias is
  // accurate enough — five levels either way does not matter at 45.
  const ink = new Uint8Array(deficit.length);
  for (let i = 0; i < deficit.length; i++) if (deficit[i] > o.faintMax) ink[i] = 1;

  const kx = w / sw;
  const ky = h / sh;
  const out: CreaseBand[] = [];
  for (const axis of ['row', 'col'] as const) {
    for (const b of findAxisCreases(deficit, ink, layout(sw, sh, axis), o)) {
      // Across-axis lengths scale by that axis's own factor; the slope is a
      // ratio of the two, so it picks up both.
      const kAcross = axis === 'row' ? ky : kx;
      const kAlong = axis === 'row' ? kx : ky;
      out.push({
        ...b,
        centre: (b.centre + 0.5) * kAcross,
        slope: (b.slope * kAcross) / kAlong,
        half: b.half * kAcross,
      });
    }
  }
  return out;
}

/**
 * Put the paper back inside the fold.
 *
 * ⚠️ IN PLACE, AND THE RETURNED PLANE IS THE ONE PASSED IN. That is what makes
 * "an uncreased page is untouched" byte-identical rather than nearly so, and
 * it keeps this off the memory peak — enhance() is already holding three
 * full-resolution planes by the time this runs.
 *
 * Inside a band each pixel's target is the paper interpolated between two
 * CLEAN anchor lines just outside the band — a local max over a small window
 * on each, so a glyph sitting on an anchor cannot drag the target down. Then:
 *
 *   deficit ≤ 25          the fold, lifted the whole way to the target;
 *   25 < deficit < 45     blended out, so a glyph's antialiased edge is not
 *                         bitten in half at a threshold;
 *   deficit ≥ 45          ink. Untouched. This is the text crossing the fold.
 *
 * and the correction fades to nothing across the last quarter of the band, so
 * no seam can appear where a slightly-mismeasured band meets untouched page.
 */
export function suppressCreases(
  luma: Float32Array,
  w: number,
  h: number,
  opts: CreaseOptions = {},
): { luma: Float32Array; bands: CreaseBand[] } {
  const bands = findCreases(luma, w, h, opts);
  if (!bands.length) return { luma, bands };

  const faintMax = opts.faintMax ?? CREASE_FAINT_MAX;
  const inkSoft = faintMax * 0.55; // 24.75 at the default 45
  for (const b of bands) {
    const { nAlong, nAcross, sAlong, sAcross } = layout(w, h, b.axis);
    const mid = (nAlong - 1) / 2;
    // ⚠️ CORRECT WIDER THAN WE MEASURED. `half` is where the profile fell to a
    // quarter of its peak, which is a good way to IDENTIFY a band and a poor
    // way to bound one — the shadow carries on past it. Measured on a real
    // certificate with a fold pressed into it: at the measured width the fold
    // line came back to 6.6 levels below its paper, at 1.6× to 2.3. Widening
    // is close to free because every pixel of the correction is driven by the
    // deficit it finds, and outside the shadow there is none.
    const half = Math.max(1, Math.round(b.half * 1.6));
    const pad = Math.max(2, Math.round(half * 0.4));
    // The anchor window along the line: wide enough to step over a glyph,
    // narrow enough that the paper level it reports is still local.
    const win = Math.max(3, Math.round(nAlong / 200));

    for (let a = 0; a < nAlong; a++) {
      const line = Math.round(b.centre + (a - mid) * b.slope);
      const cA = line - half - pad;
      const cB = line + half + pad;
      if (cA < 0 || cB >= nAcross) continue;

      let anchorA = 0;
      let anchorB = 0;
      for (let k = -win; k <= win; k++) {
        const base = Math.min(nAlong - 1, Math.max(0, a + k)) * sAlong;
        const va = luma[base + cA * sAcross];
        const vb = luma[base + cB * sAcross];
        if (va > anchorA) anchorA = va;
        if (vb > anchorB) anchorB = vb;
      }

      const base = a * sAlong;
      for (let d = -half; d <= half; d++) {
        const c = line + d;
        if (c < 0 || c >= nAcross) continue;
        const i = base + c * sAcross;
        const t = (d + half) / (2 * half);
        const deficit = anchorA * (1 - t) + anchorB * t - luma[i];
        if (deficit <= 0 || deficit >= faintMax) continue;
        let k = deficit > inkSoft ? (faintMax - deficit) / (faintMax - inkSoft) : 1;
        const e = Math.abs(d) / half;
        if (e > 0.75) k *= (1 - e) / 0.25;
        luma[i] += k * deficit;
      }
    }
  }
  return { luma, bands };
}

// ────────────────────────────────────────────────────────────────────
// SHARPENING WITHOUT THE GREY RING
// ────────────────────────────────────────────────────────────────────

/** How hard to sharpen, and with what kernel. See `sharpenPlan`. */
export interface SharpenPlan {
  /** Gain on the mask. */
  gain: number;
  /** Blur radius, px. */
  radius: number;
  /** Blur passes — a single box is blocky at any radius above 1. */
  passes: number;
  /** Deadzone in luma levels, below which the mask is not the signal. */
  threshold: number;
}

/**
 * ⚠️ THE MOST THE MASK MAY DARKEN A PIXEL THAT IS ALREADY PAPER.
 *
 * This is the whole fix for "the darkening around the text". Two levels is
 * under a JPEG quantisation step on a bright flat: it is the difference
 * between a ring you can see and one you cannot.
 */
const HALO_ON_PAPER = 2;

/**
 * Measured sharpness of a rectified page, mean absolute Laplacian.
 *
 * ⚠️ THESE TWO NUMBERS ARE MEASURED, NOT CHOSEN. Across the real fixtures a
 * rectified page scores 10.3, 7.5, 6.6, 6.6, 6.1, 5.3, 5.1, 4.9 on the iPhone
 * captures and 1.7 on the one genuinely soft frame. The same photographs
 * pushed through a σ=1.4 blur — roughly how much softer the operator's Samsung
 * output is than the iPhone's — land at 2.1, 2.3, 2.7. So 3 and 7 bracket the
 * real population with the soft end below and the crisp end above.
 */
export const SHARP_SOFT = 3;
export const SHARP_CRISP = 7;

/**
 * Mean absolute Laplacian. `step` samples every step-th pixel in both
 * directions; the Laplacian itself always uses immediate neighbours, so the
 * answer is the same statistic measured on fewer of them.
 */
export function meanAbsLaplacian(
  luma: Float32Array,
  w: number,
  h: number,
  step = 1,
): number {
  let lap = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += step) {
    const row = y * w;
    for (let x = 1; x < w - 1; x += step) {
      const i = row + x;
      lap += Math.abs(
        4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w],
      );
      n++;
    }
  }
  return n ? lap / n : 0;
}

/**
 * THE GAIN SCHEDULE.
 *
 * ⚠️ A SOFT SOURCE NEEDS A BIGGER RADIUS AND LESS GAIN, WHICH IS THE OPPOSITE
 * OF THE OBVIOUS MOVE. The Samsung's edges are spread over three or four
 * pixels, so a radius-1 mask samples entirely INSIDE the ramp: it finds almost
 * nothing at the edge and plenty on the flats — exactly the wrong way round,
 * amplifying JPEG mush while leaving the edge soft. A radius that SPANS the
 * ramp finds the edge instead, and once it does it needs less gain to get the
 * same contrast back. The deadzone follows from the same fact: on a soft
 * source the mask's small values are compression artefacts, not detail.
 *
 * The crisp end is deliberately EXACTLY what this file did before (0.6, radius
 * 1, no deadzone), so a sharp iPhone capture changes only by the halo clamp.
 */
export function sharpenPlan(sharpness: number): SharpenPlan {
  const t = Math.max(
    0,
    Math.min(1, (sharpness - SHARP_SOFT) / (SHARP_CRISP - SHARP_SOFT)),
  );
  const radius = Math.max(1, Math.round(3 + t * (1 - 3)));
  return {
    gain: 0.32 + t * (0.6 - 0.32),
    radius,
    passes: radius > 1 ? 2 : 1,
    threshold: 3 - t * 3,
  };
}

/**
 * A HALO-SUPPRESSED UNSHARP MASK.
 *
 * A plain unsharp mask is symmetric: it brightens the light side of every edge
 * and darkens the dark side by the same amount. On print that is a bad trade,
 * because the two sides are not the same kind of thing — the dark side is INK,
 * where more contrast is pure gain, and the light side is PAPER, where any
 * darkening at all reads as a grey shadow drawn round every glyph. On a soft
 * source, where the ramp is wide and the mask has plenty to work with on both
 * sides, that shadow is what the operator reported on the Samsung output.
 *
 * So the darkening half is clamped by how paper-like the pixel already is: ink
 * darkens freely, paper may not lose more than HALO_ON_PAPER levels, and
 * everything between rides a smooth ramp so no boundary shows.
 *
 * ⚠️ A FLAT FRACTION (darkGain = ½ × gain) WAS TRIED FIRST AND REJECTED. It
 * does suppress the ring, but it also halves the mask on genuine ink, so small
 * print comes back softer than it went in — which fails the one thing this
 * function exists to protect.
 */
export function unsharp(
  lifted: Float32Array,
  w: number,
  h: number,
  plan: SharpenPlan,
  spare?: Float32Array,
): Float32Array {
  const blur = boxBlur(lifted, w, h, plan.radius, plan.passes, spare);
  const out = new Float32Array(lifted.length);
  // Where paper is, and where ink is, on THIS plane — which has already been
  // flattened and equalised, so a hard-coded 245 would be wrong whenever
  // either of those steps is switched off.
  const paper = Math.max(32, paperLevel(lifted, 0.9));
  const inkTop = paper * 0.55;
  const span = Math.max(1, paper * 0.88 - inkTop);

  for (let i = 0; i < lifted.length; i++) {
    const v = lifted[i];
    const d = v - blur[i];
    let next = v;
    if (d > plan.threshold) {
      next = v + plan.gain * (d - plan.threshold);
    } else if (d < -plan.threshold) {
      let dark = plan.gain * (-d - plan.threshold);
      // ⚠️ TWO QUESTIONS, AND THE PIXEL HAS TO PASS BOTH TO BE PROTECTED.
      //
      // How bright is it on the page? That is the one that matters in the real
      // pipeline, where flatten has already put the paper at a known level.
      //
      // And how bright is it against its OWN neighbourhood? That one matters
      // when the first is wrong. On a badly softened source a 2px stroke never
      // reaches its ink value at all — blurred it sits at 190 against 232
      // paper, comfortably above the global ink line — so the global test
      // alone declared the STROKE to be paper and clamped the very darkening
      // that makes it legible. Measured on the soft bench, edge contrast fell
      // from 14.1 to 12.7 before this second question was added.
      const ratio = blur[i] > 1 ? v / blur[i] : 1;
      const paperness = Math.min(
        Math.max(0, Math.min(1, (v - inkTop) / span)),
        Math.max(0, Math.min(1, (ratio - 0.9) / 0.08)),
      );
      // At paperness 1 this is min(dark, 2); at 0 it is dark, unchanged.
      const cap = HALO_ON_PAPER + (1 - paperness) * dark;
      if (dark > cap) dark = cap;
      next = v - dark;
    }
    out[i] = next < 0 ? 0 : next > 255 ? 255 : next;
  }
  return out;
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

/**
 * Sample the four surrounding tile curves and blend.
 *
 * ⚠️ enhance() DOES NOT CALL THIS — it inlines it, for the six-million-calls
 * reason recorded at the call site. This stays as the readable statement of
 * the arithmetic, and `enhance.spec.ts` pins the inlined loop against it pixel
 * for pixel so the two can never drift.
 */
export function claheAt(
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
  return {
    glare: blown / luma.length,
    // High on crisp print, low on a soft photograph. Step 1 — this number is
    // read by the verdicts the member sees, so it stays exact.
    sharpness: meanAbsLaplacian(luma, r.width, r.height, 1),
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
  // ⚠️ MEASURED ON THE SOURCE LUMA, and measured ONCE for both (b) and (c).
  // The schedule is asking how soft the OPTICS were; flatten and CLAHE have
  // both already changed the contrast by the time those steps want the answer,
  // so the Laplacian of anything later describes this function's own work
  // rather than the phone's. Step 2 — a quarter of the pixels, which is still
  // a hundred thousand samples of a single mean on any real page.
  const sharpness = meanAbsLaplacian(luma, w, h, 2);
  // ⚠️ `out` IS ALLOCATED AT THE BOTTOM, NOT HERE, AND THAT IS DELIBERATE. It
  // used to be created on this line and then sat untouched — a full RGBA plane
  // of reserved, idle memory — through flatten, CLAHE and the unsharp mask,
  // every one of which is more memory-hungry than the loop that finally writes
  // it. It cost a plane at exactly the moment we had least to spare.

  // (a) Divide the paper up to white. See flattenLuma — the reasoning, and the
  // two-scale field that keeps the gain continuous across a photograph, both
  // live beside the code that does it.
  let corrected = luma;
  if (o.flatten) corrected = flattenLuma(luma, w, h);

  // (a2) Take the fold out, if there is one.
  //
  // ⚠️ AFTER FLATTENING AND BEFORE CLAHE, and neither neighbour is negotiable.
  // Before flattening, "faintly darker than the paper" is not a fixed number —
  // the lighting gradient is bigger than the whole faint window. After CLAHE,
  // the fold has been AMPLIFIED as local contrast and is no longer faint, so
  // the window that identifies it would no longer contain it.
  //
  // ⚠️ IT RUNS ON `corrected` IN PLACE. When flatten is off that array IS
  // `luma`, which the final gain loop reads as its denominator — so in that
  // one case it gets its own copy, or every corrected pixel would divide
  // itself away to a gain of 1.
  if (o.creases) {
    if (corrected === luma) corrected = Float32Array.from(luma);
    suppressCreases(corrected, w, h);
  }

  // (b) Local contrast.
  //
  // ⚠️ HELD BACK ON A SOFT SOURCE, FOR THE SAME REASON THE MASK IS. CLAHE
  // lifts local contrast, and on a soft capture the local contrast next to a
  // glyph IS the lens's bleed — so at full strength it takes the source's own
  // 19-level grey skirt and prints it at 40. Measured on the spaced-marks
  // bench at σ=2: full CLAHE turned a 19.5-level source skirt into 39.9,
  // against 22 at this mix. The detail it exists to lift — a faint stamp,
  // security print — is not there to lift on a page this soft anyway.
  const claheMix =
    0.55 +
    0.45 *
      Math.max(
        0,
        Math.min(1, (sharpness - SHARP_SOFT) / (SHARP_CRISP - SHARP_SOFT)),
      );
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
    // ⚠️ claheAt IS INLINED HERE, and only here, BECAUSE THIS LOOP RUNS ONCE
    // PER PIXEL. At 3000x2000 that is six million calls, each repeating two
    // divisions, two floors and six clamps whose answers depend only on x —
    // and x takes 3000 distinct values, not six million. Hoisting the column
    // half into three small arrays and the row half out of the inner loop cut
    // enhance() from 894ms to 560ms on the 3000x2000 bench, measured in node.
    // The arithmetic is unchanged; claheAt stays as the readable statement of
    // what this is doing, and the specs pin the two together.
    const tx0 = new Int32Array(w);
    const tx1 = new Int32Array(w);
    const twx = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * TILES - 0.5;
      const a = Math.max(0, Math.min(TILES - 1, Math.floor(fx)));
      tx0[x] = a;
      tx1[x] = Math.min(TILES - 1, a + 1);
      twx[x] = Math.max(0, Math.min(1, fx - a));
    }
    const BIN_SCALE = BINS / 256;
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * TILES - 0.5;
      const ty0 = Math.max(0, Math.min(TILES - 1, Math.floor(fy)));
      const ty1 = Math.min(TILES - 1, ty0 + 1);
      const wy = Math.max(0, Math.min(1, fy - ty0));
      const rowA = ty0 * TILES;
      const rowB = ty1 * TILES;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let b = (corrected[i] * BIN_SCALE) | 0;
        if (b < 0) b = 0;
        else if (b >= BINS) b = BINS - 1;
        const wx = twx[x];
        const a0 = tx0[x];
        const a1 = tx1[x];
        const v =
          luts[rowA + a0][b] * (1 - wx) * (1 - wy) +
          luts[rowA + a1][b] * wx * (1 - wy) +
          luts[rowB + a0][b] * (1 - wx) * wy +
          luts[rowB + a1][b] * wx * wy;
        lifted[i] = corrected[i] + claheMix * (v - corrected[i]);
      }
    }
  }

  // (c) A halo-suppressed unsharp mask, to put back what the warp's bilinear
  // cost. Kept low on purpose: over-sharpening rings around glyph strokes, and
  // a vision model reads ringing as noise.
  let finalL = lifted;
  if (o.sharpen) {
    // ⚠️ `corrected` IS DEAD BY HERE — CLAHE read it for the last time when it
    // built `lifted`. Lending it to boxBlur is the difference between four and
    // five full-resolution planes at this function's busiest moment. When
    // localContrast is off, `lifted` IS `corrected` and it is very much alive,
    // so the loan is only offered when they are genuinely different arrays.
    const spare =
      corrected !== lifted && corrected !== luma ? corrected : undefined;
    finalL = unsharp(
      lifted,
      w,
      h,
      sharpenPlan(sharpness),
      spare,
    );
  }

  // Re-apply as a per-pixel GAIN so hue survives.
  const out = new Uint8ClampedArray(r.data.length);
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
