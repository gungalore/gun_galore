import { CredentialKind, MotivationUploadKind } from '@prisma/client';
import type { FilingOption } from './document-filing.service';

// ────────────────────────────────────────────────────────────────────
// THE DOCUMENT DICTIONARY — ONE PLACE FOR THE DECISION VOCABULARY.
//
// ⚠️ IT EXISTS SO THE TWO SURFACES CANNOT DRIFT. The vault files a document
// under a CredentialKind and the motivation files the same page under a
// MotivationUploadKind, and until now each had its OWN list of folders and
// hints (vault-kind-options.ts, motivation-kind-options.ts). Two lists for one
// job is how a kind ends up in one and not the other — a document the writer
// files as OTHER on every upload, silently. This module is the one source; the
// two modules beside it re-export from here.
//
// ⚠️ THE HINTS ARE THE DISCRIMINATORS, NOT DECORATION. They carry the rules the
// old vision prompt learned the hard way: association paperwork is ONE kind
// whatever the letterhead says, it is an ENDORSEMENT only when it names a
// firearm, and a page with a SAQA unit-standard number is a Proficiency rather
// than a competency certificate. A hint that loses those rules sends a
// section 16 certificate to the wrong folder.
//
// ⚠️ THIS STEP IS ADDITIVE. The arrays are MOVED here verbatim and re-exported
// under their old names, so every importer and every behaviour is unchanged;
// `document-dictionary.spec.ts` asserts the vault set is exactly the live
// CredentialKinds and the motivation set mirrors CLASSIFIABLE.
// ────────────────────────────────────────────────────────────────────

/**
 * The vault's folder vocabulary as Jev sees it.
 *
 * ⚠️ EVERY OPTION IS A LIVE CredentialKind. The retired kinds (DEDICATED_STATUS,
 * DEDICATED_HUNTER, PROFESSIONAL_HUNTER, GOOD_STANDING, the four SAFE_PHOTO_*
 * and SAFE_INSTALLATION) are deliberately ABSENT: filing a new row under one of
 * them puts it outside every query that now looks for the live kind, which is
 * exactly what RETIRED_KINDS exists to prevent.
 */
export const VAULT_KIND_OPTIONS: readonly FilingOption[] = [
  {
    id: CredentialKind.FIREARM_LICENCE,
    label: 'Firearm licence',
    hint: 'a South African FIREARM licence card or certificate. The text must name a firearm (a make, model, calibre or serial) or cite a section of the Firearms Control Act. A licence for anything else — a driver\u2019s, TV, business, fishing or software licence, or a EULA — is NOT this: file it as Something else.',
  },
  {
    id: CredentialKind.COMPETENCY_CERTIFICATE,
    label: 'Competency certificate',
    hint: 'a SAPS competency certificate (the SAPS 524, or the older plastic card), naming a firearm category. It carries NO SAQA unit-standard number — a page with a unit-standard number such as 117705 or 119649 is a Proficiency, not this.',
  },
  {
    id: CredentialKind.DEDICATED_DISCIPLINE,
    label: 'Association or dedicated-status document',
    hint: 'ANY document from a shooting or hunting association about one of its members: a membership certificate, dedicated sport-shooter or hunter status, a section 16 letter of good standing, or professional-hunter registration. All one category; do NOT split them by the letterhead.',
  },
  {
    id: CredentialKind.ASSOCIATION_ENDORSEMENT,
    label: 'Association endorsement',
    hint: 'an association endorsement of ONE SPECIFIC FIREARM: it names that gun by serial, calibre, make or action. If it does not name a firearm, it is the association/dedicated-status document instead.',
  },
  {
    id: CredentialKind.PROFICIENCY,
    label: 'Proficiency',
    hint: 'a firearm proficiency / unit-standard training certificate: the PFTC Statement of Results, or a training provider\u2019s own certificate. It carries SAQA unit-standard NUMBERS \u2014 117705 (Knowledge of the Firearms Control Act), 119649 (handgun), 119650 (self-loading rifle), 119651 (manually operated rifle), 119652 (shotgun), 243200 (muzzle-loader). A page showing any of those numbers is this, whatever it titles itself: a provider\u2019s "COMPETENCY COURSE" certificate is a Proficiency, NOT a competency certificate.',
  },
  {
    id: CredentialKind.IDENTITY_DOCUMENT,
    label: 'Identity document',
    hint: 'a South African ID book or smart ID card, or the photo page of a passport',
  },
  {
    id: CredentialKind.ADDRESS_CONFIRMATION,
    label: 'Proof of address',
    // ⚠️ THE HINT IS THE DISCRIMINATOR, AND IT WAS A STUB. What makes the
    // category is an address and a date, not the sender. Operator, 2026-10-13:
    // "uploaded a proof of address and it was not recognized as such."
    hint: 'a proof of where the member lives: a municipal rates or utility account, a bank or retail account statement, a SARS, insurance, telecoms or medical-aid letter or statement, a lease or rental agreement, or a signed confirmation of residence (often an affidavit) from the person they live with. Addressed to a named person at a residential address and carrying a date; the sender does not matter.',
  },
  {
    id: CredentialKind.EMPLOYMENT_CONFIRMATION,
    label: 'Employment letter',
    hint: "a letter confirming the member's employment",
  },
  {
    id: CredentialKind.SAFE_PHOTOGRAPHS,
    label: 'Safe photographs',
    hint: 'a photograph of a gun safe or its installation',
  },
  {
    id: CredentialKind.SHOOTING_ACTIVITY_LOG,
    label: 'Shooting activity log',
    hint: 'a log or record of shooting activity or range visits',
  },
  {
    id: CredentialKind.OTHER,
    label: 'Something else',
    hint: 'a personal document we keep but do not file under a specific type',
  },
];

/**
 * The kinds Jev is asked to test for `also_covers`. The same live set minus
 * OTHER, because "also something else" is not a role a document fills. The
 * service drops whichever kind the primary answer named.
 */
export const VAULT_COVER_OPTIONS: readonly FilingOption[] =
  VAULT_KIND_OPTIONS.filter((o) => o.id !== CredentialKind.OTHER);

/**
 * The motivation's document folders as Jev sees it.
 *
 * ⚠️ MIRRORS `CLASSIFIABLE` in motivation-extract.service.ts. Both must name the
 * same set of MotivationUploadKind values; a kind in one and not the other is a
 * document the writer files as OTHER on every upload, silently. The spec beside
 * this module pins that mirror.
 */
export const MOTIVATION_KIND_OPTIONS: readonly FilingOption[] = [
  {
    id: 'GOOD_STANDING_LETTER',
    label: 'Letter of good standing',
    hint: "an association's letter confirming the member is in good standing (section 16)",
  },
  {
    id: 'ASSOCIATION_ENDORSEMENT',
    label: 'Association endorsement',
    hint: 'an association\'s endorsement of ONE SPECIFIC FIREARM for a discipline: the word "endorsement" appears (often in the heading) and it names that firearm by type, calibre, make, action or serial (often a table headed "suitability of firearm"). It is NOT the membership card and NOT a letter of good standing.',
  },
  {
    id: 'IDENTITY_DOCUMENT',
    label: 'Identity document',
    hint: 'a South African ID book, ID card, or passport',
  },
  {
    id: 'COMPETENCY_CERTIFICATE',
    label: 'Competency certificate',
    hint: 'a SAPS competency certificate',
  },
  {
    id: 'PROFICIENCY_CERTIFICATE',
    label: 'Proficiency certificate',
    hint: 'a proficiency or firearm training certificate',
  },
  {
    id: 'CURRENT_LICENCE',
    label: 'Firearm licence',
    hint: "a firearm licence card or certificate that is THE APPLICANT'S OWN (one of the firearms they already hold, not someone else's)",
  },
  {
    id: 'ASSOCIATION_CARD',
    label: 'Association card',
    hint: 'hunting or sport-shooting association membership',
  },
  {
    id: 'ADDRESS_CONFIRMATION',
    label: 'Proof of address',
    hint: 'a municipal bill, bank statement, lease or affidavit showing a residential address',
  },
  {
    id: 'EMPLOYMENT_CONFIRMATION',
    label: 'Employment letter',
    hint: 'a letter confirming employment',
  },
  {
    id: 'SAFE_PHOTOGRAPHS',
    label: 'Safe photographs',
    hint: 'a photograph of a gun safe or strongroom in ANY state (door shut, part open, bolts, or how it is bolted down)',
  },
  {
    id: 'CHARACTER_REFERENCE',
    label: 'Character reference',
    hint: 'a personal reference letter about someone',
  },
  {
    id: 'INCIDENT_REPORT',
    label: 'Incident report',
    hint: 'a SAPS case document or armed-response incident report',
  },
  {
    id: 'FIREARM_SOURCE_PROOF',
    label: 'Firearm source proof',
    hint: "paperwork for the firearm being bought: a dealer's invoice or quote, a dealer-prefilled SAPS 271, the CURRENT OWNER'S licence card (front or back), or a letter or signed consent from that owner",
  },
  {
    id: 'PREVIOUS_MOTIVATION',
    label: 'Previous motivation',
    hint: 'a previously written firearm licence motivation',
  },
  {
    id: 'OTHER',
    label: 'Something else',
    hint: 'anything else, or you cannot tell',
  },
];


/**
 * ONE VAULT DOCUMENT CAN SATISFY SEVERAL CHECKLIST ROWS � the placement map.
 *
 * ?? MOVED FROM motivation-credentials.ts (2026-10-16), so the folder a document
 * is filed under and the checklist rows it answers live beside the folders
 * themselves. Re-exported from there, so every importer is unchanged.
 *
 * FIRST ENTRY IS THE PRIMARY � the kind the stored upload row actually gets.
 * The rest ride along in MotivationUpload.coversKinds, because a second row for
 * the same bytes would print the same page twice in the pack.
 *
 * ?? EXHAUSTIVE OVER CredentialKind, AND THAT IS THE POINT. Typed to the enum,
 * the compiler names every site the day a kind is added; `Record<string, ...>`
 * would compile cleanly whatever is missing and hide a silent, total failure
 * (a stored document, invisible in the picker, still counting against the cap).
 */
export const CREDENTIAL_TO_UPLOAD: Record<
  CredentialKind,
  MotivationUploadKind[]
> = {
  FIREARM_LICENCE: [MotivationUploadKind.CURRENT_LICENCE],
  COMPETENCY_CERTIFICATE: [MotivationUploadKind.COMPETENCY_CERTIFICATE],
  DEDICATED_DISCIPLINE: [
    MotivationUploadKind.ASSOCIATION_CARD,
    MotivationUploadKind.GOOD_STANDING_LETTER,
  ],
  PROFICIENCY: [MotivationUploadKind.PROFICIENCY_CERTIFICATE],
  /**
   * ?? IT FILLS THE SLOT, AND IT IS STILL IN NEVER_AUTOLINK. Mapping a kind to
   * a slot says where it CAN go, not that it goes there unasked � an
   * endorsement names one firearm, so an older one describes the wrong gun,
   * which is the rule motivation-autolink.ts has always applied to it. What
   * changes is that a member picking one from their Centre now has somewhere
   * to put it.
   */
  ASSOCIATION_ENDORSEMENT: [MotivationUploadKind.ASSOCIATION_ENDORSEMENT],
  // Retired kinds, kept so rows filed before the consolidation still map.
  DEDICATED_STATUS: [MotivationUploadKind.ASSOCIATION_CARD],
  DEDICATED_HUNTER: [MotivationUploadKind.ASSOCIATION_CARD],
  GOOD_STANDING: [MotivationUploadKind.GOOD_STANDING_LETTER],
  // No slot on any motivation. Kept in the vault, chased for expiry, and not
  // offered as an attachment � a Professional Hunter registration evidences
  // nothing under section 16, and OTHER is unclassified by definition.
  PROFESSIONAL_HUNTER: [],
  OTHER: [],
  IDENTITY_DOCUMENT: [MotivationUploadKind.IDENTITY_DOCUMENT],
  ADDRESS_CONFIRMATION: [MotivationUploadKind.ADDRESS_CONFIRMATION],
  EMPLOYMENT_CONFIRMATION: [MotivationUploadKind.EMPLOYMENT_CONFIRMATION],
  SAFE_PHOTOGRAPHS: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  // ?? THE RETIRED FOUR MAP FORWARD, they do not map to themselves. A vault row
  // filed before 2026-08-23 still answers the safe row on a new application.
  SAFE_PHOTO_CLOSED: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SAFE_PHOTO_AJAR: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SAFE_PHOTO_BOLTS: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SAFE_INSTALLATION: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SHOOTING_ACTIVITY_LOG: [MotivationUploadKind.SHOOTING_ACTIVITY_LOG],
  // ?? EVIDENCE ANSWERS NO DOCUMENT SLOT, AND THAT IS NOT A GAP. A hunting
  // photograph is not a competency certificate; a permission letter ticks
  // FIREARM_SOURCE_PROOF through its CONTAINER's `satisfies`, not this map.
  EVIDENCE: [],
};
