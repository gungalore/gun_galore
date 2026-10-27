import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import type { JevAnswer, JevQuestion, LlmPart } from '../common/llm/llm.types';
import { DiditService } from '../didit/didit.service';
import type { DiditRegistryLookup } from '../didit/didit.types';
import {
  findRegistrationNumber,
  normaliseRegistrationNumber,
  registrationNumbersMatch,
} from './dealer-registry.util';

/**
 * DEALER STOCK-IN — THE STAMP AND THE 350(a), VERIFIED.
 *
 * Operator, 2026-10-27: "we can only mark the firearm stocked once the dealer
 * filled in the form we sent them and also attached their dealer stamp, and
 * the 350 form filled in with the correct firearm details", and "Jev needs
 * 70% upwards on all fields to pass the dealer".
 *
 * Two documents, one verdict:
 *
 *   1. THE DEALER STAMP — the inked block a shop uses on paperwork. Five
 *      fields must each clear 70%: business name, company registration
 *      number, address, contact number and SAPS dealer licence number.
 *
 *   2. THE SAPS 350(a) — "Dealer's Return: Stock Received". Its Section B must
 *      show THIS firearm: serial, make/model and calibre, with the receiving
 *      dealer named and the form signed.
 *
 * ⚠️ GEMINI READS, JEV JUDGES, DIDIT PROVES. Gemini (3.1 flash-lite) only
 * transcribes the pages — it must not decide whether anything "matches".
 * Jev takes the transcript and returns one probability per field. Didit is the
 * only thing allowed to confirm the registration number: OCR proves what is
 * printed, CIPC proves the number and the name are the same business.
 *
 * ⚠️ FAIL TO A HUMAN, NEVER TO AN APPROVAL. No key, a Jev error or a Didit
 * outage sets `unavailable`. Every caller must treat that as "a person looks",
 * exactly as the rest of this module treats a missing model.
 */

/** Jev's probability floor for a single field. Operator: 70% on all fields. */
export const DEALER_STAMP_FIELD_FLOOR = 0.7;

export type DealerStampField =
  | 'dealer_name'
  | 'registration_number'
  | 'address'
  | 'contact_number'
  | 'dealer_licence';

export type DealerStockField =
  | 'serial'
  | 'make_model'
  | 'calibre'
  | 'dealer_named'
  | 'signed';

export interface DealerStampFieldScore {
  field: DealerStampField;
  /** 0..100, Jev's probability rounded. */
  score: number;
  pass: boolean;
}

export interface DealerStockFieldScore {
  field: DealerStockField;
  score: number;
  pass: boolean;
}

export interface DealerStampVerification {
  /** Every field cleared the floor AND CIPC agreed. The only pass signal. */
  pass: boolean;
  /** A dependency was missing or erroring — route to a human, never reject. */
  unavailable: boolean;
  stamp: DealerStampFieldScore[];
  stock: DealerStockFieldScore[];
  stampText: string | null;
  stockText: string | null;
  /**
   * What the stamp PRINTS, read by the transcriber — not a judgement. These
   * are the strings that build the dealer directory row, which is why they
   * come off the page rather than out of Jev (Jev returns probabilities, not
   * values).
   */
  extracted: {
    dealerName: string | null;
    registrationNumber: string | null;
    address: string | null;
    contactNumber: string | null;
    licenceNumber: string | null;
  };
  registration: {
    /** What the stamp printed, canonicalised, or null. */
    number: string | null;
    /** Didit's CIPC answer; null when nothing was read to ask about. */
    didit: DiditRegistryLookup | null;
    /** The legal name CIPC holds for that number, when Didit returned it. */
    registryName: string | null;
  };
  /** Human-readable, seller-facing sentences for whatever went wrong. */
  issues: string[];
  /** The Jev model id that answered, for the dossier. */
  jevModel: string | null;
}

/** What the paperwork is being checked against. */
export interface ExpectedDealer {
  name: string;
  address?: string | null;
  phone?: string | null;
  /** SAPS licence number, when the directory holds one. */
  licenceNumber?: string | null;
  /** CIPC number, when the directory holds one. */
  registrationNumber?: string | null;
  /** Firearm, from the listing. */
  make?: string | null;
  model?: string | null;
  calibre?: string | null;
  serialNumber?: string | null;
}

export interface DealerStampInput {
  /** The dealer stamp / letterhead page. */
  stamp: LlmPart;
  /** The SAPS 350(a). May be the same page as the stamp on a 534 upload. */
  stockForm: LlmPart;
  expected: ExpectedDealer;
}

@Injectable()
export class DealerStampVerificationService {
  private readonly logger = new Logger(DealerStampVerificationService.name);

  constructor(
    private readonly llm?: LlmService,
    private readonly didit?: DiditService,
  ) {}

  /** Is there a Jev key to ask? A caller may use this to skip the OCR spend. */
  isConfigured(): boolean {
    return Boolean(process.env.JEV_API_KEY);
  }

  async verify(input: DealerStampInput): Promise<DealerStampVerification> {
    const empty = this.emptyResult();

    if (!this.llm?.isConfigured() || !this.isConfigured()) {
      return {
        ...empty,
        unavailable: true,
        issues: [
          'We could not run the automatic dealer check just now — a person will review the stamp and the SAPS 350(a).',
        ],
      };
    }

    // ── 1. GEMINI READS ──────────────────────────────────────────────
    // Two pages, two reads, in parallel. A failure returns null and the review
    // goes to a human rather than judging an empty page.
    const [stampRead, stockText] = await Promise.all([
      this.readStamp(input.stamp),
      this.transcribe(input.stockForm, 'dealer.saps350.ocr', STOCK_OCR_SYSTEM, STOCK_OCR_USER),
    ]);
    const stampText = stampRead?.text ?? null;

    if (!stampText || !stockText) {
      return {
        ...empty,
        stampText,
        stockText,
        unavailable: true,
        issues: [
          'We could not read the dealer stamp or the SAPS 350(a) clearly enough to check it automatically — a person will review the paperwork.',
        ],
      };
    }

    // ── 2. JEV JUDGES ────────────────────────────────────────────────
    let answers: Record<string, JevAnswer>;
    let jevModel: string | null = null;
    try {
      const res = await this.llm.decide({
        purpose: 'dealer.stamp.verify',
        state: {
          stamp_text: stampText,
          stock_form_text: stockText,
          expected: {
            dealer_name: input.expected.name ?? '',
            address: input.expected.address ?? '',
            contact_number: input.expected.phone ?? '',
            dealer_licence: input.expected.licenceNumber ?? '',
            registration_number: input.expected.registrationNumber ?? '',
            make: input.expected.make ?? '',
            model: input.expected.model ?? '',
            calibre: input.expected.calibre ?? '',
            serial_number: input.expected.serialNumber ?? '',
          },
        },
        questions: this.questions(),
      });
      answers = res.answers;
      jevModel = res.model;
    } catch (err) {
      this.logger.warn(`Dealer stamp Jev battery failed: ${(err as Error).message}`);
      return {
        ...empty,
        stampText,
        stockText,
        unavailable: true,
        issues: [
          'We could not complete the automatic dealer check just now — a person will review the stamp and the SAPS 350(a).',
        ],
      };
    }

    const stamp = STAMP_FIELDS.map((field) => this.score(field, answers[field]));
    const stock = STOCK_FIELDS.map((field) => this.score(field, answers[field]));

    // ── 3. DIDIT PROVES THE REGISTRATION ─────────────────────────────
    // The printed field is preferred; the regex over the transcript is the
    // fallback for a stamp whose lines the reader returned with a little noise.
    const registration =
      normaliseRegistrationNumber(stampRead?.fields.registrationNumber) ??
      findRegistrationNumber(stampText);
    let didit: DiditRegistryLookup | null = null;
    const issues: string[] = [];
    let unavailable = false;

    if (!registration) {
      // The stamp's own line failed to parse; the field score below says so.
      issues.push(
        'We could not find a company registration number (e.g. 2019/139703/07) on the dealer stamp.',
      );
    } else {
      didit = await this.didit!.validateCompanyRegistry({
        registrationNumber: registration,
        companyName: input.expected.name,
      });

      if (didit.reason === 'not_configured' || didit.reason === 'unavailable') {
        unavailable = true;
        issues.push(
          'We could not confirm the company registration number with CIPC just now — a person will review it.',
        );
      } else if (!didit.ok) {
        issues.push(
          `The company registration number ${registration} does not match "${input.expected.name}" on the CIPC registry.`,
        );
      } else if (
        input.expected.registrationNumber &&
        !registrationNumbersMatch(input.expected.registrationNumber, registration)
      ) {
        issues.push(
          `The stamp shows registration ${registration}, but our records have ${normaliseRegistrationNumber(
            input.expected.registrationNumber,
          )}.`,
        );
      }
    }

    // ── 4. THE VERDICT ───────────────────────────────────────────────
    issues.push(...this.describeFailures(stamp, stock));

    const allCleared = [...stamp, ...stock].every((f) => f.pass);
    // ⚠️ CIPC IS PART OF `pass`, NOT A TIE-BREAKER. A stamp whose number CIPC
    // cannot connect to the named business is not verified, however confident
    // the transcription was.
    const registrationProven = Boolean(registration) && didit?.ok === true;
    const pass = allCleared && registrationProven && !unavailable;

    return {
      pass,
      unavailable,
      stamp,
      stock,
      stampText,
      stockText,
      extracted: {
        dealerName: stampRead?.fields.dealerName ?? null,
        registrationNumber: registration,
        address: stampRead?.fields.address ?? null,
        contactNumber: stampRead?.fields.contactNumber ?? null,
        licenceNumber: stampRead?.fields.licenceNumber ?? null,
      },
      registration: {
        number: registration,
        didit,
        registryName: didit?.companyName ?? null,
      },
      issues: dedupe(issues),
      jevModel,
    };
  }

  /**
   * The Jev battery.
   *
   * ⚠️ ONE CALL, EVERY QUESTION — Jev evaluates all of them against the same
   * state in parallel, so eleven fields cost one round trip.
   */
  private questions(): Record<string, JevQuestion> {
    const noul = (text: string): JevQuestion => ({
      type: 'noul',
      instructions: text,
    });

    return {
      dealer_name: noul(
        'Does the business name printed on the dealer stamp match `expected.dealer_name`? Ignore legal suffixes and punctuation differences (Pty / Pty. / (Pty) Ltd) and trading-style differences; a different business name does NOT match.',
      ),
      registration_number: noul(
        'Is a South African company registration number (CIPC, printed as YYYY/NNNNNN/NN) clearly legible on the dealer stamp?',
      ),
      address: noul(
        'Does the physical street address printed on the dealer stamp match `expected.address`? Suburb, city and postal code may be abbreviated; a different street or town does NOT match.',
      ),
      contact_number: noul(
        'Is a contact telephone number clearly legible on the dealer stamp, and does it match `expected.contact_number` when one is known? A different number on a different business does NOT match.',
      ),
      dealer_licence: noul(
        'Is an official SAPS firearms dealer licence number legible on the dealer stamp, and does it match `expected.dealer_licence` when one is known?',
      ),
      serial: noul(
        'On the dealer\u2019s stock document (the SAPS 350(a), or Section D of a SAPS 534), does the firearm record the serial number `expected.serial_number`? Compare ignoring spaces, dashes and case.',
      ),
      make_model: noul(
        'On the dealer\u2019s stock document (the SAPS 350(a), or Section D of a SAPS 534), does it record make `expected.make` and model `expected.model`? An absent model on the listing is met by any printed model.',
      ),
      calibre: noul(
        'On the dealer\u2019s stock document (the SAPS 350(a), or Section D of a SAPS 534), does it record the calibre `expected.calibre`? Equivalent printed forms (9mm Parabellum / 9x19) match.',
      ),
      dealer_named: noul(
        'Does the dealer\u2019s stock document name the receiving dealer, consistent with `expected.dealer_name`?',
      ),
      signed: noul(
        'Is the dealer\u2019s stock document signed and dated by the dealer (or carrying the dealer stamp in the signature block)?',
      ),
    };
  }

  private score<F extends DealerStampField | DealerStockField>(
    field: F,
    answer: JevAnswer | undefined,
  ): { field: F; score: number; pass: boolean } {
    // A missing or non-noul answer is a zero, not a skip: a field nobody could
    // judge cannot be one the dealer passed.
    const raw = answer?.type === 'noul' ? Number(answer.noul) : NaN;
    const probability = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    const score = Math.round(probability * 100);
    return {
      field,
      score,
      pass: probability >= DEALER_STAMP_FIELD_FLOOR,
    };
  }

  /**
   * Turn failed fields into sentences the seller can act on.
   *
   * ⚠️ THE SELLER CANNOT FIX WHAT WE DO NOT NAME. "Verification failed" sends
   * them back to the dealer asking what to change; one line per field does not.
   */
  private describeFailures(
    stamp: DealerStampFieldScore[],
    stock: DealerStockFieldScore[],
  ): string[] {
    const issues: string[] = [];
    const label = (field: string) => STAMP_LABELS[field] ?? field;

    for (const field of stamp) {
      if (field.pass) continue;
      if (field.field === 'registration_number') continue; // said above
      issues.push(`${label(field.field)} could not be read or matched on the dealer stamp.`);
    }
    for (const field of stock) {
      if (field.pass) continue;
      issues.push(STOCK_LABELS[field.field]);
    }
    return issues;
  }

  /**
   * Read the stamp.
   *
   * ⚠️ THE FIELDS ARE READ HERE, NOT JUDGED. The transcriber returns what the
   * stamp PRINTS so the directory row can be built from it; whether it matches
   * the nominated dealer is Jev's question, asked separately. A reader that
   * also decided "this matches" would be two sources of truth for one verdict.
   */
  private async readStamp(part: LlmPart): Promise<StampRead | null> {
    try {
      const res = await this.llm!.complete({
        system: STAMP_OCR_SYSTEM,
        messages: [{ role: 'user', content: [part, { type: 'text', text: STAMP_OCR_USER }] }],
        maxTokens: 4000,
        timeoutMs: 60_000,
        json: {},
        purpose: 'dealer.stamp.ocr',
      });
      const raw = (res.text ?? '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      let json: Record<string, unknown> = {};
      if (match) {
        try {
          json = JSON.parse(match[0]) as Record<string, unknown>;
        } catch {
          json = {};
        }
      }
      const text = typeof json.text === 'string' ? json.text.trim() : '';
      // A model that ignored the JSON instruction still gets a chance: the
      // whole reply is the transcript, and the regex finds the number.
      const transcript = text || raw;
      if (transcript.length < 15) return null;
      return {
        text: transcript,
        fields: {
          dealerName: str(json.dealer_name),
          registrationNumber: str(json.registration_number),
          address: str(json.address),
          contactNumber: str(json.contact_number),
          licenceNumber: str(json.licence_number),
        },
      };
    } catch (err) {
      this.logger.warn(`dealer.stamp.ocr failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Read one page verbatim. Gemini transcribes; it never classifies. */
  private async transcribe(
    part: LlmPart,
    purpose: string,
    system: string,
    user: string,
  ): Promise<string | null> {
    try {
      const res = await this.llm!.complete({
        system,
        messages: [{ role: 'user', content: [part, { type: 'text', text: user }] }],
        maxTokens: 8000,
        timeoutMs: 60_000,
        purpose,
      });
      const text = (res.text ?? '').trim();
      return text.length >= 15 ? text : null;
    } catch (err) {
      this.logger.warn(`${purpose} failed: ${(err as Error).message}`);
      return null;
    }
  }

  private emptyResult(): DealerStampVerification {
    return {
      pass: false,
      unavailable: false,
      stamp: [],
      stock: [],
      stampText: null,
      stockText: null,
      extracted: {
        dealerName: null,
        registrationNumber: null,
        address: null,
        contactNumber: null,
        licenceNumber: null,
      },
      registration: { number: null, didit: null, registryName: null },
      issues: [],
      jevModel: null,
    };
  }
}

/** One stamp page, as read. `fields` is what it prints; nothing is judged. */
interface StampRead {
  text: string;
  fields: {
    dealerName: string | null;
    registrationNumber: string | null;
    address: string | null;
    contactNumber: string | null;
    licenceNumber: string | null;
  };
}

/** A JSON field as a trimmed string, or null when absent/repeated as "null". */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || /^(null|n\/?a|none|unknown)$/i.test(t)) return null;
  return t;
}

const STAMP_FIELDS: DealerStampField[] = [
  'dealer_name',
  'registration_number',
  'address',
  'contact_number',
  'dealer_licence',
];

const STOCK_FIELDS: DealerStockField[] = [
  'serial',
  'make_model',
  'calibre',
  'dealer_named',
  'signed',
];

const STAMP_LABELS: Record<string, string> = {
  dealer_name: 'The dealer / business name',
  registration_number: 'The company registration number',
  address: 'The dealer address',
  contact_number: 'The dealer contact number',
  dealer_licence: 'The SAPS dealer licence number',
};

const STOCK_LABELS: Record<DealerStockField, string> = {
  serial: 'The SAPS 350(a) does not record this firearm’s serial number.',
  make_model: 'The SAPS 350(a) does not record this firearm’s make and model.',
  calibre: 'The SAPS 350(a) does not record this firearm’s calibre.',
  dealer_named: 'The SAPS 350(a) does not name the receiving dealer.',
  signed: 'The SAPS 350(a) is not signed and dated by the dealer.',
};

const STAMP_OCR_SYSTEM = `
You read one firearm dealer's stamp or letterhead from a South African gunshop.
Return ONLY a single JSON object, no markdown and no commentary:
{"text":"<every line of the stamp, verbatim, in reading order>","dealer_name":<string|null>,"registration_number":<string|null>,"address":<string|null>,"contact_number":<string|null>,"licence_number":<string|null>}
Transcribe exactly what is printed. Set a field to null when it is not clearly
printed — never guess, never correct, never infer. Do NOT judge whether the
stamp matches any other document.
`.trim();

const STAMP_OCR_USER = [
  'Read this dealer stamp. Capture the business name, the company registration',
  'number (e.g. 2019/139703/07), the address, the contact numbers and the SAPS',
  'dealer licence number exactly as printed.',
].join('\n');

const STOCK_OCR_SYSTEM = `
You transcribe one page of a South African SAPS 350(a) form ("Dealer's Return:
Stock Received"), completely and exactly, in reading order.
Output ONLY the text you can read, keeping field labels next to their values.
Do NOT summarise, classify, explain or add commentary. If there is no printed
text, output an empty response.
`.trim();

const STOCK_OCR_USER = [
  'Transcribe every word and number on this SAPS 350(a) page, especially the',
  'dealer particulars and Section B details of the firearm received — make,',
  'model, calibre, type and serial number. Return the text only.',
].join('\n');

/** Stable de-duplication: order preserved, exact repeats dropped. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
