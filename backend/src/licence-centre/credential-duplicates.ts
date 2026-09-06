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
      out.push(tag('licence', d.licence_number), tag('frame', d.frame_serial), tag('serial', d.serial_number), tag('barrel', d.barrel_serial));
      break;
    case 'COMPETENCY_CERTIFICATE':
      out.push(tag('competency', d.competency_number));
      break;
    case 'PROFICIENCY': {
      out.push(tag('certificate', d.certificate_number));
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
    .filter((o) => documentFingerprints(o).some((f) => mine.has(f)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return hits[0] ?? null;
}

/** The sentence the member sees on the review screen and the card. */
export function duplicateNote(match: { title: string; createdAt: Date }): string {
  const day = match.createdAt.toISOString().slice(0, 10);
  return `Looks like a copy of "${match.title}", which you added on ${day}. Keep one: two copies list as two documents and print as two annexures.`;
}
