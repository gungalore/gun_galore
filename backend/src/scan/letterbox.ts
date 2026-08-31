/** A point in whatever coordinate space the caller is working in. */
export interface Pt {
  x: number;
  y: number;
}

/** Four corners, in TL TR BR BL order. */
export type Quad = [Pt, Pt, Pt, Pt];

// ────────────────────────────────────────────────────────────────────
// Letterbox — fitting a camera frame into the model's square input, and
// getting the answer back out again.
//
// ⚠️ THE INVERSE IS WHERE EVERY BUG IN THIS PROJECT HAS LIVED. Four separate
// measurement harnesses produced confident, wrong numbers, and two of them
// were this transform:
//
//   · one arm had NO inverse at all, so predicted corners stayed in 256-space
//     while ground truth was in original pixels — it scored a structural zero
//     and was written up as "the model cannot see the document"
//   · another mapped back through a stale intermediate size, so the corners
//     landed in a 720px space that no longer existed
//
// Neither threw. Both looked plausible. So this file is pure arithmetic with
// no image handling in it at all, every function has an exact inverse, and
// the spec asserts a round trip — push a point forward, bring it back, and it
// must land where it started. That test is cheap and it is the only thing
// that reliably catches this class of mistake.
//
// The padding colour is not arbitrary either. The reference implementation
// (MakeACopy, Apache 2.0) pads mid-grey and says why:
//
//   "Neutral mid-gray padding reduces hard contrast at letterbox borders
//    compared to pure black, which empirically reduces spurious heatmap peaks
//    at the image edge for documents close to the frame border."
//
// Black padding manufactures a hard rectangular edge in exactly the place a
// corner detector is looking, and the model latches onto it. 128 is the
// photometric midpoint of the [0,1] range the model consumes, so it reads as
// "nothing here" rather than as an edge.
// ────────────────────────────────────────────────────────────────────

/** The model's square input edge. */
export const MODEL_SIZE = 256;

/** The side of each corner heatmap the model emits. */
export const HEATMAP_SIZE = 64;

/**
 * Mid-grey, RGB(128,128,128).
 *
 * ⚠️ NOT BLACK. See the note above — this is a measured choice in the
 * reference implementation, not a default.
 */
export const PAD_VALUE = 128;

/**
 * How a source frame maps into the model's square input.
 *
 * `scale` then `offset`, in that order. Aspect is preserved, so one axis is
 * padded and the other fills.
 */
export interface Letterbox {
  /** Source dimensions this was computed for. */
  srcWidth: number;
  srcHeight: number;
  /** Multiply source coordinates by this. */
  scale: number;
  /** Then add these. Half the leftover on each axis — the content is centred. */
  offsetX: number;
  offsetY: number;
}

/** Work out the letterbox for a frame of this size. */
export function letterboxFor(srcWidth: number, srcHeight: number): Letterbox {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { srcWidth, srcHeight, scale: 1, offsetX: 0, offsetY: 0 };
  }
  // min, not max: the whole frame must fit inside the square, which is what
  // leaves padding on the shorter axis rather than cropping the longer one.
  const scale = Math.min(MODEL_SIZE / srcWidth, MODEL_SIZE / srcHeight);
  return {
    srcWidth,
    srcHeight,
    scale,
    offsetX: (MODEL_SIZE - srcWidth * scale) / 2,
    offsetY: (MODEL_SIZE - srcHeight * scale) / 2,
  };
}

/** A point in the source frame, expressed in the model's 256-space. */
export function toModelSpace(lb: Letterbox, p: Pt): Pt {
  return { x: p.x * lb.scale + lb.offsetX, y: p.y * lb.scale + lb.offsetY };
}

/**
 * A point in the model's 256-space, brought back to the source frame.
 *
 * The exact inverse of toModelSpace. If you change one, change both, and the
 * round-trip test in the spec will tell you immediately if you did not.
 */
export function toSourceSpace(lb: Letterbox, p: Pt): Pt {
  if (lb.scale === 0) return { x: 0, y: 0 };
  return { x: (p.x - lb.offsetX) / lb.scale, y: (p.y - lb.offsetY) / lb.scale };
}

/** Bring a whole quad back to source coordinates. */
export function quadToSourceSpace(lb: Letterbox, q: Quad): Quad {
  return [
    toSourceSpace(lb, q[0]),
    toSourceSpace(lb, q[1]),
    toSourceSpace(lb, q[2]),
    toSourceSpace(lb, q[3]),
  ];
}

/**
 * Where a heatmap cell sits in the model's 256-space.
 *
 * ⚠️ CELL CENTRE, NOT CELL CORNER. The heatmap is 64x64 over a 256x256 input,
 * so each cell covers 4 pixels. `(i / 64) * 256` gives the cell's top-left
 * corner and is biased up-left by half a cell — two pixels, every time, on
 * every corner. `(i + 0.5) * 4` gives the centre, which is what the peak
 * actually represents, and is what the reference implementation uses.
 */
export function cellToModelSpace(col: number, row: number): Pt {
  const step = MODEL_SIZE / HEATMAP_SIZE;
  return { x: (col + 0.5) * step, y: (row + 0.5) * step };
}

/**
 * Is this point inside the letterboxed content, rather than out on the padding?
 *
 * A corner predicted out on the grey border is not a corner of the document —
 * it is the model responding to the padding itself. Worth being able to ask,
 * since that is the failure the grey padding exists to suppress and we should
 * notice if it happens anyway.
 */
export function insideContent(lb: Letterbox, p: Pt, tolerance = 1): boolean {
  const right = MODEL_SIZE - lb.offsetX;
  const bottom = MODEL_SIZE - lb.offsetY;
  return (
    p.x >= lb.offsetX - tolerance &&
    p.x <= right + tolerance &&
    p.y >= lb.offsetY - tolerance &&
    p.y <= bottom + tolerance
  );
}
