import {
  CredentialKind,
  MotivationLicenceType,
  MotivationUploadKind,
} from '@prisma/client';
import { fieldsFor, ownedRowTaken, OWNED_ROWS } from './motivation-fields';
import { competencyCovers } from './motivation-upload-row';
import { endorsementNeed } from './motivation-eligibility';
import { normaliseFirearmType } from './saps-vocabulary';
import {
  type Endorsement,
  ENDORSEMENTS,
  parseEndorsements,
} from '../common/sa-competency';
import { answerValue, isCardPlaceholder } from '../common/card-placeholder';

// ────────────────────────────────────────────────────────────────────
// WHAT THE LICENCE CENTRE ALREADY KNOWS.
//
// A member who has loaded their competency certificate and their firearm
// licences into the vault has already told us the competency number and every
// make, calibre and serial they own. Asking them to type it all again into a
// motivation is asking them to transcribe their own documents twice — and
// transcription is where wrong serials come from.
//
// PURE. No Nest, no Prisma, no clock. It is handed already-decrypted rows and
// returns an OFFER; the service does the reading and the writing. That is the
// same shape as motivation-profile.ts, deliberately, because the two answer
// the same question from different sources and the wizard shows them the same
// way.
//
// ⚠️ READ-ONLY, IN ONE DIRECTION. Nothing here writes a Credential. The vault's
// confirmedAt invariant has exactly one owner — confirmExpiry — and a second
// writer would be the end of it.
//
// ⚠️ NEVER OVERWRITES AN ANSWER. Same rule as the profile offer: a form that
// contradicts what the applicant typed is worse than one they typed twice.
// ────────────────────────────────────────────────────────────────────

/** One vault row, already decrypted by the caller. */
export interface CredentialSource {
  id: string;
  kind: string;
  title: string;
  /** yyyy-mm-dd, or null. */
  expiresOn: string | null;
  /**
   * The date PRINTED on the document as its start, yyyy-mm-dd, or null.
   *
   * ⚠️ THE VAULT ALREADY HELD THIS AND NOTHING ASKED FOR IT. `competency_issued`
   * is a required box on the 271 and the Licence Centre reads it off the
   * certificate at upload — so a member with a photographed competency was
   * retyping a date we were already storing.
   *
   * ⚠️ OPTIONAL, AND ONLY BECAUSE ABSENT AND NULL MEAN THE SAME THING HERE.
   * A caller that does not hold an issue date and a document that has none are
   * indistinguishable to every rule below — both offer nothing.
   */
  issuedOn?: string | null;
  /** The extraction map: licence_number, make, calibre, frame_serial, … */
  details: Record<string, string>;
  /** ⚠️ FALSE MEANS DO NOT OFFER IT. An unconfirmed date was never checked. */
  confirmed: boolean;
  /**
   * The vault stands behind this row's dates.
   *
   * ⚠️ CONFIRMED **OR** DATED BY US, AND THE SECOND HALF IS NEW. Until
   * 2026-08-25 the only way a date became trustworthy was a member ticking a
   * box, so `confirmed` was the whole test. The Document Centre now writes and
   * ARMS dates itself — `dateSource` set, `confirmedAt` still null, reminders
   * firing on it — which is the NORMAL state for a phone upload. Reading only
   * `confirmed` therefore withheld every date on every ordinary member's vault
   * while the reminder sweep was already acting on the same value. Same
   * predicate as the sweep, and as auto-link's candidate query.
   *
   * ⚠️ OPTIONAL, AND IT FALLS BACK TO `confirmed`. A caller that has not been
   * taught about armed dates is asking the old question, and the old answer is
   * the safe one: a tick is always a settled date, so falling back can only
   * ever withhold a value, never volunteer one nobody stands behind.
   */
  dateSettled?: boolean;
}

export interface CredentialOfferItem {
  /** The answer key this fills. */
  key: string;
  label: string;
  value: string;
  /** Which vault document it came from, in the member's own words. */
  from: string;
  credentialId: string;
}

export interface CredentialOffer {
  /** Ready to write, keyed by answer key. */
  values: Record<string, string>;
  items: CredentialOfferItem[];
  /** Vault documents we looked at but could take nothing from, and why. */
  skipped: { title: string; why: string }[];
  /** Nothing in the vault at all — the wizard says so rather than going quiet. */
  empty: boolean;
}

/** The kinds that describe one firearm the member already holds. */
const LICENCE_KINDS = new Set(['FIREARM_LICENCE']);

/** Kinds that carry a competency number. */
const COMPETENCY_KINDS = new Set(['COMPETENCY_CERTIFICATE']);


/**
 * "SECTION 16" on a licence card → the `section_held` card key, or ''.
 *
 * ⚠️ '' RATHER THAN A GUESS. A card whose section row did not read, or read as
 * something this does not recognise, leaves the row unanswered — and the
 * document then says nothing at all about that firearm's section, which is the
 * correct output. Mapping an unknown to "section 16" because most of them are
 * would reinstate exactly the failure the field was added to stop.
 */
export function sectionCardKey(raw: string): string {
  const m = /\b(?:s(?:ection)?\s*)?(13|15|16|17|20)\b/i.exec(raw ?? '');
  return m ? `section_${m[1]}` : '';
}

/**
 * How many `existing_firearm_N_*` rows the registry carries.
 *
 * ⚠️ RE-EXPORTED, NOT DECLARED. It was declared here and the registry it
 * describes lives in motivation-fields.ts, so the two could disagree — and a
 * disagreement in this direction is silent: the loop below simply stops
 * offering at six while the form shows fourteen empty rows. The registry owns
 * the number.
 */
export { OWNED_ROWS };

/**
 * A Date to yyyy-mm-dd, in UTC.
 *
 * Three lines rather than an import from licence-centre/, so the dependency
 * between the two modules stays pointing one way at the source level as well
 * as in the Nest graph. UTC because that is the day boundary the vault's
 * expiry columns are written and compared on.
 */
export function toIsoDay(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Does this answer key hold a DATE?
 *
 * ⚠️ SUFFIX-MATCHED ON PURPOSE, and deliberately wider than what this file
 * writes today. The only date credentialOffer currently fills is "Member
 * since" — a past date that arms nothing — but the rule it enforces is
 * "unconfirmed documents do not supply dates", and a rule that has to be
 * remembered every time somebody adds an offer() call is a rule that will be
 * forgotten. Anything that looks like a date is treated as one.
 *
 * ⚠️ `_joined` WAS MISSING AND THE HOLE WAS ALREADY OPEN. `association_2_joined`
 * and `association_3_joined` have been in the registry since 2026-08-20, are
 * `kind: 'date'`, and are filled by credentialOffer off the vault's `joined_on`
 * — and not one of them matched this pattern, so the settled gate skipped them
 * and a date off a document nobody stands behind went onto the form. It was
 * invisible because the rule this function enforces is spelled out only here.
 * Adding slot one's `association_joined` would have widened it by a third.
 */
export function isDateKey(key: string): boolean {
  return /(_since|_issued|_expiry|_expires|_date|_joined|_on)$/.test(key);
}

/**
 * SAPS's own endorsement wording, rendered as the registry's own labels.
 *
 * ⚠️ THE OUTPUT IS THE FIELD'S OWN CHOICE LIST, BY CONSTRUCTION. `competency_for`
 * is a MULTI constrained to `ENDORSEMENT_LABELS`, and the field validator bins
 * the WHOLE key if any comma part is not a current choice — so a raw copy of a
 * photographed line would silently discard the answer. Going through
 * parseEndorsements means the only strings that can leave here are labels the
 * box already offers.
 *
 * ⚠️ AND '' IS THE RIGHT ANSWER FOR AN UNREADABLE LINE. offer() drops empties,
 * so an unparseable certificate leaves the applicant to tick the boxes — which
 * is what they would have done anyway, and is a different outcome from us
 * writing a guess they then sign.
 *
 * In registry order and de-duplicated, so two readings of one certificate
 * produce the same string.
 */
function endorsementLabels(covers: string): string {
  const held = new Set(parseEndorsements(covers ?? ''));
  if (!held.size) return '';
  return ENDORSEMENTS.filter((e) => held.has(e.value))
    .map((e) => e.label)
    .join(', ');
}

/**
 * The first key that carries a real reading, skipping the ones the card
 * filled in to say there is nothing there.
 *
 * ⚠️ THE PLACEHOLDER TEST BELONGS IN THE FALLBACK CHAIN, NOT ONLY AT THE END
 * OF IT. `first(details, 'frame_serial', 'serial')` on a card reading
 * "Frame Serial No NONE" used to return NONE and stop — so the fallback key,
 * which may well hold a real number, was never consulted. Skipping the
 * placeholder is what makes the chain a chain. See common/card-placeholder:
 * the readers and the vault keep the card verbatim; this is the answer
 * boundary, where NONE stops being a value.
 */
function first(details: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = answerValue(details[k]);
    if (v) return v;
  }
  return '';
}


/**
 * Which dedicated status a document actually awards.
 *
 * 'unknown' is a real answer and the common one — see dedicatedStatusFits.
 */
export type DedicatedDiscipline =
  | 'sport'
  | 'hunter'
  | 'professional'
  | 'both'
  | 'unknown';

/**
 * Read the discipline off a vault reading.
 *
 * ⚠️ IT COMES OUT OF `status_type` IN THE DETAILS BLOB, AND NOWHERE ELSE.
 * `Credential.disciplineType` looks like the column for this and is not: its
 * schema comment claimed 'DEDICATED_SPORT' | 'DEDICATED_HUNTER' |
 * 'PROFESSIONAL_HUNTER' | 'BOTH', but the 2026-08-20 backfill wrote
 * CredentialKind NAMES into it, and since 2026-08-24 the only writer —
 * DISCIPLINE_TYPE in vault-adoption.service.ts — writes 'ASSOCIATION_CARD' or
 * 'GOOD_STANDING_LETTER', which are UPLOAD kinds and say nothing about sport
 * or hunting. So for every document filed since that date the column cannot
 * answer this question, and reading it would be reading a different fact. The
 * schema comment has been corrected to say what is actually stored.
 *
 * `status_type` is what the reader is asked for in as many words — "Say which
 * discipline it awards in status_type (dedicated sport shooter, dedicated
 * hunter, both, or professional hunter)" — and it is the only genuine record.
 * It rides in `details`, which credentialOffer is already handed whole, so
 * there is nothing to plumb.
 *
 * ⚠️ 'professional hunter' IS TESTED BEFORE 'hunter', AND THE PHRASE IS
 * STRIPPED BEFORE THE SEARCH. A PH registration reads "professional hunter",
 * which contains "hunter" — and treating that as dedicated-hunter status would
 * reinstate the exact false claim DEDICATED_KINDS was written to prevent.
 */
export function dedicatedDisciplineOf(
  doc: Pick<CredentialSource, 'kind' | 'details'>,
): DedicatedDiscipline {
  const raw = first(doc.details, 'status_type').toLowerCase();
  // ⚠️ THE RETIRED KINDS ARE A FALLBACK, NEVER AN OVERRIDE. Before the
  // 2026-08-20 consolidation the discipline WAS the kind — DEDICATED_STATUS is
  // labelled "a dedicated sport shooter status certificate" and DEDICATED_HUNTER
  // "a dedicated hunter status certificate" in the reader's own prompt — so a
  // row filed under one of those names is a genuine record of the discipline
  // and the only one such a row has. The migration rewrote every kind it found,
  // so this should be unreachable in production; it costs one line and it is
  // the difference between reading a legacy row correctly and reading it as
  // "we do not know". A `status_type` that was actually read always wins.
  if (!raw) {
    if (doc.kind === 'DEDICATED_HUNTER') return 'hunter';
    if (doc.kind === 'DEDICATED_STATUS') return 'sport';
    return 'unknown';
  }
  const professional = /\bprofessional\b/.test(raw) || /\bph\b/.test(raw);
  // Strip the PH wording so its "hunter" cannot be read as hunting status.
  const rest = raw
    .replace(/professional\s+hunter/g, ' ')
    .replace(/\bprofessional\b/g, ' ')
    .replace(/\bph\b/g, ' ');
  if (/\bboth\b/.test(rest)) return 'both';
  const sport = /sport/.test(rest);
  const hunter = /hunt/.test(rest);
  if (sport && hunter) return 'both';
  if (sport) return 'sport';
  if (hunter) return 'hunter';
  if (professional) return 'professional';
  return 'unknown';
}

/**
 * May this document evidence the dedicated status THIS application claims?
 *
 * ⚠️ A DEDICATED HUNTER'S PAPERS CANNOT EVIDENCE A DEDICATED SPORT SHOOTER,
 * AND UNTIL NOW THEY DID. The loop below tested `DEDICATED_KINDS.has(c.kind)`
 * and nothing else, and all three association kinds sit in that set — so a
 * member holding SAHGCA dedicated-HUNTER papers who applied under
 * S16_DEDICATED_SPORT got `association_name` filled from them, under a label
 * reading "Your sport-shooting association", and reached a SAPS 271 claiming
 * sport status on hunting evidence. Section 1 of the Firearms Control Act
 * defines a "dedicated sports person" as a member of an accredited
 * SPORTS-SHOOTING organisation; a hunting association is not one, and the form
 * is signed under section 120(9)(f).
 *
 * ⚠️ UNKNOWN IS A YES, AND 'both' IS A YES, exactly as competencyCovers
 * already decides the identical question about a competency certificate. Three
 * things can leave us without a discipline: the document did not print one,
 * the reader did not get it, or it was read and says something we do not
 * recognise. In none of those do we KNOW the document is wrong, and refusing a
 * member's own paper on a fact we do not hold would block honest applicants —
 * which is the worse of the two failures by far, because the member cannot see
 * why. We refuse only what we have READ and can name.
 */
export function dedicatedStatusFits(
  licenceType: MotivationLicenceType,
  doc: Pick<CredentialSource, 'kind' | 'details'>,
): boolean {
  const discipline = dedicatedDisciplineOf(doc);
  if (discipline === 'unknown' || discipline === 'both') return true;
  if (licenceType === 'S16_DEDICATED_SPORT') return discipline === 'sport';
  if (licenceType === 'S16_DEDICATED_HUNTER') return discipline === 'hunter';
  // No other licence type has an association block at all, so there is nothing
  // to protect and nothing to explain.
  return true;
}

/**
 * Does this document read as a section 16 LETTER OF GOOD STANDING?
 *
 * ⚠️ ASKED OF THE PAGE, NOT OF THE ROW. `Credential.disciplineType` does hold
 * 'GOOD_STANDING_LETTER' for documents adopted out of an application, but it
 * is not on CredentialSource and the one caller that could plumb it —
 * motivation-prefill.service.ts — does not. The reader is already asked for
 * both of these off the paper itself: `good_standing_number` is the letter's
 * own reference (the operator's SA Hunters letter carries GS00124584), and
 * `good_standing` is set to yes ONLY where the document says the member is in
 * good standing. Either is the document telling us what it is.
 */
function readsAsGoodStanding(details: Record<string, string>): boolean {
  if (first(details, 'good_standing_number')) return true;
  return /^(y|yes|true)$/i.test(first(details, 'good_standing'));
}

/**
 * The document for `body` that best answers "valid until", or null.
 *
 * ⚠️ IT MUST CARRY A DATE TO BE A CANDIDATE AT ALL. A dedicated status
 * certificate does not print an expiry, so the majority of these rows have a
 * null `expiresOn` and offering one would put nothing in the box while
 * claiming a source for it.
 *
 * A letter of good standing wins over anything else with a date, because that
 * is the document item 60 asks about; among equals the longest-running date
 * wins, which is the operator's own rule from 2026-08-28 for the competency
 * block and holds for the same reason — a renewed letter supersedes last
 * year's.
 */
function bestDatedFor(
  dedicated: readonly CredentialSource[],
  body: string,
): CredentialSource | null {
  const want = body.trim().toUpperCase();
  const mine = dedicated.filter(
    (c) =>
      Boolean(c.expiresOn) &&
      first(c.details, 'association', 'issuer').trim().toUpperCase() === want,
  );
  if (!mine.length) return null;
  return [...mine].sort((a, b) => {
    const byKind =
      (readsAsGoodStanding(a.details) ? 0 : 1) -
      (readsAsGoodStanding(b.details) ? 0 : 1);
    if (byKind) return byKind;
    // yyyy-mm-dd compares correctly as a string; latest first.
    if (a.expiresOn === b.expiresOn) return 0;
    return (a.expiresOn ?? '') < (b.expiresOn ?? '') ? 1 : -1;
  })[0];
}

/** Why we would not take association details off this document, in their words. */
function wrongDisciplineReason(
  licenceType: MotivationLicenceType,
  discipline: DedicatedDiscipline,
): string {
  const wanted =
    licenceType === 'S16_DEDICATED_SPORT'
      ? 'a dedicated SPORT SHOOTER, and that has to come from an accredited sports-shooting organisation'
      : 'a dedicated HUNTER, and that has to come from an accredited hunting association';
  const says =
    discipline === 'professional'
      ? 'it is a professional hunter registration, which is a provincial occupational licence and not dedicated status at all'
      : discipline === 'hunter'
        ? 'it awards dedicated HUNTER status'
        : 'it awards dedicated SPORT SHOOTER status';
  return `${says}. This application is for ${wanted}`;
}

/**
 * Build the offer.
 *
 * @param answered  what the applicant has already typed. Never overwritten.
 * @param needed    the endorsement the firearm being applied for requires, or
 *                  NULL when the application has not said what firearm it is
 *                  for yet. See the competency block: null offers no
 *                  competency at all, rather than picking one.
 *
 * ⚠️ `needed` IS NOT OPTIONAL, AND IT IS THE FOURTH ARGUMENT ON PURPOSE. A
 * default would have made every caller that has not been taught about it
 * quietly pass "we do not know the firearm" for ever — and "quietly stopped
 * offering the competency" is precisely the failure this argument was added
 * to end. The compiler names every call site instead. Callers get it from
 * requiredEndorsement(answers) in motivation-eligibility.ts, and must RE-RUN
 * the offer when firearm_type or firearm_action changes, because the answer
 * to "which certificate" changes with it.
 */
export function credentialOffer(
  licenceType: MotivationLicenceType,
  credentials: CredentialSource[],
  answered: Record<string, string>,
  needed: Endorsement | null,
): CredentialOffer {
  // ⚠️ THE CONFIRMED GATE IS PER-VALUE NOW, NOT PER-DOCUMENT, AND THE
  // DIFFERENCE IS WHY "What you own" WAS EMPTY. Operator, 2026-08-28: "what
  // you own still is empty on the step 3 and there are a bunch of firearm
  // licenses that is in the vault." They were right, and the vault proved it:
  // five FIREARM_LICENCE rows, ZERO confirmed. A blanket
  // `filter(c => c.confirmed)` therefore threw away every licence before any
  // of them could fill a row, on every application, new or old.
  //
  // The gate's purpose is the one this module already states in
  // credentialsFor: "THE CONFIRMATION GATE PROTECTS DATES, NOT NUMBERS.
  // confirmedAt exists so the reminder sweep never acts on an expiry nobody
  // has checked." That still holds absolutely — and it is untouched here,
  // because the sweep reads Credential.expiresOn and this function has never
  // written an expiry to anything. What it writes is a make, a calibre, two
  // serials, a licence number, a competency number.
  //
  // So an unconfirmed document may fill a value that is not a date, and may
  // not fill one that is. The member sees where every value came from and can
  // edit all of them, which is the answer to the original worry about
  // "filling a signed application with values nobody ever looked at": they
  // are looking at it, labelled, in the wizard.
  //
  // ⚠️ AND THE DATE HALF OF THE GATE NOW READS `dateSettled`, NOT `confirmed`.
  // See the field's own note: the vault arms its own dates, so a phone-uploaded
  // licence has a date the reminder sweep is already texting people about and a
  // `confirmedAt` that will stay null forever. Gating the form on the tick
  // while the sweep gates on the date meant the two disagreed about the same
  // value.
  const settledById = new Map(
    credentials.map((c) => [c.id, c.dateSettled ?? c.confirmed]),
  );

  const keys = new Set(fieldsFor(licenceType).map((f) => f.key));
  const values: Record<string, string> = {};
  const items: CredentialOfferItem[] = [];
  const skipped: { title: string; why: string }[] = [];

  const offer = (
    key: string,
    label: string,
    value: string,
    from: string,
    credentialId: string,
  ) => {
    // ⚠️ THE ANSWER BOUNDARY, AND THE ONLY ONE THAT MATTERS IN THIS FILE.
    // ⚠️ THE PLACEHOLDER IS OFFERED NOW, AND THAT REVERSES 2026-09-07.
    //
    // This ran answerValue() so that "Firearm 6 — frame serial NONE · barrel
    // serial NONE" could never be offered, accepted and written. Operator,
    // 2026-09-08, ruling the other way: "All those fields needs to be captured
    // on a license card and filled in on the form, especially on the 271 that
    // requires it." A 271 box reading NONE reproduces the card; an empty one
    // says nobody filled it in, and those are different statements to a DFO.
    //
    // ⚠️ `first()` ABOVE STILL SKIPS PLACEHOLDERS, AND MUST. It is a fallback
    // CHAIN — frame, then barrel, then receiver — and a NONE that returns
    // instead of falling through is how a row with a real number in the next
    // column comes back empty. Picking a serial and transcribing a row are
    // different questions; only the second one wants the word NONE.
    const v = (value ?? '').trim();
    if (!v || !keys.has(key)) return;
    // See the note above: a document whose dates nobody stands behind may fill
    // a fact, never a date.
    if (!settledById.get(credentialId) && isDateKey(key)) return;
    if ((answered[key] ?? '').trim()) return; // theirs wins, always
    if (values[key]) return; // first document to claim a slot keeps it
    values[key] = v;
    items.push({ key, label, value: v, from, credentialId });
  };

  // ── the competency number ────────────────────────────────────────
  //
  // ⚠️ THE FIREARM CHOOSES THE CERTIFICATE. THE DATES ONLY BREAK A TIE.
  //
  // Operator, 2026-09-07, driving a fresh Section 13 (self-defence, handgun)
  // on production: "the wrong competency chosen before it even knows which
  // firearm is being applied for". The panel filled competency_number,
  // competency_for, competency_issued and competency_expiry off a "Semi-auto
  // Rifle + Shotgun" certificate while a "Competency - Handgun" sat unused in
  // the same vault — and then refused to revise it, because offer() is
  // "theirs wins, always" and a written answer looks exactly like a typed one.
  //
  // The cause was structural, not a scoring accident. This function never
  // asked what firearm the application was for, so it ranked the candidates
  // on the only fact it had: whose expiry ran longest. That rule is still the
  // operator's — "longest-running expiry wins", 2026-08-28 — but it was
  // answering a question that comes SECOND. A certificate that does not cover
  // the firearm cannot be the right one however long it runs.
  //
  // ⚠️ AND A NULL `needed` OFFERS NOTHING AT ALL. create() builds the rows
  // before firearm_type can exist, so "which firearm" is genuinely unknown on
  // the first pass. Guessing there is what produced the wrong certificate on a
  // form somebody signs; the auto-attach path already refuses to guess in the
  // identical situation (decideAutolink's several-candidates skip). The
  // caller re-runs the offer once the firearm is described.
  //
  // ⚠️ THE EXCLUSION TEST IS competencyCovers, THE SAME ONE AUTO-LINK USES,
  // and it is deliberately generous: unknown is a yes. A certificate whose
  // `covers` line was never read, or read and parsed to nothing, is NOT
  // evidence of the wrong firearm, and withholding somebody's own document on
  // a fact we do not hold would be the opposite failure. We drop a certificate
  // only when we have READ its endorsements and they demonstrably lack the one
  // this application needs.
  //
  // ⚠️ AND A DEMONSTRABLY COVERING CERTIFICATE BEATS AN UNREADABLE ONE, even
  // a longer-running unreadable one. Both are permitted candidates; only one
  // of them is known to be right.
  const competencies = credentials.filter((c) => COMPETENCY_KINDS.has(c.kind));

  // ⚠️ AN ENDORSEMENT SET, NOT ONE ENDORSEMENT, AND THE SECOND MEMBER OF IT IS
  // THE COMBINATION GUN.
  //
  // `needed` is `Endorsement | null`, so it cannot say "two" and cannot say
  // "we could not map what they told us" — it collapses both into the same
  // null that also means "they have not told us yet". A combination gun is one
  // of the four choices on the REQUIRED `firearm_type` field and has a rifled
  // barrel AND a smooth bore, so requiredEndorsement correctly refuses to name
  // one endorsement for it and returns null forever. The result was that a
  // member applying for a combination gun never got the competency number we
  // were already holding, and was told, permanently, "we will fill your
  // competency in as soon as you have said which firearm this application is
  // for" — a sentence asking them to do something they had already done. That
  // is the shape CLAUDE.md's "Automate It — Do Not Ask" forbids.
  //
  // ⚠️ AND THE ANSWER IS ASKED OF THE ONE FUNCTION THAT CAN GIVE IT, NOT
  // RE-DERIVED HERE. motivation-eligibility.ts's own note says it: "Anything
  // that has to tell 'we do not know' apart from 'we cannot choose' must call
  // endorsementNeed instead". A second copy of the type-to-endorsement mapping
  // in this file is exactly the drift that produces two answers to one
  // question. `needed` stays the caller's explicit statement and still wins
  // where it names one; endorsementNeed fills the case it cannot express.
  const need = endorsementNeed(answered);
  const needsAll: readonly Endorsement[] = needed
    ? [needed]
    : need.kind === 'several'
      ? need.endorsements
      : [];

  /** 0 = we read it and it covers everything needed; 1 = we could not read it. */
  const coverRank = (c: CredentialSource): number => {
    const held = parseEndorsements(first(c.details, 'covers'));
    return needsAll.length && needsAll.every((e) => held.includes(e)) ? 0 : 1;
  };

  const chosen = !needsAll.length
    ? []
    : competencies
        .filter((c) =>
          needsAll.every((e) =>
            competencyCovers(first(c.details, 'covers'), e),
          ),
        )
        .sort((a, b) => {
          const byCover = coverRank(a) - coverRank(b);
          if (byCover) return byCover;
          // yyyy-mm-dd compares correctly as a string — which is why the vault
          // stores it that way. No Date parsing, no timezone to get wrong.
          //
          // ⚠️ A NULL EXPIRY SORTS LAST, NOT FIRST. A certificate whose date we
          // could not read is not evidence of a long life, and treating a blank
          // as "runs forever" would let the least-known document beat a dated
          // one.
          if (a.expiresOn === b.expiresOn) return 0;
          if (!a.expiresOn) return 1;
          if (!b.expiresOn) return -1;
          return a.expiresOn < b.expiresOn ? 1 : -1;
        });

  // ⚠️ ONE LINE FOR THE WHOLE BLOCK, NEVER ONE PER CERTIFICATE. The member is
  // owed an explanation for an empty competency section — going quiet is what
  // makes a prefill look broken — but three certificates must not produce
  // three copies of the same sentence run together on one line.
  if (!needsAll.length && competencies.length) {
    // ⚠️ TWO REASONS, AND ONLY ONE OF THEM ASKS THE MEMBER FOR ANYTHING. The
    // first is true and actionable: they have not finished describing the
    // firearm, and the moment they do the offer re-runs and fills the block.
    // The second is ours, not theirs — a firearm we cannot map to an
    // endorsement — and telling them to answer a question they have already
    // answered is worse than saying nothing. Say what is actually true.
    skipped.push({
      title: competencies.map((c) => c.title).join(', '),
      // ⚠️ 'unmappable' IS OURS, 'unknown' IS THEIRS. Only the second is
      // something the member can act on. The first is registry drift — a
      // firearm_type choice we can no longer map — and telling them to answer
      // a question they have answered is worse than admitting we are stuck.
      // ('one' with a null `needed` is a caller deliberately withholding the
      // firearm, which today only create() does, and it does it before any
      // firearm answer exists — so it lands on the 'unknown' wording, which is
      // true for it.)
      why:
        need.kind === 'unmappable'
          ? 'we could not work out which competency this firearm needs — please type the certificate number and its dates off the certificate itself'
          : 'we will fill your competency in as soon as you have said which firearm this application is for — the right certificate depends on it',
    });
  }
  for (const c of competencies) {
    if (!needsAll.length || chosen.includes(c)) continue;
    skipped.push({
      title: c.title,
      // A combination gun needs two endorsements, and "it does not cover the
      // firearm" would leave somebody holding a perfectly good shotgun
      // competency wondering what was wrong with it.
      why:
        needsAll.length > 1
          ? 'it covers only part of what a combination firearm needs — a rifle and a shotgun endorsement'
          : 'it does not cover the firearm this application is for',
    });
  }

  // ⚠️ ONE CERTIFICATE FILLS ALL FOUR BOXES, OR NONE OF THEM DO.
  //
  // This used to loop every covering certificate and lean on offer()'s
  // first-wins-per-key rule to sort it out. That is fine while one document
  // answers everything and silently wrong the moment it does not: certificate A
  // supplies the NUMBER, A's dates are held back by the settled gate or simply
  // were not read, and B — a different piece of paper, possibly an expired one —
  // supplies competency_issued and competency_expiry. The applicant then signs a
  // SAPS 271 naming one certificate beside another certificate's dates. Every
  // value on it is true of some document; the statement the form makes is false.
  // The association block guards exactly this and says so: "two true facts
  // making one false statement".
  //
  // So the ranking above now chooses THE certificate, and the first one that
  // yields a number is it. The rest are reported rather than quietly mined for
  // spare parts.
  let used: CredentialSource | null = null;
  for (const c of chosen) {
    const number = first(c.details, 'competency_number', 'certificate_number');
    if (!number) {
      skipped.push({
        title: c.title,
        why: 'we could not read a certificate number off it',
      });
      continue;
    }
    if (used) {
      skipped.push({
        title: c.title,
        why: `we filled the form from your ${used.title} — the certificate number and its dates have to come off the same certificate`,
      });
      continue;
    }
    used = c;
    offer(
      'competency_number',
      'Competency certificate number',
      number,
      c.title,
      c.id,
    );

    // ── WHAT THE CERTIFICATE COVERS ──────────────────────────────
    //
    // ⚠️ THIS USED TO BE REFUSED ON PURPOSE, AND THE REASON HAS BEEN FIXED
    // RATHER THAN OVERRULED. The old note said the vault's `covers` is free
    // text off a photograph ("handgun and rifle", "H, R") while
    // `competency_for` is a MULTI constrained to the registry's endorsement
    // labels — so mapping one onto the other would put an unmatchable value
    // into a constrained box on a form somebody signs. Entirely correct as a
    // description of a RAW copy.
    //
    // It is not a copy any more. parseEndorsements reads SAPS's own wording —
    // including the compound "S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN" form,
    // where one action prefix distributes across every type after it — and
    // returns typed Endorsement values or NOTHING. Rendering those through the
    // registry's own labels means the box can only ever receive a value it
    // already offers, and an unreadable line yields '' and is dropped by
    // offer(). The failure mode the note feared cannot be reached from here.
    //
    // ⚠️ AND WITHOUT IT THE ELIGIBILITY BLOCKER COULD NEVER FIRE. The
    // `competency-missing-endorsement` rule in motivation-eligibility.ts reads
    // `answers.competency_for` and says nothing when it is empty — deliberately,
    // "an empty one means we have not read it yet". So a member whose
    // handgun-only competency cannot cover the rifle they are applying for got
    // silence from the one check written to catch exactly that, because the
    // value it reads was never filled in.
    const covers = endorsementLabels(first(c.details, 'covers'));
    if (covers) {
      offer(
        'competency_for',
        'What your competency covers',
        covers,
        c.title,
        c.id,
      );
    }

    // ── THE TWO DATES ────────────────────────────────────────────
    //
    // Operator, 2026-08-25: "if the certificate date is determined by the math
    // insert it, don't wait for the user to go and confirm it." Both of these
    // are values the vault already holds, and both were being retyped.
    //
    // ⚠️ THE EXPIRY IS THE VAULT'S ARITHMETIC, NOT OURS, AND IT MUST STAY THAT
    // WAY. A SAPS 524 prints no expiry — it is derived as the latest expiry
    // among the licences held in the categories the certificate covers, rolls
    // forward with every renewal, and is recomputed by
    // recomputeDerivedCompetencies whenever that changes. Deriving it a second
    // time here would give the member two different deadlines for one
    // certificate depending on which screen they were looking at. Read the
    // column; never compute it.
    //
    // Both are date keys, so both pass through the settled gate above: a row
    // whose dates nobody stands behind — neither the member nor our own
    // arming — supplies neither.
    offer(
      'competency_issued',
      'Competency issued on',
      c.issuedOn ?? '',
      c.title,
      c.id,
    );
    offer(
      'competency_expiry',
      'Competency expires on',
      c.expiresOn ?? '',
      c.title,
      c.id,
    );
  }

  // ── the firearms already licensed to them ────────────────────────
  //
  // Operator, 2026-09-07: "all fire arms the applicant owns must be in that
  // list", and "the marlin should also be already added, it shouldnt be like
  // it is now". Both of those are this loop.
  //
  // ⚠️ ROWS ARE FILLED FROM THE FIRST FREE SLOT, and a slot counts as taken
  // if the applicant has typed ANY of its columns. Writing a make into row 2
  // while row 2's serial belongs to a different firearm would produce a form
  // describing a gun that does not exist.
  //
  // ⚠️ THE LEGACY SERIAL KEYS COUNT AS FILLED TOO. A draft written before the
  // two serial boxes collapsed into one holds `_barrel_serial` and
  // `_frame_serial` and no `_serial`; a row that looks empty because we asked
  // about the wrong key is a row we would fill on top of.
  //
  // ⚠️ AND THE RULE IS THE REGISTRY'S, NOT THIS FILE'S. The ten columns were
  // written out here while nextOwnedSlot in motivation-extract.service.ts asked
  // about the CALIBRE alone, so the two paths that fill this grid disagreed
  // about which rows were free. ownedRowTaken is the one answer both ask.
  const takenRow = (n: number) => ownedRowTaken(answered, n);

  /**
   * Is this firearm ALREADY on the form?
   *
   * ⚠️ WITHOUT THIS THE VAULT OFFERS A DUPLICATE FOREVER. Rows are claimed
   * from the first free slot, so once a licence has been filled into row 1 the
   * same credential is offered again for row 2, then row 3 — the applicant is
   * invited to list one rifle six times, and a form claiming six firearms that
   * are one firearm is a false declaration. Seen live on MO000017: one .223
   * in row 1, and the offer proposing the identical make, calibre and serial
   * as "Firearm 2".
   *
   * ⚠️ AND IT NOW RUNS BEFORE THE ROW CAP, WHICH IS THE WHOLE POINT OF THE
   * ORDER. It used to run last, so a firearm that was already on the form was
   * first counted against the fourteen rows and could be reported as not
   * fitting — the operator's panel offered to add the MARLIN .45-70 as Firearm
   * 6 while the Marlin sat at position 2, and named three other
   * already-listed firearms as leftovers. A licence already on the form must
   * be invisible to this loop: not offered, and not counted.
   *
   * Matched on the identifiers that belong to exactly one firearm, and a
   * placeholder is not one of them — plenty of rifles carry no frame number
   * and the licence says NONE, which would otherwise make every such firearm a
   * duplicate of every other.
   *
   * ⚠️ MAKE + CALIBRE IS THE LAST RESORT, AND ONLY AGAINST A ROW WITH NO
   * NUMBERS AT ALL. It is how the Marlin case is caught: a card that prints
   * NONE for both serials and whose licence number never read leaves nothing
   * else to compare. The cost is a member who owns two identical firearms and
   * has typed neither serial nor licence number for the first — they are told
   * one is already listed and add the second by hand. That is the cheaper of
   * the two mistakes: the other one puts a firearm on a signed declaration
   * twice.
   *
   * ⚠️ AND THE ROWS THIS RUN HAS JUST FILLED COUNT AS ON THE FORM. They are
   * not in `answered` — nothing has been saved yet — so a vault holding the
   * same licence twice (a re-photographed card, an adopted duplicate) put it
   * into row 1 and then, finding row 1 "free" by the only test there was,
   * into row 2. The offer would have proposed one Marlin as two firearms
   * before the applicant ever touched it.
   */
  const norm = (v: string) => v.trim().toUpperCase();
  /** What identifies one firearm, from either side of the comparison. */
  interface OnForm {
    /** Which row it is, so the member can be pointed at it. */
    row: number;
    licence: string;
    /** Every serial the row carries, placeholders already dropped. */
    serials: string[];
    make: string;
    calibre: string;
  }
  const onForm: OnForm[] = [];
  for (let n = 1; n <= OWNED_ROWS; n++) {
    const at = (col: string) => norm(answered[`existing_firearm_${n}_${col}`] ?? '');
    onForm.push({
      row: n,
      licence: at('licence_no'),
      // Whichever of the three keys a draft happens to hold — a row saved
      // before the collapse has `_barrel_serial` and no `_serial`.
      serials: ['serial', 'barrel_serial', 'frame_serial']
        .map((col) => answered[`existing_firearm_${n}_${col}`] ?? '')
        .filter((v) => !isCardPlaceholder(v))
        .map(norm),
      make: at('make'),
      calibre: at('calibre'),
    });
  }
  /**
   * Null when this firearm is not on the form; otherwise HOW it was matched.
   *
   * ⚠️ 'guess' IS NOT 'identifier', AND THE CALLER MUST TELL THEM APART. A
   * licence-number or serial match is a fact: the same firearm, nothing to say.
   * The make-and-calibre last resort is an inference about two rows with no
   * numbers on either of them, and it is right about the Marlin and wrong about
   * a member who owns two identical rifles. Returning one boolean for both is
   * what let the second rifle disappear off a signed declaration in silence.
   *
   * ⚠️ IDENTIFIERS ARE TESTED ACROSS EVERY ROW BEFORE ANY GUESS IS. Otherwise a
   * firearm that genuinely matches row 4 by serial could be reported as a
   * guessed duplicate of row 1 and get a note nobody needs.
   */
  const alreadyOnForm = (
    licence: string,
    serial: string,
    make: string,
    calibre: string,
  ): { how: 'identifier' | 'guess'; row: number } | null => {
    for (const r of onForm) {
      if (licence && r.licence && r.licence === norm(licence)) {
        return { how: 'identifier', row: r.row };
      }
      if (serial && r.serials.includes(norm(serial))) {
        return { how: 'identifier', row: r.row };
      }
    }
    for (const r of onForm) {
      if (
        !r.licence &&
        !r.serials.length &&
        Boolean(make && calibre) &&
        r.make === norm(make) &&
        r.calibre === norm(calibre)
      ) {
        return { how: 'guess', row: r.row };
      }
    }
    return null;
  };

  /**
   * Firearms that did not fit, named ONCE at the end of the run.
   *
   * ⚠️ ONE MESSAGE, NOT ONE PER LICENCE. The old loop pushed a skipped entry
   * per leftover, each reading "the form has room for 6 firearms and they are
   * all filled" — so a member with four extra licences got that sentence four
   * times, rendered as a run-on line, saying nothing about WHICH firearms were
   * left out. With fourteen rows this should now be unreachable; it is kept
   * because "unreachable" is what the six-row version was assumed to be.
   */
  const overflow: string[] = [];

  let row = 1;
  for (const c of credentials) {
    if (!LICENCE_KINDS.has(c.kind)) continue;

    const make = first(c.details, 'make');
    const model = first(c.details, 'model');
    const calibre = first(c.details, 'calibre');
    // One number. A licence card usually prints the same serial against the
    // barrel, the receiver and the frame; where it differs, the barrel is the
    // one the card prints first. See ownedFirearmSerial in motivation-fields.
    const serial = first(c.details, 'barrel_serial', 'frame_serial', 'serial');
    const licence = first(c.details, 'licence_number');
    const type = normaliseFirearmType(first(c.details, 'firearm_type', 'type'));

    if (!make && !calibre && !serial && !licence) {
      skipped.push({
        title: c.title,
        why: 'we could not read a make, calibre or serial off it',
      });
      continue;
    }

    // Already listed. Tested BEFORE the row cap so it can never be counted as a
    // leftover either.
    //
    // ⚠️ AN IDENTIFIER MATCH SAYS NOTHING; A GUESS HAS TO. Matching on a licence
    // number or a serial is a fact — nothing is missing, the firearm is on the
    // form, and a note about it would be noise. Matching on make and calibre
    // alone is an inference drawn about a row carrying no numbers at all, and
    // the doc block on alreadyOnForm has always claimed the member "is told one
    // is already listed and adds the second by hand". Nobody was told: it was
    // the same silent `continue`. So a member who genuinely owns two identical
    // rifles, neither with a readable serial or licence number — precisely the
    // Marlin's shape this rule was written for — lost the second one off a
    // signed declaration with no trace on any screen. Now the trade-off is
    // actually the one the comment describes.
    const listed = alreadyOnForm(licence, serial, make, calibre);
    if (listed?.how === 'identifier') continue;
    if (listed?.how === 'guess') {
      skipped.push({
        title: c.title,
        why: `it looks like the firearm already listed as Firearm ${listed.row} — the same make and calibre, and neither carries a serial or licence number to tell them apart. If you own two of them, add the second one by hand`,
      });
      continue;
    }

    while (row <= OWNED_ROWS && takenRow(row)) row++;
    if (row > OWNED_ROWS) {
      overflow.push(c.title);
      continue;
    }

    // In the order the operator asked for them to be listed: make, model,
    // serial, expiry. Type, calibre, use and the licence number follow —
    // still asked, still stored, still what motivation-overlap argues from,
    // and not part of the summary line.
    const p = `existing_firearm_${row}_`;
    offer(`${p}make`, `Firearm ${row} — make`, make, c.title, c.id);
    offer(`${p}model`, `Firearm ${row} — model`, model, c.title, c.id);
    offer(`${p}serial`, `Firearm ${row} — serial number`, serial, c.title, c.id);
    /**
     * ⚠️ THE TWO COMPONENT ROWS, VERBATIM, INCLUDING "NONE".
     *
     * Operator, 2026-09-08: "we need to insert NONE if the barrel serial said
     * NONE. DO NOT LEAVE A NONE BLANK EVER unless I tell you to."
     *
     * Item 2.1 of the SAPS 271 has TWO serial columns — Barrel Serial No and
     * Frame/receiver Serial No — and this offered ONE number for both. `first()`
     * runs answerValue, which strips a placeholder, so a card printing NONE
     * against the barrel and a real number against the receiver came through as
     * that one number with the NONE thrown away. The form then either went in
     * blank or, worse, took the receiver's number into the barrel box — a false
     * statement on a form where section 120(9)(f) makes one an offence.
     *
     * ⚠️ SO THESE ARE READ OFF `details` DIRECTLY, NOT THROUGH first(). The card
     * being complete and the card being empty are different facts, and only the
     * verbatim value can tell them apart. Same rule section E already applies to
     * the firearm being applied for.
     *
     * ⚠️ AND THEY ARE NOT FORM FIELDS. `_barrel_serial` and `_frame_serial` were
     * collapsed into `_serial` on 2026-09-07 so nobody types three serial boxes
     * per row; they stay accepted through fieldByKey, which is what lets these
     * be stored without rendering anything. Nothing asks — we read them off the
     * card or we hold nothing.
     */
    const cardRow = (k: string) => (c.details[k] ?? '').trim();
    offer(
      `${p}barrel_serial`,
      `Firearm ${row} — barrel serial number`,
      cardRow('barrel_serial'),
      c.title,
      c.id,
    );
    offer(
      `${p}frame_serial`,
      `Firearm ${row} — frame or receiver serial number`,
      cardRow('frame_serial') || cardRow('receiver_serial'),
      c.title,
      c.id,
    );
    // A date key, so the settled gate applies: a licence nobody has checked
    // fills the make and the serial and leaves the expiry to the member.
    offer(
      `${p}expiry`,
      `Firearm ${row} — licence expires`,
      c.expiresOn ?? '',
      c.title,
      c.id,
    );
    /**
     * ⚠️ THE SECTION, WHICH THE VAULT HAS ALWAYS HELD AND NOTHING EVER USED.
     * `section` is in WANTED.FIREARM_LICENCE and has been read off every card
     * scanned since the Licence Centre shipped; no row on the form asked for
     * it, so the writer guessed instead — MO000071 put a section 16 Marlin
     * under section 15. The card prints "SECTION 16"; the row stores the card
     * SET's key, so a member correcting a bad read taps the same set the
     * document filled.
     */
    offer(
      `${p}section_held`,
      `Firearm ${row} — licensed under`,
      sectionCardKey(cardRow('section')),
      c.title,
      c.id,
    );
    offer(`${p}type`, `Firearm ${row} — type`, type, c.title, c.id);
    offer(`${p}calibre`, `Firearm ${row} — calibre`, calibre, c.title, c.id);
    offer(`${p}licence_no`, `Firearm ${row} — licence number`, licence, c.title, c.id);
    // Now on the form as far as the rest of this run is concerned. See the
    // note on alreadyOnForm: a vault holding the same card twice would
    // otherwise list one firearm as two.
    onForm.push({
      row,
      licence: norm(licence),
      serials: serial ? [norm(serial)] : [],
      make: norm(make),
      calibre: norm(calibre),
    });
    row++;
  }

  if (overflow.length) {
    skipped.push({
      title: overflow.join(', '),
      why: `the form has room for ${OWNED_ROWS} firearms and they are all filled`,
    });
  }

  /**
   * ── AN ENDORSEMENT SAYS WHAT A FIREARM IS FOR ─────────────────────
   *
   * ⚠️ THE ONE COLUMN NO LICENCE CARD COULD EVER FILL. `primary_use` is marked
   * "NEVER docSourced, and it never can be" in the registry — a licence copy
   * carries make, calibre and serial and nothing printed on it says what the
   * firearm is FOR. That is true of a licence, and it is exactly what an
   * association endorsement is: a page confirming that ONE named gun suits the
   * discipline the member is dedicated in.
   *
   * ⚠️ SO THE WRITER STOPPED HAVING TO GUESS. MO000071 invented five roles —
   * "long-range game harvesting", "dedicated precision sport shooting rifle
   * chambered for extended-range accuracy" — because the rows carried none and
   * the prompt asked for one each. `documentScope` now refuses an invented
   * role; this is the other half, which is supplying the real one.
   *
   * ⚠️ MATCHED BY SERIAL ONLY, the same rule owned-firearm-sections.ts follows
   * and for the same reason: two of a battery can share a make and a calibre —
   * the corpus's own example holds four 9mm handguns — and the wrong role on a
   * signed document is the failure this exists to stop.
   */
  for (const c of credentials) {
    if (c.kind !== 'ASSOCIATION_ENDORSEMENT') continue;
    const endorsed = norm(
      first(c.details, 'serial', 'barrel_serial', 'frame_serial'),
    );
    if (!endorsed) continue;
    const hit = onForm.find((r) => r.serials.includes(endorsed));
    if (!hit) continue;

    /**
     * The discipline in the words the row prints, or the status type as read.
     * ⚠️ NOTHING IS DERIVED FROM THE ASSOCIATION'S NAME. A body accredited for
     * hunting AND sport prints two accreditation numbers, and reading "Hunters"
     * off a letterhead is how the operator's sport status was once filed as
     * DEDICATED_HUNTER.
     */
    const discipline = first(c.details, 'status_type', 'discipline');
    if (!discipline) continue;
    offer(
      `existing_firearm_${hit.row}_use`,
      `Firearm ${hit.row} — what it is licensed for`,
      discipline,
      c.title,
      c.id,
    );
  }

  // ── dedicated status — one SLOT per association ──────────────────
  //
  // ⚠️ SEVERAL ASSOCIATIONS IS THE NORMAL CASE. The professional motivations
  // list three, each with its own membership number and joined date, and a
  // member's vault can hold a discipline document from each body. One slot
  // meant the first document claimed association_name and every other body
  // the member belonged to silently fell off their application — the exact
  // understatement a section 16 reviewer would count against them.
  //
  // Deduped on the association's NAME, not the document: two papers from the
  // same body (a certificate and last year's) are one membership, and listing
  // it twice on a signed form is a false claim of two.
  {
    // ⚠️ THE FIRST SLOT'S DATE IS `association_joined`, NOT `dedicated_since`,
    // AND THAT IS A CORRECTION, NOT A RENAME. This loop wrote the vault's
    // `joined_on` — the day the member joined the body — into a box labelled
    // "Dedicated status held since", under an offer line reading "Member
    // since". For a SAHGCA or NARFO member those are routinely years apart:
    // you join, and then you qualify. It was written unasked, shown with
    // vault provenance, and printed into the 271's association block; and
    // `dedicated_since` is also what deriveFacts counts `years_dedicated`
    // from, so the motivation itself argued from a join date.
    //
    // Slots two and three were always right — the registry has called them
    // "Member there since" from the day they were added. Slot one now has a
    // field of the same shape, and `dedicated_since` keeps its own meaning and
    // is asked of the member, because no document in the vault carries it.
    const slots: [string, string, string][] = [
      ['association_name', 'association_number', 'association_joined'],
      ['association_2_name', 'association_2_number', 'association_2_joined'],
      ['association_3_name', 'association_3_number', 'association_3_joined'],
    ];
    const seenBodies = new Set(
      slots
        .map(([nameKey]) => (answered[nameKey] ?? '').trim().toUpperCase())
        .filter(Boolean),
    );
    // Every association document that may speak for THIS application. See
    // dedicatedStatusFits: a dedicated hunter's papers are not evidence of
    // sport-shooting status, and the reverse.
    const dedicated: CredentialSource[] = [];
    for (const c of credentials) {
      if (!DEDICATED_KINDS.has(c.kind)) continue;
      if (!dedicatedStatusFits(licenceType, c)) {
        // ⚠️ SAID OUT LOUD, NEVER A SILENT `continue`. A member whose only
        // association document is refused must be told which document and
        // why, or the association block simply sits empty and the prefill
        // looks broken — the same failure the competency block above was
        // rewritten to end.
        skipped.push({
          title: c.title,
          why: wrongDisciplineReason(licenceType, dedicatedDisciplineOf(c)),
        });
        continue;
      }
      dedicated.push(c);
    }
    /** Papers from a body already on the form. They may still carry the date. */
    const sameBody: CredentialSource[] = [];
    let slot = 0;
    for (const c of dedicated) {
      const body = first(c.details, 'association', 'issuer').trim();
      // ⚠️ NO NAME, NO SLOT. A document whose association we could not read
      // would offer a membership number with nothing to attribute it to — an
      // unattributed number on a signed form — and burn a slot doing it.
      if (!body) {
        skipped.push({
          title: c.title,
          why: 'we could not read which association issued it',
        });
        continue;
      }
      if (seenBodies.has(body.toUpperCase())) {
        // ⚠️ THE SECOND PAPER FROM ONE BODY IS STILL A DOCUMENT WE LOOKED AT.
        // It used to `continue` in silence, which was the visible half of the
        // item-60 bug: the status certificate takes slot 0 and carries no
        // expiry (the certificate does not print one), the letter of good
        // standing from the same body hits this line, and the member is told
        // nothing while the box the letter exists to fill sits empty. The
        // date itself is now taken below, from whichever of the body's
        // documents actually carries one.
        sameBody.push(c);
        continue;
      }
      // Advance past slots the applicant has already filled by hand.
      while (
        slot < slots.length &&
        ((answered[slots[slot][0]] ?? '').trim() || values[slots[slot][0]])
      ) {
        slot++;
      }
      if (slot >= slots.length) {
        skipped.push({
          title: c.title,
          why: 'the form has room for three associations and they are all filled',
        });
        continue;
      }
      const [nameKey, numberKey, sinceKey] = slots[slot];
      offer(nameKey, 'Your association', body, c.title, c.id);
      offer(
        numberKey,
        'Membership number',
        // The label says MEMBERSHIP number, so the membership number wins
        // where the document carries both — the status number is a different
        // reference and putting it in this box mislabels it on a signed form.
        first(c.details, 'membership_number', 'status_number', 'reference_number'),
        c.title,
        c.id,
      );
      offer(
        sinceKey,
        'Member since',
        first(c.details, 'joined_on'),
        c.title,
        c.id,
      );
      if (body) seenBodies.add(body.toUpperCase());
      slot++;
    }

    // ── ITEM 60 — THE MEMBERSHIP'S "VALID UNTIL" DATE ────────────────
    //
    // Operator, 2026-08-28: "Expiry dat of accredited associasian should also
    // be inserted from the letter of good standing date. that should have a
    // valid until date."
    //
    // ⚠️ IT IS CHOSEN PER BODY, NOT TAKEN OFF WHICHEVER DOCUMENT HAPPENED TO
    // BE FIRST, AND THAT IS THE BUG. This used to sit inside the loop above,
    // guarded by `slot === 0`, and the loop dedupes on the association NAME
    // with the `continue` firing BEFORE this offer. Credentials arrive
    // `orderBy: { createdAt: 'asc' }` with no preference for the document that
    // carries a date, so the ordinary case broke it: the status certificate is
    // uploaded first, takes slot 0 and carries NO expiry — a dedicated status
    // certificate does not print one, which validLongEnough already says in as
    // many words — and the letter of good standing from the SAME body, the one
    // document whose whole purpose is the validity window, hit the dedup and
    // contributed nothing. Item 60 stayed blank while the vault held the date.
    //
    // ⚠️ FROM expiresOn, NOT FROM details. It is the column the vault writes
    // off the page and the renewal sweep already reads; the details blob does
    // not carry it.
    //
    // ⚠️ AND ONLY FROM THIS BODY'S OWN DOCUMENTS. A member may hold a
    // discipline document from each of three bodies — the schema says so in as
    // many words, and it is the normal case. Picking the longest-running expiry
    // across ALL of them would print body A's name in item 56 beside body B's
    // date in item 60: two true facts making one false statement, on a form
    // signed under section 120(9)(f). Grouping by body first is what keeps the
    // name and the date on one membership.
    //
    // Only the first slot: the 271 prints one expiry box, for the association
    // in items 56-59. Associations two and three have name, number and joined
    // date on the form and no expiry to put anywhere.
    //
    // ⚠️ AND THE BODY IS READ BACK FROM THE ANSWER, so a member who typed
    // their association in by hand still gets the date. Their name seeds
    // `seenBodies`, so every one of their own documents for that body takes
    // the dedup branch — under the old code that meant the expiry could never
    // be offered to precisely the member who had done the most work.
    //
    // ⚠️ `||` AND NOT `??`. The re-derivation path in
    // motivation-prefill.service.ts BLANKS the keys it is allowed to replace
    // (`answered[key] = ''`) and re-runs the offer, so an empty string here
    // means "unanswered", exactly as offer() itself reads it. `??` would take
    // that '' as the answer and never look at the name this run just filled.
    const slotOneBody =
      (answered['association_name'] ?? '').trim() ||
      (values['association_name'] ?? '').trim();
    if (slotOneBody) {
      const dated = bestDatedFor(dedicated, slotOneBody);
      if (dated) {
        offer(
          'association_expiry',
          'Association membership valid until',
          dated.expiresOn ?? '',
          dated.title,
          dated.id,
        );
      }
    }

    // Anything from a body already on the form that gave nothing at all.
    for (const c of sameBody) {
      if (items.some((i) => i.credentialId === c.id)) continue;
      skipped.push({
        title: c.title,
        why: 'you are already listed as a member of that association, and this document adds nothing the form asks for',
      });
    }
  }

  // ── where they work ──────────────────────────────────────────────
  //
  // ⚠️ THE LETTER WAS ALREADY IN THE VAULT AND FILLED NOTHING. Four boxes on
  // the 271 — occupation, employer, employer's address, its postal code — and
  // the one document that answers all four had no branch here at all, so a
  // member who had uploaded their employment confirmation still typed every
  // one of them. `occupation` is REQUIRED, which is the part that bites.
  //
  // ⚠️ FACTS, NOT DATES. Nothing here is a date key, so the settled gate does
  // not apply — and it should not: an employment letter's validity is not
  // arithmetic on a printed date, it is whether the member still works there.
  // That question is asked separately, on the row, by reuseCaution.
  for (const c of credentials) {
    if (c.kind !== 'EMPLOYMENT_CONFIRMATION') continue;
    offer(
      'occupation',
      'Occupation',
      first(c.details, 'occupation', 'job_title', 'position'),
      c.title,
      c.id,
    );
    offer(
      'employer_name',
      'Employer',
      first(c.details, 'employer_name', 'employer'),
      c.title,
      c.id,
    );
    offer(
      'employer_address',
      "Employer's address",
      first(c.details, 'employer_address'),
      c.title,
      c.id,
    );
    offer(
      'employer_postal_code',
      "Postal code for the employer's address",
      first(c.details, 'employer_postal_code', 'postal_code'),
      c.title,
      c.id,
    );
  }

  // ── the licence being renewed ────────────────────────────────────
  //
  // ⚠️ ONLY ON A RENEWAL, AND ONLY WHEN THERE IS EXACTLY ONE. A section 24
  // started from the Licence Centre arrives with a seed naming the licence; one
  // started BY HAND — which is the normal route for somebody who came straight
  // to the Motivation Centre — arrives with nothing, and both of these are
  // REQUIRED fields. So the vault answers them.
  //
  // Several licences is a question, not a coin toss: `existing_licence_number`
  // and `licence_expiry` are the two facts that say WHICH firearm this whole
  // application is about, and picking the wrong one produces a renewal for a
  // gun the applicant was not renewing. Same rule as auto-link's
  // several-candidates skip, and for the same reason.
  //
  // Both keys are dates or near-dates in the settled sense — `licence_expiry`
  // is one — so the gate above still applies to it, and it comes off the
  // vault's own column rather than the details blob, which does not carry it.
  if (licenceType === 'S24_RENEWAL') {
    const licences = credentials.filter((c) => LICENCE_KINDS.has(c.kind));
    if (licences.length === 1) {
      const c = licences[0];
      offer(
        'existing_licence_number',
        'The licence being renewed',
        first(c.details, 'licence_number'),
        c.title,
        c.id,
      );
      offer(
        'licence_expiry',
        'Expiry date',
        c.expiresOn ?? '',
        c.title,
        c.id,
      );
    } else if (licences.length > 1) {
      for (const c of licences) {
        skipped.push({
          title: c.title,
          why: 'you hold more than one licence, so only you can say which one this renewal is for',
        });
      }
    }
  }

  return {
    values,
    items,
    skipped,
    empty: credentials.length === 0,
  };
}

/**
 * The kinds that evidence section 16 dedicated status.
 *
 * PROFESSIONAL_HUNTER is deliberately NOT here. A PH registration is a
 * provincial nature-conservation qualification to hunt for a client — it is
 * not dedicated status under section 16, it is issued by a different
 * authority, and filing it as association membership would put a wrong claim
 * in somebody's application.
 *
 * ⚠️ MEMBERSHIP OF THIS SET IS NOT ENOUGH ON ITS OWN, AND TREATING IT AS
 * ENOUGH WAS A REAL FAULT. All three kinds here evidence "dedicated status" of
 * SOME sort, and the offer loop tested nothing else — so dedicated-HUNTER
 * papers filled the sport shooter's association block, under a label reading
 * "Your sport-shooting association", on an application signed under section
 * 120(9)(f). The discipline is a second question with its own answer; see
 * dedicatedStatusFits, which every caller taking association details must ask.
 * The 2026-08-20 consolidation is what made the two questions separate: before
 * it, the kind WAS the discipline.
 */
const DEDICATED_KINDS = new Set([
  'DEDICATED_DISCIPLINE',
  // Retired, still held by rows filed before the consolidation.
  'DEDICATED_STATUS',
  'DEDICATED_HUNTER',
]);

/**
 * Which vault documents are worth showing as "you have this already" against
 * a motivation's required-documents list.
 *
 * Maps a CredentialKind onto the MotivationUploadKind it satisfies. One-way
 * and deliberately narrow: only where the two really are the same piece of
 * paper.
 */
/**
 * One vault document offered as a pickable source for a group of fields.
 *
 * ⚠️ THE VALUES TRAVEL TOGETHER. A dedicated-status card carries the
 * association's name AND the membership number, and they are only true as a
 * pair — offering them as two independent picks invites a member with two
 * associations to end up with one body's name against the other's number,
 * which is a false statement on a section 16 application.
 */
export interface CredentialChoice {
  credentialId: string;
  title: string;
  expiresOn: string | null;
  /** Field key → the value this document would put there. */
  values: Record<string, string>;
}

export interface CredentialChoices {
  competency: CredentialChoice[];
  dedicated: CredentialChoice[];
}

/**
 * Every vault document the applicant could CHOOSE from, per field group.
 *
 * Distinct from `credentialOffer`, which decides for them: the offer fills
 * the first document that can answer a slot and stops. That is right when
 * somebody holds one competency certificate, and wrong the moment they hold
 * two — a renewed one and the expired original, or a handgun competency and a
 * rifle one. Then the only correct answer is to ask.
 *
 * ⚠️ IT LISTS DOCUMENTS THAT ARE ALREADY ANSWERED FOR TOO. Unlike the offer
 * this takes no `answered` map, because its whole job is to let somebody
 * CHANGE a value — filtering out the currently-chosen document would remove
 * the one entry that shows them what they picked last time.
 */
export function credentialChoices(
  credentials: CredentialSource[],
): CredentialChoices {
  const competency: CredentialChoice[] = [];
  const dedicated: CredentialChoice[] = [];

  for (const c of credentials) {
    if (COMPETENCY_KINDS.has(c.kind)) {
      const number = first(c.details, 'competency_number', 'certificate_number');
      // A certificate we could not read a number off is not a choice — it is
      // an entry that does nothing when picked.
      if (!number) continue;
      competency.push({
        credentialId: c.id,
        title: c.title,
        expiresOn: c.expiresOn,
        values: { competency_number: number },
      });
      continue;
    }
    if (DEDICATED_KINDS.has(c.kind)) {
      const name = first(c.details, 'association', 'issuer');
      const number = first(
        c.details,
        'status_number',
        'membership_number',
        'reference_number',
      );
      if (!name && !number) continue;
      const values: Record<string, string> = {};
      if (name) values.association_name = name;
      if (number) values.association_number = number;
      dedicated.push({
        credentialId: c.id,
        title: c.title,
        expiresOn: c.expiresOn,
        values,
      });
    }
  }

  return { competency, dedicated };
}

/**
 * ⚠️ ONE VAULT DOCUMENT CAN SATISFY SEVERAL CHECKLIST ROWS, so this is a list.
 *
 * It was one-to-one, which was exactly wrong for the document that prompted
 * the consolidation: a single membership certificate that is both the
 * association card and the section 16 letter of good standing could satisfy
 * one row or the other, never both, and the applicant was asked to upload a
 * paper they had already given us.
 *
 * FIRST ENTRY IS THE PRIMARY — the kind the stored upload row actually gets.
 * The rest ride along in MotivationUpload.coversKinds, because a second row
 * for the same bytes would print the same page twice in the pack.
 */
/**
 * ⚠️ EXHAUSTIVE OVER CredentialKind, AND THAT IS THE POINT. This was
 * `Record<string, string[]>`, which compiles cleanly whatever is missing —
 * so adding a vault kind without a mapping here produces no error anywhere.
 * The failure it hides is silent and total: primaryUploadKind() returns
 * undefined, buildLibrary drops the row from the picker, and addFromLibrary
 * refuses it with "That document does not answer anything on this
 * application" — a document that is stored, invisible, and still counting
 * against the member's cap.
 *
 * Typed to the enum, the compiler names every site the day a kind is added.
 * An empty array is a legitimate answer — a vault document with no slot on a
 * motivation is kept and tracked and simply has nothing to fill; see
 * motivation-library.ts, which already handles it.
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
   * ⚠️ IT FILLS THE SLOT, AND IT IS STILL IN NEVER_AUTOLINK. Mapping a kind to
   * a slot says where it CAN go, not that it goes there unasked — an
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
  // offered as an attachment — a Professional Hunter registration evidences
  // nothing under section 16, and OTHER is unclassified by definition.
  PROFESSIONAL_HUNTER: [],
  OTHER: [],

  // ── AN IDENTITY MAP, WHICH IS WHY THE NAMES MATCH ──────────────────
  //
  // The eight person-level kinds were deliberately given the same names as
  // their MotivationUploadKind counterparts so this half of the module has no
  // translation table for anyone to get wrong. Same name, same document, same
  // checklist row.
  IDENTITY_DOCUMENT: [MotivationUploadKind.IDENTITY_DOCUMENT],
  ADDRESS_CONFIRMATION: [MotivationUploadKind.ADDRESS_CONFIRMATION],
  EMPLOYMENT_CONFIRMATION: [MotivationUploadKind.EMPLOYMENT_CONFIRMATION],
  SAFE_PHOTOGRAPHS: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  // ⚠️ THE RETIRED FOUR MAP FORWARD, they do not map to themselves. A vault row
  // filed before 2026-08-23 still answers the safe row on a new application;
  // pointing it at its own retired upload kind would file it outside the only
  // kind the checklist now looks for, and the member would be asked to
  // photograph a safe we already hold pictures of.
  SAFE_PHOTO_CLOSED: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SAFE_PHOTO_AJAR: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SAFE_PHOTO_BOLTS: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SAFE_INSTALLATION: [MotivationUploadKind.SAFE_PHOTOGRAPHS],
  SHOOTING_ACTIVITY_LOG: [MotivationUploadKind.SHOOTING_ACTIVITY_LOG],
};

/**
 * The checklist row a vault document is filed as, or undefined for one that
 * fills nothing.
 *
 * Takes a plain string on purpose: the pure library types a vault row's kind
 * as `string` so it can stay free of Prisma. The cast is safe because an
 * unknown key simply misses — and the EXHAUSTIVENESS that matters is on the
 * map literal above, where the compiler enforces it.
 */
export function primaryUploadKind(
  credentialKind: string,
): MotivationUploadKind | undefined {
  return CREDENTIAL_TO_UPLOAD[credentialKind as CredentialKind]?.[0];
}

/** Every checklist row a vault document answers. Empty for one that fills none. */
export function uploadKindsFor(credentialKind: string): MotivationUploadKind[] {
  return CREDENTIAL_TO_UPLOAD[credentialKind as CredentialKind] ?? [];
}

/**
 * How fresh a proof of address has to be.
 *
 * ⚠️ NINETY DAYS IS THE OPERATOR'S RULE, and it is already written down in
 * motivation-checklist.ts: name, address, and a date inside the last three
 * months. It is what a DFO looks for and it is not negotiable by us.
 */
export const ADDRESS_FRESH_DAYS = 90;

/**
 * When a record of hunts or shoots starts reading badly.
 *
 * Six months. ⚠️ NOT A HARD LIMIT — a stale log is still worth attaching, and
 * saying so is the point. What it must not do is go in silently: a log that
 * stops eighteen months ago reads WORSE to a reviewer than a short one that is
 * current, because it looks like somebody who used to do this.
 */
export const ACTIVITY_STALE_DAYS = 180;

/** Days between two yyyy-mm-dd days, or null if either is unreadable. */
function daysBetween(from: string, to: Date): number | null {
  const t = Date.parse(`${from}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((to.getTime() - t) / 86_400_000);
}

/**
 * What to say beside a document being offered for reuse — or nothing.
 *
 * ⚠️ THREE KINDS OF DOCUMENT, THREE DIFFERENT PROBLEMS, and lumping them into
 * one "check this is still current" would be useless on all three:
 *
 *   A PROOF OF ADDRESS AGES. It is judged on the date printed on it, so the
 *   test is arithmetic and the warning can be specific.
 *
 *   AN EMPLOYMENT LETTER GOES OUT OF DATE WITHOUT AGEING. Nothing on the paper
 *   says it is wrong; the applicant changed jobs. Only they know, so it is a
 *   question, not a verdict.
 *
 *   A SAFE PHOTOGRAPH IS NOT ABOUT TIME AT ALL. It is a photograph of THIS
 *   safe at THIS dwelling, and the whole thing turns on the address on the
 *   application rather than on how old the picture is. A member who moved
 *   house and reuses last year's shots has submitted photographs of somebody
 *   else's wall. There is no structured address on the stored document to
 *   compare against, and inferring one wrongly is exactly the failure this
 *   whole exercise exists to prevent — so it is ASKED, never computed. See
 *   `askPlace` on LibraryItem.
 *
 * PURE, and `today` is a PARAMETER — same rule as validLongEnough above, so
 * the behaviour is testable at a frozen date instead of drifting with the
 * clock.
 *
 * @param issuedOn  the date PRINTED on the document, yyyy-mm-dd, or null.
 *                  ⚠️ NOT createdAt: somebody can upload a six-month-old
 *                  municipal bill today, and judging it by when they
 *                  photographed it would call a stale document fresh.
 * @param addedOn   when it reached us, yyyy-mm-dd. Only used where the
 *                  document carries no date of its own.
 */
export function reuseCaution(
  kind: MotivationUploadKind,
  issuedOn: string | null,
  addedOn: string,
  today: Date,
): { tone: 'ask' | 'stale'; text: string } | null {
  if (kind === MotivationUploadKind.ADDRESS_CONFIRMATION) {
    const age = issuedOn ? daysBetween(issuedOn, today) : null;
    if (age === null) {
      return {
        tone: 'ask',
        text: 'Check the date printed on this is inside the last three months. A DFO wants a recent one, in your name.',
      };
    }
    if (age > ADDRESS_FRESH_DAYS) {
      return {
        tone: 'stale',
        text: `Dated ${issuedOn} — older than three months. A DFO wants one from the last three months, in your name.`,
      };
    }
    return null;
  }

  if (kind === MotivationUploadKind.EMPLOYMENT_CONFIRMATION) {
    return {
      tone: 'ask',
      text: `Added ${addedOn}. If your work has changed since, this letter says the wrong thing.`,
    };
  }

  if (kind === MotivationUploadKind.SHOOTING_ACTIVITY_LOG) {
    const age = daysBetween(issuedOn ?? addedOn, today);
    if (age !== null && age > ACTIVITY_STALE_DAYS) {
      return {
        tone: 'stale',
        text: `Last updated ${issuedOn ?? addedOn}. A log that stops well short of today reads worse than a short one that is current — add the recent entries and photograph it again.`,
      };
    }
    return null;
  }

  return null;
}

/**
 * Documents that are of a PLACE, not of a person or a date.
 *
 * Photographs of the safe. Their freshness question is not "when was this
 * taken" but "is this the safe at the address on THIS application", and only
 * the applicant can answer it. The picker asks with a tick, and the server
 * refuses the attachment without it.
 *
 * ⚠️ THE RETIRED KINDS ARE STILL ASKED. A photograph filed before the four
 * became one is no less a photograph of a place, and dropping them here would
 * let last year's shots of a wall at an old address onto a new application
 * without the tick.
 */
export function asksPlace(kind: MotivationUploadKind): boolean {
  return (
    kind === MotivationUploadKind.SAFE_PHOTOGRAPHS ||
    kind === MotivationUploadKind.SAFE_PHOTO_CLOSED ||
    kind === MotivationUploadKind.SAFE_PHOTO_AJAR ||
    kind === MotivationUploadKind.SAFE_PHOTO_BOLTS ||
    kind === MotivationUploadKind.SAFE_INSTALLATION
  );
}

/**
 * The two documents a section 16 pack can be handed automatically.
 *
 * ⚠️ THESE AND NOTHING ELSE. An endorsement names ONE firearm, so an old one
 * describes the wrong gun and attaching it unasked would put a wrong document
 * in front of a DFO. Status and good standing describe the PERSON, and the
 * person has not changed since last time.
 */
export const S16_AUTO_ATTACH: string[] = [
  'ASSOCIATION_CARD',
  'GOOD_STANDING_LETTER',
];

/**
 * How much validity a document must have left before we attach it unasked.
 *
 * ⚠️ THREE MONTHS, THE OPERATOR'S NUMBER, and it is the right shape: SAPS
 * takes months over a section 16 application, so a letter of good standing
 * that expires in three weeks is one the DFO will reject or the Registrar
 * will query long before a decision. Attaching it silently would hand
 * somebody a pack that looks complete and is already stale. Below the
 * threshold the document still appears in the library — the member can attach
 * it deliberately, having seen the date.
 */
export const AUTO_ATTACH_MIN_DAYS = 90;

/** Does this document have enough life left to be attached unasked? */
export function validLongEnough(
  expiresOn: string | null,
  today: Date,
): boolean {
  // No expiry at all is the dedicated status certificate, which does not
  // carry one. Nothing to be stale about.
  if (!expiresOn) return true;
  const end = Date.parse(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(end)) return false;
  const days = (end - today.getTime()) / 86_400_000;
  return days >= AUTO_ATTACH_MIN_DAYS;
}
