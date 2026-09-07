import { CredentialKind } from '@prisma/client';
import {
  type CompetencyCategory,
  endorsementSpec,
  type LinkedLicence,
  parseEndorsements,
} from '../common/sa-competency';
import { dateIsSettled, toIsoDate } from './licence-dates';
// The form's own vocabulary, owned by the module that owns the form.
import { normaliseFirearmType } from '../motivations/saps-vocabulary';
import { answerValue } from '../common/card-placeholder';
// Field keys belong to the registry, which is the contract for all of them.
import { COMPETENCY_RENEWS_KEY } from '../motivations/motivation-fields';

// ────────────────────────────────────────────────────────────────────
// THE RENEWAL LOOP.
//
// This is the join that makes the Licence Centre worth building: the reminder
// lands, and one tap opens a section 24 renewal motivation already carrying
// everything the vault knows about the licence being renewed.
//
// It is also where the recurring income is. Renewals recur by statute — the
// demand never stops — and the pack is priced by the existing table
// (R199 / R99 / free with AO Pro).
//
// PURE — no Nest, no Prisma, no clock. Everything it needs is passed in.
// ────────────────────────────────────────────────────────────────────

/** What the vault holds about one document, decrypted. */
export interface RenewalSource {
  /**
   * The credential row's own id. The application reference falls back to it
   * when the card's licence number could not be read — see applicationRef.
   */
  id: string;
  kind: CredentialKind;
  title: string;
  expiresOn: Date | null;
  confirmedAt: Date | null;
  /**
   * How the expiry date got there: confirmed by the member, or filled in and
   * armed by us. See dateIsSettled, and renewalRefusal below for why this
   * matters more than confirmedAt alone.
   */
  dateSource: string | null;
  /**
   * Whether the licence describes a self-loading firearm, as the Licence
   * Centre read it off the card. Null where it could not be told.
   */
  firearmSelfLoading: boolean | null;
  /** Decrypted detail map — licence_number, make, calibre, serials, … */
  details: Record<string, string>;
}

export type RenewalRefusal = 'not-a-licence' | 'no-confirmed-date';

export interface RenewalPlan {
  /** Answers to seed the new motivation with. */
  seed: Record<string, string>;
  /**
   * Disambiguates the motivation, because one member may hold several
   * licences and `@@unique([userId, licenceType, applicationRef])` would
   * otherwise let them renew exactly one, ever.
   */
  applicationRef: string;
}

/**
 * Why a renewal cannot start from this document — or null if it can.
 *
 * Refusing EARLY and by NAME is the point. The alternative is a motivation
 * that opens empty with no explanation, which reads as the button being
 * broken.
 */
export function renewalRefusal(src: RenewalSource): RenewalRefusal | null {
  // A competency renewal is a different application on a different form; the
  // writer's section 24 pack is about a firearm licence. Offering the button
  // on a competency certificate would produce a document for the wrong thing.
  if (src.kind !== 'FIREARM_LICENCE') return 'not-a-licence';

  // The expiry date IS the application: section 24 turns on when the current
  // licence runs out.
  //
  // ⚠️ SETTLED, NOT CONFIRMED. This asked for `confirmedAt` alone while every
  // other consumer had moved to `dateIsSettled` — "confirmed by the member, OR
  // filled in and armed by us". So on an auto-dated licence the reminder sweep
  // fired at T-180, T-120, T-100, T-30 and on the day, `renewalDue` was true,
  // the competency expiry was derived off it — and the Renew button was not
  // offered, and this endpoint answered "Confirm the expiry date on this
  // document first." That is precisely the confirm step guarding a value we
  // already hold that CLAUDE.md's "Automate It — Do Not Ask" overturned.
  if (!src.expiresOn || !dateIsSettled(src)) return 'no-confirmed-date';

  // ⚠️ NOT REFUSED FOR A MISSING LICENCE NUMBER, deliberately.
  //
  // It used to be, and it was a dead end with no exit: the extraction prompt
  // omits any value it cannot read with certainty, so a glare on the card
  // loses the number while the expiry reads fine — and nothing anywhere in
  // the product could then add it. The wizard asks for
  // existing_licence_number as a required, editable field anyway, so the
  // honest behaviour is to open the renewal and let them type the one value
  // we could not read.

  return null;
}

/** The message the member actually sees. Each one says what to do next. */
export const REFUSAL_COPY: Record<RenewalRefusal, string> = {
  'not-a-licence':
    'A renewal pack is for a firearm licence. Competency and dedicated status are renewed separately, through your association or the police station.',
  'no-confirmed-date':
    'Confirm the expiry date on this document first — the renewal is built around it.',
};

/**
 * Build the answers a section 24 motivation should open with.
 *
 * ⚠️ ONLY WHAT THE DOCUMENT ACTUALLY SAYS. Nothing is inferred and nothing is
 * invented — every value here can be checked against the card in the member's
 * hand, because they will be signing the result. Anything the vault does not
 * hold stays an ordinary question in the wizard.
 */
export function renewalPlan(src: RenewalSource): RenewalPlan {
  const d = src.details;
  const seed: Record<string, string> = {};

  // ⚠️ answerValue, NOT trim. The vault stores what the card printed and is
  // right to; a South African licence prints NONE against a component that
  // carries no number. Trim alone let that through, and every other answer
  // boundary in the product now guards it — this one imported nothing. A rifle
  // whose frame row reads NONE would have opened a renewal with
  // `firearm_serial: 'NONE'`, which is briefed to the writer and policed by
  // motivation-verify against the finished document.
  const put = (key: string, value: string | undefined | null) => {
    const v = answerValue(value);
    if (v) seed[key] = v;
  };

  const number = licenceNumber(d);
  put('existing_licence_number', number);
  if (src.expiresOn) put('licence_expiry', toIsoDate(src.expiresOn));

  // THE FIREARM ITSELF, on the keys the WIZARD renders.
  //
  // ⚠️ These are not the same keys as the existing_firearm_1_* block below.
  // That block feeds the SAPS 271 table and the overlap engine; the step the
  // applicant actually sees — "The firearm" — reads firearm_make,
  // firearm_calibre and friends, and every one of them is required. Seeding
  // only the 271 keys meant the card promised "already carrying the
  // firearm's details" and then presented five blank required boxes.
  // ⚠️ ONE SERIAL, CHOSEN ONCE, SO TWO SCREENS CANNOT SHOW TWO NUMBERS. The
  // applied-for box took the frame number while the owned-row summary reads
  // `serial || barrel_serial || frame_serial` — the BARREL — so one firearm
  // showed two serials on one application wherever the card printed both.
  // answerValue does the falling through: a frame row reading NONE is not a
  // number, so the barrel's is used.
  const serial = answerValue(d.frame_serial) || answerValue(d.barrel_serial);

  // ⚠️ THE ACTION IS A FACT WE ALREADY HOLD, AND IT WAS BEING ASKED FOR.
  //
  // `firearm_action` is required, and a licence card does not print one — the
  // Licence Centre works self-loading out from the card's own wording and
  // stores it. Without it `endorsementNeed` answers "unknown" for a rifle, so
  // credentialOffer offers no competency and posts "we will fill your
  // competency in as soon as you have said which firearm this application is
  // for". On a renewal that sentence is addressed to somebody whose firearm we
  // named from their own licence two lines above.
  //
  // ⚠️ ONLY THE 'true' CASE CAN BE WRITTEN. Not self-loading leaves six manual
  // actions — bolt, lever, pump, single shot, revolver, break — and the card
  // says which none of them. Absent stays absent; guessing would put a word on
  // a signed form that no document supports.
  if (src.firearmSelfLoading === true) {
    put('firearm_action', 'Semi-automatic (self-loading)');
  }

  put('firearm_make', d.make);
  put('firearm_model', d.model);
  put('firearm_calibre', d.calibre);
  put('firearm_type', normaliseFirearmType(d.firearm_type));
  put('firearm_serial', serial);

  // The renewal form asks about the firearm itself, and the licence names it.
  // These are the same keys the overlap engine reads, so a renewal that also
  // mentions other owned firearms lines up with the rest of the registry.
  // ⚠️ `_serial`, `_model` AND `_expiry` — the operator's four columns.
  //
  // This wrote `_frame_serial` and `_barrel_serial`, both RETIRED on
  // 2026-09-07 and deliberately excluded from fieldsFor, so the wizard's one
  // serial box rendered EMPTY while the number sat in a key no screen shows.
  // `_model` and `_expiry` were never written at all, though the model is on
  // the card and the expiry was in hand ten lines above. Row 1 is
  // ownedRowTaken, so credentialOffer skips it by identifier match and the
  // vault could never come back and fill the blanks: three of the four columns
  // the operator asked for were empty for the one firearm the application is
  // about.
  put('existing_firearm_1_licence_no', number);
  put('existing_firearm_1_make', d.make);
  put('existing_firearm_1_model', d.model);
  put('existing_firearm_1_calibre', d.calibre);
  put('existing_firearm_1_type', normaliseFirearmType(d.firearm_type));
  put('existing_firearm_1_serial', serial);
  if (src.expiresOn) put('existing_firearm_1_expiry', toIsoDate(src.expiresOn));

  // ⚠️ `continued_use` IS DELIBERATELY LEFT EMPTY. It is the only question on
  // a renewal that carries an argument — what they have actually done with the
  // firearm since it was issued — and it is the reason the pack is worth
  // paying for. Pre-filling it with something plausible would put words in an
  // applicant's mouth on a document they sign as their own.

  return {
    seed,
    // The licence number is the natural reference: it is what the member and
    // the DFO both call this application, and it keeps two renewals for two
    // different firearms from colliding on the one-per-type constraint.
    //
    // ⚠️ AND IT FALLS BACK TO THE DOCUMENT'S OWN ID RATHER THAN TO ''. A
    // missing licence number is expressly not a refusal above — glare loses
    // the number while the expiry reads fine — and an empty ref put every such
    // renewal on the same (userId, S24_RENEWAL, '') key. startRenewal's
    // idempotency findFirst keys on exactly that triple, so a member with two
    // unreadable licences tapped Renew on the second and was silently opened
    // into the FIRST licence's pack, already seeded with the other firearm's
    // make, calibre and serial, with nothing on screen saying so.
    applicationRef: number ? `LIC-${number}` : `LIC-ROW-${src.id}`,
  };
}

function licenceNumber(d: Record<string, string>): string {
  return (d.licence_number ?? d.reference_number ?? '').trim();
}

// ────────────────────────────────────────────────────────────────────
// SAPS 517(g) — THE SECOND FORM NOBODY WAS TOLD ABOUT.
//
// ⚠️ THE PRODUCT SAID NOTHING ABOUT THIS ANYWHERE, and it is the one piece of
// renewal advice that costs a competency when it is missed.
//
// A competency has no lifespan of its own. Section 10(2), as amended in 2011,
// ties it to the licence it relates to — in practice, to the LATEST-dated
// licence in that firearm category (reference §5.3). So renewing an ordinary
// licence usually changes nothing about the competency: a longer-dated licence
// in the same category is still holding it up.
//
// But when the licence being renewed is the LAST one in its category, the
// competency is expiring on the same day, and reference §6.2 is explicit about
// what follows: "a SAPS 517(g) is required only when the competency is
// actually expiring — i.e. when the licence being renewed is your longest-dated
// licence in that firearm class." Section 10A(1) then requires that renewal to
// be lodged TOGETHER WITH the licence renewal — two forms, two fees, one visit.
//
// Miss it and the licence renewal can be accepted while the competency behind
// it lapses, and the whole chain has to be rebuilt. It is exactly the sort of
// thing a member finds out at the counter, and we hold every fact needed to
// tell them beforehand.
//
// ⚠️ SILENT UNLESS WE ARE SURE OF BOTH HALVES. An uncategorised licence, or a
// member whose certificates we could not read, gets no sentence — the advice
// is only useful if it is right, and "you may also need a 517(g)" hedged onto
// every reminder is noise that trains people to ignore the ones that matter.
// ────────────────────────────────────────────────────────────────────

/**
 * The one sentence to add to a renewal reminder, or null.
 *
 * PURE. Every fact is passed in, including the categories read off the
 * member's own competency certificates, so this can be tested standing
 * anywhere in time and with any portfolio.
 */
export function competencyRenewalNote(args: {
  /** The expiring licence's firearm category. Null where we could not read it. */
  category: CompetencyCategory | null;
  /** When the expiring licence runs out. */
  expiresOn: Date | null;
  /**
   * Every OTHER licence the member holds — this one excluded by the caller.
   *
   * ⚠️ IF THE CALLER FORGETS TO EXCLUDE IT, the row compares equal to itself
   * and the strict `>` below still answers correctly. That is deliberate: the
   * failure mode of a mistake here should be silence, not a wrong instruction
   * about a form.
   */
  otherLicences: readonly LinkedLicence[];
  /** Every category covered by a competency certificate on file. */
  competencyCategories: readonly CompetencyCategory[];
}): string | null {
  const { category, expiresOn } = args;
  if (!category || !expiresOn) return null;
  // A muzzle loader takes no licence at all (s3(2)), so there is no licence
  // renewal to lodge anything alongside — its competency runs its own fixed
  // ten years under s10(3) and renews on its own timetable.
  if (category === 'muzzle-loader') return null;
  // No competency covering this category means nothing to renew with it.
  if (!args.competencyCategories.includes(category)) return null;

  // ⚠️ STRICTLY LATER, NOT "later or equal". Two licences in the category
  // expiring on the SAME day both lapse that day, so the competency lapses
  // with them and the 517(g) is still due. Using >= would have the second
  // licence silently vouch for the first.
  const outlasted = args.otherLicences.some(
    (l) =>
      l.category === category &&
      l.expiresOn !== null &&
      l.expiresOn.getTime() > expiresOn.getTime(),
  );
  if (outlasted) return null;

  const word = CATEGORY_WORD[category];
  return `This is the last ${word} licence you hold, so your ${word} competency runs out with it — renew the competency at the same time, on a SAPS 517(g). The two are lodged together.`;
}

/**
 * THE SAME FINDING, AS AN ANSWER THE PACK CAN READ.
 *
 * ⚠️ THE ADVICE WAS COMPUTED AND SHOWN NOWHERE. `startRenewal` has returned a
 * `competencyNote` since the day this module was written, and the only thing
 * that ever read it was the response body — so a member who tapped Renew,
 * glanced at the card and came back the next day never saw it again. The
 * checklist is the surface that survives: it is the list they take to the
 * counter, and lodging the 517(g) WITH the licence renewal is a
 * counter-day instruction.
 *
 * ⚠️ SO THIS SEEDS A FLAG, NOT THE SENTENCE. The note is prose about a
 * DIFFERENT form; the earlier decision not to put it in an answer was right,
 * because `plan.seed` becomes answers on a SAPS 271 the applicant signs as
 * their own and prose in a box is a statement of fact by them. A Yes/No on a
 * field the wizard never renders and the writer never sees carries the finding
 * without putting a word in anybody's mouth.
 *
 * ⚠️ THE KEY ITSELF LIVES IN THE REGISTRY and is imported, never restated.
 * motivation-fields.ts is the contract for what a field key IS; a key spelled
 * one way here and another way there is dropped by sanitiseAnswers, leaving
 * nothing but an "ignored unregistered answer keys" line in a log.
 *
 * ⚠️ A SNAPSHOT, TAKEN ONCE, AT THE START. The finding moves — renew a
 * longer-dated licence in the same category and it stops being true — but the
 * only way to refresh a stored answer is saveAnswers, which stamps every
 * changed key as the MEMBER's own doing. Attributing our arithmetic to them is
 * worse than a stale checklist row, and `competencyNote` rides live on both
 * returns for the surface that can afford to recompute.
 */
/**
 * The seed patch for a renewal, given the advice — usually nothing.
 *
 * ⚠️ SILENT IS NOT "No". Absent stays absent: `competencyRenewalNote` returns
 * null both for "no 517(g) is due" AND for "we could not read enough to say",
 * and writing "No" would turn the second into a reassurance we have not
 * earned. Only the confident yes is written.
 */
export function competencyRenewalSeed(
  note: string | null,
): Record<string, string> {
  return note ? { [COMPETENCY_RENEWS_KEY]: 'Yes' } : {};
}

/** How a member would say each category out loud. */
const CATEGORY_WORD: Record<CompetencyCategory, string> = {
  handgun: 'handgun',
  'rifle-carbine': 'rifle',
  shotgun: 'shotgun',
  'muzzle-loader': 'muzzle loader',
};

/**
 * The categories a stored competency certificate covers.
 *
 * ⚠️ THE `covers` LINE IS THE VERBATIM TRANSCRIPTION, not a category. It reads
 * "S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN" on a real card; parseEndorsements
 * turns that into endorsements and endorsementSpec into categories. Doing it
 * here means the two callers — the reminder sweep and the renewal one-tap —
 * cannot come to different views of the same certificate.
 */
export function competencyCategoriesFrom(
  covers: readonly string[],
): CompetencyCategory[] {
  const out = new Set<CompetencyCategory>();
  for (const line of covers) {
    for (const e of parseEndorsements(line)) {
      const spec = endorsementSpec(e);
      if (spec?.category) out.add(spec.category);
    }
  }
  return [...out];
}

