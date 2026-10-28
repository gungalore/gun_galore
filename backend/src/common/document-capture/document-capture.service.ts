import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  CAPTURE_SCHEMA,
  CAPTURE_SYSTEM,
  CAPTURE_USER,
  CAPTURE_VERSION,
  OCR_MAX_TOKENS,
  OCR_THINKING,
  captureBlock,
  type CaptureFact,
  type CaptureValueType,
  type DocumentCapture,
} from './document-capture';

const VALUE_TYPES: readonly CaptureValueType[] = [
  'text',
  'date',
  'number',
  'money',
  'address',
  'name',
  'reference',
  'boolean',
];

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function valueType(v: unknown): CaptureValueType {
  const raw = str(v) as CaptureValueType;
  return VALUE_TYPES.includes(raw) ? raw : 'text';
}

function confidence(v: unknown): CaptureFact['confidence'] {
  const raw = str(v);
  return raw === 'high' || raw === 'low' || raw === 'medium' ? raw : 'medium';
}

/**
 * ONE GEMINI PASS: THE WHOLE PAGE, AND EVERY LABELLED FACT ON IT.
 *
 * ⚠️ IT NEVER FILES ANYTHING. The document kind and the evidence container stay
 * with the existing classifiers and Jev. This service only reads.
 *
 * ⚠️ FAIL-SOFT. A miss costs the capture, never the upload: every caller keeps
 * its existing transcription/classification path.
 */
@Injectable()
export class DocumentCaptureService {
  private readonly logger = new Logger(DocumentCaptureService.name);

  constructor(private readonly llm: LlmService) {}

  async capture(args: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<DocumentCapture | null> {
    if (!this.llm.isConfigured()) return null;

    let raw = '';
    try {
      const res = await this.llm.complete({
        system: CAPTURE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              captureBlock(args.bytes, args.mimeType),
              { type: 'text', text: CAPTURE_USER },
            ],
          },
        ],
        maxTokens: OCR_MAX_TOKENS,
        thinking: OCR_THINKING,
        json: { schema: CAPTURE_SCHEMA },
        purpose: 'document.capture',
        timeoutMs: 60_000,
      });
      raw = res.text.trim();
    } catch (err) {
      this.logger.warn(`Document capture failed: ${(err as Error).message}`);
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      try {
        parsed = JSON.parse(m ? m[0] : raw) as Record<string, unknown>;
      } catch {
        this.logger.warn('Document capture returned unparseable JSON');
        return null;
      }
    }

    const doc =
      parsed.document && typeof parsed.document === 'object'
        ? (parsed.document as Record<string, unknown>)
        : {};
    const quality =
      parsed.quality && typeof parsed.quality === 'object'
        ? (parsed.quality as Record<string, unknown>)
        : {};
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
          .map((f) => {
            const row = f as Record<string, unknown>;
            return {
              label: str(row.label),
              value: str(row.value),
              valueType: valueType(row.valueType),
              confidence: confidence(row.confidence),
            };
          })
          .filter((f) => f.label && f.value)
      : [];

    return {
      version: CAPTURE_VERSION,
      pageText: str(parsed.pageText),
      document: {
        family: str(doc.family) || undefined,
        title: str(doc.title) || undefined,
        issuer: str(doc.issuer) || undefined,
        visualDescription: str(doc.visualDescription) || undefined,
      },
      facts,
      quality: {
        readable: quality.readable !== false,
        notes: Array.isArray(quality.notes)
          ? quality.notes.map(str).filter(Boolean)
          : [],
      },
    };
  }
}
