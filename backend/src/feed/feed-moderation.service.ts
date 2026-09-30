// ────────────────────────────────────────────────────────────────────
// FEED MODERATION — fail-closed classification for posts and comments.
//
// Operator decision: every post and comment is screened before publish, and
// anything the moderator cannot confidently clear rests in PENDING_MODERATION
// (never PUBLISHED). This is the same posture as listing moderation.
//
// Categories:
//   - promotional — members may NOT advertise anything, their own ALL Outdoor
//     listings included. Official @alloutdoor.co.za accounts are exempt from
//     THIS category only.
//   - illegal — ammunition/primers/propellant sales talk, threats, doxxing,
//     animal cruelty, anything unlawful. Applies to EVERYONE.
//   - graphic — FIELD (normal field photos) is allowed with warning/blur;
//     EXTREME (viscera, dismemberment, severe injury) is blurred + reviewed.
//
// ⚠️ RUNS ON DEEPSEEK (routed per-purpose in LlmService) AND ITS JSON IS NOT
// SCHEMA-ENFORCED. The model guarantees valid JSON only. This service validates
// the shape itself and fails closed on anything unexpected — an empty body,
// malformed JSON, or a field the model invented means PENDING_MODERATION.
// ────────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { GraphicTier, PostType } from '@prisma/client';
import { boundedImageUrl, boundedVideoUrl, IMAGE_EDGE, VIDEO_MODEL_EDGE } from '../common/image-url';
import { LlmService } from '../common/llm/llm.service';
import { LlmError, type JevQuestion, type LlmPart } from '../common/llm/llm.types';
import {
  conductQuestions,
  contactQuestions,
  JEV_CATEGORY_REASONS,
  jevLadder,
} from '../moderation/jev-battery';
import { FEED_MAX_IMAGES, POST_TYPE_LABELS } from './feed.types';

export const FEED_MODERATION_PURPOSE = 'feed.moderation';

/** Video moderation is a separate purpose so it routes to Gemini (video-capable). */
export const FEED_VIDEO_MODERATION_PURPOSE = 'feed.moderation.video';

/**
 * Model for video moderation. Gemini reads video; DeepSeek does not, and
 * LlmService pins this purpose to the Gemini provider. Default is the
 * operator's choice (Gemini 3.1 Flash-Lite), overridable without a deploy.
 * ⚠️ If a key does not serve this id, set `LLM_MODEL_VIDEO_MODERATION` to a
 * video-capable model (e.g. `gemini-3.5-flash-lite`).
 */
function videoModel(): string {
  return process.env.LLM_MODEL_VIDEO_MODERATION ?? 'gemini-3.1-flash-lite';
}

/** Gemini inline data tops out near 20 MB; larger clips fall back to the poster. */
const FEED_VIDEO_INLINE_MAX_BYTES = 18 * 1024 * 1024;

export interface FeedModerationInput {
  text: string;
  imageUrls: string[];
  /** The post's video (if any). Moderated by Gemini; falls back to the poster. */
  video?: { url: string; thumbnailUrl: string | null } | null;
  authorIsOfficial: boolean;
  postType?: PostType;
}

export type FeedModerationDecision = 'PUBLISH' | 'PENDING_MODERATION' | 'REJECT';

export interface FeedModerationVerdict {
  decision: FeedModerationDecision;
  graphicTier: GraphicTier;
  promoDetected: boolean;
  illegalDetected: boolean;
  otherViolation: boolean;
  reasons: string[];
}

const SYSTEM_PROMPT = `You are the content moderation classifier for ALL Outdoor, a South African outdoor and firearms community. You classify a POST — its text, any attached photos, and any attached video's PICTURE and on-screen text (the video's audio is not provided) — and return json.

POLICY — judge INTENT, not pixels alone:
- Incidental branding is FINE. A company name, logo, decal or phone number printed on a vehicle, trailer, tent, shirt or other equipment that happens to be in shot is NOT a violation on its own — this is normal in 4x4, overlanding and hunting content.
- What IS a violation is the POST using the platform to advertise, sell, or move a conversation off-platform.

Look for exactly these categories:
- promotional: the post itself is advertising, selling or self-promoting — shop/website/channel links, "DM me", "visit my store", "link in bio", a price offered for sale, or the author promoting their OWN ALL Outdoor listing. Incidental branding on equipment is NOT promotional.
- contact: the author shares or invites contact details to take a deal off-platform — a number/email/handle given for that purpose, or on-screen text asking to be contacted. A business number merely visible on a vehicle is NOT this unless the post is soliciting contact.
- illegal: offers to sell live ammunition, primers or propellant; threats or harassment; doxxing (publishing someone's private details); animal cruelty; anything unlawful under South African law.
- graphic: "FIELD" is normal hunting/fishing field content (blood on a carcass or hide, field dressing) — ALLOWED behind a content warning. "EXTREME" is exposed viscera/guts, dismemberment, or a severely damaged head or body. A plain 4x4, camping or fishing clip is NONE.

Set the boolean fields true only when that category is present. Set graphicTier to "NONE", "FIELD" or "EXTREME".
Your answer must be json in exactly this shape (no prose, no markdown):
{"promoDetected":false,"illegalDetected":false,"otherViolation":false,"graphicTier":"NONE","reasons":[]}

Example: a lawful photo of a hunted buck with blood on the hide, no advertising:
{"promoDetected":false,"illegalDetected":false,"otherViolation":false,"graphicTier":"FIELD","reasons":["normal field photo"]}

Example: a lifted 4x4 with a company logo and a phone number on the door driving a course, with no sales pitch:
{"promoDetected":false,"illegalDetected":false,"otherViolation":false,"graphicTier":"NONE","reasons":[]}

Example: "Selling my .308, DM me for price and my number":
{"promoDetected":true,"illegalDetected":false,"otherViolation":false,"graphicTier":"NONE","reasons":["sale promotion","contact request"]}`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    promoDetected: { type: 'boolean' },
    illegalDetected: { type: 'boolean' },
    otherViolation: { type: 'boolean' },
    graphicTier: { type: 'string', enum: ['NONE', 'FIELD', 'EXTREME'] },
    reasons: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'promoDetected',
    'illegalDetected',
    'otherViolation',
    'graphicTier',
  ],
} as const;

// ─── Image axis (DeepSeek Flash) ────────────────────────────────────
//
// ⚠️ JEV CANNOT SEE, so the photo side of a post is a separate DeepSeek
// call. It carries the same categories as the text battery PLUS the graphic
// tier, which is a purely visual judgement. Its JSON is not schema-enforced
// either, and moderateFeedImages fails closed to PENDING on any doubt.
const FEED_IMAGE_SYSTEM = `You are the photo screener for the ALL Outdoor community feed, a South African outdoor and firearms community. You see the attached photos and return json. Judge INTENT, not pixels alone: incidental manufacturer branding or a business number printed on a vehicle/equipment is normal and NOT a violation.

Return exactly these fields:
{"promoDetected":bool,"illegalDetected":bool,"otherViolation":bool,"graphicTier":"NONE"|"FIELD"|"EXTREME","unsure":bool,"reasons":["..."]}

- promoDetected: the photos advertise, sell or self-promote a shop/channel/service (a price offered, a sale pitch, "DM me" text burned into the image). Incidental branding is NOT this.
- illegalDetected: live ammunition/primers/propellant offered for sale, threats, doxxing, animal cruelty, anything unlawful.
- otherViolation: contact details in the image (phone/email/handle/URL/QR code) or a street address / storefront that identifies a person.
- graphicTier: NONE = ordinary content; FIELD = normal hunting/fishing field content (blood on a carcass/hide, field dressing) which is allowed behind a content warning; EXTREME = exposed viscera/guts, dismemberment, or a severely damaged body, which is held for a human.
Set unsure=true if you genuinely cannot tell. No prose, no markdown.`;

/** The more severe of two graphic tiers. */
function maxGraphicTier(a: GraphicTier, b: GraphicTier): GraphicTier {
  const rank: Record<GraphicTier, number> = {
    [GraphicTier.NONE]: 0,
    [GraphicTier.FIELD]: 1,
    [GraphicTier.EXTREME]: 2,
  };
  return rank[b] > rank[a] ? b : a;
}

@Injectable()
export class FeedModerationService {
  private readonly logger = new Logger(FeedModerationService.name);

  constructor(private readonly llm: LlmService) {}

  async moderate(input: FeedModerationInput): Promise<FeedModerationVerdict> {
    const pending = (reasons: string[]): FeedModerationVerdict => ({
      decision: 'PENDING_MODERATION',
      graphicTier: GraphicTier.NONE,
      promoDetected: false,
      illegalDetected: false,
      otherViolation: false,
      reasons,
    });

    const { parts, videoAttached } = await this.buildParts(input);

    // ⚠️ TEXT + IMAGES NOW SPLIT: Jev reads the text, DeepSeek Flash reads the
    // photos (operator decision 2026-10-01). VIDEO KEEPS THE SINGLE GEMINI
    // CALL — DeepSeek cannot take video and Jev cannot see anything, so a
    // clip-bearing post has no split to make and is moderated whole.
    // FEED_MOD_ENGINE=legacy restores the single-call moderator (rollback
    // lever, matching MOD_ENGINE on the listing side).
    if (!videoAttached && process.env.FEED_MOD_ENGINE !== 'legacy') {
      return this.moderateSplit(input, parts);
    }

    const purpose = FEED_VIDEO_MODERATION_PURPOSE;

    if (!this.llm.isConfiguredFor(purpose)) {
      // Fail closed: no key means a human must look, not that it publishes.
      return pending(['moderation_unavailable']);
    }

    const mediaExpected = input.imageUrls.length > 0 || !!input.video;
    const mediaReadable = parts.some(
      (p) => p.type === 'image' || p.type === 'video',
    );
    if (mediaExpected && !mediaReadable) {
      return pending(['images_unreadable']);
    }

    let raw: string;
    try {
      const res = await this.llm.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: parts }],
        maxTokens: 400,
        temperature: 0,
        thinking: { budgetTokens: 0 },
        json: { schema: RESPONSE_SCHEMA as unknown as Record<string, unknown> },
        purpose,
        ...(videoAttached ? { model: videoModel() } : {}),
        timeoutMs: 30_000,
      });
      raw = res.text;
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'unknown';
      this.logger.warn(`feed moderation call failed (${code}) — holding for review`);
      return pending([`moderation_error:${code}`]);
    }

    let parsed: unknown;
    try {
      parsed = this.parseJson(raw);
    } catch {
      this.logger.warn('feed moderation returned unparseable JSON — holding for review');
      return pending(['moderation_shape_invalid']);
    }

    const verdict = this.validate(parsed);
    if (!verdict) {
      this.logger.warn('feed moderation returned an unexpected shape — holding for review');
      return pending(['moderation_shape_invalid']);
    }

    return this.decide(verdict, input.authorIsOfficial);
  }

  // ─── The split path: Jev text + DeepSeek images ────────────────────

  private async moderateSplit(
    input: FeedModerationInput,
    parts: LlmPart[],
  ): Promise<FeedModerationVerdict> {
    const pendingVerdict = (reasons: string[]): FeedModerationVerdict => ({
      decision: 'PENDING_MODERATION',
      graphicTier: GraphicTier.NONE,
      promoDetected: false,
      illegalDetected: false,
      otherViolation: false,
      reasons,
    });

    const imageParts = parts.filter((p): p is Extract<LlmPart, { type: 'image' }> => p.type === 'image');
    // ⚠️ A VIDEO THAT COULD NOT BE READ AND HAS NO POSTER ARRIVES HERE AS NO
    // PARTS AT ALL — `videoAttached` is false, but the post still expected
    // media. Hold it rather than screening the text alone and publishing.
    const mediaExpected = input.imageUrls.length > 0 || !!input.video;
    if (mediaExpected && imageParts.length === 0) {
      return pendingVerdict(['images_unreadable']);
    }
    if (!process.env.JEV_API_KEY) {
      return pendingVerdict(['moderation_unavailable']);
    }

    const [text, images] = await Promise.all([
      this.moderateFeedText(input),
      this.moderateFeedImages(imageParts, input),
    ]);

    const promoDetected = text.promoDetected || images.promoDetected;
    const illegalDetected = text.illegalDetected || images.illegalDetected;
    const otherViolation = text.otherViolation || images.otherViolation;
    const graphicTier = maxGraphicTier(text.graphicTier, images.graphicTier);
    const reasons = [...text.reasons, ...images.reasons].slice(0, 10);
    const uncertain = text.uncertain || images.uncertain;

    const verdict = this.decide(
      { promoDetected, illegalDetected, otherViolation, graphicTier, reasons },
      input.authorIsOfficial,
    );
    // A confident REJECT stands. Otherwise, any uncertainty on either axis
    // holds for a human rather than publishing.
    if (verdict.decision !== 'REJECT' && uncertain) {
      return pendingVerdict([...reasons, 'moderation_unsure']);
    }
    return verdict;
  }

  /** Text axis — the Jev battery (contact) plus the feed policy nouls. */
  private async moderateFeedText(input: FeedModerationInput): Promise<{
    promoDetected: boolean;
    illegalDetected: boolean;
    otherViolation: boolean;
    graphicTier: GraphicTier;
    reasons: string[];
    uncertain: boolean;
  }> {
    const questions: Record<string, JevQuestion> = {
      ...contactQuestions(),
      ...conductQuestions(),
      promotional: {
        type: 'noul',
        instructions:
          'Is this post advertising, selling or self-promoting — a shop/website/channel link, "DM me", "visit my store", "link in bio", a price offered for sale, or the author promoting their own ALL Outdoor listing? Incidental branding on equipment in the text (a brand name, a model) is NOT this.',
        criteria: {
          true: 'The post is itself a promotion or solicitation',
          false: 'Ordinary discussion or a product mention',
        },
      },
      illegal: {
        type: 'noul',
        instructions:
          'Does this post offer to sell live ammunition, primers or propellant; threaten or harass someone; publish someone else\u2019s private details (doxxing); depict animal cruelty; or otherwise describe something unlawful under South African law?',
        criteria: {
          true: 'Unlawful offer, threat, doxxing or cruelty is present',
          false: 'Nothing unlawful is described',
        },
      },
      other_violation: {
        type: 'noul',
        instructions:
          'Does this post break the community rules in some other way — hate speech, sexual content, or content that is plainly not allowed on a family-oriented outdoor community? Keep this narrow: disagreement, strong opinion and hunting content are NOT this.',
        criteria: {
          true: 'A clear additional community-rules violation',
          false: 'No other violation',
        },
      },
    };

    const reasons: Record<string, string> = {
      ...JEV_CATEGORY_REASONS,
      promotional:
        'Advertising is not allowed in the community feed — including your own ALL Outdoor listings.',
      illegal:
        'This post breaks the community rules (unlawful offer, threat or similar) and cannot be published.',
      other_violation:
        'This post breaks the community rules and cannot be published.',
    };

    const verdict = await jevLadder(this.llm, {
      state:
        `Post type: ${input.postType ? POST_TYPE_LABELS[input.postType] : 'General'}\n` +
        `Author type: ${input.authorIsOfficial ? 'Official staff account' : 'Member'}\n\n` +
        input.text,
      questions,
      reasons,
      purpose: 'moderation.feed.text',
      onError: 'review',
    });

    const s = verdict.scores;
    const contactCats = [
      'contact_details',
      'social_handles',
      'real_name',
      'physical_address',
      'offplatform_coordination',
      'third_party_advertising',
      'abuse',
    ];
    const blockedContact = contactCats.some((c) => (s[c] ?? 0) >= 0.8);
    return {
      promoDetected:
        (s.promotional ?? 0) >= 0.8 ||
        (verdict.category === 'promotional' && verdict.decision === 'BLOCK'),
      illegalDetected:
        (s.illegal ?? 0) >= 0.8 ||
        (verdict.category === 'illegal' && verdict.decision === 'BLOCK'),
      otherViolation:
        (s.other_violation ?? 0) >= 0.8 ||
        blockedContact ||
        (verdict.decision === 'BLOCK' &&
          verdict.category !== null &&
          verdict.category !== 'promotional' &&
          verdict.category !== 'illegal'),
      graphicTier: GraphicTier.NONE,
      reasons: verdict.reason ? [verdict.reason] : [],
      uncertain: verdict.decision === 'REVIEW',
    };
  }

  /** Image axis — DeepSeek Flash reads the photos. */
  private async moderateFeedImages(
    imageParts: Extract<LlmPart, { type: 'image' }>[],
    input: FeedModerationInput,
  ): Promise<{
    promoDetected: boolean;
    illegalDetected: boolean;
    otherViolation: boolean;
    graphicTier: GraphicTier;
    reasons: string[];
    uncertain: boolean;
  }> {
    const clean = {
      promoDetected: false,
      illegalDetected: false,
      otherViolation: false,
      graphicTier: GraphicTier.NONE,
      reasons: [] as string[],
      uncertain: false,
    };
    if (imageParts.length === 0) return clean;

    const content: LlmPart[] = [
      { type: 'text', text: 'Screen the attached photos. Return the JSON verdict only.' },
      ...imageParts,
    ];

    let raw = '';
    try {
      const msg = await this.llm.complete({
        system: FEED_IMAGE_SYSTEM,
        messages: [{ role: 'user', content }],
        maxTokens: 500,
        temperature: 0,
        json: {},
        thinking: { budgetTokens: 0 },
        purpose: 'moderation.feed.images',
        model: 'deepseek-flash',
        timeoutMs: 30_000,
      });
      raw = msg.text;
    } catch {
      // No image verdict = no publish decision. Fail closed.
      return { ...clean, uncertain: true, reasons: ['images_unreadable'] };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(this.extractJson(raw)) as Record<string, unknown>;
    } catch {
      return { ...clean, uncertain: true, reasons: ['moderation_shape_invalid'] };
    }

    const tier =
      parsed.graphicTier === 'FIELD'
        ? GraphicTier.FIELD
        : parsed.graphicTier === 'EXTREME'
          ? GraphicTier.EXTREME
          : GraphicTier.NONE;
    return {
      promoDetected: parsed.promoDetected === true,
      illegalDetected: parsed.illegalDetected === true,
      otherViolation: parsed.otherViolation === true,
      graphicTier: tier,
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === 'string').slice(0, 8)
        : [],
      uncertain: parsed.unsure === true,
    };
  }

  /** Slice a balanced JSON object out of a reply that may carry prose. */
  private extractJson(text: string): string {
    const trimmed = (text ?? '').trim();
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
    return trimmed;
  }

  /**
   * Derive the decision from the structured flags. Deterministic and testable:
   * illegal always rejects, promotional rejects only non-official authors,
   * extreme graphic content is held for a human, everything else publishes.
   */
  private decide(
    raw: {
      promoDetected: boolean;
      illegalDetected: boolean;
      otherViolation: boolean;
      graphicTier: GraphicTier;
      reasons: string[];
    },
    authorIsOfficial: boolean,
  ): FeedModerationVerdict {
    let decision: FeedModerationDecision = 'PUBLISH';
    if (raw.illegalDetected || raw.otherViolation) {
      decision = 'REJECT';
    } else if (raw.promoDetected && !authorIsOfficial) {
      decision = 'REJECT';
    } else if (raw.graphicTier === GraphicTier.EXTREME) {
      decision = 'PENDING_MODERATION';
    }
    return { decision, ...raw };
  }

  private parseJson(text: string): unknown {
    const trimmed = (text ?? '').trim();
    // Defensive: strip a markdown fence if one appears despite json mode.
    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const firstBrace = unfenced.indexOf('{');
    const lastBrace = unfenced.lastIndexOf('}');
    const candidate =
      firstBrace >= 0 && lastBrace > firstBrace
        ? unfenced.slice(firstBrace, lastBrace + 1)
        : unfenced;
    return JSON.parse(candidate);
  }

  private validate(raw: unknown):
    | {
        promoDetected: boolean;
        illegalDetected: boolean;
        otherViolation: boolean;
        graphicTier: GraphicTier;
        reasons: string[];
      }
    | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (
      typeof o.promoDetected !== 'boolean' ||
      typeof o.illegalDetected !== 'boolean' ||
      typeof o.otherViolation !== 'boolean'
    ) {
      return null;
    }
    const tier = o.graphicTier;
    if (
      tier !== 'NONE' &&
      tier !== 'FIELD' &&
      tier !== 'EXTREME'
    ) {
      return null;
    }
    const reasons = Array.isArray(o.reasons)
      ? o.reasons.filter((r): r is string => typeof r === 'string').slice(0, 10)
      : [];
    return {
      promoDetected: o.promoDetected,
      illegalDetected: o.illegalDetected,
      otherViolation: o.otherViolation,
      graphicTier: tier as GraphicTier,
      reasons,
    };
  }

  private async buildParts(
    input: FeedModerationInput,
  ): Promise<{ parts: LlmPart[]; videoAttached: boolean }> {
    const header =
      `Post type: ${input.postType ? POST_TYPE_LABELS[input.postType] : 'General'}\n` +
      `Author type: ${input.authorIsOfficial ? 'Official staff account' : 'Member'}\n\n` +
      input.text;
    const parts: LlmPart[] = [{ type: 'text', text: header }];
    const urls = input.imageUrls.slice(0, FEED_MAX_IMAGES);
    for (const url of urls) {
      const image = await this.fetchImage(url);
      if (image) parts.push(image);
    }

    let videoAttached = false;
    if (input.video) {
      const video = await this.fetchVideo(input.video.url);
      if (video) {
        parts.push({ type: 'video', ...video });
        videoAttached = true;
      } else if (input.video.thumbnailUrl) {
        // The clip could not be inlined (too large / unfetchable), so screen
        // its poster frame instead of publishing unmoderated.
        const poster = await this.fetchImage(input.video.thumbnailUrl);
        if (poster) parts.push(poster);
      }
    }

    return { parts, videoAttached };
  }

  private async fetchImage(url: string): Promise<LlmPart | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(boundedImageUrl(url, IMAGE_EDGE.photo), {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > 5 * 1024 * 1024) {
        return null;
      }
      const mimeType = contentType.split(';')[0] || 'image/jpeg';
      return { type: 'image', mimeType, data: buffer.toString('base64') };
    } catch {
      return null;
    }
  }

  /**
   * Fetch a video for Gemini. The original is transcoded down by Cloudinary
   * first (720p, then 480p) so it fits the inline-data cap; something too
   * large to inline returns null and the caller falls back to the poster.
   */
  private async fetchVideo(
    url: string,
  ): Promise<{ mimeType: string; data: string } | null> {
    for (const edge of [VIDEO_MODEL_EDGE, 480]) {
      const got = await this.tryFetchVideo(boundedVideoUrl(url, edge));
      if (got) return got;
    }
    return null;
  }

  private async tryFetchVideo(
    url: string,
  ): Promise<{ mimeType: string; data: string } | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? 'video/mp4';
      if (!contentType.startsWith('video/')) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (
        buffer.byteLength === 0 ||
        buffer.byteLength > FEED_VIDEO_INLINE_MAX_BYTES
      ) {
        return null;
      }
      const mimeType = contentType.split(';')[0] || 'video/mp4';
      return { mimeType, data: buffer.toString('base64') };
    } catch {
      return null;
    }
  }
}
