import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import {
  contactQuestions,
  JEV_CATEGORY_REASONS,
  jevLadder,
  type JevCategory,
} from './jev-battery';

/**
 * Two-layer contact-detail filter for ANY user-to-user freeform text.
 *
 * Background — ALL Outdoor charges a platform fee on completed transactions.
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
 *   2. **Jev battery** — only runs if regex passed. Jev (TypeSafe System One)
 *      answers six atomic questions at once (contact details, social handles,
 *      real name, physical address, off-platform coordination, third-party
 *      advertising) and the shared ladder in jev-battery.ts decides: >=80 %
 *      block, 60–80 % ask DeepSeek then admin, else pass. Catches what regex
 *      cannot: spelled-out digits ("zero eight two..."), leetspeak, a number
 *      split across non-digit characters, novel platform names, a shared
 *      full name. Fail-OPEN on error — the regex layer is the hard guarantee,
 *      and a conversation channel has no hold state to park a message in.
 *
 * Layer 1 alone catches the vast majority of cases. Layer 2 is the
 * adversarial-evasion catcher. Both layers run cheaply enough to add to
 * every freeform write without UX cost.
 */

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
  | 'address'
  /** The Jev battery's categories — the model layer reports these. */
  | JevCategory;

export type FilterResult =
  | { allowed: true }
  | { allowed: false; category: RejectCategory; reason: string };

const PUBLIC_REASONS: Record<RejectCategory, string> = {
  ...JEV_CATEGORY_REASONS,
  phone:
    'No phone numbers in messages — keep negotiation on ALL Outdoor. Once payment goes through, the platform handles handoff.',
  email:
    'No email addresses in messages — keep negotiation on ALL Outdoor. Once payment goes through, the platform handles handoff.',
  url: 'No external links in messages — keep negotiation on ALL Outdoor.',
  'social-platform':
    'No WhatsApp / social handles in messages — keep negotiation on ALL Outdoor. Once payment goes through, the platform handles handoff.',
  'off-platform-coordination':
    'Keep negotiation on ALL Outdoor — once payment goes through, the platform handles direct contact for shipping.',
  address:
    'No street addresses in messages — physical handoff happens through the courier flow after payment.',
};

@Injectable()
export class ContactDetailFilterService {
  private readonly logger = new Logger(ContactDetailFilterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {
    if (!this.llm.isConfigured()) {
      this.logger.warn(
        'No model key configured — contact-detail filter falls back to regex layer only',
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
   * @param userId Optional the identity provider ID of the user who submitted the
   *               text. When provided, blocks are persisted into the
   *               ContactDetailRejection table for the T&S queue +
   *               command-center fee-bypass card. Callers from
   *               controllers should always pass this through.
   */
  async check(
    text: string | null | undefined,
    origin: string,
    userId?: string,
  ): Promise<FilterResult> {
    if (!text || !text.trim()) return { allowed: true };

    // Layer 1 — regex. Fail closed.
    const regexHit = this.regexCheck(text);
    if (regexHit) {
      this.logger.log(
        `Contact-detail filter blocked ${origin} via regex layer (${regexHit})`,
      );
      void this.persistRejection(text, origin, regexHit, userId);
      return {
        allowed: false,
        category: regexHit,
        reason: PUBLIC_REASONS[regexHit],
      };
    }

    // Layer 2 — the Jev battery + shared confidence ladder. Fail open on a
    // model error (the regex layer already cleared the obvious cases).
    const verdict = await jevLadder(this.llm, {
      state: text,
      questions: contactQuestions(),
      reasons: JEV_CATEGORY_REASONS,
      purpose: 'moderation.contact-filter',
      onError: 'pass',
    });

    if (verdict.decision === 'BLOCK') {
      const category = asRejectCategory(verdict.category);
      this.logger.log(
        `Contact-detail filter blocked ${origin} via Jev (${category}, ${verdict.source})`,
      );
      void this.persistRejection(text, origin, category, userId);
      return {
        allowed: false,
        category,
        reason: verdict.reason ?? PUBLIC_REASONS[category],
      };
    }

    if (verdict.decision === 'REVIEW') {
      // A conversation has no hold state, so the message passes (regex was
      // the hard guarantee) but the uncertainty is parked in the T&S queue
      // for a human, exactly as the operator's "send it to admin" asks.
      this.logger.log(
        `Contact-detail filter parked ${origin} for review (${verdict.category ?? 'unknown'})`,
      );
      void this.persistRejection(
        text,
        origin,
        `review:${verdict.category ?? 'unknown'}`,
        userId,
      );
      return { allowed: true };
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
    userId: string | undefined,
  ): Promise<void> {
    try {
      let userId: string | null = null;
      if (userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
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
  // PUBLIC (audit fix 2026-07-20): the Q&A moderator uses this as its
  // deterministic fallback when the model layer is down, so an outage
  // fails closed on contact details instead of blanket-approving.

  regexCheck(text: string): RejectCategory | null {
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

  // ─── Layer 2 — the Jev battery ────────────────────────────────────
}

/**
 * A Jev battery category is already a valid RejectCategory for the six the
 * battery asks; an unexpected one (or the ladder's `moderation_unavailable`)
 * falls back to the off-platform bucket so the user still sees a reason.
 */
function asRejectCategory(category: string | null): RejectCategory {
  const known: JevCategory[] = [
    'contact_details',
    'social_handles',
    'real_name',
    'physical_address',
    'offplatform_coordination',
    'third_party_advertising',
  ];
  if (category && (known as string[]).includes(category)) {
    return category as JevCategory;
  }
  return 'off-platform-coordination';
}
