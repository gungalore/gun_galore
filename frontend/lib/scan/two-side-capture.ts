// ────────────────────────────────────────────────────────────────────
// THE FRONT-THEN-BACK TRANSITION, ON ITS OWN.
//
// This is the exact decision that broke the seller-consent licence capture on
// 2026-08-24: after the FRONT was taken the whole capture closed and the back
// was never offered. The cause was in the wrapper, but the shape of the bug is
// a state transition — "which side next, and do we keep the surface open" —
// and a transition with a subtle rule (keep open between sides, close only
// after the pair) is worth having somewhere a test can reach without a camera,
// a DOM, or a real phone. That is this file.
//
// ⚠️ THE SCANNER COUPLES "SHOT TAKEN" TO "CLOSE". DocumentScanner.finish()
// calls onClose() and THEN onDone(), synchronously. For its single-shot
// callers those are the same moment. For a two-sided capture they are not: the
// front finishing must NOT close the surface, or the back is unreachable. So
// every step says whether the surface should stay open, and the wrapper vetoes
// the scanner's close accordingly.
// ────────────────────────────────────────────────────────────────────

export type CardSide = 'front' | 'back';

export interface CaptureStep {
  /** The side to show after this one. */
  next: CardSide;
  /**
   * Keep the capture surface open — i.e. the wrapper must NOT let the
   * scanner's close reach the parent. True between the two sides; false only
   * once the pair is complete and the parent is meant to close.
   */
  keepOpen: boolean;
  /** Both sides are now in hand. */
  complete: boolean;
}

/**
 * Decide what happens when a side has just been captured.
 *
 * @param side        the side that was just taken
 * @param frontExists whether a front image is already held (it always should
 *                    be by the time the back is taken; a remount could lose it)
 */
export function advanceCapture(side: CardSide, frontExists: boolean): CaptureStep {
  // The front is done: move to the back, and above all KEEP THE SURFACE OPEN.
  // This is the line whose absence closed everything after the front.
  if (side === 'front') {
    return { next: 'back', keepOpen: true, complete: false };
  }

  // The back is done but somehow no front is held — only possible after a
  // remount. Restart at the front rather than hand up half a pair; keep open.
  if (!frontExists) {
    return { next: 'front', keepOpen: true, complete: false };
  }

  // Both sides in hand: the pair is complete and the surface may close.
  return { next: 'back', keepOpen: false, complete: true };
}
