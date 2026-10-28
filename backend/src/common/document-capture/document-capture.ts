import { OCR_MAX_TOKENS, OCR_THINKING } from '../llm/llm.service';

// ────────────────────────────────────────────────────────────────────
// ONE PASS OVER A PAGE: TRANSCRIBE IT AND LIST EVERY FACT ON IT.
//
// Operator, 2026-10-28: "The reader should extract everything from every single
// document a user feeds it. Then between gemini and JEV it should decide what
// information it is and see if there is a container available for it."
//
// This is the foundation of that: Gemini reads the page once and returns the
// full transcription plus every printed label/value pair. Jev still makes the
// routing decision; the projection still writes only the fields the container
// asks for. The difference is that nothing the page printed is thrown away for
// not being on a WANTED list.
//
// ⚠️ THE CAPTURE IS DATA, NOT A CLASSIFICATION. It does not name a document
// kind or an evidence container. Filing stays with DocumentFilingService so
// there is one owner of that decision.
// ────────────────────────────────────────────────────────────────────

export const CAPTURE_VERSION = '2026-10-28a';

export type CaptureValueType =
  | 'text'
  | 'date'
  | 'number'
  | 'money'
  | 'address'
  | 'name'
  | 'reference'
  | 'boolean';

export interface CaptureFact {
  /** The printed label, verbatim. */
  label: string;
  /** The printed value, verbatim. */
  value: string;
  /**
   * The value in a machine-readable form where the page allows: an ISO
   * yyyy-mm-dd date, digits-only ID, digits-only reference. Never a guess.
   */
  normalized?: string;
  valueType: CaptureValueType;
  confidence: 'high' | 'medium' | 'low';
}

export interface DocumentCapture {
  version: string;
  /** Everything printed on the page, in reading order. Empty for a photograph. */
  pageText: string;
  document: {
    family?: string;
    title?: string;
    issuer?: string;
    /** What the picture shows, when the page carries no printed text. */
    visualDescription?: string;
  };
  facts: CaptureFact[];
  quality: {
    readable: boolean;
    notes: string[];
  };
}

export const CAPTURE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    pageText: { type: 'string' },
    document: {
      type: 'object',
      properties: {
        family: { type: 'string' },
        title: { type: 'string' },
        issuer: { type: 'string' },
        visualDescription: { type: 'string' },
      },
    },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          normalized: { type: 'string' },
          valueType: {
            type: 'string',
            enum: [
              'text',
              'date',
              'number',
              'money',
              'address',
              'name',
              'reference',
              'boolean',
            ],
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['label', 'value'],
      },
    },
    quality: {
      type: 'object',
      properties: {
        readable: { type: 'boolean' },
        notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['readable'],
    },
  },
  required: ['pageText', 'facts', 'quality'],
};

export const CAPTURE_SYSTEM = `
You read one page of a South African document. You do two things, and nothing
else:

1. TRANSCRIBE the printed text completely and exactly, in reading order.
2. LIST every labelled fact on the page: each printed label with the value it
   owns. A date, a number, a name, an address, a reference, a firearm's make,
   model, calibre or serial — if the page prints a label and a value, list it.
   Use the printed label verbatim. Do not merge two labels, do not invent a
   label, and leave a value out if the page does not print it.
   Where the value is a date, put the same date in normalized as
   yyyy-mm-dd; where it is an identity or reference number, put the digits only
   (no spaces or punctuation) in normalized. Otherwise omit normalized.
   If the value is a number or date you cannot read cleanly, omit it rather
   than guessing.

⚠️ A SOUTH AFRICAN FIREARM LICENCE PRINTS ITS ISSUE AND EXPIRY DATES WITHOUT
LABELS. They are the two dates on the line beneath the section, for example
"2025-08-27 – 2035-08-26". List them as two facts labelled "Issue date" and
"Expiry date", with normalized ISO values: the first date is the issue, the
second is the expiry. Do not treat the range as a single fact.

Do NOT classify the document. Do NOT name a kind or a folder. Do NOT summarise.
Do NOT add commentary. If the page has no printed text — a photograph of a
scene or an object — leave pageText and facts empty and describe what is
visible in document.visualDescription.

Return strict JSON in the supplied shape.
`.trim();

export const CAPTURE_USER = [
  'Transcribe this page and list every printed label and value on it.',
  'Use the printed label verbatim. Do not classify it.',
].join('\n');

export function captureBlock(
  bytes: Buffer,
  mimeType: string,
): { type: 'document' | 'image'; mimeType: string; data: string } {
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      mimeType: 'application/pdf',
      data: bytes.toString('base64'),
    };
  }
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

export { OCR_MAX_TOKENS, OCR_THINKING };
