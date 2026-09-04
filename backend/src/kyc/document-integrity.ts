// backend/src/kyc/document-integrity.ts
//
// THE HONEST REPLACEMENT FOR AN ARTWORK CHECK.
//
// The verdict machinery in claude-kyc.service.ts has an INTEGRITY GATE:
//
//   integrityGates = [selfie_live_capture, document.looks_genuine_sa_id]
//   if (any < 50) -> REJECTED          // and >= 70 is required to VERIFY
//
// Claude answered `looks_genuine_sa_id` by LOOKING at the card — fonts,
// layout, the coat of arms. Textract does OCR and Rekognition does faces.
// Neither can tell a real card from a good forgery, so after the cut-over
// there is nobody left to answer that question.
//
// 🚨 THE TWO OBVIOUS WAYS TO FILL THE HOLE ARE BOTH WRONG, IN OPPOSITE
// DIRECTIONS:
//
//   emit 0   -> every gate fails -> EVERY SELLER IS REJECTED.
//   emit 100 -> the gate is deleted, but the dossier still shows a
//               confident "100" next to the words "looks genuine", so it
//               reads as though something checked. Nothing did.
//
// The second is the dangerous one, because it is invisible. It is the same
// failure the Warden exists to catch: a measurement with no model behind
// it. Unknown is never zero — and it is never a hundred either.
//
// So this module answers a NARROWER question honestly instead of the
// original question dishonestly: not "is this card genuine?" but "is this
// document INTERNALLY CONSISTENT, and did the checks that can run, run?"
// It records what it checked AND what nobody checked, and that provenance
// is persisted alongside the score so an admin reading a dossier can see
// the difference between "inspected and fine" and "never inspected".
//
// ── What is actually lost, and what covers it ─────────────────────────
//
// Lost: detection of a physically forged card whose printed data is
// internally consistent. Nothing here catches that.
//
// What still covers most of the ground:
//   • The ID number must pass the Luhn check on digit 13 — a made-up
//     number fails, and that check is where a fabricated identity usually
//     dies (see textract-extract.ts).
//   • The printed date of birth must agree with the date encoded in the
//     ID number's own YYMMDD prefix — this catches the ordinary tamper,
//     where one is altered and the other is not.
//   • VerifyNow still checks the ID number against the Home Affairs name
//     and date of birth, and crossCheckIdentity compares the document to
//     that record. A forged card carrying REAL, HA-confirmed data is a
//     much smaller problem than a forged card carrying invented data.
//   • Rekognition still has to match the face.
//
// That is a genuine reduction in coverage against artwork forgery, stated
// plainly rather than papered over. It is the operator's call whether to
// buy it back with a narrow vision call; this module does not pretend the
// question was answered.

/** Above AUTO_APPROVE_FLOOR (70): the checks that CAN run, ran, and passed. */
const CONSISTENT = 75;

/**
 * Between AUTO_REJECT_CEILING (50) and AUTO_APPROVE_FLOOR (70): cannot
 * auto-reject, cannot auto-verify — a human decides.
 *
 * ⚠️ THIS BAND IS LOAD-BEARING AND MUST NOT BE "TIDIED" TO 0. A document
 * too blurry to read reaches this module with nothing to check. Scoring
 * that 0 would REJECT it on the integrity gate, which runs BEFORE the
 * legibility gate that would otherwise have asked for a retake. An honest
 * seller with a bad camera would be accused of forgery instead of being
 * asked to take another photo.
 */
const UNREADABLE = 60;

/** Same band, distinct value so the dossier can tell the two apart. */
const INCONSISTENT = 55;

export interface IntegrityAssessment {
  /** Feeds `document.looks_genuine_sa_id`. */
  score: number;
  /**
   * How the score was reached. Persisted so nobody later mistakes a
   * rule-based score for the vision judgement it replaced.
   */
  source: 'rules';
  /** Checks that actually ran and passed. */
  checked: string[];
  /** Questions NOBODY answered. The honest half of the record. */
  notChecked: string[];
  /** Human-readable reasons the score is not CONSISTENT. */
  flags: string[];
}

export interface IntegrityInput {
  /** A Luhn-valid SA ID number, or null when none could be read. */
  idNumber: string | null;
  /** Date of birth printed on the document, YYYY-MM-DD, or null. */
  printedDob: string | null;
  /** Date of birth decoded from the ID number's YYMMDD prefix, or null. */
  dobFromId: string | null;
  /** Recognised SA document layout, or null when unrecognised. */
  documentKind: 'SMART_ID_CARD' | 'GREEN_BOOK' | 'OTHER' | null;
  /** Mean Textract confidence across the read lines, 0-100. */
  legibility: number;
}

/**
 * ⚠️ NEVER RETURNS 100, AND THAT IS DELIBERATE. The ceiling is 75 because
 * the artwork was never inspected; a score that reads as certainty would
 * misrepresent what was done.
 */
export function assessDocumentIntegrity(
  input: IntegrityInput,
): IntegrityAssessment {
  const notChecked = [
    'card artwork, fonts, layout and coat of arms were not inspected — no vision model runs in this path',
    'physical security features (holograms, microprint, UV) are not visible to OCR',
  ];

  // Nothing readable: no claim either way. Legibility drives the RETAKE.
  if (!input.idNumber) {
    return {
      score: UNREADABLE,
      source: 'rules',
      checked: [],
      notChecked: [
        'no valid SA ID number could be read, so no internal consistency check was possible',
        ...notChecked,
      ],
      flags: ['no readable ID number'],
    };
  }

  const checked = [
    'ID number passes the SA check-digit (Luhn) test — a fabricated number fails this',
  ];
  const flags: string[] = [];

  // The ordinary tamper: one of the two dates altered, the other left.
  // Only meaningful when BOTH were read; a missing printed date is a
  // capture problem, not evidence.
  if (input.printedDob && input.dobFromId) {
    if (input.printedDob === input.dobFromId) {
      checked.push(
        'printed date of birth agrees with the date encoded in the ID number',
      );
    } else {
      flags.push(
        `printed date of birth (${input.printedDob}) contradicts the ID number's own date (${input.dobFromId})`,
      );
    }
  } else {
    notChecked.unshift(
      'printed date of birth could not be compared against the ID number — one of the two was not readable',
    );
  }

  if (input.documentKind === 'SMART_ID_CARD' || input.documentKind === 'GREEN_BOOK') {
    checked.push(`document matches the expected ${input.documentKind} field layout`);
  } else {
    flags.push('document does not match a recognised SA ID layout');
  }

  if (flags.length > 0) {
    return { score: INCONSISTENT, source: 'rules', checked, notChecked, flags };
  }
  return { score: CONSISTENT, source: 'rules', checked, notChecked, flags };
}
