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

import { answerValue } from './card-placeholder';

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
    { vault: 'model', motivation: 'existing_firearm_{n}_model' },
    { vault: 'calibre', motivation: 'existing_firearm_{n}_calibre' },
    // ⚠️ THESE TWO MOTIVATION KEYS ARE RETIRED, AND THE MAPPING STILL NAMES
    // THEM ON PURPOSE. The wizard collapsed its two serial boxes into one
    // `existing_firearm_{n}_serial` on 2026-09-07, because a card prints one
    // number against the barrel, the receiver AND the frame and says NONE for
    // whichever component does not carry it. The old keys are still ACCEPTED
    // and still read back — motivation-fields.ts ownedFirearmSerial() reads
    // `_serial`, then `_barrel_serial`, then `_frame_serial`, each through the
    // placeholder guard — so a draft written before the collapse still loads.
    //
    // They are NOT collapsed here because two vault keys cannot both write one
    // motivation key: whichever ran last would silently overwrite the other,
    // and on a card where they genuinely differ that is the wrong number on a
    // signed form. The one place that has to choose between them is
    // ownedFirearmSerial, and it does.
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
  //
  // ⚠️ THE MEMBERSHIP'S "VALID UNTIL" DATE IS NOT IN THIS TABLE, AND THAT IS
  // NOT AN OMISSION. The letter of good standing's expiry travels on the
  // vault's `expires_on` channel — which every kind is asked for and which
  // lands in the Credential.expiresOn COLUMN, not in `details` — so there is
  // no vault DETAIL key to alias to `association_expiry`. credentialOffer
  // reads the column. Adding a details key for the same date would give one
  // document two expiries that could disagree.
  DEDICATED_DISCIPLINE: [
    { vault: 'association', motivation: 'association_name' },
    { vault: 'status_number', motivation: 'association_number' },
    // ⚠️ `joined_on` IS A JOIN DATE AND IT USED TO BE ALIASED TO
    // `dedicated_since`, WHICH IS NOT. That field is labelled "Dedicated
    // status held since" and is what deriveFacts counts `years_dedicated`
    // from; for a SAHGCA or NARFO member the two are routinely years apart —
    // you join, and then you qualify. `association_joined` is the box that
    // asks what this value answers. Nothing in the vault reads a
    // dedicated-since date, so `dedicated_since` is asked of the member.
    { vault: 'joined_on', motivation: 'association_joined' },
    { vault: 'holder_name', motivation: null },
    // ⚠️ NULL BECAUSE IT HAS NO BOX, NOT BECAUSE IT IS UNUSED. `status_type`
    // is the only genuine record of WHICH dedicated status a document awards
    // — sport, hunter, both or professional — and dedicatedStatusFits in
    // motivations/motivation-credentials.ts reads it to keep a dedicated
    // hunter's papers out of a dedicated sport shooter's application. It fills
    // no field; it decides which documents may fill any.
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
    // Printed on both sides of the pair; what joins them. Not a form field.
    { vault: 'scv_number', motivation: null },
    { vault: 'issuer', motivation: null },
    // ⚠️ WHICH SIDE THIS IS — added 2026-09-08 with Textract's removal. It used
    // to be decided AFTER the read, by grepping OCR text for "statement of
    // results", which cost a second Textract call even when the model had done
    // the actual read. It is now simply one more thing the model is asked for.
    //
    // `motivation: null` because it is not a form field and never reaches an
    // answer: it decides which of a pair a document IS, so the vault can file
    // the two together. See findOtherSide in credential-duplicates.ts.
    { vault: 'document_side', motivation: null },
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
 *
 * ⚠️ NOTHING IN PRODUCTION CALLS THIS TODAY, AND THE NEXT READER MUST NOT TICK
 * IT OFF AS COVERED. Repo-wide, `toMotivationAnswers` is reached only from
 * document-fields.spec.ts and credential-chain.spec.ts. The LIVE vault-to-
 * motivation carry is credentialOffer() in motivations/motivation-credentials.ts,
 * which does its own mapping so it can attach a label, a source document and a
 * credential id to every value; this function returns bare keys and cannot.
 * What it is, is the executable statement of the mapping — the totality check
 * in its spec is what catches a vault key with no motivation home — so it is
 * kept and kept correct rather than deleted.
 *
 * ⚠️ SO THE GUARD BELOW IS CORRECT FOR THE DAY THIS IS WIRED, AND IS NOT WHAT
 * FIXED ANYTHING. It reads as an answer boundary because it would be one: the
 * vault stores what the card printed, NONE included, and it is right to (the
 * printed seller-consent declaration reproduces the document), but the moment a
 * reading crosses into `answers` it is a box on a form the applicant SIGNS, and
 * "frame serial number: NONE" is a false statement on a SAPS 271. The live
 * occurrence of that — the operator's own application reading "Firearm 6 —
 * frame serial NONE · barrel serial NONE" on 2026-09-07 — came through
 * credentialOffer and motivation-documents.service, and is fixed there. See
 * common/card-placeholder.ts for why the rule lives at answer boundaries and
 * nowhere upstream of them.
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
    if (typeof value !== 'string') continue;
    // ⚠️ THE PLACEHOLDER TRAVELS. This ran answerValue() and dropped the row,
    // on the reasoning that "a placeholder and a blank are the same absence to
    // a form". They are not: a SAPS 271 box reading NONE says the firearm has
    // no frame serial, and an empty one says nobody filled it in. The vault
    // already stores the card verbatim; this is the hand-off from the vault to
    // a motivation's answers, and it was the step that lost it.
    //
    // Operator, 2026-09-08, naming the Licence Centre specifically: "we do not
    // need to display all the information there, we can keep what is currently
    // there but all the information needs to be captured and stored."
    //
    // A genuinely absent field is still skipped — trim, not answerValue. The
    // writer is protected at the prose boundary; see renderFacts in
    // motivation-prompts.ts and card-placeholder-boundary.spec.ts.
    const answer = value.trim();
    if (!answer) continue;
    out[ownedFirearmKey(alias.motivation, row)] = answer;
  }
  return out;
}

/** Every vault key this kind can carry — the question AND the filter. */
export function vaultKeysFor(kind: string): string[] {
  return (FIELD_ALIASES[kind] ?? []).map((a) => a.vault);
}
