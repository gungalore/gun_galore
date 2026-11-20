// ────────────────────────────────────────────────────────────────────
// THE JEV IMAGE BATTERY — still photos, judged with typed questions.
//
// JEV takes one `state` plus an `assets` map and answers a map of typed
// questions against them. Document filing already uses that path in production
// (one image, `choice`/`noul` answers), so a listing/feed photo can be asked
// the same way. We send ONE image per request: the single-asset path is the
// proven one, and per-photo calls give clean per-photo flags without depending
// on unverified multi-asset behaviour.
//
// ⚠️ FAIL CLOSED ON A MISSING ANSWER. A missing or malformed answer is not a
// clean photo; every reader here throws, and the caller turns that into
// HUMAN_REVIEW / PENDING_MODERATION. A moderation gate that reads a missing
// `noul` as zero is a fail-open gate.
// ────────────────────────────────────────────────────────────────────

import { toJevImage } from '../common/llm/jev-image';
import {
  LlmError,
  type JevAnswer,
  type JevChoiceAnswer,
  type JevQuestion,
  type LlmPart,
} from '../common/llm/llm.types';import { blockThreshold, reviewThreshold } from './jev-battery';

export type ListingPhotoCategory =
  | 'contact'
  | 'qr'
  | 'address'
  | 'advertising'
  | 'live_ammo'
  | 'sexual';

/** The one photo shape the image axis carries. */
export type PhotoPart = Extract<LlmPart, { type: 'image' }>;

/** Flag value the admin queue already understands. */
export const LISTING_PHOTO_FLAG: Record<ListingPhotoCategory, string> = {
  contact: 'photo-contact-info',
  qr: 'qr-code',
  address: 'photo-address',
  advertising: 'advertising',
  live_ammo: 'live-ammo',
  sexual: 'photo-sexual',
};

/** Internal/admin reason for each category. Noun phrases: they read after
 *  "Photo 3:" and after "may show". */
export const LISTING_PHOTO_REASON: Record<ListingPhotoCategory, string> = {
  contact: 'readable contact details',
  qr: 'a visible QR code',
  address: 'a street address or storefront sign',
  advertising: 'advertising for a shop, channel or service',
  live_ammo: 'live ammunition offered for sale',
  sexual: 'full nudity or explicit sexual content',
};

/**
 * Transport a fetched/staged photo into the shape JEV accepts. Resizes and
 * re-encodes (max 1568px, JPEG); throws when the bytes are not a readable
 * image, so the caller can fail the photo closed.
 */
export async function toJevPhotoAsset(part: PhotoPart) {
  return toJevImage(Buffer.from(part.data, 'base64'), part.mimeType);
}

const REDACTION_NOTE =
  'This photo has an intentionally blurred or pixelated area. It was ' +
  'redacted, so treat that area as removed: do not flag it merely because ' +
  'it is blurred, and do not guess what was underneath. Readable text ' +
  'elsewhere in the photo still counts.';

/**
 * Five atomic questions about ONE listing photo. The asset key is `photo`,
 * matching the `state` the caller sends.
 */
export function listingPhotoQuestions(
  redacted: boolean,
): Record<string, JevQuestion> {
  const note = redacted ? ` ${REDACTION_NOTE}` : '';
  return {
    contact: {
      type: 'noul',
      instructions:
        'In `photo`, can a buyer read a phone number, email address, website URL, ' +
        'social handle, or "contact me" text in the image? Product markings ' +
        '(brand, model, calibre, serial number, proof mark) are NOT contact details.' +
        note,
      criteria: {
        true: 'Contact details are plainly readable in the image',
        false: 'No readable contact details',
      },
    },
    qr: {
      type: 'noul',
      instructions:
        'In `photo`, is a QR code visible? A QR code counts even if its ' +
        'destination cannot be read.' +
        note,
      criteria: {
        true: 'A QR code is visible',
        false: 'No QR code',
      },
    },
    address: {
      type: 'noul',
      instructions:
        'In `photo`, is a street address, shop or storefront sign, or a named ' +
        'premises visible that identifies where a person can be found? Ordinary ' +
        'scenery, vehicle number plates and product labels are not this.' +
        note,
      criteria: {
        true: 'A street address or identifying premises is visible',
        false: 'No street address or identifying premises',
      },
    },
    advertising: {
      type: 'noul',
      instructions:
        'In `photo`, is the image itself advertising, selling or self-promoting a ' +
        'shop, channel or service — a price offered in the image, a sale pitch, a ' +
        '"DM me" call to action, or a shop logo presented as the seller\'s own? ' +
        'Incidental manufacturer branding on equipment is NOT this.' +
        note,
      criteria: {
        true: 'The photo itself advertises or solicits a sale or a channel',
        false: 'Ordinary product photography, no self-promotion',
      },
    },
    live_ammo: {
      type: 'noul',
      instructions:
        'In `photo`, are live ammunition, primers or propellant offered for sale? ' +
        'Live rounds merely visible in the background of a scene are not an offer ' +
        'to sell.' +
        note,
      criteria: {
        true: 'Live ammunition or components are offered for sale',
        false: 'No offer of live ammunition or components',
      },
    },
    sexual: {
      type: 'noul',
      instructions:
        'In `photo`, is there FULL NUDITY or explicit sexual content — exposed ' +
        'genitalia, exposed buttocks, exposed female breasts, a sexual act, or ' +
        'pornography? Swimwear is FINE: a bikini, swimming costume, sports bra, ' +
        'shirtless man, or underwear worn as ordinary outdoor, beach or swimming ' +
        'attire is NOT this. Judge sexual exposure, not visible skin.',
      criteria: {
        true: 'Full nudity, exposed genitalia/buttocks/breasts, or a sexual act',
        false: 'Swimwear, ordinary skin, or fully clothed',
      },
    },
  };
}

export interface ListingPhotoVerdict {
  /** At or above the block threshold. */
  blocks: ListingPhotoCategory[];
  /** In the 60–80 % band: a human must look. */
  reviews: ListingPhotoCategory[];
}

export function evaluateListingPhoto(
  answers: Record<string, JevAnswer>,
): ListingPhotoVerdict {
  const block = blockThreshold();
  const review = reviewThreshold();
  const blocks: ListingPhotoCategory[] = [];
  const reviews: ListingPhotoCategory[] = [];

  for (const category of Object.keys(
    LISTING_PHOTO_FLAG,
  ) as ListingPhotoCategory[]) {
    const score = requireNoul(answers, category);
    if (score >= block) blocks.push(category);
    else if (score >= review) reviews.push(category);
  }

  return { blocks, reviews };
}

export type FeedGraphicTier = 'NONE' | 'FIELD' | 'EXTREME';

export interface FeedPhotoVerdict {
  promoDetected: boolean;
  illegalDetected: boolean;
  otherViolation: boolean;
  /**
   * Full nudity or explicit sexual content. Kept apart from
   * `otherViolation` so the reason can name the policy and so a bikini or
   * swimwear photo can be deliberately allowed by the question itself.
   */
  sexualExplicit: boolean;
  graphicTier: FeedGraphicTier;
  uncertain: boolean;
  /** Raw probabilities, for the audit log / threshold tuning. */
  scores: Record<string, number>;
}

/**
 * Three nouls and one choice about ONE community photo. The choice is the
 * graphic tier; the caller takes the maximum across the post's photos.
 *
 * `redacted` marks a photo this service has already pixelated. The note tells
 * the judge not to re-flag the blurred region, while readable text elsewhere
 * still counts.
 */
export function feedPhotoQuestions(
  redacted = false,
): Record<string, JevQuestion> {
  const note = redacted ? ` ${REDACTION_NOTE}` : '';
  return {
    promotional: {
      type: 'noul',
      instructions:
        'Is this photo itself advertising, selling or self-promoting a shop, ' +
        'channel or service — a price offered, a sale pitch, "DM me", a shop ' +
        "logo presented as the author's own, or a pitch for the author's own " +
        'ALL Outdoor listing? Incidental branding on equipment is NOT this.' +
        note,
      criteria: {
        true: 'The photo is itself a promotion or solicitation',
        false: 'Ordinary community photo or a product mention',
      },
    },
    illegal: {
      type: 'noul',
      instructions:
        'Does this photo show an offer to sell live ammunition, primers or ' +
        "propellant; a threat or harassment; someone else's private details " +
        '(doxxing); animal cruelty; or anything else unlawful under South African law?',
      criteria: {
        true: 'Unlawful or prohibited content is present',
        false: 'Nothing unlawful is shown',
      },
    },
    other_violation: {
      type: 'noul',
      instructions:
        'Does this photo break the community rules in another way — contact ' +
        'details burned into the image (phone, email, handle, URL, QR code), a ' +
        'street address or storefront that identifies a person, or hate speech? ' +
        'Normal hunting/fishing field content is NOT this. Nudity and sexual ' +
        'content are asked separately.' +
        note,
      criteria: {
        true: 'A clear additional community-rules violation',
        false: 'No other violation',
      },
    },
    sexual_explicit: {
      type: 'noul',
      instructions:
        'Does this photo show FULL NUDITY or explicit sexual content — ' +
        'exposed genitalia, exposed buttocks, exposed female breasts, a sexual ' +
        'act, or pornography? Swimwear is FINE: a bikini, swimming costume, ' +
        'sports bra, shirtless man, or underwear worn as ordinary outdoor, ' +
        'beach or swimming attire is NOT this. Judge whether the body is ' +
        'sexually exposed, not whether skin is visible.',
      criteria: {
        true: 'Full nudity, exposed genitalia/buttocks/breasts, or a sexual act',
        false: 'Swimwear, ordinary skin, or fully clothed',
      },
    },
    graphic: {
      type: 'choice',
      instructions:
        'How graphic is this photo? NONE = ordinary content. FIELD = normal ' +
        'hunting/fishing field content (blood on a carcass or hide, field ' +
        'dressing), which is allowed behind a content warning. EXTREME = exposed ' +
        'viscera or guts, dismemberment, or a severely damaged head or body, ' +
        'which is held for a human.',
      criteria: {
        NONE: 'Ordinary content with no field blood',
        FIELD: 'Normal hunting/fishing field content',
        EXTREME: 'Exposed viscera, dismemberment or severe injury',
      },
    },
  };
}

const FEED_GRAPHIC_TIERS: readonly FeedGraphicTier[] = [
  'NONE',
  'FIELD',
  'EXTREME',
];

export function evaluateFeedPhoto(
  answers: Record<string, JevAnswer>,
): FeedPhotoVerdict {
  const block = blockThreshold();
  const review = reviewThreshold();

  const promotional = requireNoul(answers, 'promotional');
  const illegal = requireNoul(answers, 'illegal');
  const other = requireNoul(answers, 'other_violation');
  const sexual = requireNoul(answers, 'sexual_explicit');
  const graphic = requireChoice(answers, 'graphic', FEED_GRAPHIC_TIERS);

  const scores = {
    promotional,
    illegal,
    other_violation: other,
    sexual_explicit: sexual,
  };
  const uncertain =
    [promotional, illegal, other, sexual].some(
      (p) => p >= review && p < block,
    ) || graphic.confidence < review;

  return {
    promoDetected: promotional >= block,
    illegalDetected: illegal >= block,
    otherViolation: other >= block,
    sexualExplicit: sexual >= block,
    graphicTier: graphic.choice as FeedGraphicTier,
    uncertain,
    scores,
  };
}

function requireNoul(answers: Record<string, JevAnswer>, key: string): number {
  const answer = answers[key];
  if (!answer || answer.type !== 'noul') {
    throw new LlmError(
      'bad_request',
      `JEV image answer "${key}" was missing or was not a noul`,
    );
  }
  const value = answer.noul;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new LlmError(
      'bad_request',
      `JEV image answer "${key}" was not a probability`,
    );
  }
  return value;
}

function requireChoice(
  answers: Record<string, JevAnswer>,
  key: string,
  allowed: readonly string[],
): JevChoiceAnswer {
  const answer = answers[key];
  if (!answer || answer.type !== 'choice') {
    throw new LlmError(
      'bad_request',
      `JEV image answer "${key}" was missing or was not a choice`,
    );
  }
  if (!allowed.includes(answer.choice)) {
    throw new LlmError(
      'bad_request',
      `JEV image answer "${key}" was outside the offered choices`,
    );
  }
  if (
    typeof answer.confidence !== 'number' ||
    !Number.isFinite(answer.confidence) ||
    answer.confidence < 0 ||
    answer.confidence > 1
  ) {
    throw new LlmError(
      'bad_request',
      `JEV image answer "${key}" had no usable confidence`,
    );
  }
  return answer;
}

// ────────────────────────────────────────────────────────────────────
// BOX QUESTIONS — locating every maskable detail on one photo.
//
// One `box` answer is one rectangle, so "everything on this photo" means
// several questions: per category, an ordinal series. Three is enough for the
// real cases (a number in the listing, a shop URL on the packaging, a QR on a
// flyer); the evaluator drops an ordinal that returns the same rectangle again
// and dedupes by overlap. Only categories that already tripped the noul screen
// are asked about, so a clean photo costs nothing extra.
// ────────────────────────────────────────────────────────────────────

const MASKABLE_CATEGORIES: readonly ListingPhotoCategory[] = [
  'contact',
  'qr',
  'address',
  'advertising',
];

const BOX_ORDINALS = ['first', 'second', 'third'] as const;

const BOX_LABELS: Record<ListingPhotoCategory, string> = {
  contact:
    'readable phone number, email address, website URL or social handle',
  qr: 'QR code',
  address: 'street address, shop sign or storefront name',
  advertising:
    'piece of advertising text (a price, a sale pitch, "DM me" or a shop/channel name)',
  live_ammo: 'live ammunition',
  sexual: 'full nudity or explicit sexual content',
};

const BOX_POLICIES: Record<ListingPhotoCategory, string> = {
  contact:
    'Box ONLY the contact text: the top edge at the top of its first character, ' +
    'the bottom edge at the baseline, with no padding. Exclude any brand ' +
    'wordmark, logo, product name, price, or artwork above, below or beside it. ' +
    'If a brand name sits directly above the URL, the box must start below it. ' +
    'Product markings such as a brand, model, calibre, serial number or proof ' +
    'mark are not contact details.',
  qr: 'Box ONLY the QR code itself, with no surrounding artwork or caption.',
  address:
    'Box ONLY the address text or sign, not the building or scenery around it.',
  advertising:
    'Box ONLY the advertising text, not the product, logo or packaging it sits on.',
  live_ammo: '',
  sexual: '',
};

/** Map the flag names the admin queue uses back to the internal categories. */
export function maskablePhotoCategories(
  flagCategories: readonly string[],
): ListingPhotoCategory[] {
  const map: Record<string, ListingPhotoCategory> = {
    'photo-contact-info': 'contact',
    'qr-code': 'qr',
    'photo-address': 'address',
    advertising: 'advertising',
  };
  const found = new Set<ListingPhotoCategory>();
  for (const flag of flagCategories) {
    const category = map[flag];
    if (category) found.add(category);
  }
  return MASKABLE_CATEGORIES.filter((category) => found.has(category));
}

export function listingPhotoBoxQuestions(
  categories: readonly ListingPhotoCategory[],
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const category of MASKABLE_CATEGORIES) {
    if (!categories.includes(category)) continue;
    BOX_ORDINALS.forEach((ordinal, index) => {
      questions[`mask_${category}_${index + 1}`] = {
        type: 'box',
        instructions: `Locate the ${ordinal} ${BOX_LABELS[category]} in \`photo\`. ${BOX_POLICIES[category]}`,
      };
    });
  }
  return questions;
}

export interface PhotoBox {
  category: ListingPhotoCategory;
  /** Normalized to the upright image, 0..1. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  confidence: number;
}

/**
 * Validate, filter and dedupe the box answers. A missing/odd box is skipped,
 * not fatal: the noul finding already holds the listing if no box survives.
 */
export function evaluateListingPhotoBoxes(
  answers: Record<string, JevAnswer>,
): PhotoBox[] {
  const rawFloor = Number(process.env.JEV_BOX_MIN_CONFIDENCE ?? 0.45);
  const floor =
    Number.isFinite(rawFloor) && rawFloor >= 0 && rawFloor <= 1
      ? rawFloor
      : 0.45;

  const found: PhotoBox[] = [];
  for (const [key, answer] of Object.entries(answers)) {
    const match = key.match(/^mask_(contact|qr|address|advertising)_\d+$/);
    if (!match) continue;
    if (!answer || answer.type !== 'box') continue;
    const confidence = answer.confidence;
    if (confidence === null || confidence < floor) continue;
    const { top, bottom, left, right } = answer.box;
    if (![top, bottom, left, right].every((n) => Number.isFinite(n))) continue;
    if (left < 0 || top < 0 || right > 1 || bottom > 1) continue;
    if (right <= left || bottom <= top) continue;
    const width = right - left;
    const height = bottom - top;
    const area = width * height;
    if (width < 0.02 || height < 0.012 || area < 0.0005 || area > 0.9) {
      continue;
    }
    found.push({
      category: match[1] as ListingPhotoCategory,
      top,
      bottom,
      left,
      right,
      confidence,
    });
  }

  // A repeated ordinal returns the same rectangle again; keep the more
  // confident one and drop near-duplicates of the same category.
  const kept: PhotoBox[] = [];
  for (const box of found.sort((a, b) => b.confidence - a.confidence)) {
    const duplicate = kept.some(
      (other) => other.category === box.category && iou(other, box) >= 0.5,
    );
    if (!duplicate) kept.push(box);
  }
  return kept;
}

function iou(a: PhotoBox, b: PhotoBox): number {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const areaA = (a.right - a.left) * (a.bottom - a.top);
  const areaB = (b.right - b.left) * (b.bottom - b.top);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}
