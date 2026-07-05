import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';

// Mirrors the Prisma `ClaudeDecision` enum.
export type ClaudeDecision =
  | 'APPROVE'
  | 'AUTO_FIX_AND_APPROVE'
  | 'REJECT'
  | 'HUMAN_REVIEW';

// Buckets a single moderation reason into a "sin type". Used by the
// preview soft-block flow to detect "you got rejected for X, then tried
// again with X hidden differently". Anything that doesn't match a known
// bucket falls into 'other' (and counts as the same sin if repeated).
export type SinCategory =
  | 'live-ammo'
  | 'contact-info'       // text-side contact details (phone, email, etc.)
  | 'photo-contact-info' // contact details visible in a photo
  | 'qr-code'            // QR code in a photo (bypass channel)
  | 'photo-address'      // street numbers / shop signage in a photo
  | 'prohibited-content'
  | 'fake-photo'         // stock / watermarked / reused photo
  | 'no-photo'
  | 'wrong-category'
  | 'high-value'
  | 'low-confidence'
  | 'new-seller'
  | 'other';

export function categorizeReason(reason: string): SinCategory {
  const lower = reason.toLowerCase();
  if (/live\s*(ammo|ammunition|primer|propellant|round|cartridge)/.test(lower))
    return 'live-ammo';
  // QR codes — own bucket because they're a high-signal bypass tactic.
  if (/\bqr[\s-]?code\b/.test(lower)) return 'qr-code';
  // Contact info visible IN a photo (different sin from contact info in
  // the description — sellers sneaking it past the text moderator).
  if (
    /(photo|image|picture).{0,30}(phone|email|whatsapp|url|number|contact|website|handle|sign)/.test(
      lower,
    ) ||
    /(phone|email|whatsapp|url|contact|website|handle|number).{0,30}(in|on|visible).{0,15}(photo|image|picture)/.test(
      lower,
    )
  )
    return 'photo-contact-info';
  // Street numbers / shop signage / dealer storefront visible in a photo.
  if (/(address|street\s*number|shop\s*sign|storefront|signage).{0,30}(photo|image|picture)/.test(lower) ||
      /(photo|image|picture).{0,30}(address|street\s*number|shop\s*sign|storefront|signage)/.test(lower))
    return 'photo-address';
  if (/contact\s*info|phone|email|whatsapp|telegram|@\w|social\s*handle|url/.test(lower))
    return 'contact-info';
  if (/hate|extremist|illegal|sexual|nsfw|nudity/.test(lower))
    return 'prohibited-content';
  if (/stock\s*photo|watermark|copyright|stolen\s*image|reused\s*image/.test(lower))
    return 'fake-photo';
  if (/no\s+photo|missing\s+photo/.test(lower))
    return 'no-photo';
  if (/wrong\s+category|category\s+mismatch|doesn'?t\s+match/.test(lower))
    return 'wrong-category';
  if (/high.?value/.test(lower))
    return 'high-value';
  if (/low\s+confidence/.test(lower))
    return 'low-confidence';
  if (/new\s+seller/.test(lower))
    return 'new-seller';
  return 'other';
}

// Model picker. Two roles:
//   MODEL_SIMPLE — reserved for cheap text-only calls (currently unused,
//                  kept so we have a fast lane if we add one). Default Haiku.
//   MODEL_JUDGE  — used for BOTH listing moderation (vision + reasoning
//                  about contact info, QR codes, watermarks etc.) AND
//                  description refinement. Haiku previously did moderation
//                  but hallucinated facts the seller never wrote, so we
//                  promoted everything reasoning-heavy to Sonnet.
// Env overrides let us swap models without a code change.
const MODEL_SIMPLE =
  process.env.ANTHROPIC_MODEL_SIMPLE ?? 'claude-haiku-4-5-20251001';
const MODEL_JUDGE =
  process.env.ANTHROPIC_MODEL_JUDGE ?? 'claude-sonnet-4-6';

// Hash the set of sin categories raised by a moderation pass. The hash
// is what the client carries forward across attempts — if a later attempt
// produces the same hash, that's "same sin in another form".
export function hashAttempt(reasons: string[]): string {
  const cats = Array.from(new Set(reasons.map(categorizeReason))).sort();
  return createHash('sha256')
    .update(cats.join('|'))
    .digest('hex')
    .slice(0, 16);
}

export interface ListingModerationImage {
  /** Image MIME type, e.g. "image/jpeg" / "image/png" / "image/webp". */
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Base64-encoded image data WITHOUT the `data:image/...;base64,` prefix. */
  data: string;
}

export interface ListingModerationInput {
  title: string;
  description: string;
  categoryName: string;
  categoryIsFirearm: boolean;
  priceCents: number | null;
  /** UX-7 — seller's claimed "was"/original price (ZAR cents), if any. Passed
   *  to the moderator so a fabricated anchor can be flagged (CPA s41). */
  compareAtPriceCents?: number | null;
  /** Cloudinary URLs of already-uploaded photos (post-publish path). */
  imageUrls: string[];
  /** Base64 photos staged client-side (preview path before upload). When
   *  both this and imageUrls are set, prefer URLs (smaller payload). */
  imagesBase64?: ListingModerationImage[];
  /** Total photos the seller has staged — set even when imageUrls AND
   *  imagesBase64 are empty (degraded preview). Tells Claude "yes,
   *  photos exist; don't flag missing-photos" when > 0. */
  imageCount: number;
  sellerFirstFirearmListings: boolean;
}

export interface ListingModerationResult {
  decision: ClaudeDecision;
  confidence: number; // 0..1
  reasons: string[];
  // Present when decision is AUTO_FIX_AND_APPROVE
  cleanedDescription?: string;
  // Public reason shown to the seller on REJECT
  publicReason?: string;
}

// Deliberately small prompt — Gun Galore moderation only catches TWO
// things. Anything else is the seller's business or the admin queue's
// problem. Earlier versions tried to enforce SA firearm law, photo
// quality, category matching, confidence thresholds etc — most of those
// produced false positives that frustrated good sellers. We rolled them
// all back per the operator's call: "Claude needs to relax."
const SYSTEM_PROMPT = `You are the listing moderator for Gun Galore — a South African marketplace.

You only check for TWO things. Anything else: APPROVE.

# OUTPUT FORMAT — STRICT

Your reply MUST be a single valid JSON object and NOTHING else.
- The first character you emit MUST be the literal "{".
- Do NOT write any prose, reasoning, preamble, or commentary before
  the JSON. Do NOT wrap the JSON in markdown code fences.
- Reason for the verdict goes INSIDE the "reasons" array as short
  bullet strings, not as prose outside the JSON.
- All reasoning happens silently before you write the JSON. The JSON
  is the entire response.

Schema:
{ "decision": "APPROVE" | "AUTO_FIX_AND_APPROVE" | "REJECT",
  "confidence": 0.0..1.0,
  "reasons": ["short reason", "..."],
  "cleanedDescription": "...",   // ONLY when decision is AUTO_FIX_AND_APPROVE
  "publicReason": "..."          // ONLY when decision is REJECT (shown to seller)
}

# CHECK 1 — PERSONAL contact details (in title, description, or any photo)

You are looking for ways a BUYER could reach the SELLER directly, off-platform.
Specifically these and NOTHING ELSE:

REJECT-worthy contact details:
- **Phone numbers** that look like a real SA number: 10 digits starting
  with 0 (e.g. 0821234567), or +27 prefix, or formatted with spaces /
  dashes / brackets. Must be 9–11 digits total. Stand-alone caliber or
  serial number digits are NOT phone numbers.
- **Email addresses** — anything with "@" + a TLD (.com, .co.za, etc).
- **WhatsApp / Telegram / Signal handles** — t.me/<name>, wa.me/<digits>,
  "WhatsApp 082...", "@<handle>" on a social platform.
- **Personal social-media handles** — Instagram / Facebook / TikTok
  usernames clearly identifying the seller (e.g. "@joes_guns_jhb",
  "find me on FB at /joeguns").
- **URLs / website domains** that point to the seller's own shop or
  channel (e.g. "joesguns.co.za", "shop.example.co.za"). Manufacturer /
  brand official sites mentioned in passing (glock.com, vortexoptics.com)
  are NOT a violation — they're product references, not seller contact.
- **Street addresses** that identify where the seller can be found IRL —
  e.g. "12 Main Road, Bellville" or "Shop 5, Tygervalley Centre". A
  province / city / suburb on its own is fine.

## CRITICAL — what is NOT a contact detail

DO NOT REJECT for any of these — they are PRODUCT MARKINGS, not
contact info:
- **Manufacturer brand names + logos** stamped, etched, engraved, or
  printed on the product itself: Glock, Sig Sauer, CZ, Beretta, Smith &
  Wesson, Ruger, Colt, Browning, Bergara, Tikka, Sako, Howa, Vortex,
  Leupold, Nikon, Bushnell, EOTech, Trijicon, Aimpoint, Magpul,
  Safariland, Blackhawk, Streamlight, Surefire, etc. ANY brand name is
  fine — the seller didn't put it there.
- **Model numbers / product names** on the item (e.g. "G17 Gen 5",
  "B14 HMR", "Strike Eagle 1-8x24", "X-Sight 4 Pro"). These are spec
  identifiers, not contact info.
- **Calibre stamps** on a barrel or receiver (e.g. "9x19", ".308 Win",
  ".223 REM"). These are technical markings.
- **Serial numbers** on a firearm. These are legal markings.
- **Country of origin / proof marks** (e.g. "Made in Austria", "CIP",
  Spanish proof marks).
- **Warranty stickers, country of manufacture text, importer/distributor
  markings on the box** (e.g. "Distributed by …" on the original
  packaging). These are NOT seller contact info — they came from the
  factory.
- **Safety / regulatory text** on optics or holsters (CE marks, FCC IDs).
- **Generic words** that happen to contain "@" or numbers in their proper
  product context (e.g. "Sig P226" — the "P226" is a model, not a
  number to call).

If the only "contact info" you can find is a brand/model name on a
product, the answer is APPROVE.

## Special cases

- **QR codes** in a photo: REJECT. Sellers use these to bypass the
  platform. Phrase it as "QR code visible in photo N — remove before
  publishing". One exception: a QR code that is clearly part of the
  product's own packaging (e.g. a small product-registration QR on a
  box label) — APPROVE. If unsure, REJECT and mention "QR code on the
  product packaging".
- **Watermarks / business signage** identifying a registered dealer
  store the buyer could walk into (e.g. "JoeS Guns CC, Bellville" on a
  letterhead). REJECT — that's a way to find the seller off-platform.
  Manufacturer authorised-dealer plaques on a wall behind the item are
  ambiguous; only flag when the plaque clearly identifies THIS seller's
  shop, not just "we sell Glock".

## Action per location

- Contact details in TITLE → REJECT with publicReason "Remove the
  phone/email/handle/address from the title."
- Contact details in DESCRIPTION only → AUTO_FIX_AND_APPROVE. Return
  cleanedDescription with each contact-detail replaced by [REDACTED].
  This is silent — the seller isn't told.
- Contact details in a PHOTO → REJECT with publicReason naming the
  photo and what was visible, e.g. "Phone number visible in photo 2".

# CHECK 2 — Blatantly advertised live ammo, primers, propellant

Selling live ammunition / primers / smokeless or black powder to private
buyers through the marketplace is illegal in SA — those need a licensed
dealer. Flag ONLY when the seller is clearly offering them for sale.

Examples of BLATANT advertising → REJECT:
- Title says "500 rounds of 9mm for sale"
- Description: "comes with 200 rounds included" / "bundled with 1000 CCI primers"
- Listing is in an Ammunition category AND describes live rounds for sale

NOT grounds to reject (these are fine):
- Spent brass cases, projectiles (bullets only, no case/primer/powder),
  reloading dies, shell holders, powder measures
- Ammunition visible in a photo background but NOT mentioned in the
  listing copy — incidental, the seller isn't selling it
- A scope listing with a few rounds on a mag in the frame
- "Sold with empty mag" — empty mag is fine

If in doubt about whether ammo is being advertised vs incidental, APPROVE.

# Everything else: APPROVE

You do NOT moderate:
- Whether the photos are "good enough" — admin reviews quality if needed
- Whether the category matches — the seller picked it, trust them
- Suppressors, threaded barrels, mods, SBRs — all legal in SA
- High-value listings — admin queue handles those separately
- Vague language, missing specs, condition claims you can't verify
- Manufacturer branding of any kind — see CRITICAL section above

Confidence should reflect how sure you are about contact details or
ammo advertising. Reasons should be short — 1–3 bullets max, each
quoting concrete text or naming the photo.`;

@Injectable()
export class ListingModerationService {
  private readonly logger = new Logger(ListingModerationService.name);
  private readonly client: Anthropic | null;

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  }

  // True only when the SDK is configured. ListingsService uses this to
  // decide whether to skip the network call entirely.
  get isEnabled(): boolean {
    return this.client !== null;
  }

  // Strip contact info locally as a deterministic safety net. The Claude
  // path can also produce a cleaned description, but we run this regex pass
  // on top so the output is predictable in tests and offline mode.
  stripContactInfo(text: string): { cleaned: string; changed: boolean } {
    const originals = text;
    let cleaned = text;

    // Email
    cleaned = cleaned.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[REDACTED]');
    // Phone-like (SA mobile/landline) — long runs of digits with optional spaces/dashes
    cleaned = cleaned.replace(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{3,4}[\s-]?\d{3,4}/g, '[REDACTED]');
    // URLs
    cleaned = cleaned.replace(/\bhttps?:\/\/\S+/gi, '[REDACTED]');
    cleaned = cleaned.replace(/\b(?:www\.)?[a-z0-9-]+\.(?:co\.za|com|net|org|io)\b\S*/gi, '[REDACTED]');
    // Social handles
    cleaned = cleaned.replace(/(?<=^|\s)@[A-Za-z0-9_.]+/g, '[REDACTED]');
    // WhatsApp keyword phrases
    cleaned = cleaned.replace(/whatsapp\s+(?:me\s+)?(?:on|at)\s+[\d+\s-]+/gi, '[REDACTED]');

    return { cleaned, changed: cleaned !== originals };
  }

  // Ask Claude to tighten + improve the seller's description while keeping
  // the same factual content. Returns the improved text, or the original
  // unchanged if Claude is unavailable / the response is invalid.
  // Polished by claude-sonnet (NOT Haiku — Haiku isn't strong enough at
  // recalling product specs to produce useful researched bullets). Returns
  // plain text formatted as TWO sections:
  //
  //   <polished seller bullets>
  //
  //   Specs & details
  //   <researched bullets>
  //
  // The frontend renders this in a preview box so the seller compares
  // against their own text and chooses "Use this" or "Keep original".
  // Lifted from the old project (gun_galore_project/backend/.../listings.service.ts
  // refineDescription) where this prompt was already tuned and working.
  async enhanceDescription(
    description: string,
    context: {
      title?: string;
      categoryName?: string;
      isFirearm?: boolean;
      make?: string;
      model?: string;
      calibre?: string;
      condition?: string;
    } = {},
  ): Promise<{ enhanced: string; changed: boolean; specsAdded: boolean }> {
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — returning unchanged description');
      return { enhanced: description, changed: false, specsAdded: false };
    }

    const system = `You are a listing assistant for Gun Galore, a South African used marketplace for firearms, accessories, and outdoor equipment.
Your job is to polish the seller's own draft AND append researched specs as a SEPARATE section below.

Output exactly this structure:

  <polished seller bullets>

  Specs & details
  <researched bullets>

Section 1 — Seller's words (top)
- Take the seller's draft and polish it into clean bullet points.
- Keep the seller's voice and intent. Fix grammar / typos / punctuation. Tighten phrasing.
- Never invent facts in this section. If the seller didn't mention something, don't put it here.
- 2–6 bullets depending on how much the seller wrote.

Section 2 — Specs & details (bottom, after a "Specs & details" line)
- Use your product knowledge to fill in factory specs the seller didn't mention.
- Cover useful spec categories where applicable:
    Make / model / variant (e.g. "Bergara B14 HMR, .308 Win")
    Calibre or chambering (firearms / ammo)
    Action type, barrel length, twist rate, capacity, weight (firearms)
    Material, finish, dimensions (accessories / knives)
    Battery, range, magnification, reticle (optics / electronics)
- 3–6 bullets. Stop when you don't have confident factual content.
- If the seller's bullets contradict factory specs, trust the seller (custom variant) and OMIT the conflicting spec from this section.

Hard rules:
- Use • as the bullet character. One fact per line.
- Plain South African English. No hype, no marketing fluff, no emoji.
- "Specs & details" is the ONLY heading allowed and only between the two sections.
- Do not invent serial numbers, prices, licence info, condition, round count, year of purchase, or any other seller-specific claim.
- Do not include price.
- Output ONLY the two sections — no preamble, no sign-off, no "here is your description" intro.
- If the seller's draft is empty, output only the Specs & details section (with the heading).
- Strip any contact info from the seller's words (phone / email / WhatsApp / URLs / social handles) — replace with [REDACTED].`;

    // Context block sits ABOVE the seller's draft. We pass the structured
    // fields the seller already filled in on the form so Claude has more
    // accurate research hooks than the title alone.
    const contextParts = [
      context.title ? `Item title: ${context.title}` : '',
      context.categoryName
        ? `Category: ${context.categoryName}${context.isFirearm ? ' (firearm)' : ''}`
        : '',
      context.make ? `Make: ${context.make}` : '',
      context.model ? `Model: ${context.model}` : '',
      context.calibre ? `Calibre: ${context.calibre}` : '',
      context.condition ? `Condition: ${context.condition}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const userContent = contextParts
      ? `${contextParts}\n\nSeller's draft description:\n${description}`
      : `Seller's draft description:\n${description}`;

    try {
      const msg = await this.client.messages.create({
        model: MODEL_JUDGE,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: userContent }],
      });
      const enhanced =
        msg.content.find((b) => b.type === 'text')?.text.trim() ?? '';
      if (!enhanced) {
        return { enhanced: description, changed: false, specsAdded: false };
      }
      // Defence-in-depth: run our local contact-info stripper on the
      // result. Claude usually catches them but the regex is the safety net.
      const stripped = this.stripContactInfo(enhanced).cleaned;
      const specsAdded = /^|\n\s*Specs\s*(?:&|and)\s*details\s*$/im.test(stripped);
      return {
        enhanced: stripped,
        changed: stripped !== description.trim(),
        specsAdded,
      };
    } catch (err) {
      this.logger.error(
        `Description enhancement failed: ${(err as Error).message}`,
      );
      return { enhanced: description, changed: false, specsAdded: false };
    }
  }

  async moderate(input: ListingModerationInput): Promise<ListingModerationResult> {
    // Offline / SDK not configured → human review (fail-open safety net per CLAUDE.md)
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — listing routed to HUMAN_REVIEW');
      return {
        decision: 'HUMAN_REVIEW',
        confidence: 0,
        reasons: ['Moderation API not configured — manual review queued'],
      };
    }

    // Decide which photo channel to use, in priority order:
    //   1. Real Cloudinary URLs (post-upload moderation, cheaper payload).
    //   2. Base64 staged photos (preview-before-upload).
    //   3. Nothing — only the count is passed.
    const photosAttached =
      input.imageUrls.length > 0 ||
      (input.imagesBase64?.length ?? 0) > 0;
    const photosNote = photosAttached
      ? `${input.imageCount} (${input.imageUrls.length || input.imagesBase64?.length} attached below for vision review)`
      : `${input.imageCount} (not included in this preview — text-only pass)`;

    const userContent: Anthropic.MessageParam['content'] = [
      {
        type: 'text',
        text:
          `Title: ${input.title}\n` +
          `Category: ${input.categoryName}` +
          (input.categoryIsFirearm ? ' (firearm category)' : '') +
          '\n' +
          (input.priceCents !== null
            ? `Price: R${(input.priceCents / 100).toFixed(2)}\n`
            : 'Price: not set (Take a Shot)\n') +
          (input.compareAtPriceCents
            ? `Seller-claimed original ("was") price: R${(input.compareAtPriceCents / 100).toFixed(2)} — shown to buyers as a strikethrough discount. Flag if this looks like a fabricated anchor (CPA s41).\n`
            : '') +
          `Photos staged: ${photosNote}\n` +
          (input.sellerFirstFirearmListings
            ? 'Seller note: this is one of the first firearm listings from a new seller — be cautious.\n'
            : '') +
          `\nDescription:\n${input.description}`,
      },
    ];

    // Attach vision inputs. URLs first (always smaller for Sonnet), then
    // base64. We cap at 5 photos to keep token cost predictable — the
    // Sell form max is 5 so this should never truncate in practice.
    const MAX_VISION_PHOTOS = 5;
    let attached = 0;
    for (const url of input.imageUrls) {
      if (attached >= MAX_VISION_PHOTOS) break;
      userContent.push({
        type: 'image',
        source: { type: 'url', url },
      });
      attached++;
    }
    if (input.imagesBase64) {
      for (const img of input.imagesBase64) {
        if (attached >= MAX_VISION_PHOTOS) break;
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.data,
          },
        });
        attached++;
      }
    }

    try {
      const msg = await this.client.messages.create({
        // Sonnet — moderation needs careful reading of the description
        // AND vision of the photos. Haiku was prone to hallucination.
        model: MODEL_JUDGE,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      });

      const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
      const parsed = extractJsonObject(text);
      if (!parsed) {
        // Even after the lenient extractor failed, fall back to
        // APPROVE rather than HUMAN_REVIEW. The previous behaviour
        // shoved every parse miss into the admin queue with a 0%
        // confidence banner that looked alarming to sellers. Since
        // we only flag two things (contact details + advertised
        // ammo), a parse failure is overwhelmingly likely on a clean
        // listing where Claude rambled in prose instead of JSON —
        // approving is the safer default. The error is still logged
        // for the operator.
        this.logger.error(
          `Could not parse Claude moderation JSON — defaulting to APPROVE. Body was: ${text.slice(0, 300)}`,
        );
        return {
          decision: 'APPROVE',
          confidence: 0.5,
          reasons: [],
        };
      }

      // Defensive parsing
      const decision = (
        ['APPROVE', 'AUTO_FIX_AND_APPROVE', 'REJECT', 'HUMAN_REVIEW'] as const
      ).includes(parsed.decision as ClaudeDecision)
        ? (parsed.decision as ClaudeDecision)
        : 'HUMAN_REVIEW';

      const confidence =
        typeof parsed.confidence === 'number' &&
        parsed.confidence >= 0 &&
        parsed.confidence <= 1
          ? parsed.confidence
          : 0.5;

      const reasons = Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === 'string').slice(0, 8)
        : [];

      const result: ListingModerationResult = {
        decision,
        confidence,
        reasons,
      };

      if (decision === 'AUTO_FIX_AND_APPROVE' && typeof parsed.cleanedDescription === 'string') {
        result.cleanedDescription = parsed.cleanedDescription;
      }
      if (decision === 'REJECT' && typeof parsed.publicReason === 'string') {
        result.publicReason = parsed.publicReason;
      }

      return result;
    } catch (err) {
      this.logger.error(
        `Anthropic API error during listing moderation: ${(err as Error).message}`,
      );
      // Fail open — never block on API error. Same rationale as the
      // parse-failure fallback above: a transient Anthropic outage
      // shouldn't park every listing in the admin queue. The error
      // is logged; if outages persist the operator notices via the
      // log.
      return {
        decision: 'APPROVE',
        confidence: 0.5,
        reasons: [],
      };
    }
  }
}

// Extract the first balanced JSON object from arbitrary text. Tolerant
// of:
//   - Code fences (```json ... ```)
//   - Leading prose / chain-of-thought ("First I'll check ... here's
//     the result: { ... }")
//   - Trailing prose
//   - Brace characters appearing inside JSON string values (proper
//     depth-tracking ignores braces inside quoted strings)
// Returns the parsed object on success, or null if no balanced object
// could be found / parsed.
function extractJsonObject(
  raw: string,
): Partial<ListingModerationResult> | null {
  if (!raw) return null;

  // Strip markdown fences if the whole reply is wrapped in one.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // Fast path: the whole reply IS valid JSON.
  if (stripped.startsWith('{')) {
    try {
      return JSON.parse(stripped) as Partial<ListingModerationResult>;
    } catch {
      // fall through to balanced-scan
    }
  }

  // Slow path: walk the string, find each '{', and try to parse a
  // balanced object starting from that position. Stops on first
  // success.
  for (let start = 0; start < stripped.length; start++) {
    if (stripped[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < stripped.length; i++) {
      const ch = stripped[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = stripped.slice(start, i + 1);
          try {
            return JSON.parse(candidate) as Partial<ListingModerationResult>;
          } catch {
            break; // try the next '{'
          }
        }
      }
    }
  }
  return null;
}
