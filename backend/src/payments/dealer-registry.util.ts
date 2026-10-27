import { Province } from '@prisma/client';

/**
 * Pure helpers for dealer auto-registration — extracting a directory entry
 * from an approved firearm dealer-transfer (the SAP 534 OCR + the seller-
 * typed stocked-at details). Kept side-effect-free so the decision logic is
 * unit-testable without a database.
 */

// Minimal shape the extractor reads off the dealer-verification findings.
// Deliberately loose (all optional) — the vision model may omit any field.
export interface DealerOcrFields {
  extracted_dealer_licence?: string | null;
  extracted_dealer_name?: string | null;
  extracted_dealer_address?: string | null;
  extracted_dealer_city?: string | null;
  extracted_dealer_province?: string | null;
}

export interface ExtractedDealer {
  // null ⇒ no usable licence number was read; the caller must NOT create a
  // directory row (a licence is the unique key + the whole point of the
  // registry). Everything else is best-effort.
  licenceNumber: string | null;
  name: string;
  address: string;
  rawAddress: string | null;
  city: string | null;
  province: Province | null;
  phone: string | null;
}

// Province aliases keyed on an alphabetics-only, upper-cased form. Covers the
// full names, the common two-letter codes, and a couple of colloquialisms.
const PROVINCE_ALIASES: Record<string, Province> = {
  EASTERNCAPE: Province.EASTERN_CAPE,
  EC: Province.EASTERN_CAPE,
  FREESTATE: Province.FREE_STATE,
  FS: Province.FREE_STATE,
  GAUTENG: Province.GAUTENG,
  GP: Province.GAUTENG,
  GT: Province.GAUTENG,
  KWAZULUNATAL: Province.KWAZULU_NATAL,
  KZN: Province.KWAZULU_NATAL,
  NATAL: Province.KWAZULU_NATAL,
  LIMPOPO: Province.LIMPOPO,
  LP: Province.LIMPOPO,
  MPUMALANGA: Province.MPUMALANGA,
  MP: Province.MPUMALANGA,
  NORTHWEST: Province.NORTH_WEST,
  NW: Province.NORTH_WEST,
  NORTHERNCAPE: Province.NORTHERN_CAPE,
  NC: Province.NORTHERN_CAPE,
  WESTERNCAPE: Province.WESTERN_CAPE,
  WC: Province.WESTERN_CAPE,
  WP: Province.WESTERN_CAPE,
};

function clean(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length ? t : null;
}

/**
 * Map a free-text province string (however the model / dealer wrote it) to
 * the Province enum, or null when it can't be resolved confidently. Nulls are
 * fine — the admin fills the province during review.
 */
export function normaliseProvince(raw: string | null | undefined): Province | null {
  const c = clean(raw);
  if (!c) return null;
  const key = c.toUpperCase().replace(/[^A-Z]/g, '');
  if (!key) return null;
  return PROVINCE_ALIASES[key] ?? null;
}

/**
 * Canonical form of a dealer licence number = the directory KEY. Upper-cased
 * with ALL whitespace stripped, so the same physical licence resolves to one
 * row no matter how it was typed / OCR'd (e.g. "gd 1234 5678" and
 * "GD12345678" collide). Returns '' when there is nothing to canonicalise.
 *
 * BOTH write paths (manual admin CRUD + auto-registration) MUST run a licence
 * through this before storing/looking up, or a licence typed with internal
 * spaces would fork into a duplicate directory row.
 */
export function canonicaliseLicence(raw: string | null | undefined): string {
  const c = clean(raw);
  return c ? c.toUpperCase().replace(/\s+/g, '') : '';
}

/**
 * Normalise an OCR'd dealer licence number into the directory key form, or
 * null when it's absent / obviously not a licence. Builds on canonicaliseLicence
 * and additionally rejects too-short or placeholder reads ("N/A", "NONE", "-")
 * so an unreadable SAP 534 never creates a bogus entry keyed on garbage.
 */
export function normaliseLicence(raw: string | null | undefined): string | null {
  const cleaned = canonicaliseLicence(raw);
  if (cleaned.length < 4) return null;
  if (/^(N\/?A|NONE|UNKNOWN|NULL|UNREADABLE|-+)$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Canonical CIPC company-registration number, or null when the string is not
 * one. CIPC prints `YYYY/NNNNNN/NN` (close corporations also prefix `CK`), and
 * a stamp may write it with dashes, spaces or no separators at all.
 *
 * ⚠️ THIS IS THE KEY WE SEND TO THE REGISTRY, so it must be the registered
 * form and nothing else. A number that does not parse is returned as null
 * rather than passed through — Didit would bill a lookup for garbage and the
 * dealer would be told their stamp is wrong when it is our parser that is.
 */
export function normaliseRegistrationNumber(
  raw: string | null | undefined,
): string | null {
  const c = clean(raw);
  if (!c) return null;
  const compact = c
    .toUpperCase()
    .replace(/^CK\s*/, '')
    .replace(/[^0-9]/g, '');
  const m = /^(\d{4})(\d{4,9})(\d{2})$/.exec(compact);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1900 || year > 2099) return null;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

/**
 * The registration number as it appears anywhere in a page of OCR text, in the
 * canonical form, or null. Deliberately anchored on the printed separators so
 * a serial number or a phone number cannot be mistaken for it.
 */
export function findRegistrationNumber(
  text: string | null | undefined,
): string | null {
  if (typeof text !== 'string' || !text) return null;
  const m = /(?:CK\s*)?(\d{4})\s*[/\-.]\s*(\d{4,9})\s*[/\-.]\s*(\d{2})(?!\d)/i.exec(
    text,
  );
  return m ? normaliseRegistrationNumber(`${m[1]}/${m[2]}/${m[3]}`) : null;
}

/** Do two registration-number strings name the same registration? */
export function registrationNumbersMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normaliseRegistrationNumber(a);
  const right = normaliseRegistrationNumber(b);
  if (!left || !right) return false;
  return left === right;
}

/**
 * Build the directory entry from the verification findings + the seller-typed
 * stocked-at details. The seller-typed name/address/phone are preferred for
 * the structured fields (human-typed at upload, always present, more reliable
 * than OCR); the raw OCR address is retained separately for admin reference.
 */
export function extractDealerFromVerification(args: {
  ocr: DealerOcrFields | null | undefined;
  stockedAtName: string | null | undefined;
  stockedAtAddress: string | null | undefined;
  stockedAtPhone: string | null | undefined;
}): ExtractedDealer {
  const ocr = args.ocr ?? {};
  const ocrName = clean(ocr.extracted_dealer_name);
  const ocrAddress = clean(ocr.extracted_dealer_address);
  const ocrCity = clean(ocr.extracted_dealer_city);
  const typedName = clean(args.stockedAtName);
  const typedAddress = clean(args.stockedAtAddress);
  const typedPhone = clean(args.stockedAtPhone);

  const name = (ocrName || typedName || 'Unnamed dealer').slice(0, 120);
  // Structured address prefers the human-typed value; falls back to OCR.
  const address = (typedAddress || ocrAddress || '').slice(0, 300);

  return {
    licenceNumber: normaliseLicence(ocr.extracted_dealer_licence),
    name,
    address,
    rawAddress: ocrAddress ? ocrAddress.slice(0, 300) : null,
    city: ocrCity ? ocrCity.slice(0, 80) : null,
    province: normaliseProvince(ocr.extracted_dealer_province),
    phone: typedPhone ? typedPhone.slice(0, 40) : null,
  };
}
