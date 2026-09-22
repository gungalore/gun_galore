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
