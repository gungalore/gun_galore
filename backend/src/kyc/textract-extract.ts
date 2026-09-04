import { readIdNumber, saIdChecksumValid } from '../common/sa-id-number';
/**
 * THE DESK / KYC — reading an identity document out of a Textract response.
 *
 * Pure functions over an AnalyzeDocument result. No AWS SDK, no network, no
 * NestJS: everything here is decided by evidence in the response, so it can be
 * tested against the six REAL documents in __fixtures__/textract rather than
 * against invented ones.
 *
 * 🚨 EVERY RULE BELOW EXISTS BECAUSE A REAL DOCUMENT BROKE WITHOUT IT. They
 * were found by running the operator's own SAPS 524s, firearm licence,
 * training results, green book and smart card through Textract in eu-west-1
 * and reading what came back — not from the API docs.
 */

/** The shape we consume. Deliberately narrow — this is not the full SDK type. */
export interface TextractBlock {
  BlockType: string;
  Text?: string;
  Confidence?: number;
  EntityTypes?: string[];
  Relationships?: { Type: string; Ids: string[] }[];
  Id: string;
}

export interface TextractResponse {
  Blocks: TextractBlock[];
}

export type DocumentKind = 'SMART_ID_CARD' | 'GREEN_BOOK' | 'OTHER';

export interface ExtractedIdentity {
  documentType: DocumentKind;
  idNumber: string | null;
  surname: string | null;
  names: string | null;
  /** YYYY-MM-DD, or null. */
  dateOfBirth: string | null;
  /** Mean confidence over the lines Textract returned, 0-100. */
  legibility: number;
  /** What was repaired or refused on the way, for the audit row. */
  notes: string[];
}

/* ── Reading the response ──────────────────────────────────────────────── */

export function lines(res: TextractResponse): string[] {
  return (res.Blocks ?? [])
    .filter((b) => b.BlockType === 'LINE' && typeof b.Text === 'string')
    .map((b) => b.Text as string);
}

/**
 * The FORMS key/value pairs, flattened.
 *
 * ⚠️ KEYS ARE MATCHED LOOSELY, AND THAT IS NOT LAZINESS. On the smart card
 * Textract swallowed the Nationality VALUE into the next KEY, producing
 * `RSA Identity Number:` — so an exact match on "Identity Number" returns
 * nothing at all and the ID silently goes missing. Normalised contains-matching
 * is what survives that.
 */
export function keyValues(res: TextractResponse): { key: string; value: string }[] {
  const byId = new Map((res.Blocks ?? []).map((b) => [b.Id, b]));
  const textOf = (b: TextractBlock): string =>
    (b.Relationships ?? [])
      .filter((r) => r.Type === 'CHILD')
      .flatMap((r) => r.Ids)
      .map((id) => byId.get(id)?.Text ?? '')
      .filter(Boolean)
      .join(' ')
      .trim();

  return (res.Blocks ?? [])
    .filter((b) => b.BlockType === 'KEY_VALUE_SET' && (b.EntityTypes ?? []).includes('KEY'))
    .map((k) => {
      const valueId = (k.Relationships ?? []).find((r) => r.Type === 'VALUE')?.Ids?.[0];
      const v = valueId ? byId.get(valueId) : undefined;
      return { key: textOf(k), value: v ? textOf(v) : '' };
    })
    .filter((p) => p.key);
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** First value whose key contains any of `needles`, normalised. */
export function findValue(
  pairs: { key: string; value: string }[],
  needles: string[],
): string | null {
  for (const n of needles.map(norm)) {
    const hit = pairs.find((p) => norm(p.key).includes(n) && p.value.trim());
    if (hit) return hit.value.trim();
  }
  return null;
}

/* ── The ID number ─────────────────────────────────────────────────────── */

// Moved to common/ when the Document Centre extractor hit the SAME 14-digit
// corruption on the operator's SAPS 524 that this rule was written for.
// Re-exported so this module's public surface is unchanged.
export { saIdChecksumValid, readIdNumber } from '../common/sa-id-number';

/* ── Dates ─────────────────────────────────────────────────────────────── */

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** 'YYYY-MM-DD' from the spellings these documents actually use. */
export function readDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();

  const iso = /(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // The smart card prints "01 APR 1959".
  const long = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/.exec(s);
  if (long) {
    const m = MONTHS[long[2].toLowerCase()];
    if (m) return `${long[3]}-${m}-${long[1].padStart(2, '0')}`;
  }
  return null;
}

/** The birth date an ID number itself asserts, as YYYY-MM-DD. */
export function dobFromIdNumber(id: string, issuedBefore = new Date()): string | null {
  if (!saIdChecksumValid(id)) return null;
  const yy = Number(id.slice(0, 2));
  const mm = id.slice(2, 4);
  const dd = id.slice(4, 6);
  // Two-digit year: pick the century that does not put the birth in the future.
  const thisYear = issuedBefore.getFullYear();
  const candidate2000 = 2000 + yy;
  const year = candidate2000 <= thisYear ? candidate2000 : 1900 + yy;
  return `${year}-${mm}-${dd}`;
}

/* ── Document type ─────────────────────────────────────────────────────── */

/**
 * Which document this is, from words only that document carries.
 *
 * The smart card says "NATIONAL IDENTITY CARD"; the green book has the
 * "NOTICE OF CHANGE OF ADDRESS" panel and prints "I.D. No." above a barcode.
 * Anything else is OTHER — including a competency certificate or a firearm
 * licence, which are real documents but not identity ones.
 */
export function documentKind(res: TextractResponse): DocumentKind {
  const hay = norm(lines(res).join(' '));
  if (hay.includes('nationalidentitycard')) return 'SMART_ID_CARD';
  if (hay.includes('idno') || hay.includes('noticeofchangeofaddress')) return 'GREEN_BOOK';
  return 'OTHER';
}

/* ── The whole read ────────────────────────────────────────────────────── */

/** Every 13-or-14 digit run in the raw text, longest first. */
function idCandidatesFromText(res: TextractResponse): string[] {
  const joined = lines(res).join('\n');
  const out: string[] = [];
  for (const m of joined.matchAll(/\d[\d\s-]{11,20}\d/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length === 13 || d.length === 14) out.push(m[0]);
  }
  return out;
}

/**
 * Read an identity document.
 *
 * 🚨 THE RAW TEXT IS TRIED BEFORE THE FORM FIELDS, and that ordering is the
 * whole lesson of the green book. There, FORMS returned
 * `'I.D. No.' -> '1 970724 0045 089'` while the raw OCR line was a perfect
 * `I.D. No. 970724 0045 089`. The structured extraction was the thing that was
 * wrong; the plain text was right. Preferring FORMS — the obvious choice —
 * would have taken the corrupted value on the one document where the clean one
 * was sitting a few bytes away.
 *
 * FORMS is still consulted, because on the SAPS 524 it is what labels which
 * number is the ID at all. It is a fallback, not the source of truth.
 */
export function extractIdentity(res: TextractResponse): ExtractedIdentity {
  const notes: string[] = [];
  const pairs = keyValues(res);
  const documentType = documentKind(res);

  let idNumber: string | null = null;
  for (const c of idCandidatesFromText(res)) {
    const r = readIdNumber(c);
    if (r.id) {
      idNumber = r.id;
      if (r.note) notes.push(`raw text: ${r.note}`);
      break;
    }
  }
  if (!idNumber) {
    const fromForm = findValue(pairs, ['identity number', 'id no', 'idnumber']);
    if (fromForm) {
      const r = readIdNumber(fromForm);
      idNumber = r.id;
      notes.push(r.id ? `fell back to the form field: ${r.note ?? 'clean'}` : (r.note as string));
    }
  }

  const surname = findValue(pairs, ['surname']);
  const names = findValue(pairs, ['forenames', 'names', 'initials and surname']);

  // The card's own printed date, and the date its ID number implies. They are
  // independent reads of the same fact, which is what makes disagreement
  // meaningful rather than noise.
  const printed = readDate(findValue(pairs, ['date of birth', 'dateofbirth']));
  const implied = idNumber ? dobFromIdNumber(idNumber) : null;
  if (printed && implied && printed !== implied) {
    notes.push(
      `the printed date of birth (${printed}) disagrees with the ID number's own digits (${implied}) — one of the two was misread`,
    );
  }
  const dateOfBirth = printed ?? implied;

  const confident = (res.Blocks ?? []).filter(
    (b) => b.BlockType === 'LINE' && typeof b.Confidence === 'number',
  );
  const legibility = confident.length
    ? Math.round((confident.reduce((s, b) => s + (b.Confidence as number), 0) / confident.length) * 100) / 100
    : 0;

  return { documentType, idNumber, surname, names, dateOfBirth, legibility, notes };
}
