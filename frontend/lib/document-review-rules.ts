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
  /** Field keys the reader doubted. Optional: rows filed before it was stored. */
  readUncertain?: string[];
  /** What the reader repaired, already in a sentence. */
  readNotes?: string[];
  /** Server-side checks that failed: a copy of another row, a proof of address that is not the member's or not recent. */
  attention?: string[];
}

/**
 * Field keys in the member's words.
 *
 * WARNING: THE KEYS ARE OURS, NOT THEIRS. `covers` and `competency_issued`
 * mean something to the extractor and nothing to a person holding a
 * certificate. A key with no entry here is simply not mentioned - better to
 * say nothing than to show somebody the word `frame_serial`.
 */
const FIELD_LABELS: Record<string, string> = {
  id_number: 'the identity number',
  full_name: 'the name',
  holder_name: 'the name',
  covers: 'what the certificate covers',
  competency_number: 'the certificate number',
  competency_issued: 'the date of issue',
  certificate_number: 'the certificate number',
  licence_number: 'the licence number',
  section: 'the section',
  firearm_type: 'the firearm type',
  make: 'the make',
  calibre: 'the calibre',
  frame_serial: 'the frame serial number',
  barrel_serial: 'the barrel serial number',
  unit_standard: 'the unit standard',
  issue_date: 'the date of issue',
};

/**
 * One sentence saying what to look at, or null when there is nothing to say.
 *
 * Deliberately NOT a list of keys on screen. A member is checking their own
 * document against ours, so naming the thing in their words points their eye
 * at the right line on the paper.
 */
export function uncertaintyReason(d: ReviewItem): string | null {
  const named = (d.readUncertain ?? [])
    .map((f) => FIELD_LABELS[f])
    .filter((l): l is string => !!l);
  if (!named.length) return null;
  const unique = [...new Set(named)];
  const list =
    unique.length === 1
      ? unique[0]
      : `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  return `We could not read ${list} clearly - please check ${
    unique.length === 1 ? 'it' : 'them'
  } against the document.`;
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
  // A flagged row asks regardless of how it was filed: a member who declared
  // "firearm licence" and scanned the same card twice still has two.
  if ((d.attention?.length ?? 0) > 0) return true;
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
 *
 * GENERIC OVER THE ROW, deliberately. The Motivation Centre keeps its own
 * confirm-queue in a different shape to the Document Centre's ReviewItem, and
 * it had independently grown the SAME wholesale-replace bug. Two copies of this
 * would eventually disagree; one function keyed on `id` covers both and is
 * pinned by the same tests.
 */
// ────────────────────────────────────────────────────────────────────
// WHAT THE VAULT STILL OWES THE MEMBER, per stored row.
//
// ⚠️ THE PAGE KEYED ALL OF THIS ON THE DATE, AND THE OTHER HALF OF THE GUESS
// WAS DROPPED ON THE FLOOR. Every row carries two guesses, not one: what the
// document IS, and when it runs out. `namedConfident` is stored precisely so
// "we filed this and were not sure" survives a refresh — and it was read in
// the review queue and nowhere else. So a document we filed with low
// confidence, but whose expiry we then read cleanly off the page, counted as
// settled everywhere: off the banner, out of the hand-off queue, and with
// nothing on its row or its card saying we had guessed at all.
//
// That is the SAFE_PHOTOGRAPHS failure again by a different door. A firearm
// licence we were unsure about, filed as something with no renewal to chase,
// is a licence nothing will ever remind on — and the only signal we hold that
// it might be wrong is the one nobody was reading.
// ────────────────────────────────────────────────────────────────────

/** The parts of a stored CredentialRow these decisions actually read. */
export interface FiledRow {
  /** WE named it, so there is a guess on it worth checking. */
  autoFiled: boolean;
  /** Only meaningful while autoFiled. False reads as "not sure", never "sure". */
  namedConfident: boolean;
  /** A human has looked at this row and said it is right. */
  confirmed: boolean;
  /** Non-null means WE put the date there and nobody has checked it. */
  dateSource: 'read' | 'derived' | null;
  neverExpires: boolean;
}

/**
 * We chose the box and we were not sure.
 *
 * Says nothing about dates. A row can be perfectly dated and still be filed
 * under the wrong kind — which is the case the page had no name for.
 */
export function filedUnsure(
  r: Pick<FiledRow, 'autoFiled' | 'namedConfident'>,
): boolean {
  return r.autoFiled && !r.namedConfident;
}

/**
 * Nobody has settled this row's expiry — not the member, not us.
 *
 * ⚠️ A DATE WE FILLED IN IS SETTLED. Operator, 2026-08-25: "insert it. No
 * further user interaction required." The reminder is armed off it, so
 * counting it as outstanding would put every automatically dated licence back
 * on the to-do list it was just taken off.
 */
export function needsDateCheck(r: FiledRow): boolean {
  return !r.confirmed && r.dateSource === null && !r.neverExpires;
}

/**
 * Is the FILING — the box, not the date — still worth the member's eye?
 *
 * Two rows qualify: one nobody has dated and that has no date to give (so the
 * only thing left to check about it is the type), and one we filed without
 * being sure of the type, whatever its dates say.
 *
 * ⚠️ MUTUALLY EXCLUSIVE WITH needsDateCheck, so the banner cannot count one
 * document twice and call it two errands.
 */
export function needsFilingCheck(r: FiledRow): boolean {
  if (r.confirmed) return false;
  if (needsDateCheck(r)) return false;
  return filedUnsure(r) || r.dateSource === null;
}

/**
 * Should this row go back into the review queue after a phone hand-off?
 *
 * The union of the two above: anything still carrying a guess of ours that no
 * human has agreed with.
 */
export function needsReview(r: FiledRow): boolean {
  return needsDateCheck(r) || needsFilingCheck(r);
}

export function mergeReviewQueue<T extends { id: string }>(
  waiting: readonly T[],
  added: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of waiting) byId.set(item.id, item);
  for (const item of added) byId.set(item.id, item);
  return [...byId.values()];
}
