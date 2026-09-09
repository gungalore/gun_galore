import type { CredentialKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// DID THE SCAN GET EVERYTHING THE DOCUMENT PRINTS?
//
// Operator, 2026-09-09: "If not all fields came through in a scan the scan
// must be rejected with the reason why everywhere on this website", and: "givn
// an optio to manually type the mssing field".
//
// ⚠️ THE TWO HALVES ARE ONE RULE AND MUST SHIP TOGETHER. A document refused
// with no way to correct it is worse than one filed with a gap — it is the
// same fault as the SMS that promised a retry the product refused. The reason
// goes into `readNotes`, which the card and the review screen already render;
// the correction goes through PATCH :id/details.
//
// ⚠️ AND THE LIST IS DELIBERATELY SHORT. A field is on it only where the
// document ALWAYS prints something — otherwise a valid paper is refused for a
// row that was never on it, which is a worse failure than the one this fixes.
// Today that is the firearm licence card and nothing else, because the
// operator has stated the invariant for it and only for it:
//
//   "the license card will always have either a serial or say NONE for all
//    fields. It will never ever have an emty field."
//
// So on a licence card an empty field is never the card being silent. It is
// OUR read losing a word the card definitely had — which is exactly what
// happened to the operator's Marlin, whose barrel row reads NONE and arrived
// as nothing, and to four firearms that never reached the form at all.
//
// ⚠️ EVERY OTHER KIND IS ABSENT ON PURPOSE, NOT BY OVERSIGHT. A proficiency
// carries a certificate number OR an SCV number OR an authentication code, not
// all three; an association certificate may print no dedicated-since date; a
// proof of address need not carry a postal code. Adding those here without the
// operator naming which rows are guaranteed would reject real paperwork.
// ────────────────────────────────────────────────────────────────────

/**
 * Fields a document of this kind always prints, in the order a member reads
 * them off the page.
 */
export const MUST_READ: Partial<Record<CredentialKind, readonly string[]>> = {
  FIREARM_LICENCE: [
    'licence_number',
    'holder_name',
    'firearm_type',
    'make',
    'model',
    'calibre',
    'barrel_serial',
    'frame_serial',
    'receiver_serial',
    'section',
  ],
};

/** What a member calls each one. */
const LABEL: Record<string, string> = {
  licence_number: 'the licence number',
  holder_name: 'the name on the card',
  firearm_type: 'the type',
  make: 'the make',
  model: 'the model',
  calibre: 'the calibre',
  barrel_serial: 'the barrel serial number',
  frame_serial: 'the frame serial number',
  receiver_serial: 'the receiver serial number',
  section: 'the section it is licensed under',
};

/** The attention code the UI keys on. The words are in readNotes. */
export const INCOMPLETE = 'incomplete-read';

/**
 * Which guaranteed fields the read did not come back with.
 *
 * ⚠️ A PLACEHOLDER COUNTS AS READ. "NONE" against the barrel is the card
 * answering, not the card being blank — see card-placeholder.ts, and section E
 * of the SAPS 271, which prints that word because the applicant signs what the
 * card says. Only an ABSENT value is a failed read.
 */
export function missingMustRead(
  kind: CredentialKind,
  details: Record<string, string> | null | undefined,
): string[] {
  const want = MUST_READ[kind];
  if (!want) return [];
  const d = details ?? {};
  return want.filter((k) => !(d[k] ?? '').trim());
}

/** The reason, in the words the member sees on the row. */
export function incompleteNote(missing: readonly string[]): string {
  const names = missing.map((k) => LABEL[k] ?? k);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return (
    `We could not read ${list} off this card. ` +
    'A firearm licence prints every one of these — a number, or the word NONE ' +
    'where the part carries no number — so this is our reading and not your ' +
    'document. Open it and type in what the card says, or photograph it again ' +
    'in better light.'
  );
}
