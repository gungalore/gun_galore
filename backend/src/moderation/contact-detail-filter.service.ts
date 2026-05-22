import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Two-layer contact-detail filter for ANY user-to-user freeform text.
 *
 * Background — Gun Galore charges a platform fee on completed transactions.
 * Any channel that lets one user reach another off-platform (phone, email,
 * WhatsApp handle, "meet me at..." etc.) is a fee-bypass vector and a
 * trust-and-safety risk. The operator's rule: contact-detail sharing is
 * PROHIBITED on every user-supplied freeform field unless a deliberate
 * exception is coded in.
 *
 * Where this is wired in today:
 *   - OffersService.submit()    — buyerNote on a new offer
 *   - OffersService.counter()   — sellerNote on a counter
 *   - RatingsService.create()   — comment on a post-transaction review
 *
 * Where contact info IS allowed (don't run this filter):
 *   - The seller's own profile (email/phone on /profile) — those are
 *     account-management fields, not user-to-user messages.
 *   - The post-checkout shipping handoff between buyer & courier — that
 *     channel exists specifically to let physical delivery happen.
 *   - Admin-side notes / refund reasons — admins are trusted operators.
 *
 * Already covered by their own moderators (don't double-filter):
 *   - Listing title/description/photos → ListingModerationService
 *   - Public Q&A questions + seller answers → ListingQuestionsService
 *
 * ---
 * Two layers, in order:
 *
 *   1. **Regex pre-filter** — instant, free, fail-CLOSED. Catches the
 *      obvious cases: SA phone numbers, emails, URLs, platform names
 *      (WhatsApp/Telegram/Insta/etc.), off-platform coordination
 *      phrases ("meet me at", "DM me"). If this trips we block
 *      immediately, no LLM call.
 *
 *   2. **Claude Haiku fallback** — only runs if regex passed. Catches
 *      evasion: spelled-out digits ("zero eight two..."), leetspeak,
 *      splitting a number across non-digit characters, novel platform
 *      names. Fail-OPEN — if the API is down we don't block legit
 *      messages (the regex layer is the hard guarantee).
 *
 * Layer 1 alone catches the vast majority of cases. Layer 2 is the
 * adversarial-evasion catcher. Both layers run cheaply enough to add to
 * every freeform write without UX cost.
 */

const MODEL_FILTER =
  process.env.ANTHROPIC_MODEL_SIMPLE ?? 'claude-haiku-4-5-20251001';

const FILTER_PROMPT = `You decide whether a short message from one Gun Galore user to another is trying to share off-platform contact details or coordinate a deal outside the platform.

REJECT if the message contains, or is trying to obscure:
- a phone number (any form — digits, spelled-out words, split with dots/spaces/dashes/non-digit characters, "oh-eight-two...", "treble-five", etc.)
- an email address (even obfuscated like "name at gmail dot com")
- a URL or domain pointing to the user's own shop / channel / social
- a social-media handle (WhatsApp, Telegram, Signal, Instagram, Facebook, TikTok, Snapchat, X/Twitter, YouTube, etc.) — platform names alone (even without a handle) are a strong signal
- an attempt to move the conversation off-platform ("DM me", "let's chat directly", "WhatsApp me", "meet me at...", "call me", "I'll give you my number", "send me your details", "outside the platform")
- a street address that identifies where to physically meet the user

APPROVE everything else — product questions, polite haggling, shipping arrangements (locker codes, suburb-level location for collection), thanks, condition notes, etc.

Brand names, model names, manufacturer websites mentioned in passing (glock.com, vortexoptics.com), serial numbers and calibre stamps are NOT contact details.

Respond with valid JSON ONLY:
{ "decision": "APPROVE" | "REJECT",
  "category": "<one of: phone, email, url, social-platform, off-platform-coordination, address — only when REJECT>" }

First character of your response MUST be "{". No preamble, no markdown fences.`;

// ---------- Regex patterns ----------------------------------------------------
//
// Tight enough to avoid common false positives (caliber numbers, serial
// numbers, year mentions), wide enough to catch the obvious attempts.

// SA phone numbers: 10 digits starting with 0, or +27 prefix with 9 digits.
// Allow spaces, dashes, dots, parens between digit groups.
// Also catches "082 123 4567", "+27 82 123 4567", "0821234567", "(082) 123-4567".
const PHONE_REGEX =
  /(?:\+?\s*27|\b0)[\s.\-()]{0,3}(?:\d[\s.\-()]{0,3}){8,10}\d\b/;

// Email — standard pattern, plus catches obfuscated "user [at] domain [dot] com".
const EMAIL_REGEX =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const EMAIL_OBFUSCATED_REGEX =
  /[a-zA-Z0-9._%+\-]+\s*[\[(]?\s*(?:at|@)\s*[\])]?\s*[a-zA-Z0-9.\-]+\s*[\[(]?\s*(?:dot|\.)\s*[\])]?\s*[a-zA-Z]{2,}/i;

// URLs / bare domains — covers http(s)://, www., and bare TLDs we care about.
// Manufacturer brand TLDs are stripped out by an allowlist below so e.g.
// "vortexoptics.com" in a question doesn't trip the filter.
const URL_REGEX =
  /(?:https?:\/\/|www\.)[\w\-./?=&%#]+|\b[\w-]{2,}\.(?:co\.za|com|net|org|io|me|app|shop|store|biz|info|live|tv|page|site)\b/i;

const BRAND_DOMAIN_ALLOWLIST = new Set([
  'glock.com',
  'sig-sauer.com',
  'sigsauer.com',
  'cz-usa.com',
  'beretta.com',
  'smith-wesson.com',
  'smithandwesson.com',
  'ruger.com',
  'colt.com',
  'browning.com',
  'bergara.com',
  'tikka.fi',
  'sako.fi',
  'howa.co.jp',
  'vortexoptics.com',
  'leupold.com',
  'nikonsportoptics.com',
  'bushnell.com',
  'eotech.com',
  'trijicon.com',
  'aimpoint.com',
  'magpul.com',
  'safariland.com',
  'blackhawk.com',
  'streamlight.com',
  'surefire.com',
]);

// Platform names + handle-style mentions. "@username" or bare platform name
// is a strong signal someone's trying to route off-platform.
const SOCIAL_REGEX =
  /\b(?:whats\s?app|wassap|telegram|signal|instagram|insta|ig|facebook|fb\b|messenger|tiktok|tik\s?tok|snapchat|snap|twitter|x\.com|youtube|reddit|t\.me|wa\.me|@[\w._\-]{2,})\b/i;

// Off-platform coordination phrases.
const OFFPLATFORM_REGEX =
  /\b(?:dm\s?me|message\s+me\s+(?:direct|privately)|chat\s+(?:direct|privately|off)|call\s+me\b|sms\s+me\b|text\s+me\b|whatsapp\s+me\b|my\s+(?:number|cell|phone|email|address)\b|i'?ll\s+give\s+you\s+my\s+(?:number|cell|phone|email|address)|send\s+me\s+your\s+(?:number|cell|phone|email|details)|outside\s+(?:the\s+)?(?:site|platform|gun\s?galore)|off[-\s]?platform|bypass\s+the\s+(?:site|platform|fee|fees))\b/i;

// SA street address — "12 Main Road, Bellville" style. Loose pattern so
// we don't false-positive on caliber numbers; require a street suffix
// word and at least one number group.
const ADDRESS_REGEX =
  /\b\d{1,4}\s+[A-Z][a-z]+\s+(?:Street|Str|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Crescent|Cres|Close|Boulevard|Blvd|Highway|Hwy|Way|Place|Pl)\b/;

export type RejectCategory =
  | 'phone'
  | 'email'
  | 'url'
  | 'social-platform'
  | 'off-platform-coordination'
  | 'address';

export type FilterResult =
  | { allowed: true }
  | { allowed: false; category: RejectCategory; reason: string };

const PUBLIC_REASONS: Record<RejectCategory, string> = {
  phone:
    'No phone numbers in messages — keep negotiation on Gun Galore. Once payment goes through, the platform handles handoff.',
  email:
    'No email addresses in messages — keep negotiation on Gun Galore. Once payment goes through, the platform handles handoff.',
  url: 'No external links in messages — keep negotiation on Gun Galore.',
  'social-platform':
    'No WhatsApp / social handles in messages — keep negotiation on Gun Galore. Once payment goes through, the platform handles handoff.',
  'off-platform-coordination':
    'Keep negotiation on Gun Galore — once payment goes through, the platform handles direct contact for shipping.',
  address:
    'No street addresses in messages — physical handoff happens through the courier flow after payment.',
};

@Injectable()
export class ContactDetailFilterService {
  private readonly logger = new Logger(ContactDetailFilterService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
    if (!key) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — contact-detail filter falls back to regex layer only',
      );
    }
  }

  /**
   * Run the full filter on a user-supplied freeform string.
   *
   * @param text   The exact text the user typed (untrimmed is fine — we
   *               normalize internally). Empty/whitespace-only always
   *               passes (callers shouldn't be storing those anyway).
   * @param origin Free-form tag for log lines — e.g. "offer-note",
   *               "counter-note", "rating-comment". Used only for
   *               operator triage; not exposed to the user.
   * @param clerkId Optional Clerk ID of the user who submitted the
   *               text. When provided, blocks are persisted into the
   *               ContactDetailRejection table for the T&S queue +
   *               command-center fee-bypass card. Callers from
   *               controllers should always pass this through.
   */
  async check(
    text: string | null | undefined,
    origin: string,
    clerkId?: string,
  ): Promise<FilterResult> {
    if (!text || !text.trim()) return { allowed: true };

    // Layer 1 — regex. Fail closed.
    const regexHit = this.regexCheck(text);
    if (regexHit) {
      this.logger.log(
        `Contact-detail filter blocked ${origin} via regex layer (${regexHit})`,
      );
      void this.persistRejection(text, origin, regexHit, clerkId);
      return {
        allowed: false,
        category: regexHit,
        reason: PUBLIC_REASONS[regexHit],
      };
    }

    // Layer 2 — Haiku. Fail open (if the API errors, the regex layer
    // already cleared the obvious cases; we'd rather let an edge case
    // through than block legit messages on infra problems).
    const llmHit = await this.llmCheck(text);
    if (llmHit) {
      this.logger.log(
        `Contact-detail filter blocked ${origin} via LLM layer (${llmHit})`,
      );
      void this.persistRejection(text, origin, llmHit, clerkId);
      return {
        allowed: false,
        category: llmHit,
        reason: PUBLIC_REASONS[llmHit],
      };
    }

    return { allowed: true };
  }

  // Persist a block to the ContactDetailRejection table so the T&S
  // queue + command-center attention card have real data. Best-effort:
  // we never want a DB write failure to bubble up and break the rejection
  // response — the user already got a useful error message.
  private async persistRejection(
    text: string,
    channel: string,
    category: string,
    clerkId: string | undefined,
  ): Promise<void> {
    try {
      let userId: string | null = null;
      if (clerkId) {
        const user = await this.prisma.user.findUnique({
          where: { clerkId },
          select: { id: true },
        });
        userId = user?.id ?? null;
      }
      await this.prisma.contactDetailRejection.create({
        data: {
          userId,
          channel,
          category,
          // Truncate to 200 chars so a buyer pasting a long block
          // doesn't bloat the table. The sample is for context only;
          // we don't need the whole text.
          sampleText: text.slice(0, 200),
        },
      });
    } catch (err) {
      this.logger.warn(
        `ContactDetailRejection insert failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  // ─── Layer 1 — regex ──────────────────────────────────────────────

  private regexCheck(text: string): RejectCategory | null {
    // Normalize zero-width characters and common digit-substitution
    // tricks before regex matching, so "0٨2 - 1.2.3 - 4567" still
    // looks like a phone number.
    const normalised = text
      .replace(/[​-‏⁠﻿]/g, '') // zero-width chars
      .replace(/[٠۰]/g, '0') // arabic-indic zero
      .replace(/[١۱]/g, '1')
      .replace(/[٢۲]/g, '2')
      .replace(/[٣۳]/g, '3')
      .replace(/[٤۴]/g, '4')
      .replace(/[٥۵]/g, '5')
      .replace(/[٦۶]/g, '6')
      .replace(/[٧۷]/g, '7')
      .replace(/[٨۸]/g, '8')
      .replace(/[٩۹]/g, '9');

    if (EMAIL_REGEX.test(normalised) || EMAIL_OBFUSCATED_REGEX.test(normalised)) {
      return 'email';
    }

    // URL — but allow brand-allowlisted product references.
    const urlMatch = normalised.match(URL_REGEX);
    if (urlMatch) {
      const matched = urlMatch[0].toLowerCase();
      const bareDomain = matched
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
      if (!BRAND_DOMAIN_ALLOWLIST.has(bareDomain)) {
        return 'url';
      }
    }

    if (PHONE_REGEX.test(normalised)) {
      return 'phone';
    }

    if (SOCIAL_REGEX.test(normalised)) {
      return 'social-platform';
    }

    if (OFFPLATFORM_REGEX.test(normalised)) {
      return 'off-platform-coordination';
    }

    if (ADDRESS_REGEX.test(normalised)) {
      return 'address';
    }

    return null;
  }

  // ─── Layer 2 — Haiku ──────────────────────────────────────────────

  private async llmCheck(text: string): Promise<RejectCategory | null> {
    if (!this.client) return null;
    try {
      const msg = await this.client.messages.create({
        model: MODEL_FILTER,
        max_tokens: 80,
        system: FILTER_PROMPT,
        messages: [{ role: 'user', content: text }],
      });

      // Anthropic returns a union of content block types. We only want
      // the text block; cast through a minimal shape to read .text.
      const block = msg.content.find((b) => b.type === 'text');
      const raw = (block as { text?: string } | undefined)?.text;
      if (!raw) return null;

      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return null;

      const json = JSON.parse(match[0]) as {
        decision?: string;
        category?: string;
      };
      if (json.decision !== 'REJECT') return null;

      const cat = (json.category ?? '').toLowerCase();
      if (
        cat === 'phone' ||
        cat === 'email' ||
        cat === 'url' ||
        cat === 'social-platform' ||
        cat === 'off-platform-coordination' ||
        cat === 'address'
      ) {
        return cat;
      }
      // Unknown category — treat as off-platform-coordination (the
      // catch-all bucket) so the user still sees a useful reason.
      return 'off-platform-coordination';
    } catch (err) {
      this.logger.warn(
        `Contact-detail LLM check failed (open-fail): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
