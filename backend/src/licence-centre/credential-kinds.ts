import { CredentialKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// WHAT WE CAN TELL FROM THE KIND ALONE — WHICH IS LESS THAN IT LOOKS.
//
// ⚠️ THE FIRST VERSION OF THIS FILE DECIDED EXPIRY BY KIND, and it was wrong
// in a way an ordinary member would have hit on day one. It listed eight
// "person" kinds that supposedly never run out, IDENTITY_DOCUMENT among them,
// and a database CHECK enforced it. A PASSPORT IS AN IDENTITY DOCUMENT AND IT
// EXPIRES — the Centre's own classifier prompt says as much, "the green
// barcoded book, the smart ID card, or the photo page of a passport". Somebody
// filing a passport would have met a database error with no way round it.
//
// Operator, 2026-08-22: "put a tick box next to the expiry date called Never
// Expires. Also a tickbox next to Issue date called Not Sure, if its unsure
// when the document was issued."
//
// That is the right answer, and it is not a compromise. The member is holding
// the document. They can see whether there is a date printed on it; we are
// guessing from a category name. So `Credential.neverExpires` and
// `issuedOnUnknown` carry the answer, vision proposes what it can read, and
// nothing in this file overrules either.
//
// What IS still worth knowing from the kind is narrower, and it is only about
// what is worth LOOKING at: whether the thing is a document with printing on
// it, or a photograph of an object.
//
// PURE — no Nest, no Prisma client, no clock.
// ────────────────────────────────────────────────────────────────────

/**
 * Photographs of a thing, not documents. Nothing is printed on them to read.
 *
 * ⚠️ NO VISION CALL, AND THE REASON IS NOT ONLY COST. A vision pass over a
 * photograph of a gun safe comes back with nothing — and a document that
 * yields nothing is flagged amber, "we could not read anything off that one",
 * which tells a member something is wrong with a photograph that is perfectly
 * fine.
 *
 * Everything else gets read, including the ID copies and proofs of address the
 * Centre gained from the application paperwork. Operator, 2026-08-22: "Lets
 * claude vison search on the document for issue and expiry of the docuemnt and
 * autofill it." The extract prompt already asks for issued_on and expires_on
 * on every kind it runs on, so this list is the whole of what is skipped.
 */
export const PHOTOGRAPH_KINDS: readonly CredentialKind[] = [
  CredentialKind.SAFE_PHOTOGRAPHS,
  // ⚠️ THE RETIRED FOUR STAY ON THIS LIST. Nothing new can be filed under them
  // — the picker does not offer them and the migration moved every row — but a
  // row that slipped through during the deploy would otherwise get a vision
  // call spent on a photograph of a gun safe and come back flagged amber for
  // having read nothing, which is the exact failure this list prevents.
  CredentialKind.SAFE_PHOTO_CLOSED,
  CredentialKind.SAFE_PHOTO_AJAR,
  CredentialKind.SAFE_PHOTO_BOLTS,
  CredentialKind.SAFE_INSTALLATION,
];

const PHOTOGRAPHS: ReadonlySet<CredentialKind> = new Set(PHOTOGRAPH_KINDS);

/** Is there anything printed on this to read? */
export function isPhotograph(kind: CredentialKind): boolean {
  return PHOTOGRAPHS.has(kind);
}

/** Kinds we spend no vision call on. */
export const NO_VISION_KINDS = PHOTOGRAPH_KINDS;

/**
 * Kinds where "Never expires" starts already ticked.
 *
 * ⚠️ THE SAME PHOTOGRAPHS, AND ONLY BECAUSE WE NEVER LOOKED. A pre-ticked box is us
 * answering on the member's behalf, which is exactly the mistake this file was
 * rewritten to undo — so it is limited to the case where there is provably
 * nothing to read: a photograph of a safe has no date on it in any sense.
 *
 * Everything else starts UNTICKED with whatever vision found in the box, even
 * where the kind usually has no date. An ID copy is the example that matters:
 * a green barcoded book does not expire and a passport does, and the member
 * settles it in one tap while looking at the thing itself.
 *
 * The tick is never applied silently — the confirm step always shows it, and
 * confirmedAt is only stamped once they have pressed the button.
 */
export function defaultsToNeverExpires(kind: CredentialKind): boolean {
  return PHOTOGRAPHS.has(kind);
}
