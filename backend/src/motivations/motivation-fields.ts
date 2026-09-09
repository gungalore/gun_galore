import { MotivationLicenceType } from '@prisma/client';
import {
  DISCIPLINE_OTHER,
  disciplinesInScope,
} from './shooting-disciplines';
import {
  HUNT_GAME_CLASS,
  HUNT_REASONS,
  HUNT_TERRAIN,
  FIREARM_USE_KIND,
  HUNT_WHERE,
  OVERLAP_ANGLES,
  OWNED_SECTION_HELD,
  PRIMARY_USE,
  S13_CARRY_STYLE,
  S13_MOVEMENTS,
  S13_REASONS,
  SPORT_FORMATS,
  SPORT_REASONS,
} from './motivation-cards';
import { ENDORSEMENT_LABELS } from '../common/sa-competency';
import { answerValue } from '../common/card-placeholder';

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
//
// 2026-09-06: COMPETENCY_RENEWS_KEY added to S24_RENEWAL. A key was added, so
// the version moves — that is the rule above, and it holds even for a key no
// applicant ever answers, because "which registry wrote this blob" is exactly
// the question a stored answer nobody typed makes somebody ask later.
//
// 2026-09-07: police_station and police_station_province added to
// S13_SELF_DEFENCE, for the SAPS precinct crime figures a self-defence
// motivation annexes. See CrimeStatsService.
//
// 2026-09-07b: press_clippings added to S13_SELF_DEFENCE, holding the up-to-
// eight NewsIncident ids a member chose to attach as the "Press clippings"
// annexure. Same day as the line above, hence the suffix — see the rule this
// comment block states. See PRESS_CLIPPINGS_KEY and NewsService.
//
// 2026-09-07c: the owned-firearms table. OWNED_ROWS 6 → 14 (the form's own
// number), `existing_firearm_N_model` and `_expiry` added, and
// `_barrel_serial` + `_frame_serial` COLLAPSED into a single `_serial`. The
// two old keys are retired rather than removed — a blob written before today
// still holds them, sanitiseAnswers still accepts them, and
// ownedFirearmSerial() reads them back. That is exactly the "re-meant" case
// the rule above is about: `_serial` is a key that has never existed, and
// `_barrel_serial` is a key that has stopped being asked.
//
// 2026-09-08: the Motivation Centre rebuild, Phase 1. The largest single
// change this registry has had, so the version moves a whole day rather than
// taking a suffix. In summary — see MOTIVATION-REBUILD-BRIEF.md §5.1:
//
//   ADDED    kind 'cards' and eleven card sets (motivation-cards.ts); the
//            'Your premises' section; `existing_firearm_N_primary_use` on all
//            fourteen owned rows; `overlap_angle`; the field properties
//            `options`, `scope` and `internal`; `showIf.hasAny`.
//   RETIRED  `fill_saps271` AS A QUESTION. The SAPS 271 is always produced now
//            and Part F is filled by source route. The key is still ACCEPTED
//            (see RETIRED_FIELDS) so a draft holding it still saves.
//   RE-MEANT `formOnly`. It no longer decides what is ASKED, only what reaches
//            the writer. Roughly forty-eight questions that hung off the 271
//            opt-in are now asked of everybody — including the six history
//            questions, which on the dealer path were never asked at all.
//   RE-MEANT every `long` field. None is `required` any more; each is now the
//            optional, prefilled "anything else" box under the cards that
//            replaced it as the primary input.
//   MOVED    the four safe fields out of 'Storage and safety' and into
//            'Your premises', which also gains seven new questions.
//
// ⚠️ A BLOB WRITTEN BEFORE THIS VERSION STILL LOADS AND STILL SAVES, which is
// the whole reason the version is stamped rather than assumed. Every removal
// above is a RETIREMENT — fieldByKey still finds the key — and not a deletion,
// so the wizard's whole-blob autosave cannot drop an answer somebody gave.
export const FIELD_REGISTRY_VERSION = '2026-09-09b';

// ── THE SAPS 271 IS ALWAYS PRODUCED, AND NOBODY IS ASKED ────────────
//
// ⚠️ THIS REPLACED AN OPT-IN, 2026-09-08. It used to be one early question —
// "should we fill in your SAPS 271 as well?" — and EVERY formOnly field hung
// off the answer, so choosing the dealer path made roughly half the registry
// vanish: phones, postal codes, marital status, the spouse, the firearms-owned
// table, and the six history questions.
//
// It was the wrong question, for a reason that is structural rather than a
// matter of taste. The form is split by PARTY, not by "the dealer does it or
// we do": D, G and H are the applicant's half in every case, and a dealer
// completes E, F and their own 350(a) — never G and H. So the opt-in asked
// somebody on screen one to decide something the dealer does not actually
// decide for them, and a "my dealer will do it" answer silently withheld the
// six history questions, which is the one thing a motivation must address
// head-on: a conviction never reached the writer at all.
//
// So every pack now ships a pre-filled 271 with D, G and H complete and E from
// what we read off the firearm, and Part F is filled BY SOURCE ROUTE — dealer
// leaves F blank with a cover note, a private sale fills 81-87 from the seller
// consent flow, an estate fills Type E from the executor's letter. See
// saps271.service.ts, which owns that rule, and MOTIVATION-INTAKE-PLAN.md §1.
//
// A 271 nobody uses costs one sheet of paper. A 271 nobody was offered costs
// a counter visit.
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
/**
 * Inherited from a deceased estate.
 *
 * ⚠️ A ROUTE WITH ITS OWN REQUIRED DOCUMENT, AND IT WAS UNREACHABLE. The
 * EXECUTOR_APPOINTMENT upload kind has carried a label and guidance since the
 * document list was written — "SAPS asks for the letter of appointment as
 * executor by name, and an estate firearm cannot be licensed without it" — and
 * appeared in NO tier of any licence type, so nothing ever asked for it. An
 * heir applying for their father's rifle had no way to say that was what they
 * were doing, and no slot for the one document the application cannot proceed
 * without. Operator's routing spec §5.4 D.
 */
export const SOURCE_ESTATE = 'Inherited from a deceased estate';

/**
 * A FINDING WE MADE, CARRIED ON THE APPLICATION — NOT A QUESTION.
 *
 * ⚠️ NOBODY IS EVER ASKED THIS. The Licence Centre works out, from the
 * member's own licences and competency certificates, whether the licence being
 * renewed is the last one in its category — in which case the competency
 * expires with it and a SAPS 517(g) has to be lodged alongside, per s10A(1).
 * See competencyRenewalNote in licence-renewal.ts, which owns the rule. This
 * key is where that answer is PUT so the checklist can read it back.
 *
 * ⚠️ HIDDEN BY `internal`, SINCE 2026-09-08. It used to be hidden by two rules
 * that contradicted each other — formOnly (hidden unless fill_saps271 was
 * 'Fill it in for me') set against showIf (shown only when it was 'My dealer
 * will fill it in'), so no answer satisfied both. That was written because
 * there WAS no internal flag, and inventing one would have had to be honoured
 * independently by the wizard's own mirror of isVisible() in
 * frontend/lib/motivations-api.ts — two implementations that must agree, with
 * the failure mode being a Yes/No box turning up in somebody's renewal asking
 * a question we already answered from their own documents.
 *
 * Both halves of that reasoning have since gone. formOnly stopped deciding
 * what is asked (brief §2.6), which broke the contradiction outright; and the
 * frontend mirror is retired in favour of the server-computed item state in
 * motivation-sheet.service.ts. `internal` is honoured in exactly one place,
 * which makes it both simpler and safer than the trick it replaced.
 *
 * ⚠️ AND IT STILL HAS TO STAY OUT OF THE FACT PACK. A model handed
 * "competency_renews_with_licence: Yes" would find a way to argue from it. It
 * is an instruction about a second form, not a reason anybody needs a firearm.
 * factPackFields excludes `internal` with no escape hatch for exactly this.
 */
export const COMPETENCY_RENEWS_KEY = 'competency_renews_with_licence';

/**
 * The confirmed overlap angle — "this one will be my ___".
 *
 * Named because three modules reach for it: the registry declares it,
 * motivation-overlap.ts ranks its options, and the sheet renders it as a card
 * under the source row. See OVERLAP_ANGLES for the wording.
 */
export const OVERLAP_ANGLE_KEY = 'overlap_angle';

export const SAPS271_OPT_KEY = 'fill_saps271';
export const SAPS271_FILL = 'Fill it in for me';
export const SAPS271_DEALER = 'My dealer will fill it in';

/**
 * PRESS CLIPPINGS THE MEMBER CHOSE TO ATTACH BEHIND THEIR OWN CIRCUMSTANCES.
 *
 * The value is a JSON array of NewsIncident ids — never text. Nobody types
 * into this field: the "Your circumstances" step offers a picker built off
 * `GET /motivations/:id/incidents` (NewsService.incidentsNear, keyed on
 * `police_station` above), and choosing a clipping there writes the id list
 * back through the ordinary saveAnswers path, exactly like any other field.
 * See sanitiseAnswers for the JSON + count validation and
 * `PRESS_CLIPPINGS_MAX` for the cap.
 */
export const PRESS_CLIPPINGS_KEY = 'press_clippings';
/**
 * How many clippings a member may attach.
 *
 * Not arbitrary generosity: eight is the operator's own limit on how many
 * incidents get pulled into a pack behind one application — enough to make
 * the precinct's pattern visible, not so many that the annexure becomes the
 * document.
 */
export const PRESS_CLIPPINGS_MAX = 8;

/**
 * The areas the applicant says they travel through, and optionally why.
 *
 * Operator, 2026-09-08: "generate a list of dangerous areas around the
 * applicants home in a 50km radius that has articles attached to it and lets
 * them just tick the ones they travel through with a reason thats optional for
 * the reason being in that area."
 *
 * ⚠️ IT IS THE ANSWER; `press_clippings` IS THE CONSEQUENCE. The member is
 * asked a question about their own movements — which they can answer — and the
 * server works out which cuttings that buys. Storing only the article ids would
 * throw away the reason they gave and the areas whose cuttings did not fit
 * under the cap, both of which the writer wants.
 *
 * A JSON array of `{ key, reason? }`. See motivation-danger-areas.ts.
 */
export const TRAVELLED_AREAS_KEY = 'travelled_areas';

/** One line about being somewhere, not an essay. Mirrors REASON_MAX. */
export const TRAVELLED_AREAS_MAX = 4000;

/**
 * Read `press_clippings` back off an answers blob.
 *
 * Pure and shared: motivation-generation.service.ts (the fact pack) and
 * motivation-render.service.ts (the printed pack) both need the SAME ids in
 * the SAME order, or a clipping the writer cited would not be the one that
 * prints. Never throws — a corrupt or oversized value (which sanitiseAnswers
 * should already have refused) reads back as no clippings chosen, the same
 * fail-soft posture as every other prefill/research source in this pipeline.
 */
export function parsePressClippingIds(raw: string | undefined): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter(
      (x): x is string => typeof x === 'string' && x.trim().length > 0,
    );
    return ids.length <= PRESS_CLIPPINGS_MAX ? ids : [];
  } catch {
    return [];
  }
}

/** The two answers a `yesno` field accepts. Order is deliberate — a wizard
 * should not present "Yes" as the first, easiest tap on a history question. */
export const YES_NO = ['No', 'Yes'] as const;

export type MotivationFieldKind =
  | 'short'
  | 'long'
  | 'date'
  | 'choice'
  | 'multi'
  | 'yesno'
  /**
   * A GRID OF FIRST-PERSON SENTENCES THE APPLICANT TAPS. Stored exactly like
   * `multi` — a comma list in the offered order — so `showIf` and
   * sanitiseAnswers need no new storage rule.
   *
   * ⚠️ SELECTED MEANS TRUE, AND THAT IS WHY IT IS SENTENCES AND NOT LABELS.
   * The applicant signs their name under the motivation these produce, so
   * every option reads as something they are asserting about themselves and
   * only a tapped one reaches the writer. FCA s120(9)(f) — a false statement
   * on an application is an offence — is the reason this is selection and
   * never silent inclusion. See motivation-cards.ts, where the wording lives.
   */
  | 'cards';

/**
 * One tile in a `cards` field.
 *
 * ⚠️ THE SENTENCE IS THE VALUE THE MEMBER SIGNS UNDER, NOT A LABEL FOR ONE.
 * `key` is what is stored and what `showIf` matches; `sentence` is what the
 * applicant reads and what the writer may use verbatim. They are separate so
 * the operator can reword a card (§9.2 review) without invalidating every
 * stored answer — the same discipline as retiredChoices one level down.
 */
export interface CardOption {
  /** Stored value. Stable across rewordings. */
  key: string;
  /** First person, one sentence, ends in a full stop. */
  sentence: string;
  /**
   * How the server ranks this set for THIS applicant, when it can.
   *
   * Declared in the registry, computed in the research layer — a card set with
   * no ranking is offered in registry order, which is always correct and never
   * personalised.
   */
  rankBy?: 'calibre' | 'association' | 'precinct' | 'occupation';
}

export interface MotivationField {
  key: string;
  label: string;
  kind: MotivationFieldKind;
  /** Section the wizard groups it under. */
  section: string;
  /**
   * The tiles, for `kind: 'cards'`.
   *
   * ⚠️ NOT `choices`. A choice is a word in a dropdown; a card is a claim. They
   * are separate properties so nothing can quietly render fifty-nine
   * disciplines as tick-boxes, or a card set as a select.
   */
  options?: readonly CardOption[];
  /**
   * WHO THE ANSWER BELONGS TO — this application, or the person.
   *
   * ⚠️ 'profile' ANSWERS ARE SHARED ACROSS EVERY APPLICATION THE MEMBER EVER
   * MAKES. Marital status, what their premises look like, what each firearm
   * they already own is used for, whether they reload: none of that is a fact
   * about an application, and asking it again on the second one is the single
   * clearest way to tell somebody we were not listening the first time.
   *
   * They are stored in MemberProfileAnswers, not in the motivation's own blob,
   * and offered back through the existing ProvenanceSource 'PROFILE'. Absent
   * means 'application', which is what almost every field is.
   */
  scope?: 'profile' | 'application';
  /**
   * A FINDING WE WRITE, NEVER A QUESTION WE ASK.
   *
   * ⚠️ ACCEPTED, NEVER ASKED, NEVER SERVED, NEVER IN THE FACT PACK. Three
   * fields are filled in by us from the member's own documents and lookups —
   * the province of their police station, the press clippings they picked, and
   * whether their competency runs to the licence being renewed — and putting
   * any of them on screen as a box would be asking a question we have already
   * answered.
   *
   * ⚠️ THIS REPLACED A DELIBERATE CONTRADICTION, and the history matters
   * because it is the reason this flag is safe now and was not before. Those
   * three used to be hidden by setting `formOnly` (needs fill_saps271 = "Fill
   * it in for me") against `showIf` (needs fill_saps271 = "My dealer will fill
   * it in") so no answer satisfied both. That trick was written because
   * isVisible() had a MIRROR in frontend/lib/motivations-api.ts, and a flag
   * honoured by one side and not the other puts a box in front of somebody.
   *
   * The mirror is gone: motivation-sheet.service.ts computes every item's
   * state on the server and the screen renders what it is told. One
   * implementation, so one flag can be trusted.
   *
   * ⚠️ AND IT MUST STAY OUT OF factPackFields. "competency_renews_with_licence:
   * Yes" is an instruction about a second form, not a reason anybody needs a
   * firearm, and a model handed it will find a way to argue from it.
   */
  internal?: true;
  /** Shown under the input. Plain, no legalese. */
  help?: string;
  choices?: readonly string[];
  /**
   * Values that are still ACCEPTED but no longer OFFERED.
   *
   * ⚠️ DELISTING A CHOICE IS NOT THE SAME AS DELETING IT, AND TREATING IT AS
   * THE SAME BREAKS EVERY APPLICATION THAT ALREADY PICKED IT. The wizard
   * resends the WHOLE answers blob on every autosave — see the note on
   * saveAnswers — so a stored value that is no longer in `choices` fails
   * sanitiseAnswers on every keystroke anywhere in the form. The row survives
   * in Postgres (a refusal drops the key rather than blanking it), but the
   * member is shown a banner reading "we could not store your answer... please
   * tell support", forever, and the log fills with an error that reads exactly
   * like real registry drift.
   *
   * So a retired value stays valid. It is simply never put in front of anyone
   * again. This is the same shape as `allowOther` below, and the same
   * discipline the Prisma enums use for retired kinds: Postgres cannot drop an
   * enum value and we cannot drop an answer somebody already gave.
   */
  retiredChoices?: readonly string[];
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
  showIf?: {
    key: string;
    /** Shown when the named answer is (or, for a list, contains) this value. */
    equals?: string;
    /**
     * Shown when the named `cards` or `multi` field has ANY tap at all.
     *
     * ⚠️ THE "IN YOUR OWN WORDS" BOXES NEED THIS AND `equals` CANNOT GIVE IT.
     * The optional textarea under a card grid is prefilled from whatever was
     * tapped, so it belongs on screen once anything is tapped and nowhere
     * before — a condition about the SHAPE of the answer, not its content.
     * Written as `equals` it would need one clause per option and would silently
     * stop matching the day the operator adds a tenth card.
     */
    hasAny?: true;
  };
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
  /**
   * THIS ANSWER CAN CARRY EVIDENCE, so offer a camera and a file picker on it.
   *
   * Operator, items 8 and 10 of twelve, 2026-08-24: "Your hunting record should
   * also have a upload/camera option", and for association activities "there
   * might be targets that's uploaded so prepare for different types of formats
   * and documents". Asked how, given per-field pickers had been removed once
   * before as cluttered: "Upload and camera button. Make a list of attachments
   * as the applicant gives them."
   *
   * ⚠️ IT IS THE OPPOSITE OF docSourced, AND THE TWO MUST NOT BE CONFUSED. A
   * docSourced field is one a document ANSWERS, so we stop asking it. This is a
   * field a document SUPPORTS: the applicant still writes their record, and the
   * targets, permits and register pages are what make a DFO believe it. Nothing
   * here is extracted and nothing is prefilled.
   *
   * ⚠️ AND IT IS DELIBERATELY RARE. The clutter complaint that removed the last
   * per-field pickers was fair — a camera, a file picker and a dropdown hanging
   * under all 199 fields is noise. This appears on the three fields where the
   * evidence IS the argument, and nowhere else. Adding it broadly would earn
   * the same complaint again.
   *
   * The value names an existing MotivationUploadKind, so a file attached here
   * is the SAME document as one attached on the documents step — one list, one
   * annexure, no second silo to keep in step.
   */
  attachKind?: string;
}

/** Asked for every licence type. */
// ── FIREARMS ALREADY LICENSED TO THE APPLICANT (SAPS 271 item 2.1) ─
//
// These are the form's own columns, and they are now the ONLY place the
// applicant states what they already hold — the prose duplicate that used to
// sit in 'Storage and safety' is gone; see the note there. They exist for a
// second reason that matters more: THE OVERLAP CHECK READS THEM.
//
// "I already have a .308" cannot be answered from free text, and it is the
// question that gets a second medium-game rifle refused — see
// motivation-overlap.ts. A structured calibre is what lets us raise the
// objection before the Registrar does.
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

/** The wizard section every owned-firearm field belongs to. */
export const OWNED_SECTION = 'Firearms you already own';

/**
 * The premises section — the wall, the gate, the alarm, the safe.
 *
 * ⚠️ IT REPLACED 'Storage and safety', WHICH ONLY EVER HELD THE SAFE. Every
 * approved motivation carries a security paragraph covering the whole
 * property, and the registry could not write one: it held four questions about
 * the safe and a free-text box asking the applicant to write the rest
 * themselves. Named for what it covers, not for what it used to.
 *
 * Every field in it is `scope: 'profile'` — a wall does not move between
 * applications.
 */
export const PREMISES_SECTION = 'Your premises';

/**
 * How many owned-firearm rows the registry carries.
 *
 * ⚠️ FOURTEEN, AND IT USED TO BE SIX. The note that stood here read: "Six
 * rows. The form has fourteen; almost nobody holds six, and an applicant with
 * more can write the remainder in by hand rather than have us guess at a limit
 * and silently drop the seventh." Both halves were wrong on the operator's own
 * Section 13 application, driven live on 2026-09-07. They hold more than six;
 * and nothing was written in by hand, because the offer does not put a pen in
 * anybody's hand — it reported the leftovers, ONE MESSAGE PER LICENCE, as "the
 * form has room for 6 firearms and they are all filled", rendered as a run-on
 * line the member could do nothing about.
 *
 * Operator, 2026-09-07: "all fire arms the applicant owns must be in that
 * list."
 *
 * Fourteen is the FORM'S number, not a guess of ours: item 2.1 on page 5 of
 * the blank SAPS 271 is fourteen identical rows — measured, not assumed, by
 * backend/scripts/saps271-measure.mjs.
 *
 * ⚠️ THREE OTHER COPIES OF THIS CONSTANT EXIST AND MUST FOLLOW IT.
 * motivation-overlap.ts, saps271-coverage.ts and motivation-extract.service.ts
 * each declare their own `const OWNED_ROWS = 6`. Until they import this one, a
 * member's seventh firearm is listed on their form and invisible to the
 * duplicate-calibre argument, to the completeness panel and to the extractor.
 */
export const OWNED_ROWS = 14;

/**
 * What a LIST of the firearms somebody already owns shows, in order.
 *
 * Operator, 2026-09-07: "when listing the fire arms I already own it should
 * only be the make, model, serial number and expiry date listed, nothing
 * else."
 *
 * ⚠️ A LISTING, NOT THE FIELD SET, AND THE DIFFERENCE IS LOAD-BEARING. Type,
 * calibre and use are still asked and still stored: motivation-overlap.ts
 * classifies the calibre to argue the duplicate-calibre refusal ground, the
 * SAPS 271 prints the type, and `existing_firearm_N_use` carries the fact the
 * whole comparison rests on (see its own note below). Dropping them as FIELDS
 * to satisfy a request about a SUMMARY ROW would delete the argument along
 * with the clutter. They simply do not belong in a four-column summary.
 */
export const OWNED_LISTING_COLUMNS = [
  'make',
  'model',
  'serial',
  'expiry',
] as const;

/**
 * The serial for one owned-firearm row, reading drafts written before the
 * collapse.
 *
 * ⚠️ ONE SERIAL, BECAUSE THE CARD PRINTS ONE NUMBER THREE TIMES. The
 * operator's Glock licence reads ZABA01892 against the barrel, the receiver
 * AND the frame. Two boxes therefore asked two questions with one answer, and
 * on the firearms where they genuinely differ the card says NONE for one of
 * them — which is the card saying there is nothing there, not a serial.
 *
 * ⚠️ AND THE OLD KEYS STILL HOLD ANSWERS. `existing_firearm_N_barrel_serial`
 * and `_frame_serial` are RETIRED, not deleted — see LEGACY_OWNED_FIELDS — so
 * a draft saved before today still loads and still reads back here. Barrel
 * before frame only because a licence prints the barrel number first; a
 * placeholder in either falls through to the other.
 *
 * ⚠️ EVERY READER OF AN OWNED-FIREARM SERIAL MUST COME THROUGH THIS. At the
 * time of writing three do not: saps271-map.ts (which prints the two boxes on
 * the form), motivation-verify.ts and motivation-overlap.ts still read the two
 * legacy keys directly.
 */
export function ownedFirearmSerial(
  answers: Record<string, string>,
  n: number,
): string {
  const p = `existing_firearm_${n}_`;
  return (
    answerValue(answers[`${p}serial`]) ||
    answerValue(answers[`${p}barrel_serial`]) ||
    answerValue(answers[`${p}frame_serial`])
  );
}

/**
 * Every column one owned-firearm row can hold, including the retired ones.
 *
 * ⚠️ THE RETIRED SERIALS ARE ON THIS LIST ON PURPOSE. A draft saved before the
 * two serial boxes collapsed into `_serial` holds `_barrel_serial` and
 * `_frame_serial` and nothing else; a row that looks empty because we asked
 * about the wrong key is a row somebody will write a different firearm over.
 */
export const OWNED_ROW_COLUMNS = [
  ...OWNED_LISTING_COLUMNS,
  'type',
  'calibre',
  'use',
  // A tapped purpose is evidence somebody has been in this row, exactly as a
  // typed one is — see the note on ownedRowTaken about which direction is
  // safe to be wrong in.
  'primary_use',
  // A tapped section is somebody having been in this row, same as a purpose.
  'section_held',
  'licence_no',
  'barrel_serial',
  'frame_serial',
] as const;

/**
 * Is this owned-firearm row in use?
 *
 * ⚠️ ONE RULE, BECAUSE THREE READERS DISAGREEING ABOUT THIS OVERWRITES A
 * FIREARM. Until now `nextOwnedSlot` in motivation-extract.service.ts decided a
 * row was taken by its CALIBRE alone ("matching the wizard's own definition of
 * a started row") while credentialOffer tested ten columns. Calibre is the one
 * column where absence has a second meaning: it is now droppable at the answer
 * boundary — a card printing "Calibre: -" contributes none — so a row carrying
 * a make, a model and a serial could report itself free and the next licence
 * uploaded would be proposed straight over the top of it, producing a form
 * describing a firearm that does not exist.
 *
 * ⚠️ AND IT DELIBERATELY DOES NOT RUN answerValue. Everywhere else in this file
 * a placeholder is nothing; here it is EVIDENCE THAT SOMEBODY HAS BEEN IN THIS
 * ROW. The question is not "is this value true" but "is this row free", and the
 * conservative answer is the safe one in both directions: at worst the member
 * gets a fresh row for a firearm, which they can see and fix. Overwriting is
 * the failure that is invisible.
 */
export function ownedRowTaken(
  answers: Record<string, string>,
  n: number,
): boolean {
  return OWNED_ROW_COLUMNS.some(
    (col) => (answers[`existing_firearm_${n}_${col}`] ?? '').trim() !== '',
  );
}

/**
 * The first owned-firearm row nothing has been written into, or null when all
 * {@link OWNED_ROWS} are in use.
 *
 * Null rather than a wrap-around: the registry has no fifteenth row, and
 * silently overwriting row 14 would be worse than proposing nothing.
 */
export function nextOwnedRow(answers: Record<string, string>): number | null {
  for (let n = 1; n <= OWNED_ROWS; n++) {
    if (!ownedRowTaken(answers, n)) return n;
  }
  return null;
}

/**
 * One row of the owned-firearms table.
 *
 * ⚠️ GENERATED, AND THAT IS THE POINT. Fourteen rows of eight columns is 112
 * literals nobody keeps in step, and the six that were written by hand had
 * already drifted — row 1 carried help text and a comment block that rows 2 to
 * 6 did not, so five sixths of the applicants never saw the guidance.
 *
 * The first four columns are OWNED_LISTING_COLUMNS, in the operator's order,
 * so the summary row is simply the head of the row.
 */
function ownedFirearmRow(n: number): MotivationField[] {
  const p = `existing_firearm_${n}_`;
  return [
    {
      key: `${p}make`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Make',
      kind: 'short',
      section: OWNED_SECTION,
      sensitive: true,
      maxLength: 60,
    },
    {
      // ⚠️ TWO READERS FILL THIS BOX AND ONLY ONE OF THEM ASKS FOR IT YET.
      // `docSourced: 'CURRENT_LICENCE'` is a promise to the member — the wizard
      // files the field under "from your documents" and read-result prints "Not
      // on the document" against an empty one — so a reader that never asks
      // makes the form say something untrue about their licence.
      //
      // ✅ The IN-WIZARD photograph now asks: EXTRACTABLE.CURRENT_LICENCE in
      // motivation-extract.service.ts lists `existing_firearm_1_model`. A card
      // does print it; the operator's own Marlin reads "Model NONE", which is
      // the card saying this firearm has no model designation, and the
      // placeholder stops at the answer boundary rather than in this box.
      //
      // ✅ AND SO DOES THE VAULT, since 2026-09-07. WANTED in
      // licence-centre-extract.service.ts asked a firearm licence for
      // licence_number, holder_name, firearm_type, make, calibre, the two
      // serials and the section — no model — and WANTED is both the question
      // AND the filter, so a model that reader volunteered was discarded on
      // the way back and credentialOffer's `first(c.details, 'model')` found
      // nothing. 'model' is on that list now, with its alias in
      // common/document-fields.ts, so both readers fill this box.
      key: `${p}model`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Model',
      kind: 'short',
      section: OWNED_SECTION,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: `${p}serial`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Serial number',
      kind: 'short',
      section: OWNED_SECTION,
      help: 'One number. A licence usually prints the same serial for the barrel, the receiver and the frame.',
      sensitive: true,
      maxLength: 60,
    },
    {
      // The date on the member's OWN licence for this firearm — not the
      // application's. It comes off the vault row's expiry column, which is
      // the same column the renewal sweep reads, so the form and the reminder
      // can never disagree about one firearm — and, since 2026-09-07, off an
      // in-wizard licence photograph too (EXTRACTABLE.CURRENT_LICENCE), which
      // is what its `docSourced` has always claimed.
      //
      // ⚠️ THE ONE COLUMN OF THIS ROW THAT IS NOT `sensitive`, DELIBERATELY.
      // `sensitive` drives maskSensitive in the wizard's field grid, and it is
      // there for numbers that identify a firearm or a person — a serial, a
      // licence number, a make and calibre pair. A licence expiry date
      // identifies nobody, and masking it would hide the single fact this row
      // exists to let the member check against the card in their hand.
      key: `${p}expiry`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Licence expires on',
      kind: 'date',
      section: OWNED_SECTION,
      // A firearm licence runs two to ten years, so the current decade page is
      // where it belongs and a decade strip would be noise.
      focusOffsetYears: 0,
    },
    {
      key: `${p}type`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Type',
      kind: 'choice',
      section: OWNED_SECTION,
      choices: ['Rifle', 'Shotgun', 'Handgun', 'Combination'],
      sensitive: true,
    },
    {
      key: `${p}calibre`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Calibre',
      kind: 'short',
      section: OWNED_SECTION,
      help: 'Exactly as it appears on the licence.',
      sensitive: true,
      maxLength: 60,
    },
    {
      // ⚠️ NOT docSourced, AND IT NEVER CAN BE. A licence copy carries make,
      // calibre and serial; nothing on it says what the firearm is used for.
      // This is the one fact in the block that has to come from the person.
      //
      // ⚠️ AND IT IS THE FACT THE WHOLE COMPARISON RESTS ON. The writer is
      // told to argue, per firearm, why the one already held cannot do this
      // job — and until this field existed it saw only type, calibre and make.
      // "A .308 bolt-action" cannot be argued against a purpose; "bushveld
      // plains game to 250 m" can. Demanding the paragraph without supplying
      // this would have aimed pure invention pressure at rule 1, which is the
      // trap this field exists to close.
      //
      // ⚠️ RULE 8 PUTS IT HERE RATHER THAN IN THE WRITER'S HANDS. What
      // somebody USES a firearm for is history — verifiable, checkable,
      // theirs. The DISTINCTION between two firearms is rationale and stays
      // the writer's job (see ARGUE_IT). Those are different things and only
      // the second may be inferred.
      //
      // Optional, and never a follow-up question. It sits in the form beside a
      // row we have usually already read off an uploaded licence, so somebody
      // who has uploaded nothing never sees it. Two words are enough.
      key: `${p}use`,
      label: 'What you use it for',
      kind: 'short',
      section: OWNED_SECTION,
      help: 'A few words is plenty — "bushveld plains game", "clay targets", "carried for self-defence".',
      maxLength: 120,
    },
    {
      // ⚠️ THE TAPPABLE VERSION OF `_use` ABOVE, AND BOTH SURVIVE ON PURPOSE.
      // `_use` is free text somebody may already have typed, and nothing this
      // module does ever throws that away. This is what is ASKED from
      // 2026-09-08 — one tap against a ranked list rather than a sentence to
      // compose — and it is what motivation-overlap.ts reads.
      //
      // ⚠️ PROFILE-SCOPED: ASKED ONCE PER FIREARM, EVER. A firearm's purpose
      // does not change because a second application was started, and the
      // Document Centre asks it at the moment a licence is adopted into the
      // vault (vault-adoption.service.ts) so an application usually meets it
      // already answered.
      //
      // ⚠️ NEVER docSourced, AND IT NEVER CAN BE. A licence copy carries make,
      // calibre and serial; nothing printed on it says what the firearm is
      // for. This is the one fact in the row that has to come from the person.
      key: `${p}primary_use`,
      label: 'What it is for',
      kind: 'cards',
      section: OWNED_SECTION,
      options: PRIMARY_USE,
      scope: 'profile',
    },
    {
      /**
       * ⚠️ WITHOUT THIS THE WRITER INVENTS ONE. See OWNED_SECTION_HELD: the
       * rows carried make, calibre, serial and expiry and no section, the
       * prompt asked for one per held firearm, and MO000071 shipped a section
       * 16 Marlin described as being under section 15. A DFO holding the
       * licence copies in Annexure G reads the contradiction off the page.
       *
       * ⚠️ AND IT IS `docSourced`, WHICH IS A PROMISE THIS ONE CAN KEEP. Every
       * licence card prints the section, `licence-card-ocr.service.ts` has
       * always read it into the vault, and credentialOffer now proposes it —
       * so for a member whose licences are in the Centre this arrives answered
       * before they ever see the row. Unlike `primary_use` directly above,
       * which can never be docSourced because nothing printed on a licence
       * says what a firearm is FOR.
       */
      key: `${p}section_held`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Licensed under',
      kind: 'cards',
      section: OWNED_SECTION,
      options: OWNED_SECTION_HELD,
      scope: 'profile',
    },
    {
      key: `${p}licence_no`,
      docSourced: 'CURRENT_LICENCE',
      label: 'Licence or permit no',
      kind: 'short',
      section: OWNED_SECTION,
      sensitive: true,
      maxLength: 60,
    },
  ];
}

const OWNED_FIREARM_FIELDS: readonly MotivationField[] = Array.from(
  { length: OWNED_ROWS },
  (_, i) => ownedFirearmRow(i + 1),
).flat();

/**
 * Keys that are still ACCEPTED but are never asked, never served and never
 * offered.
 *
 * ⚠️ THE SAME DISCIPLINE AS retiredChoices, ONE LEVEL UP. The wizard resends
 * the WHOLE answers blob on every autosave, so a stored key that stopped being
 * registered fails sanitiseAnswers on every keystroke anywhere in the form —
 * the member gets "we could not store your answer" for ever, and the value
 * they typed into the old box is dropped on the floor.
 *
 * `existing_firearm_N_barrel_serial` and `_frame_serial` were collapsed into
 * `_serial` on 2026-09-07. Drafts saved before that hold them, and
 * ownedFirearmSerial reads them back. They are kept OUT of fieldsFor so
 * nothing renders a third serial box, and reachable through fieldByKey so
 * sanitiseAnswers keeps accepting them.
 */
const LEGACY_OWNED_FIELDS: readonly MotivationField[] = Array.from(
  { length: OWNED_ROWS },
  (_, i) => i + 1,
).flatMap((n) => [
  {
    key: `existing_firearm_${n}_barrel_serial`,
    label: 'Barrel serial no',
    kind: 'short' as const,
    section: OWNED_SECTION,
    sensitive: true as const,
    maxLength: 60,
  },
  {
    key: `existing_firearm_${n}_frame_serial`,
    label: 'Frame / receiver serial no',
    kind: 'short' as const,
    section: OWNED_SECTION,
    sensitive: true as const,
    maxLength: 60,
  },
]);

/**
 * A WHOLE FIELD THAT IS NO LONGER ASKED, AND STILL HAS TO SAVE.
 *
 * ⚠️ RETIRED, NOT DELETED — the same rule as retiredChoices and
 * LEGACY_OWNED_FIELDS, applied to the field rather than to one of its values.
 * The wizard resends the WHOLE answers blob on every autosave, so a key that
 * simply vanished from the registry would fail sanitiseAnswers on every
 * keystroke anywhere in the form for anybody whose draft already holds it.
 *
 * ⚠️ AND IT IS STILL REACHABLE THROUGH fieldByKey, WHICH IS WHAT MAKES `internal`
 * NECESSARY RATHER THAN OPTIONAL. Because an answer to this key can still
 * arrive on the wire and still be stored, any field gated on its value would
 * still be openable — which is precisely why the three never-asked fields
 * stopped being gated on it. See `internal`.
 *
 * 2026-09-08: the SAPS 271 stopped being an opt-in extra. Part F is filled by
 * source route instead (dealer blank, private from the seller consent, estate
 * from the executor letter), so nothing is decided by asking, and the ~48
 * questions this used to un-hide are simply asked of everybody. Brief §2.5.
 */
const RETIRED_FIELDS: readonly MotivationField[] = [
  {
    key: SAPS271_OPT_KEY,
    label: 'Should we fill in your SAPS 271 application form as well?',
    kind: 'choice',
    section: 'The SAPS 271 form',
    choices: [SAPS271_DEALER, SAPS271_FILL],
  },
  /**
   * 2026-09-09: THE DISCIPLINE QUESTIONS, REPLACED BY THE GENERATED USES.
   *
   * "The disciplines you shoot", "Name the discipline" and "What the
   * discipline requires of the firearm" asked the applicant to summarise, from
   * memory, the one thing a section 16 sport motivation turns on — and the
   * first of them was REQUIRED, so an application could not be generated until
   * somebody had ticked a list of formats.
   *
   * ⚠️ THE ANSWER NOW COMES FROM THE FIREARM, NOT FROM THE MEMBER. Operator,
   * 2026-09-09: "the gemini research on what this weapon is good for is
   * exactly why I implemented it was to get rid of these questions."
   * firearm-uses.service.ts generates, per firearm CLASS and per kind of
   * shooter, the disciplines that class is genuinely shot in — with their
   * positions, distances and target types — and the writer picks from that.
   * "It is a standard chambering for F-Class prone shooting at six hundred
   * metres" is the sentence this box was asking the member to compose.
   *
   * ⚠️ WHICH IS THE STANDING RULE, NOT A NEW ONE. "Automate it — do not ask":
   * a confirm step guarding a value we already hold is work we invented for
   * the member, and a required one is a wall.
   *
   * Retired rather than deleted, like everything else here: the wizard resends
   * the whole answers blob on every autosave, so a key that simply vanished
   * would fail sanitiseAnswers on every keystroke for anybody whose draft
   * holds it. Readers that still look for `discipline` — the fact pack, the
   * reason writer — find it on an old draft and find nothing on a new one,
   * which is the same thing they already do for an unanswered optional field.
   */
  {
    key: 'discipline',
    label: 'The disciplines you shoot',
    kind: 'multi',
    section: 'Experience',
    optionSource: 'shooting-disciplines',
    allowOther: true,
    maxLength: 600,
  },
  {
    key: 'discipline_other',
    label: 'Name the discipline',
    kind: 'short',
    section: 'Experience',
    maxLength: 160,
  },
  {
    key: 'discipline_requirement',
    label: 'What the discipline requires of the firearm',
    kind: 'long',
    section: 'Experience',
    maxLength: 2000,
  },
];

const LEGACY_BY_KEY = new Map(
  [...LEGACY_OWNED_FIELDS, ...RETIRED_FIELDS].map((f) => [f.key, f]),
);

const COMMON_FIELDS: readonly MotivationField[] = [
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
    maxLength: 30,
  },
  {
    key: 'work_telephone',
    label: 'Work telephone',
    kind: 'short',
    section: 'About you',
    sensitive: true,
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
    // ⚠️ PROFILE, NOT APPLICATION. Somebody's marital status is a fact about
    // them, not about this firearm, and asking it again on their second
    // application is the clearest way to say we were not listening on the
    // first. Same for the spouse's name below.
    scope: 'profile',
  },
  {
    key: 'spouse_name',
    label: "Spouse or partner's full name",
    kind: 'short',
    section: 'About you',
    showIf: { key: 'marital_status', equals: 'Married' },
    required: true,
    sensitive: true,
    scope: 'profile',
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
    section: 'Your competency',
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
    // ⚠️ THE HELP IS THE PLACEHOLDER INSIDE A 44px BOX. The five sentences
    // this used to carry — training providers, the PFTC, fingerprints, the
    // separate fee, section 6(2) — were all true and all invisible, clipped
    // at the width of the input. Keep the operative warning; the rest of the
    // competency story belongs on a page, not in a placeholder.
    help: 'As printed on your certificate — you need it in hand, as SAPS will not take a licence application while competency is still being applied for.',
    required: true,
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'competency_for',
    docSourced: 'COMPETENCY_CERTIFICATE',
    label: 'What your competency covers',
    kind: 'multi',
    section: 'Your competency',
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
    section: 'Your competency',
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
    section: 'Your competency',
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
    // ⚠️ FIRST IN THE SECTION, AND REQUIRED. It decides who completes Part F,
    // which documents the pack demands, and whether the seller-consent card is
    // reachable at all — and it was sitting fifth, marked Optional, between
    // Model and Calibre. The consequence on the live sheet: the card that
    // carries the seller's "photograph your licence" scanner never rendered,
    // so an applicant was left hand-typing make, model, calibre and seven
    // serial rows for a firearm whose card they have never held, while the
    // pack meter pleaded "Tell us where the firearm is coming from".
    //
    // ⚠️ THE THREE COMMENTS BELOW ALREADY ASSUMED IT WAS REQUIRED — "they now
    // have to say which route they are on", "the field is required, so a
    // rejected value is a wizard they cannot get past". The `required` line
    // went missing; the reasoning against it went with SOURCE_UNDECIDED when
    // that choice was retired. There is no longer an answer that satisfies the
    // question without answering it.
    key: FIREARM_SOURCE_KEY,
    label: 'Where is this firearm coming from?',
    kind: 'choice',
    section: 'The firearm',
    required: true,
    // ⚠️ TWO ROUTES, NOT FIVE. Operator, 2026-08-28: "lets keep the options
    // between Individual and dealer for now."
    // ⚠️ EXACTLY TWO. Operator, 2026-08-29: "The form must only give two
    // options, Private seller or Dealer. Those are the only two we are going
    // to support, the rest we will build at a later stage."
    choices: [SOURCE_DEALER, SOURCE_PRIVATE],
    // Still ACCEPTED on a save, never offered again. An application written
    // before this decision carries one of these answers, and refusing it would
    // break every save those members make — the field is required, so a
    // rejected value is a wizard they cannot get past.
    //
    // ⚠️ "Not decided yet" WENT WITH THE ESTATE ROUTE, and it cost something
    // real: on a REQUIRED field it was the one answer that satisfied the
    // requirement without answering the question, so somebody who had not yet
    // found a firearm could get to the end of the wizard with a document list
    // built for nobody. They now have to say which route they are on, and can
    // change it whenever the answer changes.
    retiredChoices: [SOURCE_ESTATE, SOURCE_UNDECIDED],
    help: 'A dealer sale and a private transfer need different paperwork at the counter. Telling us which lets us ask for the right documents instead of all of them.',
    // ⚠️ NOT formOnly, DELIBERATELY, AND IT IS THE WHOLE POINT. formOnly hangs
    // a field off the SAPS 271 opt-in, so a member whose dealer fills the form
    // would never be asked — and they are the ones most likely to be buying
    // from that dealer. The document checklist is needed on BOTH paths.
    // Withholding it from the writer is NEVER_PROMPTED's job instead; see the
    // note there about the two jobs formOnly used to do at once.
  },
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
    /**
     * ⚠️ THE ONE FIGURE SECTION 16 TURNS ON FOR A SEMI-AUTOMATIC SHOTGUN.
     * s16(1)(c) admits a "semi-automatic shotgun manufactured to fire no more
     * than five shots in succession without having to be reloaded" — the
     * paragraph substituted by Act 43 of 2003, in force, whose deletion in Act
     * 28 of 2006 never commenced. Nothing asked for it, so nothing could warn
     * an applicant that a six-shot shotgun is outside the section they are
     * applying under. MOTIVATION-GUIDE-BOOK Part 3.2.
     *
     * ⚠️ ASKED OF EVERY SEMI-AUTOMATIC, NOT ONLY SHOTGUNS, because `showIf`
     * takes ONE key and the condition is really "shotgun AND semi-automatic".
     * The wider question is not wasted: section 14(4) asks an applicant to
     * motivate a restricted firearm and the manufactured capacity is a fact
     * that argument turns on too.
     *
     * ⚠️ MANUFACTURED CAPACITY, NOT WHAT IS IN IT. The Act's test is what the
     * firearm was built to do. A plugged magazine does not change the answer
     * and a member who gives the plugged number has said something the DFO
     * will read against the serial number's own record.
     */
    key: 'firearm_capacity',
    label: 'Manufactured capacity',
    kind: 'short',
    section: 'The firearm',
    showIf: { key: 'firearm_action', equals: 'Semi-automatic (self-loading)' },
    help: 'How many shots it was MADE to fire without reloading — not how many you load. It is on the box, the manual or the dealer’s invoice.',
    formOnly: true,
    maxLength: 20,
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
    // ⚠️ THE 271 HAS NO SINGLE "serial number" BOX — THE LICENCE CARD DOES.
    // Section E has barrel (1.7), frame (1.9) and receiver (1.11) serials, each
    // with its own make, because the frame or receiver IS the firearm in law.
    // A card, by contrast, prints a headline "Serial Number" above those rows,
    // and THAT is the number that identifies the firearm — operator,
    // 2026-08-28: "even when the DFO asks what is the serial number of the
    // firearm, that is the number you will give him."
    //
    // So this field is the headline number, asked once, and the three component
    // rows below carry what the form needs. They match: on the operator's own
    // card the headline MR90189D IS the receiver row, with barrel and frame
    // reading NONE.
    help: 'If you already know which firearm it is. Leave blank if not — the dealer fills it in.',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  // ── the three component rows, SAPS 271 section E 1.7–1.12 ────────────
  //
  // ⚠️ ALL SIX ARE OPTIONAL AND USUALLY BLANK, AND THAT IS CORRECT. A
  // firearm carries its number on ONE component; the other two rows read NONE
  // on a real card. Marking any of them required would block an application
  // over a box the card itself leaves empty.
  //
  // They exist because the reader can now fill them (common/firearm-identity
  // reads all four serials off any document) and because a 271 printed without
  // them is a form with three empty boxes a DFO expects filled. Before this the
  // registry could store less than the reader could read.
  {
    key: 'barrel_serial',
    label: 'Barrel serial number',
    kind: 'short',
    section: 'The firearm',
    help: 'From the licence card or the dealer’s paperwork. Often NONE — leave it blank if the barrel carries no number of its own.',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'barrel_make',
    label: 'Barrel make',
    kind: 'short',
    section: 'The firearm',
    help: 'Only where the card names a make against the barrel row specifically.',
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'frame_serial',
    label: 'Frame serial number',
    kind: 'short',
    section: 'The firearm',
    help: 'Often NONE. Leave blank unless the card shows a number against the frame row.',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'frame_make',
    label: 'Frame make',
    kind: 'short',
    section: 'The firearm',
    help: 'Only where the card names a make against the frame row specifically.',
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'receiver_serial',
    label: 'Receiver serial number',
    kind: 'short',
    section: 'The firearm',
    help: 'On many rifles this is the row that carries the firearm’s number — the receiver is the firearm in law.',
    sensitive: true,
    formOnly: true,
    maxLength: 60,
  },
  {
    key: 'receiver_make',
    label: 'Receiver make',
    kind: 'short',
    section: 'The firearm',
    help: 'Only where the card names a make against the receiver row specifically.',
    formOnly: true,
    maxLength: 60,
  },
  {
    // ⚠️ THE ANSWER THAT USED TO BE AN EMPTY TEXTAREA ON STEP 3.
    //
    // "You already hold a CZ 75 in 9mm — what will this one be?" is the
    // question that gets a second similar firearm refused, and the Registrar
    // asks it whether or not we raised it first. It arrived as
    // `overlap_justification`, a blank long box titled "overlap
    // justification", and almost nobody filled it in.
    //
    // ⚠️ THE OPTIONS ARE RANKED BY motivation-overlap.ts, NOT LISTED HERE. The
    // vocabulary is fixed (OVERLAP_ANGLES) so allowedValues can validate a
    // stored answer; which of them are offered, and in what order, comes from
    // the type, action, calibre class and section of what is already held.
    //
    // Never required: an applicant who holds nothing has no overlap to
    // explain, and the sheet does not render the card at all in that case.
    key: OVERLAP_ANGLE_KEY,
    // ⚠️ TOLD APART FROM THE OWNED-FIREARM SET ON PURPOSE. Both read "What
    // this one will be" / "What it is for" and both sat in the firearm area,
    // and the operator could not tell which was which: "There is two What this
    // one will be. One at the bottom and one that pops up." One is about the
    // firearm being APPLIED FOR against the ones already held; the other is
    // about a firearm already held. The labels now say which.
    label: 'Why this one as well as the ones you hold',
    kind: 'cards',
    section: 'The firearm',
    options: OVERLAP_ANGLES,
    help: 'Tap whichever of these are true. We use them to explain how this firearm differs from the ones you already hold.',
  },
  {
    // ⚠️ OPTIONAL SINCE 2026-09-08, AND PREFILLED. It was `required` and it was
    // the largest single reason an application stalled: it asked the applicant
    // to write the argument the product exists to write for them, about a
    // firearm's calibre and action, which is exactly what
    // motivation-research.service.ts researches and MOTIVATION-REBUILD-BRIEF.md
    // §2.2 forbids asking. Kept so somebody with something specific to say has
    // somewhere to say it.
    key: 'firearm_fit_reason',
    label: 'Anything specific about why this firearm',
    kind: 'long',
    section: 'The firearm',
    help: 'Optional. We write this from the firearm, the calibre and what you told us above.',
    maxLength: 2000,
  },
  // ── YOUR PREMISES ────────────────────────────────────────────────
  //
  // ⚠️ A NEW SECTION, AND THE REGISTRY COULD NOT WRITE ITS PARAGRAPH BEFORE IT
  // EXISTED. Every approved motivation on file carries a "Security and safe
  // storage facility" paragraph — the wall, the gate, the alarm, the armed
  // response, the bars, the safe and who holds its key — and until today the
  // only thing we held was a free-text box asking the applicant to write that
  // paragraph themselves. So it was `required`, and it was the box people
  // stalled on.
  //
  // The block is the Engala questionnaire's security section as discrete taps.
  // Answered once, kept on the member (scope: 'profile'), because a wall does
  // not move between applications. MOTIVATION-INTAKE-PLAN.md §3.6.
  {
    key: 'premises_enclosure',
    label: 'What encloses the property',
    kind: 'choice',
    section: PREMISES_SECTION,
    choices: [
      'Walled',
      'Palisade fence',
      'Electric fence on the wall',
      'Wire or mesh fence',
      'Nothing enclosing it',
    ],
    scope: 'profile',
  },
  {
    key: 'premises_access_control',
    label: 'How people get in',
    kind: 'choice',
    section: PREMISES_SECTION,
    choices: [
      'Remote-controlled gate',
      'Manual gate',
      'Estate or complex boom',
      'Guarded entrance',
      'No gate',
    ],
    scope: 'profile',
  },
  {
    key: 'alarm_present',
    label: 'Is there an alarm?',
    kind: 'yesno',
    section: PREMISES_SECTION,
    scope: 'profile',
  },
  {
    key: 'alarm_company',
    label: 'Who monitors it',
    kind: 'short',
    section: PREMISES_SECTION,
    showIf: { key: 'alarm_present', equals: 'Yes' },
    help: 'The monitoring company, if it is monitored rather than a siren only.',
    scope: 'profile',
    maxLength: 120,
  },
  {
    key: 'armed_response',
    label: 'Do you have armed response?',
    kind: 'yesno',
    section: PREMISES_SECTION,
    scope: 'profile',
  },
  {
    key: 'burglar_bars',
    label: 'Are there burglar bars?',
    kind: 'yesno',
    section: PREMISES_SECTION,
    scope: 'profile',
  },
  {
    key: 'security_gates',
    label: 'Are there security gates?',
    kind: 'yesno',
    section: PREMISES_SECTION,
    scope: 'profile',
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
    section: PREMISES_SECTION,
    required: true,
    scope: 'profile',
  },
  {
    key: 'safe_type',
    label: 'What kind',
    kind: 'choice',
    section: PREMISES_SECTION,
    choices: ['Handgun safe', 'Rifle safe', 'Strongroom', 'Other device'],
    showIf: { key: 'safe_present', equals: 'Yes' },
    required: true,
    scope: 'profile',
  },
  {
    key: 'safe_mounted',
    label: 'Is it mounted?',
    kind: 'yesno',
    section: PREMISES_SECTION,
    showIf: { key: 'safe_present', equals: 'Yes' },
    required: true,
    scope: 'profile',
  },
  {
    // ⚠️ 'Both' TICKS BOTH BOXES ON THE FORM, IT IS NOT A THIRD BOX. Item 69
    // of the SAPS 271 has a wall checkbox and a floor checkbox and no third
    // one; a safe bolted through the corner of a room is genuinely fixed to
    // both, and offering only two choices made that person pick one and
    // understate their own storage. See saps271-map.ts, which is where the
    // value is turned into ticks — adding the choice without teaching the map
    // about it would tick NEITHER box and lose the answer silently on a signed
    // form.
    key: 'safe_mounted_to',
    label: 'Mounted to',
    kind: 'choice',
    section: PREMISES_SECTION,
    choices: ['Wall', 'Floor', 'Both'],
    showIf: { key: 'safe_mounted', equals: 'Yes' },
    required: true,
    scope: 'profile',
  },
  {
    key: 'safe_key_holder',
    label: 'Who can open it',
    kind: 'choice',
    section: PREMISES_SECTION,
    choices: ['Only me', 'Me and one other person in the household'],
    showIf: { key: 'safe_present', equals: 'Yes' },
    help: 'Item 70 asks, and a motivation that answers it reads better than one that does not.',
    scope: 'profile',
  },
  {
    // ⚠️ OPTIONAL SINCE 2026-09-08, AND PREFILLED FROM THE TAPS ABOVE.
    //
    // It was `required` and it was the wrong shape of question: a member who
    // had just told us about their wall, their gate, their alarm, their armed
    // response, their bars and their safe was then asked to write all of it
    // out again in prose, and could not generate until they had. The seven
    // taps above are better data AND a better paragraph, because the writer
    // composes from facts rather than from somebody's second attempt at
    // describing their own house.
    //
    // It survives because nothing a member has already typed is ever thrown
    // away (see MotivationField.retiredChoices for the same discipline one
    // level down), and because somebody with an unusual arrangement — a
    // strongroom inside a walk-in wardrobe, a safe at a business address —
    // still needs somewhere to say so.
    key: 'safe_storage_detail',
    label: 'Anything else about how it is stored',
    kind: 'long',
    section: PREMISES_SECTION,
    help: 'Optional. We write this from your answers above — add anything they do not cover.',
    sensitive: true,
    maxLength: 2000,
  },
  // ⚠️ `other_licensed_firearms` WAS HERE AND IS DELIBERATELY GONE.
  //
  // Operator, item 7 of twelve, 2026-08-24: "Storage and your record —
  // 'Firearms already licensed to you', isn't that the same as 'Firearms you
  // already own' that has everything already in it?" It was. A 1000-character
  // free-text box in this section asked for exactly what the six structured
  // rows in 'Firearms you already own' already hold — and those rows fill
  // THEMSELVES from a photographed licence, so the applicant was being asked
  // to retype, in prose, a list we had already read for them.
  //
  // The defence written here used to be "prose is right for the motivation".
  // It is not right enough to be worth asking twice: the structured rows reach
  // the writer as facts (they are not NEVER_PROMPTED), and the overlap
  // engine's verdict reaches it as argument. The writer was receiving the same
  // firearms from both directions and nothing else read this field at all —
  // a grep for it outside its own declaration returned nothing.
  //
  // Removing a key is safe by construction: sanitiseAnswers logs an
  // unregistered key and drops it, which is the documented behaviour for a
  // stale client, and stored text simply stops being prompted.
  // ── THE SIX HISTORY QUESTIONS, straight off the SAPS 271 ─────────
  //
  // Every one is yes/no with detail if yes, and they are the part of the form
  // applicants most often get wrong. We ask them because a DISCLOSED and
  // EXPLAINED conviction is survivable, while an undisclosed one that surfaces
  // later is fatal — and because it is exactly the kind of thing a motivation
  // should meet head-on rather than leave for the Registrar to discover.
  //
  // ⚠️ ASKED OF EVERYBODY, SINCE 2026-09-08. These six used to be `formOnly`,
  // so on the dealer path they were never asked — and a conviction therefore
  // never reached the writer, which is the single thing a motivation has to
  // address head-on. Seen live: a whole Declarations step that ticked itself
  // complete before anything had been answered.
  //
  // The yes/no itself is in NEVER_PROMPTED so a clean record gives the writer
  // nothing to pad with; the DETAIL is not, so a disclosure reaches it in full.
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
  ...OWNED_FIREARM_FIELDS,
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
    scope: 'profile',
    maxLength: 20,
  },
  // ── RELOADING, ASKED ONCE, EVER ──────────────────────────────────
  //
  // Intake plan §6.4. Every approved hunting pack carries a reloading
  // paragraph where it applies — a handloader who works up a load for a
  // specific rifle and a specific animal is demonstrating exactly the care the
  // section is about — and the registry could not write one because it never
  // asked.
  //
  // ⚠️ PROFILE-SCOPED. Whether somebody reloads is a fact about them, not
  // about an application, and it does not change between the two.
  //
  // ⚠️ AND IT IS NOT A LICENCE QUESTION. Reloading needs no permission; the
  // COMPONENTS do (see CLAUDE.md absolute rule 4 — live ammunition, primers
  // and propellant are banned platform-wide, which is about what we may SELL,
  // not about what an applicant may lawfully do at home). Nothing here asks
  // what anybody holds, and nothing here may start.
  {
    key: 'reloads',
    label: 'Do you reload your own ammunition?',
    kind: 'yesno',
    section: 'About you',
    scope: 'profile',
  },
  {
    key: 'reload_calibres',
    label: 'Which calibres you load for',
    kind: 'short',
    section: 'About you',
    showIf: { key: 'reloads', equals: 'Yes' },
    help: 'The cartridges you actually work up loads for.',
    scope: 'profile',
    maxLength: 200,
  },
  {
    key: 'reload_since',
    label: 'Since when',
    kind: 'date',
    section: 'About you',
    showIf: { key: 'reloads', equals: 'Yes' },
    scope: 'profile',
    // Somebody who has reloaded for twenty years should not tap an arrow
    // twenty times to say so.
    reach: 'far',
    focusOffsetYears: 10,
  },
  {
    key: 'licence_holder_type',
    // ⚠️ FUTURE TENSE. It asked "Are you the main licence holder, or an
    // additional one?" of somebody who does not hold the licence yet — they are
    // applying for it. Operator, 2026-09-08: "needs to change to will you be
    // since I am not the owner yet and only applying now."
    label: 'Will you be the main licence holder, or an additional one?',
    kind: 'choice',
    section: 'The firearm',
    choices: ['Main firearm licence holder', 'Additional firearm licence holder'],
    help: 'Additional applies where the firearm is licensed to someone else in the household and you are applying to possess it too.',
    // ⚠️ REQUIRED, BECAUSE THE FORM ASKS IT AND WE MUST NOT ANSWER IT FOR THEM.
    //
    // Section D of the 271 has two boxes — main holder, additional holder —
    // and neither was being ticked on any application, because this question
    // was optional and nobody ever reached it. The form then went to a DFO
    // with the question blank.
    //
    // Defaulting to "main" would tick the box for the overwhelming majority
    // and be a false statement for the rest. An additional licence under
    // section 12(1) of the Act is issued to somebody living at the same
    // premises as the holder — a real, specific status the applicant knows
    // about and we cannot infer. This module's rule holds: a missing answer
    // leaves a box empty, and section 120(9)(f) makes a wrong one an offence.
    required: true,
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
  /**
   * ⚠️ THE SAME QUESTIONS AS SECTION 13, AND THAT IS DELIBERATE RATHER THAN
   * LAZY. s14(4) is s13's test plus two more, and both of those are argued
   * from facts the section 13 questions already gather — the risk, the
   * existing measures, the premises. What section 14 needs ON TOP is section
   * K's own facts (distances to the nearest neighbour and police station,
   * urban or rural, how many firearms are held), and those live in the common
   * set and in the owned rows, not in a type-specific question.
   *
   * Filled by `s14Fields()` below so the two lists cannot drift.
   */
  S14_RESTRICTED_SELF_DEFENCE: [],
  S13_SELF_DEFENCE: [
    // ── THE CASE, AS CARDS ──────────────────────────────────────────
    //
    // ⚠️ THESE THREE REPLACED THREE EMPTY TEXTAREAS AS THE PRIMARY INPUT.
    // "The circumstances that make you believe you need it" was `required` and
    // 4000 characters wide, and it asked somebody to compose, unaided, the
    // hardest paragraph in the document. The boxes survive below as optional
    // and prefilled; these are what is actually asked.
    //
    // ⚠️ ONLY A TAPPED CARD REACHES THE WRITER, and the applicant signs under
    // it. See motivation-cards.ts for why that is the rule and not a
    // preference.
    {
      key: 's13_reasons',
      label: 'What makes you believe you need it',
      kind: 'cards',
      section: 'Your circumstances',
      options: S13_REASONS,
      help: 'Tap the ones that are true of you.',
      required: true,
      sensitive: true,
    },
    {
      key: 's13_movements',
      label: 'Where you go',
      kind: 'cards',
      section: 'Your circumstances',
      options: S13_MOVEMENTS,
      sensitive: true,
    },
    {
      key: 's13_carry_style',
      label: 'How you would keep it',
      kind: 'cards',
      section: 'Your circumstances',
      options: S13_CARRY_STYLE,
      sensitive: true,
    },
    {
      // Optional and prefilled from the cards above since 2026-09-08 — see the
      // note on the card block. Kept because somebody whose circumstances the
      // cards do not cover still needs somewhere to say so, and because
      // nothing anybody has already typed is ever thrown away.
      key: 'threat_circumstances',
      label: 'Anything else about your circumstances',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Optional. Specific to you — times, places, incidents, routes.',
      sensitive: true,
      maxLength: 4000,
    },
    {
      key: 'daily_movements',
      label: 'Anything else about your routine',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Optional. We write this from what you tapped above.',
      sensitive: true,
      maxLength: 2000,
    },
    {
      key: 'alternatives_considered',
      label: 'What else you have done about it',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Optional. We already have your alarm, armed response and security from Your premises — add anything else.',
      maxLength: 2000,
    },
    // ── SAPS PRECINCT CRIME FIGURES ─────────────────────────────────
    //
    // Operator, 2026-09-07: "is it possible for us to pull the per police
    // station crime stats from SAPS and keep it updated?" The professional
    // motivations we studied all annex the precinct's own figures behind a
    // self-defence application — a general "crime is bad" claim carries no
    // weight (see threat_circumstances' own help text), but SAPS' own count
    // for the station the applicant actually reports to does. See
    // MotivationGenerationService, which fetches CrimeStatsService.precinct()
    // for this station at generation time.
    //
    // NOT required — MotivationPrefillService.stationOffer() fills it from
    // the residential address automatically (CLAUDE.md "Automate It — Do Not
    // Ask"), and a member who has not yet reached that point, or whose
    // address does not resolve to a station, must still be able to generate.
    {
      key: 'police_station',
      label: 'Your nearest police station',
      kind: 'short',
      section: 'Your circumstances',
      help: 'The station whose figures will be cited. We fill this in from your address — change it if it is not the one you actually report to.',
      maxLength: 120,
    },
    // ⚠️ A FINDING WE MADE, CARRIED ON THE APPLICATION — NOT A QUESTION. See
    // COMPETENCY_RENEWS_KEY for the two-gate trick this reuses: formOnly hides
    // it on the dealer path, and a showIf that can never be true on the fill
    // path hides it there too — no answer satisfies both, so this is never
    // asked, on either side, with no new "internal field" concept to keep in
    // step across the wizard's own mirror of isVisible().
    //
    // Written by MotivationPrefillService.stationOffer() the moment it
    // resolves `police_station`, and read back by CrimeStatsService.precinct()
    // at generation time. It has to travel WITH the station name: SAPS station
    // names are unique per province, not nationwide (see CrimeStatsStation),
    // so "Brooklyn" alone is ambiguous and the wrong province's Brooklyn would
    // cite the wrong precinct's figures on a signed application.
    {
      key: 'police_station_province',
      label: 'Province of your nearest police station',
      kind: 'short',
      section: 'Your circumstances',
      // ⚠️ WRITTEN BY US, NEVER ASKED — see `internal`. Was hidden by a
      // formOnly × showIf contradiction against the retired fill_saps271;
      // that trick stopped working the day formOnly stopped gating.
      internal: true,
      maxLength: 60,
    },
    // ── PRESS CLIPPINGS ──────────────────────────────────────────────
    //
    // Operator, 2026-09-07: "pull rss feeds from local papers all over south
    // africa to give full articles regarding crime in that region of the
    // applicant" — printed to LOOK like a cutting (paper, date, headline,
    // picture, standfirst), never the article body, never a link the
    // applicant is expected to type in. See backend/src/news/news.types.ts.
    //
    // ⚠️ NOBODY TYPES INTO THIS BOX. Same two-gate trick as
    // `police_station_province` immediately above: formOnly hides it on the
    // fill-in-for-me path, and a showIf that can never be true hides it on
    // the dealer path too — no answer satisfies both, so no text field for
    // "paste some article ids" ever appears, on either side. The wizard
    // writes the value itself, through the ordinary saveAnswers path, once
    // the member has picked from GET /motivations/:id/incidents.
    /**
     * ⚠️ WRITTEN BY THE AREA PICKER, NEVER TYPED — the same two-gate trick as
     * `police_station_province` and `press_clippings` above it. The member
     * ticks areas on the sheet and `POST :id/areas` stores this; no text box
     * for "paste some area names" ever appears.
     */
    {
      key: TRAVELLED_AREAS_KEY,
      label: 'Areas you travel through',
      kind: 'short',
      section: 'Your circumstances',
      help: 'A JSON array of the areas you ticked, with your reason where you gave one — written by the picker, not typed.',
      internal: true,
      maxLength: TRAVELLED_AREAS_MAX,
    },
    {
      key: PRESS_CLIPPINGS_KEY,
      label: 'Press clippings chosen for the annexure',
      kind: 'short',
      section: 'Your circumstances',
      help: `A JSON array of up to ${PRESS_CLIPPINGS_MAX} chosen article ids — written by the picker, not typed.`,
      // ⚠️ WRITTEN BY THE PICKER, NEVER ASKED — see `internal`. Was hidden by a
      // formOnly × showIf contradiction against the retired fill_saps271.
      internal: true,
      maxLength: 4000,
    },
  ],
  // ── SECTION 15 — OCCASIONAL HUNTER *OR OCCASIONAL SPORTS PERSON* ──
  //
  // ⚠️ IT NOW SERVES BOTH, AND UNTIL 2026-09-08 IT SERVED ONLY ONE. Section
  // 15(2) of the Act covers "an occasional hunter or an occasional sports
  // person", and the chooser has always sold it as "hunts or shoots" — but
  // every question here was about hunting, and `intended_quarry` ("what you
  // intend to hunt with it") was REQUIRED. So somebody who shoots occasionally
  // and holds no dedicated status could not finish the form at all: a required
  // question with no truthful answer, and no way past it.
  //
  // Reported as HANDOFF.md open item 1 and flagged as an operator decision
  // because it changes what somebody signs. Confirmed to land here.
  S15_OCCASIONAL_HUNTER: [
    // ⚠️ THE SPORT CARDS, ON THE SECTION 15 PATH. This is the half that was
    // missing — see the block comment above.
    {
      /**
       * ⚠️ THE ONLY TICK-BOX LEFT IN THIS SECTION, AND IT IS A ROUTER.
       * Operator, 2026-09-09: "we just need to ask if the applicant will be
       * using it for hunting or Sport shooting or both, that the only tick
       * boxes I want to see. and that will decide from which pool of reasons
       * we are going to motivate that firearm."
       *
       * Everything the other card grids used to ask — what you hunt, the
       * country you hunt in, whose land, why you shoot, what you shoot — is
       * generated per firearm CLASS by firearm-uses.service.ts, with the
       * quarry, the terrain and the discipline already in the sentence. The
       * one thing that cannot be generated is which of its two pools this
       * applicant wants drawn from.
       *
       * ⚠️ THE LICENCE TYPE CANNOT ANSWER IT. S15_OCCASIONAL_HUNTER is one
       * value covering the occasional hunter AND the occasional sports
       * shooter, and a dedicated hunter may shoot sport with the same rifle.
       * "Both" is a real answer and it takes both pools.
       */
      key: 'firearm_use_kind',
      label: 'What you will use it for',
      kind: 'cards',
      section: 'Experience',
      options: FIREARM_USE_KIND,
      required: true,
    },
    {
      key: 'hunting_history',
      label: 'Anything else about your experience',
      kind: 'long',
      section: 'Experience',
      help: 'Optional. Attach register pages, permits or photographs if you have them — a record with evidence behind it carries far more weight.',
      maxLength: 3000,
      attachKind: 'SHOOTING_ACTIVITY_LOG',
    },
    {
      // ⚠️ NO LONGER REQUIRED, AND THAT IS THE FIX FOR HANDOFF ITEM 1. An
      // occasional SPORTS shooter hunts nothing, so a required "what you
      // intend to hunt with it" was a question they could not answer and could
      // not get past. The quarry now comes from hunt_game_class, which they
      // are free to leave empty.
      key: 'intended_quarry',
      label: 'Anything specific you intend to hunt',
      kind: 'short',
      section: 'Experience',
      help: 'Optional — we work this out from what you tapped above.',
      maxLength: 200,
    },
    {
      key: 'hunting_locations',
      label: 'Anything else about where you hunt or shoot',
      kind: 'long',
      section: 'Experience',
      help: 'Optional. Properties, provinces, clubs, ranges.',
      maxLength: 1500,
    },
  ],
  S16_DEDICATED_HUNTER: [
    {
      /**
       * ⚠️ THE ONLY TICK-BOX LEFT IN THIS SECTION, AND IT IS A ROUTER.
       * Operator, 2026-09-09: "we just need to ask if the applicant will be
       * using it for hunting or Sport shooting or both, that the only tick
       * boxes I want to see. and that will decide from which pool of reasons
       * we are going to motivate that firearm."
       *
       * Everything the other card grids used to ask — what you hunt, the
       * country you hunt in, whose land, why you shoot, what you shoot — is
       * generated per firearm CLASS by firearm-uses.service.ts, with the
       * quarry, the terrain and the discipline already in the sentence. The
       * one thing that cannot be generated is which of its two pools this
       * applicant wants drawn from.
       *
       * ⚠️ THE LICENCE TYPE CANNOT ANSWER IT. S15_OCCASIONAL_HUNTER is one
       * value covering the occasional hunter AND the occasional sports
       * shooter, and a dedicated hunter may shoot sport with the same rifle.
       * "Both" is a real answer and it takes both pools.
       */
      key: 'firearm_use_kind',
      label: 'What you will use it for',
      kind: 'cards',
      section: 'Experience',
      options: FIREARM_USE_KIND,
      required: true,
    },
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
      key: 'association_joined',
      docSourced: 'ASSOCIATION_CARD',
      // ⚠️ THIS BOX EXISTS BECAUSE THE ONE BELOW WAS BEING FILLED WITH IT.
      // The 271's association block asks when the applicant JOINED the body.
      // Nothing on the form asked that, so saps271-map printed
      // `dedicated_since` — "Dedicated status held since" — into it, and
      // credentialOffer wrote `dedicated_since` from the vault's `joined_on`
      // under an offer line reading "Member since". Three different names for
      // two different facts, collapsed into one box on a form signed under
      // section 120(9)(f). For a SAHGCA or NARFO member they are routinely
      // years apart: you join, and then you qualify.
      //
      // Associations two and three have had "Member there since" from the day
      // they were added. This is the same question for slot one, and it is
      // what the vault's `joined_on` now fills.
      //
      // NOT required. It is one box on the form, the applicant may not
      // remember the day, and a new required field would block applications
      // that were complete yesterday. Left blank it prints blank — see
      // saps271-map, which says so on the row rather than reaching for the
      // nearest date on the form.
      label: 'Member of that association since',
      kind: 'date',
      section: 'Dedicated status',
      help: 'The day you joined the association — which for most members is earlier than the day the dedicated status itself was awarded.',
      focusOffsetYears: -10,
      reach: 'far',
    },
    {
      key: 'dedicated_since',
      docSourced: 'ASSOCIATION_CARD',
      // ⚠️ THE DAY THE STATUS WAS AWARDED, NEVER THE DAY THEY JOINED. See
      // `association_joined` immediately above. This is also what
      // deriveFacts counts `years_dedicated` from, so a join date here does
      // not merely mislabel a box — it makes the motivation itself argue
      // from the wrong number.
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
      // A long-standing SAHGCA or NARFO member may have been dedicated since
      // the nineties, so this one gets the decade strip.
      focusOffsetYears: -10,
      reach: 'far',
    },
    {
      key: 'association_expiry',
      docSourced: 'GOOD_STANDING_LETTER',
      // ⚠️ ITEM 60 ON THE 271, AND IT COMES OFF THE LETTER OF GOOD STANDING.
      // Operator, 2026-08-28: "Expiry dat of accredited associasian should
      // also be inserted from the letter of good standing date. that should
      // have a valid until date." The vault already reads and stores it —
      // GOOD_STANDING sits in neither NO_EXPIRY_ON_THE_PAGE nor NEVER_EXPIRES,
      // so Credential.expiresOn holds the date off the page — and nothing
      // carried it to the form. credentialOffer offers it from there.
      //
      // NOT required: a letter of good standing that carries no validity
      // window is a real document, and demanding a date the applicant does not
      // have would stall the application over a box the form leaves to them.
      label: 'Your association membership is valid until',
      kind: 'date',
      section: 'Dedicated status',
      help: 'The "valid until" date on your letter of good standing. Photograph the letter and we will read it for you.',
      focusOffsetYears: 1,
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
      // Optional and prefilled from the cards above since 2026-09-08. It was
      // `required` and 3000 characters wide, and the UX walkthrough found it
      // rendering as a grey row on the step a DFO actually reads, opening to
      // an empty textarea hinted "Species, terrain, ranges, roughly how many
      // hunts a year" — four questions in one box, which is the composition
      // problem the cards replace.
      key: 'hunting_history',
      label: 'Anything else about your hunting record',
      kind: 'long',
      section: 'Experience',
      help: 'Optional. Attach register pages, permits or photographs if you have them — a record with evidence behind it carries far more weight.',
      maxLength: 3000,
      attachKind: 'SHOOTING_ACTIVITY_LOG',
    },
    {
      key: 'activity_record',
      label: 'Anything else about your association activities',
      kind: 'long',
      section: 'Experience',
      help: 'Optional. Hunts logged, shoots attended, courses, committee roles.',
      maxLength: 2000,
    },
  ],
  S16_DEDICATED_SPORT: [
    {
      /**
       * ⚠️ THE ONLY TICK-BOX LEFT IN THIS SECTION, AND IT IS A ROUTER.
       * Operator, 2026-09-09: "we just need to ask if the applicant will be
       * using it for hunting or Sport shooting or both, that the only tick
       * boxes I want to see. and that will decide from which pool of reasons
       * we are going to motivate that firearm."
       *
       * Everything the other card grids used to ask — what you hunt, the
       * country you hunt in, whose land, why you shoot, what you shoot — is
       * generated per firearm CLASS by firearm-uses.service.ts, with the
       * quarry, the terrain and the discipline already in the sentence. The
       * one thing that cannot be generated is which of its two pools this
       * applicant wants drawn from.
       *
       * ⚠️ THE LICENCE TYPE CANNOT ANSWER IT. S15_OCCASIONAL_HUNTER is one
       * value covering the occasional hunter AND the occasional sports
       * shooter, and a dedicated hunter may shoot sport with the same rifle.
       * "Both" is a real answer and it takes both pools.
       */
      key: 'firearm_use_kind',
      label: 'What you will use it for',
      kind: 'cards',
      section: 'Experience',
      options: FIREARM_USE_KIND,
      required: true,
    },
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
      key: 'association_joined',
      docSourced: 'ASSOCIATION_CARD',
      // ⚠️ THIS BOX EXISTS BECAUSE THE ONE BELOW WAS BEING FILLED WITH IT.
      // The 271's association block asks when the applicant JOINED the body.
      // Nothing on the form asked that, so saps271-map printed
      // `dedicated_since` — "Dedicated status held since" — into it, and
      // credentialOffer wrote `dedicated_since` from the vault's `joined_on`
      // under an offer line reading "Member since". Three different names for
      // two different facts, collapsed into one box on a form signed under
      // section 120(9)(f). For a SAHGCA or NARFO member they are routinely
      // years apart: you join, and then you qualify.
      //
      // Associations two and three have had "Member there since" from the day
      // they were added. This is the same question for slot one, and it is
      // what the vault's `joined_on` now fills.
      //
      // NOT required. It is one box on the form, the applicant may not
      // remember the day, and a new required field would block applications
      // that were complete yesterday. Left blank it prints blank — see
      // saps271-map, which says so on the row rather than reaching for the
      // nearest date on the form.
      label: 'Member of that association since',
      kind: 'date',
      section: 'Dedicated status',
      help: 'The day you joined the association — which for most members is earlier than the day the dedicated status itself was awarded.',
      focusOffsetYears: -10,
      reach: 'far',
    },
    {
      key: 'dedicated_since',
      docSourced: 'ASSOCIATION_CARD',
      // ⚠️ THE DAY THE STATUS WAS AWARDED, NEVER THE DAY THEY JOINED. See
      // `association_joined` immediately above. This is also what
      // deriveFacts counts `years_dedicated` from, so a join date here does
      // not merely mislabel a box — it makes the motivation itself argue
      // from the wrong number.
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
      // A long-standing SAHGCA or NARFO member may have been dedicated since
      // the nineties, so this one gets the decade strip.
      focusOffsetYears: -10,
      reach: 'far',
    },
    {
      key: 'association_expiry',
      docSourced: 'GOOD_STANDING_LETTER',
      // ⚠️ ITEM 60 ON THE 271, AND IT COMES OFF THE LETTER OF GOOD STANDING.
      // Operator, 2026-08-28: "Expiry dat of accredited associasian should
      // also be inserted from the letter of good standing date. that should
      // have a valid until date." The vault already reads and stores it —
      // GOOD_STANDING sits in neither NO_EXPIRY_ON_THE_PAGE nor NEVER_EXPIRES,
      // so Credential.expiresOn holds the date off the page — and nothing
      // carried it to the form. credentialOffer offers it from there.
      //
      // NOT required: a letter of good standing that carries no validity
      // window is a real document, and demanding a date the applicant does not
      // have would stall the application over a box the form leaves to them.
      label: 'Your association membership is valid until',
      kind: 'date',
      section: 'Dedicated status',
      help: 'The "valid until" date on your letter of good standing. Photograph the letter and we will read it for you.',
      focusOffsetYears: 1,
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
      // Optional and prefilled from the cards above since 2026-09-08 — the
      // record itself is what the attached scorecards and register pages show,
      // and asking somebody to retype it in prose alongside them was asking
      // twice for the same evidence.
      key: 'competition_record',
      label: 'Anything else about your record',
      kind: 'long',
      section: 'Experience',
      help: 'Optional. Attach scorecards, targets or your attendance register — that is the annexure which shows you actually shoot.',
      maxLength: 3000,
      attachKind: 'SHOOTING_ACTIVITY_LOG',
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
      // NOT A QUESTION — see COMPETENCY_RENEWS_KEY. Written by the renewal
      // one-tap when the Licence Centre can see that this is the last licence
      // holding a competency up, read by the checklist, and shown to nobody as
      // a box to fill in. The section is an existing one on purpose: a new
      // section name with no wizard step is exactly what
      // frontend/lib/wizard-coverage.spec.ts exists to catch, and this field
      // has no step precisely because it has no question.
      key: COMPETENCY_RENEWS_KEY,
      label: 'Your competency in this category runs to this licence',
      kind: 'yesno',
      section: 'The existing licence',
      // ⚠️ ONE FLAG NOW, WHERE TWO CONTRADICTORY ONES USED TO DO THE JOB.
      //
      // This was `formOnly` (wants the fill path) set against `showIf` (wants
      // the dealer path), so no answer satisfied both. That was written because
      // isVisible() had a MIRROR on the frontend and a purpose-built "internal"
      // flag would have had to be honoured by both — two implementations, with
      // the failure mode being a Yes/No box asking a member something we had
      // already worked out from their own documents.
      //
      // Both halves of that reasoning are now gone: formOnly stopped gating
      // (brief §2.6), which broke the contradiction outright, and the mirror is
      // retired in favour of the server-computed state in
      // motivation-sheet.service.ts. `internal` is honoured in exactly one
      // place, so it is now the simpler AND the safer of the two.
      internal: true,
    },
    {
      // Optional since 2026-09-08. A renewal turns on two facts — the purpose
      // has not changed, and the applicant is still active — and both are
      // already asked as yes/no above. Requiring a 3000-character essay on top
      // of them made the shortest application in the product the one with the
      // longest compulsory box.
      key: 'continued_use',
      label: 'Anything else about how you have used it',
      kind: 'long',
      section: 'The existing licence',
      help: 'Optional. What you have actually done with it since it was issued.',
      maxLength: 3000,
    },
  ],
};

/**
 * ⚠️ SECTION 14 SHARES SECTION 13'S QUESTIONS BY ASSIGNMENT, NOT BY COPY. Two
 * hand-kept lists of the same questions is how one of them ends up a question
 * short, and the member on the short one is asked less about the harder
 * application.
 */
(TYPE_FIELDS as Record<MotivationLicenceType, readonly MotivationField[]>)[
  MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE
] = TYPE_FIELDS[MotivationLicenceType.S13_SELF_DEFENCE];

/**
 * The two sections that are about self-defence.
 *
 * ⚠️ ONE PREDICATE, BECAUSE THERE WERE EIGHT `=== S13_SELF_DEFENCE` BRANCHES
 * AND SECTION 14 HAD TO JOIN EVERY ONE OF THEM. Crime figures, the areas
 * picker, the press cuttings, the overlap wording, the reason angles and the
 * document scope all key off "is this a self-defence application" and all of
 * them said it by naming section 13. A section 14 applicant needs the precinct
 * figures MORE than a section 13 one, not less — s14(4) asks them to show a
 * handgun is not enough where they live — and a branch missed here is a
 * section that silently loses its evidence.
 *
 * ⚠️ NOT "is it NOT hunting or sport". A section 24 renewal of a section 13
 * licence is a self-defence document too, and it is not in this list, because
 * the renewal path reads its own underlying section. Adding it here would give
 * a hunting renewal crime statistics.
 */
export const SELF_DEFENCE_TYPES: readonly MotivationLicenceType[] = [
  MotivationLicenceType.S13_SELF_DEFENCE,
  MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
];

export function isSelfDefence(t: MotivationLicenceType): boolean {
  return SELF_DEFENCE_TYPES.includes(t);
}

// ────────────────────────────────────────────────────────────────────
// THE FOUR FACTS THAT DECIDE WHICH HEADINGS A DOCUMENT CARRIES.
//
// MOTIVATION-GUIDE-BOOK Part 4.2 fixes twelve headings and Part 5 says which
// are omitted per section of the Act. Three of the twelve are omitted on the
// APPLICANT's facts rather than on the licence type, and a fourth chooses
// between two purpose headings. `planFor` takes them as options because
// motivation-structure.ts is pure and never sees an answer blob; they are
// computed here, next to the field keys they read, so a renamed key breaks one
// place.
// ────────────────────────────────────────────────────────────────────

/**
 * Does the applicant hold at least one licensed firearm?
 *
 * Drives heading 6, "Firearms already licensed to me". False is a first
 * application, where the book puts "No firearm is currently licensed to me" in
 * the introduction instead — a sentence, because there is no table to draw and
 * no gap to argue.
 */
export function holdsFirearms(answers: Record<string, string>): boolean {
  for (let n = 1; n <= OWNED_ROWS; n++) if (ownedRowTaken(answers, n)) return true;
  return false;
}

/** The six SAPS 271 declaration items, G.62 to G.67. */
const DECLARATION_KEYS = [
  'history_conviction',
  'history_pending_case',
  'history_lost_stolen',
  'history_negligence',
  'history_declared_unfit',
  'history_confiscated',
] as const;

/**
 * Is any declaration answer a Yes?
 *
 * Drives heading 10, "My record". ⚠️ THE HEADING IS OMITTED ENTIRELY WHEN
 * EVERY ANSWER IS NO, and the document says nothing — book Part 5.1 brief 10.
 * A paragraph volunteering "I have no criminal record" is banned twice over:
 * SAPS runs that check themselves, and an unevidenced claim of good character
 * is exactly what the reviewer is reading the annexures to decide.
 */
export function hasDeclaredRecord(answers: Record<string, string>): boolean {
  return DECLARATION_KEYS.some(
    (k) => (answers[k] ?? '').trim().toLowerCase() === 'yes',
  );
}

/**
 * Does the applicant belong to an accredited association?
 *
 * Drives heading 8 on a section 15 and on a renewal. The two section 16 routes
 * carry that heading always, because dedicated status is what they turn on.
 */
export function isAssociationMember(answers: Record<string, string>): boolean {
  return (answers.association_name ?? '').trim() !== '';
}

/**
 * Which variant a section 15 application is.
 *
 * ⚠️ FAILURE MODE 5 IS TREATING SECTION 15 AS HUNTING ONLY. It is hunting OR
 * sport, and the heading, the brief and half the vocabulary differ. Book Part
 * 5.3: "The generator picks one from the applicant's answer; the document
 * never mixes both unless the applicant genuinely does both, and then hunting
 * leads" — so this returns ONE variant, and hunting wins a tie.
 *
 * Hunting is also the default when neither set of cards was tapped: the type
 * is named for the occasional hunter, and a document with the hunting heading
 * and thin facts is a weaker application, where one with the sport heading and
 * hunting facts is a wrong one.
 */
export function s15Purpose(
  answers: Record<string, string>,
): 'hunting' | 'sport' {
  const any = (keys: readonly string[]) =>
    keys.some((k) => (answers[k] ?? '').trim() !== '');
  if (any(['hunt_game_class', 'hunt_terrain', 'hunt_where', 'hunt_reasons']))
    return 'hunting';
  if (any(['sport_reasons', 'sport_formats'])) return 'sport';
  return 'hunting';
}

/** Human label for the document header and the UI. */
export const LICENCE_TYPE_LABELS: Record<MotivationLicenceType, string> = {
  S13_SELF_DEFENCE: 'Section 13 — Self-defence',
  S14_RESTRICTED_SELF_DEFENCE: 'Section 14 — Self-defence, restricted firearm',
  S15_OCCASIONAL_HUNTER: 'Section 15 — Occasional hunter / sport shooter',
  S16_DEDICATED_HUNTER: 'Section 16 — Dedicated hunter',
  S16_DEDICATED_SPORT: 'Section 16 — Dedicated sport shooter',
  S24_RENEWAL: 'Section 24 — Renewal',
};

/** Every field for a licence type, common first, in wizard order. */
/**
 * Common questions a given licence type is NOT asked.
 *
 * ⚠️ COMMON_FIELDS IS NOT COMMON TO ALL FIVE, AND TWO OF ITS QUESTIONS WERE
 * BEING PUT TO A RENEWAL THAT CANNOT USE EITHER.
 *
 *   firearm_source   "Where is this firearm coming from?" — of somebody who
 *                    already holds the licence for it. Everything downstream
 *                    already knew: motivation-documents skips the private-sale
 *                    branch for S24 by name, EXPECTED.S24_RENEWAL is empty, and
 *                    the checklist says in capitals that "a renewal has no
 *                    source document … asking where it is coming from would be
 *                    asking them to prove a transfer that is not happening".
 *                    Only the screens the member sees were missed.
 *
 *   fill_saps271     GONE FROM HERE because the field itself is retired, not
 *                    because a renewal stopped needing the exemption — see
 *                    RETIRED_FIELDS. It is no longer in COMMON_FIELDS, so
 *                    there is nothing for this set to filter out. The reason
 *                    it was listed still holds and is now enforced where it
 *                    belongs: the SAPS 271 is an application for a NEW licence
 *                    under sections 13 to 20, a renewal is lodged on the SAPS
 *                    518(a), and motivation-render.service.ts refuses a 271
 *                    for an S24 by licence type.
 *
 * ⚠️ THIS FILTERS WHAT IS ASKED, NEVER WHAT IS ACCEPTED. fieldByKey below
 * deliberately searches the UNFILTERED list, so a draft saved before this — or
 * one carrying either key for any other reason — still loads and still saves.
 * Dropping it there instead would make the wizard's next autosave, which
 * resends the whole blob, delete the applicant's own answer and show them an
 * error about it. Same rule as LEGACY_OWNED_FIELDS.
 */
const NOT_ASKED_BY_TYPE: Partial<
  Record<MotivationLicenceType, ReadonlySet<string>>
> = {
  S24_RENEWAL: new Set<string>([FIREARM_SOURCE_KEY]),
  /**
   * ⚠️ RELOADING IS HUNTING AND SPORT CONTENT, AND IT REACHED AN S13 AS
   * "EXPERIENCE". The three questions are profile-scoped and were asked of
   * everybody, so a self-defence applicant answered them once for a hunting
   * application and the writer then had them in the pack — MO000071 argued
   * from handloading in a section 13. A DFO reading a self-defence motivation
   * that discusses working up loads is reading about a hobby, not a threat.
   *
   * ⚠️ FILTERED, NOT DELETED. NOT_ASKED_BY_TYPE removes what is ASKED and
   * never what is ACCEPTED — `fieldByKey` searches the unfiltered list — so a
   * member who answered these on a hunting application keeps the answer, and
   * their S13 draft still saves. `documentScope` is the other half: it refuses
   * the words even if something else puts them in the pack.
   */
  S13_SELF_DEFENCE: new Set<string>([
    'reloads',
    'reload_calibres',
    'reload_since',
  ]),
};

/**
 * Every field this licence type DEFINES, including the ones it is not asked.
 *
 * ⚠️ NOT FOR RENDERING — fieldsFor is. This is for the two callers that must
 * see a question the type has stopped asking: fieldByKey, so an older draft
 * still saves, and the registry-integrity suite, which checks that a showIf
 * clause is well-formed rather than that it is reachable.
 */
export function allFieldsFor(
  type: MotivationLicenceType,
): readonly MotivationField[] {
  return [...COMMON_FIELDS, ...(TYPE_FIELDS[type] ?? [])];
}

export function fieldsFor(
  type: MotivationLicenceType,
): readonly MotivationField[] {
  const skip = NOT_ASKED_BY_TYPE[type];
  const all = allFieldsFor(type);
  return skip ? all.filter((f) => !skip.has(f.key)) : all;
}

/**
 * Fast lookup by key, for merging an interview answer back into the blob.
 *
 * ⚠️ IT ALSO FINDS RETIRED KEYS, AND THAT IS WHAT KEEPS OLD DRAFTS ALIVE.
 * sanitiseAnswers decides what it will accept by asking this function, so a
 * key that has stopped being ASKED must still be findable here or the wizard's
 * next autosave — which resends the whole blob — drops the applicant's own
 * answer and shows them an error about it. See LEGACY_OWNED_FIELDS.
 */
export function fieldByKey(
  type: MotivationLicenceType,
  key: string,
): MotivationField | undefined {
  // ⚠️ THE UNFILTERED LIST, DELIBERATELY — see NOT_ASKED_BY_TYPE. A question
  // this type has stopped being ASKED must still be findable here, or the
  // wizard's next autosave drops an answer an older draft already holds.
  return allFieldsFor(type).find((f) => f.key === key) ?? LEGACY_BY_KEY.get(key);
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
  // ⚠️ `internal` IS THE ONLY UNCONDITIONAL HIDE LEFT, and it is about fields
  // we FILL IN, never about a form the applicant may or may not want. See the
  // flag itself.
  if (field.internal) return false;

  // ⚠️ formOnly NO LONGER DECIDES WHAT IS ASKED — 2026-09-08, brief §2.6.
  //
  // It used to hide every SAPS-271-only field behind the fill_saps271 opt-in,
  // and roughly half the registry hung off that one tap: phones, postal codes,
  // marital status, the spouse, the six history questions. The 271 is no
  // longer optional (Part F is filled by source route instead — see
  // saps271.service.ts), so there is nothing left for the gate to gate.
  //
  // ⚠️ AND THE FLAG ITSELF STAYS, DOING ITS OTHER JOB. formOnly is still what
  // keeps a value out of the fact pack (factPackFields below): a dialling
  // code, a postal code and a spouse's ID number are PII with no argumentative
  // use, and six "No" answers to the history questions are an invitation to
  // pad the document with a clean record, which ABSOLUTE RULE 7 forbids. One
  // flag, one job, from here on.
  if (!field.showIf) return true;
  const chosen = (answers[field.showIf.key] ?? '').trim();

  // A gate on "has anything been tapped" — see showIf.hasAny.
  if (field.showIf.hasAny) return chosen !== '';

  if (field.showIf.equals === undefined) return true;
  if (chosen === field.showIf.equals) return true;
  // ⚠️ A MULTI ANSWER IS A LIST, AND EQUALITY CANNOT SEE INTO IT.
  //
  // `discipline` became kind: 'multi' and is stored comma-joined in the
  // registry's own order — "vlakteskiet-chasa, other". `discipline_other`
  // ("Name the discipline") is gated on `equals: 'other'`, which that string
  // is not. So a member who picked Something Else AND any real discipline
  // could never be asked to name it, and on the section 16 sport path that
  // field is `required: true` — required and unaskable at the same time, which
  // also drops it silently out of requiredKeys.
  //
  // Exact match is tried first so nothing that worked changes: this only ever
  // opens a gate that was wrongly shut. A single-choice answer is never a
  // comma-joined list, so there is nothing for it to widen.
  return chosen
    .split(',')
    .map((part) => part.trim())
    .includes(field.showIf.equals);
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
 * motivation-overlap reads it and the writer argues from it; but a serial and
 * a licence number are registry identifiers with no narrative use whatever,
 * and neither is the date another licence happens to expire on. Type, calibre,
 * make and MODEL stay, because "you already own a Glock 17 in 9mm" is the
 * whole overlap argument. The numbers and the dates do not.
 *
 * The two legacy serial keys stay listed even though they are no longer asked:
 * a blob written before the collapse still carries them, and the fact pack is
 * built from the stored answers.
 */
/**
 * ⚠️ THE SIX HISTORY YES/NOS ARE HERE NOW, AND THIS IS THE ONLY THING KEEPING
 * A CLEAN RECORD OUT OF THE DOCUMENT — 2026-09-08.
 *
 * They used to be `formOnly`, which did the job as a side effect of hiding
 * them behind the SAPS 271 opt-in. That had a cost nobody could see: on the
 * dealer path they were never ASKED either, so a conviction never reached the
 * writer at all — the one thing a motivation has to meet head-on. They are now
 * asked of everybody (brief §2.5), and the anti-padding half of the old
 * behaviour is stated here, on its own, where it can be read.
 *
 * ⚠️ THE BARE YES/NO ONLY — THE `_detail` BOXES ARE DELIBERATELY NOT LISTED.
 * That asymmetry IS the rule the acceptance criterion states: a "No"
 * contributes nothing (the yes/no is never prompted, and its detail box is
 * hidden by showIf so it is empty), while a "Yes" reaches the writer in full
 * through the detail. Six "No" answers in the fact pack would be an invitation
 * to pad the document with "the applicant has no convictions, no pending
 * cases, no lost firearms" — ABSOLUTE RULE 7 forbids exactly that.
 *
 * The `$` anchors are load-bearing: `history_conviction` matches,
 * `history_conviction_detail` and `history_conviction_station` do not.
 *
 * ⚠️ THE CONTACT DETAILS AND THE SPOUSE'S NAME ARE HERE FOR THE SAME REASON,
 * AND THEY WERE ALMOST LOST IN THE SAME CHANGE. `home_telephone`,
 * `work_telephone`, `cellphone`, `postal_address` and `spouse_name` were kept
 * from the writer by being `formOnly` — which was doing two unrelated jobs at
 * once, and taking the wizard-visibility job away from it silently took the
 * privacy one with it. They are PII with no argumentative value whatever: a
 * telephone number is not a reason anybody needs a firearm, and a spouse's
 * name belongs to somebody who is not the applicant and has not asked us for
 * anything. There is no reason for either to reach a model at all.
 *
 * `spouse_id_number`, the postal codes and the dialling codes are still
 * `formOnly`, so they are still excluded by that route and are deliberately
 * not repeated here.
 */
const NEVER_PROMPTED =
  /^(existing_firearm_\d+_(serial|frame_serial|barrel_serial|licence_no|expiry)|firearm_source|history_(conviction|pending_case|lost_stolen|negligence|declared_unfit|confiscated)|home_telephone|work_telephone|cellphone|postal_address|spouse_name)$/;

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
      // ⚠️ `internal` HAS NO ESCAPE HATCH, unlike formOnly's. A field we filled
      // in from a lookup is never an argument for needing a firearm, and there
      // is no case — as there was for firearm_serial — where the writer needs
      // one to do its job.
      !f.internal &&
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

    // press_clippings is a JSON array of ids, never free text, and the two
    // things that make an array wrong — not JSON, or more than the operator's
    // limit — are refused rather than silently truncated. Truncating JSON
    // does not produce a shorter valid answer, it produces a corrupt one, and
    // a `.slice(0, cap)` a few lines below would do exactly that.
    if (key === PRESS_CLIPPINGS_KEY) {
      if (!trimmed) {
        answers[key] = '';
        continue;
      }
      let ids: string[] | null = null;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (
          Array.isArray(parsed) &&
          parsed.every((x) => typeof x === 'string' && x.trim())
        ) {
          ids = parsed.map((x) => (x as string).trim());
        }
      } catch {
        ids = null;
      }
      if (!ids || ids.length > PRESS_CLIPPINGS_MAX) {
        rejected.push(key);
        refused.push(key);
        continue;
      }
      answers[key] = JSON.stringify(ids);
      continue;
    }

    // A choice must be one of the offered choices. This is not defensive
    // tidiness: these values are printed into boxes on a form the applicant
    // signs, so an arbitrary string arriving from a hand-rolled request would
    // become a false statement on a firearm licence application.
    // ⚠️ `cards` IS STORED EXACTLY LIKE `multi`, AND THAT IS THE WHOLE POINT
    // OF THE DECISION. A comma list in the offered order means showIf,
    // allowedValues, the fact pack and every existing reader work unchanged —
    // the new kind is a rendering and a meaning, never a storage format.
    if (field.kind === 'multi' || field.kind === 'cards') {
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
  // ⚠️ THE CARD KEYS, NOT THE SENTENCES. What is stored, matched by showIf and
  // compared on save is `key`; the sentence is display and is free to be
  // reworded (§9.2 review) without invalidating a stored answer. Reading
  // sentences here would make every rewording a silent data loss on the next
  // autosave — exactly the failure retiredChoices exists to prevent one level
  // down.
  if (field.options) return field.options.map((o) => o.key);
  if (field.optionSource === 'shooting-disciplines') {
    const values = disciplinesInScope(field.optionScope).map((d) => d.value);
    // "Something else" is a real stored value, and the field that describes it
    // hangs off it via showIf — so it has to be accepted, not just offered.
    return field.allowOther ? [...values, DISCIPLINE_OTHER] : values;
  }
  // ⚠️ RETIRED VALUES ARE ALLOWED, NEVER OFFERED. See retiredChoices.
  const offered = field.choices ?? YES_NO;
  return field.retiredChoices?.length
    ? [...offered, ...field.retiredChoices]
    : offered;
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
