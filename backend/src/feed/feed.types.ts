// Shared constants and pure helpers for the community feed.
// See docs/design/community-feed/spec.md.

import { PostType } from '@prisma/client';

/**
 * The ONLY thing that makes an account "Official". The operator owns this
 * domain, so a domain match is the gate — but ⚠️ that domain must NOT have a
 * catch-all mailbox, or anyone could register `anything@alloutdoor.co.za`,
 * verify the OTP and inherit the exemption.
 */
export const FEED_OFFICIAL_EMAIL_DOMAIN = 'alloutdoor.co.za';

export const FEED_PAGE_DEFAULT = 20;
export const FEED_PAGE_MAX = 50;

export const FEED_MAX_TITLE = 140;
export const FEED_MAX_BODY = 5000;
export const FEED_MAX_COMMENT = 2000;
export const FEED_MAX_TAGS = 10;
export const FEED_MAX_TAG_LENGTH = 40;
export const FEED_MAX_IMAGES = 6;
/** One video per post, capped here (Cloudinary's free plan allows ~100 MB). */
export const FEED_MAX_VIDEO_BYTES = 64 * 1024 * 1024;
export const FEED_MAX_MUTES_PER_AXIS = 100;

export const POST_TYPE_LABELS: Record<PostType, string> = {
  GENERAL: 'General & Community',
  HUNTING: 'Hunting',
  FIREARMS_SHOOTING: 'Firearms & Shooting',
  RELOADING: 'Reloading',
  FISHING: 'Fishing',
  OVERLANDING_4X4: 'Overlanding & 4x4',
  CAMPING_BUSHCRAFT: 'Camping & Bushcraft',
  GEAR_REVIEWS: 'Gear & Reviews',
  QUESTIONS_ADVICE: 'Questions & Advice',
};

export const POST_TYPES = Object.keys(POST_TYPE_LABELS) as PostType[];

// ───────────────────────────────────────────────────────────────────────────
// Optional per-category "details" fields. These are the ONLY permitted values
// for the typed Post columns added in the add_post_structured_fields migration.
// The vocabulary lives here (not as DB enums) so it can grow without a
// migration; the frontend mirror is frontend/lib/post-fields.ts.
// ───────────────────────────────────────────────────────────────────────────

export const FEED_MAX_CHIPS = 8;
export const FEED_MAX_CHIP_LENGTH = 24;

/** Multi-select chip values allowed per post type. */
export const POST_CHIP_VOCAB: Partial<
  Record<PostType, { flair?: readonly string[]; species?: readonly string[] }>
> = {
  GENERAL: {
    flair: ['meetup', 'announcement', 'photo', 'news', 'discussion'],
  },
  HUNTING: {
    species: [
      'blesbok',
      'springbok',
      'impala',
      'kudu',
      'warthog',
      'gemsbok',
      'blue-wildebeest',
      'black-wildebeest',
      'zebra',
      'bushbuck',
      'eland',
      'common-duiker',
      'steenbok',
      'nyala',
      'sable',
      'reedbuck',
      'waterbuck',
      'buffalo',
    ],
  },
  FIREARMS_SHOOTING: {
    flair: ['range', 'hunting', 'competition', 'maintenance'],
  },
  FISHING: {
    flair: ['lure', 'bait', 'fly', 'trolling', 'bottom'],
    species: [
      'bass',
      'carp',
      'trout',
      'tilapia',
      'yellowfish',
      'kurper',
      'barbel',
      'bream',
      'snoek',
      'yellowtail',
      'kob',
      'grunter',
      'tuna',
      'kingfish',
      'amberjack',
      'grouper',
      'sunfish',
      'dorado',
    ],
  },
  OVERLANDING_4X4: {
    flair: ['trail-report', 'recovery', 'passable', 'closed', 'fuel'],
  },
  CAMPING_BUSHCRAFT: {
    flair: ['water', 'toilets', 'firepit', 'none'],
  },
  QUESTIONS_ADVICE: {
    flair: ['setup', 'troubleshooting', 'legal', 'safety', 'local-advice'],
  },
};

/** Single-select fixed-vocabulary fields allowed per post type. */
export const POST_SINGLE_VOCAB: Partial<
  Record<PostType, Partial<Record<PostSingleField, readonly string[]>>>
> = {
  FIREARMS_SHOOTING: {
    firearmType: ['rifle', 'shotgun', 'pistol', 'airgun', 'other'],
  },
  FISHING: {
    waterType: ['river', 'dam', 'estuary', 'nearshore', 'offshore'],
  },
  CAMPING_BUSHCRAFT: {
    siteType: ['campsite', 'wilderness', 'caravan', 'hut', 'other'],
  },
  GEAR_REVIEWS: {
    gearCategory: ['firearm', 'optic', 'ammo', 'camping', 'fishing', 'vehicle', 'other'],
    gearCondition: ['new', 'used', 'like-new'],
  },
  QUESTIONS_ADVICE: {
    context: ['at-range', 'in-field', 'at-home'],
  },
};

export type PostSingleField =
  | 'firearmType'
  | 'waterType'
  | 'siteType'
  | 'gearCategory'
  | 'gearCondition'
  | 'context';

export type PostNumericField =
  | 'bulletWeightGr'
  | 'powderChargeGr'
  | 'sizeCm'
  | 'shotDistanceM'
  | 'tripDays'
  | 'gearRating';

export const POST_NUMERIC_BOUNDS: Record<PostNumericField, { min: number; max: number }> = {
  bulletWeightGr: { min: 1, max: 2000 },
  powderChargeGr: { min: 1, max: 500 },
  sizeCm: { min: 1, max: 2000 },
  shotDistanceM: { min: 1, max: 5000 },
  tripDays: { min: 1, max: 365 },
  gearRating: { min: 1, max: 5 },
};

/**
 * Which detail fields each post type accepts. A field not listed for a type is
 * stripped before it is stored, so a client cannot smuggle, say, a calibre onto
 * a Fishing post. `occurredAt` is shared by every type.
 */
export const POST_DETAIL_FIELDS: Record<PostType, readonly string[]> = {
  GENERAL: ['flair', 'occurredAt'],
  HUNTING: ['species', 'calibre', 'shotDistanceM', 'occurredAt'],
  FIREARMS_SHOOTING: ['firearmType', 'calibre', 'firearmModel', 'flair', 'occurredAt'],
  RELOADING: ['calibre', 'bulletWeightGr', 'powderChargeGr', 'testResult', 'occurredAt'],
  FISHING: ['species', 'waterType', 'flair', 'sizeCm', 'occurredAt'],
  OVERLANDING_4X4: ['flair', 'tripDays', 'occurredAt'],
  CAMPING_BUSHCRAFT: ['siteType', 'flair', 'tripDays', 'occurredAt'],
  GEAR_REVIEWS: ['gearCategory', 'gearRating', 'gearCondition', 'occurredAt'],
  QUESTIONS_ADVICE: ['flair', 'context', 'occurredAt'],
};

/** Normalise a chip list to the allowed vocabulary (lowercase/hyphen), capped. */
export function normaliseChipList(input: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (!allowed.includes(v)) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= FEED_MAX_CHIPS) break;
  }
  return out;
}

/** Keep a single-select value only when it is in the allowed vocabulary. */
export function normaliseSingleValue(input: unknown, allowed: readonly string[]): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase().replace(/\s+/g, '-');
  return allowed.includes(v) ? v : null;
}

/** Clamp a numeric detail field into its bound, or drop it when not a number. */
export function normaliseNumeric(input: unknown, field: PostNumericField): number | null {
  if (input === undefined || input === null || input === '') return null;
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return null;
  const { min, max } = POST_NUMERIC_BOUNDS[field];
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * A serial number is never collected. `firearmModel` is model name only, so a
 * long digit run (5+) — the shape of a serial — is refused. Ordinary model
 * numbers (700, 1500, 1911) are short enough to pass.
 */
export const SERIAL_NUMBER_PATTERN = /\d{5,}/;

export function looksLikeSerial(value: string): boolean {
  return SERIAL_NUMBER_PATTERN.test(value);
}

/** The sanitised detail columns for a post, ready to store. */
export interface PostDetailsData {
  flair?: string[];
  species?: string[];
  occurredAt?: Date | null;
  calibre?: string | null;
  firearmType?: string | null;
  firearmModel?: string | null;
  bulletWeightGr?: number | null;
  powderChargeGr?: number | null;
  testResult?: string | null;
  waterType?: string | null;
  sizeCm?: number | null;
  shotDistanceM?: number | null;
  siteType?: string | null;
  tripDays?: number | null;
  gearCategory?: string | null;
  gearRating?: number | null;
  gearCondition?: string | null;
  context?: string | null;
}

function textOrNull(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  return v ? v.slice(0, max) : null;
}

/**
 * Build the detail columns a post may carry, dropping anything not permitted
 * for `type`. Every field is optional — an empty result is the common case and
 * must never fail a post.
 */
export function sanitisePostDetails(
  input: Record<string, unknown>,
  type: PostType,
): PostDetailsData {
  const allowed = new Set(POST_DETAIL_FIELDS[type] ?? []);
  const out: PostDetailsData = {};
  // Only keys actually PRESENT in `input` are emitted. That keeps a create's
  // unspecified fields on their column defaults, and stops an edit from wiping
  // a field the client did not send.
  const given = (k: string) => input[k] !== undefined;

  const chips = POST_CHIP_VOCAB[type] ?? {};
  if (allowed.has('flair') && chips.flair && given('flair')) {
    out.flair = normaliseChipList(input.flair, chips.flair);
  }
  if (allowed.has('species') && chips.species && given('species')) {
    out.species = normaliseChipList(input.species, chips.species);
  }

  const singles = POST_SINGLE_VOCAB[type] ?? {};
  for (const [field, vocab] of Object.entries(singles)) {
    if (!allowed.has(field) || !vocab || !given(field)) continue;
    (out as Record<string, unknown>)[field] = normaliseSingleValue(
      input[field],
      vocab as readonly string[],
    );
  }

  const numerics: PostNumericField[] = [
    'bulletWeightGr',
    'powderChargeGr',
    'sizeCm',
    'shotDistanceM',
    'tripDays',
    'gearRating',
  ];
  for (const field of numerics) {
    if (!allowed.has(field) || !given(field)) continue;
    out[field] = normaliseNumeric(input[field], field);
  }

  if (allowed.has('calibre') && given('calibre')) out.calibre = textOrNull(input.calibre, 40);
  if (allowed.has('testResult') && given('testResult')) {
    out.testResult = textOrNull(input.testResult, 120);
  }
  if (allowed.has('firearmModel') && given('firearmModel')) {
    out.firearmModel = textOrNull(input.firearmModel, 60);
  }

  if (allowed.has('occurredAt') && given('occurredAt')) {
    const raw = input.occurredAt;
    if (typeof raw === 'string' && raw.trim()) {
      const d = new Date(raw);
      out.occurredAt = Number.isNaN(d.getTime()) ? null : d;
    } else {
      out.occurredAt = null;
    }
  }

  return out;
}

export function isOfficialEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${FEED_OFFICIAL_EMAIL_DOMAIN}`);
}

/**
 * Normalise author-supplied topic tags: lowercase, no leading '#', spaces to
 * hyphens, alphanumeric+hyphen only, deduped, capped. Anything invalid is
 * dropped rather than rejected — a stray tag must not lose the post.
 */
export function normaliseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw
      .trim()
      .toLowerCase()
      .replace(/^#+/, '')
      .replace(/\s+/g, '-');
    if (!t || t.length > FEED_MAX_TAG_LENGTH) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= FEED_MAX_TAGS) break;
  }
  return out;
}

/** Normalise a mute list: lowercase, deduped, capped, no blanks. */
export function normaliseMuteList(input: unknown, cap = FEED_MAX_MUTES_PER_AXIS): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

export interface PublicAuthor {
  username: string;
  avatarUrl: string | null;
  sellerTier: string;
  isVerifiedExpert: boolean;
  /** Member preference: when false the avatar is withheld from the API. */
  feedShowAvatar: boolean;
}

/** Never expose first/last name or any PII on a feed surface. */
export const PUBLIC_AUTHOR_SELECT = {
  username: true,
  avatarUrl: true,
  sellerTier: true,
  isVerifiedExpert: true,
  feedShowAvatar: true,
} as const;

export function authorName(author: { username?: string | null } | null | undefined): string {
  return author?.username ?? 'Anonymous';
}
