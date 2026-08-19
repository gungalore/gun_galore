import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { fieldsFor } from './motivation-fields';
import { readSaId } from './sa-id';

// ────────────────────────────────────────────────────────────────────
// READING WHAT THE APPLICANT ALREADY HAS.
//
// Operator, 2026-08-19: take the documents FIRST, because there is a lot we can
// pull off them. And they are right — an ID card carries the name, the ID
// number and therefore the date of birth, age, gender and citizenship; a
// competency certificate carries its number and dates; a licence carries the
// make, calibre and serial of a firearm they already own, which is exactly what
// the overlap check needs. Typing all of that again, off a card they are
// holding, is the part of a form people abandon.
//
// ── WHAT THIS IS ALLOWED TO DO, AND WHAT IT IS NOT ─────────────────
//
// It PROPOSES. Every value comes back as a suggestion the applicant confirms
// before it is written to their answers. Nothing here silently becomes an
// answer on a form they sign — a misread digit in an ID number is a false
// statement on a firearm licence application, and section 120(9)(f) of the Act
// makes that an offence.
//
// It reads ONLY registered fields. A key that is not in the registry is
// discarded, so a model cannot invent a field, and cannot reach a field we
// deliberately do not ask about.
//
// It NEVER reads the history questions. Nothing about convictions, pending
// cases or confiscations is extractable from a document, and a model guessing
// at someone's criminal record from a photograph is not a feature.
//
// ── FAIL-SOFT ON STORAGE, FAIL-CLOSED ON TRUST ─────────────────────
//
// An extraction failure must NOT lose the upload: the bytes are already stored,
// the applicant carries on, and extractionOk stays false. But a failure must
// also never leave a half-read value sitting in the form looking confirmed.
// Those are different directions and both matter.
//
// ⚠️ The ID NUMBER is cross-checked in CODE, not trusted from the model — a
// Luhn check plus a date that actually exists. Same posture as the serial
// cross-check in the listing pipeline: where a value gates something, the model
// transcribes and we verify.
// ────────────────────────────────────────────────────────────────────

const MODEL =
  process.env.ANTHROPIC_MODEL_MOTIVATION_EXTRACT ??
  process.env.ANTHROPIC_MODEL_JUDGE ??
  'claude-sonnet-4-6';

/** What each document kind can plausibly yield. Nothing else is accepted. */
const EXTRACTABLE: Partial<Record<MotivationUploadKind, string[]>> = {
  IDENTITY_DOCUMENT: ['full_name', 'id_number'],
  COMPETENCY_CERTIFICATE: [
    'competency_number',
    'competency_issued',
    'competency_expiry',
    'competency_for',
  ],
  PROFICIENCY_CERTIFICATE: ['competency_for'],
  ADDRESS_CONFIRMATION: ['residential_address', 'residential_postal_code'],
  ASSOCIATION_CARD: [
    'association_name',
    'association_number',
    'dedicated_since',
  ],
  CURRENT_LICENCE: [
    'existing_firearm_1_type',
    'existing_firearm_1_calibre',
    'existing_firearm_1_make',
    'existing_firearm_1_frame_serial',
    'existing_firearm_1_licence_no',
  ],
};

export interface ExtractedField {
  key: string;
  value: string;
  label: string;
  /** Shown next to the value so the applicant knows what to check. */
  from: string;
  /** False when our own checks disagree with what was read. */
  trusted: boolean;
  note?: string;
}

@Injectable()
export class MotivationExtractService {
  private readonly logger = new Logger(MotivationExtractService.name);
  private readonly client: Anthropic | null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey
      ? new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })
      : null;
  }

  /** Which document kinds are worth scanning at all. */
  static canExtract(kind: MotivationUploadKind): boolean {
    return Boolean(EXTRACTABLE[kind]?.length);
  }

  /**
   * Read one uploaded document.
   *
   * Returns [] on every failure path — an unreadable photograph, a model
   * outage, a malformed reply. The upload still exists and the applicant types
   * the values themselves, which is exactly what they would have done anyway.
   */
  async extract(args: {
    kind: MotivationUploadKind;
    licenceType: MotivationLicenceType;
    bytes: Buffer;
    mimeType: string;
  }): Promise<ExtractedField[]> {
    const wanted = EXTRACTABLE[args.kind] ?? [];
    if (!wanted.length || !this.client) return [];

    const registry = fieldsFor(args.licenceType);
    const asked = registry.filter((f) => wanted.includes(f.key));
    if (!asked.length) return [];

    const isPdf = args.mimeType === 'application/pdf';
    const block = isPdf
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: args.bytes.toString('base64'),
          },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: (args.mimeType === 'image/png'
              ? 'image/png'
              : args.mimeType === 'image/webp'
                ? 'image/webp'
                : 'image/jpeg') as 'image/png' | 'image/webp' | 'image/jpeg',
            data: args.bytes.toString('base64'),
          },
        };

    let text = '';
    try {
      const res = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        // Zero: this is transcription, not writing. The same card must read the
        // same way twice, and a "creative" ID number is worthless.
        temperature: 0,
        system: this.systemPrompt(),
        messages: [
          {
            role: 'user',
            content: [
              block,
              {
                type: 'text',
                text: this.userPrompt(asked),
              },
            ],
          },
        ],
      });
      const first = res.content.find((b) => b.type === 'text');
      text = first && 'text' in first ? first.text.trim() : '';
    } catch (err) {
      // FAIL-SOFT. The bytes are stored; the applicant is not blocked.
      this.logger.warn(
        `Extraction failed for ${args.kind}: ${(err as Error).message}`,
      );
      return [];
    }

    return this.parse(text, asked, args.kind);
  }

  private systemPrompt(): string {
    return `
You read a photographed or scanned South African document and transcribe
specific fields from it. You are a TRANSCRIBER, not an interpreter.

RULES, in order of importance:

1. Output ONLY what you can actually SEE. If a field is not on the document, or
   is blurred, cropped, glared out or ambiguous, return null for it. A null is
   correct and useful; a guess is a false statement on a firearm licence
   application.
2. Do NOT infer. Do not derive a date of birth from an ID number, do not expand
   an abbreviation you are unsure of, do not tidy a name into what you think it
   should be. Transcribe the characters on the document.
3. Read digits with particular care — 0/O, 1/I, 5/S, 8/B. If a single character
   is uncertain, the whole value is null.
4. Dates as YYYY-MM-DD.
5. If the document is not the type you were told to expect, return every field
   as null rather than reading a different document's contents into them.

Return STRICT JSON and nothing else:
{"fields":[{"key":"<exactly one of the keys given>","value":"<string>","confidence":"high"|"low"}]}

Omit any field you cannot read. Use "low" whenever you are not certain — a low
confidence value is shown to the applicant with a warning, which is far better
than a confident wrong one.`.trim();
  }

  private userPrompt(
    asked: { key: string; label: string; help?: string; choices?: readonly string[] }[],
  ): string {
    const lines = asked.map(
      (f) =>
        `- ${f.key}: ${f.label}` +
        (f.choices ? ` (must be exactly one of: ${f.choices.join(' | ')})` : '') +
        (f.help ? ` — ${f.help}` : ''),
    );
    return [
      'Read the attached document and transcribe these fields:',
      ...lines,
      '',
      'Return only the fields you can actually see on it.',
    ].join('\n');
  }

  /** Parse, then CHECK. Nothing is trusted just because it parsed. */
  private parse(
    text: string,
    asked: { key: string; label: string; choices?: readonly string[] }[],
    kind: MotivationUploadKind,
  ): ExtractedField[] {
    let parsed: { fields?: { key?: unknown; value?: unknown; confidence?: unknown }[] };
    try {
      const json = text.startsWith('{') ? text : text.slice(text.indexOf('{'));
      parsed = JSON.parse(json);
    } catch {
      this.logger.warn(`Extraction for ${kind} returned unparseable JSON`);
      return [];
    }

    const byKey = new Map(asked.map((f) => [f.key, f]));
    const out: ExtractedField[] = [];

    for (const row of parsed.fields ?? []) {
      if (typeof row?.key !== 'string' || typeof row?.value !== 'string') continue;
      const field = byKey.get(row.key);
      // ONLY fields we asked for. A model inventing a key would otherwise
      // propose a value against a field that does not exist.
      if (!field) continue;

      const value = row.value.trim();
      if (!value) continue;

      // A choice must be one of the offered choices, or it is not a choice.
      if (field.choices && !field.choices.includes(value)) continue;

      let trusted = row.confidence === 'high';
      let note: string | undefined;

      // THE ID NUMBER IS VERIFIED IN CODE. A Luhn failure means it was misread,
      // whatever the model's confidence says.
      if (row.key === 'id_number') {
        const read = readSaId(value);
        if (!read.valid || !read.dateOfBirth) {
          trusted = false;
          note = 'Check this carefully — it does not look like a valid SA ID number.';
        }
      }

      if (!trusted && !note) {
        note = 'We were not certain about this one — please check it.';
      }

      out.push({
        key: row.key,
        value,
        label: field.label,
        from: UPLOAD_LABEL[kind] ?? 'your document',
        trusted,
        note,
      });
    }

    return out;
  }
}

const UPLOAD_LABEL: Partial<Record<MotivationUploadKind, string>> = {
  IDENTITY_DOCUMENT: 'your ID',
  COMPETENCY_CERTIFICATE: 'your competency certificate',
  PROFICIENCY_CERTIFICATE: 'your proficiency certificate',
  ADDRESS_CONFIRMATION: 'your proof of address',
  ASSOCIATION_CARD: 'your association card',
  CURRENT_LICENCE: 'your existing licence',
};
