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


/**
 * THE EXTRACTION FIELD LISTS — WHAT EACH KIND IS READ FOR.
 *
 * ⚠️ MOVED FROM licence-centre-extract.service.ts (2026-10-16), so a vault
 * kind’s folder, its placement and the fields a reader is asked for all live
 * in one place. Re-exported from there, so every importer is unchanged.
 *
 * ⚠️ WANTED IS BOTH THE QUESTION AND THE FILTER: a key missing here is a
 * value the reader is never asked for AND would have discarded anyway.
 */
export const WANTED: Record<CredentialKind, string[]> = {
  FIREARM_LICENCE: [
    /**
     * ⚠️ THE HEADLINE SERIAL, NOT A LICENCE NUMBER. Operator, 2026-10-13:
     * "there is no license number on a firearm license card. The police will
     * use the Serial Number as the reference number of the card." The vault
     * asked every card for a licence number it does not print, so the read came
     * back empty and credential-completeness flagged every licence "Worth a
     * look" for a missing field that was never on the card.
     */
    'serial',
    'holder_name',
    'firearm_type',
    'make',
    // ⚠️ WANTED IS BOTH THE QUESTION AND THE FILTER, so a key missing from
    // here is a value the reader is never asked for AND would have discarded
    // anyway. 'model' was missing, and the cost was paid on three screens at
    // once: the operator's owned-firearm listing is make / model / serial /
    // expiry by their own instruction and could never show a model for any
    // vault-read licence; `existing_firearm_N_model` carries
    // docSourced: 'CURRENT_LICENCE', so an empty one told the member the
    // document did not carry a model when nobody had looked; and a section 24
    // renewal, whose whole point is that we already hold the licence, still
    // had to be asked for the model of the firearm being renewed.
    'model',
    'calibre',
    'frame_serial',
    'barrel_serial',
    /**
     * ⚠️ THE RECEIVER SERIAL, AND ITS ABSENCE LOST A FIREARM ITS IDENTITY.
     * WANTED is both the question and the filter, so this key missing meant
     * the reader was never asked for it AND would have discarded it anyway —
     * the exact trap the note on 'model' above records, in a second place.
     *
     * The operator's Marlin prints NONE for the frame and NONE for the barrel
     * and carries its number on the RECEIVER. Read into the vault it therefore
     * had no serial at all: `ownedFirearmSections` matches an owned row to its
     * card by serial and only by serial, so that firearm could never be placed
     * under a section, its candidate uses were withheld (a row with no section
     * gets none, deliberately), and SAPS 271 item 2.1 printed a blank where a
     * serial belongs. Operator, 2026-09-09: "the Marlin has NONE for the
     * barrel but does have a serial for the reciever, make sure its there."
     * `serialsOf` in owned-firearm-sections.ts has read this key since it was
     * written; nothing was ever putting one there.
     */
    'receiver_serial',
    'section',
  ],
  COMPETENCY_CERTIFICATE: [
    'competency_number',
    'holder_name',
    'covers',
    // ⚠️ THE DATE THE WHOLE EXPIRY DERIVATION RUNS ON. A competency card
    // prints an issue date and no expiry, and deriveExpiry needs the issue
    // date for every branch it has — the muzzle-loader ten years, and the
    // no-licence fallback. The vault was not asking for it, so a certificate
    // read here arrived at the motivation (which DOES ask, as
    // `competency_issued`) with nothing to carry. See common/document-fields.
    'competency_issued',
  ],
  // ⚠️ THE UNION OF THE FOUR KINDS THIS REPLACED, because WANTED is both the
  // question and the filter: a key not listed here is never asked for AND is
  // discarded if the model volunteers it. One certificate can carry a status
  // number, a membership number, a good-standing reference and a professional
  // registration, and they are NOT the same number — the operator's SA Hunters
  // pack carries three. Each is named separately so none can be read into
  // another's field and end up as the wrong reference on an application.
  /**
   * ⚠️ WANTED IS BOTH THE QUESTION AND THE FILTER, so the firearm fields have
   * to be here or an endorsement's whole point is discarded on the way back.
   * The document names ONE gun — type, calibre, make, action, serial — and the
   * serial is what joins it to an owned row, which is what finally lets an
   * owned firearm say what it is licensed FOR without the writer guessing.
   *
   * ⚠️ AND BOTH ACCREDITATION NUMBERS. A body accredited for hunting AND for
   * sport prints two, and which one endorsed this firearm is what decides
   * whether the row reads "hunting" or "sport shooting". One field for both is
   * how the operator's sport status came to be filed as DEDICATED_HUNTER.
   */
  ASSOCIATION_ENDORSEMENT: [
    'association',
    'accreditation_number',
    'holder_name',
    'membership_number',
    'status_number',
    'status_type',
    'endorsement_number',
    'firearm_type',
    'calibre',
    'make',
    'action',
    'serial',
    'issued_on',
    'signed_by',
  ],
  DEDICATED_DISCIPLINE: [
    'association',
    'holder_name',
    'status_type',
    'status_number',
    'membership_number',
    'good_standing_number',
    'good_standing',
    'joined_on',
    /**
     * ⚠️ THE DAY THE STATUS WAS AWARDED, WHICH NOTHING WAS READING. The
     * motivation asks `dedicated_since` — "Dedicated status held since" —
     * marked docSourced: 'ASSOCIATION_CARD', which is a promise to the member
     * that the document fills it. Nothing did: the alias table said so out
     * loud ("Nothing in the vault reads a dedicated-since date, so
     * `dedicated_since` is asked of the member") and the member typed it every
     * time. Operator, 2026-09-09: "dedicated status held since, should be
     * retrieved from the certificate."
     *
     * ⚠️ IT IS NOT `joined_on` AND IT IS NOT `issued_on`. You join an
     * association, and later you qualify — for a SAHGCA or NARFO member those
     * are routinely years apart, and `deriveFacts` counts `years_dedicated`
     * from this one, so the wrong date does not merely mislabel a box: it
     * makes the motivation argue from the wrong number. `issued_on` is when
     * THIS piece of paper was printed, which for an annually reissued
     * certificate is this year whatever the status dates from.
     */
    'status_since',
    // Professional Hunter registration, which is NOT dedicated status. Kept
    // readable so the distinction survives on the row instead of being
    // inferred from which pile the document landed in.
    'registration_number',
    'province',
    'category',
  ],
  DEDICATED_STATUS: [
    'status_number',
    'holder_name',
    'association',
    'status_type',
  ],
  DEDICATED_HUNTER: [
    'status_number',
    'holder_name',
    'association',
    'status_type',
  ],
  PROFESSIONAL_HUNTER: [
    'registration_number',
    'holder_name',
    'province',
    'category',
  ],
  // ⚠️ THE NUMBERS ARE NOT THE SAME NUMBER. The operator's SA Hunters letter
  // carries THREE: a good-standing reference (GS00124584), a membership
  // number (108828) and the dedicated status number (SA115153SS). Reading any
  // of them into one field would put the wrong reference on an application,
  // so each is named separately and the model is told which is which.
  GOOD_STANDING: [
    'good_standing_number',
    'holder_name',
    'association',
    'membership_number',
    'status_number',
    'status_type',
  ],
  // ⚠️ scv_number AND issuer ADDED 2026-09-07. The S/C/V number is printed on
  // both sides of a proficiency (the provider's certificate and the PFTC
  // statement behind it) and is what lets the vault file the two as one pair.
  //
  // ⚠️ document_side ADDED 2026-09-08, WITH TEXTRACT REMOVED. Which side this
  // is used to be decided AFTER the read, by grepping Textract's OCR text for
  // "statement of results" — a second Textract call the model path never had
  // a use for on its own, so `read()` used to run Textract a second time even
  // when the MODEL had done the actual read, purely to answer this one
  // question. There is no OCR text left to grep, and no reason to ask twice:
  // Gemini can see the same heading in the same image it is already reading,
  // so this is asked for like any other field and validated in `parse` to be
  // exactly 'front' or 'back'.
  PROFICIENCY: [
    'certificate_number',
    'holder_name',
    'unit_standard',
    'scv_number',
    'issuer',
    'document_side',
  ],
  OTHER: ['reference_number', 'holder_name', 'issuer'],

  // ── THE DOCUMENTS WE KEEP RATHER THAN CHASE ────────────────────────
  //
  // ⚠️ THESE THREE WERE EMPTY UNTIL 2026-08-23, AND IT MADE THEM PERMANENTLY
  // AMBER. Operator: "when some documents like my ID for example are pulled
  // [into the] document centre in the motivation it stays amber, why?"
  //
  // Because WANTED is both the question and the filter — an empty list asks
  // for nothing and discards anything the model volunteers, so extractionOk
  // could never become true — while the MOTIVATION registry declares all three
  // readable (EXTRACTABLE in motivation-extract.service.ts wants full_name +
  // id_number, residential_address + residential_postal_code, employer_name +
  // employer_address). A checklist row is amber on
  // `canExtract(kind) && !extractionOk`, so the two registries between them
  // guaranteed amber forever, on documents that are perfectly legible.
  //
  // They were emptied by association with the safe photographs below, and the
  // reasoning that is sound for a safe does not survive contact with these: an
  // ID card has a name and a number printed on it, a municipal bill has an
  // address, and an employment letter names an employer. They are among the
  // most worth reading in the whole vault, because those six values are the
  // opening fields of every licence application.
  //
  // ⚠️ THE KEY NAMES MUST MATCH THE MOTIVATION REGISTRY EXACTLY. addFromLibrary
  // carries a vault reading across on an exact key-name match with
  // wantedFor(uploadKind); a near-miss here is silently dropped and the amber
  // comes straight back. library-readability.spec.ts pins the agreement.
  // ⚠️ issue_date ADDED 2026-08-28. Operator: "The ID document I just
  // uploaded did not recognize the issue date." It never could: WANTED is both
  // the question put to the model AND the filter applied to its answer, so a
  // key that is not listed here is never asked for and is discarded if the
  // model volunteers it anyway. Nothing was misread — nothing was requested.
  //
  // ⚠️ AND IT MUST NEVER BECOME AN expiresOn. Same rule as the address
  // document below: a confirmed expiry arms the reminder sweep, and an SA ID
  // card does not expire. The CHECK constraint forbids it; this comment is so
  // nobody tries.
  IDENTITY_DOCUMENT: ['full_name', 'id_number', 'issue_date'],
  // ⚠️ IT DOES CARRY A DATE, and the date decides whether a DFO accepts it.
  // But that date must never become an expiresOn — the CHECK constraint
  // forbids it, because a confirmed one would start SMSing AO Pro members
  // about a municipal bill. Freshness is judged at pick time; see reuseCaution.
  // ⚠️ full_name ADDED 2026-09-07, so the vault can check the document is
  // the member's own: a proof of address is anything with an address on it,
  // and a DFO wants one in the applicant's name. See address-proof.ts.
  ADDRESS_CONFIRMATION: ['residential_address', 'residential_postal_code', 'full_name'],
  EMPLOYMENT_CONFIRMATION: ['employer_name', 'employer_address'],
  // ⚠️ EMPTY IS THE ANSWER HERE, AND IT IS LOAD-BEARING. There is nothing
  // printed on a photograph of a gun safe to transcribe, and a vision call
  // would spend money to come back with nothing — then flag the document amber
  // for having found nothing, which is how a member gets told something is
  // wrong with a photograph that is perfectly fine. These kinds are also in
  // NO_VISION_KINDS, so create() skips read() for them entirely, and
  // canExtract is false for what they map to, so they never go amber either.
  SAFE_PHOTOGRAPHS: [],
  // Retired 2026-08-23; entries kept so the map stays exhaustive.
  SAFE_PHOTO_CLOSED: [],
  SAFE_PHOTO_AJAR: [],
  SAFE_PHOTO_BOLTS: [],
  SAFE_INSTALLATION: [],
  SHOOTING_ACTIVITY_LOG: [],
  // ⚠️ EMPTY FOR THE SAME REASON AS THE SAFE PHOTOGRAPHS — but read this
  // twice, because evidence is the case that looks like it should be the
  // exception and is not. There is often text on an evidence item (a
  // permission letter is nothing BUT text) and yet there is no fixed field to
  // read off it: the question is "which container is this", and that is
  // answered by the EVIDENCE CLASSIFIER with the member's own description,
  // not by a field extractor. Asking for fields here would spend a vision
  // call to come back with nothing, and then flag the row amber for having
  // found nothing.
  //
  // ⚠️ isPhotograph('EVIDENCE') IS TRUE AND THAT IS ONLY ABOUT EXTRACTION. It
  // puts this kind in NO_VISION_KINDS so `read()` is skipped — it does NOT
  // mean evidence is never looked at. The classification call is a separate
  // request with a separate purpose ('motivation.evidence.classify'); a future
  // reader who routes evidence through the no-vision path on the strength of
  // isPhotograph alone will silently skip the classifier and leave every item
  // container-less.
  EVIDENCE: [],
};
