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

/**
 * "Which document is this?" runs on the CHEAP model.
 *
 * Naming a document is a far easier job than reading one, and it happens once
 * per file in a pack — a member uploading eight documents should not pay eight
 * Sonnet calls to have them sorted into piles.
 */
const MODEL_CLASSIFY =
  process.env.ANTHROPIC_MODEL_SIMPLE ?? 'claude-haiku-4-5';

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
  // The sworn letter carries the same association and dedicated number as the
  // certificate, plus the two dates that make it expire — which is the whole
  // reason it is a separate document rather than another photograph of the
  // status.
  GOOD_STANDING_LETTER: [
    'association_name',
    'association_number',
    'dedicated_since',
  ],
  // ⚠️ IT DESCRIBES THE FIREARM BEING APPLIED FOR, so it fills the firearm
  // fields, not the association ones. That is what makes it worth reading: an
  // endorsement already names the type, calibre, make, action and serial, and
  // the applicant would otherwise type all five again.
  ASSOCIATION_ENDORSEMENT: [
    'firearm_type',
    'firearm_calibre',
    'firearm_make',
    'firearm_action',
    'firearm_serial',
  ],
  EMPLOYMENT_CONFIRMATION: ['employer_name', 'employer_address'],
  // Written against ROW 1 and remapped to whichever row is free — see
  // nextOwnedSlot(). The barrel serial is on the licence where the firearm has
  // a separately-licensed barrel, and it was simply never asked for.
  CURRENT_LICENCE: [
    'existing_firearm_1_type',
    'existing_firearm_1_calibre',
    'existing_firearm_1_make',
    'existing_firearm_1_barrel_serial',
    'existing_firearm_1_frame_serial',
    'existing_firearm_1_licence_no',
  ],
};

/** How many firearm rows the registry carries. Mirrors motivation-fields.ts. */
const OWNED_ROWS = 6;

/**
 * Which "firearms you already own" row a newly-uploaded licence should fill.
 *
 * ⚠️ THIS IS WHY A SECOND LICENCE USED TO VANISH. Every CURRENT_LICENCE
 * extraction wrote to row 1, so uploading a second licence either overwrote the
 * first or was discarded as an already-answered suggestion. Someone with three
 * licensed firearms — exactly the applicant whose overlap needs explaining —
 * ended up with one row and a motivation that argued the wrong case.
 *
 * A row counts as taken once its CALIBRE is filled, matching the wizard's own
 * definition of a started row and the overlap engine's only required column.
 *
 * Returns null when all six are full: the registry has no seventh row, and
 * silently overwriting row 6 would be worse than proposing nothing.
 */
export function nextOwnedSlot(answers: Record<string, string>): number | null {
  for (let i = 1; i <= OWNED_ROWS; i++) {
    if (!(answers[`existing_firearm_${i}_calibre`] ?? '').trim()) return i;
  }
  return null;
}

/** Rewrite row-1 keys onto the row actually being filled. */
export function remapOwnedSlot(keys: string[], slot: number): string[] {
  return keys.map((k) =>
    k.replace(/^existing_firearm_1_/, `existing_firearm_${slot}_`),
  );
}

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
    /** What is already answered — decides which owned-firearm row to fill. */
    answers?: Record<string, string>;
  }): Promise<ExtractedField[]> {
    let wanted = EXTRACTABLE[args.kind] ?? [];
    if (!wanted.length || !this.client) return [];

    // A licence describes ONE firearm, and the applicant may upload several.
    if (args.kind === 'CURRENT_LICENCE') {
      const slot = nextOwnedSlot(args.answers ?? {});
      if (slot === null) return [];
      wanted = remapOwnedSlot(wanted, slot);
    }

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
        // ⚠️ NO `temperature` HERE, AND NEVER ADD ONE.
        //
        // temperature / top_p / top_k were REMOVED from the API on Opus 4.7 and
        // later, and on Sonnet 5 — which is what ANTHROPIC_MODEL_JUDGE points at
        // on the live box. Sending one is a 400:
        //   "`temperature` is deprecated for this model."
        //
        // It cost us two days of silence: every call site below fails soft, so
        // the 400 was caught, logged at warn, and the feature simply did
        // nothing. Deterministic transcription is the DEFAULT now — there is no
        // parameter to ask for it.
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

  /**
   * NAME THE DOCUMENT.
   *
   * Exists because the required-documents checklist ticks on the KIND the
   * member picked from a dropdown, not on what is in the file — so a
   * mislabelled upload shows the requirement satisfied while the pack is
   * actually missing it. That is not hypothetical: the operator's own proof of
   * address went in as an identity document because the picker defaults to its
   * first option.
   *
   * ⚠️ IT PROPOSES; IT NEVER OVERRULES. A kind the member chose explicitly is
   * kept whatever this returns. Only an upload with no kind — one file of a
   * batch — is filed on this, and the wizard shows what each was filed as with
   * a way to change it.
   *
   * Returns null when it cannot tell, and null means OTHER: a document filed
   * as "something else" is visibly unsorted, where a confident wrong guess
   * looks like a satisfied requirement.
   */
  async classify(args: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<{ kind: MotivationUploadKind; confident: boolean } | null> {
    if (!this.client) return null;

    const block = contentBlock(args.bytes, args.mimeType);

    let text = '';
    try {
      const res = await this.client.messages.create({
        model: MODEL_CLASSIFY,
        max_tokens: 200,
        system: CLASSIFY_SYSTEM,
        messages: [
          { role: 'user', content: [block, { type: 'text', text: CLASSIFY_USER }] },
        ],
      });
      const first = res.content.find((b) => b.type === 'text');
      text = first && 'text' in first ? first.text.trim() : '';
    } catch (err) {
      // Fail soft, like every other model call here: an unsorted document is
      // a small inconvenience, a failed upload is not.
      this.logger.warn(`Classification failed: ${(err as Error).message}`);
      return null;
    }

    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const parsed = JSON.parse(m[0]) as { kind?: string; confidence?: string };
      const kind = (parsed.kind ?? '').trim() as MotivationUploadKind;
      if (!CLASSIFIABLE.includes(kind)) return null;
      return { kind, confident: (parsed.confidence ?? '') === 'high' };
    } catch {
      return null;
    }
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
  ASSOCIATION_CARD: 'your dedicated status certificate',
  GOOD_STANDING_LETTER: 'your letter of good standing',
  ASSOCIATION_ENDORSEMENT: "your association's endorsement",
  CURRENT_LICENCE: 'your existing licence',
};

/** The kinds a photograph can actually be sorted into. */
const CLASSIFIABLE: MotivationUploadKind[] = [
  // ⚠️ ALL THREE ASSOCIATION DOCUMENTS ARE SEPARATELY CLASSIFIABLE, and they
  // must be: they come from the same association on the same letterhead, and
  // a classifier that only knew ASSOCIATION_CARD would file the sworn letter
  // and the endorsement as the status certificate. The pack would then look
  // complete while missing the declaration section 16(2) asks for.
  'GOOD_STANDING_LETTER',
  'ASSOCIATION_ENDORSEMENT',
  'IDENTITY_DOCUMENT',
  'COMPETENCY_CERTIFICATE',
  'PROFICIENCY_CERTIFICATE',
  'CURRENT_LICENCE',
  'ASSOCIATION_CARD',
  'ADDRESS_CONFIRMATION',
  'EMPLOYMENT_CONFIRMATION',
  'SAFE_PHOTO_CLOSED',
  'SAFE_PHOTO_AJAR',
  'SAFE_PHOTO_BOLTS',
  'SAFE_INSTALLATION',
  'CHARACTER_REFERENCE',
  'INCIDENT_REPORT',
  'PREVIOUS_MOTIVATION',
  'OTHER',
];

/** One base64 content block, image or PDF. Shared by read and classify. */
function contentBlock(bytes: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') {
    return {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: bytes.toString('base64'),
      },
    };
  }
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: (mimeType === 'image/png'
        ? 'image/png'
        : mimeType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg') as 'image/png' | 'image/webp' | 'image/jpeg',
      data: bytes.toString('base64'),
    },
  };
}

const CLASSIFY_SYSTEM = `
You sort a photographed or scanned South African document into exactly one
category. You are sorting, not reading: you do not need to transcribe anything.

Answer with the category you can actually see evidence for. "OTHER" is a real
answer and a useful one — a document filed as "something else" is visibly
unsorted, where a confident wrong answer looks like a satisfied requirement on
a firearm licence application.

Return STRICT JSON and nothing else:
{"kind":"<one category>","confidence":"high"|"low"}
`.trim();

const CLASSIFY_USER = [
  'Which of these is this document? Answer with the exact string.',
  '',
  'IDENTITY_DOCUMENT - a South African ID book, ID card, or passport',
  'COMPETENCY_CERTIFICATE - a SAPS competency certificate',
  'PROFICIENCY_CERTIFICATE - a proficiency or firearm training certificate',
  'CURRENT_LICENCE - a firearm licence card or certificate',
  'ASSOCIATION_CARD - hunting or sport-shooting association membership',
  'ADDRESS_CONFIRMATION - proof of address: a municipal bill, bank statement,',
  '  lease or affidavit showing a residential address',
  'EMPLOYMENT_CONFIRMATION - a letter confirming employment',
  'SAFE_PHOTO_CLOSED - a photograph of a gun safe, CLOSED',
  'SAFE_PHOTO_AJAR - a photograph of a gun safe, part open with a key in the door',
  'SAFE_PHOTO_BOLTS - a photograph of a gun safe, open with the locking bolts visible',
  'SAFE_INSTALLATION - a photograph showing a safe bolted to a wall or floor',
  'CHARACTER_REFERENCE - a personal reference letter about someone',
  'INCIDENT_REPORT - a SAPS case document or armed-response incident report',
  'PREVIOUS_MOTIVATION - a previously written firearm licence motivation',
  'OTHER - anything else, or you cannot tell',
  '',
  'For the three safe photographs, look at the door: shut is CLOSED, part open',
  'with a key in the lock is AJAR, and wide open showing the bolts that stick',
  'out of the door edge is BOLTS. If it shows the safe fixed to a wall or',
  'floor rather than the door, that is SAFE_INSTALLATION.',
].join('\n');
