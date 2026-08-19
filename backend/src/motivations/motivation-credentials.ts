import { MotivationLicenceType } from '@prisma/client';
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

    const p = `existing_firearm_${row}_`;
    offer(`${p}type`, `Firearm ${row} — type`, type, c.title, c.id);
    offer(`${p}calibre`, `Firearm ${row} — calibre`, calibre, c.title, c.id);
    offer(`${p}make`, `Firearm ${row} — make`, make, c.title, c.id);
    offer(`${p}frame_serial`, `Firearm ${row} — frame serial`, frame, c.title, c.id);
    offer(`${p}barrel_serial`, `Firearm ${row} — barrel serial`, barrel, c.title, c.id);
    offer(`${p}licence_no`, `Firearm ${row} — licence number`, licence, c.title, c.id);
    row++;
  }

  // ── dedicated status ─────────────────────────────────────────────
  for (const c of credentials) {
    if (!DEDICATED_KINDS.has(c.kind)) continue;
    offer(
      'association_name',
      'Your association',
      first(c.details, 'association', 'issuer'),
      c.title,
      c.id,
    );
    offer(
      'association_number',
      'Membership number',
      first(c.details, 'status_number', 'membership_number', 'reference_number'),
      c.title,
      c.id,
    );
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
const DEDICATED_KINDS = new Set(['DEDICATED_STATUS', 'DEDICATED_HUNTER']);

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

export const CREDENTIAL_TO_UPLOAD: Record<string, string> = {
  FIREARM_LICENCE: 'CURRENT_LICENCE',
  COMPETENCY_CERTIFICATE: 'COMPETENCY_CERTIFICATE',
  DEDICATED_STATUS: 'ASSOCIATION_CARD',
  DEDICATED_HUNTER: 'ASSOCIATION_CARD',
  PROFICIENCY: 'PROFICIENCY_CERTIFICATE',
};
