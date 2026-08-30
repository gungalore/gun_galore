import type { Gray } from './detect';

// ────────────────────────────────────────────────────────────────────
// THE THREE MEASUREMENTS AUTO-CAPTURE DECIDES ON, MADE PURE.
//
// ⚠️ THESE LIVED INLINE IN document-scanner.tsx AND EVERY ONE OF THEM WAS
// WRONG ON A PHONE — in a way no desktop run could show, and no test could
// reach, because they were loop-local arithmetic inside a 2,400-line
// component. autocapture.ts made the DECISION pure and pinned its thresholds
// with tests; the READINGS it decides on were never given the same treatment,
// so the gates were exact and their inputs were not.
//
// Operator, 2026-08-30: "check why the auto capture does not fire on the
// phone." Three of the four faults found were here.
// ────────────────────────────────────────────────────────────────────

/** An axis-aligned region of a luma buffer, in buffer pixels. */
export interface BufferRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A box in CSS pixels, as `aimBox` returns it. */
export interface CssBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a CSS-space box lands in the luma buffer.
 *
 * ⚠️ TWO SCALES, NOT ONE — THIS IS THE BUG THAT MADE `ink` READ ZERO.
 * The scanner used a single `k = gray.width / elBox.width` and applied it to
 * the y axis as well. That is only correct while the buffer and the video's
 * CSS box share an aspect ratio, and they are guaranteed to share one only at
 * the instant the buffer is built: `scratch` is created once per scan and
 * never rebuilt, while `elBox` is re-read live every frame.
 *
 * On a phone that drifts apart within seconds. The scanner is
 * `position:fixed; inset:0`, so when the browser's address bar collapses the
 * pane's HEIGHT changes and its width does not. The y mapping then walks off
 * the buffer, `inkiness` discards every sample point that lands out of bounds
 * and returns exactly 0, `autoBlocker` answers 'empty' for ever, and the
 * shutter never arms. A desktop window does not resize under you, which is
 * precisely why this never showed up anywhere but a phone.
 *
 * Per-axis is not a patch on that — it is what the mapping always was.
 * `frameToGray` draws the visible region into the WHOLE buffer
 * (`drawImage(..., 0, 0, w, h)`), so buffer position is proportional to CSS
 * position on each axis independently, whatever either aspect ratio is doing.
 */
export function mapToBuffer(box: CssBox, elBox: CssBox, gray: Gray): BufferRect {
  const kx = gray.width / elBox.width;
  const ky = gray.height / elBox.height;
  return {
    x0: box.x * kx,
    y0: box.y * ky,
    x1: (box.x + box.width) * kx,
    y1: (box.y + box.height) * ky,
  };
}

/** A rect as the four-point quad `inkiness` wants, clockwise from top-left. */
export function rectQuad(r: BufferRect) {
  return [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ] as const;
}

/**
 * Every `stride`-th pixel inside a region, as a flat sample.
 *
 * ⚠️ THE MOTION READING WAS THE ONLY ONE MEASURED OVER THE WHOLE FRAME, and it
 * was the only one failing. On the operator's phone: ink 0.286 PASS, glare 0
 * PASS, luma 189 PASS, motion 22.31 against a limit of 4 — never once below it
 * across 400 frames, on a phone held deliberately still.
 *
 * The document sat on a WOVEN CARPET. Dense near-periodic texture is the
 * worst case for the 6.75x downscale that feeds this buffer, and every pixel
 * of that carpet — all of it OUTSIDE the aim box — was being counted as
 * evidence about whether the member's hand was moving.
 *
 * ⚠️ THIS IS THE MEASUREMENT, NOT A GUESS AT THE FIX. Scoping the reading to
 * the box is right on its own terms (the same rect already answers ink, glare
 * and luma), and it also tells us what the background was contributing: the
 * scanner now reports the boxed and whole-frame numbers side by side, so one
 * run says whether the carpet was the whole story or only part of it.
 */
export function sampleRegion(
  gray: Gray,
  r: BufferRect,
  stride = 2,
): Uint8Array {
  const x0 = Math.max(0, Math.floor(r.x0));
  const y0 = Math.max(0, Math.floor(r.y0));
  const x1 = Math.min(gray.width, Math.ceil(r.x1));
  const y1 = Math.min(gray.height, Math.ceil(r.y1));
  const cols = Math.max(0, Math.ceil((x1 - x0) / stride));
  const rows = Math.max(0, Math.ceil((y1 - y0) / stride));
  const out = new Uint8Array(cols * rows);
  let p = 0;
  for (let y = y0; y < y1; y += stride) {
    const row = y * gray.width;
    for (let x = x0; x < x1; x += stride) out[p++] = gray.data[row + x];
  }
  return out;
}

/**
 * Mean frame-to-frame movement, with a uniform brightness shift removed.
 *
 * ⚠️ THE SUBTRACTION IS THE WHOLE POINT. This was a plain mean of
 * `abs(cur - prev)`, and the scanner never locks exposure or white balance —
 * only `focusMode: 'continuous'` is ever applied, because the other two
 * constraints are unreliable across iOS and Android and locking them risks
 * freezing at a bad exposure. So the phone's auto-exposure hunts for the life
 * of the stream, and a hunt moves EVERY pixel the same way at once.
 *
 * A plain mean cannot tell that from a moving hand. MOTION_STILL is 4 on a
 * 0-255 scale — a hand at rest measures 1-3 — so an exposure hunt of a few
 * levels pins the reading above the threshold and 'steady' never clears.
 * Removing the mean delta first leaves real movement untouched, because a
 * moving document changes pixels by DIFFERENT amounts in different places and
 * that variation is what survives the subtraction.
 *
 * Both arrays must be the same length; the caller owns the sampling stride.
 */
export function motionOf(cur: Uint8Array, prev: Uint8Array): number {
  const n = Math.min(cur.length, prev.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += cur[i] - prev[i];
  const shift = sum / n;
  let diff = 0;
  for (let i = 0; i < n; i++) diff += Math.abs(cur[i] - prev[i] - shift);
  return diff / n;
}

/**
 * Blown-out fraction and mean brightness over one region of the buffer.
 *
 * ⚠️ OVER THE AIM BOX, NOT THE WHOLE FRAME — THE THIRD PHONE FAULT. These two
 * numbers were measured across the entire camera view while `ink`, right
 * beside them, was correctly measured over the aim box alone. `GLARE_AT` is
 * 0.02, and glare outranks every other exposure check unconditionally, so two
 * per cent of ANYTHING in view being blown out refuses the capture: a window,
 * a lamp, a white wall behind the desk. A phone is held closer and sees more
 * of the room than a laptop webcam does, so it trips on scenery the member is
 * not even pointing at, and the hint says "fix the lighting" about light that
 * is nowhere near the document.
 *
 * Scoping it to the box does not weaken the check — it sharpens it. Glare that
 * actually matters is the reflection ON the document, which is inside the box,
 * and that is still caught exactly as before.
 *
 * `stride` samples every Nth pixel along each row; this runs every frame.
 */
export function regionExposure(
  gray: Gray,
  r: BufferRect,
  stride = 2,
): { glare: number; luma: number } {
  const x0 = Math.max(0, Math.floor(r.x0));
  const y0 = Math.max(0, Math.floor(r.y0));
  const x1 = Math.min(gray.width, Math.ceil(r.x1));
  const y1 = Math.min(gray.height, Math.ceil(r.y1));
  let blown = 0;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += stride) {
    const row = y * gray.width;
    for (let x = x0; x < x1; x += stride) {
      const v = gray.data[row + x];
      if (v > 250) blown++;
      sum += v;
      n++;
    }
  }
  // ⚠️ A ZERO-PIXEL REGION IS NOT A DARK ONE. Returning luma 0 here would hand
  // exposureProblem a reading below DARK_AT and block the shutter on 'light'
  // — swapping one permanent phone-only stall for another. Mid-grey is the
  // reading that asserts nothing; `ink` is the gate that speaks to an empty
  // box, and it is measured over this same rect.
  if (n === 0) return { glare: 0, luma: 128 };
  return { glare: blown / n, luma: sum / n };
}
