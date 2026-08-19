import { MotivationLicenceType } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// What we ask an applicant, per licence type.
//
// THIS IS THE CONTRACT between the form, the interview, the fact pack and the
// quality gate. A field key appears in four places — the wizard renders it, a
// Boet follow-up targets it, the generator reads it, and the gate names it in
// thinFields when the answer is too thin — so it is defined exactly once here.
//
// WHY A REGISTRY AND NOT A FREE-FORM PROMPT. The generator is only allowed to
// arrange facts we already hold; it never invents circumstances for someone's
// firearm application. Registering the fields is what makes that enforceable:
// the fact pack is built from these keys and nothing else.
//
// NOTHING HERE IS PII. These are field DEFINITIONS — keys, labels, prompts.
// The ANSWERS are encrypted (Motivation.answersEncrypted). That split is why
// thinFields and extractedFields can stay queryable in the clear: a key like
// "safe_storage_detail" is metadata, its value is not.
//
// VERSIONED. answersSchemaVersion is stamped on every motivation so a later
// change here can be told from an older blob rather than guessed at. Bump
// FIELD_REGISTRY_VERSION whenever a key is added, removed or re-meant.
// ────────────────────────────────────────────────────────────────────

// Bumped when the SAPS 271 analysis split the firearm into its own boxes and
// added the personal and history fields. Same day as the previous version, so
// it carries a suffix rather than a bare date.
export const FIELD_REGISTRY_VERSION = '2026-08-18.3';

/** The two answers a `yesno` field accepts. Order is deliberate — a wizard
 * should not present "Yes" as the first, easiest tap on a history question. */
export const YES_NO = ['No', 'Yes'] as const;

export type MotivationFieldKind =
  | 'short'
  | 'long'
  | 'date'
  | 'choice'
  | 'multi'
  | 'yesno';

export interface MotivationField {
  key: string;
  label: string;
  kind: MotivationFieldKind;
  /** Section the wizard groups it under. */
  section: string;
  /** Shown under the input. Plain, no legalese. */
  help?: string;
  choices?: readonly string[];
  /** Required to generate at all. Optional fields still improve the document. */
  required?: true;
  /**
   * True when the value is personal enough that it must never be echoed into a
   * log line, an admin list view or an error message. Everything is encrypted
   * at rest; this flags what is sensitive even in transit through our own code.
   */
  sensitive?: true;
  /**
   * Long answers carry the applicant's own voice into the document, so they are
   * NOT run through sanitizePromptValue (which collapses newlines and truncates
   * at 120 chars — it would destroy them). They are delimited and marked as
   * untrusted in the prompt instead. Short scalars are sanitised normally.
   */
  maxLength?: number;
  /**
   * Only asked when another answer has a particular value — spouse details when
   * married, the detail of a conviction when one is disclosed. The wizard hides
   * it, and `missingRequired` does not demand it, until the condition holds.
   */
  showIf?: { key: string; equals: string };
  /**
   * Collected for the SAPS 271 and NEVER put in front of the writer.
   *
   * Two different reasons, both deliberate. Contact numbers, a postal address, a
   * spouse's ID and a serial number are PII that adds nothing to an argument —
   * there is no reason for them to reach a model at all. And the six history
   * questions are marked this way so that a CLEAN record contributes nothing:
   * six "No" answers in the fact pack is an invitation to pad the document with
   * "the applicant has no convictions, no pending cases, no lost firearms",
   * which ABSOLUTE RULE 7 forbids. Where the answer is "Yes" the linked detail
   * field is NOT form-only, so a disclosure — the thing that actually has to be
   * addressed head-on — reaches the writer in full.
   */
  formOnly?: true;
}

/** Asked for every licence type. */
const COMMON_FIELDS: readonly MotivationField[] = [
  {
    key: 'full_name',
    label: 'Full name, as it appears on your ID',
    kind: 'short',
    section: 'About you',
    required: true,
    sensitive: true,
    maxLength: 120,
  },
  {
    key: 'id_number',
    label: 'SA ID number',
    kind: 'short',
    section: 'About you',
    required: true,
    sensitive: true,
    maxLength: 13,
  },
  {
    key: 'residential_address',
    label: 'Residential address',
    kind: 'long',
    section: 'About you',
    help: 'Where the firearm will be kept.',
    required: true,
    sensitive: true,
    maxLength: 400,
  },
  {
    key: 'occupation',
    label: 'Occupation',
    kind: 'short',
    section: 'About you',
    required: true,
    maxLength: 120,
  },
  // ── FOR THE SAPS 271 ────────────────────────────────────────────
  // Date of birth, age, gender and citizenship are NOT here on purpose: the ID
  // number already carries all four (see sa-id.ts). Asking twice is not just
  // redundant, it is a chance for two boxes on the same signed form to
  // disagree — and the applicant is the one who signs it.
  {
    key: 'postal_address',
    label: 'Postal address, if different',
    kind: 'long',
    section: 'About you',
    help: 'Leave blank if post reaches you at the address above.',
    sensitive: true,
    formOnly: true,
    maxLength: 400,
  },
  {
    key: 'residence_type',
    label: 'What kind of home is it',
    kind: 'choice',
    section: 'About you',
    // Free text on the form, whose own examples are "shack, flat, caravan,
    // cottage, house, hostel or homeless" (item 17). A list is better data and
    // a faster tap, so we offer one that covers the form's examples rather than
    // a tidier set that would force people into "Other".
    choices: [
      'House',
      'Townhouse or complex',
      'Flat',
      'Cottage',
      'Smallholding',
      'Farm',
      'Caravan',
      'Shack',
      'Hostel',
      'Other',
    ],
    help: 'The form asks, and it also bears on storage.',
    required: true,
  },
  {
    key: 'home_telephone',
    label: 'Home telephone',
    kind: 'short',
    section: 'About you',
    sensitive: true,
    formOnly: true,
    maxLength: 30,
  },
  {
    key: 'work_telephone',
    label: 'Work telephone',
    kind: 'short',
    section: 'About you',
    sensitive: true,
    formOnly: true,
    maxLength: 30,
  },
  {
    key: 'employer_name',
    label: 'Employer',
    kind: 'short',
    section: 'About you',
    help: 'Leave blank if you are self-employed or not working.',
    maxLength: 160,
  },
  {
    key: 'employer_address',
    label: "Employer's address",
    kind: 'long',
    section: 'About you',
    sensitive: true,
    maxLength: 400,
  },
  {
    key: 'marital_status',
    label: 'Marital status',
    kind: 'choice',
    section: 'About you',
    // The form's boxes are Single / Married / Divorced / Widow / Widower /
    // Other (specify) — it splits widow and widower by gender. We do not make
    // someone pick a gendered word about themselves in a wizard; "Widowed" maps
    // to the right box from the gender the ID number already carries, and falls
    // back to Other where it cannot be told.
    choices: ['Single', 'Married', 'Life partner', 'Divorced', 'Widowed'],
    required: true,
    formOnly: true,
  },
  {
    key: 'spouse_name',
    label: "Spouse or partner's full name",
    kind: 'short',
    section: 'About you',
    showIf: { key: 'marital_status', equals: 'Married' },
    required: true,
    sensitive: true,
    formOnly: true,
    maxLength: 120,
  },
  {
    key: 'spouse_id_number',
    label: "Spouse or partner's ID number",
    kind: 'short',
    section: 'About you',
    showIf: { key: 'marital_status', equals: 'Married' },
    required: true,
    sensitive: true,
    formOnly: true,
    maxLength: 13,
  },
  {
    key: 'competency_number',
    label: 'Competency certificate number',
    kind: 'short',
    section: 'About you',
    help: 'From your competency certificate. Leave blank if the application is still pending.',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'competency_for',
    label: 'What your competency covers',
    kind: 'multi',
    section: 'About you',
    // Item 1.4 lets you mark more than one, and it must match the firearm you
    // are applying for — a handgun application on a rifle-only competency is a
    // refusal waiting to happen, and it is visible on the form.
    choices: ['Handgun', 'Rifle', 'Shotgun'],
    help: 'Tick everything your certificate covers.',
    formOnly: true,
  },
  {
    key: 'competency_issued',
    label: 'Competency issued on',
    kind: 'date',
    section: 'About you',
    formOnly: true,
  },
  {
    key: 'competency_expiry',
    label: 'Competency expires on',
    kind: 'date',
    section: 'About you',
    formOnly: true,
  },
  // THE FIREARM, IN ITS OWN BOXES. This was one free-text line until the SAPS
  // 271 analysis: the form wants type, action, make, model, calibre and serial
  // each in a separate box, and free text cannot fill separate boxes. It also
  // makes the comparison argument sharper — "a .308 bolt-action" is a fact the
  // writer can reason against, "Tikka T3x .308" is a string.
  {
    key: 'firearm_type',
    label: 'Type of firearm',
    kind: 'choice',
    section: 'The firearm',
    // The form's own four, in its own order (SAPS 271 section E, item 1). It
    // also offers "Other, specify (armament/indeterminable design type)", which
    // no private applicant of ours will need.
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    required: true,
  },
  {
    key: 'firearm_action',
    label: 'Action',
    kind: 'choice',
    section: 'The firearm',
    // THE FORM IS COARSER THAN THIS, ON PURPOSE.
    //
    // SAPS 271 item 1.1 offers only Semi-automatic / Automatic / Manual. We ask
    // the finer question because "a bolt-action .308" is something a motivation
    // can actually reason about, where "Manual" is not — and then map back down
    // to the form's three in saps271-form.ts. One question, both consumers.
    //
    // Fully automatic is deliberately absent: it is not licensable to a private
    // person, so it must not be selectable on a form we help someone sign.
    // "Semi-automatic" LEADS the label, because that is the word the SAPS 271
    // itself uses and the word people look for. Operator, 2026-08-19: could not
    // find it, because it was buried behind "Self-loading".
    choices: [
      'Semi-automatic (self-loading)',
      'Bolt action',
      'Lever action',
      'Pump action',
      'Single shot',
      'Revolver',
      'Break action',
    ],
    required: true,
  },
  {
    key: 'firearm_make',
    label: 'Make',
    kind: 'short',
    section: 'The firearm',
    help: 'The manufacturer — Glock, CZ, Tikka, Beretta.',
    required: true,
    maxLength: 60,
  },
  {
    key: 'firearm_model',
    label: 'Model',
    kind: 'short',
    section: 'The firearm',
    required: true,
    maxLength: 60,
  },
  {
    key: 'firearm_calibre',
    label: 'Calibre',
    kind: 'short',
    section: 'The firearm',
    required: true,
    maxLength: 60,
  },
  {
    key: 'firearm_serial',
    label: 'Serial number',
    kind: 'short',
    section: 'The firearm',
    // The 271 has no single "serial number" box. It has barrel (1.7), frame
    // (1.9) and receiver (1.11) serials, each with its own make, because the
    // frame or receiver IS the firearm in law. One serial is what an applicant
    // actually has, so we ask once and place it in the right box for the type.
    help: 'If you already know which firearm it is. Leave blank if not — the dealer fills it in.',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'barrel_length',
    label: 'Barrel length',
    kind: 'short',
    section: 'The firearm',
    help: 'Optional. Only where the discipline or the quarry makes it relevant.',
    maxLength: 40,
  },
  {
    key: 'firearm_fit_reason',
    label: 'Why this particular firearm suits the purpose',
    kind: 'long',
    section: 'The firearm',
    help: 'Calibre, action and configuration against what you actually intend to do with it.',
    required: true,
    maxLength: 2000,
  },
  {
    key: 'safe_storage_detail',
    label: 'How and where it will be stored',
    kind: 'long',
    section: 'Storage and safety',
    help: 'The safe, how it is fixed, where it is, and who else can reach it.',
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  // ── THE SAFE, AS ITEMS 68 AND 69 ASK IT ─────────────────────────
  // safe_storage_detail is prose for the motivation. These are the form's own
  // discrete questions, and the mounting answer is the same fact the third
  // required photograph shows — the bolts fixing it to the wall.
  {
    key: 'safe_present',
    label: 'Do you have the prescribed safe?',
    kind: 'yesno',
    section: 'Storage and safety',
    required: true,
    formOnly: true,
  },
  {
    key: 'safe_type',
    label: 'What kind',
    kind: 'choice',
    section: 'Storage and safety',
    choices: ['Handgun safe', 'Rifle safe', 'Strongroom', 'Other device'],
    showIf: { key: 'safe_present', equals: 'Yes' },
    required: true,
  },
  {
    key: 'safe_mounted',
    label: 'Is it mounted?',
    kind: 'yesno',
    section: 'Storage and safety',
    showIf: { key: 'safe_present', equals: 'Yes' },
    required: true,
    formOnly: true,
  },
  {
    key: 'safe_mounted_to',
    label: 'Mounted to',
    kind: 'choice',
    section: 'Storage and safety',
    choices: ['Wall', 'Floor'],
    showIf: { key: 'safe_mounted', equals: 'Yes' },
    required: true,
  },
  {
    key: 'other_licensed_firearms',
    label: 'Firearms already licensed to you',
    kind: 'long',
    section: 'Storage and safety',
    help: 'Leave blank if this is your first.',
    maxLength: 1000,
  },
  // ── THE SIX HISTORY QUESTIONS, straight off the SAPS 271 ─────────
  //
  // Every one is yes/no with detail if yes, and they are the part of the form
  // applicants most often get wrong. We ask them because a DISCLOSED and
  // EXPLAINED conviction is survivable, while an undisclosed one that surfaces
  // later is fatal — and because it is exactly the kind of thing a motivation
  // should meet head-on rather than leave for the Registrar to discover.
  //
  // The yes/no itself is `formOnly` so a clean record gives the writer nothing
  // to pad with; the DETAIL is not, so a disclosure reaches it in full.
  //
  // None of them defaults to "No". We are not answering a question about
  // someone's criminal record on their behalf, on a form they sign.
  {
    key: 'history_conviction',
    label: 'Have you ever been convicted of an offence, in South Africa or anywhere else?',
    kind: 'yesno',
    section: 'History',
    help: 'Every conviction, however old and however minor, including anything you paid an admission-of-guilt fine for.',
    required: true,
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'history_conviction_detail',
    label: 'Tell us what happened',
    kind: 'long',
    section: 'History',
    help: 'Which offence, which court, what year, and what the outcome was.',
    showIf: { key: 'history_conviction', equals: 'Yes' },
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  {
    key: 'history_pending_case',
    label: 'Is there any case pending against you at the moment?',
    kind: 'yesno',
    section: 'History',
    help: 'Including a case where you have been charged but not yet tried.',
    required: true,
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'history_pending_case_detail',
    label: 'Tell us what happened',
    kind: 'long',
    section: 'History',
    help: 'The charge, the police station and CAS number, and where it stands.',
    showIf: { key: 'history_pending_case', equals: 'Yes' },
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  {
    key: 'history_lost_stolen',
    label: 'Has a firearm of yours ever been lost or stolen?',
    kind: 'yesno',
    section: 'History',
    required: true,
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'history_lost_stolen_detail',
    label: 'Tell us what happened',
    kind: 'long',
    section: 'History',
    help: 'Which firearm, when, where, and the SAPS case number.',
    showIf: { key: 'history_lost_stolen', equals: 'Yes' },
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  {
    key: 'history_negligence',
    label: 'Was a negligence case opened against you over that loss?',
    kind: 'yesno',
    section: 'History',
    required: true,
    sensitive: true,
    formOnly: true,
    showIf: { key: 'history_lost_stolen', equals: 'Yes' },
  },
  {
    key: 'history_negligence_detail',
    label: 'Tell us what happened',
    kind: 'long',
    section: 'History',
    help: 'The case number and what came of it.',
    showIf: { key: 'history_negligence', equals: 'Yes' },
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  {
    key: 'history_declared_unfit',
    label: 'Have you ever been declared unfit to possess a firearm?',
    kind: 'yesno',
    section: 'History',
    help: 'By a court, or by the Registrar under section 102 or 103 of the Act.',
    required: true,
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'history_declared_unfit_detail',
    label: 'Tell us what happened',
    kind: 'long',
    section: 'History',
    help: 'When, on what grounds, and whether the declaration has since lapsed or been set aside.',
    showIf: { key: 'history_declared_unfit', equals: 'Yes' },
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  {
    key: 'history_confiscated',
    label: 'Has a firearm ever been confiscated from you?',
    kind: 'yesno',
    section: 'History',
    required: true,
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'history_confiscated_detail',
    label: 'Tell us what happened',
    kind: 'long',
    section: 'History',
    help: 'Which firearm, by whom, when, and whether it was returned.',
    showIf: { key: 'history_confiscated', equals: 'Yes' },
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  // ── THE BOXES BEHIND EACH "YES" (items 62-67) ───────────────────
  //
  // The form does not want prose here — it wants a police station, a CAS
  // number and a charge in separate boxes, and it gives room for two incidents
  // per question. The prose field above each of these stays, because the two
  // do different jobs: these fill boxes, the prose is what the motivation uses
  // to meet the disclosure head-on.
  //
  // All formOnly. A CAS number in a prompt achieves nothing.
  {
    key: 'history_conviction_station',
    label: 'Police station',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_conviction', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 120,
  },
  {
    key: 'history_conviction_case_number',
    label: 'CAS / case number',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_conviction', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'history_conviction_charge',
    label: 'Charge',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_conviction', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_conviction_outcome',
    label: 'Outcome',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_conviction', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_pending_case_station',
    label: 'Police station',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_pending_case', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 120,
  },
  {
    key: 'history_pending_case_case_number',
    label: 'CAS / case number',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_pending_case', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'history_pending_case_charge',
    label: 'Offence',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_pending_case', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_lost_stolen_station',
    label: 'Police station',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_lost_stolen', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 120,
  },
  {
    key: 'history_lost_stolen_case_number',
    label: 'CAS / case number',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_lost_stolen', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'history_lost_stolen_circumstances',
    label: 'Circumstances',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_lost_stolen', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_lost_stolen_firearm',
    label: 'Details of the firearm',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_lost_stolen', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_negligence_station',
    label: 'Police station',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_negligence', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 120,
  },
  {
    key: 'history_negligence_case_number',
    label: 'CAS / case number',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_negligence', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'history_negligence_charge',
    label: 'Charge',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_negligence', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_negligence_outcome',
    label: 'Outcome',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_negligence', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_declared_unfit_station',
    label: 'Police station',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_declared_unfit', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 120,
  },
  {
    key: 'history_declared_unfit_case_number',
    label: 'CAS / case number',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_declared_unfit', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'history_declared_unfit_charge',
    label: 'Charge',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_declared_unfit', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_declared_unfit_period',
    label: 'Period, and the date it ran from',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_declared_unfit', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_confiscated_station',
    label: 'Police station',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_confiscated', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 120,
  },
  {
    key: 'history_confiscated_case_number',
    label: 'CAS / case number',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_confiscated', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'history_confiscated_circumstances',
    label: 'Circumstances',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_confiscated', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  {
    key: 'history_confiscated_outcome',
    label: 'Outcome',
    kind: 'short',
    section: 'History',
    showIf: { key: 'history_confiscated', equals: 'Yes' },
    sensitive: true,
    formOnly: true,
    maxLength: 200,
  },
  // ── FIREARMS ALREADY LICENSED TO THE APPLICANT (SAPS 271 item 2.1) ─
  //
  // other_licensed_firearms above is prose, and prose is right for the
  // motivation. These are the form's own six columns, and they exist for a
  // second reason that matters more: THE OVERLAP CHECK READS THEM.
  //
  // "I already have a .308" cannot be answered from free text, and it is the
  // question that gets a second medium-game rifle refused — see
  // motivation-overlap.ts. A structured calibre is what lets us raise the
  // objection before the Registrar does.
  //
  // Six rows. The form has fourteen; almost nobody holds six, and an applicant
  // with more can write the remainder in by hand rather than have us guess at
  // a limit and silently drop the seventh.
  {
    key: 'existing_firearm_1_type',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'existing_firearm_1_calibre',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    help: 'Exactly as it appears on the licence.',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_make',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_barrel_serial',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_frame_serial',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_licence_no',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_type',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'existing_firearm_2_calibre',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_make',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_barrel_serial',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_frame_serial',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_licence_no',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_type',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'existing_firearm_3_calibre',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_make',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_barrel_serial',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_frame_serial',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_licence_no',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_type',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'existing_firearm_4_calibre',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_make',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_barrel_serial',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_frame_serial',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_licence_no',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_type',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'existing_firearm_5_calibre',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_make',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_barrel_serial',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_frame_serial',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_licence_no',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_type',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
    formOnly: true,
  },
  {
    key: 'existing_firearm_6_calibre',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_make',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_barrel_serial',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_frame_serial',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_licence_no',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'overlap_justification',
    label: 'Why you need this one as well',
    kind: 'long',
    section: 'Firearms you already own',
    // Becomes REQUIRED only when the overlap check finds a firearm in the same
    // class. Not a showIf, because the condition is computed rather than
    // answered — the service adds it to the outstanding list.
    help: 'What does this firearm do that the one you already own cannot? Be specific and practical — ranges, terrain, quarry, discipline, or what the other one is committed to.',
    maxLength: 2000,
  },

  // ── the rest of what the SAPS 271 asks and we did not collect ─────
  {
    key: 'residential_postal_code',
    label: 'Postal code',
    kind: 'short',
    section: 'About you',
    sensitive: true,
    formOnly: true,
    maxLength: 4,
  },
  {
    key: 'postal_postal_code',
    label: 'Postal code for the postal address',
    kind: 'short',
    section: 'About you',
    // No showIf. It would have to mean "when postal_address is not empty", and
    // showIf tests equality against a fixed value — there is no "is answered"
    // condition, and faking one with equals:'' says the opposite. The wizard
    // hides this next to a blank address without the registry modelling it.
    sensitive: true,
    formOnly: true,
    maxLength: 4,
  },
  {
    key: 'employer_postal_code',
    label: "Postal code for the employer's address",
    kind: 'short',
    section: 'About you',
    sensitive: true,
    formOnly: true,
    maxLength: 4,
  },
  {
    key: 'home_dialling_code',
    label: 'Home dialling code',
    kind: 'short',
    section: 'About you',
    sensitive: true,
    formOnly: true,
    maxLength: 4,
  },
  {
    key: 'work_dialling_code',
    label: 'Work dialling code',
    kind: 'short',
    section: 'About you',
    sensitive: true,
    formOnly: true,
    maxLength: 4,
  },
  {
    key: 'cellphone',
    label: 'Cellphone number',
    kind: 'short',
    section: 'About you',
    help: 'Prefilled from your account — change it here if the form should show a different number.',
    sensitive: true,
    formOnly: true,
    maxLength: 20,
  },
  {
    key: 'licence_holder_type',
    label: 'Are you the main licence holder, or an additional one?',
    kind: 'choice',
    section: 'The firearm',
    choices: ['Main firearm licence holder', 'Additional firearm licence holder'],
    help: 'Additional applies where the firearm is licensed to someone else in the household and you are applying to possess it too.',
    formOnly: true,
  },
  {
    key: 'spouse_id_type',
    label: 'What your spouse or partner is identified by',
    kind: 'choice',
    section: 'About you',
    choices: ['SA ID', 'Passport'],
    showIf: { key: 'marital_status', equals: 'Married' },
    formOnly: true,
  },
  {
    key: 'spouse_passport_number',
    label: "Spouse or partner's passport number",
    kind: 'short',
    section: 'About you',
    showIf: { key: 'spouse_id_type', equals: 'Passport' },
    sensitive: true,
    formOnly: true,
    maxLength: 20,
  },
  {
    key: 'prior_refusals',
    label: 'Previous applications refused, or licences cancelled',
    kind: 'long',
    section: 'History',
    help: 'Say so plainly if it has happened, with the reason given. Concealing it is far worse than explaining it.',
    maxLength: 2000,
  },
];

/** Extra fields per licence type, appended to the common set. */
const TYPE_FIELDS: Record<MotivationLicenceType, readonly MotivationField[]> = {
  S13_SELF_DEFENCE: [
    {
      key: 'threat_circumstances',
      label: 'The circumstances that make you believe you need it',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Specific to you and where you live or work — times, places, incidents, routes. General crime statistics carry no weight on their own.',
      required: true,
      sensitive: true,
      maxLength: 4000,
    },
    {
      key: 'daily_movements',
      label: 'Your routine — where you go and when',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Travel at night, cash handling, isolated premises, long rural commutes.',
      required: true,
      sensitive: true,
      maxLength: 2000,
    },
    {
      key: 'alternatives_considered',
      label: 'What else you have done about it',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Alarms, armed response, changed routines, relocation. Shows a firearm is not the first thing you reached for.',
      maxLength: 2000,
    },
  ],
  S15_OCCASIONAL_HUNTER: [
    {
      key: 'hunting_history',
      label: 'Your hunting experience',
      kind: 'long',
      section: 'Experience',
      help: 'How long, where, what species, roughly how often.',
      required: true,
      maxLength: 3000,
    },
    {
      key: 'intended_quarry',
      label: 'What you intend to hunt with it',
      kind: 'short',
      section: 'Experience',
      required: true,
      maxLength: 200,
    },
    {
      key: 'hunting_locations',
      label: 'Where you hunt',
      kind: 'long',
      section: 'Experience',
      help: 'Properties, provinces, whether by invitation or as a paying guest.',
      maxLength: 1500,
    },
  ],
  S16_DEDICATED_HUNTER: [
    {
      key: 'association_name',
      label: 'Your hunting association',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      maxLength: 160,
    },
    {
      key: 'association_number',
      label: 'Membership number',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'dedicated_since',
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
    },
    {
      key: 'hunting_history',
      label: 'Your hunting record',
      kind: 'long',
      section: 'Experience',
      help: 'Species, terrain, ranges, roughly how many hunts a year.',
      required: true,
      maxLength: 3000,
    },
    {
      key: 'activity_record',
      label: 'Association activities in the last 24 months',
      kind: 'long',
      section: 'Experience',
      help: 'Hunts logged, shoots attended, courses, committee roles.',
      maxLength: 2000,
    },
  ],
  S16_DEDICATED_SPORT: [
    {
      key: 'association_name',
      label: 'Your sport-shooting association',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      maxLength: 160,
    },
    {
      key: 'association_number',
      label: 'Membership number',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'dedicated_since',
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
    },
    {
      key: 'discipline',
      label: 'The discipline you shoot',
      kind: 'short',
      section: 'Experience',
      help: 'Practical, precision, clay, service rifle, and so on.',
      required: true,
      maxLength: 160,
    },
    {
      key: 'competition_record',
      label: 'Competitions and range attendance',
      kind: 'long',
      section: 'Experience',
      help: 'Matches shot in the last two years, classifications, results if relevant.',
      required: true,
      maxLength: 3000,
    },
    {
      key: 'discipline_requirement',
      label: 'What the discipline requires of the firearm',
      kind: 'long',
      section: 'Experience',
      help: 'Where the rules constrain calibre, barrel, sights or capacity.',
      maxLength: 2000,
    },
  ],
  S24_RENEWAL: [
    {
      key: 'existing_licence_number',
      label: 'The licence being renewed',
      kind: 'short',
      section: 'The existing licence',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'licence_expiry',
      label: 'Expiry date',
      kind: 'date',
      section: 'The existing licence',
      required: true,
    },
    {
      key: 'continued_use',
      label: 'How you have used it, and why that continues',
      kind: 'long',
      section: 'The existing licence',
      help: 'The purpose has not changed — say what you have actually done with it since it was issued.',
      required: true,
      maxLength: 3000,
    },
  ],
};

/** Human label for the document header and the UI. */
export const LICENCE_TYPE_LABELS: Record<MotivationLicenceType, string> = {
  S13_SELF_DEFENCE: 'Section 13 — Self-defence',
  S15_OCCASIONAL_HUNTER: 'Section 15 — Occasional hunter / sport shooter',
  S16_DEDICATED_HUNTER: 'Section 16 — Dedicated hunter',
  S16_DEDICATED_SPORT: 'Section 16 — Dedicated sport shooter',
  S24_RENEWAL: 'Section 24 — Renewal',
};

/** Every field for a licence type, common first, in wizard order. */
export function fieldsFor(
  type: MotivationLicenceType,
): readonly MotivationField[] {
  return [...COMMON_FIELDS, ...(TYPE_FIELDS[type] ?? [])];
}

/** Fast lookup by key, for merging an interview answer back into the blob. */
export function fieldByKey(
  type: MotivationLicenceType,
  key: string,
): MotivationField | undefined {
  return fieldsFor(type).find((f) => f.key === key);
}

/**
 * Is this field asked at all, given what has been answered so far?
 *
 * A conditional field that is not showing is not "unanswered" — it does not
 * apply. Spouse details on a single applicant and the detail of a conviction on
 * someone with no convictions must never appear as outstanding work.
 */
export function isVisible(
  field: MotivationField,
  answers: Record<string, string>,
): boolean {
  if (!field.showIf) return true;
  return (answers[field.showIf.key] ?? '').trim() === field.showIf.equals;
}

/**
 * Keys that must be answered before a document can be generated.
 *
 * Conditional fields count only when their condition holds, so pass the answers
 * where you have them. Without them the unconditional set is returned — which
 * is what the wizard wants for a progress denominator at the very start.
 */
export function requiredKeys(
  type: MotivationLicenceType,
  answers: Record<string, string> = {},
): string[] {
  return fieldsFor(type)
    .filter((f) => f.required && isVisible(f, answers))
    .map((f) => f.key);
}

/**
 * The fields the WRITER is allowed to see.
 *
 * Everything marked `formOnly` is stripped: contact details and a spouse's ID
 * are PII with no argumentative value, and a clean history is six "No" answers
 * that would only invite padding. See `formOnly` on MotivationField.
 */
export function factPackFields(
  type: MotivationLicenceType,
): readonly MotivationField[] {
  return fieldsFor(type).filter((f) => !f.formOnly);
}

/**
 * Drop anything that is not a registered field for this licence type, trim
 * strings, and enforce per-field length caps.
 *
 * Called on EVERY write. Two reasons: an unregistered key would sit in the
 * encrypted blob forever without the generator or the gate ever knowing what
 * to do with it, and an unbounded string is both a storage and a token-cost
 * problem. Returns the clean patch plus what it rejected, so the caller can
 * tell the difference between "saved nothing" and "saved everything".
 */
export function sanitiseAnswers(
  type: MotivationLicenceType,
  patch: Record<string, unknown>,
): { answers: Record<string, string>; rejected: string[] } {
  const answers: Record<string, string> = {};
  const rejected: string[] = [];

  for (const [key, raw] of Object.entries(patch ?? {})) {
    const field = fieldByKey(type, key);
    if (!field) {
      rejected.push(key);
      continue;
    }
    if (raw === null || raw === undefined) {
      // An explicit clear is a legitimate edit — the applicant deleting
      // something they had typed.
      answers[key] = '';
      continue;
    }
    if (typeof raw !== 'string') {
      rejected.push(key);
      continue;
    }
    const trimmed = raw.trim();

    // A choice must be one of the offered choices. This is not defensive
    // tidiness: these values are printed into boxes on a form the applicant
    // signs, so an arbitrary string arriving from a hand-rolled request would
    // become a false statement on a firearm licence application.
    if (field.kind === 'multi') {
      // Stored comma-joined. Every part must be a real choice, and the order is
      // normalised to the offered order so two identical answers compare equal.
      const allowed = field.choices ?? [];
      const parts = trimmed
        ? trimmed.split(',').map((x) => x.trim()).filter(Boolean)
        : [];
      if (parts.some((x) => !allowed.includes(x))) {
        rejected.push(key);
        continue;
      }
      answers[key] = allowed.filter((c) => parts.includes(c)).join(', ');
      continue;
    }

    if (field.kind === 'choice' || field.kind === 'yesno') {
      const allowed = field.choices ?? YES_NO;
      if (trimmed && !allowed.includes(trimmed)) {
        rejected.push(key);
        continue;
      }
      answers[key] = trimmed;
      continue;
    }

    const cap = field.maxLength ?? 2000;
    answers[key] = trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
  }

  return { answers, rejected };
}

/**
 * Which required fields are still empty. Drives both "can this generate yet"
 * and the wizard's progress display.
 */
export function missingRequired(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): string[] {
  return requiredKeys(type, answers).filter((k) => !(answers[k] ?? '').trim());
}
