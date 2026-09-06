// backend/src/licence-centre/textract-document-extract.ts
//
// Read a Document Centre credential off a Textract response.
//
// Emits the SAME CredentialReading the Claude extractor emits, so everything
// downstream — the encrypted details blob, the date columns, the motivation
// carry-across that matches on exact key names — is untouched. What changes is
// who reads the paper, not what the paper turns into.
//
// Pure: no SDK, no Nest, no network. Every rule below is exercised against the
// 18 real documents in __fixtures__/textract.
//
// ── WHY BOTH LINES AND FORMS ──────────────────────────────────────────
//
// FORMS is excellent on these documents and it is NOT enough. On a firearm
// licence the make, calibre and three serial numbers come back as clean
// key/value pairs — and the validity dates and the section do not, because
// they are printed as bare lines with no label beside them. Reading only the
// forms block loses the two fields the reminder sweep runs on.
//
// ── THE NUMBER THAT IS NOT A LICENCE NUMBER ───────────────────────────
//
// 🚨 A licence card carries a four-digit code — 3086 or 3088 — sitting right
// where a reference number looks like it should be. It is not one. Across the
// operator's seven licences it takes exactly two values, and they track the
// SECTION: 3086 on the section 15, 3088 on all six section 16s. Reading it as
// `licence_number` would give six different firearms the same licence number
// and put that number on an application.
//
// Nothing on the captured face of these cards is a licence number, so this
// does not produce one. A field we cannot read is left for the member, which
// is the whole point of the confidence gate.

import type { CredentialKind } from '@prisma/client';

import { sectionFromText } from '../common/sa-competency';
import { readIdNumber } from '../common/sa-id-number';

/** Matches the Claude extractor's contract exactly. Do not diverge. */
export interface CredentialReading {
  expiresOn: string | null;
  issuedOn: string | null;
  details: Record<string, string>;
  lowConfidence: string[];
}

export interface TextractReading {
  reading: CredentialReading;
  /** Per canonical field, the lowest word confidence behind it (0-100). */
  confidence: Record<string, number>;
  /**
   * Every key/value pair Textract returned, verbatim.
   *
   * Operator, 2026-09-04: "I want to extract all fields and keep them for
   * future use." The canonical fields above are what the columns and the
   * motivation carry-across read; this is everything else the page carried,
   * kept rather than thrown away. It goes into the encrypted blob alongside.
   */
  raw: Record<string, string>;
  /** What was repaired on the way, for the audit row. */
  notes: string[];
  /** Every material field cleared AUTO_FILL_FLOOR. */
  autoFillable: boolean;
}

/**
 * Operator, 2026-09-04: "we can autofill everything if confidence was above
 * 95%."
 *
 * ⚠️ APPLIED TO MATERIAL FIELDS ONLY, AND THAT DISTINCTION IS THE WHOLE
 * DESIGN. Taking the minimum across every pair on the page auto-fills 3 of
 * the operator's 18 documents, because a certificate carries the printer's
 * imprint at the bottom ("Amold & Wessels Printers", 85%) and a training
 * provider's street address (67%). Neither is a fact about the document, and
 * letting either veto a licence sends everything for review — which reads as
 * the feature being broken. Gated on the fields we actually store, 13 of 18
 * auto-fill and the five held back are genuinely uncertain reads of fields
 * that matter.
 */
export const AUTO_FILL_FLOOR = 95;

/* ── Reading the response ─────────────────────────────────────────────── */

interface Block {
  Id?: string;
  BlockType?: string;
  Text?: string;
  Confidence?: number;
  EntityTypes?: string[];
  Relationships?: { Type?: string; Ids?: string[] }[];
}
export interface TextractResponse {
  Blocks?: Block[];
}

export interface Pair {
  key: string;
  value: string;
  /** Lowest confidence among the VALUE's words. */
  confidence: number;
}

export function lines(res: TextractResponse): string[] {
  return (res.Blocks ?? [])
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .map((b) => b.Text as string);
}

export function pairs(res: TextractResponse): Pair[] {
  const blocks = res.Blocks ?? [];
  const byId = new Map(blocks.map((b) => [b.Id ?? '', b]));
  const words = (b?: Block): Block[] =>
    (b?.Relationships ?? [])
      .filter((r) => r.Type === 'CHILD')
      .flatMap((r) => r.Ids ?? [])
      .map((id) => byId.get(id))
      .filter((w): w is Block => !!w?.Text);

  const out: Pair[] = [];
  for (const b of blocks) {
    if (b.BlockType !== 'KEY_VALUE_SET') continue;
    if (!(b.EntityTypes ?? []).includes('KEY')) continue;
    const valueId = (b.Relationships ?? []).find((r) => r.Type === 'VALUE')
      ?.Ids?.[0];
    if (!valueId) continue;
    const vw = words(byId.get(valueId));
    if (!vw.length) continue;
    out.push({
      key: words(b)
        .map((w) => w.Text)
        .join(' ')
        .trim(),
      value: vw.map((w) => w.Text).join(' ').trim(),
      confidence: Math.min(...vw.map((w) => w.Confidence ?? 0)),
    });
  }
  return out;
}

/* ── The alias table: Textract's words -> our field names ─────────────── */

export interface FieldAlias {
  /** Canonical name. MUST match WANTED and the motivation registry exactly. */
  field: string;
  /** Textract key this means. */
  match: RegExp;
  /** Restrict to these kinds; omitted means any. */
  kinds?: CredentialKind[];
}

/**
 * ⚠️ DATA, LIKE THE MARKERS, AND FOR THE SAME REASON. A form that labels its
 * fields slightly differently is one line here, not a code change.
 *
 * ⚠️ ORDER MATTERS WITHIN A FIELD'S ALIASES ONLY — the first match wins, so
 * put the specific before the general. "Receiver Serial No" must be tested
 * before "Serial Number" or every serial lands in one field.
 */
export const FIELD_ALIASES: FieldAlias[] = [
  // Identity, shared across several kinds.
  { field: 'holder_name', match: /^(initials and surname|learner name|name of (learner|holder))/i },
  { field: 'full_name', match: /^(surname|forenames|names)$/i, kinds: ['IDENTITY_DOCUMENT'] },
  { field: 'id_number', match: /^(identity number|id no|id number|identification)/i },

  // Firearm licence.
  { field: 'make', match: /^make$/i, kinds: ['FIREARM_LICENCE'] },
  { field: 'calibre', match: /^calibre$/i, kinds: ['FIREARM_LICENCE'] },
  { field: 'frame_serial', match: /^frame serial/i, kinds: ['FIREARM_LICENCE'] },
  { field: 'barrel_serial', match: /^barrel serial/i, kinds: ['FIREARM_LICENCE'] },
  { field: 'receiver_serial', match: /^receiver serial/i, kinds: ['FIREARM_LICENCE'] },
  { field: 'serial_number', match: /^serial number/i, kinds: ['FIREARM_LICENCE'] },
  { field: 'model', match: /^model$/i, kinds: ['FIREARM_LICENCE'] },

  // Competency certificate.
  { field: 'competency_number', match: /^competency certificate number/i },
  { field: 'covers', match: /^type of competency certificate/i },

  // Proficiency / statement of results.
  { field: 'certificate_number', match: /^certificate number/i },
  { field: 'unit_standard', match: /^(saqa id|unit standards? title)/i },
  { field: 'issuer', match: /^(training provider name|provider)/i },
];

/* ── Line rules, for what FORMS does not label ────────────────────────── */

/** `2022-11-29 -- 2032-11-28` on a licence: valid from, valid to. */
const VALIDITY_RANGE = /(\d{4}-\d{2}-\d{2})\s*-{1,2}\s*(\d{4}-\d{2}-\d{2})/;
/**
 * The licence section, however the card prints it.
 *
 * 🚨 THIS REQUIRED THE WHOLE WORD "SECTION" AND A PLAIN NUMBER, AND THAT IS
 * FOUR MISSES. `\bSECTION\s+(\d{1,2})\b` never matched "SECTION 16A" (the \b
 * after the digits fails against the A, so the capture died), "S16", "SEC 16"
 * or "16(1)". A missed section is not a missing field — it is a licence that
 * can never be auto-dated, because mayArmReadExpiry cross-checks the read
 * expiry against the section 27 term and refuses outright when there is no
 * section to check against. The failure is silent at every step: the card
 * lists fine, the date sits in the box, and no reminder is ever armed.
 *
 * ⚠️ AND THE CAPTURE IS NOW THE WHOLE TOKEN, not the digits, because
 * sectionFromText is what turns it into 'S16A' — the A is the only decoration
 * that changes anything, and dropping it files a ten-year professional-hunting
 * licence as an ordinary section 16.
 *
 * ⚠️ THE BARE `16(1)` FORM IS LAST AND IS THE RISKY ONE: a two-digit number
 * followed by a bracketed number is a subsection reference and very little
 * else, but it is the only alternative here with no anchoring word. The
 * alternation is ordered so the labelled forms win, and sectionFromText
 * returns null for any number that is not a section it knows — including 20,
 * whose term the number alone does not determine.
 */
const SECTION =
  /\b(SECTION\s*\d{1,2}\s*A?|SEC\.?\s*\d{1,2}\s*A?|S\.?\s?\d{1,2}\s*A?|\d{1,2}\s?\(\d{1,2}\))/i;
/** A 13-digit SA ID, however Textract spaced it. */
const SA_ID = /\b(\d[\d\s]{11,17}\d)\b/;
/**
 * `GJP FOURIE` - initials then surname, printed bare on a licence card with
 * no label beside it, so FORMS never sees it as a value. Per reference
 * S4.8.2 the SAPS forms carry INITIALS ONLY, never full names.
 */
const INITIALS_SURNAME = /(?:^|\| )([A-Z]{1,4} [A-Z][A-Z'-]{2,})(?: \||$)/;
/**
 * The firearm type, also printed bare. Feeds the endorsement parser and,
 * through categoryFromText, the category a competency's expiry is derived
 * from.
 *
 * 🚨 THE LEADING PREFIX IS OPTIONAL, AND IT WAS NOT. Requiring one character
 * before the keyword meant a line reading exactly "HANDGUN" never matched —
 * the [A-Z] ate the H. Three of the operator's seven licences are handguns
 * and all three came back with no type, so categoryFromText returned null,
 * so they were EXCLUDED from the competency derivation (null is excluded,
 * never defaulted). The handgun competency then fell to the five-year
 * assumption, which mayArmDerivedExpiry refuses to arm — leaving it with no
 * date at all. Nothing errored anywhere along that chain.
 */
const FIREARM_TYPE =
  /(?:^|\| )((?:S\/L[:\s-]*)?[A-Z\/\s.:-]*(?:RIFLE|SHOTGUN|HANDGUN|PISTOL|REVOLVER|CARBINE|MUZZLE[\s-]?LOADER)[A-Z\/\s.:-]*)(?: \||$)/;
/**
 * Reference S4.8.2: a competency certificate number is `C` + 7-8 digits.
 * A value that is not that shape was misread, whatever Textract's
 * confidence said about it.
 */
const COMPETENCY_NUMBER = /^C\d{7,8}$/;

/**
 * Fields whose ABSENCE blocks auto-filling, per kind.
 *
 * WARNING: NOT THE SAME AS `material`. A licence card does not print a
 * licence number at all, so requiring one would send every licence for
 * review forever. A competency is USELESS without its issue date - the
 * whole expiry derivation runs on it - so a certificate whose boxed date
 * came back unreadable must reach the member even though nothing was
 * misread.
 *
 * `issuedOn` and `expiresOn` name the columns, not entries in `details`.
 */
export const REQUIRED_FOR_AUTOFILL: Partial<Record<CredentialKind, string[]>> = {
  FIREARM_LICENCE: ['issuedOn', 'expiresOn'],
  COMPETENCY_CERTIFICATE: ['competency_issued'],
};

/**
 * Kinds where a date on the page is never an expiry.
 *
 * ⚠️ THIS WAS TWO SETS — one here, one in the Claude extractor — held in step
 * by a comment saying they must be. Two readers disagreeing about which
 * documents can expire is exactly the divergence a comment cannot prevent, and
 * the cost of the divergence is a reminder about a document that cannot lapse.
 * It is now declared here, next to the reader that has the tighter reason to
 * own it, and imported by the other.
 *
 * A competency prints an issue date and no expiry (§5.2) — its expiry is
 * DERIVED from the licences it covers — and an ID document and a proficiency
 * do not run out at all. A settled expiry arms the reminder sweep, so inventing
 * one here starts SMSing members about a deadline that does not exist.
 */
export const NO_EXPIRY_ON_THE_PAGE: ReadonlySet<string> = new Set([
  'COMPETENCY_CERTIFICATE',
  'PROFICIENCY',
  'IDENTITY_DOCUMENT',
]);

/**
 * The competency's issue date, printed one digit per box.
 *
 * 🚨 RETURNS NULL RATHER THAN REPAIR IT. Textract reads those boxes as
 * separate lines — the operator's certificate comes back as 2,0,1,6,0,2,8:
 * SEVEN digits where a date needs eight, because one was lost. The candidates
 * are all plausible and the certificate's rubber stamp says something else
 * again (20 OCT 2016), so there is no honest way to pick one. It goes to the
 * member, who is holding the paper.
 *
 * Eight digits, though, is a date and is read.
 */
export function boxedDate(ls: string[]): string | null {
  const start = ls.findIndex((l) => /^date of issue/i.test(l.trim()));
  if (start < 0) return null;
  const digits = ls
    .slice(start + 1, start + 12)
    .map((l) => l.trim())
    .filter((l) => /^\d$/.test(l))
    .join('');
  if (digits.length !== 8) return null;
  const [y, m, d] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
  const iso = `${y}-${m}-${d}`;
  return Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31
    ? iso
    : null;
}

/* ── The extractor ───────────────────────────────────────────────────── */

export function extractDocument(
  res: TextractResponse,
  kind: CredentialKind,
  /**
   * The kind's material fields — the ones that become columns or stored
   * details. Passed in rather than imported so this stays pure; the caller
   * hands it WANTED[kind].
   */
  material: readonly string[],
): TextractReading {
  const ls = lines(res);
  const ps = pairs(res);

  const details: Record<string, string> = {};
  const confidence: Record<string, number> = {};
  const raw: Record<string, string> = {};
  const notes: string[] = [];

  const put = (field: string, value: string, conf: number) => {
    if (!value || details[field] !== undefined) return;
    details[field] = value;
    confidence[field] = conf;
  };

  for (const p of ps) {
    // Everything is kept, under its own printed label.
    if (p.key) raw[p.key] = p.value;
    const alias = FIELD_ALIASES.find(
      (a) =>
        a.match.test(p.key) && (!a.kinds || a.kinds.includes(kind)),
    );
    if (alias) put(alias.field, p.value, p.confidence);
  }

  // ── Lines, for what carries no label ────────────────────────────────
  const text = ls.join(' | ');

  // ⚠️ NORMALISED HERE, NOT LEFT AS THE DIGITS. This stored a bare "15", which
  // every reader then had to re-parse — and the stored value is also what the
  // member sees on the card and what travels onto a motivation. sectionFromText
  // is the one place that knows 'S16' from 'S16A' and that section 20 does not
  // determine its own term; anything it declines is left absent, which is the
  // honest answer for a number that is not a licensing section at all.
  const section = text.match(SECTION);
  if (section && kind === 'FIREARM_LICENCE') {
    const parsed = sectionFromText(section[1]);
    if (parsed) put('section', parsed, 99);
  }

  // WARNING: AN ID NUMBER IS THIRTEEN DIGITS, HOWEVER IT WAS PRINTED. A
  // competency card spaces it (`890512 5220 089`, reference S4.8.2 calls
  // them 13 boxed digits) and a licence does not. Storing both forms means
  // the same person's own documents never match each other.
  // Uses the SHARED reader, which repairs the 14-digit corruption this very
  // document family produces: a SAPS 524 prints the ID in boxes, and the
  // left border of the first box reads as a leading digit. The repair only
  // stands if the shortened number passes the checksum, so it is arithmetic
  // rather than a guess - and confidence cannot catch it, because a wrong
  // read scores within a tenth of a point of a right one.
  const idCandidate = details.id_number ?? text.match(SA_ID)?.[1] ?? '';
  const read = readIdNumber(idCandidate);
  if (read.id) {
    details.id_number = read.id;
    if (confidence.id_number === undefined) confidence.id_number = 99;
    if (read.note) notes.push(read.note);
  } else if (details.id_number) {
    // Something was printed there and it is not a valid ID number. That is a
    // misread, not a low-confidence read, so it must not auto-fill.
    confidence.id_number = 0;
  }

  // A misread number is not a low-confidence number, it is a wrong one.
  if (details.competency_number && !COMPETENCY_NUMBER.test(details.competency_number)) {
    confidence.competency_number = 0;
  }

  // ⚠️ STRIP THE BOILERPLATE OFF THE ENDORSEMENT. Reference S4.8.2: the
  // "Type of competency certificate" block is two lines, and line 1 is
  // ALWAYS "COMPETENCY TO POSSESS A FIREARM" - the category, identical on
  // every certificate. Line 2 is the endorsement, which is the part that
  // means anything.
  //
  // parseEndorsements copes with the prefix either way, but this value is
  // also carried onto a motivation as `competency_for` and PRINTED on the
  // form. Printing the boilerplate there puts eleven words of nothing where
  // an assessor is looking for the endorsement.
  if (details.covers) {
    const stripped = details.covers
      .replace(/^COMPETENCY\s+TO\s+POSSESS\s+A\s+FIREARM\s*/i, '')
      .trim();
    if (stripped) details.covers = stripped;
  }

  if (kind === 'FIREARM_LICENCE') {
    const holder = text.match(INITIALS_SURNAME);
    if (holder) put('holder_name', holder[1].trim(), 99);
    const type = text.match(FIREARM_TYPE);
    if (type) put('firearm_type', type[1].trim(), 99);
  }

  // An ID document prints the surname and the forenames as two fields; the
  // member's name is both of them, not whichever one matched first.
  if (kind === 'IDENTITY_DOCUMENT') {
    const surname = ps.find((q) => /^surname$/i.test(q.key))?.value;
    const fore = ps.find((q) => /^(forenames|names)$/i.test(q.key))?.value;
    if (surname && fore) details.full_name = (fore + ' ' + surname).trim();
  }

  let issuedOn: string | null = null;
  let expiresOn: string | null = null;

  const range = text.match(VALIDITY_RANGE);
  if (range) {
    issuedOn = range[1];
    if (!NO_EXPIRY_ON_THE_PAGE.has(kind)) expiresOn = range[2];
  }
  if (!issuedOn && kind === 'COMPETENCY_CERTIFICATE') {
    issuedOn = boxedDate(ls);
    if (issuedOn) confidence.competency_issued = 99;
  }
  if (issuedOn && kind === 'COMPETENCY_CERTIFICATE') {
    details.competency_issued = issuedOn;
  }

  // ── The gate ────────────────────────────────────────────────────────
  //
  // Only fields this kind actually stores get a vote. A field we did not
  // read at all is not low confidence — it is absent, and absence is the
  // member's to fill.
  const lowConfidence = Object.keys(details)
    .filter((f) => material.includes(f))
    .filter((f) => (confidence[f] ?? 100) < AUTO_FILL_FLOOR);

  const present = (f: string) =>
    f === 'issuedOn' ? !!issuedOn : f === 'expiresOn' ? !!expiresOn : !!details[f];
  const missing = (REQUIRED_FOR_AUTOFILL[kind] ?? []).filter((f) => !present(f));

  return {
    reading: { expiresOn, issuedOn, details, lowConfidence },
    notes,
    confidence,
    raw,
    autoFillable: lowConfidence.length === 0 && missing.length === 0,
  };
}
