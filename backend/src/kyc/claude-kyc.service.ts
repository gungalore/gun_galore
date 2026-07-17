import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { CrossCheckResult } from './kyc-cross-check';

/**
 * Claude-vision KYC scanner — the cheap face-match + document OCR that
 * replaces VerifyNow's 10-credit facematch in the kyc_claude_flow.
 *
 * One vision call per verdict, shown:
 *   1. The seller's uploaded SA identity document (smart card / green
 *      book) — image URL block, or a base64 `document` block for PDFs.
 *   2. The live selfie captured seconds earlier via getUserMedia.
 *   3. (anchored tier only) The OFFICIAL Home Affairs photo pulled via
 *      the 10-credit VerifyNow product — used for sellers whose listing/
 *      sale value crosses kyc_anchored_threshold_cents. The seller never
 *      sees the difference; only the gates change.
 *
 * Claude is deliberately given NO expected identity data (no ID number,
 * no name, no DOB): it scores faces + OCRs the document blind, and ALL
 * identity comparison happens server-side in kyc-cross-check.ts. That
 * prevents anchor bias ("the caller told me the name, so I read the
 * name") and keeps cross-check inputs out of the model transcript.
 *
 * Verdict convention mirrors dealer-verification.service.ts:
 *   all gates ≥ 80 and cross-check clean → VERIFIED
 *   any gate < 50 or a hard cross-check fail → REJECTED
 *   anything between / soft fails / Claude unavailable → UNDER_REVIEW
 */

// Sonnet 5 — the current-generation vision model. Dedicated to KYC (its own
// ANTHROPIC_MODEL_KYC env var) so the identity face-match / document-
// authenticity judgement is decoupled from the dealer-verification model
// (ANTHROPIC_MODEL_JUDGE) and can be tuned independently.
const MODEL_VISION = process.env.ANTHROPIC_MODEL_KYC ?? 'claude-sonnet-5';

const AUTO_APPROVE_FLOOR = 80;
const AUTO_REJECT_CEILING = 50;

export interface KycClaudeFindings {
  face_match: {
    /** Selfie person == person in the DOCUMENT's photo (0-100). */
    same_person: number;
    /** Selfie looks like a genuine live capture, not a re-shot photo/screen. */
    selfie_live_capture: number;
    /** The document's photo is clearly visible/usable for comparison. */
    document_photo_visible: number;
    /** anchored tier only: selfie person == OFFICIAL Home Affairs photo. */
    same_person_vs_ha_photo?: number;
    issues: string[];
  };
  document: {
    /** Looks like a genuine, untampered SA ID (fonts/layout/coat of arms). */
    looks_genuine_sa_id: number;
    document_type: 'SMART_ID_CARD' | 'GREEN_BOOK' | 'OTHER' | null;
    extracted_id_number: string | null;
    extracted_surname: string | null;
    extracted_names: string | null;
    /** Normalised to YYYY-MM-DD by the prompt contract. */
    extracted_dob: string | null;
    legibility: number;
    issues: string[];
  };
  overall_confidence: number;
  recommendation: 'APPROVE' | 'ADMIN_REVIEW' | 'REJECT';
  recommendation_reason: string;
}

export interface KycScanInput {
  /** Bare base64 JPEG from the getUserMedia capture. */
  selfieBase64: string;
  /** Cloudinary image URL of the ID document (non-PDF path). */
  documentUrl?: string;
  /** Raw PDF bytes when the seller uploaded a PDF (Claude reads natively). */
  documentPdf?: Buffer;
  /** standard = selfie vs document photo. anchored adds the DHA photo gate. */
  mode: 'standard' | 'anchored';
  /** Official Home Affairs photo (bare base64) — anchored mode only. */
  haPhotoBase64?: string;
}

const SYSTEM_PROMPT = `You are the identity-verification scanner for Gun Galore, a South African online marketplace. You will be shown:
1. A South African identity document — a smart ID card or a green ID book — as a photo or PDF.
2. A live selfie of the person submitting it, captured moments ago by their webcam or phone camera.
3. Sometimes, a third reference photograph labelled "official record photo".

Your tasks:
A. FACE MATCH — score (0-100) your confidence that the person in the selfie is the SAME PERSON as the photo printed on the identity document. If an "official record photo" is also provided, separately score selfie-vs-official-photo as same_person_vs_ha_photo.
B. LIVENESS IMPRESSION — score whether the selfie looks like a genuine live camera capture rather than a photograph of a photograph, a phone/monitor screen re-shoot, or a heavily edited image. Screen glare, moiré patterns, visible bezels, paper texture and uniform print grain are red flags.
C. DOCUMENT OCR — read from the identity document: the 13-digit ID number, the surname, the given names, and the date of birth. Output the date of birth normalised to YYYY-MM-DD. If any field is not clearly readable, output null for it — NEVER guess.
D. DOCUMENT AUTHENTICITY — score whether this looks like a genuine, untampered South African identity document: correct layout and fonts, coat of arms, no visible edits, pasted-over photos, or font inconsistencies. Green ID books are often OLD and WORN — judge signs of tampering, not ordinary wear. Classify document_type as SMART_ID_CARD, GREEN_BOOK, or OTHER.

Scoring guidance: be honest, not generous. A blurry or illegible input scores low legibility (≤ 50). When you are genuinely uncertain whether two faces match, score in the 50-79 band (that routes to a human) rather than guessing high or low. Recommend REJECT only when you are confident something is wrong; recommend ADMIN_REVIEW when uncertain.

Output ONLY a single valid JSON object. The first character of your reply MUST be the literal '{'. No markdown fences, no commentary. Schema:
{
  "face_match": { "same_person": 0-100, "selfie_live_capture": 0-100, "document_photo_visible": 0-100, "same_person_vs_ha_photo": 0-100 (ONLY when an official record photo was provided), "issues": ["..."] },
  "document": { "looks_genuine_sa_id": 0-100, "document_type": "SMART_ID_CARD"|"GREEN_BOOK"|"OTHER"|null, "extracted_id_number": "13 digits or null", "extracted_surname": "string or null", "extracted_names": "string or null", "extracted_dob": "YYYY-MM-DD or null", "legibility": 0-100, "issues": ["..."] },
  "overall_confidence": 0-100,
  "recommendation": "APPROVE"|"ADMIN_REVIEW"|"REJECT",
  "recommendation_reason": "one sentence"
}`;

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }
  | { type: 'image'; source: { type: 'url'; url: string } }
  | {
      type: 'document';
      source: { type: 'base64'; media_type: 'application/pdf'; data: string };
    };

@Injectable()
export class ClaudeKycService {
  private readonly logger = new Logger(ClaudeKycService.name);
  private readonly client: Anthropic | null;

  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
    if (!key) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — Claude KYC verdicts will queue for admin review',
      );
    }
  }

  /**
   * Run the single vision scan. Throws on any failure (no client, API
   * error, non-JSON reply) — the caller maps a throw to UNDER_REVIEW so a
   * Claude outage can never auto-verify OR auto-reject anyone.
   */
  async scan(input: KycScanInput): Promise<KycClaudeFindings> {
    if (!this.client) throw new Error('Claude KYC unavailable — no API key');
    if (!input.documentUrl && !input.documentPdf) {
      throw new Error('Claude KYC scan called without a document');
    }

    const documentBlock: ContentBlock = input.documentPdf
      ? {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.documentPdf.toString('base64'),
          },
        }
      : { type: 'image', source: { type: 'url', url: this.jpegUrl(input.documentUrl!) } };

    const userContent: ContentBlock[] = [
      {
        type: 'text',
        text: 'Identity document (photo or PDF — if a PDF, find the page carrying the ID and its photo):',
      },
      documentBlock,
      { type: 'text', text: 'Live selfie captured moments ago:' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: input.selfieBase64 },
      },
    ];

    if (input.mode === 'anchored' && input.haPhotoBase64) {
      userContent.push(
        { type: 'text', text: 'Official record photo:' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: input.haPhotoBase64,
          },
        },
      );
    }

    const msg = await this.client.messages.create({
      model: MODEL_VISION,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent as never }],
    });

    const block = msg.content.find((b) => b.type === 'text');
    const raw = (block as { text?: string } | undefined)?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude KYC did not return JSON');
    return JSON.parse(match[0]) as KycClaudeFindings;
  }

  /**
   * Combine Claude's gate scores with the server-side cross-check.
   * Hard cross-check fails always REJECT; soft fails cap at UNDER_REVIEW.
   */
  statusFromFindings(
    findings: KycClaudeFindings,
    crossCheck: CrossCheckResult,
    mode: 'standard' | 'anchored',
  ): 'VERIFIED' | 'UNDER_REVIEW' | 'REJECTED' {
    if (crossCheck.hardFails.length > 0) return 'REJECTED';

    const gates: number[] = [
      findings.face_match?.same_person ?? 0,
      findings.face_match?.selfie_live_capture ?? 0,
      findings.face_match?.document_photo_visible ?? 0,
      findings.document?.looks_genuine_sa_id ?? 0,
      findings.document?.legibility ?? 0,
    ];
    if (mode === 'anchored') {
      // The anchored gate is the whole point of the tier — a missing score
      // (model omitted it) counts as 0 so it can never silently pass.
      gates.push(findings.face_match?.same_person_vs_ha_photo ?? 0);
    }

    if (gates.some((g) => g < AUTO_REJECT_CEILING)) return 'REJECTED';
    if (crossCheck.softFails.length > 0) return 'UNDER_REVIEW';
    if (gates.every((g) => g >= AUTO_APPROVE_FLOOR)) return 'VERIFIED';
    return 'UNDER_REVIEW';
  }

  /**
   * Force a JPEG delivery variant of a Cloudinary image URL. HEIC uploads
   * can't be decoded by Claude (or by desktop browsers), but Cloudinary
   * transcodes server-side when an `f_jpg` transformation is in the path.
   * Non-Cloudinary URLs pass through untouched.
   */
  private jpegUrl(url: string): string {
    return url.includes('/image/upload/') && !url.includes('/image/upload/f_jpg')
      ? url.replace('/image/upload/', '/image/upload/f_jpg/')
      : url;
  }
}
