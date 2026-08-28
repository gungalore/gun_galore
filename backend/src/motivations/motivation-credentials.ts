import {
  CredentialKind,
  MotivationLicenceType,
  MotivationUploadKind,
} from '@prisma/client';
import { fieldsFor } from './motivation-fields';
import { normaliseFirearmType } from './saps-vocabulary';

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
  /** The extraction map: licence_number, make, calibre, frame_serial, … */
  details: Record<string, string>;
  /** ⚠️ FALSE MEANS DO NOT OFFER IT. An unconfirmed date was never checked. */
  confirmed: boolean;
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
  const confirmedById = new Map(credentials.map((c) => [c.id, c.confirmed]));

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
    // See the note above: a document nobody has confirmed may fill a fact,
    // never a date.
    if (!confirmedById.get(credentialId) && isDateKey(key)) return;
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
      if (body) seenBodies.add(body.toUpperCase());
      slot++;
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
