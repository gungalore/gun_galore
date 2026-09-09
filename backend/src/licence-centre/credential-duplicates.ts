// ────────────────────────────────────────────────────────────────────
// IS THIS THE SAME DOCUMENT AGAIN?
//
// @@unique([userId, sha256]) catches the same FILE twice. It cannot catch the
// same DOCUMENT twice: two photographs of one licence card are two different
// files, and a member who scans their pack on Monday and again on Friday ends
// up with every card in the vault twice — which prints as two annexures and
// lists as two licences to renew. Operator, 2026-09-07: "if a double of
// anything is scanned it must be flagged."
//
// The comparison is on what the document SAYS about itself: the serial on a
// licence, the number on a competency or proficiency, the ID number on an
// identity document, the address and date on a proof of residence. Read off
// the page by the extractor, so a document we could not read at all cannot be
// called a duplicate — it is flagged for other reasons already.
//
// ⚠️ A FLAG, NEVER A REFUSAL. The reader can be wrong, and a member who
// genuinely holds two licences for two firearms with the same frame serial
// (they exist: a rifle and its spare barrel licensed separately) must not be
// told the second is a copy and turned away. The row is filed, the review
// screen says "looks like a copy of X", and the member decides.
// ────────────────────────────────────────────────────────────────────

import type { CredentialKind } from '@prisma/client';
import { parseUnitStandards } from '../common/sa-competency';

export interface DuplicateSubject {
  kind: CredentialKind;
  details: Record<string, string>;
  /** ISO day, or null. */
  issuedOn: string | null;
}

export interface DuplicateCandidate extends DuplicateSubject {
  id: string;
  title: string;
  createdAt: Date;
}

/** "NONE", "N/A" and blanks are what a licence prints for a part with no serial; they identify nothing. */
const PLACEHOLDER = /^(none|n\/a|nil|na|-)?$/i;

/** Upper-case letters and digits only: "B 477-423" and "b477423" are one serial. */
function norm(v: string | undefined): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function tag(prefix: string, v: string | undefined): string | null {
  const raw = (v ?? '').trim();
  if (PLACEHOLDER.test(raw)) return null;
  const n = norm(raw);
  return n.length >= 3 ? `${prefix}:${n}` : null;
}

/**
 * Could this string be a firearm licence number at all?
 *
 * ⚠️ TWO SHAPES ARE NEVER ONE, and both turned up in the wild on the same day:
 *
 *   • THIRTEEN DIGITS is a South African ID number. Every card belonging to
 *     one person carries the same one, so keying a licence on it makes every
 *     firearm a duplicate of the first.
 *   • FOUR DIGITS OR FEWER, all numeric, is a year, a page number or an item
 *     count. A licence number is longer than that and is not a bare year.
 *
 * ⚠️ DELIBERATELY PERMISSIVE OTHERWISE. This decides whether a number is worth
 * COMPARING, not whether it is valid, and SAPS licence numbers vary by era and
 * province. Refusing a real one costs a duplicate we would have caught; the
 * serials still identify the card. Accepting a bad one tells somebody their
 * licences are copies of each other.
 */
export function looksLikeLicenceNumber(v: string | undefined): boolean {
  const n = norm(v);
  if (!n) return false;
  if (/^\d{13}$/.test(n)) return false;
  if (/^\d{1,4}$/.test(n)) return false;
  return n.length >= 5;
}

/**
 * The identities a document carries, as comparable strings. Two rows of the
 * same kind sharing ANY one of them are the same document.
 */
export function documentFingerprints(s: DuplicateSubject): string[] {
  const d = s.details;
  const out: (string | null)[] = [];
  switch (s.kind) {
    case 'FIREARM_LICENCE':
      // The licence number when it is printed; otherwise the serials. A
      // frame serial names the firearm on every South African card, so it is
      // the strongest of the three.
      /**
       * ⚠️ THE SERIALS FIRST, AND THE LICENCE NUMBER ONLY IF IT LOOKS LIKE
       * ONE. Read off the operator's own vault on 2026-09-09: the reader had
       * put the holder's 13-digit ID number into `licence_number` on three
       * cards and a bare four-digit number on four others — the same value
       * every time — so a Nordiske .223, a Glock 9mm, a Mauser .30-06 and a
       * Howa 6.5 Creedmoor were all flagged as copies of a CZ or a Marlin.
       * Five of six firearms called duplicates of an unrelated one.
       *
       * The reader is told to do better (see the FIREARM_LICENCE guidance in
       * licence-centre-extract.service.ts), and `looksLikeLicenceNumber` is
       * what holds when it does not. A duplicate flag is the one place a bad
       * read is loud rather than quiet: it tells a member their licences are
       * copies of each other.
       *
       * ⚠️ AND `serial_number` WAS A KEY NOTHING EVER WROTE. The vault stores
       * `serial`, `frame_serial`, `barrel_serial` and `receiver_serial`; that
       * tag has matched nothing since it was written, and the receiver serial
       * — the only number a Marlin carries — was invisible here as well.
       */
      out.push(
        tag('frame', d.frame_serial),
        tag('barrel', d.barrel_serial),
        tag('receiver', d.receiver_serial),
        tag('serial', d.serial),
        looksLikeLicenceNumber(d.licence_number)
          ? tag('licence', d.licence_number)
          : null,
      );
      break;
    case 'COMPETENCY_CERTIFICATE':
      out.push(tag('competency', d.competency_number));
      break;
    case 'PROFICIENCY': {
      out.push(tag('certificate', d.certificate_number), tag('scv', d.scv_number), tag('auth', d.authentication_code));
      // A statement of results without a printed number: the unit standards it
      // awards on the day it was issued name it well enough.
      const codes = parseUnitStandards(d.unit_standard ?? '').sort();
      if (codes.length && s.issuedOn) out.push(`sor:${codes.join('+')}@${s.issuedOn}`);
      break;
    }
    case 'IDENTITY_DOCUMENT':
      out.push(tag('id', d.id_number));
      break;
    case 'ADDRESS_CONFIRMATION': {
      // The same bill twice: same address, same date. A newer bill for the
      // same address is a different document and a better one.
      const addr = norm(d.residential_address);
      if (addr.length >= 8 && s.issuedOn) out.push(`address:${addr.slice(0, 40)}@${s.issuedOn}`);
      break;
    }
    case 'DEDICATED_DISCIPLINE':
    case 'DEDICATED_STATUS':
    case 'DEDICATED_HUNTER':
    case 'GOOD_STANDING': {
      const who = norm(d.association);
      const status = norm(d.status_type);
      const ref = tag('ref', d.member_number ?? d.reference_number ?? d.status_number);
      if (ref && who) out.push(`${ref}@${who}`);
      else if (who && status && s.issuedOn) out.push(`discipline:${who}|${status}@${s.issuedOn}`);
      break;
    }
    default:
      break;
  }
  return out.filter((x): x is string => x !== null);
}

/**
 * The earliest existing row this document duplicates, or null. Same kind
 * only: a licence and a competency can share nothing, and a bank statement
 * that names a serial number is not a licence.
 */
export function findDuplicate(subject: DuplicateSubject, others: readonly DuplicateCandidate[]): DuplicateCandidate | null {
  const mine = new Set(documentFingerprints(subject));
  if (!mine.size) return null;
  const hits = others
    .filter((o) => o.kind === subject.kind)
    // The front and the back of one proficiency share a number by design.
    .filter((o) => !oppositeSides(subject, o))
    .filter((o) => documentFingerprints(o).some((f) => mine.has(f)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return hits[0] ?? null;
}

/* ── The two sides of a proficiency ─────────────────────────────────── */

export type DocumentSide = 'front' | 'back';

/** Which side of a proficiency this is, as the reader recorded it. */
export function documentSide(d: Record<string, string>): DocumentSide | null {
  const s = (d.document_side ?? '').trim().toLowerCase();
  return s === 'front' || s === 'back' ? s : null;
}

function oppositeSides(a: DuplicateSubject, b: DuplicateSubject): boolean {
  if (a.kind !== 'PROFICIENCY' || b.kind !== 'PROFICIENCY') return false;
  const sa = documentSide(a.details);
  const sb = documentSide(b.details);
  return !!sa && !!sb && sa !== sb;
}

function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * The other side of this proficiency, if the member has already filed it.
 *
 * Operator, 2026-09-07: "how am I going to match the Statement of Results
 * (the back) with the front (the actual certificate)? Most statements are the
 * same format, but the certificate is per training centre and will always
 * differ." Two ways, in order of trust:
 *
 *   • a number printed on both: the S/C/V number, the provider's certificate
 *     number, or the statement's authentication code;
 *   • failing that, the same unit standards awarded to the same ID number
 *     within four months - a provider issues the statement days or weeks
 *     after the course, never a year after.
 *
 * Only across sides: a front never pairs with a front. Only rows not already
 * paired. Earliest wins where several qualify.
 */
export function findOtherSide(
  subject: DuplicateSubject,
  others: readonly (DuplicateCandidate & { otherSideId?: string | null })[],
): DuplicateCandidate | null {
  if (subject.kind !== 'PROFICIENCY') return null;
  // ⚠️ LABEL-BLIND ON PURPOSE. Progun prints one number as "CERTIFICATE
  // NUMBER" on its certificate and the PFTC statement behind it prints the
  // same number as the "SCV Number", so the two sides only meet if a number
  // is a number whatever it was called.
  const numbers = (d: Record<string, string>) =>
    [d.scv_number, d.certificate_number, d.authentication_code]
      .map((v) => norm(v))
      .filter((n) => n.length >= 4 && !PLACEHOLDER.test(n));
  const mine = new Set(numbers(subject.details));
  const myCodes = parseUnitStandards(subject.details.unit_standard ?? '').sort().join('+');
  const myId = norm(subject.details.id_number);
  const hits = others
    .filter((o) => o.kind === 'PROFICIENCY' && !o.otherSideId && oppositeSides(subject, o))
    .filter((o) => {
      if (numbers(o.details).some((n) => mine.has(n))) return true;
      if (!myCodes) return false;
      const codes = parseUnitStandards(o.details.unit_standard ?? '').sort().join('+');
      if (codes !== myCodes) return false;
      const theirId = norm(o.details.id_number);
      const gap = daysApart(subject.issuedOn, o.issuedOn);
      // Both IDs read: they must agree, and the dates must be close or unknown.
      if (myId && theirId) return myId === theirId && (gap === null || gap <= 120);
      // One ID missing (a provider certificate that prints none, or one we
      // could not read): the same codes on dates within four months of each
      // other is the same course. With no date on either, that is a guess.
      return gap !== null && gap <= 120;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return hits[0] ?? null;
}

/** The attention code for a proficiency side filed without its other side. */
export const SIDE_MISSING = 'side-missing';

// ⚠️ "STATEMENT OF RESULTS" AND "CERTIFICATE", NEVER "FRONT" AND "BACK".
// Operator, 2026-09-07: "ask for the Statement of results or the certificate,
// don't reference them as front and back." Front and back are how the code
// tells the two apart; the member holds two named documents.
const SIDE_MISSING_NOTES: Record<DocumentSide, string> = {
  front:
    "This is the training provider's certificate. A DFO wants the PFTC statement of results that goes with it as well: scan it too and the two are filed together.",
  back:
    "This is the statement of results. A DFO wants the training provider's certificate that goes with it as well: scan it too and the two are filed together.",
};

/** What the row says while it waits for its other side. */
export function sideMissingNote(side: DocumentSide): string {
  return SIDE_MISSING_NOTES[side];
}

/** So the note can be taken off again when the other side arrives. */
export function isSideMissingNote(note: string): boolean {
  // By opening words, so a note written under earlier wording still comes off.
  return /^This is the (training provider's certificate|statement of results)\./.test(note);
}

/** A note saying the row is one of a pair, under any wording this module has used. */
export function isPairNote(note: string): boolean {
  return /^Filed (as|with) /.test(note);
}

/** The sentence on the row that completed the pair. */
export function otherSideNote(match: { title: string }, side: DocumentSide | null): string {
  const what = side === 'back' ? 'the statement of results' : side === 'front' ? 'the certificate' : 'one page';
  return `Filed with "${match.title}" as ${what} of the pair. The two go onto an application together.`;
}

/** The sentence the member sees on the review screen and the card. */
export function duplicateNote(match: { title: string; createdAt: Date }): string {
  const day = match.createdAt.toISOString().slice(0, 10);
  return `Looks like a copy of "${match.title}", which you added on ${day}. Keep one: two copies list as two documents and print as two annexures.`;
}
