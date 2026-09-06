// ONE registry of document field names, shared by both centres.
//
// Operator, 2026-08-28: "All rules and requests for scanned or uploaded
// documents must apply to both motivation and license centre going forward.
// Doe not matter where it get uploaded from the two, it must update on both
// documents and pull through on both."
//
// ────────────────────────────────────────────────────────────────────
// WHY THIS IS A MAPPING AND NOT A RENAME.
//
// The obvious fix is to make both sides use the same key names. It is also
// destructive: the vault stores `details` ENCRYPTED under the vault's key
// names, so renaming them orphans every row already in the database — the
// values are still there and nothing can find them. The motivation side has
// the same problem in reverse, plus its keys are the wizard's answer keys and
// appear in stored answer blobs.
//
// So the canonical thing is the MAPPING. Each side keeps the names it has
// always written; this module is the single place that knows they are the same
// value, and both sides import it instead of each carrying half a table.
//
// ⚠️ THIS REPLACES FOUR BUGS' WORTH OF DIVERGENCE. From the code it supersedes:
// "The vault and the motivation registry name the same values differently — a
// licence is read into the vault as {licence_number, make, calibre,
// frame_serial} and the form wants {existing_firearm_1_licence_no, _make,
// _calibre, _frame_serial}". The intersection of those two sets is EMPTY, and
// because `addFromLibrary` derived "was this document readable" from that
// intersection, a document the vault had read perfectly was reported as
// unreadable for nine of the ten kinds that reach it. That is the amber the
// operator reported twice.
//
// ⚠️ THE OWNED-FIREARM ROW IS A TEMPLATE, NOT A NAME. A licence describes ONE
// firearm and an applicant may hold six, so the motivation side numbers its
// slots. `{n}` is substituted by the caller once it knows which row is free
// (see nextOwnedSlot). Any mapping that writes a literal
// `existing_firearm_1_*` would make every licence overwrite the first.

/** A vault (Licence Centre) detail key paired with its motivation answer key. */
export interface FieldAlias {
  /** The key the Licence Centre reads and stores in Credential.details. */
  vault: string;
  /**
   * The motivation wizard answer key, or null where the value has no box on
   * the form. Null is a real answer and must stay expressible: `holder_name`
   * is on every document and the form asks for the applicant's name once.
   */
  motivation: string | null;
}

/**
 * ⚠️ ONE FIREARM PER LICENCE, MANY LICENCES PER APPLICANT. `{n}` is replaced
 * with the row number the caller allocated. See ownedFirearmKey().
 */
export const OWNED_ROW_TOKEN = '{n}';

/** Substitute a real row number into an owned-firearm motivation key. */
export function ownedFirearmKey(template: string, row: number): string {
  return template.replace(OWNED_ROW_TOKEN, String(row));
}

/**
 * The alias table, keyed by the Licence Centre's CredentialKind.
 *
 * ⚠️ EVERY VAULT KEY MUST APPEAR HERE, mapped or explicitly null. The spec
 * asserts totality: a vault key with no entry is a value that silently fails
 * to carry, which is precisely the class of bug this module exists to end.
 */
export const FIELD_ALIASES: Record<string, readonly FieldAlias[]> = {
  // A firearm licence describes a firearm the applicant ALREADY OWNS, so it
  // fills an owned-firearm row — never the applied-for firearm.
  FIREARM_LICENCE: [
    { vault: 'licence_number', motivation: 'existing_firearm_{n}_licence_no' },
    { vault: 'firearm_type', motivation: 'existing_firearm_{n}_type' },
    { vault: 'make', motivation: 'existing_firearm_{n}_make' },
    { vault: 'calibre', motivation: 'existing_firearm_{n}_calibre' },
    { vault: 'frame_serial', motivation: 'existing_firearm_{n}_frame_serial' },
    { vault: 'barrel_serial', motivation: 'existing_firearm_{n}_barrel_serial' },
    // ⚠️ NO MOTIVATION BOX YET, AND IT IS THE MOST USEFUL FIELD ON THE CARD.
    // The section decides the licence's term (LICENCE_YEARS) and therefore the
    // competency expiry that follows it, and credential-auto-date refuses to
    // arm a date without it. Mapped as null rather than omitted so the
    // totality check passes and the gap is visible rather than forgotten.
    { vault: 'section', motivation: null },
    // The form asks the applicant's name once, in its own field.
    { vault: 'holder_name', motivation: null },
  ],

  COMPETENCY_CERTIFICATE: [
    { vault: 'competency_number', motivation: 'competency_number' },
    // ⚠️ THE ONE THAT NEVER CARRIED. The vault calls it `covers`; the form
    // calls it `competency_for`. Same value — which endorsements the
    // certificate awards — and the exact-name match dropped it every time.
    { vault: 'covers', motivation: 'competency_for' },
    { vault: 'holder_name', motivation: null },
    // ⚠️ NOT IN THE VAULT'S WANTED LIST TODAY. The motivation side asks for
    // `competency_issued` and the vault does not read it, so the issue date
    // never carries either. Adding it to WANTED is what makes this line work;
    // until then it maps a key the vault never fills, which is harmless and
    // becomes correct the moment the vault asks for it.
    { vault: 'competency_issued', motivation: 'competency_issued' },
  ],

  // ⚠️ ID DOCUMENTS NOW CARRY THEIR ISSUE DATE. Operator, 2026-08-28: "The ID
  // document I just uploaded did not recognize the issue date." It was never
  // read, and could not have been: the vault's WANTED list for this kind was
  // ['full_name', 'id_number'], and WANTED is both the question asked of the
  // model AND the filter applied to its answer, so a volunteered date was
  // discarded on the way back.
  IDENTITY_DOCUMENT: [
    { vault: 'full_name', motivation: 'full_name' },
    { vault: 'id_number', motivation: 'id_number' },
    { vault: 'issue_date', motivation: null },
  ],

  ADDRESS_CONFIRMATION: [
    { vault: 'residential_address', motivation: 'residential_address' },
    {
      vault: 'residential_postal_code',
      motivation: 'residential_postal_code',
    },
    // The person the bill is made out to. Read so the vault can check the
    // proof is the member's own (address-proof.ts); the identity document
    // is the source of the applicant's name on the form, not a utility bill.
    { vault: 'full_name', motivation: null },
  ],

  EMPLOYMENT_CONFIRMATION: [
    { vault: 'employer_name', motivation: 'employer_name' },
    { vault: 'employer_address', motivation: 'employer_address' },
  ],

  // The association documents fill association slots, and the numbers are NOT
  // interchangeable — a status number, a membership number and a good-standing
  // reference can all appear on one page. Each maps on its own or not at all.
  DEDICATED_DISCIPLINE: [
    { vault: 'association', motivation: 'association_name' },
    { vault: 'status_number', motivation: 'association_number' },
    { vault: 'joined_on', motivation: 'dedicated_since' },
    { vault: 'holder_name', motivation: null },
    { vault: 'status_type', motivation: null },
    { vault: 'membership_number', motivation: null },
    { vault: 'good_standing_number', motivation: null },
    { vault: 'good_standing', motivation: null },
    { vault: 'registration_number', motivation: null },
    { vault: 'province', motivation: null },
    { vault: 'category', motivation: null },
  ],

  PROFICIENCY: [
    { vault: 'certificate_number', motivation: null },
    { vault: 'holder_name', motivation: null },
    { vault: 'unit_standard', motivation: 'competency_for' },
  ],

  OTHER: [
    { vault: 'reference_number', motivation: null },
    { vault: 'holder_name', motivation: null },
    { vault: 'issuer', motivation: null },
  ],
};

/**
 * Translate a vault reading into motivation answer keys.
 *
 * @param row Which owned-firearm row to write into, for kinds that use one.
 *
 * ⚠️ RETURNS ONLY WHAT MAPS. A vault key aliased to null is dropped on
 * purpose: it has no box to land in, and inventing one would put a value where
 * nothing asked for it.
 */
export function toMotivationAnswers(
  kind: string,
  details: Record<string, string>,
  row = 1,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const alias of FIELD_ALIASES[kind] ?? []) {
    if (!alias.motivation) continue;
    const value = details[alias.vault];
    if (typeof value !== 'string' || !value.trim()) continue;
    out[ownedFirearmKey(alias.motivation, row)] = value;
  }
  return out;
}

/** Every vault key this kind can carry — the question AND the filter. */
export function vaultKeysFor(kind: string): string[] {
  return (FIELD_ALIASES[kind] ?? []).map((a) => a.vault);
}
