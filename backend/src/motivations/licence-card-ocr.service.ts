import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import type { LlmPart } from '../common/llm/llm.types';
import type { FirearmSnapshot } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// READING A SAPS FIREARM LICENCE CARD.
//
// Operator, 2026-08-23: "we will be using google cloud vison instead" — and,
// on what to do with what it reads: "You insert exactly what is on the license
// card, as that is what is registered with the SAPS system. if it says NONE,
// you put NONE."
//
// ⚠️ GEMINI NOW READS IT, NOT CLOUD VISION (2026-09-14). The Vision path
// anchored on word bounding boxes and took the words to the right of a label;
// it worked, but it needed a second Google API, a second key, and an IP
// allowlist that a developer's machine is not on. The platform's model calls
// already go through LlmService (see common/llm/llm.service.ts), so the card
// is now read the same way every other document on the platform is. Same
// contract out: a `LicenceCardReading`, never a throw.
//
// ⚠️ THIS PROPOSES. IT NEVER SUBMITS. Every value here lands in a form the
// seller confirms before signing. The rule is the one the motivation extractor
// already states: "a misread digit in an ID number would otherwise become a
// false statement on a form they sign" — and this form is a consent to
// transfer a firearm, so the same reasoning applies with more force.
//
// ⚠️ AND IT NEVER INVENTS "NONE". A field the read could not make out comes
// back UNDEFINED, not NONE. Those two mean opposite things to a DFO: NONE is a
// fact the card asserts, undefined is our failure to read. Conflating them
// would put a false statement on a signed document. Nothing below ever
// defaults a missing value to the string NONE.
//
// ⚠️ THE CARD IS COMPLETE BY CONSTRUCTION, AND THAT IS A RULE, NOT AN
// OBSERVATION. Operator, 2026-09-08, holding one: "all the information is on a
// license card. All of them will always have it. It will either be a serial
// next to every component or NONE, but it will never be empty." So the read is
// asked for all three component rows, each with its serial-or-NONE AND its
// make, and a blank we come back with is a read we got wrong rather than a
// fact the card did not carry.
// ────────────────────────────────────────────────────────────────────

/** What one read produced, and what it could not. */
export interface LicenceCardReading {
  /** Only keys the read actually established. Never contains a guessed NONE. */
  fields: Partial<FirearmSnapshot>;
  /** The holder's 13-digit ID, if the card showed one. */
  holderIdNumber?: string;
  /** "GJP FOURIE" — initials and surname, which is all the card carries. */
  holderNameOnCard?: string;
  /** The model's raw reply, kept so a human can see what we were working from. */
  rawText: string;
  /** False when the call failed or no key is set — never throws. */
  ok: boolean;
}

const EMPTY: LicenceCardReading = { fields: {}, rawText: '', ok: false };

/**
 * The card fields we ask for, and the only keys `read` returns.
 *
 * ⚠️ THE THREE COMPONENT MAKES ARE SEPARATE KEYS, because the card prints a
 * Make against each of the barrel, receiver and frame rows and they genuinely
 * differ (one real card reads barrel CZ, receiver NONE, frame NONE). A single
 * `make` would put the firearm's make on rows that do not carry it.
 */
const CARD_FIELDS = [
  'make',
  'model',
  'type',
  'calibre',
  'serial',
  'barrelSerial',
  'barrelMake',
  'receiverSerial',
  'receiverMake',
  'frameSerial',
  'frameMake',
  'section',
] as const;

type CardField = (typeof CARD_FIELDS)[number];

const SYSTEM = `You read a photograph of a South African SAPS firearm licence card.
You are transcribing, not interpreting: the card is the record of what SAPS has
registered, so you copy what it prints, character for character.

The card carries:
- a headline "Serial Number" row, with the firearm's Type, Make, Model and
  Calibre beside it;
- three component rows — "Barrel Serial No", "Receiver Serial No" and
  "Frame Serial No" — each with its OWN serial (or the literal word NONE) AND
  its own "Make", which is often, but not always, the same as the firearm's;
- the holder's 13-digit identity number and their name, printed as initials and
  surname (for example "GJP FOURIE");
- the section the licence was issued under, printed like "SECTION 16".

Two rules decide the answer:
1. COPY EXACTLY. If the card says NONE, return NONE — it is a fact the card
   asserts, not an absence.
2. NEVER INVENT. A value you cannot read clearly is an empty string, never a
   guess and never NONE. NONE and "could not read" mean opposite things to the
   officer who checks this.`;

const USER = `Read this licence card and return every field you can see.
- holder_id_number: the 13-digit identity number, digits only.
- holder_name: exactly as printed, initials then surname (e.g. "GJP FOURIE").
- section: the section line, e.g. "SECTION 16".
- serial, make, model, type, calibre: from the firearm's own rows.
- barrelSerial, barrelMake, receiverSerial, receiverMake, frameSerial,
  frameMake: from the three component rows, each with its own serial-or-NONE
  and its own make.
Return an empty string for any field that is not visible or not legible. Do not
guess.`;

/**
 * Every key is required and an unread value is the empty string.
 *
 * ⚠️ REQUIRED-ALL, NOT OPTIONAL. An optional property lets the model omit a
 * field silently, which is indistinguishable from a field it could not read;
 * making every key required forces it to consider each row and to say "" when
 * there is nothing to say. `read` then drops the empty strings, so the
 * undefined-vs-NONE rule survives the schema.
 */
const CARD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ...Object.fromEntries(CARD_FIELDS.map((k) => [k, { type: 'string' }])),
    holder_id_number: { type: 'string' },
    holder_name: { type: 'string' },
  },
  required: [...CARD_FIELDS, 'holder_id_number', 'holder_name'],
};

@Injectable()
export class LicenceCardOcrService {
  private readonly logger = new Logger(LicenceCardOcrService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Read one photograph of a licence card.
   *
   * ⚠️ FAIL-SOFT, ALWAYS. No key, a provider error, a timeout, an unparseable
   * reply — all return `ok: false` with no fields. The seller then types what
   * the card says, which is what they would have done anyway. A consent flow
   * that only works when the model answers is a consent flow that strands
   * somebody in bad light with a form they cannot finish.
   */
  async read(bytes: Buffer, mimeType: string): Promise<LicenceCardReading> {
    if (!this.llm.isConfigured()) {
      this.logger.warn('LLM not configured — licence-card read skipped');
      return EMPTY;
    }
    if (!bytes?.length) return EMPTY;

    let text = '';
    try {
      const res = await this.llm.complete({
        maxTokens: 700,
        timeoutMs: 45_000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [blockFor(bytes, mimeType), { type: 'text', text: USER }],
          },
        ],
        // A reading, not a verdict — no reasoning budget to spend.
        thinking: { budgetTokens: 0 },
        json: { schema: CARD_SCHEMA },
        purpose: 'licence.card.read',
      });
      text = res.text.trim();
    } catch (err) {
      this.logger.warn(`Licence-card read failed: ${(err as Error).message}`);
      return EMPTY;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.warn('Licence-card read returned unparseable JSON');
      return EMPTY;
    }

    // ⚠️ EMPTY STAYS EMPTY. A blank value is dropped rather than written, so a
    // row we could not read never becomes the string NONE — see the header.
    const fields: Partial<FirearmSnapshot> = {};
    for (const key of CARD_FIELDS) {
      const value = asText(parsed[key]);
      if (value) (fields as Record<string, string>)[key] = value;
    }

    const short = (
      [
        'barrelSerial',
        'barrelMake',
        'receiverSerial',
        'receiverMake',
        'frameSerial',
        'frameMake',
      ] as CardField[]
    ).filter((k) => !fields[k]);
    if (short.length) {
      this.logger.warn(
        `Licence-card read is short of ${short.length} component field(s): ${short.join(', ')} — the card always prints all six`,
      );
    }

    return {
      fields,
      holderIdNumber: readId(parsed.holder_id_number),
      holderNameOnCard: asText(parsed.holder_name) || undefined,
      rawText: text,
      ok: true,
    };
  }
}

/**
 * One base64 image part.
 *
 * The mime is narrowed rather than passed through: the card is always a
 * photograph, and anything that is not png or webp reads better as a JPEG than
 * as a rejected request.
 */
function blockFor(bytes: Buffer, mimeType: string): LlmPart {
  return {
    type: 'image',
    mimeType:
      mimeType === 'image/png'
        ? 'image/png'
        : mimeType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg',
    data: bytes.toString('base64'),
  };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The holder's 13-digit identity number, or undefined. */
function readId(value: unknown): string | undefined {
  const digits = asText(value).replace(/\D/g, '');
  return digits.length === 13 ? digits : undefined;
}
