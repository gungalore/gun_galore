import { exposureProblem } from './exposure';

// ────────────────────────────────────────────────────────────────────
// WHEN THE SCANNER MAY SHOOT BY ITSELF.
//
// ⚠️ THIS IS A RE-SPECIFICATION, NOT A REVIVAL. Automatic capture existed,
// failed in two distinct ways, and was removed in full. Both failures are
// worth carrying, because this design is shaped by them:
//
//   1. "IT NEVER CAPTURED." The old gate required the DETECTED quad to agree
//      with the aim box. But the detector frequently never sees the document
//      at all — the skipped regression in detect.spec.ts records that on a
//      real licence card "the card is never a CANDIDATE at all", the mat is.
//      So the gate waited on an agreement that could not arrive, and the
//      member watched locked green corners and a scanner doing nothing.
//
//   2. "THE IMAGES CAME OUT SKEW OR OUTSIDE THE FOCUS LINES." Back then the
//      CROP also came from the detector's quad, so when it did fire it cut
//      out whatever rectangle the detector had latched onto.
//
// The second failure is already dead: processCapture now crops EXACTLY the aim
// box ("THE BOX. EXACTLY THE BOX. NOTHING ELSE"), so a capture can only ever
// produce the rectangle the member lined the document up against. Not skewed,
// not outside the lines, by construction.
//
// The first is what this module fixes, by removing the detector from the
// decision entirely. It has no say in the crop any more, so it does not hold
// the trigger either. Instead we ask three questions about the frame itself:
//
//   IS THERE A DOCUMENT IN THE BOX?  ink, measured on the aim box.
//   CAN IT BE READ?                  exposure — the one thing no processing
//                                    recovers.
//   IS IT STILL?                     frame-to-frame motion, so the photograph
//                                    is sharp.
//
// ⚠️ THREE GATES, NOT FOUR, AND THAT IS DELIBERATE. Every additional gate is
// another way to never fire, which is the failure we are fixing. `edgeContrast`
// was the obvious fourth and was left out on purpose: it adds little that ink
// does not already say, and it would refuse a white card on a pale desk — which
// scans perfectly well.
//
// Pure, so the thresholds can be pinned by tests rather than by holding a
// phone and squinting.
// ────────────────────────────────────────────────────────────────────

/**
 * Ink floor for "there is SOMETHING in the box" — not "there is a document".
 *
 * ⚠️ READ THIS BEFORE STRENGTHENING THE CONTENT GATE. The obvious design is
 * "only fire when we can tell a document is in the box". It was attempted and
 * MEASURED against the operator's eighteen photographs
 * (`scripts/autocapture-calib.cjs`), comparing the aim box against a same-sized
 * box of bare desk in the same frame. Four independent measures were tried and
 * every one of them failed to separate the two populations:
 *
 *   ink        document 0.173–0.526, desk 0.000–0.704. Complete overlap. On
 *              IMG_4947 the patterned fabric scores 0.587 against the licence
 *              card's 0.342 — the desk is inkier than the card, because
 *              `inkiness` measures local gradient and texture looks exactly
 *              like print.
 *   ink spread document higher in 11 of 18. A coin flip.
 *   edge contrast  documents span -14.5 to +9.3. No sign, let alone a floor.
 *   mean brightness  document brighter in 16 of 18, but the ranges overlap
 *              (153–185 against 106–202) and a threshold that keeps the two
 *              exceptions out rejects five real documents.
 *
 * This is the same wall the DETECTOR hit, reached independently: see the
 * skipped regression in detect.spec.ts, "a mousepad is a PERFECT document by
 * border physics". A licence card on a patterned surface is not separable from
 * that surface by any cheap per-frame statistic. Do not spend another round on
 * it without a genuinely different signal.
 *
 * ⚠️ SO THIS FLOOR IS DELIBERATELY WEAK, AND THAT IS SAFE NOW IN A WAY IT WAS
 * NOT BEFORE. 0.10 sits below the lowest real document measured (0.173) with
 * margin, and above eight of the eighteen desk samples — so it catches a blank
 * wall, a dark room and a plain desk, and admits a patterned one. What it
 * cannot do is refuse to photograph a tablecloth.
 *
 * The cost of that is now one tap. The crop is the aim box, so a spurious
 * capture is a straight photograph of the desk — the member lands in the corner
 * editor, presses "Take it again", and the review and the classifier both catch
 * a desk photograph anyway. Before, a misfire cropped whatever rectangle the
 * detector had latched onto and came out skew. The real protection is the
 * 1100ms hold: nobody holds a phone motionless for over a second while still
 * lining a document up.
 */
export const INK_AT = 0.1;

/**
 * The lowest ink measured over the aim box across all eighteen calibration
 * photographs. INK_AT must stay comfortably below it or real documents start
 * being refused — which is the failure that got auto-capture deleted the first
 * time. Pinned by a test, because the photographs themselves are PII and can
 * never be committed to prove it.
 */
export const LOWEST_MEASURED_DOCUMENT_INK = 0.173;

/**
 * Mean frame-to-frame luma change below which the phone counts as still, on a
 * 0-255 scale. A hand at rest measures 1-3; deliberate movement is 8 and up;
 * the gap between them is wide. Carried over unchanged — this measure was the
 * one part of the old auto-capture that was demonstrably right, after being
 * moved off quad drift (which a patterned carpet could stall for ever) onto
 * the frame's own pixels.
 */
export const MOTION_STILL = 4;

/**
 * How long the phone must be still before the shutter fires.
 *
 * ⚠️ 300ms, AND THE HISTORY IS WHY THAT IS SAFE NOW WHEN 700 WAS NOT.
 *
 * It was 700, the operator called it "super sensitive" because it fired while
 * the phone was still being positioned, and it went to 1100. Then 1100 was
 * "way too long... the average user will never even bother holding it so still
 * for so long". Both verdicts were true, and neither was really about this
 * number: the MOTION READING underneath it was broken the whole time. A
 * stationary phone measured 22-31 against a limit of 4, so the clock either
 * never started or restarted constantly.
 *
 * That is also why 700 misfired back then. The gate could not tell positioning
 * from stillness, so the wait was effectively random and sometimes elapsed
 * mid-movement. With the reading honest — coarsened, and matched for gain as
 * well as offset — "still" now means still, and the hold is only there to rule
 * out the instant a hand pauses on its way somewhere. 300ms does that.
 *
 * ⚠️ IT IS THE SHORTEST THIS SHOULD GO WITHOUT NEW EVIDENCE. Below about a
 * quarter of a second the hold stops distinguishing a pause from a stop, and
 * the failure it prevents — a photograph taken while the phone is still
 * arriving — costs a retake and the member's confidence in the next one.
 */
export const HOLD_MS = 300;

/**
 * What the frame looks like right now, as far as this decision cares.
 *
 * Everything here is already computed by the scanner's detect loop, or is one
 * call to an existing pure function away.
 */
export interface FrameReading {
  /** inkiness() over the AIM BOX — not over anything the detector found. */
  ink: number;
  /** Mean frame-to-frame luma change, 0-255. */
  motion: number;
  /** Blown-out fraction of the frame, 0-1. */
  glare: number;
  /** Mean brightness, 0-255. */
  luma: number;
}

/**
 * Why the shutter has not fired yet.
 *
 * ⚠️ 'steady' IS NOT A FAULT. It means everything else is satisfied and the
 * only thing left is for the phone to stop moving — which is what the ring
 * around the shutter fills up to show. Naming it is what turns "the scanner is
 * broken" into "hold still for a second".
 */
export type AutoBlocker =
  /** The member turned it off. */
  | 'off'
  /** Nothing that looks like a document is in the box. */
  | 'empty'
  /** Glare, too bright or too dark — see exposure.ts. */
  | 'light'
  /** Everything else is fine; the phone is moving. */
  | 'steady';

/**
 * The gate that is currently shut, or null when the scanner may fire.
 *
 * Order matters: it is the order the member can act on. Point it at the
 * document, fix the light, then hold still.
 */
export function autoBlocker(on: boolean, r: FrameReading): AutoBlocker | null {
  if (!on) return 'off';
  if (r.ink < INK_AT) return 'empty';
  // ⚠️ THE SAME CALL THE ALERT ON SCREEN MAKES. Two copies of these thresholds
  // would eventually disagree, and a scanner that shows a warning and then
  // fires anyway — or shows nothing and refuses to fire — reads as broken in a
  // way nobody can describe well enough to report. torchOn only changes the
  // ADVICE, never whether there is a problem, so it is not needed here.
  if (exposureProblem(r.glare, r.luma, false) !== null) return 'light';
  if (r.motion > MOTION_STILL) return 'steady';
  return null;
}

/**
 * How far through the hold we are, 0-1, for the ring around the shutter.
 *
 * ⚠️ THE RING IS NOT DECORATION. An automatic capture that arrives with no
 * warning is a photograph the member did not agree to, and the first thing
 * they do is distrust the next one. Filling the ring means they can see it
 * coming and move if they did not mean it.
 */
export function holdProgress(heldMs: number): number {
  if (heldMs <= 0) return 0;
  return Math.min(1, heldMs / HOLD_MS);
}

/** Has the phone been still long enough to shoot? */
export function holdComplete(heldMs: number): boolean {
  return heldMs >= HOLD_MS;
}

/**
 * What to tell the member, given the gate that is shut.
 *
 * Lives here beside the decision so the words and the logic cannot drift: a
 * caption saying "hold still" while the real blocker is the light is the exact
 * failure that made the old version impossible to report on.
 */
export function autoHint(b: AutoBlocker | null, documentName: string): string {
  switch (b) {
    case 'empty':
      return `Put the ${documentName} inside the corners.`;
    case 'light':
      return 'Fix the lighting above first.';
    case 'steady':
      return 'Hold still…';
    case 'off':
      return `Put the ${documentName} inside the corners, then take the photo.`;
    default:
      return 'Got it — hold still.';
  }
}
