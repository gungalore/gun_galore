import {
  CredentialKind,
  MotivationLicenceType,
  MotivationUploadKind,
} from '@prisma/client';
import { fieldsFor } from './motivation-fields';
import { normaliseFirearmType } from './saps-vocabulary';
import { ENDORSEMENTS, parseEndorsements } from '../common/sa-competency';

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


/** How many `existing_firearm_N_*` rows the registry carries. */
export const OWNED_ROWS = 6;

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
 */
export function isDateKey(key: string): boolean {
  return /(_since|_issued|_expiry|_expires|_date|_on)$/.test(key);
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

function first(details: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = (details[k] ?? '').trim();
    if (v) return v;
  }
  return '';
}


/**
 * Build the offer.
 *
 * @param answered  what the applicant has already typed. Never overwritten.
 */
export function credentialOffer(
  licenceType: MotivationLicenceType,
  credentials: CredentialSource[],
  answered: Record<string, string>,
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
  // ⚠️ LONGEST-RUNNING EXPIRY WINS, AND THE SORT IS WHAT DECIDES IT.
  // Operator, 2026-08-28, asked directly which of several competency
  // certificates should be chosen: "longest-running expiry wins."
  //
  // offer() is FIRST-WINS by design — "first document to claim a slot keeps
  // it" — so before this the winner was whichever certificate happened to sit
  // earliest in the array. That is not a rule, it is an accident of query
  // order, and it was invisible: both certificates are the member's own and
  // both numbers look right, so a wrong pick reaches an application unnoticed.
  // Ordering the candidates makes first-wins express the operator's rule
  // instead of the database's.
  //
  // ⚠️ A NULL EXPIRY SORTS LAST, NOT FIRST. A certificate whose date we could
  // not read is not evidence of a long life, and treating a blank as "runs
  // forever" would let the least-known document beat a dated one.
  const byLongestExpiry = credentials
    .filter((c) => COMPETENCY_KINDS.has(c.kind))
    .sort((a, b) => {
      // yyyy-mm-dd compares correctly as a string — which is why the vault
      // stores it that way. No Date parsing, no timezone to get wrong.
      if (a.expiresOn === b.expiresOn) return 0;
      if (!a.expiresOn) return 1;
      if (!b.expiresOn) return -1;
      return a.expiresOn < b.expiresOn ? 1 : -1;
    });

  for (const c of byLongestExpiry) {
    if (!COMPETENCY_KINDS.has(c.kind)) continue;
    const number = first(c.details, 'competency_number', 'certificate_number');
    if (!number) {
      skipped.push({
        title: c.title,
        why: 'we could not read a certificate number off it',
      });
      continue;
    }
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
  // ⚠️ ROWS ARE FILLED FROM THE FIRST FREE SLOT, and a slot counts as taken
  // if the applicant has typed ANY of its six columns. Writing a make into
  // row 2 while row 2's serial belongs to a different firearm would produce a
  // form describing a gun that does not exist.
  const takenRow = (n: number) =>
    ['type', 'calibre', 'make', 'barrel_serial', 'frame_serial', 'licence_no'].some(
      (col) => (answered[`existing_firearm_${n}_${col}`] ?? '').trim() !== '',
    );

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
   * Matched on the identifiers that belong to exactly one firearm. A frame
   * serial reading NONE is NOT one of them — plenty of rifles carry no frame
   * number and the licence says so, which would make every such firearm a
   * duplicate of every other.
   */
  const norm = (v: string) => v.trim().toUpperCase();
  const NOT_A_SERIAL = new Set(['', 'NONE', 'N/A', 'NA', '-']);
  const alreadyOnForm = (licence: string, frame: string, barrel: string) => {
    for (let n = 1; n <= OWNED_ROWS; n++) {
      const has = (col: string) =>
        norm(answered[`existing_firearm_${n}_${col}`] ?? '');
      const l = has('licence_no');
      const b = has('barrel_serial');
      const f = has('frame_serial');
      if (licence && l && l === norm(licence)) return true;
      if (barrel && !NOT_A_SERIAL.has(norm(barrel)) && b === norm(barrel)) {
        return true;
      }
      if (frame && !NOT_A_SERIAL.has(norm(frame)) && f === norm(frame)) {
        return true;
      }
    }
    return false;
  };

  let row = 1;
  for (const c of credentials) {
    if (!LICENCE_KINDS.has(c.kind)) continue;
    while (row <= OWNED_ROWS && takenRow(row)) row++;
    if (row > OWNED_ROWS) {
      skipped.push({
        title: c.title,
        why: `the form has room for ${OWNED_ROWS} firearms and they are all filled`,
      });
      continue;
    }

    const make = first(c.details, 'make');
    const calibre = first(c.details, 'calibre');
    const frame = first(c.details, 'frame_serial', 'serial');
    const barrel = first(c.details, 'barrel_serial');
    const licence = first(c.details, 'licence_number');
    const type = normaliseFirearmType(first(c.details, 'firearm_type', 'type'));

    if (!make && !calibre && !frame && !licence) {
      skipped.push({
        title: c.title,
        why: 'we could not read a make, calibre or serial off it',
      });
      continue;
    }

    // Already listed. Not "skipped" — nothing is missing and nothing needs
    // saying; the firearm is on the form, which is the whole point.
    if (alreadyOnForm(licence, frame, barrel)) continue;

    const p = `existing_firearm_${row}_`;
    offer(`${p}type`, `Firearm ${row} — type`, type, c.title, c.id);
    offer(`${p}calibre`, `Firearm ${row} — calibre`, calibre, c.title, c.id);
    offer(`${p}make`, `Firearm ${row} — make`, make, c.title, c.id);
    offer(`${p}frame_serial`, `Firearm ${row} — frame serial`, frame, c.title, c.id);
    offer(`${p}barrel_serial`, `Firearm ${row} — barrel serial`, barrel, c.title, c.id);
    offer(`${p}licence_no`, `Firearm ${row} — licence number`, licence, c.title, c.id);
    row++;
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
    const slots: [string, string, string][] = [
      ['association_name', 'association_number', 'dedicated_since'],
      ['association_2_name', 'association_2_number', 'association_2_joined'],
      ['association_3_name', 'association_3_number', 'association_3_joined'],
    ];
    const seenBodies = new Set(
      slots
        .map(([nameKey]) => (answered[nameKey] ?? '').trim().toUpperCase())
        .filter(Boolean),
    );
    let slot = 0;
    for (const c of credentials) {
      if (!DEDICATED_KINDS.has(c.kind)) continue;
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
      if (seenBodies.has(body.toUpperCase())) continue;
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
      // ── ITEM 60 — THE MEMBERSHIP'S "VALID UNTIL" DATE ──────────
      //
      // Operator, 2026-08-28: "Expiry dat of accredited associasian should
      // also be inserted from the letter of good standing date. that should
      // have a valid until date."
      //
      // ⚠️ FROM expiresOn, NOT FROM details. It is the column the vault
      // writes off the page and the renewal sweep already reads; the details
      // blob does not carry it.
      //
      // ⚠️ AND FROM *THIS* DOCUMENT, WHICH IS WHY IT LIVES IN THIS LOOP AND
      // NOT IN A SWEEP OF ITS OWN. A member may hold a discipline document
      // from each of three bodies — the schema says so in as many words, and
      // it is the normal case. Picking the longest-running expiry across all
      // of them would print body A's name in item 56 beside body B's date in
      // item 60: two true facts making one false statement, on a form signed
      // under section 120(9)(f).
      //
      // Only the first slot: the 271 prints one expiry box, for the
      // association in items 56-59. Associations two and three have name,
      // number and joined date on the form and no expiry to put anywhere.
      if (slot === 0) {
        offer(
          'association_expiry',
          'Association membership valid until',
          c.expiresOn ?? '',
          c.title,
          c.id,
        );
      }
      if (body) seenBodies.add(body.toUpperCase());
      slot++;
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
