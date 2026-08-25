// ────────────────────────────────────────────────────────────────────
// THE THREE THINGS NO ALGORITHM FIXES AFTERWARDS.
//
// Glare, blown-out bright, and too dark. Every other complaint about a scan —
// skew, shadow, a grey background, a soft crop — is something the warp and the
// enhancement handle. These three are lost information: a saturated highlight
// has no detail under it to recover, and a frame with no light in it never had
// the detail in the first place.
//
// So they are the only conditions worth interrupting somebody for, and when
// one is present the interruption STAYS UP until the number comes back. Not a
// toast, not a three-second flash: a member who has just been told about glare
// is a member who is about to move the phone, and a message that has faded by
// then leaves them moving it without knowing whether it helped. Clearing
// itself is the only honest signal that it worked.
//
// Pure, so the thresholds and the order of precedence can be pinned by tests
// rather than by squinting at a phone in a dark room.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THESE ARE DELIBERATELY WIDE. A licence card on a dark desk sits well
 * below mid-grey and scans perfectly; an alert that fired there is an alert
 * the member learns to dismiss, and then it is worth nothing on the frame
 * that really is unusable. These catch "I am in a dark room" and "I am
 * pointing at a window", not "this could be a stop better".
 */
export const DARK_AT = 55;
export const BRIGHT_AT = 215;
/** Fraction of the frame at 251+ above which the glare warning holds. */
export const GLARE_AT = 0.02;

export interface ExposureProblem {
  key: 'glare' | 'bright' | 'dark';
  head: string;
  body: string;
}

/**
 * What to say about the current frame, or null when there is nothing to say.
 *
 * @param glare   fraction of the frame that is blown out, 0-1
 * @param luma    mean brightness, 0-255
 * @param torchOn whether our own light is on — it changes the advice, and
 *                getting that backwards sends people the wrong way
 */
export function exposureProblem(
  glare: number,
  luma: number,
  torchOn: boolean,
): ExposureProblem | null {
  // ⚠️ GLARE OUTRANKS EVERYTHING. A torch on a laminated licence card blows a
  // patch out while leaving the mean perfectly respectable, so a check that
  // led with brightness would stay silent on the single most common failure
  // this scanner has. It is also the one with the easiest fix.
  if (glare > GLARE_AT) {
    return {
      key: 'glare',
      head: 'Glare on the document',
      body: torchOn
        ? 'Turn the light off, or tilt the phone until the bright patch is gone.'
        : 'Tilt the phone, or move out from under the light.',
    };
  }
  if (luma > BRIGHT_AT) {
    return {
      key: 'bright',
      head: 'Too bright',
      body: 'Move away from the window or the lamp behind you.',
    };
  }
  if (luma < DARK_AT) {
    return {
      key: 'dark',
      head: 'Too dark',
      body: torchOn
        ? // Telling somebody to turn on a light that is already on is how a
          // warning stops being believed.
          'Move somewhere lighter — there is not enough light to read it.'
        : 'Turn the light on, or move somewhere brighter.',
    };
  }
  return null;
}

// ⚠️ `exposureAllowsAutoCapture` LIVED HERE AND IS GONE.
//
// It answered "may the scanner fire by itself on this frame?", and it existed
// in this file rather than in the component so that the WARNING and the GATE
// could never drift apart — a scanner that warns and then shoots anyway reads
// as broken in a way nobody can describe well enough to report.
//
// There is no automatic capture any more (operator, on the rebuild: manual
// only), so there is no gate, and a lone exported predicate with tests and no
// callers is just something for the next person to wire up by mistake.
//
// `exposureProblem` above is unchanged and still does both remaining jobs: it
// is what the held alert renders, and what the viewfinder hint reads so the
// two can never contradict each other.
