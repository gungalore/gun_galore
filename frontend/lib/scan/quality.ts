import { FLOOR_DPI, TARGET_DPI } from './framing';
import { SQUARE_MAX, SQUARE_MIN } from './guidance';

// ────────────────────────────────────────────────────────────────────
// ONE WORD ABOUT THE SCAN, AND THE REASON BEHIND IT.
//
// ⚠️ WE HAVE MEASURED ALL OF THIS ALL ALONG AND SHOWN NONE OF IT. dpi, tilt,
// edge margin, glare, ink — every one is computed on the capture and every one
// is buried behind a diagnostics flag. The member gets a picture and no idea
// whether it is any good, on a document they may not look at again until SAPS
// asks for it.
//
// Scanbot puts one word on the review screen with an info button beside it.
// That is the right shape: a verdict a person can act on, with the numbers
// available to anyone who wants them and invisible to everyone who does not.
//
// ⚠️ THE VERDICT MUST NEVER BE CHEERFUL ABOUT A BAD SCAN. This is a statutory
// document. "Good" has to mean good, or the badge is worse than no badge —
// somebody keeps a 140 dpi photograph of a licence because a green tick told
// them to.
// ────────────────────────────────────────────────────────────────────

export type Grade = 'good' | 'acceptable' | 'poor';

export interface QualityInput {
  /** Measured off the crop against known millimetres. Null when unknown. */
  dpi: number | null;
  /** Worst corner's deviation from square, in degrees. */
  tilt?: number;
  /** 0..1, from inspect(). Higher is worse. */
  glare?: number;
  /** Mean luma 0..255. */
  luma?: number;
  /** Was the crop the detector's, or a fallback? */
  source?: 'detected' | 'manual' | 'aim' | 'frame';
  /** Did part of the document run off the edge of the photograph? */
  clipped?: boolean;
  /** The quad's long/short before aspect correction, for the message. */
  measuredRatio?: number;
  /** What the chosen document's ratio should be. */
  expectedRatio?: number;
}

export interface Quality {
  grade: Grade;
  /** The one word, for the badge. */
  label: string;
  /** One sentence, for the info panel. Always present, always specific. */
  detail: string;
  /** Everything that pulled the grade down, worst first. */
  reasons: string[];
  /**
   * The measured resolution, ready to sit beside the label.
   *
   * ⚠️ EMPTY WHEN UNKNOWN, NEVER A ZERO OR A DASH. dpi needs known
   * millimetres; a badge reading "Good — 0 dpi" would be worse than one
   * reading "Good", because a number invites trust that a placeholder does not
   * deserve.
   */
  dpiLabel: string;
}

/** Tilt beyond which a page reads as visibly skewed, in degrees. */
export const TILT_OK = Math.max(SQUARE_MAX - 90, 90 - SQUARE_MIN);

/** Above this, a highlight has blown and cannot be recovered. */
export const GLARE_BAD = 0.02;

/**
 * Outside this band the page is too dark or too bright to read reliably.
 *
 * ⚠️ MEASURED ON RAW PHOTOGRAPHS, WHICH IS NOW THE ONLY THING GRADED. This
 * bound was briefly raised to 238 to stop it firing on every good capture —
 * the operator's competency certificate came back "Acceptable" for being
 * well lit. That was the right observation and the wrong fix: the number was
 * never the problem, the IMAGE was. inspect() was being handed enhance()'s
 * output, whose paper is deliberately lifted to WHITE=245, so no threshold
 * placed below 245 could have survived. 238 did not even work — enhanced
 * paper measures 242.
 *
 * capture.ts now inspects `flat`, the rectified page before any cleanup, and
 * against 94 real fixture photographs the original 215 is comfortably clear:
 * the highest mean luma anywhere in the set is 206.6, and 0/94 trip it. So it
 * is restored, and it means what it says again.
 */
export const LUMA_LOW = 55;
export const LUMA_HIGH = 215;

/**
 * Grade a finished capture.
 *
 * ⚠️ dpi IS THE ONLY THING THAT CAN MAKE A SCAN UNUSABLE ON ITS OWN. Tilt,
 * glare and exposure all degrade a scan that is still readable; resolution
 * below the floor means the serial numbers are gone and no amount of later
 * processing brings them back. So it is the only input that can force 'poor'
 * by itself.
 */
export function gradeScan(q: QualityInput): Quality {
  const reasons: string[] = [];
  let grade: Grade = 'good';

  const down = (to: Grade) => {
    const rank: Record<Grade, number> = { good: 2, acceptable: 1, poor: 0 };
    if (rank[to] < rank[grade]) grade = to;
  };

  if (q.dpi !== null && q.dpi !== undefined) {
    if (q.dpi < FLOOR_DPI) {
      reasons.push(
        `Only ${Math.round(q.dpi)} dpi — small print may not be readable.`,
      );
      down('poor');
    } else if (q.dpi < TARGET_DPI) {
      reasons.push(`${Math.round(q.dpi)} dpi, just under the ${TARGET_DPI} we aim for.`);
      down('acceptable');
    }
  }

  // ⚠️ CLIPPING IS A 'POOR' ON ITS OWN, AND IT IS THE ONLY OTHER ONE. Missing
  // resolution loses the small print; missing FRAME loses the part of the page
  // that ran off the picture, and no processing recovers either. Worse, the
  // aspect correction makes a clipped crop look right: forced to the
  // document's known ratio it comes out A4 to four decimals, perfectly
  // proportioned, and missing an inch of the page. The member has no way to
  // see that from a thumbnail — which is exactly why it has to be said.
  if (q.clipped) {
    const off =
      q.measuredRatio && q.expectedRatio
        ? Math.abs(q.measuredRatio - q.expectedRatio) / q.expectedRatio
        : 0;
    reasons.unshift(
      off > 0.1
        ? 'Part of the page ran off the edge — the shape is wrong for this document. Move back and take it again.'
        : 'The page is touching the edge of the picture. Move back a little so nothing is cut off.',
    );
    down('poor');
  }

  if (q.tilt !== undefined && q.tilt > TILT_OK) {
    reasons.push(`Held at ${q.tilt.toFixed(1)}° off square.`);
    down('acceptable');
  }

  if (q.glare !== undefined && q.glare > GLARE_BAD) {
    reasons.push('There is a glare on it — part of the page has blown out.');
    down('acceptable');
  }

  if (q.luma !== undefined) {
    if (q.luma < LUMA_LOW) {
      reasons.push('It came out dark.');
      down('acceptable');
    } else if (q.luma > LUMA_HIGH) {
      reasons.push('It came out very bright.');
      down('acceptable');
    }
  }

  // ⚠️ A FALLBACK CROP IS NOT A FAILURE, AND MUST NOT READ AS ONE. 'aim' and
  // 'frame' mean the detector declined and the member's own box was used —
  // which is often exactly right. It is worth SAYING, because it is the case
  // where checking the corners is most worth a moment, but it does not lower
  // the grade on its own.
  if (q.source === 'aim' || q.source === 'frame') {
    reasons.push('We used your frame rather than finding the edges.');
  }

  const label =
    grade === 'good' ? 'Good' : grade === 'acceptable' ? 'Acceptable' : 'Poor';

  const detail =
    reasons.length === 0
      ? q.dpi
        ? `Sharp and square at ${Math.round(q.dpi)} dpi. Nothing to fix.`
        : 'Sharp and square. Nothing to fix.'
      : reasons[0];

  return {
    grade,
    label,
    detail,
    reasons,
    dpiLabel:
      q.dpi !== null && q.dpi !== undefined && Number.isFinite(q.dpi)
        ? ` — ${Math.round(q.dpi)} dpi`
        : '',
  };
}
