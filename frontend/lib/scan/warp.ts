import { Homography, Quad, applyH, homographyToRect } from './geometry';

// ────────────────────────────────────────────────────────────────────
// SQUARING THE DOCUMENT UP.
//
// Pure: RGBA in, RGBA out. No canvas — the caller does the decoding and the
// encoding, which is what lets every line below be tested in node.
//
// ⚠️ THE BUG THIS FILE EXISTS TO AVOID. Warping straight from a 4032-px phone
// photo down to a 2000-px output is a 2x minification, and plain bilinear
// sampling at that ratio ALIASES — it point-samples every other pixel and
// turns 8-point print into mush. The output looks worse than the photograph it
// came from, which defeats the entire feature, and it is the single most
// common way a hand-rolled scanner fails.
//
// The fix is not optional and it is not clever: box-downsample the source in
// halves until the remaining minification is mild, THEN warp. halveRGBA below.
// ────────────────────────────────────────────────────────────────────

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Above this minification, sampling without pre-filtering starts to alias. */
export const SAFE_MINIFICATION = 1.6;

/**
 * One 2x box downsample. Averages each 2x2 block.
 *
 * Odd dimensions keep their last row/column by clamping, rather than dropping
 * it — dropping a column shifts the image half a pixel, which moves the
 * corners we just measured.
 */
export function halveRGBA(src: Raster): Raster {
  const w = Math.max(1, src.width >> 1);
  const h = Math.max(1, src.height >> 1);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(src.height - 1, y * 2);
    const y1 = Math.min(src.height - 1, y * 2 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(src.width - 1, x * 2);
      const x1 = Math.min(src.width - 1, x * 2 + 1);
      const a = (y0 * src.width + x0) * 4;
      const b = (y0 * src.width + x1) * 4;
      const c = (y1 * src.width + x0) * 4;
      const d = (y1 * src.width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        out[o + k] =
          (src.data[a + k] + src.data[b + k] + src.data[c + k] + src.data[d + k] + 2) >>
          2;
      }
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Halve the source until warping to `dstW` x `dstH` is no longer a harsh
 * minification, returning the reduced raster and the scale applied to it.
 *
 * The quad has to be scaled by the same factor, which is the caller's job and
 * is why the factor comes back.
 */
export function prefilterFor(
  src: Raster,
  dstW: number,
  dstH: number,
): { raster: Raster; scale: number } {
  let raster = src;
  let scale = 1;
  // BOTH axes, not either. halveRGBA is isotropic, so halving because the
  // width needs it would squash a height that was already 1:1. For a real
  // document the two ratios track each other closely — the destination
  // rectangle is derived from the quad — so this costs nothing in practice and
  // makes the degenerate case safe.
  while (
    raster.width / Math.max(1, dstW) > SAFE_MINIFICATION &&
    raster.height / Math.max(1, dstH) > SAFE_MINIFICATION &&
    raster.width > 2 &&
    raster.height > 2
  ) {
    raster = halveRGBA(raster);
    scale /= 2;
  }
  return { raster, scale };
}

/** Bilinear sample with edge clamping. Writes into `out` at `o`. */
function sampleInto(
  src: Raster,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  o: number,
): void {
  const w = src.width;
  const h = src.height;
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = cx - x0;
  const fy = cy - y0;

  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  for (let k = 0; k < 4; k++) {
    out[o + k] =
      src.data[i00 + k] * w00 +
      src.data[i10 + k] * w10 +
      src.data[i01 + k] * w01 +
      src.data[i11 + k] * w11;
  }
}

/**
 * Warp `quad` out of `src` onto a `dstW` x `dstH` rectangle.
 *
 * Iterates over DESTINATION pixels and samples the source, which is the only
 * direction that cannot leave holes. The homography's numerators are linear in
 * u, so each scanline is stepped incrementally rather than re-evaluated.
 */
export function warpQuad(
  src: Raster,
  quad: Quad,
  dstW: number,
  dstH: number,
): Raster | null {
  const hm: Homography | null = homographyToRect(quad, dstW, dstH);
  if (!hm) return null;

  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let v = 0; v < dstH; v++) {
    // ⚠️ PIXEL CENTRES, NOT PIXEL CORNERS. The homography is defined on the
    // continuous rectangle, so destination pixel (u,v) covers the area whose
    // centre is (u+0.5, v+0.5). Evaluating at the corner instead shifts the
    // whole output half a pixel up and left — invisible on a photograph, and
    // exactly enough to soften small print, which is the thing this scanner
    // exists to keep sharp. The matching -0.5 on the way into the source array
    // is what makes an identity warp come back bit-exact.
    const vc = v + 0.5;
    let nx = hm[1] * vc + hm[2];
    let ny = hm[4] * vc + hm[5];
    let nd = hm[7] * vc + hm[8];
    // Advance to the first pixel's centre.
    nx += hm[0] * 0.5;
    ny += hm[3] * 0.5;
    nd += hm[6] * 0.5;
    for (let u = 0; u < dstW; u++) {
      const o = (v * dstW + u) * 4;
      if (Math.abs(nd) > 1e-12) {
        sampleInto(src, nx / nd - 0.5, ny / nd - 0.5, out, o);
      }
      nx += hm[0];
      ny += hm[3];
      nd += hm[6];
    }
  }
  return { data: out, width: dstW, height: dstH };
}

/**
 * The whole rectification: pre-filter, scale the quad to match, warp.
 *
 * This is the function the worker calls. Keeping the prefilter and the quad
 * scaling together is the point — doing one without the other silently
 * produces a crop of the wrong region, which is far worse than aliasing
 * because it looks deliberate.
 */
export function rectify(
  src: Raster,
  quad: Quad,
  dstW: number,
  dstH: number,
): Raster | null {
  const { raster, scale } = prefilterFor(src, dstW, dstH);
  const scaled = quad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad;
  return warpQuad(raster, scaled, dstW, dstH);
}

/** Where a destination pixel came from. Used by the tests, and by the loupe. */
export function sourceOf(
  quad: Quad,
  dstW: number,
  dstH: number,
  u: number,
  v: number,
) {
  const hm = homographyToRect(quad, dstW, dstH);
  return hm ? applyH(hm, u, v) : null;
}
