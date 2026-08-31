import type { DocShape } from './shapes';
import { acrossMm } from './shapes';

// ────────────────────────────────────────────────────────────────────
// Framing — how big the aim box has to be, given what the camera
// actually delivers.
//
// ⚠️ THE AIM BOX WAS A CONSTANT AND IT SHOULD NEVER HAVE BEEN. aim.ts picks
// FILL = 0.82 of the frame's short axis for every device, which silently
// fixes the working distance: a bigger box means the member holds the phone
// closer to fill it. Operator, on a Samsung S23: "seems like I have to hold
// the phone to close for it to be able to focus" — the box was asking for a
// distance nearer than the lens can focus, and no amount of focus coaxing
// fixes a geometric demand.
//
// So the box is derived, not chosen. Two facts decide it:
//
//   1. What resolution the track ACTUALLY gives us. We ask for 3840x2160
//      `ideal` and have never once read back what we got — getSettings()
//      appears nowhere in the codebase. A phone serving 1080p and a phone
//      serving 4K need very different boxes and got the same one.
//   2. How many pixels per millimetre the document needs to be legible.
//
// ⚠️ THE FAILURE IS ASYMMETRIC, and that is what makes this tractable
// without a focus API (iOS Safari has none, and most Androids ignore
// focusMode). Too CLOSE is a hard fail — blurred, unreadable, and the member
// cannot tell until afterwards. Too FAR is a soft, linear loss of pixels. So
// the rule is: pick the SMALLEST box that still meets the resolution target,
// which stands the member as far back as their camera allows and biases away
// from the blur cliff every time.
// ────────────────────────────────────────────────────────────────────

/**
 * What a scan of a document is supposed to be worth reading at.
 *
 * ⚠️ 200, LOWERED FROM 300 ON 2026-08-31, AND THE TWO NUMBERS NOW MEET. 300
 * is the ordinary document-scanning standard, but standing a member far
 * enough back to be safe from the frame-edge cliff and close enough for 300
 * dpi on an A4 are contradictory demands — see TOO_SMALL in guidance.ts for
 * the arithmetic. One of them had to give and it was never going to be the
 * cliff, which is measured and absolute.
 *
 * Operator: "we set the quality floor at 200dpi". With TARGET and FLOOR
 * equal there is no slack band left, so `shortfall` now reports zero or a
 * real deficit and nothing in between — which is the honest shape for a
 * single bar.
 */
export const TARGET_DPI = 200;

/**
 * Below this, small print stops being reliable.
 *
 * A firearm licence carries serial numbers, calibres and dates in type far
 * smaller than its headings, and those are the fields that matter to SAPS.
 * 200 dpi is the point at which they are still readable; under it we are
 * handing somebody a picture of a document rather than a copy of one.
 */
export const FLOOR_DPI = 200;

/**
 * The closest a phone's main camera will focus, near enough.
 *
 * shapes.ts already carries this number in prose — "no phone focuses below
 * roughly 100 mm" — and clamps its hold hint to it. It is the same limit and
 * it is named once here so the two cannot drift apart. Devices with a macro
 * lens do better; nothing sensible does worse.
 */
export const MIN_FOCUS_MM = 100;

/**
 * How much of the box the document should leave as margin.
 *
 * ⚠️ THIS IS A CLIFF, NOT A PREFERENCE — MEASURED, 2026-08-31. The rationale
 * here used to be inferred from watching Adobe Scan refuse edge-touching
 * documents. It has now been measured on the fifteen fixture photographs by
 * sweeping the document's margin from the frame edge and scoring the
 * detector's quad against hand-verified ground truth:
 *
 *     document flush to the frame edge   0/15 usable, median IoU 0.209
 *     one step off the edge             11/15 usable, median IoU 0.959
 *     a comfortable margin              13/15 usable, median IoU 0.942
 *
 * Zero to eleven, on one step. There is no gentle degradation to tune
 * against: a document touching the frame edge is not detected at all, and a
 * document anywhere else is. Everything this constant does is keep us off
 * that edge.
 *
 * Ten per cent permits the document to reach 90% of the box, which measures
 * safely past the knee. The band the detector actually prefers is 13-23% of
 * frame AREA, and every device case framingPlan reaches lands at 8-21% — so
 * the resolution arithmetic below and the detector's preference agree, and
 * neither needs to override the other.
 */
export const AIM_MARGIN = 0.1;

/** What the camera track is really giving us, once asked. */
export interface StreamSize {
  /** Frame dimensions in pixels, as delivered — NOT as requested. */
  width: number;
  height: number;
}

/** The short axis is the one a document is framed against. See acrossMm. */
export function shortAxisPx(s: StreamSize): number {
  return Math.min(s.width, s.height);
}

/**
 * Dots per inch of a document spanning `px` pixels across `mm` millimetres.
 *
 * ⚠️ PREFER THIS OVER PREDICTING FROM DISTANCE. Everything else in this file
 * reasons forward from an assumed field of view to work out how big the box
 * ought to be, which is necessary before there is anything to measure. But
 * once the detector has a quad, its long edge in pixels against the
 * document's known millimetres is the REAL resolution, on the real lens, at
 * the real distance — no focal-length assumption in it at all. When a quad is
 * available, this is the number the shutter should read.
 */
export function dpiOf(px: number, mm: number): number {
  if (mm <= 0) return 0;
  return (px / mm) * 25.4;
}

/**
 * The fraction of the frame's short axis a document must span to reach `dpi`.
 *
 * Inverse of dpiOf, expressed as a fill fraction — this is what sizes the box.
 */
export function fillForDpi(dpi: number, mm: number, shortPx: number): number {
  if (shortPx <= 0) return 1;
  return (dpi / 25.4) * mm / shortPx;
}

/**
 * Roughly how far the phone ends up from the document at a given fill.
 *
 * Uses FULL_FRAME_DISTANCE_RATIO from shapes.ts, which was derived from a
 * real measurement (the operator's card at 158 mm filling ~15% of frame area)
 * rather than a datasheet. It is approximate and it only has to be good
 * enough to answer one question: is this nearer than the lens can focus.
 */
export function distanceMmFor(fill: number, mm: number): number {
  if (fill <= 0) return Infinity;
  // At fill = 1 the document spans the whole short axis, which the measured
  // ratio puts at 1.85x its own width.
  return (mm / fill) * 1.85;
}

/** What the framing arithmetic concluded, in order of how good the news is. */
export type FramingVerdict =
  /** 300 dpi at a distance the camera can focus. */
  | 'good'
  /** Only the 200 dpi floor is reachable. Usable, worth saying nothing about. */
  | 'relaxed'
  /**
   * Not even the floor without holding the phone nearer than it focuses.
   *
   * ⚠️ THIS MUST NOT BE SWALLOWED. On a device whose stream caps low there is
   * no box size that works, and drawing one anyway hands somebody an
   * unreadable photograph of a statutory document and calls it a scan. The
   * member gets told to use their normal camera app instead.
   */
  | 'impossible';

export interface FramingPlan {
  /** Fraction of the frame's short axis the AIM BOX should span. */
  fill: number;
  /** The dpi this plan is aiming at, once the document fills the box. */
  dpi: number;
  /** Approximate working distance in mm, for the hold hint. */
  distanceMm: number;
  verdict: FramingVerdict;
}

/**
 * Size the aim box for this camera and this document.
 *
 * Tries TARGET_DPI first, falls back to FLOOR_DPI, and refuses rather than
 * drawing a box that would demand an unfocusable distance.
 *
 * A shape with no known size ('any') cannot be reasoned about — there is no
 * millimetre figure to convert pixels against — so it keeps the old constant
 * box and reports 'relaxed', which is honest: we do not know what it will be
 * worth.
 */
export function framingPlan(
  stream: StreamSize,
  shape: DocShape,
  fallbackFill: number,
): FramingPlan {
  const mm = acrossMm(shape);
  const shortPx = shortAxisPx(stream);
  if (mm === null || shortPx <= 0) {
    return {
      fill: fallbackFill,
      dpi: 0,
      distanceMm: distanceMmFor(fallbackFill, mm ?? 0),
      verdict: 'relaxed',
    };
  }

  for (const [dpi, verdict] of [
    [TARGET_DPI, 'good'],
    [FLOOR_DPI, 'relaxed'],
  ] as const) {
    // The document has to fit inside the box with margin, so the BOX is
    // larger than the document's own fill by exactly that margin.
    const docFill = fillForDpi(dpi, mm, shortPx);
    const boxFill = docFill / (1 - AIM_MARGIN);
    // ⚠️ LOAD-BEARING FOR THE DETECTOR, NOT TIDINESS. This read "a box bigger
    // than the frame is not a box", which is true and is not why it matters.
    // It is the only thing standing between us and the cliff documented on
    // AIM_MARGIN: at 1080p a card needs 94% of the short axis to reach 300 dpi,
    // which would sit the document all but flush to the frame edge — the
    // 0/15 case. Rejecting the box here is what forces the fall through to the
    // 200 dpi floor, whose box measures on the safe side of the knee.
    // Do not relax this to "clamp to 1" and keep the higher dpi. That trades a
    // legible target for a detector that finds nothing at all.
    if (boxFill > 1) continue;
    const distanceMm = distanceMmFor(docFill, mm);
    if (distanceMm < MIN_FOCUS_MM) continue;
    return { fill: boxFill, dpi, distanceMm, verdict };
  }

  // Nothing worked: the stream is too small to render this document legibly
  // at any distance this camera can focus at.
  const docFill = fillForDpi(FLOOR_DPI, mm, shortPx);
  return {
    fill: Math.min(1, docFill / (1 - AIM_MARGIN)),
    dpi: dpiOf(shortPx, mm),
    distanceMm: distanceMmFor(docFill, mm),
    verdict: 'impossible',
  };
}

/**
 * What to tell the member, given the plan.
 *
 * Returns null when there is nothing worth saying — 'relaxed' is a perfectly
 * good scan and narrating it would be noise.
 */
export function framingHint(plan: FramingPlan): string | null {
  if (plan.verdict !== 'impossible') return null;
  return 'This camera cannot capture fine print clearly in the browser. Take the photo with your normal camera app instead, then upload it.';
}

// ────────────────────────────────────────────────────────────────────
// What the camera actually gave us
//
// ⚠️ WE HAVE NEVER ONCE LOOKED. The camera effect asks for
// `width: { ideal: 3840 }, height: { ideal: 2160 }` with a comment saying
// modern phones will serve 4K if asked — and then never reads back what
// arrived. getSettings() appears nowhere in the codebase. Every framing
// decision above depends on that number, and it has been an assumption.
//
// It matters more than it sounds. An A4 page is 210mm across against a
// card's 85.6mm, so it needs 2.45x the pixels for the same legibility: at
// 1080p a page reaches about 131 dpi, which is a photograph of a document
// rather than a copy of one. Card at 1080p is fine. So the same phone can be
// perfectly good for licence cards and unusable for certificates, and until
// this is read we cannot tell which.
// ────────────────────────────────────────────────────────────────────

export interface CameraFacts {
  /** What we asked the browser for. */
  requested: StreamSize;
  /** What the track reports it is actually producing. */
  delivered: StreamSize | null;
  /** Frames per second, as reported. */
  frameRate: number | null;
  /**
   * The largest the DEVICE says it could do.
   *
   * The difference between this and `delivered` is the whole diagnosis: a
   * phone capped at 1080p by its own hardware is a different problem from a
   * browser that refused a 4K request the hardware could have met.
   */
  capable: StreamSize | null;
  /** Whether the track honoured focusMode, so far as it will admit. */
  focusModes: string[];
}

/**
 * Read the facts off a live track. Every call is optional-chained: these APIs
 * are patchily implemented and a scanner that throws because a phone lacks
 * getCapabilities is worse than one that reports less.
 */
export function readCameraFacts(
  track: MediaStreamTrack | null | undefined,
  requested: StreamSize,
): CameraFacts {
  const blank: CameraFacts = {
    requested,
    delivered: null,
    frameRate: null,
    capable: null,
    focusModes: [],
  };
  if (!track) return blank;
  let settings: MediaTrackSettings | undefined;
  let caps: (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
  try {
    settings = track.getSettings?.();
  } catch {
    settings = undefined;
  }
  try {
    caps = track.getCapabilities?.() as typeof caps;
  } catch {
    caps = undefined;
  }
  return {
    requested,
    delivered:
      settings?.width && settings?.height
        ? { width: settings.width, height: settings.height }
        : null,
    frameRate: typeof settings?.frameRate === 'number' ? settings.frameRate : null,
    capable:
      caps?.width?.max && caps?.height?.max
        ? { width: caps.width.max, height: caps.height.max }
        : null,
    focusModes: Array.isArray(caps?.focusMode) ? caps.focusMode : [],
  };
}

/**
 * One line saying whether the stream is as good as this device can manage.
 *
 * Returns null when there is nothing to report — either we could not read the
 * capabilities, or we already have everything the device offers.
 */
export function shortfall(f: CameraFacts): string | null {
  if (!f.delivered || !f.capable) return null;
  const got = shortAxisPx(f.delivered);
  const could = shortAxisPx(f.capable);
  if (could <= got) return null;
  return `device can do ${f.capable.width}x${f.capable.height} — browser gave ${f.delivered.width}x${f.delivered.height}`;
}
