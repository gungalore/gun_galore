import { MotivationLicenceType } from '@prisma/client';
import { fieldsFor } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// FILLING THE FORM FROM THE APPLICANT'S OWN PROFILE — WITH PERMISSION.
//
// Operator, 2026-08-18: ask before using their All Outdoor profile details.
//
// So this module answers two questions and nothing else: WHAT would we copy,
// and WHERE did each value come from. The applicant is shown that list, agrees
// or does not, and only then does anything move. Nothing here reads consent or
// writes to the database — the service does that — which is what makes "show me
// what you would take" a safe thing to call before any decision is made.
//
// ⚠️ CONSENT IS PER MOTIVATION, not per account. Someone who let us prefill one
// application has not agreed to it forever. POPIA wants a specific purpose, and
// "you ticked a box once" is not one.
//
// WHY THE PROFILE CANNOT CARRY THE APPLICATION. It is worth being clear about
// how little this covers, because it is tempting to think otherwise: the
// profile holds a name, an ID number, an address, a phone number and an email.
// That is EIGHT of the roughly 144 boxes on the SAPS 271. Competency number,
// existing firearms, safe details, association membership, employment and the
// six history questions are not in it and never will be — they are not
// marketplace data. Prefill is a courtesy that saves retyping; it is not a
// short cut to a completed form.
//
// ⚠️ NEVER OVERWRITE AN ANSWER. If the applicant has typed something, it wins.
// The profile is a starting point, and a form they signed that quietly
// contradicts what they typed is the worst outcome available here.
//
// PURE — no Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

/** The subset of a User row this module is allowed to see. */
export interface ProfileSource {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  /** Decrypted by the caller, which is the only place that may do it. */
  idNumber: string | null;
  addrBuilding: string | null;
  addrStreet: string | null;
  addrAddress2: string | null;
  addrSuburb: string | null;
  addrCity: string | null;
  addrPostalCode: string | null;
  addrProvince: string | null;
}

export interface ProfileOffer {
  /** Field key → the value we would write. */
  values: Record<string, string>;
  /** Field key → plain-English provenance, for the confirmation screen. */
  from: Record<string, string>;
  /**
   * Profile fields that are EMPTY and would have helped. Shown as "add these to
   * your profile and we can fill more" — an invitation, never a gate.
   */
  missingFromProfile: string[];
}

/** Join the address parts the profile keeps separately into one block. */
function composeAddress(p: ProfileSource): string {
  return [
    [p.addrBuilding, p.addrStreet].filter(Boolean).join(' ').trim(),
    p.addrAddress2,
    p.addrSuburb,
    p.addrCity,
    p.addrProvince,
  ]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * What we WOULD copy, given this profile and what has already been answered.
 *
 * Deliberately returns an offer rather than performing the copy. The applicant
 * sees exactly which boxes we intend to fill and where each value came from
 * before agreeing to any of it — "we used your profile" after the fact is not
 * consent.
 */
export function profileOffer(
  licenceType: MotivationLicenceType,
  profile: ProfileSource,
  answered: Record<string, string>,
): ProfileOffer {
  const values: Record<string, string> = {};
  const from: Record<string, string> = {};
  const missing: string[] = [];
  const keys = new Set(fieldsFor(licenceType).map((f) => f.key));

  const offer = (key: string, value: string, source: string) => {
    // Never overwrite. A form that contradicts what the applicant typed is
    // worse than one they had to type twice.
    if (!keys.has(key)) return;
    if ((answered[key] ?? '').trim()) return;
    const v = value.trim();
    if (!v) return;
    values[key] = v;
    from[key] = source;
  };

  const fullName = [profile.firstName, profile.lastName]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (fullName) offer('full_name', fullName, 'your account name');
  else missing.push('your first and last name');

  if (profile.idNumber) {
    offer('id_number', profile.idNumber, 'the ID number from your identity check');
  } else {
    missing.push('your ID number (added when you complete identity verification)');
  }

  const address = composeAddress(profile);
  if (address) offer('residential_address', address, 'your account address');
  else missing.push('your residential address');

  if (profile.addrPostalCode) {
    offer('residential_postal_code', profile.addrPostalCode, 'your account address');
  } else {
    missing.push('your postal code');
  }

  if (profile.phone) offer('cellphone', profile.phone, 'your account cellphone number');
  else missing.push('your cellphone number');

  // ── the postal address ───────────────────────────────────────────
  //
  // ⚠️ THE FORM ASKS FOR IT AND THE ANSWER IS ALMOST ALWAYS "THE SAME". The
  // 271 prints a postal address and a postal code; the field's own help says
  // "Leave blank if post reaches you at the address above", which is true of
  // nearly every applicant and is also the reason both boxes came back empty
  // on a printed form that has to carry an address for correspondence.
  //
  // ⚠️ AND WE ARE NOT INVENTING ANYTHING. This is the residential address we
  // just wrote, restated in the box that asks where post reaches them — which
  // is the answer for anybody without a PO box. Somebody who HAS one types it
  // over, exactly as they would have typed it into a blank; offer() never
  // overwrites, so an applicant who has already given a separate postal
  // address keeps it, and so does anybody returning to a saved draft.
  //
  // It rides on the SAME provenance as the address it came from, so the chip
  // says where it came from and the member can see it was filled in for them
  // rather than typed by them.
  if (address) {
    offer(
      'postal_address',
      address,
      'your account address — change it if post reaches you somewhere else',
    );
  }
  if (profile.addrPostalCode) {
    offer(
      'postal_postal_code',
      profile.addrPostalCode,
      'your account address — change it if post reaches you somewhere else',
    );
  }

  return { values, from, missingFromProfile: missing };
}

/**
 * How much of the FORM the profile can reach, as a plain sentence.
 *
 * Exists so the UI never implies a complete profile means a complete
 * application. It cannot: the rest is not marketplace data.
 */
export function profileCoverageNote(offer: ProfileOffer): string {
  const n = Object.keys(offer.values).length;
  if (n === 0) {
    return 'There is nothing in your profile we can use yet — you can type these in below.';
  }
  return `We can fill ${n} ${n === 1 ? 'answer' : 'answers'} from your profile. The rest of the application asks about things only you can tell us.`;
}
