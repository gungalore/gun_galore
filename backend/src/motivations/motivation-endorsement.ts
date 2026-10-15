// ────────────────────────────────────────────────────────────────────
// DOES AN ENDORSEMENT NAME THE FIREARM THIS APPLICATION IS FOR?
//
// Operator, 2026-10-15: "It must be matched to the firearm that is applied
// for. We can recognize it because it will say endorsement somewhere in the
// document. And it will also specify the firearm. Endorsements from different
// entities do not look the same, so we need to generically match them."
//
// ⚠️ GENERIC, NOT PER-ENTITY. An endorsement from SA Hunters, NHSA, SAPSA or a
// club prints the firearm in its own layout — a bordered table, a labelled
// line, prose — so the reader (readFirearm) lifts type, calibre, make, action
// and serial from all of them, and THIS file compares those fields to the
// applied-for firearm. No part of the matching depends on a letterhead, a form
// number or a fixed column order.
//
// ⚠️ SERIAL FIRST, AND IT DECIDES ON ITS OWN. A serial is the number a DFO
// matches a firearm by, and two different firearms of the same make and
// calibre are the norm. Where both sides carry one, equality is the whole
// answer — a same-serial endorsement is accepted even if the type is worded
// differently, and a different serial is refused even if everything else
// agrees.
//
// ⚠️ THE TYPE/CALIBRE FALLBACK ONLY REFUSES ON A CLEAR DISAGREEMENT. Where a
// serial is missing on either side we can still catch an obvious wrong
// firearm (a shotgun endorsement for a handgun application) but we do NOT
// demand a match we cannot make — an unclear comparison returns 'unverified',
// never a false 'mismatch'. A wrong refusal sends an applicant back to their
// association for a letter they already have; a wrong acceptance puts a
// different rifle's endorsement in front of a DFO.
// ────────────────────────────────────────────────────────────────────

/** What the comparison concluded. */
export type EndorsementVerdict =
  /** The endorsement names this firearm. */
  | 'match'
  /** The endorsement plainly names a DIFFERENT firearm. */
  | 'mismatch'
  /** Too little on one side to tell — accept it, but on trust, not proof. */
  | 'unverified';

/**
 * The sentinel written into a MotivationUpload's `extractedFields` when an
 * endorsement named a DIFFERENT firearm.
 *
 * ⚠️ NO SCHEMA CHANGE — the same trick SAPS_271_MARKER uses. The row carries
 * this string so the card can STILL say why it was not filed as the
 * applicant's endorsement after a reload; the alternative was a migration for
 * one sentence, or a reason the member only saw once.
 */
export const ENDORSEMENT_FIREARM_MISMATCH = 'ENDORSEMENT_FIREARM_MISMATCH';

/** The line the card shows for a demoted endorsement. */
export const ENDORSEMENT_MISMATCH_CAUTION = {
  tone: 'amber' as const,
  text:
    "We read a different firearm's serial on this document, so it was not " +
    'filed as your endorsement. Re-file it if that is wrong.',
};

/** Letters and digits only, upper-cased — serials are printed with spaces, / and -. */
function normSerial(value?: string): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Letters and digits only, lower-cased. */
function norm(value?: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The one of handgun / rifle / shotgun a free-text type or action names. */
function canonicalType(value?: string): 'handgun' | 'rifle' | 'shotgun' | null {
  const t = norm(value);
  if (!t) return null;
  if (/shotgun|gauge/.test(t)) return 'shotgun';
  if (/handgun|pistol|revolver/.test(t)) return 'handgun';
  if (/rifle|carbine|bolt|lever/.test(t)) return 'rifle';
  return null;
}

/**
 * Are two calibre strings the same round?
 *
 * ⚠️ CONTAINMENT, NOT EQUALITY. "9 mm Parabellum" (an endorsement) and
 * "9mm Parabellum (9x19mm)" (the applicant's own answer) are the same round
 * written by two parties, and either may carry a parenthetical the other does
 * not. normalize away the punctuation and accept one holding the other.
 * null means one side said nothing — not a disagreement.
 */
function calibreAgrees(a?: string, b?: string): boolean | null {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return null;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  // ⚠️ THE LEADING NUMBER IS THE ROUND. "9 mm Parabellum" and "9x19mm" are the
  // same round and must not read as a disagreement; "9mm" and "308" are not.
  // Differing lead numbers is the only edit that refuses on calibre alone.
  const nx = /^(\d+)/.exec(x)?.[1];
  const ny = /^(\d+)/.exec(y)?.[1];
  if (nx && ny && nx !== ny) return false;
  // Same-or-unknown: not a disagreement, but not proof either.
  return null;
}

/**
 * Compare a read endorsement against the applied-for firearm.
 *
 * `endorsed` is readFirearm()'s output; `applied` is the application's
 * firearm_* answers. Both are loose Records because that is what a reader and
 * an answer map are.
 */
export function endorsementVerdict(
  endorsed: Record<string, string>,
  applied: Record<string, string>,
): EndorsementVerdict {
  const endorsedSerial = normSerial(endorsed.firearm_serial);
  const appliedSerial = normSerial(applied.firearm_serial);
  if (endorsedSerial && appliedSerial) {
    return endorsedSerial === appliedSerial ? 'match' : 'mismatch';
  }

  const endorsedType =
    canonicalType(endorsed.firearm_type) ?? canonicalType(endorsed.firearm_action);
  const appliedType =
    canonicalType(applied.firearm_type) ?? canonicalType(applied.firearm_action);

  // A type on both sides that plainly differs is a different firearm.
  if (endorsedType && appliedType && endorsedType !== appliedType) {
    return 'mismatch';
  }

  // Same class (or one side unstated): let the calibre break it.
  const calibre = calibreAgrees(
    endorsed.firearm_calibre,
    applied.firearm_calibre,
  );
  if (calibre === false) return 'mismatch';

  // Serial on neither side, and enough agreement to accept the paper.
  if (endorsedType && appliedType && calibre === true) return 'match';

  // Too little to compare — the 2a case: an application whose firearm is not
  // yet described. Keep the endorsement; the match is made once it is.
  return 'unverified';
}
