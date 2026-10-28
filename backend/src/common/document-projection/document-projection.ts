import type { CaptureFact } from '../document-capture/document-capture';

// ────────────────────────────────────────────────────────────────────
// PROJECTING THE ONE-PASS CAPTURE INTO A CONTAINER.
//
// The capture reads every printed label and value. This module decides which
// canonical field each fact answers, first by label (exact, then alias), and
// then — for anything left — by asking Jev, one typed choice per field.
//
// ⚠️ NOTHING IS INVENTED. A value comes from a fact on the page, or the field
// stays empty. The caller validates it against the container registry before a
// signed form sees it.
//
// PURE aliases and hints; the service beside this file makes the Jev call.
// ────────────────────────────────────────────────────────────────────

export const PROJECTION_VERSION = '2026-10-28a';

/**
 * The label groups a canonical key belongs to. The owned-firearm rows carry a
 * slot prefix, so the group is the part after it.
 */
export function aliasGroupFor(key: string): string {
  const owned = /^existing_firearm_\d+_(type|calibre|make|model|serial|expiry|licence_no|barrel_serial|frame_serial)$/.exec(
    key,
  );
  if (owned) {
    return owned[1] === 'type'
      ? 'firearm_type'
      : owned[1] === 'expiry'
        ? 'expires_on'
        : owned[1] === 'licence_no'
          ? 'licence_number'
          : owned[1];
  }
  const assoc = /^association_([23])_(name|number|joined|expiry)$/.exec(key);
  if (assoc) {
    return assoc[2] === 'name'
      ? 'association'
      : assoc[2] === 'number'
        ? 'membership_number'
        : assoc[2] === 'joined'
          ? 'joined_on'
          : 'expires_on';
  }
  // Slot one has no number in its keys.
  if (key === 'association_name') return 'association';
  if (key === 'association_number') return 'membership_number';
  if (key === 'association_joined') return 'joined_on';
  if (key === 'association_expiry') return 'expires_on';
  // The motivation registry uses its own prefixes for the applied-for firearm
  // and the first association; they answer the same facts as the vault keys.
  const firearm = /^firearm_(make|model|calibre|type|action|serial)$/.exec(key);
  if (firearm) {
    return firearm[1] === 'make'
      ? 'make'
      : firearm[1] === 'model'
        ? 'model'
        : firearm[1] === 'calibre'
          ? 'calibre'
          : firearm[1] === 'type'
            ? 'firearm_type'
            : firearm[1] === 'action'
              ? 'action'
              : 'serial';
  }
  if (key === 'dedicated_since') return 'status_since';
  return key;
}

/** Printed labels that answer a canonical key. Compared after normalising. */
export const ALIASES: Record<string, readonly string[]> = {
  association: [
    'association',
    'club',
    'organisation',
    'organization',
    'body',
    'issuer',
    'society',
    'vereniging',
    'jagters',
    'hunters',
    'shooting association',
  ],
  membership_number: [
    'membership number',
    'member number',
    'membership no',
    'member no',
    'lidnommer',
    'lid no',
    'membership',
  ],
  status_number: [
    'status number',
    'dedicated number',
    'dedicated status number',
    'status no',
    'statusnommer',
    'dedicated no',
  ],
  status_type: [
    'status type',
    'discipline',
    'dedicated status',
    'category of status',
  ],
  holder_name: [
    'name',
    'full name',
    'full names',
    'member name',
    'holder name',
    'surname',
    'naam',
    'van',
  ],
  joined_on: [
    'joined',
    'joined on',
    'member since',
    'membership since',
    'date joined',
    'joined date',
    'member from',
    'lid sedert',
    'lidmaatskap sedert',
    'sedert',
  ],
  status_since: [
    'dedicated status held since',
    'dedicated since',
    'status granted',
    'status since',
    'registered as dedicated',
    'dedicated status since',
    'toegewyde status sedert',
    'dedicated from',
  ],
  issued_on: [
    'issue date',
    'date of issue',
    'issued',
    'issued on',
    'date issued',
    'printed on',
    'uitgereik',
    'datum uitgereik',
  ],
  expires_on: [
    'expiry date',
    'expires',
    'expiry',
    'expires on',
    'valid until',
    'valid to',
    'valid thru',
    'valid through',
    'geldig tot',
    'verval',
    'vervaldatum',
  ],
  firearm_type: [
    'type',
    'firearm type',
    'weapon type',
    'tipe',
    'wapen tipe',
  ],
  make: ['make', 'manufacturer', 'brand', 'vervaardiger', 'maak'],
  model: ['model'],
  calibre: ['calibre', 'caliber', 'cal', 'kaliber'],
  action: ['action', 'mechanism', 'aksi'],
  serial: [
    'serial number',
    'serial no',
    'serial',
    'serienommer',
    'firearm serial',
  ],
  frame_serial: ['frame serial', 'frame serial number', 'frame no'],
  barrel_serial: ['barrel serial', 'barrel serial number', 'barrel no'],
  receiver_serial: [
    'receiver serial',
    'receiver serial number',
    'receiver no',
  ],
  licence_number: ['licence number', 'license number', 'licence no'],
  section: ['section', 'licence section', 'license section', 'sect'],
  competency_number: [
    'competency number',
    'competency no',
    'certificate number',
    'cert no',
  ],
  covers: [
    'competency for',
    'covers',
    'categories',
    'covers the following',
    'competency categories',
  ],
  competency_issued: [
    'date of issue',
    'issued',
    'issue date',
    'issued on',
  ],
  certificate_number: [
    'certificate number',
    'certificate no',
    'cert no',
  ],
  unit_standard: [
    'unit standard',
    'unit standards',
    'saqa',
    'unit standard number',
  ],
  scv_number: ['scv', 'scv number', 's/c/v', 's/c/v number'],
  issuer: ['issuer', 'training provider', 'provider', 'institution'],
  document_side: ['statement of results', 'certificate'],
  id_number: [
    'id number',
    'identity number',
    'id no',
    'identity no',
    'id',
  ],
  full_name: ['full name', 'full names', 'name', 'naam'],
  issue_date: ['issue date', 'date of issue', 'issued', 'issued on'],
  residential_address: [
    'residential address',
    'address',
    'home address',
    'woonadres',
  ],
  residential_postal_code: ['postal code', 'postcode', 'poskode', 'code'],
  employer_name: ['employer', 'employer name', 'company', 'werkgewer'],
  employer_address: ['employer address', 'company address', 'work address'],
  reference_number: ['reference', 'reference number', 'ref', 'ref no'],
  accreditation_number: [
    'accreditation number',
    'accreditation no',
    'accreditation',
  ],
  endorsement_number: ['endorsement number', 'endorsement no', 'endorsement'],
  signed_by: ['signed by', 'signatory', 'chairperson', 'signature'],
  province: ['province', 'provinsie'],
  category: ['category', 'kategorie'],
  registration_number: [
    'registration number',
    'registration no',
    'reg no',
  ],
  good_standing_number: [
    'good standing number',
    'good standing ref',
    'gs number',
  ],
  good_standing: ['good standing', 'in good standing'],
  status_since_legacy: ['status since', 'dedicated since'],
};

/** A human description per canonical key, for Jev's choice criteria. */
export const KEY_HINTS: Record<string, string> = {
  association: 'the association or club that issued the document',
  membership_number: 'the membership number',
  status_number: 'the dedicated-status number',
  status_type: 'the discipline or type of dedicated status',
  holder_name: 'the member or holder’s name',
  joined_on: 'the day the member joined the association',
  status_since: 'the day the dedicated status was awarded',
  issued_on: 'the day this piece of paper was issued',
  expires_on: 'the date the membership or document is valid until',
  firearm_type: 'the firearm type or class',
  make: 'the firearm manufacturer',
  model: 'the firearm model',
  calibre: 'the calibre',
  action: 'the firearm action',
  serial: 'the firearm’s serial number',
  frame_serial: 'the frame serial number',
  barrel_serial: 'the barrel serial number',
  receiver_serial: 'the receiver serial number',
  licence_number: 'the licence number',
  section: 'the licence section',
  competency_number: 'the competency certificate number',
  covers: 'the firearm categories the competency covers',
  competency_issued: 'the competency issue date',
  certificate_number: 'the certificate number',
  unit_standard: 'the SAQA unit standard number(s)',
  scv_number: 'the S/C/V number',
  issuer: 'the training provider or issuer',
  document_side: 'which side of the proficiency this is',
  id_number: 'the identity number',
  full_name: 'the full name',
  issue_date: 'the issue date',
  residential_address: 'the residential address',
  residential_postal_code: 'the residential postal code',
  employer_name: 'the employer’s name',
  employer_address: 'the employer’s address',
  reference_number: 'the reference number',
  accreditation_number: 'the association’s accreditation number',
  endorsement_number: 'the endorsement reference',
  signed_by: 'the person who signed',
  province: 'the province',
  category: 'the category',
  registration_number: 'the registration number',
  good_standing_number: 'the good-standing reference',
  good_standing: 'whether the member is in good standing',
};

export function hintFor(key: string): string {
  const group = aliasGroupFor(key);
  if (KEY_HINTS[group]) return KEY_HINTS[group];
  const owned = /^existing_firearm_\d+_/.test(key);
  if (owned) {
    const base = key.replace(/^existing_firearm_\d+_/, '');
    const map: Record<string, string> = {
      type: 'the firearm type or class',
      calibre: 'the calibre',
      make: 'the firearm manufacturer',
      model: 'the firearm model',
      serial: 'the firearm’s serial number',
      expiry: 'the licence expiry date',
      licence_no: 'the licence number',
      barrel_serial: 'the barrel serial number',
      frame_serial: 'the frame serial number',
    };
    if (map[base]) return map[base];
  }
  return key.replace(/_/g, ' ');
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? date.toISOString().slice(0, 10)
    : null;
}

/**
 * A printed date → yyyy-mm-dd, or null. Accepts ISO, `dd/mm/yyyy`,
 * `yyyy/mm/dd`, and `7 June 2024`. Ambiguous numeric dates are read
 * day-first, which is South African practice.
 */
export function isoDate(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(year, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? iso(Number(m[3]), month, Number(m[1])) : null;
  }
  m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

export function isProjectionDateKey(key: string): boolean {
  return /(_since|_issued|_expiry|_expires|_date|_joined|_on)$/.test(key);
}

export function normaliseLabel(label: string): string {
  return (label ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ProjectedValue {
  value: string;
  confidence: CaptureFact['confidence'];
  fact: CaptureFact;
  via: 'label' | 'jev' | 'normalized';
}

export interface ProjectionResult {
  values: Record<string, ProjectedValue>;
  /** Keys with no fact; the caller may fall back to the tuned extractor. */
  unmatched: string[];
}
