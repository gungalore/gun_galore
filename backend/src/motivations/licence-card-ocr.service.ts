import { Injectable, Logger } from '@nestjs/common';
import type { FirearmSnapshot } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// READING A SAPS FIREARM LICENCE CARD.
//
// Operator, 2026-08-23: "we will be using google cloud vison instead" — and,
// on what to do with what it reads: "You insert exactly what is on the license
// card, as that is what is registered with the SAPS system. if it says NONE,
// you put NONE."
//
// ⚠️ THIS PROPOSES. IT NEVER SUBMITS. Every value here lands in a form the
// seller confirms before signing. The rule is the one the motivation extractor
// already states: "a misread digit in an ID number would otherwise become a
// false statement on a form they sign" — and this form is a consent to
// transfer a firearm, so the same reasoning applies with more force.
//
// ⚠️ AND IT NEVER INVENTS "NONE". A field the OCR could not make out comes
// back UNDEFINED, not NONE. Those two mean opposite things to a DFO: NONE is a
// fact the card asserts, undefined is our failure to read. Conflating them
// would put a false statement on a signed document. Nothing below ever
// defaults a missing value to the string NONE.
//
// ⚠️ WHY GEOMETRY AND NOT LINE ORDER. The card is TWO COLUMNS:
//
//     Serial Number   ZA2226548        Type    S/L: RIFLE CAL - RIFLE/CARBINE
//     Make            NORDISKE PREC.   Model   NONE
//     Calibre         .223 REM
//
// Read as a stream of lines, "Make" is as likely to pick up "Model"'s value as
// its own, and on a five-card sample the serial rows interleave differently
// every time. So we anchor on the LABEL's bounding box and take the words to
// its right within the same horizontal band, stopping at the next label. That
// is the only way the Marlin card — whose barrel row reads NONE while the
// receiver carries the number — parses correctly.
// ────────────────────────────────────────────────────────────────────

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

/** One word, with where it sits on the card. */
export interface Word {
  text: string;
  x0: number;
  x1: number;
  /** Vertical centre — what the band grouping keys on. */
  yMid: number;
  height: number;
}

/**
 * The labels printed on the card, longest first.
 *
 * ⚠️ ORDER MATTERS. "Serial Number" must be tried before "Number", and
 * "Barrel Serial No" before "Serial No", or a prefix match swallows the row.
 */
const LABELS: { label: string; key: keyof FirearmSnapshot }[] = [
  { label: 'BARREL SERIAL NO', key: 'barrelSerial' },
  { label: 'RECEIVER SERIAL NO', key: 'receiverSerial' },
  { label: 'FRAME SERIAL NO', key: 'frameSerial' },
  { label: 'SERIAL NUMBER', key: 'serial' },
  { label: 'CALIBRE', key: 'calibre' },
  { label: 'MODEL', key: 'model' },
  { label: 'TYPE', key: 'type' },
  { label: 'MAKE', key: 'make' },
];

/** What one read produced, and what it could not. */
export interface LicenceCardReading {
  /** Only keys the OCR actually established. Never contains a guessed NONE. */
  fields: Partial<FirearmSnapshot>;
  /** The holder's 13-digit ID, if the card showed one. */
  holderIdNumber?: string;
  /** "GJP FOURIE" — initials and surname, which is all the card carries. */
  holderNameOnCard?: string;
  /** Raw text, kept so a human can see what we were working from. */
  rawText: string;
  /** False when the call failed or the key is unset — never throws. */
  ok: boolean;
}

const EMPTY: LicenceCardReading = { fields: {}, rawText: '', ok: false };

@Injectable()
export class LicenceCardOcrService {
  private readonly logger = new Logger(LicenceCardOcrService.name);
  private readonly apiKey = process.env.GOOGLE_VISION_API_KEY ?? '';

  /**
   * Read one photograph of a licence card.
   *
   * ⚠️ FAIL-SOFT, ALWAYS. No key, a 403 from the IP allowlist, a timeout, an
   * unparseable body — all return `ok: false` with no fields. The seller then
   * types what the card says, which is what they would have done anyway. A
   * consent flow that only works when Google answers is a consent flow that
   * strands somebody in bad light with a form they cannot finish.
   */
  async read(bytes: Buffer, mimeType: string): Promise<LicenceCardReading> {
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_VISION_API_KEY unset — licence OCR skipped');
      return EMPTY;
    }
    if (!bytes?.length) return EMPTY;
    void mimeType; // Vision sniffs the content itself.

    let body: unknown;
    try {
      const res = await fetch(`${VISION_URL}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: bytes.toString('base64') },
              // DOCUMENT_TEXT_DETECTION over TEXT_DETECTION: it is tuned for
              // dense printed text and returns the same word boxes, which is
              // what the column parse needs.
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['en'] },
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        this.logger.warn(`Vision returned HTTP ${res.status}`);
        return EMPTY;
      }
      body = await res.json();
    } catch (err) {
      this.logger.warn(`Vision call failed: ${(err as Error).message}`);
      return EMPTY;
    }

    const first = (body as { responses?: unknown[] })?.responses?.[0] as
      | {
          error?: { message?: string };
          textAnnotations?: {
            description?: string;
            boundingPoly?: { vertices?: { x?: number; y?: number }[] };
          }[];
        }
      | undefined;

    if (first?.error) {
      this.logger.warn(`Vision error: ${first.error.message ?? 'unknown'}`);
      return EMPTY;
    }
    const annotations = first?.textAnnotations ?? [];
    if (annotations.length < 2) return { ...EMPTY, ok: true };

    // [0] is the whole block; [1..] are the individual words.
    const rawText = annotations[0]?.description ?? '';
    const words: Word[] = [];
    for (const a of annotations.slice(1)) {
      const v = a.boundingPoly?.vertices ?? [];
      if (v.length < 4) continue;
      const xs = v.map((p) => p.x ?? 0);
      const ys = v.map((p) => p.y ?? 0);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      words.push({
        text: (a.description ?? '').trim(),
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        yMid: (y0 + y1) / 2,
        height: Math.max(1, y1 - y0),
      });
    }
    if (!words.length) return { ...EMPTY, rawText, ok: true };

    return {
      fields: parseCard(words),
      holderIdNumber: findIdNumber(words),
      holderNameOnCard: findHolderName(words, rawText),
      rawText,
      ok: true,
    };
  }
}

/** Words sharing a horizontal band, left to right. */
function bandsOf(words: Word[]): Word[][] {
  const medianHeight =
    [...words].map((w) => w.height).sort((a, b) => a - b)[
      Math.floor(words.length / 2)
    ] || 10;
  const tolerance = medianHeight * 0.6;
  const sorted = [...words].sort((a, b) => a.yMid - b.yMid);
  const bands: Word[][] = [];
  for (const w of sorted) {
    const band = bands[bands.length - 1];
    if (band && Math.abs(band[0].yMid - w.yMid) <= tolerance) band.push(w);
    else bands.push([w]);
  }
  return bands.map((b) => b.sort((a, z) => a.x0 - z.x0));
}

/**
 * Pull the labelled values out of one card.
 *
 * ⚠️ A LABEL CLAIMS THE WORDS TO ITS RIGHT UNTIL THE NEXT LABEL STARTS. That
 * is what keeps the two columns apart: on the row `Make HOWA  Model NONE`, the
 * value of Make stops where Model begins, instead of swallowing "Model NONE".
 */
export function parseCard(words: Word[]): Partial<FirearmSnapshot> {
  const out: Partial<FirearmSnapshot> = {};

  for (const band of bandsOf(words)) {
    // Where does each label start and end within this band?
    const hits: { key: keyof FirearmSnapshot; from: number; to: number }[] = [];
    const upper = band.map((w) => w.text.toUpperCase().replace(/[.:]/g, ''));

    for (let i = 0; i < band.length; i++) {
      for (const { label, key } of LABELS) {
        const parts = label.split(' ');
        if (upper.slice(i, i + parts.length).join(' ') !== label) continue;
        if (hits.some((h) => i < h.to && i + parts.length > h.from)) continue;
        hits.push({ key, from: i, to: i + parts.length });
        break;
      }
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.from - b.from);

    for (let h = 0; h < hits.length; h++) {
      const stop = hits[h + 1]?.from ?? band.length;
      const value = band
        .slice(hits[h].to, stop)
        .map((w) => w.text)
        .join(' ')
        .trim();
      // ⚠️ EMPTY STAYS EMPTY. Never substitute NONE for a value we did not
      // read — see the file header.
      if (value && out[hits[h].key] === undefined) {
        (out as Record<string, string>)[hits[h].key] = value;
      }
    }
  }

  // SECTION 15 / SECTION 16 sits on its own line with no label before it.
  const section = /\bSECTION\s+(\d{1,2})\b/i.exec(
    words.map((w) => w.text).join(' '),
  );
  if (section) out.section = `SECTION ${section[1]}`;

  return out;
}

/** The holder's 13-digit identity number, printed bare above the name. */
function findIdNumber(words: Word[]): string | undefined {
  for (const w of words) {
    const digits = w.text.replace(/\D/g, '');
    if (digits.length === 13) return digits;
  }
  // Sometimes split across boxes; fall back to a scan of the joined text.
  const joined = words.map((w) => w.text).join('');
  const m = /\d{13}/.exec(joined);
  return m ? m[0] : undefined;
}

/**
 * "GJP FOURIE" — initials and surname, which is all the card carries.
 *
 * ⚠️ NOT ENOUGH TO SIGN WITH, and that is why the seller types their full
 * names. This is returned only so the form can show it back to them and catch
 * the case where somebody is filling in a consent for the wrong person's card.
 */
function findHolderName(words: Word[], rawText: string): string | undefined {
  const m = /^\s*([A-Z]{1,4})\s+([A-Z][A-Z'\- ]{1,30})\s*$/m.exec(rawText);
  if (m) return `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
  void words;
  return undefined;
}
