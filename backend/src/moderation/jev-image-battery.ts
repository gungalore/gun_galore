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
} from '../common/llm/llm.types';
import { blockThreshold, reviewThreshold } from './jev-battery';

export type ListingPhotoCategory =
  | 'contact'
  | 'qr'
  | 'address'
  | 'advertising'
  | 'live_ammo';

/** The one photo shape the image axis carries. */
export type PhotoPart = Extract<LlmPart, { type: 'image' }>;

/** Flag value the admin queue / seller blur tool already understands. */
export const LISTING_PHOTO_FLAG: Record<ListingPhotoCategory, string> = {
  contact: 'photo-contact-info',
  qr: 'qr-code',
  address: 'photo-address',
  advertising: 'advertising',
  live_ammo: 'live-ammo',
};

/** Internal/admin reason for each category. Noun phrases: they read after
 *  "Photo 3:" and after "may show". */
export const LISTING_PHOTO_REASON: Record<ListingPhotoCategory, string> = {
  contact: 'readable contact details',
  qr: 'a visible QR code',
  address: 'a street address or storefront sign',
  advertising: 'advertising for a shop, channel or service',
  live_ammo: 'live ammunition offered for sale',
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
  'This photo has an intentionally blurred or pixelated area. The seller ' +
  'redacted it, so treat that area as removed: do not flag it merely because ' +
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
  graphicTier: FeedGraphicTier;
  uncertain: boolean;
  /** Raw probabilities, for the audit log / threshold tuning. */
  scores: Record<string, number>;
}

/**
 * Three nouls and one choice about ONE community photo. The choice is the
 * graphic tier; the caller takes the maximum across the post's photos.
 */
export function feedPhotoQuestions(): Record<string, JevQuestion> {
  return {
    promotional: {
      type: 'noul',
      instructions:
        'Is this photo itself advertising, selling or self-promoting a shop, ' +
        'channel or service — a price offered, a sale pitch, "DM me", a shop ' +
        "logo presented as the author's own, or a pitch for the author's own " +
        'ALL Outdoor listing? Incidental branding on equipment is NOT this.',
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
        'street address or storefront that identifies a person, hate speech, or ' +
        'sexual content? Normal hunting/fishing field content is NOT this.',
      criteria: {
        true: 'A clear additional community-rules violation',
        false: 'No other violation',
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
  const graphic = requireChoice(answers, 'graphic', FEED_GRAPHIC_TIERS);

  const scores = { promotional, illegal, other_violation: other };
  const uncertain =
    [promotional, illegal, other].some((p) => p >= review && p < block) ||
    graphic.confidence < review;

  return {
    promoDetected: promotional >= block,
    illegalDetected: illegal >= block,
    otherViolation: other >= block,
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
