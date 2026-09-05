// ⚠️ MIRRORED FROM frontend/lib/scan/doccorner.ts — KEEP THE TWO IN STEP.
// Only the pre/post-processing lives here; the choice between candidates is
// made by the client, which knows the shape and the aim box. The tests for
// this copy are in doccorner.spec.ts beside it.

/** The model's square input edge. Stretched, not letterboxed. */
export const DCN_SIZE = 224;

/** ImageNet normalisation, per the model card. */
export const DCN_MEAN = [0.485, 0.456, 0.406] as const;
export const DCN_STD = [0.229, 0.224, 0.225] as const;

/** How far past the aim box the second pass looks, as a fraction of the box. */
export const AIM_PASS_MARGIN = 0.35;

export interface Pt {
  x: number;
  y: number;
}
export type Quad = [Pt, Pt, Pt, Pt];

/** A region of the frame, all FRACTIONS 0..1. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_REGION: Region = { x: 0, y: 0, w: 1, h: 1 };

/**
 * RGBA (or RGB) pixels of a DCN_SIZE square to the model's NHWC float tensor.
 *
 * ⚠️ STRETCHED TO SQUARE, NOT LETTERBOXED. The model was trained on
 * stretch-resized inputs and answers in fractions of what it was given.
 */
export function toInputTensor(
  px: Uint8ClampedArray | Uint8Array | Buffer,
  channels: 3 | 4 = 3,
  out?: Float32Array,
): Float32Array {
  const n = DCN_SIZE * DCN_SIZE;
  const t = out ?? new Float32Array(n * 3);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += channels, k += 3) {
    t[k] = (px[j] / 255 - DCN_MEAN[0]) / DCN_STD[0];
    t[k + 1] = (px[j + 1] / 255 - DCN_MEAN[1]) / DCN_STD[1];
    t[k + 2] = (px[j + 2] / 255 - DCN_MEAN[2]) / DCN_STD[2];
  }
  return t;
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/** The model's two outputs to a quad (fractions of the region) and a presence. */
export function decodeOutputs(
  coords: ArrayLike<number>,
  scoreLogit: number,
): { quad: Quad; score: number } {
  const c = (i: number) => Math.max(0, Math.min(1, Number(coords[i])));
  const quad: Quad = [
    { x: c(0), y: c(1) },
    { x: c(2), y: c(3) },
    { x: c(4), y: c(5) },
    { x: c(6), y: c(7) },
  ];
  return { quad, score: sigmoid(scoreLogit) };
}

/** The aim-pass region: the box grown by AIM_PASS_MARGIN, clamped to the frame. */
export function regionForAim(
  aim: { x: number; y: number; width: number; height: number },
  margin = AIM_PASS_MARGIN,
): Region {
  const mx = aim.width * margin;
  const my = aim.height * margin;
  const x0 = Math.max(0, aim.x - mx);
  const y0 = Math.max(0, aim.y - my);
  const x1 = Math.min(1, aim.x + aim.width + mx);
  const y1 = Math.min(1, aim.y + aim.height + my);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** A quad in fractions of `region` to fractions of the whole frame. */
export function mapFromRegion(quad: Quad, region: Region): Quad {
  return quad.map((p) => ({
    x: region.x + p.x * region.w,
    y: region.y + p.y * region.h,
  })) as Quad;
}
