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
// ⚠️ THE LIVE PATH IS A SPLIT: Jev answers typed questions for the text and
// for each photo; Gemini answers the clip. The pre-split single call — and its
// untyped JSON, validated below — stays behind FEED_MOD_ENGINE=legacy as the
// rollback lever. Every path fails closed: an empty body, malformed JSON, a
// missing answer or a field the model invented means PENDING_MODERATION.
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
import {
  evaluateFeedPhoto,
  feedPhotoQuestions,
  toJevPhotoAsset,
} from '../moderation/jev-image-battery';
import { FEED_MAX_IMAGES, POST_TYPE_LABELS } from './feed.types';

export const FEED_MODERATION_PURPOSE = 'feed.moderation';

/** Video moderation is a separate purpose so it routes to Gemini (video-capable). */
export const FEED_VIDEO_MODERATION_PURPOSE = 'feed.moderation.video';

/**
 * Model for video moderation. JEV has no video input, so the clip stays on
 * Gemini, pinned to that provider by LlmService. Default is the operator's
 * choice (Gemini 3.1 Flash-Lite), overridable without a deploy.
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

/** One axis's contribution to the final verdict. */
interface FeedAxisVerdict {
  promoDetected: boolean;
  illegalDetected: boolean;
  otherViolation: boolean;
  graphicTier: GraphicTier;
  reasons: string[];
  uncertain: boolean;
}

const SYSTEM_PROMPT = `You are the content moderation classifier for ALL Outdoor, a South African outdoor and firearms community. You classify a POST — its text, any attached photos, and any attached video's PICTURE and on-screen text (the video's audio is not provided) — and return json.

POLICY — judge INTENT, not pixels alone:
- Incidental branding is FINE. A company name, logo, decal or phone number printed on a vehicle, trailer, tent, shirt or other equipment that happens to be in shot is NOT a violation on its own — this is normal in 4x4, overlanding and hunting content.
- What IS a violation is the POST using the platform to advertise, sell, or move a conversation off-platform.

Look for exactly these categories:
- promotional: the post itself is advertising, selling or self-promoting — shop/website/channel links, "DM me", "visit my store", "link in bio", a price offered for sale, or the author promoting their OWN ALL Outdoor listing. Incidental branding on equipment is NOT promotional.
- contact: the author shares or invites contact details to take a deal off-platform — a number/email/handle given for that purpose, or on-screen text asking to be contacted. A business number merely visible on a vehicle is NOT this unless the post is soliciting contact.
- illegal: offers to sell live ammunition, primers or propellant; threats or harassment; doxxing (publishing someone's private details); animal cruelty; anything unlawful under South African law.
- sexual: FULL NUDITY, exposed genitalia, exposed buttocks, exposed female breasts, a sexual act or pornography — set otherViolation true. Swimwear is FINE: a bikini, swimming costume, sports bra, shirtless man or underwear worn as ordinary outdoor/beach/swimming attire is NOT this.
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
    const { parts, posterUsed } = await this.buildParts(input);

    // FEED_MOD_ENGINE=legacy restores the single-call moderator (rollback
    // lever, matching MOD_ENGINE on the listing side). The live path is the
    // split: Jev reads the text AND the photos, Gemini reads the clip.
    if (process.env.FEED_MOD_ENGINE === 'legacy') {
      return this.moderateWhole(input, parts);
    }
    return this.moderateSplit(input, parts, posterUsed);
  }

  /** The pre-split single call, kept only as the rollback lever. */
  private async moderateWhole(
    input: FeedModerationInput,
    parts: LlmPart[],
  ): Promise<FeedModerationVerdict> {
    const purpose = FEED_VIDEO_MODERATION_PURPOSE;
    const videoAttached = parts.some((p) => p.type === 'video');

    if (!this.llm.isConfiguredFor(purpose)) {
      // Fail closed: no key means a human must look, not that it publishes.
      return this.pendingVerdict(['moderation_unavailable']);
    }

    const mediaExpected = input.imageUrls.length > 0 || !!input.video;
    const mediaReadable = parts.some(
      (p) => p.type === 'image' || p.type === 'video',
    );
    if (mediaExpected && !mediaReadable) {
      return this.pendingVerdict(['images_unreadable']);
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
      return this.pendingVerdict([`moderation_error:${code}`]);
    }

    let parsed: unknown;
    try {
      parsed = this.parseJson(raw);
    } catch {
      this.logger.warn('feed moderation returned unparseable JSON — holding for review');
      return this.pendingVerdict(['moderation_shape_invalid']);
    }

    const verdict = this.validate(parsed);
    if (!verdict) {
      this.logger.warn('feed moderation returned an unexpected shape — holding for review');
      return this.pendingVerdict(['moderation_shape_invalid']);
    }

    return this.decide(verdict, input.authorIsOfficial);
  }

  // ─── The split path: Jev text + Jev photos, Gemini clip ─────────────

  private async moderateSplit(
    input: FeedModerationInput,
    parts: LlmPart[],
    posterUsed: boolean,
  ): Promise<FeedModerationVerdict> {
    const imageParts = parts.filter(
      (p): p is Extract<LlmPart, { type: 'image' }> => p.type === 'image',
    );
    const videoPart = parts.find(
      (p): p is Extract<LlmPart, { type: 'video' }> => p.type === 'video',
    );

    // ⚠️ A VIDEO THAT COULD NOT BE READ AND HAS NO POSTER ARRIVES HERE AS NO
    // MEDIA PART AT ALL — `input.video` is set, so the post still expected
    // media. Hold it rather than screening the text alone and publishing.
    const mediaExpected = input.imageUrls.length > 0 || !!input.video;
    if (mediaExpected && imageParts.length === 0 && !videoPart) {
      return this.pendingVerdict(['images_unreadable']);
    }

    // ⚠️ A FAILED CLIP DOES NOT BECOME A PUBLISHED POST JUST BECAUSE THE POST
    // ALSO HAS PHOTOS. The photos can be screened, but the clip was not; the
    // only fallback that counts is a poster frame, which arrives as an image.
    if (input.video && !videoPart && !posterUsed) {
      return this.pendingVerdict(['images_unreadable']);
    }

    // A photo-only post has no text to screen — don't spend a Jev call on an
    // empty string (operator decision 2026-10-09: media-only posts are valid).
    const textHasContent = (input.text ?? '').trim().length > 0;
    // A clip-only post has nothing for Jev to judge, so it must not be held
    // just because the Jev key is absent: Gemini alone can clear the clip.
    const needsJev = textHasContent || imageParts.length > 0;
    if (needsJev && !process.env.JEV_API_KEY) {
      return this.pendingVerdict(['moderation_unavailable']);
    }

    const [text, images, video] = await Promise.all([
      textHasContent
        ? this.moderateFeedText(input)
        : Promise.resolve(this.cleanAxis()),
      this.moderateFeedImages(imageParts, input),
      videoPart
        ? this.moderateFeedVideo(videoPart, input)
        : Promise.resolve(this.cleanAxis()),
    ]);

    const promoDetected =
      text.promoDetected || images.promoDetected || video.promoDetected;
    const illegalDetected =
      text.illegalDetected || images.illegalDetected || video.illegalDetected;
    const otherViolation =
      text.otherViolation || images.otherViolation || video.otherViolation;
    const graphicTier = maxGraphicTier(
      maxGraphicTier(text.graphicTier, images.graphicTier),
      video.graphicTier,
    );
    const reasons = [...text.reasons, ...images.reasons, ...video.reasons].slice(
      0,
      10,
    );
    const uncertain = text.uncertain || images.uncertain || video.uncertain;

    const verdict = this.decide(
      { promoDetected, illegalDetected, otherViolation, graphicTier, reasons },
      input.authorIsOfficial,
    );
    // A confident REJECT stands. Otherwise, any uncertainty on any axis holds
    // for a human rather than publishing.
    if (verdict.decision !== 'REJECT' && uncertain) {
      return this.pendingVerdict([...reasons, 'moderation_unsure']);
    }
    return verdict;
  }

  private pendingVerdict(reasons: string[]): FeedModerationVerdict {
    return {
      decision: 'PENDING_MODERATION',
      graphicTier: GraphicTier.NONE,
      promoDetected: false,
      illegalDetected: false,
      otherViolation: false,
      reasons,
    };
  }

  private cleanAxis(): FeedAxisVerdict {
    return {
      promoDetected: false,
      illegalDetected: false,
      otherViolation: false,
      graphicTier: GraphicTier.NONE,
      reasons: [],
      uncertain: false,
    };
  }

  /** Text axis — the Jev battery (contact) plus the feed policy nouls. */
  private async moderateFeedText(
    input: FeedModerationInput,
  ): Promise<FeedAxisVerdict> {
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
          'Does this post break the community rules in some other way — hate speech, a threat, or content that is plainly not allowed on a family-oriented outdoor community? Keep this narrow: disagreement, strong opinion and hunting content are NOT this. Sexual content is asked separately.',
        criteria: {
          true: 'A clear additional community-rules violation',
          false: 'No other violation',
        },
      },
      sexual_explicit: {
        type: 'noul',
        instructions:
          'Does this text explicitly describe, request or promote sexual content — a sexual act, pornography, genitalia or nudity in a sexual context? A medical or technical mention, an ordinary clothing/swimwear reference, and a joke without explicit description are NOT this.',
        criteria: {
          true: 'Explicit sexual content is described or requested',
          false: 'No explicit sexual content',
        },
      },
      bad_language: {
        type: 'noul',
        instructions:
          'Does this text contain swearing or coarse bad language (not abuse or a threat directed at a person — that is a separate question)? Mild exclamations such as "damn" or "hell" are NOT this. The words are masked rather than blocked, so judge the language itself.',
        criteria: {
          true: 'Swearing or coarse profanity is present',
          false: 'No coarse profanity',
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
      sexual_explicit:
        'Sexual content is not allowed in the community feed. Full nudity and explicit sexual content are blocked.',
      bad_language: 'Bad language is masked in the community feed.',
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
      // Bad language is masked in the feed, not blocked.
      nonBlocking: ['bad_language'],
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
        (s.sexual_explicit ?? 0) >= 0.8 ||
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

  // ─── Image axis — Jev ──────────────────────────────────────────────
  //
  // One decide call per photo. JEV is the photo judge now; Gemini keeps the
  // clip. The single-asset path is the one document filing already uses, and
  // it keeps the per-photo answers unambiguous. Any unusable photo fails the
  // whole axis closed — a partially screened post is not a screened post.

  private async moderateFeedImages(
    imageParts: Extract<LlmPart, { type: 'image' }>[],
    input: FeedModerationInput,
  ): Promise<FeedAxisVerdict> {
    if (imageParts.length === 0) return this.cleanAxis();

    const results = await Promise.all(
      imageParts.map(async (part, index) => {
        try {
          const asset = await toJevPhotoAsset(part);
          const res = await this.llm.decide({
            state: {
              photo: 'photo',
              postType: input.postType
                ? POST_TYPE_LABELS[input.postType]
                : 'General',
              authorType: input.authorIsOfficial
                ? 'Official staff account'
                : 'Member',
            },
            questions: feedPhotoQuestions(),
            assets: { photo: asset },
            purpose: 'moderation.feed.images',
            timeoutMs: 30_000,
          });
          return evaluateFeedPhoto(res.answers);
        } catch (err) {
          const code = err instanceof LlmError ? err.code : 'unknown';
          this.logger.warn(
            `feed photo ${index + 1} screening failed (${code}) — holding for review`,
          );
          return null;
        }
      }),
    );

    if (results.some((result) => result === null)) {
      return {
        ...this.cleanAxis(),
        uncertain: true,
        reasons: ['images_unreadable'],
      };
    }

    let promoDetected = false;
    let illegalDetected = false;
    let otherViolation = false;
    let graphicTier: GraphicTier = GraphicTier.NONE;
    let uncertain = false;
    const reasons: string[] = [];

    for (const result of results) {
      const r = result!;
      promoDetected ||= r.promoDetected;
      illegalDetected ||= r.illegalDetected;
      otherViolation ||= r.otherViolation || r.sexualExplicit;
      graphicTier = maxGraphicTier(graphicTier, r.graphicTier as GraphicTier);
      uncertain ||= r.uncertain;

      if (r.promoDetected) {
        reasons.push('a photo advertises a shop, channel or service');
      }
      if (r.illegalDetected) {
        reasons.push('a photo contains prohibited or unlawful content');
      }
      if (r.otherViolation) {
        reasons.push('a photo shows contact details or another rule breach');
      }
      if (r.sexualExplicit) {
        reasons.push(
          'a photo shows full nudity or explicit sexual content',
        );
      }
      if (r.graphicTier === 'EXTREME') {
        reasons.push('a photo shows extreme graphic content');
      } else if (r.graphicTier === 'FIELD') {
        reasons.push('a photo shows field content');
      }
    }

    return {
      promoDetected,
      illegalDetected,
      otherViolation,
      graphicTier,
      reasons: Array.from(new Set(reasons)).slice(0, 8),
      uncertain,
    };
  }

  // ─── Video axis — Gemini ───────────────────────────────────────────
  //
  // The clip is the only thing Gemini sees. The caption goes with it for
  // context, but the still photos stay on JEV. A clip that cannot be read, or
  // a Gemini failure, holds the post.

  private async moderateFeedVideo(
    videoPart: Extract<LlmPart, { type: 'video' }>,
    input: FeedModerationInput,
  ): Promise<FeedAxisVerdict> {
    if (!this.llm.isConfiguredFor(FEED_VIDEO_MODERATION_PURPOSE)) {
      return {
        ...this.cleanAxis(),
        uncertain: true,
        reasons: ['moderation_unavailable'],
      };
    }

    const content: LlmPart[] = [
      {
        type: 'text',
        text:
          `Post caption:\n${(input.text ?? '').trim() || '(none)'}\n\n` +
          "Judge the attached clip. The post's still photos are screened " +
          'separately; judge the clip and the caption.',
      },
      videoPart,
    ];

    let raw: string;
    try {
      const res = await this.llm.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        maxTokens: 400,
        temperature: 0,
        thinking: { budgetTokens: 0 },
        json: { schema: RESPONSE_SCHEMA as unknown as Record<string, unknown> },
        purpose: FEED_VIDEO_MODERATION_PURPOSE,
        model: videoModel(),
        timeoutMs: 45_000,
      });
      raw = res.text;
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'unknown';
      this.logger.warn(
        `feed video screening failed (${code}) — holding for review`,
      );
      return {
        ...this.cleanAxis(),
        uncertain: true,
        reasons: ['moderation_unavailable'],
      };
    }

    let parsed: unknown;
    try {
      parsed = this.parseJson(raw);
    } catch {
      return {
        ...this.cleanAxis(),
        uncertain: true,
        reasons: ['moderation_shape_invalid'],
      };
    }
    const verdict = this.validate(parsed);
    if (!verdict) {
      return {
        ...this.cleanAxis(),
        uncertain: true,
        reasons: ['moderation_shape_invalid'],
      };
    }

    return { ...verdict, reasons: verdict.reasons.slice(0, 8), uncertain: false };
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
  ): Promise<{
    parts: LlmPart[];
    videoAttached: boolean;
    posterUsed: boolean;
  }> {
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
    let posterUsed = false;
    if (input.video) {
      const video = await this.fetchVideo(input.video.url);
      if (video) {
        parts.push({ type: 'video', ...video });
        videoAttached = true;
      } else if (input.video.thumbnailUrl) {
        // The clip could not be inlined (too large / unfetchable), so screen
        // its poster frame instead of publishing unmoderated.
        const poster = await this.fetchImage(input.video.thumbnailUrl);
        if (poster) {
          parts.push(poster);
          posterUsed = true;
        }
      }
    }

    return { parts, videoAttached, posterUsed };
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
