import type { Quad, Rect } from './geometry';
import { quadBounds, rectIoU } from './geometry';
import { implausibleWhy } from './quad-plausible';

// ────────────────────────────────────────────────────────────────────
// DocCornerNet — the document detector, replacing DocQuadNet256 (2026-09-05).
//
// ⚠️ MIRRORED IN backend/src/scan/doccorner.ts — KEEP THE PRE/POST-PROCESSING
// IN STEP. The browser worker runs this per frame and the server runs it per
// capture when the browser cannot; there is no shared package between them.
//
// WHY IT REPLACED THE OLD MODEL. Measured over the operator's 33 real
// photographs (scan-fixtures/iphone74 + real), by eye against overlays:
//
//                      DocQuadNet256    DocCornerNet-lean
//   found the document     18/33            29/33   (31/33 with the aim pass)
//   size                   13.4 MB           1.9 MB
//   inference, 1 thread     ~60 ms           ~12 ms
//   "nothing here" answer   never            a presence score
//
// The old model always emitted four heatmap peaks — four planes, each with a
// maximum — so it could never say there was no document, and on the woven
// blanket, the ruler mat and the hand-held ID book it drew rectangles through
// thin air at high confidence. This one is SimCC coordinate classification on
// a MobileNetV2 backbone (Li et al., ECCV 2022), trained on MIDV (identity
// cards), SmartDoc, COCO negatives and Roboflow sets: it has seen cards on
// desks, and it has a head whose job is "is there a document at all".
//
// Model: doccornernet_lean.ort, MIT, by mapo80 via the scanic project. See
// backend/models/MODEL_CARD.doccornernet.md and NOTICE.doccornernet.
//
// ⚠️ TWO PASSES PER FRAME, AND THE SECOND IS WHAT WINS ON WHITE-ON-WHITE. On
// a licence card lying on a white sheet the full-frame pass finds the SHEET —
// a perfectly good document, just not the one the member is scanning. The
// same model run on the AIM-BOX REGION (the box the member is holding the
// card in, with margin) finds the card. That pass recovered 4 of the 5
// full-frame failures in the fixtures. pickCandidate chooses between them by
// the two things only we know: what shape the member said it is, and where
// they said it was.
// ────────────────────────────────────────────────────────────────────

/** The model's square input edge. Stretched, not letterboxed — see toInputTensor. */
export const DCN_SIZE = 224;

/** ImageNet normalisation, per the model card. */
export const DCN_MEAN = [0.485, 0.456, 0.406] as const;
export const DCN_STD = [0.229, 0.224, 0.225] as const;

/** How far past the aim box the second pass looks, as a fraction of the box. */
export const AIM_PASS_MARGIN = 0.35;

/** Where a candidate came from. */
export type PassRegion = 'full' | 'aim';

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
 * stretch-resized inputs and answers in fractions of what it was given, so
 * multiplying its coordinates by the source width and height undoes the
 * stretch exactly. Letterboxing here would be wrong twice: the model would
 * see an aspect it was not trained on, and the pad would need undoing.
 */
export function toInputTensor(
  px: Uint8ClampedArray | Uint8Array,
  channels: 3 | 4 = 4,
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

/**
 * The model's two outputs to a quad (fractions of the input region) and a
 * presence probability.
 *
 * `coords` is x0,y0,…,x3,y3 in TL TR BR BL order — the same order geometry.ts
 * uses, so nothing re-sorts it. Coordinates are clamped to [0,1]: the head can
 * answer a hair outside for a corner at the frame edge.
 */
export function decodeOutputs(
  coords: ArrayLike<number>,
  scoreLogit: number,
): { quad: Quad; score: number } {
  const c = (i: number) => Math.max(0, Math.min(1, Number(coords[i])));
  const quad = [
    { x: c(0), y: c(1) },
    { x: c(2), y: c(3) },
    { x: c(4), y: c(5) },
    { x: c(6), y: c(7) },
  ] as Quad;
  return { quad, score: sigmoid(scoreLogit) };
}

/** The aim-pass region: the box grown by AIM_PASS_MARGIN, clamped to the frame. */
export function regionForAim(aim: Rect, margin = AIM_PASS_MARGIN): Region {
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

export interface Candidate {
  /** Fractions of the WHOLE frame, TL TR BR BL. */
  quad: Quad;
  /** P(document present) for the pass that produced it. */
  score: number;
  region: PassRegion;
}

export interface PickContext {
  /** Candidates under this presence score are not considered. */
  minScore: number;
  /** Frame size in pixels — plausibility and aspect are judged in pixels. */
  frameW: number;
  frameH: number;
  /** The document's true long/short ratio, when the shape is known. */
  expectAspect?: number;
  /** Where the member was asked to put it, as fractions of the frame. */
  aim?: Rect;
}

export interface Pick extends Candidate {
  /** The pixel quad, for callers that draw or crop. */
  px: Quad;
  /** Lower is better. Exposed for the diagnostics panel. */
  cost: number;
  /** One line on why, for the panel. */
  why: string;
}

function edge(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The quad's long/short ratio from its mean opposite edges, in pixels. */
export function measuredAspect(px: Quad): number {
  const w = (edge(px[0], px[1]) + edge(px[3], px[2])) / 2;
  const h = (edge(px[0], px[3]) + edge(px[1], px[2])) / 2;
  const long = Math.max(w, h);
  const short = Math.max(1e-6, Math.min(w, h));
  return long / short;
}

/**
 * Choose between the full-frame and aim-pass candidates.
 *
 * Both passes see the same scene; they differ in what the model was shown.
 * A candidate must clear the presence score and be a plausible photographed
 * rectangle (quad-plausible.ts — convex, no corner under 50°, on the frame).
 * Among survivors the cost is:
 *
 *   |ln(measured aspect / expected aspect)|   0 when the shape is unknown
 *   + (1 − IoU of its bounds with the aim box) 0 when there is no box
 *
 * so a card found inside the box beats the sheet of paper it is lying on,
 * whose aspect is wrong and whose bounds swamp the box. Ties go to the full
 * pass, which saw more context. Nothing here invents a quad: no survivor
 * means null, and the caller falls back exactly as before.
 */
export function pickCandidate(cands: Candidate[], ctx: PickContext): Pick | null {
  let best: Pick | null = null;
  for (const c of cands) {
    if (!(c.score >= ctx.minScore)) continue;
    const px = c.quad.map((p) => ({ x: p.x * ctx.frameW, y: p.y * ctx.frameH })) as Quad;
    if (implausibleWhy(px, ctx.frameW, ctx.frameH)) continue;
    let cost = 0;
    const parts: string[] = [];
    if (ctx.expectAspect && ctx.expectAspect > 0) {
      const a = Math.abs(Math.log(measuredAspect(px) / ctx.expectAspect));
      cost += a;
      parts.push(`aspect ${a.toFixed(2)}`);
    }
    if (ctx.aim) {
      const b = quadBounds(c.quad);
      const agree = rectIoU(b, ctx.aim);
      cost += 1 - agree;
      parts.push(`aim ${(1 - agree).toFixed(2)}`);
    }
    const pick: Pick = { ...c, px, cost, why: `${c.region}: ${parts.join(', ') || 'no prior'}` };
    // Strict less-than: the full pass wins ties because it is listed first
    // by every caller, and because it saw the whole scene.
    if (!best || cost < best.cost) best = pick;
  }
  return best;
}
