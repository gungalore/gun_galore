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
  // ⚠️ THE CONTRACT ON CredentialSource.confirmed, ENFORCED. It was
  // documented as "FALSE MEANS DO NOT OFFER IT" and never checked — safe only
  // while every caller happened to pre-filter. The moment unconfirmed rows
  // started flowing to the sibling choices path, one refactor away from here,
  // this became a silent way to fill a signed application with values nobody
  // ever looked at. The pure function now keeps its own promise.
  credentials = credentials.filter((c) => c.confirmed);

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
    if ((answered[key] ?? '').trim()) return; // theirs wins, always
    if (values[key]) return; // first document to claim a slot keeps it
    values[key] = v;
    items.push({ key, label, value: v, from, credentialId });
  };

  // ── the competency number ────────────────────────────────────────
  for (const c of credentials) {
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
  SAFE_PHOTO_CLOSED: [MotivationUploadKind.SAFE_PHOTO_CLOSED],
  SAFE_PHOTO_AJAR: [MotivationUploadKind.SAFE_PHOTO_AJAR],
  SAFE_PHOTO_BOLTS: [MotivationUploadKind.SAFE_PHOTO_BOLTS],
  SAFE_INSTALLATION: [MotivationUploadKind.SAFE_INSTALLATION],
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
