import { MotivationLicenceType } from '@prisma/client';
import {
  DISCIPLINE_OTHER,
  disciplinesInScope,
} from './shooting-disciplines';
import { ENDORSEMENT_LABELS } from '../common/sa-competency';

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
export const FIELD_REGISTRY_VERSION = '2026-08-19';

// ── THE SAPS 271 IS AN OPT-IN EXTRA, NOT THE PRODUCT ────────────────
//
// Operator, 2026-08-19: "the 271 form is an addition. The motivation is the
// big cookie we need to have perfect. The user must have the option not to
// have the 271 filled in — most of the time the dealer will fill in the form
// for them already."
//
// So one early question decides it, and EVERY formOnly field hangs off the
// answer. Say the dealer is doing the form and roughly half the registry
// simply never appears: phones, postal codes, marital status, the spouse, the
// firearms-owned table, the six history questions. The motivation path
// collapses to the ~15 answers the document actually needs.
//
// The values survive a change of heart: switching to the dealer path hides
// the fields but never deletes what was typed, and switching back restores
// them filled.
/**
 * Where the firearm is coming from.
 *
 * ⚠️ THE ANSWER CHANGES WHICH DOCUMENTS THE PACK NEEDS, which is the whole
 * reason it is asked. A club checklist bound into a real submitted Section 16
 * pack comes in two versions, identical except here: the dealer route wants
 * the dealer's paperwork, and the private route wants three more documents —
 * the current owner's ID copy, a copy of their firearm licence, and a signed
 * consent letter. Until this field existed nothing could branch, so every
 * applicant was shown one list and the private-transfer half of them were
 * quietly short two documents on the day.
 *
 * The writer must never see it: "the applicant is buying from a dealer" is
 * not an argument for needing a firearm, and a model handed it will find a way
 * to pad with it. That is NEVER_PROMPTED's job, not formOnly's — formOnly
 * would also hide the question from everyone whose dealer fills the SAPS 271,
 * who are exactly the people buying from a dealer.
 */
export const FIREARM_SOURCE_KEY = 'firearm_source';
export const SOURCE_DEALER = 'From a dealer';
export const SOURCE_PRIVATE = 'From a private owner';
export const SOURCE_UNDECIDED = 'Not decided yet';

export const SAPS271_OPT_KEY = 'fill_saps271';
export const SAPS271_FILL = 'Fill it in for me';
export const SAPS271_DEALER = 'My dealer will fill it in';

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
  /**
   * The options come from a data module rather than from `choices`.
   *
   * A list of fifty-nine shooting disciplines, each with a paragraph of
   * equipment rules, does not belong inline in a field registry. The registry
   * names the source; motivation-field-options.ts attaches the list on the way
   * out to the wizard.
   */
  optionSource?: 'shooting-disciplines';
  /** Narrows optionSource. 'hunting' drops the pure sport-shooting entries. */
  optionScope?: 'hunting' | 'all';
  /**
   * Choosing an option SEEDS this other field with text belonging to that
   * option.
   *
   * ⚠️ SEEDS, NEVER OVERWRITES. The target is a long-form box the applicant
   * signs their name under; a prefill that clobbered what they had written
   * would be the never-move-a-field rule with the stakes raised.
   */
  prefills?: string;
  /**
   * Offer "Something else", which reveals `${key}_other` for free text.
   */
  allowOther?: true;
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
  /**
   * `date` fields only — where the three-step picker opens its decade page,
   * in years from today.
   *
   * NOT INFERRED. A competency issued two years ago, a dedicated status held
   * for ten and a section 24 renewal lodged this year are three different
   * places on the calendar, and a heuristic that gets one wrong costs an
   * applicant several taps on the very first screen they see. Each field says
   * for itself.
   */
  focusOffsetYears?: number;
  /**
   * 'far' puts a decade strip above the years, for a field that genuinely
   * reaches back — somebody dedicated since the nineties should not tap an
   * arrow three times to get there.
   */
  reach?: 'near' | 'far';
  /**
   * A DOCUMENT ANSWERS THIS, so stop asking it as a question.
   *
   * Operator, 2026-08-19: "remove all the fields that we can get the
   * information off the uploaded documents." The value names the upload kind
   * that carries it, which is also what the wizard shows when it explains
   * where a value came from.
   *
   * The rule is deliberately about the ANSWER, not the upload: a docSourced
   * field with a value moves into the "from your documents" review card, where
   * it stays visible and editable; a docSourced field with NO value is asked as
   * an ordinary question. So a failed extraction, an unreadable photograph or a
   * document nobody has is never a dead end — it is just typing, exactly as
   * before.
   *
   * ⚠️ This changes PRESENTATION ONLY. `required`, `requiredKeys` and
   * `missingRequired` are untouched: a required docSourced field with no value
   * still blocks generation, and still gets asked.
   */
  docSourced?: string;
}

/** Asked for every licence type. */
const COMMON_FIELDS: readonly MotivationField[] = [
  {
    // First on purpose: the answer decides whether half the registry exists.
    // Required, because it is one tap and an accidental default is worse than
    // a deliberate choice in either direction. formOnly so the writer never
    // sees it — "the applicant chose to have the form filled" is padding fuel.
    key: SAPS271_OPT_KEY,
    label: 'Should we fill in your SAPS 271 application form as well?',
    kind: 'choice',
    section: 'The SAPS 271 form',
    choices: [SAPS271_DEALER, SAPS271_FILL],
    help: 'Most dealers complete the SAPS 271 with you when you buy the firearm. If yours will, choose that and we prepare only the motivation pack — far fewer questions. You can change your mind at any time.',
    required: true,
    formOnly: true,
  },
  {
    key: 'full_name',
    docSourced: 'IDENTITY_DOCUMENT',
    label: 'Full name, as it appears on your ID',
    kind: 'short',
    section: 'About you',
    required: true,
    sensitive: true,
    maxLength: 120,
  },
  {
    key: 'id_number',
    docSourced: 'IDENTITY_DOCUMENT',
    label: 'SA ID number',
    kind: 'short',
    section: 'About you',
    required: true,
    sensitive: true,
    maxLength: 13,
  },
  {
    key: 'residential_address',
    docSourced: 'ADDRESS_CONFIRMATION',
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
    docSourced: 'EMPLOYMENT_CONFIRMATION',
    label: 'Employer',
    kind: 'short',
    section: 'About you',
    help: 'Leave blank if you are self-employed or not working.',
    maxLength: 160,
  },
  {
    key: 'employer_address',
    docSourced: 'EMPLOYMENT_CONFIRMATION',
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
    // Chained to the ID-type question, NOT to being married: a married
    // applicant whose spouse holds a passport was previously required to
    // produce an SA ID number that does not exist, which blocked generation.
    showIf: { key: 'spouse_id_type', equals: 'SA ID' },
    required: true,
    sensitive: true,
    formOnly: true,
    maxLength: 13,
  },
  {
    // A COMPETENCY CAN NEVER BE PENDING.
    //
    // Operator, 2026-08-19: "when applying for a licence a competency can't be
    // pending. The user already has to have the certificate." This field used
    // to say "leave blank if the application is still pending", which was my
    // invention and described an application SAPS will not accept.
    //
    // REQUIRED is how possession is enforced, and it is enforced HERE rather
    // than on the upload, because the number exists nowhere except on the
    // certificate itself. Someone holding the certificate reads it off in
    // seconds — or uploads it and confirms what we read. Someone who does not
    // hold one cannot invent it.
    key: 'competency_number',
    docSourced: 'COMPETENCY_CERTIFICATE',
    label: 'Competency certificate number',
    kind: 'short',
    section: 'About you',
    // ⚠’️ THE DEAD END NEEDED AN ONWARD PATH, NOT JUST A GATE. This field is
    // required, so an applicant without a certificate hits an unfillable box
    // and stops — and the old help text told them why they were stuck without
    // telling them what to do about it.
    //
    // Competency is a SEPARATE, EARLIER application to the same DFO: training
    // with an accredited provider or the PFTC, its own form, fingerprints
    // taken by the DFO, its own fee, and a wait measured in months. Section
    // 6(2) is why no licence can issue before it is granted.
    //
    // Do not name a waiting period in months as a fact — it varies by
    // province and by year, and a number here would be quoted back to us.
    help: 'As printed on your competency certificate. You need the certificate in hand — SAPS will not take a licence application while competency is still being applied for. If you have not applied for competency yet, that is a separate, earlier application to the same DFO: you complete the prescribed training with an accredited provider or the PFTC, lodge the competency form, have your fingerprints taken at the station and pay its own fee. Section 6(2) of the Act is why the licence cannot be issued until competency has been granted. Come back to this once the certificate is in your hand.',
    required: true,
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'competency_for',
    docSourced: 'COMPETENCY_CERTIFICATE',
    label: 'What your competency covers',
    kind: 'multi',
    section: 'About you',
    // Item 1.4 lets you mark more than one, and it must match the firearm you
    // are applying for — a handgun application on a rifle-only competency is a
    // refusal waiting to happen, and it is visible on the form.
    //
    // ⚠️ ACTION AND TYPE, NOT TYPE ALONE. This was ['Handgun','Rifle','Shotgun']
    // and that is not what SAPS endorses: competency is granted per firearm
    // type AND action (SA Firearm Competency Reference §2.1), which is why a
    // certificate reads "S/L-RIFLE/CARB" rather than "Rifle". The distinction
    // decides what may be licensed under which section — §7.1: a self-loading
    // rifle cannot go under s13 or s15 at all, while a self-loading SHOTGUN
    // can go under s13. "Rifle" alone cannot express any of that, so an
    // applicant ticking it learned nothing and neither did the writer.
    choices: [...ENDORSEMENT_LABELS],
    help: 'Tick everything your certificate covers. Photograph the certificate and we will read it for you.',
    // ⚠️ formOnly REMOVED. It meant the writer never saw what the competency
    // covers — so it could not write "I was declared competent to possess
    // handguns, rifles and shotguns", which is the sentence every example
    // motivation in the corpus carries. We held the fact and hid it.
  },
  {
    key: 'competency_issued',
    docSourced: 'COMPETENCY_CERTIFICATE',
    label: 'Competency issued on',
    kind: 'date',
    section: 'About you',
    // ⚠️ formOnly REMOVED — see competency_for. The date belongs in the
    // sentence, not only in a box on the 271.
    focusOffsetYears: -2,
  },
  {
    key: 'competency_expiry',
    // ⚠️ docSourced REMOVED, AND THIS IS THE IMPORTANT PART: A COMPETENCY
    // CERTIFICATE HAS NO EXPIRY DATE PRINTED ON IT. SA Firearm Competency
    // Reference §5.2 and §8 — the card carries an issue date and the endorsed
    // types, nothing more, and §9 says any guidance telling somebody to "check
    // the expiry on your card" is wrong. Marking it doc-sourced put it in the
    // "from your documents" review card as though we had read it off the
    // certificate, which we cannot have.
    //
    // The real expiry is DERIVED per firearm type as the latest expiry among
    // the licences held in that type, rolling forward whenever one is granted
    // or renewed (§5.3), falling back to five years from issue only where the
    // category holds no licence. See common/sa-competency deriveExpiry.
    label: 'Competency expires on',
    kind: 'date',
    section: 'About you',
    help: 'Your certificate does not print this. It follows your longest-running licence in the same firearm type — leave it blank if you are not sure.',
    // ⚠️ formOnly REMOVED — see competency_for. A competency with years left
    // on it is worth saying; one close to expiry is worth the writer knowing
    // about rather than walking into.
    focusOffsetYears: 2,
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
    // ⚠️ NOT REQUIRED, AND "Not decided yet" IS A REAL ANSWER. Plenty of
    // applications are written before the firearm is found — the motivation is
    // what a dealer or a seller is shown. Forcing a choice would make somebody
    // guess, and a guess here silently changes their document list. Undecided
    // gets both routes described and neither demanded.
    key: FIREARM_SOURCE_KEY,
    label: 'Where is this firearm coming from?',
    kind: 'choice',
    section: 'The firearm',
    choices: [SOURCE_DEALER, SOURCE_PRIVATE, SOURCE_UNDECIDED],
    help: 'A dealer sale and a private transfer need different paperwork at the counter. Telling us which lets us ask for the right documents instead of all of them.',
    // ⚠️ NOT formOnly, DELIBERATELY, AND IT IS THE WHOLE POINT. formOnly hangs
    // a field off the SAPS 271 opt-in, so a member whose dealer fills the form
    // would never be asked — and they are the ones most likely to be buying
    // from that dealer. The document checklist is needed on BOTH paths.
    // Withholding it from the writer is NEVER_PROMPTED's job instead; see the
    // note there about the two jobs formOnly used to do at once.
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
  // discrete questions, and the mounting answer is the same fact the anchoring
  // photograph shows — the bolts fixing it to the wall or floor. That shot goes
  // in under SAFE_PHOTOGRAPHS with the rest; it stopped being its own upload
  // kind on 2026-08-23.
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
  //
  // ⚠️ THESE ARE NOT formOnly, THOUGH THEY LOOK LIKE IT — and they were.
  // They do fill boxes on the SAPS 271, but motivation-overlap.ts reads the
  // calibre, make and type off them and its verdict is rendered straight into
  // the writer's prompt. "Does this applicant already hold something that
  // does this job" is the question that gets a second medium-game rifle
  // refused, and the Registrar asks it whether or not we filled the form in.
  //
  // Marked formOnly, the whole section vanished on the dealer path: an
  // applicant whose dealer completes the 271 was never asked what he already
  // owns, the overlap note came out empty, and the document could not answer
  // the objection. The quality gate then marked it down for that very gap.
  // Seen live on MO000017.
  {
    key: 'existing_firearm_1_type',
    docSourced: 'CURRENT_LICENCE',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
  },
  {
    key: 'existing_firearm_1_calibre',
    docSourced: 'CURRENT_LICENCE',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    help: 'Exactly as it appears on the licence.',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_make',
    docSourced: 'CURRENT_LICENCE',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_use',
    // ⚠️ NOT docSourced, AND IT NEVER CAN BE. A licence copy carries make,
    // calibre and serial; nothing on it says what the firearm is used for.
    // This is the one fact in the block that has to come from the person.
    //
    // ⚠️ AND IT IS THE FACT THE WHOLE COMPARISON RESTS ON. The writer is told
    // to argue, per firearm, why the one already held cannot do this job —
    // and until now it saw only type, calibre and make. "A .308 bolt-action"
    // cannot be argued against a purpose; "bushveld plains game to 250 m" can.
    // Demanding the paragraph without supplying this would have aimed pure
    // invention pressure at rule 1, which is the trap this field exists to
    // close.
    //
    // ⚠️ RULE 8 PUTS IT HERE RATHER THAN IN THE WRITER'S HANDS. What somebody
    // USES a firearm for is history — verifiable, checkable, theirs. The
    // DISTINCTION between two firearms is rationale and stays the writer's
    // job (see ARGUE_IT). Those are different things and only the second may
    // be inferred.
    //
    // Optional, and never a follow-up question. It sits in the form beside a
    // row we have usually already read off an uploaded licence, so somebody
    // who has uploaded nothing never sees it. Two words are enough.
    label: 'What you use it for',
    kind: 'short',
    section: 'Firearms you already own',
    help: 'A few words is plenty — "bushveld plains game", "clay targets", "carried for self-defence".',
    maxLength: 120,
  },
  {
    key: 'existing_firearm_1_barrel_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_frame_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_1_licence_no',
    docSourced: 'CURRENT_LICENCE',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_type',
    docSourced: 'CURRENT_LICENCE',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
  },
  {
    key: 'existing_firearm_2_calibre',
    docSourced: 'CURRENT_LICENCE',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_make',
    docSourced: 'CURRENT_LICENCE',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_use',
    label: 'What you use it for',
    kind: 'short',
    section: 'Firearms you already own',
    maxLength: 120,
  },
  {
    key: 'existing_firearm_2_barrel_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_frame_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_2_licence_no',
    docSourced: 'CURRENT_LICENCE',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_type',
    docSourced: 'CURRENT_LICENCE',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
  },
  {
    key: 'existing_firearm_3_calibre',
    docSourced: 'CURRENT_LICENCE',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_make',
    docSourced: 'CURRENT_LICENCE',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_use',
    label: 'What you use it for',
    kind: 'short',
    section: 'Firearms you already own',
    maxLength: 120,
  },
  {
    key: 'existing_firearm_3_barrel_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_frame_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_3_licence_no',
    docSourced: 'CURRENT_LICENCE',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_type',
    docSourced: 'CURRENT_LICENCE',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
  },
  {
    key: 'existing_firearm_4_calibre',
    docSourced: 'CURRENT_LICENCE',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_make',
    docSourced: 'CURRENT_LICENCE',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_use',
    label: 'What you use it for',
    kind: 'short',
    section: 'Firearms you already own',
    maxLength: 120,
  },
  {
    key: 'existing_firearm_4_barrel_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_frame_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_4_licence_no',
    docSourced: 'CURRENT_LICENCE',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_type',
    docSourced: 'CURRENT_LICENCE',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
  },
  {
    key: 'existing_firearm_5_calibre',
    docSourced: 'CURRENT_LICENCE',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_make',
    docSourced: 'CURRENT_LICENCE',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_use',
    label: 'What you use it for',
    kind: 'short',
    section: 'Firearms you already own',
    maxLength: 120,
  },
  {
    key: 'existing_firearm_5_barrel_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_frame_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_5_licence_no',
    docSourced: 'CURRENT_LICENCE',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_type',
    docSourced: 'CURRENT_LICENCE',
    label: 'Type',
    kind: 'choice',
    section: 'Firearms you already own',
    choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
    sensitive: true,
  },
  {
    key: 'existing_firearm_6_calibre',
    docSourced: 'CURRENT_LICENCE',
    label: 'Calibre',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_make',
    docSourced: 'CURRENT_LICENCE',
    label: 'Make',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_use',
    label: 'What you use it for',
    kind: 'short',
    section: 'Firearms you already own',
    maxLength: 120,
  },
  {
    key: 'existing_firearm_6_barrel_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Barrel serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_frame_serial',
    docSourced: 'CURRENT_LICENCE',
    label: 'Frame / receiver serial no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'existing_firearm_6_licence_no',
    docSourced: 'CURRENT_LICENCE',
    label: 'Licence or permit no',
    kind: 'short',
    section: 'Firearms you already own',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'overlap_justification',
    label: 'Anything you want us to lead with (optional)',
    kind: 'long',
    section: 'Firearms you already own',
    // ⚠️ OFFERED, NEVER DEMANDED — and it used to be demanded. It was shown
    // only when the overlap check fired, and if it was left empty the gate
    // queued it as a follow-up question. Operator, 2026-08-22: "Questions like
    // this should not be asked unless there is critical information needed
    // that would compromise the motivation. It is the job of the AI to do
    // research as to why the applicant would need this firearm and justify it
    // for them."
    //
    // So the writer now argues the comparison itself, out of facts already in
    // the pack (see ARGUE_IT in motivation-overlap.ts), and this box exists
    // only for an applicant who has a reason of their own that beats any
    // inference. Never required, never a question.
    help: 'We argue this for you from the rest of your application. If there is a reason of your own — what this one does that the other cannot, in ranges, terrain, quarry or discipline — put it here and your motivation will lead with it.',
    maxLength: 2000,
  },

  // ── the rest of what the SAPS 271 asks and we did not collect ─────
  {
    key: 'residential_postal_code',
    docSourced: 'ADDRESS_CONFIRMATION',
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
    // Required, because the ID-number and passport-number fields both hang off
    // this answer. Optional here would let a married applicant skip it and the
    // form would silently carry no spouse identification at all.
    required: true,
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
    docSourced: 'ASSOCIATION_CARD',
      label: 'Your hunting association',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      maxLength: 160,
    },
    {
      key: 'association_number',
    docSourced: 'ASSOCIATION_CARD',
      label: 'Membership number',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'dedicated_since',
    docSourced: 'ASSOCIATION_CARD',
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
      // A long-standing SAHGCA or NARFO member may have been dedicated since
      // the nineties, so this one gets the decade strip.
      focusOffsetYears: -10,
      reach: 'far',
    },
    // ── association 2 ─────────────────────────────────────────────
    //
    // ⚠️ SEVERAL ASSOCIATIONS IS THE NORMAL CASE, NOT AN EDGE CASE. The
    // professional motivations we studied list three, each "a member in good
    // standing with X since DATE, membership number Y", and the trade's own
    // intake questionnaire has columns for five. One association made a
    // multi-body shooter's motivation understate the very thing a section 16
    // reviewer weighs. Optional, and the wizard hides the empty rows behind
    // "add another association" — operator, 2026-08-20 — so the single-body
    // applicant never sees them.
    {
      key: 'association_2_name',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Another association you belong to',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 160,
    },
    {
      key: 'association_2_number',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Membership number there',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 60,
    },
    {
      key: 'association_2_joined',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Member there since',
      kind: 'date',
      section: 'Dedicated status',
      focusOffsetYears: -10,
      reach: 'far',
    },
    // ── association 3 ─────────────────────────────────────────────
    //
    // ⚠️ SEVERAL ASSOCIATIONS IS THE NORMAL CASE, NOT AN EDGE CASE. The
    // professional motivations we studied list three, each "a member in good
    // standing with X since DATE, membership number Y", and the trade's own
    // intake questionnaire has columns for five. One association made a
    // multi-body shooter's motivation understate the very thing a section 16
    // reviewer weighs. Optional, and the wizard hides the empty rows behind
    // "add another association" — operator, 2026-08-20 — so the single-body
    // applicant never sees them.
    {
      key: 'association_3_name',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Another association you belong to',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 160,
    },
    {
      key: 'association_3_number',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Membership number there',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 60,
    },
    {
      key: 'association_3_joined',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Member there since',
      kind: 'date',
      section: 'Dedicated status',
      focusOffsetYears: -10,
      reach: 'far',
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
      // OPTIONAL here, unlike the sport shooter's. A dedicated hunter's
      // motivation stands on the hunting record; a shooting discipline is
      // supporting evidence where they shoot one, and a new required field
      // would block applications that were complete yesterday.
      //
      // MULTI-SELECT since 2026-08-21 (operator): plenty of people shoot more
      // than one, and a form that makes them pick their favourite loses the
      // rest of the argument.
      key: 'discipline',
      label: 'Shooting disciplines you compete in',
      kind: 'multi',
      section: 'Experience',
      optionSource: 'shooting-disciplines',
      optionScope: 'hunting',
      allowOther: true,
      prefills: 'discipline_requirement',
      help: 'Optional. Only if you shoot a formal discipline as well as hunting \u2014 several of these are run specifically for hunters.',
      maxLength: 160,
    },
    {
      key: 'discipline_other',
      label: 'Name the discipline',
      kind: 'short',
      section: 'Experience',
      showIf: { key: 'discipline', equals: 'other' },
      maxLength: 160,
    },
    {
      key: 'discipline_requirement',
      label: 'What the discipline requires of the firearm',
      kind: 'long',
      section: 'Experience',
      help: 'Filled in from the body\u2019s published rules when you pick a discipline. Check it and make it yours.',
      maxLength: 2000,
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
    docSourced: 'ASSOCIATION_CARD',
      label: 'Your sport-shooting association',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      maxLength: 160,
    },
    {
      key: 'association_number',
    docSourced: 'ASSOCIATION_CARD',
      label: 'Membership number',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'dedicated_since',
    docSourced: 'ASSOCIATION_CARD',
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
      // A long-standing SAHGCA or NARFO member may have been dedicated since
      // the nineties, so this one gets the decade strip.
      focusOffsetYears: -10,
      reach: 'far',
    },
    // ── association 2 ─────────────────────────────────────────────
    //
    // ⚠️ SEVERAL ASSOCIATIONS IS THE NORMAL CASE, NOT AN EDGE CASE. The
    // professional motivations we studied list three, each "a member in good
    // standing with X since DATE, membership number Y", and the trade's own
    // intake questionnaire has columns for five. One association made a
    // multi-body shooter's motivation understate the very thing a section 16
    // reviewer weighs. Optional, and the wizard hides the empty rows behind
    // "add another association" — operator, 2026-08-20 — so the single-body
    // applicant never sees them.
    {
      key: 'association_2_name',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Another association you belong to',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 160,
    },
    {
      key: 'association_2_number',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Membership number there',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 60,
    },
    {
      key: 'association_2_joined',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Member there since',
      kind: 'date',
      section: 'Dedicated status',
      focusOffsetYears: -10,
      reach: 'far',
    },
    // ── association 3 ─────────────────────────────────────────────
    //
    // ⚠️ SEVERAL ASSOCIATIONS IS THE NORMAL CASE, NOT AN EDGE CASE. The
    // professional motivations we studied list three, each "a member in good
    // standing with X since DATE, membership number Y", and the trade's own
    // intake questionnaire has columns for five. One association made a
    // multi-body shooter's motivation understate the very thing a section 16
    // reviewer weighs. Optional, and the wizard hides the empty rows behind
    // "add another association" — operator, 2026-08-20 — so the single-body
    // applicant never sees them.
    {
      key: 'association_3_name',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Another association you belong to',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 160,
    },
    {
      key: 'association_3_number',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Membership number there',
      kind: 'short',
      section: 'Dedicated status',
      maxLength: 60,
    },
    {
      key: 'association_3_joined',
      docSourced: 'ASSOCIATION_CARD',
      label: 'Member there since',
      kind: 'date',
      section: 'Dedicated status',
      focusOffsetYears: -10,
      reach: 'far',
    },
    {
      // WAS a free-text box reading "Practical, precision, clay, service
      // rifle, and so on." — which asked the applicant to summarise, from
      // memory, the one thing a section 16 motivation turns on. The list is
      // now the real one, and picking from it seeds the equipment rules.
      // ⚠️ MULTI-SELECT SINCE 2026-08-21, AND THE OLD HELP TEXT WAS THE TELL.
      // It read "If you shoot several, pick the one this application is about
      // — the others belong in your competition record", which is a form
      // apologising for its own shape. Operator: let them pick as many as they
      // shoot. The motivation is stronger for naming all of them, because a
      // firearm that serves three disciplines has three reasons to exist.
      key: 'discipline',
      label: 'The disciplines you shoot',
      kind: 'multi',
      section: 'Experience',
      optionSource: 'shooting-disciplines',
      allowOther: true,
      prefills: 'discipline_requirement',
      help: 'Pick every discipline this firearm is for. What each one requires of the firearm is filled in below.',
      required: true,
      // Several disciplines, comma-joined — the old 160 fitted exactly one.
      maxLength: 600,
    },
    {
      key: 'discipline_other',
      label: 'Name the discipline',
      kind: 'short',
      section: 'Experience',
      showIf: { key: 'discipline', equals: 'other' },
      help: 'What it is called, and which club or body runs it.',
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
      help: 'Picking a discipline above fills this in from that body\u2019s published rules. Check it against the current handbook and make it yours \u2014 rules change, and this goes out over your signature.',
      // ⚠️ Deliberately NOT required. It is prefilled, and a required field
      // that fills itself in teaches people to skim the one paragraph on the
      // page they most need to read.
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
      // ⚠️ THE DEADLINE, ON THE FIELD THAT GOVERNS IT. We ask for this date
      // and then said nothing about the one rule attached to it — and an
      // applicant who came straight to a renewal without ever opening the
      // Licence Centre had no other surface that would tell them.
      //
      // Says what protection is LOST, never what happens if you are late:
      // sections 24 and 28 are under a suspended declaration of
      // unconstitutionality pending confirmation.
      help: 'SAPS asks for a renewal application at least 90 days before this date, and a licence lodged in time stays valid until the application is decided. If you are already inside 90 days, lodge as soon as your pack is ready — the SAPS 518(a) asks you to give the reason in writing.',
      // A section 24 renewal is by definition lodged within about a year of
      // the expiry it renews, so the current decade page is where it belongs
      // and a decade strip would be noise.
      focusOffsetYears: 0,
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
  // Every formOnly field exists ONLY for the SAPS 271, so none of them are
  // asked unless the applicant chose to have the form filled. The opt-in
  // question itself is exempt or it would hide itself. Unanswered means the
  // dealer path — the fields stay hidden until a deliberate yes.
  if (
    field.formOnly &&
    field.key !== SAPS271_OPT_KEY &&
    (answers[SAPS271_OPT_KEY] ?? '').trim() !== SAPS271_FILL
  ) {
    return false;
  }
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
/**
 * Columns that are pure form transcription and must NEVER reach a model.
 *
 * ⚠️ `formOnly` USED TO DO TWO JOBS AT ONCE — hide a field in the wizard, and
 * withhold it from the prompt — and the owned-firearms table needed those two
 * answers to differ. It has to be ASKED on the dealer path, because
 * motivation-overlap reads it and the writer argues from it; but a frame
 * serial, a barrel serial and a licence number are registry identifiers with
 * no narrative use whatever. Type, calibre and make stay, because "you already
 * own a .223 bolt rifle" is the whole overlap argument. The numbers do not.
 */
const NEVER_PROMPTED =
  /^(existing_firearm_\d+_(frame_serial|barrel_serial|licence_no)|firearm_source)$/;

/**
 * formOnly fields the writer MUST see anyway.
 *
 * ⚠️ firearm_serial IS THE SUBJECT OF THE APPLICATION. It is formOnly for
 * WIZARD visibility — on the dealer path the applicant may not know it yet —
 * but every professional motivation introduces the firearm with its serial,
 * and the mechanical verifier requires an answered serial to appear in the
 * document. Withholding it handed the writer an impossible instruction:
 * four consecutive live generations were blocked for omitting a number the
 * prompt never contained. A serial identifies a firearm, not a person; the
 * privacy reasoning that keeps phone numbers and a spouse's ID out of the
 * prompt does not apply to it.
 */
const PROMPTED_DESPITE_FORM_ONLY = new Set(['firearm_serial']);

export function factPackFields(
  type: MotivationLicenceType,
): readonly MotivationField[] {
  return fieldsFor(type).filter(
    (f) =>
      (!f.formOnly || PROMPTED_DESPITE_FORM_ONLY.has(f.key)) &&
      !NEVER_PROMPTED.test(f.key),
  );
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
): { answers: Record<string, string>; rejected: string[]; refused: string[] } {
  const answers: Record<string, string> = {};
  const rejected: string[] = [];
  // ⚠️ A SUBSET OF `rejected`, AND THE HALF THAT MATTERS. Dropping a key we
  // no longer have is housekeeping; dropping a REGISTERED field because its
  // value did not pass is the applicant's answer going in the bin. Both used
  // to land in one list under one "ignored unregistered answer keys" warning,
  // so the discipline bug read as routine noise in the log for as long as it
  // existed. Kept separate so it can be logged loudly and shown to the person
  // who typed it.
  const refused: string[] = [];

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
    let trimmed = raw.trim();

    // SA ID numbers are digits only, and people type them with spaces —
    // "8001 0150 0908 7". The 13-character cap used to count those spaces and
    // silently cut the last digits off, which broke the Luhn check and lost
    // date of birth, age, gender and citizenship off the form. Normalised
    // HERE, before the cap, so however it arrives it is stored as 13 digits.
    if (/(^|_)id_number$/.test(key)) {
      trimmed = trimmed.replace(/\D/g, '');
    }

    // A choice must be one of the offered choices. This is not defensive
    // tidiness: these values are printed into boxes on a form the applicant
    // signs, so an arbitrary string arriving from a hand-rolled request would
    // become a false statement on a firearm licence application.
    if (field.kind === 'multi') {
      // Stored comma-joined. Every part must be a real choice, and the order is
      // normalised to the offered order so two identical answers compare equal.
      //
      // ⚠️ allowedValues, NOT field.choices — AND THIS EXACT BUG HAS BITTEN
      // ONCE BEFORE. A field whose options come from optionSource has no
      // `choices` array at all, so `field.choices ?? []` rejects every value
      // the applicant picks and the answer is silently dropped. That is what
      // happened to the single-select discipline field, and making it
      // multi-select would have reintroduced it verbatim.
      const allowed = allowedValues(field);
      const parts = trimmed
        ? trimmed.split(',').map((x) => x.trim()).filter(Boolean)
        : [];
      if (parts.some((x) => !allowed.includes(x))) {
        rejected.push(key);
        refused.push(key);
        continue;
      }
      answers[key] = allowed.filter((c) => parts.includes(c)).join(', ');
      continue;
    }

    if (field.kind === 'choice' || field.kind === 'yesno') {
      const allowed = allowedValues(field);
      if (trimmed && !allowed.includes(trimmed)) {
        rejected.push(key);
        refused.push(key);
        continue;
      }
      answers[key] = trimmed;
      continue;
    }

    const cap = field.maxLength ?? 2000;
    answers[key] = trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
  }

  return { answers, rejected, refused };
}

/**
 * What a choice field will actually accept.
 *
 * ⚠️ `field.choices ?? YES_NO` WAS A SILENT DATA-LOSS BUG. A field whose
 * options come from an optionSource carries no `choices` — the list is
 * attached on the way out to the wizard — so the fallback made the only legal
 * answers "Yes" and "No". `discipline` is such a field, with fifty-nine real
 * options, so EVERY value the dropdown offered was rejected on save.
 *
 * It failed silently in both directions, which is why it survived: the PATCH
 * returned 200 with the key listed under `ignored`, and the wizard did not
 * read that, so the select simply reverted to "Choose…" on the next load. The
 * applicant saw a section that would not stay filled in and a Generate that
 * refused for a question they had answered — the live report was "the
 * Experience keeps resetting".
 *
 * So the allowed set is derived from the same place the dropdown is built
 * from. Anything with an optionSource MUST be resolved here; a new one that
 * is not will inherit exactly this bug.
 */
export function allowedValues(field: MotivationField): readonly string[] {
  if (field.optionSource === 'shooting-disciplines') {
    const values = disciplinesInScope(field.optionScope).map((d) => d.value);
    // "Something else" is a real stored value, and the field that describes it
    // hangs off it via showIf — so it has to be accepted, not just offered.
    return field.allowOther ? [...values, DISCIPLINE_OTHER] : values;
  }
  return field.choices ?? YES_NO;
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
