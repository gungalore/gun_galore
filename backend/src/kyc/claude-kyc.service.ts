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
 * Verdict thresholds (operator decision 2026-07-17):
 *   every gate ≥ 70 and cross-check clean → VERIFIED
 *   any gate 50-69 (none < 50)            → UNDER_REVIEW (admin decides)
 *   any gate < 50, or a hard cross-check fail → REJECTED (email support)
 */

// Sonnet 5 — the current-generation vision model. Dedicated to KYC (its own
// ANTHROPIC_MODEL_KYC env var) so the identity face-match / document-
// authenticity judgement is decoupled from the dealer-verification model
// (ANTHROPIC_MODEL_JUDGE) and can be tuned independently.
const MODEL_VISION = process.env.ANTHROPIC_MODEL_KYC ?? 'claude-sonnet-5';

// Auto-approve at 70% certainty; 50-69 goes to a human; below 50 is rejected.
const AUTO_APPROVE_FLOOR = 70;
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
  /**
   * The holder's age now, derived from the SA ID number's YYMMDD prefix
   * (see ageFromSaIdNumber). Optional — omitted when the digits don't parse.
   *
   * Told to the model so the age gap is a stated fact rather than something
   * it has to infer from two photographs. A green ID book issued at 16 to
   * someone now 45 means a ~29-year gap, and knowing that is the difference
   * between "these look like different people" and "this is what that person
   * looks like 29 years later".
   */
  subjectAgeYears?: number;
}

const SYSTEM_PROMPT = `You are the identity-verification scanner for All Outdoor, a South African online marketplace. You will be shown:
1. A South African identity document — a smart ID card or a green ID book — as a photo or PDF.
2. A live selfie of the person submitting it, captured moments ago by their webcam or phone camera.
3. Sometimes, a third reference photograph labelled "official record photo".

Your tasks:
A. FACE MATCH — score (0-100) your confidence that the person in the selfie is the SAME PERSON as the photo printed on the identity document. If an "official record photo" is also provided, separately score selfie-vs-official-photo as same_person_vs_ha_photo.
B. LIVENESS IMPRESSION — score whether the selfie looks like a genuine live camera capture rather than a photograph of a photograph, a phone/monitor screen re-shoot, or a heavily edited image. Screen glare, moiré patterns, visible bezels, paper texture and uniform print grain are red flags.
C. DOCUMENT OCR — read from the identity document: the 13-digit ID number, the surname, the given names, and the date of birth. Output the date of birth normalised to YYYY-MM-DD. If any field is not clearly readable, output null for it — NEVER guess.
D. DOCUMENT AUTHENTICITY — score whether this looks like a genuine, untampered South African identity document: correct layout and fonts, coat of arms, no visible edits, pasted-over photos, or font inconsistencies. Green ID books are often OLD and WORN — judge signs of tampering, not ordinary wear. Classify document_type as SMART_ID_CARD, GREEN_BOOK, or OTHER.

Scoring guidance: be honest, not generous. When you are genuinely uncertain whether two faces match, score in the 50-79 band (that routes to a human) rather than guessing high or low. Recommend REJECT only when you are confident something is wrong; recommend ADMIN_REVIEW when uncertain.

CRITICAL — SEPARATE "I CANNOT SEE" FROM "THIS IS THE WRONG PERSON". These are different failures with different consequences, and conflating them punishes honest people:
- If the document photo is too dark, blurred, glared, cropped or low-resolution to judge, say so through LOW legibility and LOW document_photo_visible. Do NOT let that drag down same_person. An unreadable capture is a capture problem, not evidence of fraud.
- Only score same_person low when you can actually SEE both faces well enough to judge and they genuinely look like different people.
- If you cannot see well enough to have an opinion at all, same_person belongs in the 50-79 uncertain band — never below 50.

Judging same_person — compare STABLE FACIAL STRUCTURE, not surface appearance.

RANK THE EVIDENCE. Some features cannot be changed by ageing, grooming or weight, and those decide the match. In descending order of reliability:
1. Inter-pupillary distance as a RATIO of face width, and the eye-to-eye-to-nose triangle. Skull geometry; effectively fixed after adolescence.
2. Ear morphology where visible — helix shape, lobe attachment, tragus, position relative to the eye line. Highly individual and stable for life.
3. Nose BRIDGE width and the nasal profile at the bridge (the bony part, not the fleshy tip, which softens with age).
4. Inter-ocular distance relative to nose-bridge width; philtrum length relative to nose width.
5. Eye shape and canthal tilt (the angle between inner and outer corners).
6. Brow ridge prominence and orbital shape.
LOW-VALUE, easily changed, must never decide a verdict: hairstyle, hairline, facial hair, glasses, make-up, weight, skin tone under different lighting, expression, image colour cast, jewellery.

OCCLUSION IS MISSING EVIDENCE, NOT CONTRARY EVIDENCE. This is the single most important rule here. If a beard hides the jaw and chin, you have NO jaw evidence — you do not have evidence of a DIFFERENT jaw. Long hair or a hat covering the ears and hairline removes ear evidence; it does not contradict it. Glasses obscure the orbital rim; they do not change it. When a feature is occluded, drop it from the comparison and weigh the features you CAN see. Never lower same_person because a feature was hidden — if too many high-value features are hidden to judge at all, that is the 50-79 uncertain band (a human looks), not a low score.

AGEING CHANGES SOFT TISSUE, NOT SKULL. Over 10-25 years expect: heavier or hollower cheeks, jowling and a softer jawline, deeper nasolabial folds, thinner lips, a slightly broader and droopier nasal tip, hooding of the upper eyelid, receded or greyed hair, and a generally heavier or thinner face. NONE of these are evidence of a different person. What does NOT change: the ratios in the ranked list above. A South African green ID book is frequently 10-25 years old and its photo may be small, faded, low-contrast or monochrome — a genuine holder will look substantially older and heavier than it. That alone is NOT a mismatch and must not be scored as one.

Smart ID cards carry holographic overlays that cause glare, banding and colour shifts across the printed photo; judge through the glare rather than treating it as a different face.

Where an "official record photo" is supplied it is the authoritative likeness: it comes from the government's own record rather than from the card the applicant is holding, and it is usually far more recent and better quality than a green-book photo. When the official record photo and the document photo disagree, trust the official record photo for WHO the person is, and treat the document-photo difference as a question about the DOCUMENT (age, wear, or possible tampering) — report that through the document scores and issues, not by lowering same_person_vs_ha_photo.

Judging selfie_live_capture — score SPOOF ARTEFACTS, not sharpness. Red flags are screen re-shoots (moiré, pixel grid, monitor bezels, backlight glow), a photograph of a printed photograph (paper texture, uniform print grain, visible edges), and obvious digital editing. A genuinely live capture that happens to be blurry, dim or grainy is STILL a live capture and must score high on this gate. Do not punish a bad camera.

Output ONLY a single valid JSON object. The first character of your reply MUST be the literal '{'. No markdown fences, no commentary. Schema:
{
  "face_match": { "same_person": 0-100, "selfie_live_capture": 0-100, "document_photo_visible": 0-100, "same_person_vs_ha_photo": 0-100 (ONLY when an official record photo was provided), "issues": ["..."] },
  "document": { "looks_genuine_sa_id": 0-100, "document_type": "SMART_ID_CARD"|"GREEN_BOOK"|"OTHER"|null, "extracted_id_number": "13 digits or null", "extracted_surname": "string or null", "extracted_names": "string or null", "extracted_dob": "YYYY-MM-DD or null", "legibility": 0-100, "issues": ["..."] },
  "overall_confidence": 0-100,
  "recommendation": "APPROVE"|"ADMIN_REVIEW"|"REJECT",
  "recommendation_reason": "one sentence"
}`;

/**
 * Best-of-3 consensus for borderline scans.
 *
 * The obvious implementation — call the same prompt three times — is worth
 * nothing here, because temperature is 0 and the model is therefore
 * deterministic: three identical requests return three identical answers at
 * three times the cost. Self-consistency normally buys its diversity with a
 * non-zero temperature, but that would surrender the reproducibility the
 * temperature-0 fix exists to provide, and identity verdicts must be
 * explicable after the fact ("re-run it and you get the same answer").
 *
 * So diversity comes from the ANALYSIS being different rather than the
 * sampling being random. Each lens is a distinct, deterministic way of
 * approaching the same evidence:
 *
 *   BASELINE   — the standard holistic scan.
 *   SKEPTICAL  — actively hunts for reasons this is NOT the same person.
 *   CHARITABLE — actively hunts for innocent explanations of differences.
 *
 * The skeptical and charitable lenses are deliberately biased in OPPOSITE
 * directions and are used in a MEDIAN of three, never a mean. The median of
 * {lean-strict, neutral, lean-lenient} discards whichever extreme is
 * furthest out, so the pair cancel rather than compound — while a lone
 * outlier from any one lens can no longer decide the verdict on its own.
 * Balanced-and-opposed is the point; three sympathetic lenses would just
 * shift the whole distribution.
 *
 * The whole thing stays deterministic: same images in, same three lenses,
 * same median out.
 */
type Lens = 'BASELINE' | 'SKEPTICAL' | 'CHARITABLE';

const LENS_INSTRUCTION: Record<Lens, string> = {
  BASELINE: '',
  SKEPTICAL: `
ADDITIONAL INSTRUCTION FOR THIS PASS — adversarial review. Before scoring, actively look for evidence that the selfie and the document photo are DIFFERENT people, and for evidence the document or selfie has been manipulated. Check the facial geometry that cosmetic change cannot alter: inter-pupillary distance relative to face width, nose bridge width and profile, philtrum length, jaw and chin outline, ear position and shape where visible. State any genuine discrepancies in the issues array. Then score honestly on what you actually found — if the adversarial reading turns up nothing real, say so and score accordingly. Do NOT invent doubt.`,
  CHARITABLE: `
ADDITIONAL INSTRUCTION FOR THIS PASS — benefit-of-the-doubt review. Before scoring, assume this is an honest applicant and test whether every apparent difference has an innocent explanation: an ID photo taken 10-25 years ago, weight change, a different hairstyle or facial hair, glasses on or off, harsh or coloured lighting, camera lens distortion, low resolution, holographic glare across a smart-card photo. Then score honestly on what remains — if a real, structural mismatch survives every innocent explanation, score it low. Do NOT excuse a genuine mismatch.`,
};

/**
 * A scan is borderline when any gate sits near a decision boundary, so a
 * single reading is deciding something on a knife-edge. Covers all three
 * bad outcomes: an UNDER_REVIEW that costs an admin a look, a REJECTED at
 * 48 that refuses an honest seller, and a VERIFIED at 71 that lets someone
 * through on one opinion.
 */
const BORDERLINE_MARGIN = 10;

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
    // 60s timeout / 1 retry — never hold the KYC request open for the
    // SDK's 10-min default on a hung call (audit fix 2026-07-20).
    this.client = key
      ? new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 })
      : null;
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
  async scan(
    input: KycScanInput,
    lens: Lens = 'BASELINE',
  ): Promise<KycClaudeFindings> {
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
      ...(typeof input.subjectAgeYears === 'number'
        ? [
            {
              type: 'text' as const,
              text: `Context: the holder of this ID number is ${input.subjectAgeYears} years old today (derived from the ID number itself, not from the document image). A South African green ID book is typically issued at 16 and never reissued, so if this is a green book the photo may be up to ${Math.max(0, input.subjectAgeYears - 16)} years old. A smart ID card is usually more recent. Expect the selfie to show that much ageing, and weigh the comparison accordingly.`,
            },
          ]
        : []),
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
      // temperature 0 — this was previously unset, so it defaulted to 1.0 and
      // the SAME selfie + ID pair could score 68 on one run and 74 on the
      // next. With hard cut-offs at 50 and 70 that sampling noise alone
      // flipped people between VERIFIED, UNDER_REVIEW and REJECTED: a seller
      // who retried got a different answer, and admins saw review items that
      // were nothing but variance. Identity decisions must be reproducible —
      // the same evidence has to give the same verdict every time, including
      // when we re-run a scan to explain a decision afterwards.
      temperature: 0,
      system: SYSTEM_PROMPT + LENS_INSTRUCTION[lens],
      messages: [{ role: 'user', content: userContent as never }],
    });

    const block = msg.content.find((b) => b.type === 'text');
    const raw = (block as { text?: string } | undefined)?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude KYC did not return JSON');
    return JSON.parse(match[0]) as KycClaudeFindings;
  }

  /**
   * Run the baseline scan, and when it lands near a decision boundary,
   * re-read the same evidence through the skeptical and charitable lenses
   * and take the per-gate MEDIAN.
   *
   * Clear-cut cases (the large majority) cost exactly one call, as before.
   * Only knife-edge cases pay for three, which is where the extra reading
   * actually changes anything.
   *
   * The two extra lenses run CONCURRENTLY, so a borderline scan costs about
   * two calls' latency rather than three — a seller is staring at a spinner
   * while this happens.
   *
   * Failure of an extra lens is not fatal: whatever came back is merged, and
   * a single surviving sample degrades to exactly the old behaviour. A
   * consensus mechanism must never turn a working verification into a failed
   * one.
   */
  async scanWithConsensus(
    input: KycScanInput,
  ): Promise<{ findings: KycClaudeFindings; samples: number; borderline: boolean }> {
    const baseline = await this.scan(input, 'BASELINE');
    if (!this.isBorderline(baseline, input.mode)) {
      return { findings: baseline, samples: 1, borderline: false };
    }

    const extra = await Promise.allSettled([
      this.scan(input, 'SKEPTICAL'),
      this.scan(input, 'CHARITABLE'),
    ]);
    const ok = extra
      .filter(
        (r): r is PromiseFulfilledResult<KycClaudeFindings> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);
    extra
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach((r) =>
        this.logger.warn(
          `KYC consensus lens failed (continuing with fewer samples): ${String(r.reason)}`,
        ),
      );

    const all = [baseline, ...ok];
    if (all.length === 1) {
      return { findings: baseline, samples: 1, borderline: true };
    }
    return {
      findings: this.mergeFindings(all, baseline),
      samples: all.length,
      borderline: true,
    };
  }

  /** Any gate within BORDERLINE_MARGIN of either decision threshold. */
  isBorderline(
    findings: KycClaudeFindings,
    mode: 'standard' | 'anchored',
  ): boolean {
    const lo = AUTO_REJECT_CEILING - BORDERLINE_MARGIN; // 40
    const hi = AUTO_APPROVE_FLOOR + BORDERLINE_MARGIN; // 80
    const gates = [
      findings.face_match?.same_person,
      findings.face_match?.selfie_live_capture,
      findings.face_match?.document_photo_visible,
      findings.document?.looks_genuine_sa_id,
      findings.document?.legibility,
      ...(mode === 'anchored'
        ? [findings.face_match?.same_person_vs_ha_photo]
        : []),
    ];
    return gates.some((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= lo && n <= hi;
    });
  }

  /**
   * Per-gate median across samples; majority vote on the OCR fields.
   *
   * Median, not mean: it is the statistic that ignores one wild reading
   * entirely, which is the whole reason for taking three.
   *
   * The OCR fields get a majority vote rather than a median because they are
   * strings, and this genuinely improves them — two lenses agreeing on a
   * digit outvote one misreading it. That matters beyond the score, since
   * the extracted ID number and date of birth feed the server-side
   * cross-check against what the seller typed.
   */
  private mergeFindings(
    all: KycClaudeFindings[],
    baseline: KycClaudeFindings,
  ): KycClaudeFindings {
    const median = (vals: unknown[]): number => {
      const nums = vals
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      if (nums.length === 0) return 0;
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 === 1
        ? nums[mid]
        : Math.round((nums[mid - 1] + nums[mid]) / 2);
    };
    const majority = <T>(vals: T[], fallback: T): T => {
      const counts = new Map<string, { v: T; n: number }>();
      vals
        .filter((v) => v !== null && v !== undefined && v !== '')
        .forEach((v) => {
          const k = String(v);
          counts.set(k, { v, n: (counts.get(k)?.n ?? 0) + 1 });
        });
      // Only override the baseline when a value actually won a vote (n >= 2);
      // with three one-off readings there is no majority, so the deterministic
      // baseline stands rather than an arbitrary pick.
      let bestV: T | undefined;
      let bestN = 0;
      for (const c of counts.values()) {
        if (c.n > bestN) {
          bestN = c.n;
          bestV = c.v;
        }
      }
      return bestN >= 2 && bestV !== undefined ? bestV : fallback;
    };
    const unionIssues = (lists: (string[] | undefined)[]): string[] =>
      [
        ...new Set(
          lists
            .flatMap((l) => l ?? [])
            .filter((s) => typeof s === 'string' && s.trim().length > 0),
        ),
      ].slice(0, 8);

    const haScores = all
      .map((f) => f.face_match?.same_person_vs_ha_photo)
      .filter((v) => v !== undefined && v !== null);

    return {
      face_match: {
        same_person: median(all.map((f) => f.face_match?.same_person)),
        selfie_live_capture: median(
          all.map((f) => f.face_match?.selfie_live_capture),
        ),
        document_photo_visible: median(
          all.map((f) => f.face_match?.document_photo_visible),
        ),
        // Only carry the anchored score when at least one lens produced it —
        // synthesising a 0 here would fail the anchored gate on a standard
        // scan, and synthesising a pass would defeat the tier entirely.
        ...(haScores.length > 0
          ? { same_person_vs_ha_photo: median(haScores) }
          : {}),
        issues: unionIssues(all.map((f) => f.face_match?.issues)),
      },
      document: {
        looks_genuine_sa_id: median(
          all.map((f) => f.document?.looks_genuine_sa_id),
        ),
        document_type: majority(
          all.map((f) => f.document?.document_type),
          baseline.document?.document_type ?? null,
        ),
        extracted_id_number: majority(
          all.map((f) => f.document?.extracted_id_number),
          baseline.document?.extracted_id_number ?? null,
        ),
        extracted_surname: majority(
          all.map((f) => f.document?.extracted_surname),
          baseline.document?.extracted_surname ?? null,
        ),
        extracted_names: majority(
          all.map((f) => f.document?.extracted_names),
          baseline.document?.extracted_names ?? null,
        ),
        extracted_dob: majority(
          all.map((f) => f.document?.extracted_dob),
          baseline.document?.extracted_dob ?? null,
        ),
        legibility: median(all.map((f) => f.document?.legibility)),
        issues: unionIssues(all.map((f) => f.document?.issues)),
      },
      overall_confidence: median(all.map((f) => f.overall_confidence)),
      recommendation: majority(
        all.map((f) => f.recommendation),
        baseline.recommendation,
      ),
      recommendation_reason: `Consensus of ${all.length} readings: ${baseline.recommendation_reason}`,
    };
  }

  /**
   * Combine Claude's gate scores with the server-side cross-check.
   * Hard cross-check fails always REJECT; soft fails cap at UNDER_REVIEW.
   *
   * RETAKE exists because the gates measure two different things and they
   * must not share an outcome:
   *
   *   IDENTITY / AUTHENTICITY — is this the right person, is the document
   *   real, is the selfie a live capture rather than a screen re-shoot.
   *   Failing these is a real finding: reject it.
   *
   *   CAPTURE QUALITY — legibility and document_photo_visible. These say
   *   "the photograph is too dark / blurred / glared to read", which is a
   *   statement about the camera, not the person.
   *
   * Previously both sat in one list against one threshold, so an honest
   * seller photographing a worn green ID book in bad light was REJECTED:
   * they got a failure SMS, burned a strike toward the 3-strike admin
   * escalation, and an urgent review alert landed on an admin's desk — for
   * a photo nobody could read. That is the single largest source of
   * pointless work for both sides, and it teaches sellers the check is
   * broken rather than that their photo was dark.
   *
   * So quality is now assessed FIRST and answered with RETAKE, which the
   * caller maps to: no strike, no failure SMS, no admin alert, status left
   * PENDING, and specific guidance on what to fix. Deliberate consequence:
   * someone can submit unreadable images repeatedly without accumulating
   * strikes. That costs them nothing and gains them nothing — the payout
   * gate is `!== VERIFIED`, so a retake loop never approves anyone, and the
   * endpoint is already rate-limited. Being un-photographable is not fraud.
   *
   * Anti-spoofing is deliberately NOT treated as quality: selfie_live_capture
   * stays an identity gate, and the prompt tells the model to score it on
   * spoof artefacts (moiré, bezels, print grain) rather than sharpness, so a
   * blurry-but-genuine capture passes it while a crisp screen re-shoot fails.
   */
  statusFromFindings(
    findings: KycClaudeFindings,
    crossCheck: CrossCheckResult,
    mode: 'standard' | 'anchored',
  ): 'VERIFIED' | 'UNDER_REVIEW' | 'REJECTED' | 'RETAKE' {
    if (crossCheck.hardFails.length > 0) return 'REJECTED';

    // Coerce every gate to a finite number, defaulting to 0 — a string or
    // hallucinated score must fail the gate, never NaN past it (audit fix
    // 2026-07-20; `?? 0` alone let `"95"`-style strings through as NaN).
    const toGate = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const docPhotoMatch = toGate(findings.face_match?.same_person);
    const haPhotoMatch = toGate(findings.face_match?.same_person_vs_ha_photo);

    const identityGates: number[] = [
      toGate(findings.face_match?.selfie_live_capture),
      toGate(findings.document?.looks_genuine_sa_id),
    ];
    if (mode === 'anchored') {
      // The anchored gate is the whole point of the tier — a missing score
      // (model omitted it) counts as 0 so it can never silently pass.
      identityGates.push(haPhotoMatch);
    }

    // Which face comparison is allowed to REJECT on its own?
    //
    // In standard mode there is only one: the document photo. It carries the
    // decision because there is nothing else to go on.
    //
    // In anchored mode there are two, and they are NOT equal evidence. The
    // Home Affairs photo comes from the government's own record, keyed to the
    // ID number and pulled live — the applicant cannot influence it, and it is
    // usually far more recent than the card in their hand. The document photo
    // sits on a card they physically hold, and on a green book it can be
    // 25 years old, faded and monochrome.
    //
    // So a strong HA match with a weak document match does NOT mean "wrong
    // person" — Home Affairs has just confirmed the person. It means the
    // DOCUMENT photo disagrees, which is either ordinary ageing on an old
    // book or a tampered card. Those need a human, not an automatic refusal.
    //
    // Previously same_person sat in the reject list unconditionally, so
    // ha_photo=95 against the official record was overridden by
    // same_person=45 against a 25-year-old photo, and an honest seller with
    // an old green book was rejected outright. That is the age-gap failure
    // this split exists to fix.
    const docPhotoDecides =
      mode !== 'anchored' || haPhotoMatch < AUTO_APPROVE_FLOOR;
    if (docPhotoDecides) identityGates.push(docPhotoMatch);
    const qualityGates: number[] = [
      toGate(findings.document?.legibility),
      toGate(findings.face_match?.document_photo_visible),
    ];

    // A confident identity/authenticity failure outranks everything: a
    // screen re-shoot or a tampered document is a finding in its own right,
    // and must not be excused as "the photo was bad".
    if (identityGates.some((g) => g < AUTO_REJECT_CEILING)) return 'REJECTED';

    // Nothing is provably wrong, but we could not read the document well
    // enough to decide. Ask for a better photo instead of accusing anyone.
    if (qualityGates.some((g) => g < AUTO_REJECT_CEILING)) return 'RETAKE';

    if (crossCheck.softFails.length > 0) return 'UNDER_REVIEW';

    // Identity is established (HA photo strong) but the card's own photo
    // disagrees. Not auto-approvable: it could be a very old green book, or a
    // substituted photo on a real card. A human compares the three images.
    if (!docPhotoDecides && docPhotoMatch < AUTO_APPROVE_FLOOR) {
      return 'UNDER_REVIEW';
    }

    if (
      [...identityGates, ...qualityGates].every((g) => g >= AUTO_APPROVE_FLOOR)
    ) {
      return 'VERIFIED';
    }
    return 'UNDER_REVIEW';
  }

  /**
   * Seller-facing guidance for a RETAKE, derived from whichever quality gate
   * actually failed plus any issues the model listed. Deliberately concrete
   * ("too dark to read") — "verification failed" tells someone nothing about
   * what to do differently, which is how a retry loop starts.
   */
  retakeReason(findings: KycClaudeFindings): string {
    const n = (v: unknown): number => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };
    const parts: string[] = [];
    if (n(findings.document?.legibility) < AUTO_REJECT_CEILING) {
      parts.push('the details on your ID are not readable');
    }
    if (n(findings.face_match?.document_photo_visible) < AUTO_REJECT_CEILING) {
      parts.push('the photo on your ID is not clear enough');
    }
    const issues = [
      ...(findings.document?.issues ?? []),
      ...(findings.face_match?.issues ?? []),
    ]
      .filter((s) => typeof s === 'string' && s.trim().length > 0)
      .slice(0, 2);
    const what = parts.length > 0 ? parts.join(' and ') : 'we could not read your ID clearly';
    const hint = issues.length > 0 ? ` (${issues.join('; ')})` : '';
    return `We could not complete the check because ${what}${hint}. Please retake the photo in good light, with the whole card flat in frame and no glare or shadow across it — then try again.`;
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
