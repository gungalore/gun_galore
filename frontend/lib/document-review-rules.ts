import { CredentialKind, CredentialProposal } from './licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// WHAT THE REVIEW SCREEN IS ALLOWED TO DO WITHOUT ASKING.
//
// These four functions decide, for one document in a batch, whether the
// member has to look at it and whether it can be settled with a single tap.
// They live here rather than inside the page for one reason: a pre-ship
// review found a bug in this exact logic that would have confirmed a firearm
// licence with no expiry date, and there was nowhere to write a test for it.
//
// ⚠️ THE BUG, SO IT IS NOT REINTRODUCED. The Document Centre's review screen
// offers a one-tap type control: a document we filed in the wrong box can be
// corrected without opening the full panel. The first draft allowed that tap
// on any row that had SOME expiry answer — and "Never expires" is pre-ticked
// by the SERVER for a photograph of a safe, because a photograph has no date.
// So a firearm licence misread as a photograph arrived with the tick already
// on it; correcting the type in one tap posted that tick under the new kind,
// and the server stamped it confirmed with expiresOn null. The reminder sweep
// only ever looks at rows that have BOTH confirmedAt and expiresOn, so that
// licence could never be reminded about again — and, being confirmed, no
// screen would ever ask about it either. Silent, permanent, and reached
// through the gesture meant to repair exactly that mistake.
//
// The rule that prevents it: a date may only cross a change of type when we
// READ it off the page. Everything else a row carries — the tick, a
// statute-derived expiry — was inferred from the type we GUESSED, and is
// therefore worthless the moment that guess is corrected.
// ────────────────────────────────────────────────────────────────────

/** One document waiting to be checked, from either the upload or the list. */
export interface ReviewItem {
  id: string;
  kind: CredentialKind;
  title: string;
  mimeType: string;
  /** WE named it, so there is a guess on it worth checking. */
  autoFiled: boolean;
  /** Only meaningful while autoFiled. False reads as "not sure", never "sure". */
  confident: boolean;
  neverExpires: boolean;
  issuedOnUnknown: boolean;
  proposed: CredentialProposal;
}

/**
 * The expiry answer this row already carries, or null when nobody has given
 * one.
 *
 * ⚠️ NULL IS WHAT MAKES A ROW UNANSWERABLE, AND IT IS NOT A DETAIL. The
 * confirm panel disables its own button on exactly this condition
 * (`!neverExpires && !expiresOn`), because a document with no date and no tick
 * has not been answered at all. Anything that swept those up would be posting
 * an answer the panel itself refuses to post, and the server would refuse it
 * too — one 400 per row.
 *
 * An empty string is a real answer: the tick says there is no date.
 */
export function expiryAnswer(d: ReviewItem): string | null {
  if (d.neverExpires) return '';
  return d.proposed.expiresOn ?? d.proposed.derivedExpiry?.on ?? null;
}

/**
 * Can this row be settled from the list, without opening the panel?
 *
 * ⚠️ A WORKED-OUT DATE CANNOT. `derivedExpiry` is arithmetic, not a reading: a
 * competency certificate prints an issue date and no expiry, and the statute
 * supplies five years from it. The panel renders the sentence saying where
 * that number came from; a row does not. Confirming it in bulk would stamp "a
 * member checked this" on a date nobody was shown the basis for — and on a
 * document that prints no expiry there is nothing to check it against.
 */
export function settleableInBulk(d: ReviewItem): boolean {
  if (d.proposed.derivedExpiry && !d.proposed.expiresOn) return false;
  return expiryAnswer(d) !== null;
}

/**
 * Is there a guess on this row the member should look at?
 *
 * ⚠️ A PHOTOGRAPH ALWAYS ASKS, however sure we were. Filing something as a
 * photograph of a safe is the one wrong box that is quietly permanent: the
 * upload skips the date reading entirely for it, the row arrives with "Never
 * expires" already ticked, and the reminder sweep only looks at rows that have
 * an expiry — so a firearm licence that lands in this box can never be
 * reminded about again, and nothing on any screen says so.
 */
export function needsALook(d: ReviewItem): boolean {
  if (!d.autoFiled) return false;
  return !d.confident || d.kind === 'SAFE_PHOTOGRAPHS';
}

/**
 * Must correcting this row's type go through the full panel?
 *
 * See the header of this file: this is the guard, and the bug it exists for
 * was reached in one tap.
 */
export function refileNeedsPanel(d: ReviewItem, to: CredentialKind): boolean {
  // Choosing the type it already has is not a correction. Nothing was
  // inferred from a guess that is about to change, so nothing is at risk.
  if (to === d.kind) return expiryAnswer(d) === null;
  // A date printed on the document is a fact about the document and survives
  // the correction. Every other answer came from the kind we guessed.
  return d.proposed.expiresOn === null;
}

/**
 * Add a freshly-uploaded batch to the documents already waiting to be checked.
 *
 * ⚠️ THIS EXISTS BECAUSE THE PAGE USED TO REPLACE INSTEAD OF ADD, AND THAT
 * QUIETLY LOST DOCUMENTS. The Document Centre hands off ONE document at a
 * time — the add panel closes after each hand-off — so a member adding six
 * licences makes six separate upload calls, and the old
 * `setQueue(added)` wiped the five before it out of the review every time.
 * Operator, 2026-08-25: "took scans of 6 licenses. 2 made it through."
 *
 * Nothing was lost from the server; every document uploaded. What they lost
 * was their place in the review, which is the only screen that asks a human to
 * confirm the type and the dates — so they sat unconfirmed and unfiled, which
 * for an expiry reminder is the same as not existing.
 *
 * There is no case where dropping an unconfirmed row is correct: this queue
 * holds only documents still waiting on a human, and the phone hand-off path
 * already rebuilds it from EVERY unconfirmed row for the same reason.
 *
 * De-duplicates by id, because the hand-off refresh and a desktop upload can
 * legitimately name the same row. The later arrival wins: it is the fresher
 * read of what the server made of the document.
 */
export function mergeReviewQueue(
  waiting: readonly ReviewItem[],
  added: readonly ReviewItem[],
): ReviewItem[] {
  const byId = new Map<string, ReviewItem>();
  for (const item of waiting) byId.set(item.id, item);
  for (const item of added) byId.set(item.id, item);
  return [...byId.values()];
}
