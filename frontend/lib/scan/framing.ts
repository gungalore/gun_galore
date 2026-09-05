import type { DocShape } from './shapes';
import { TOO_SMALL } from './guidance';
import { SHAPES, acrossMm, guideAspect } from './shapes';

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

/**
 * The smallest fill at which the DETECTOR can still find the document.
 *
 * ⚠️ RESOLUTION IS NOT THE ONLY CONSTRAINT, AND FOR A SMALL DOCUMENT IT IS NOT
 * THE BINDING ONE. distanceMmFor reduces to shortPx * 25.4 / dpi * 1.85 —
 * independent of the document's size — so "stand where 200 dpi happens" gives
 * the same 71 cm for an A4 and for an ID book. At 71 cm an A4 covers a third
 * of the frame and an ID book covers five per cent, and five per cent is well
 * under the detector's floor. The operator got told to hold a passport-sized
 * booklet at arm's length and the box then refused to fire because it could
 * not see it.
 *
 * So the box must satisfy BOTH: enough pixels to read, and enough frame to be
 * found. This converts guidance.ts's TOO_SMALL — which is an AREA fraction —
 * into the short-axis fill that produces it, for this document's aspect in
 * this frame's aspect. The two constants have to agree or the member is given
 * contradictory instructions by two parts of the same screen.
 */
export function fillForDetection(
  shape: DocShape,
  stream: { width: number; height: number },
): number {
  const a = guideAspect(shape);
  if (!a) return 0;
  const shortPx = Math.min(stream.width, stream.height);
  const longPx = Math.max(stream.width, stream.height);
  if (!(shortPx > 0) || !(longPx > 0)) return 0;
  // A document spanning fill f of the short axis covers
  //   area = f^2 * shortPx / (aspect * longPx)
  // of the frame, where aspect is the document's own width-over-height.
  const k = shortPx / (a * longPx);
  if (!(k > 0)) return 0;
  return Math.min(1, Math.sqrt(TOO_SMALL / k));
}

/**
 * The longest edge we will decode a photograph to, in pixels.
 *
 * ⚠️ THIS BINDS ON EVERY MODERN PHONE AND NOTHING SAID SO. It exists to stop a
 * 108MP camera OOM-ing the tab, which is real — but a 12MP phone streaming
 * 3024x4032 already exceeds it, so an ordinary capture is scaled by 0.744
 * BEFORE the quad is refined, the ratio measured, or any dpi computed. A
 * quarter of the linear resolution, spent silently, upstream of every
 * measurement that then gets reported as if it were what the camera gave us.
 *
 * It is named and exported so the diagnostic report can print it beside
 * `sourceEdge`, where a value sitting exactly on the cap is visible as a cap
 * rather than looking like a measurement. That is the same mistake the output
 * cap made twice — 171 dpi, then 230 — and it is only ever caught by showing
 * the ceiling next to the number.
 */
export const DECODE_MAX_EDGE = 4096;

/**
 * The longest edge a saved page may have, in pixels.
 *
 * ⚠️ IT IS THE DECODE CAP, AND TYING THEM TOGETHER IS THE POINT. This has now
 * pinned the A4 dpi to a constant twice — 171 under a hard-coded 2000, then
 * 230 under a value derived from TARGET_DPI — and both times the tell was the
 * same: two different phones reporting the identical number. A figure that
 * does not move between cameras was never a measurement.
 *
 * Deriving it from TARGET_DPI did not fix that, it only moved it, and for a
 * reason worth naming: the cap was computed from the LARGEST shape we accept,
 * which is the A4 — so for the A4 and nothing else it landed by construction a
 * fixed 15% above the target and never budged. Card cleared it by 4x and the
 * ID book by 3x, so neither ever showed a constant. The page always did.
 *
 * The real fault was two caps in series with different bases. decode() already
 * limits the SOURCE photograph to DECODE_MAX_EDGE, and outputSize() never
 * upsamples — it takes the quad's measured edges and only ever clamps down. So
 * a crop can never carry more than DECODE_MAX_EDGE pixels on its long edge,
 * and any output cap BELOW that throws away detail the decode stage was
 * careful to keep. One ceiling, enforced where the pixels enter, is enough.
 *
 * Setting them equal means this constant stops binding on its own: the saved
 * resolution goes back to being a property of the camera and the framing, and
 * an A4 tops out near 257 dpi only when the page fills the entire frame.
 *
 * ⚠️ AND THE MEMORY BUDGET THIS USED TO CITE WAS WRONG. The old note here
 * blamed "several Float32 planes for the illumination field, CLAHE and the
 * unsharp mask" — but enhance() never calls illuminationField(); it is dead
 * code reachable only from its own test. The measured figure is 7 full-
 * resolution planes per page, down from 8 since the unsharp blur started
 * borrowing a buffer the pipeline had already finished with and `out` stopped
 * being allocated before the stages that never touch it. That saved plane is
 * what pays for the extra resolution here, and enhance()'s output is
 * byte-identical across the change.
 *
 * ⚠️ 3600, BELOW THE DECODE CAP AGAIN, AND THIS TIME ON PURPOSE (2026-09-05).
 * The stills path (capture.ts takeStill) hands Android Chrome the sensor's
 * full photograph — 8000px across on a 50MP phone — so the decode cap rose to
 * 4096 to keep that detail through refinement. The OUTPUT is where the
 * memory goes: enhance() holds ~7 Float32 planes of the rectified page, and
 * at 4096 on the long edge an A4 is 12M pixels, 330MB of planes, which is
 * past what an older iPhone's tab survives. 3600 is 9M pixels and 255MB,
 * and puts an A4 at 308 dpi — the print standard — when the page fills the
 * frame. iOS never reaches this cap at all: it has no stills API, its visible
 * portrait crop of the 4032x3024 track is 1698x3024, and outputSize never
 * upsamples. So the two caps differ only where the extra pixels exist.
 */
export const OUTPUT_MAX_EDGE = 3600;

/**
 * The best dpi this shape can ever be SAVED at, whatever the camera manages.
 *
 * ⚠️ A CEILING THAT SHOULD NO LONGER BIND, AND THE READOUT SAYS SO WHEN IT
 * DOES. Now that the output cap is the decode cap, a crop cannot exceed it
 * without the source having exceeded it first — so this is the resolution a
 * page would reach only by filling the entire frame:
 *
 *     card      3000px over  85.6mm   890 dpi
 *     a4        3000px over   297mm   257 dpi
 *     id-book   3000px over   109mm   699 dpi
 *
 * It is reported beside the live measurement precisely so that a number
 * sitting exactly on it is legible AS a ceiling. Both times this pinned the
 * A4 — at 171, then at 230 — it was only caught because the operator noticed
 * two different phones agreeing to the digit.
 */
export function capDpiFor(shape: DocShape): number | null {
  const longMm = SHAPES[shape].longMm;
  if (!longMm) return null;
  return dpiOf(OUTPUT_MAX_EDGE, longMm);
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
 * A shape with no known size cannot be reasoned about — there is no
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
    // ⚠️ THE LARGER OF THE TWO DEMANDS, NEVER JUST THE RESOLUTION ONE. Enough
    // pixels to READ and enough frame to be FOUND are separate requirements,
    // and for a small document the second one binds. Taking the resolution
    // fill alone is what put an ID book at 5% of frame and 71cm away, where
    // the detector's own floor is 15%.
    const docFill = Math.max(
      fillForDpi(dpi, mm, shortPx),
      fillForDetection(shape, stream),
    );
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
    // ⚠️ REPORT WHAT THE BOX ACHIEVES, NOT WHAT IT WAS AIMING FOR. Once the
    // detection floor can raise docFill above the resolution demand, the two
    // diverge — a card sized to be findable reaches ~500 dpi while the loop
    // was only asking for 200. Reporting the target would put "200dpi" in the
    // readout beside a box that delivers two and a half times that, and the
    // dpi line is the number used to judge whether a scan is worth keeping.
    const achieved = dpiOf(docFill * shortPx, mm);
    return { fill: boxFill, dpi: Math.round(achieved), distanceMm, verdict };
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
