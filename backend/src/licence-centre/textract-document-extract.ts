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

import { parseUnitStandards, sectionFromText, selfLoadingFromText } from '../common/sa-competency';
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
  /** Where on the page, as fractions of it. Present on a live response; the test fixtures were stored without it. */
  Geometry?: { BoundingBox?: { Top?: number; Left?: number; Width?: number; Height?: number } };
}
export interface TextractResponse {
  Blocks?: Block[];
}

export interface Pair {
  key: string;
  value: string;
  /** Lowest confidence among the VALUE's words. */
  confidence: number;
  /** The key's top edge, 0 at the top of the page, when Textract said. */
  top?: number;
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
      top: b.Geometry?.BoundingBox?.Top,
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
  { field: 'id_number', match: /^(identity number|national id number|id no|id number|identification)/i },

  // Firearm licence.
  // ⚠️ "Make" AND "Model" ARE PRINTED FOUR TIMES ON THE CARD — once in the
  // top box for the firearm, and once each for the barrel, receiver and frame
  // in the bottom box, where a part with no serial of its own reads "Make
  // NONE". See PRINTED_PER_PART: the first pair Textract hands over is not
  // reliably the top box, and three of the operator's five rifles came back
  // titled "NONE 45-70 GOVERNMENT".
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

  // Proficiency: the PFTC statement of results (the back) and the training
  // provider's own certificate (the front). Operator, 2026-09-07: "we need the
  // front and back of the proficiency certificate."
  //
  // ⚠️ THE S/C/V NUMBER IS WHAT JOINS THE TWO SIDES. One Shot prints
  // "S/C/V Numbers: 52BS-A8041" on its certificate and the PFTC statement
  // behind it prints "SCV Number: 52BS-A8041". Nothing else on the two pages
  // is guaranteed to agree - the provider's certificate number is its own.
  { field: 'holder_name', match: /^awarded to/i, kinds: ['PROFICIENCY'] },
  { field: 'certificate_number', match: /^certificate\s*(number|no\b|nr\b)/i },
  // Progun prints "CERTIFICATE" and "NUMBER:" on two lines; FORMS pairs the first with the value.
  { field: 'certificate_number', match: /^certificate$/i, kinds: ['PROFICIENCY'] },
  { field: 'scv_number', match: /^s\/?c\/?v\s+numbers?/i },
  { field: 'authentication_code', match: /^authentication code/i, kinds: ['PROFICIENCY'] },
  { field: 'unit_standard', match: /^(saqa id|unit standards? title)/i },
  { field: 'issuer', match: /^(training provider name|provider)/i },
];

/* ── Dates as a training provider prints them ───────────────────────── */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function isoDay(y: string, m: string | number, d: string): string | null {
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * "2025/03/28", "14/04/2025", "31 day of MARCH 2021", "23 January 2014" -
 * every way the operator's four fronts and four statements print a date.
 * Day-first when the year is last: this is South Africa.
 */
export function parseLooseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s*\|\s*/g, ' ').trim();
  let m = t.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (m) return isoDay(m[1], m[2], m[3]);
  m = t.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return isoDay(m[3], m[2], m[1]);
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toUpperCase().slice(0, 3)) + 1;
    if (mo) return isoDay(m[3], mo, m[1]);
  }
  return null;
}

/** Two to five capitalised words and nothing else: a printed name, not an address or a heading. */
const NAME_LINE = /^[A-Z][A-Za-z'-]{1,}(?: [A-Z][A-Za-z'-]{1,}){1,4}$/;
const NOT_A_NAME = /^(NAME|ID NUMBER|COMPETENCY COURSE|TRAINING COURSE|CERTIFICATE|RANGE MASTER|ASSESSOR)$/i;

/**
 * Fields a licence card prints once per part as well as once for the firearm.
 * When Textract returns several pairs for one of these, the firearm's own is
 * wanted: the one in the top box. That is the topmost pair where the response
 * carries geometry; failing geometry, the first pair whose value is not the
 * "NONE" a part without its own serial is printed with. A card where every
 * instance reads NONE keeps NONE, which is then the truth.
 */
const PRINTED_PER_PART: ReadonlySet<string> = new Set(['make', 'model']);
const PART_PLACEHOLDER = /^(none|n\/a|nil)$/i;

export function pickPerPart(cands: Pair[]): Pair | undefined {
  if (cands.length <= 1) return cands[0];
  const named = cands.filter((c) => !PART_PLACEHOLDER.test(c.value.trim()));
  const pool = named.length ? named : cands;
  const placed = pool.filter((c) => typeof c.top === 'number');
  if (placed.length === pool.length) return pool.reduce((a, b) => ((b.top as number) < (a.top as number) ? b : a));
  return pool[0];
}

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
/**
 * A 13-digit SA ID, however Textract spaced it.
 *
 * ⚠️ GLOBAL, AND EVERY MATCH IS TRIED. The first 13-to-19-character run of
 * digits on a page is not always the ID: NSN's certificate prints its SASSETA
 * registration "0419 0400 2286" above the holder's number, that matched
 * first, failed the checksum, and the certificate was filed with no ID at
 * all - which is why it could not be paired with its statement of results
 * (operator, 2026-09-07). The checksum decides, not the position.
 */
const SA_ID = /\b(\d[\d\s]{11,17}\d)\b/g;
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
//
// ⚠️ AND "Type" MAY SHARE THE LINE. The .223's card came back as one line,
// "Type S/L: RIFLE CAL - RIFLE/CARBINE", where the fixture card has "Type"
// on its own line. Anchored to the start of a segment, the rule skipped the
// whole line, the type was never stored, and the action stayed unknown -
// which let a self-loading rifle stand in for a manual-rifle competency
// (operator, 2026-09-07, with the card in hand). The label is optional now.
const FIREARM_TYPE =
  /(?:^|\| )(?:[Tt][Yy][Pp][Ee]\s*:?\s*)?((?:(?:N\s*\/\s*)?S\s*\/\s*L[:\s-]*|M\s*\/\s*O[:\s-]*)?[A-Z\/\s.:-]*(?:RIFLE|SHOTGUN|HANDGUN|PISTOL|REVOLVER|CARBINE|MUZZLE[\s-]?LOADER)[A-Z\/\s.:-]*)(?: \||$)/;
/**
 * The action, as the type row abbreviates it: S/L (self-loading), N/S/L
 * (non-self-loading), M/O (manually operated) - and "SIL", which is what OCR
 * makes of "S/L" on a worn card. Read off the type row's own segment or the
 * one after a bare "Type" label, so a serial number elsewhere cannot supply it.
 */
const ACTION_PREFIX = /\b(N\s*\/\s*S\s*\/\s*L|S\s*\/\s*L|S[I1l]L|M\s*\/\s*O)\b\s*:?/i;
/** A FORMS key that is the action itself: "S/L:" => "RIFLE CAL - RIFLE/CARBINE". */
const ACTION_KEY = /^(N\s*\/\s*S\s*\/\s*L|S\s*\/\s*L|S[I1l]L|M\s*\/\s*O)\s*:?$/i;
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

  // Pairs printed once per part are gathered and chosen from; everything
  // else keeps its first value, as before.
  const perPart = new Map<string, Pair[]>();
  for (const p of ps) {
    // Everything is kept, under its own printed label.
    if (p.key) raw[p.key] = p.value;
    // The type row, when FORMS took the action abbreviation as the key.
    if (kind === 'FIREARM_LICENCE' && ACTION_KEY.test(p.key)) {
      put('firearm_type', `${p.key.replace(/\s*:$/, '').replace(/S[I1l]L/i, 'S/L')}: ${p.value}`, p.confidence);
      continue;
    }
    if (kind === 'FIREARM_LICENCE' && /^type$/i.test(p.key) && p.value) {
      put('firearm_type', p.value, p.confidence);
      continue;
    }
    const alias = FIELD_ALIASES.find(
      (a) =>
        a.match.test(p.key) && (!a.kinds || a.kinds.includes(kind)),
    );
    if (!alias) continue;
    if (kind === 'FIREARM_LICENCE' && PRINTED_PER_PART.has(alias.field)) {
      const list = perPart.get(alias.field) ?? [];
      list.push(p);
      perPart.set(alias.field, list);
      continue;
    }
    put(alias.field, p.value, p.confidence);
  }
  for (const [field, cands] of perPart) {
    const chosen = pickPerPart(cands);
    if (chosen) put(field, chosen.value, chosen.confidence);
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
  const idCandidates = details.id_number
    ? [details.id_number]
    : [...text.matchAll(SA_ID)].map((m) => m[1]);
  const read =
    idCandidates.map((c) => readIdNumber(c)).find((r) => r.id) ??
    readIdNumber(idCandidates[0] ?? '');
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
    // The action the card states, if the stored type lost it: from the type
    // row's own segment, or the segment after a bare "Type".
    if (details.firearm_type && selfLoadingFromText(details.firearm_type) === null) {
      const at = ls.findIndex((l) => /^type\b/i.test(l.trim()));
      const seg = at >= 0 ? (/^type\s*:?$/i.test(ls[at].trim()) ? ls[at + 1] : ls[at]) : undefined;
      const tok = seg?.match(ACTION_PREFIX);
      if (tok) {
        details.firearm_type = `${tok[1].replace(/\s+/g, '').replace(/S[I1l]L/i, 'S/L')}: ${details.firearm_type}`;
        notes.push('took the action off the type row');
      }
    }
  }

  // An ID document prints the surname and the forenames as two fields; the
  // member's name is both of them, not whichever one matched first.
  if (kind === 'IDENTITY_DOCUMENT') {
    const surname = ps.find((q) => /^surname$/i.test(q.key))?.value;
    const fore = ps.find((q) => /^(forenames|names)$/i.test(q.key))?.value;
    if (surname && fore) details.full_name = (fore + ' ' + surname).trim();
  }

  // ── The proficiency, either side ────────────────────────────────────
  if (kind === 'PROFICIENCY') {
    // Every registered unit-standard code on the page, however it is laid
    // out: a table on the statement, "119652 - Handle and Use a Shotgun" on
    // One Shot's certificate, "SAQA 119651" on Progun's, two bare numbers on
    // NSN's. The table pair above gives one row; the page gives them all.
    const codes = parseUnitStandards(text);
    if (codes.length > parseUnitStandards(details.unit_standard ?? '').length) {
      details.unit_standard = codes.join(', ');
      confidence.unit_standard = 99;
    }
    // "This is to certify that | <address line> | GERHARD JOHAN PETRUS FOURIE":
    // the first thing after the phrase that reads as a name.
    const at = ls.findIndex((l) => /certify that/i.test(l));
    if (at >= 0) {
      const name = ls.slice(at + 1, at + 5).map((l) => l.trim()).find((l) => NAME_LINE.test(l) && !NOT_A_NAME.test(l));
      if (name) put('holder_name', name, 99);
    }
    // "TRG 11897 | CERTIFICATE NO": NSN prints the date and the number on one
    // baseline and their labels on the next, so the number sits one or two
    // segments before its label. Tried FIRST, because there the label is
    // followed by the next field's label ("CERTIFICATE NO | RANGE MASTER"),
    // which the rule below would otherwise take for the number.
    const before = text.match(/\| ([A-Z]{2,4} ?\d{4,7}) \|(?: [^|]{1,24} \|)? certificate (?:no|nr|number)\b/i);
    if (before) put('certificate_number', before[1], 99);
    // "CERTIFICATE | NUMBER: | K/10358-K919835". A number has a digit in it;
    // a bare word after the label is another label.
    const after = text.match(/\bcertificate(?: \|)? (?:number|no|nr)\b\.?:?(?: \|)? ((?=[A-Z0-9\/-]*\d)[A-Z0-9][A-Z0-9\/-]{3,})/i);
    if (after) put('certificate_number', after[1], 99);
    // Which side of the document this is. The statement names itself; a
    // provider's certificate is anything else that classified as a proficiency.
    details.document_side = /statement\s+of\s+results/i.test(text) ? 'back' : 'front';
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
  // A proficiency's issue date: the statement's "Date of issue" column, One
  // Shot's "Date of issue: 2025/03/28", NSN's "23/01/2014" over the word
  // DATE, Progun's "this 31 day of MARCH 2021" split across two lines.
  if (!issuedOn && kind === 'PROFICIENCY') {
    const pair =
      ps.find((q) => /^date of issue/i.test(q.key)) ??
      ps.find((q) => /^date issued/i.test(q.key)) ??
      // The 2014 statement dates each unit standard under "US Completed On".
      ps.find((q) => /^us completed on/i.test(q.key)) ??
      ps.find((q) => /^date$/i.test(q.key));
    issuedOn =
      parseLooseDate(pair?.value) ??
      parseLooseDate(text.match(/(\d{1,2}\s+day\s+of\s+[A-Za-z]{3,9}(?: \|)? \d{4})/i)?.[1]) ??
      parseLooseDate(text.match(/(\d{2}\/\d{2}\/\d{4}) \|(?: [^|]{1,24} \|)? DATE\b/i)?.[1]) ??
      parseLooseDate(text.match(/US Completed On(?: \|)?(?: [^|]{1,80} \|)* (\d{4}\/\d{2}\/\d{2})/i)?.[1]) ??
      parseLooseDate(text.match(/date of issue:?(?: \|)? (\d{4}\/\d{2}\/\d{2}|\d{2}\/\d{2}\/\d{4})/i)?.[1]);
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
