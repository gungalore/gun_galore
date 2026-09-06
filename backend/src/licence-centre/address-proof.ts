// ────────────────────────────────────────────────────────────────────
// IS THIS PROOF OF ADDRESS THE MEMBER'S, AND IS IT RECENT?
//
// A proof of residence can be almost anything with an address on it: a
// municipal account, a bank statement, a lease, a sworn confirmation from
// whoever they live with. The classifier recognises the class of document;
// nothing recognised whose it was. Operator, 2026-09-07: "it could literally
// be anything with an address on and at least my surname — how will we
// recognize it?"
//
// Three checks, each against something we already hold:
//   • the name printed on it against the member's profile name and, where
//     they have filed one, the name on their identity document;
//   • the address printed on it against the address on their profile;
//   • the date printed on it against the three months a DFO will accept.
//
// ⚠️ EVERY OUTCOME FILES THE DOCUMENT. These are reasons to ask, not
// refusals: a profile can be stale, a bill can be in a spouse's name with the
// member's own name on the second line, and the member is the one who knows.
// What a failed check changes is that the row asks to be looked at, with the
// reason in words, instead of filing silently as "Proof of address".
// ────────────────────────────────────────────────────────────────────

import { ADDRESS_FRESH_DAYS } from '../motivations/motivation-credentials';

export interface AddressProfile {
  firstName: string | null;
  lastName: string | null;
  addrBuilding?: string | null;
  addrStreet?: string | null;
  addrAddress2?: string | null;
  addrSuburb?: string | null;
  addrCity?: string | null;
  addrPostalCode?: string | null;
}

export interface AddressProofAssessment {
  /** Every check passed, or could not be run for want of profile data. */
  ok: boolean;
  /** Codes the UI can key on: 'name-missing' | 'name-mismatch' | 'address-mismatch' | 'date-missing' | 'stale'. */
  attention: string[];
  /** The same, in words for the member. */
  notes: string[];
  /** Fields the member should check against the page, in the extractor's key names. */
  uncertain: string[];
}

const WORD = /[A-Z0-9]+/g;

function words(v: string | null | undefined): string[] {
  return ((v ?? '').toUpperCase().match(WORD) ?? []).filter((w) => w.length >= 2);
}

/** Surname tokens: everything in the profile surname that is a real word (a double-barrel gives two). */
function surnameTokens(p: AddressProfile, identityName: string | null): string[] {
  const out = new Set<string>();
  for (const w of words(p.lastName)) if (w.length >= 3) out.add(w);
  // The identity document's last word is the surname as the state prints it.
  const id = words(identityName);
  if (id.length) out.add(id[id.length - 1]);
  return [...out];
}

const STREET_NOISE = new Set(['STREET', 'STR', 'ST', 'ROAD', 'RD', 'AVENUE', 'AVE', 'DRIVE', 'DR', 'CRESCENT', 'CRES', 'LANE', 'CLOSE', 'WAY', 'SOUTH', 'NORTH', 'EAST', 'WEST', 'AFRICA', 'RSA', 'PO', 'BOX']);

function addressTokens(v: string | null | undefined): Set<string> {
  return new Set(words(v).filter((w) => !STREET_NOISE.has(w)));
}

function daysSince(iso: string | null, today: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((today.getTime() - t) / 86_400_000);
}

export function assessAddressProof(args: {
  details: Record<string, string>;
  issuedOn: string | null;
  profile: AddressProfile | null;
  /** The name off the member's identity document in the vault, when they have one. */
  identityName: string | null;
  today: Date;
}): AddressProofAssessment {
  const attention: string[] = [];
  const notes: string[] = [];
  const uncertain: string[] = [];
  const d = args.details;

  // ── the name ─────────────────────────────────────────────────────
  const printedName = (d.full_name ?? d.holder_name ?? d.account_holder ?? '').trim();
  const surnames = args.profile ? surnameTokens(args.profile, args.identityName) : [];
  if (surnames.length) {
    if (!printedName) {
      attention.push('name-missing');
      notes.push('We could not find your name on this document. A DFO wants a proof of address in your own name; check it shows yours.');
      uncertain.push('full_name');
    } else {
      const onPage = new Set(words(printedName));
      const matched = surnames.some((s) => onPage.has(s));
      if (!matched) {
        attention.push('name-mismatch');
        notes.push(`The name on this document reads "${printedName}", which does not look like yours. A DFO wants one in your own name.`);
        uncertain.push('full_name');
      }
    }
  }

  // ── the address ──────────────────────────────────────────────────
  const p = args.profile;
  const profileAddress = p ? [p.addrBuilding, p.addrStreet, p.addrAddress2, p.addrSuburb, p.addrCity].filter(Boolean).join(' ') : '';
  const onPage = addressTokens(d.residential_address);
  if (profileAddress && onPage.size) {
    const mine = addressTokens(profileAddress);
    const postal = (p?.addrPostalCode ?? '').trim();
    const postalOnPage = postal && ((d.residential_postal_code ?? '').trim() === postal || onPage.has(postal.toUpperCase()));
    const shared = [...mine].filter((w) => onPage.has(w));
    // A street number plus one street or suburb word, or the postal code, is
    // the same place as far as a match on paper can tell.
    const numeric = shared.some((w) => /^\d+[A-Z]?$/.test(w));
    const named = shared.some((w) => /[A-Z]{3,}/.test(w));
    if (!postalOnPage && !(numeric && named)) {
      attention.push('address-mismatch');
      notes.push('The address on this document is not the address on your profile. If you have moved, update your profile; if this is somebody else\'s bill, a DFO will not accept it.');
    }
  }

  // ── the date ─────────────────────────────────────────────────────
  const age = daysSince(args.issuedOn, args.today);
  if (age === null) {
    attention.push('date-missing');
    notes.push('We could not read the date printed on this. A DFO wants a proof of address from the last three months; check the date, and add it if it is missing.');
  } else if (age > ADDRESS_FRESH_DAYS) {
    attention.push('stale');
    notes.push(`This is dated ${args.issuedOn}, older than three months. A DFO wants a recent one; it is filed, but you will need a newer one for an application.`);
  }

  return { ok: attention.length === 0, attention, notes, uncertain };
}
