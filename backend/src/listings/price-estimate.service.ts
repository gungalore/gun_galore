import { Injectable, Logger } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { sanitizePromptValue } from '../common/prompt-sanitize';

// Resale-value estimator (audit finding: a seller-acquisition magnet nothing
// else in SA offers). Produces an INDICATIVE, non-binding price range for a
// secondhand item, from — in priority order:
//   1. real SOLD comps (aggregate only, POPIA-safe — never individual rows),
//   2. a model-recalled SA retail price depreciated by condition (leads while
//      the comp base is thin — the audit's explicit cold-start strategy),
//   3. current asking prices of similar ACTIVE listings (weakest — asks, not
//      realised, discounted to approximate a sale).
// CPA s41: every result is labelled indicative, never a valuation or a price
// the platform represents as correct — the seller always sets their own price.

// A settled sale = the buyer paid (money captured + held) OR it was released.
// Matches the P5.6 sold-comps definition. Refund CHILDREN (refundOfId set) are
// excluded; a fully-refunded parent is REFUNDED so the status filter drops it.
const SETTLED_STATUSES: PaymentStatus[] = [
  PaymentStatus.HELD,
  PaymentStatus.RELEASED,
];

// Comps only carry weight once there are enough that a returned low/high/mid
// can't just BE three individual realised prices — that would let a party to
// one of the sales read back the others' exact takes (POPIA re-identification).
// Matches the reviewed P5.6 sold-comps floor (SOLD_COMPS_MIN_COUNT = 5); we
// additionally bucket the output (see roundTo50) so no returned figure is ever
// an exact realised price.
const MIN_COMPS_FOR_PRIMARY = 5;
const HIGH_CONFIDENCE_COMPS = 8;

// Coarse-bucket every returned figure to the nearest R50 so an aggregate can't
// echo an exact realised sale price (extra POPIA dilution on top of the min gate).
const BUCKET_CENTS = 5000;
function roundTo50(cents: number): number {
  return Math.round(cents / BUCKET_CENTS) * BUCKET_CENTS;
}

// Per-user daily ceiling on the billed web-anchor (one model call),
// independent of IP or the query string — the real backstop against a
// denial-of-wallet loop (IP-based throttling + cache-key variation can both be
// gamed; a per-Clerk-user counter can't). Over the cap → skip the web anchor.
const MAX_WEB_ANCHOR_PER_USER_PER_DAY = 40;

// Fraction of a NEW SA retail price a secondhand item typically fetches, by
// condition. Rough SA-market heuristics — deliberately conservative, and the
// output is always framed as a guide, so a wrong anchor mis-guides rather than
// mis-represents. Applied only on the web-retail path.
const CONDITION_DEPRECIATION: Record<string, number> = {
  NEW: 0.85,
  LIKE_NEW: 0.72,
  GOOD: 0.58,
  FAIR: 0.42,
  POOR: 0.28,
};

// Asks run above realised prices; nudge the active-listing fallback down so we
// don't over-quote the seller.
const ASK_TO_SALE_FACTOR = 0.9;

// Bound the AI spend: one web-anchor model call per DISTINCT item per day.
const WEB_ANCHOR_TTL_MS = 24 * 60 * 60 * 1000;
const WEB_ANCHOR_CACHE_MAX = 500;

// The shape the anchor call must answer in. Passed as LlmRequest.json.schema
// so the provider enforces it; extractJson below stays as the tolerant parse.
const WEB_ANCHOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    retailZar: {
      type: ['number', 'null'],
      description: 'New retail price in whole South African rands, or null.',
    },
    note: { type: 'string', description: 'Short source note.' },
  },
  required: ['retailZar'],
};

const DISCLAIMER =
  'Indicative guide only — not a valuation or a guaranteed price. You set your own price.';

export interface PriceEstimateInput {
  categoryId?: string;
  categorySlug?: string;
  make?: string;
  model?: string;
  title?: string;
  condition?: string;
  // Clerk user id — used ONLY to enforce the per-user daily web-anchor cap.
  // Absent from the Ask GG path (bounded by the message quota instead).
  userId?: string;
}

export interface PriceEstimateResult {
  available: boolean;
  low?: number; // ZAR cents
  high?: number; // ZAR cents
  midpoint?: number; // ZAR cents
  confidence?: 'low' | 'medium' | 'high';
  basis?: 'sold-comps' | 'web-retail' | 'active-asks';
  soldCount: number;
  activeCount: number;
  note?: string;
  disclaimer: string;
}

@Injectable()
export class PriceEstimateService {
  private readonly logger = new Logger(PriceEstimateService.name);
  // itemKey -> { retailZar (rands, null = looked-up-but-not-found), at }
  private readonly webAnchorCache = new Map<
    string,
    { retailZar: number | null; at: number }
  >();
  // userId -> { day (YYYY-MM-DD), count } — per-user daily web-anchor budget.
  private readonly webAnchorUserBudget = new Map<
    string,
    { day: string; count: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async estimate(input: PriceEstimateInput): Promise<PriceEstimateResult> {
    const condition = this.normaliseCondition(input.condition);
    const make = input.make?.trim() || undefined;
    const model = input.model?.trim() || undefined;

    const empty: PriceEstimateResult = {
      available: false,
      soldCount: 0,
      activeCount: 0,
      disclaimer: DISCLAIMER,
    };

    const categoryFilter = this.buildCategoryFilter(input);
    // Item scoping — a make (tight) or, when the caller has no make field (the
    // sell form AI-extracts make from the title, so it never sends one), the
    // first few title words as a make/model proxy so the comps/asks paths are
    // still reachable, e.g. "Engel MT45 fridge" → "Engel MT45". Guarded to a
    // meaningful length so a one-word generic title doesn't over-match.
    const titlePhrase = this.titlePhrase(input.title);
    const canScope = !!(categoryFilter && (make || titlePhrase));
    if (!categoryFilter && !make && !titlePhrase) {
      return { ...empty, note: 'Add a category and title to get an estimate.' };
    }

    // ── 1. Real sold comps (scoped to the item via make or title proxy — a
    // category-only spread is too wide to lead with).
    let soldCount = 0;
    if (canScope) {
      const perUnit = make
        ? await this.gatherSoldComps(categoryFilter!, make, model)
        : await this.gatherSoldCompsByTitle(categoryFilter!, titlePhrase!);
      soldCount = perUnit.length;
      if (soldCount >= MIN_COMPS_FOR_PRIMARY) {
        const { low, high, mid } = this.bucketRange(this.range(perUnit));
        return {
          available: true,
          low,
          high,
          midpoint: mid,
          confidence: soldCount >= HIGH_CONFIDENCE_COMPS ? 'high' : 'medium',
          basis: 'sold-comps',
          soldCount,
          activeCount: 0,
          note: `Based on ${soldCount} recent sales of similar items on All Outdoor.`,
          disclaimer: DISCLAIMER,
        };
      }
    }

    // ── 2. Web-anchored SA retail, depreciated by condition (leads while the
    // comp base is thin). One cached model call per item/day, hard-capped
    // per user.
    const retailZar = await this.webRetailAnchor(input, make, model);
    if (retailZar != null && retailZar > 0) {
      const factor = CONDITION_DEPRECIATION[condition];
      const point = retailZar * 100 * factor; // cents
      const { low, high, mid } = this.bucketRange({
        low: Math.round(point * 0.88),
        high: Math.round(point * 1.12),
        mid: Math.round(point),
      });
      return {
        available: true,
        low,
        high,
        midpoint: mid,
        confidence: 'low',
        basis: 'web-retail',
        soldCount,
        activeCount: 0,
        note: `Estimated from a typical new SA retail price, adjusted for ${this.conditionLabel(condition)} condition. Local sales data is still thin.`,
        disclaimer: DISCLAIMER,
      };
    }

    // ── 3. Active asking prices of similar listings (weakest — discounted).
    if (canScope) {
      const asks = make
        ? await this.gatherActiveAsks(categoryFilter!, make, model)
        : await this.gatherActiveAsksByTitle(categoryFilter!, titlePhrase!);
      if (asks.length >= MIN_COMPS_FOR_PRIMARY) {
        const discounted = asks.map((c) => Math.round(c * ASK_TO_SALE_FACTOR));
        const { low, high, mid } = this.bucketRange(this.range(discounted));
        return {
          available: true,
          low,
          high,
          midpoint: mid,
          confidence: 'low',
          basis: 'active-asks',
          soldCount,
          activeCount: asks.length,
          note: `Based on ${asks.length} similar items listed now (asking prices, nudged down).`,
          disclaimer: DISCLAIMER,
        };
      }
      return {
        ...empty,
        soldCount,
        activeCount: asks.length,
        note: 'Not enough comparable sales or listings yet to estimate this one.',
      };
    }

    return {
      ...empty,
      soldCount,
      note: 'Not enough data to estimate this item yet — set a price you think is fair.',
    };
  }

  // First up-to-3 words of the title as a make/model proxy; null if too short
  // to be a useful, non-over-matching scope.
  private titlePhrase(title?: string): string | undefined {
    const phrase = (title ?? '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')
      .trim();
    return phrase.length >= 4 ? phrase : undefined;
  }

  private bucketRange(r: { low: number; high: number; mid: number }): {
    low: number;
    high: number;
    mid: number;
  } {
    return {
      low: roundTo50(r.low),
      high: roundTo50(r.high),
      mid: roundTo50(r.mid),
    };
  }

  // ── comps ──────────────────────────────────────────────────────────────
  private async gatherSoldComps(
    categoryFilter: Record<string, unknown>,
    make: string,
    model?: string,
  ): Promise<number[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: { in: SETTLED_STATUSES },
        refundOfId: null,
        listing: {
          status: 'SOLD',
          isDealListing: false, // deep house-deal sales must not skew comps
          category: categoryFilter,
          make: { equals: make, mode: 'insensitive' },
          ...(model ? { model: { equals: model, mode: 'insensitive' } } : {}),
        },
      },
      select: { listingPrice: true, quantity: true },
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => Math.round(r.listingPrice / Math.max(1, r.quantity)));
  }

  private async gatherActiveAsks(
    categoryFilter: Record<string, unknown>,
    make: string,
    model?: string,
  ): Promise<number[]> {
    const rows = await this.prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        isDealListing: false, // exclude first-party Daily Deals from comps
        price: { not: null },
        category: categoryFilter,
        make: { equals: make, mode: 'insensitive' },
        ...(model ? { model: { equals: model, mode: 'insensitive' } } : {}),
      },
      select: { price: true },
      take: 200,
    });
    return rows
      .map((r) => r.price)
      .filter((p): p is number => typeof p === 'number' && p > 0);
  }

  // Title-proxy comps — used when the caller has no make field (sell form).
  // Matches SOLD listings in the category whose title CONTAINS the proxy
  // phrase ("Engel MT45"), which is far narrower than the whole category yet
  // reachable without a make column value.
  private async gatherSoldCompsByTitle(
    categoryFilter: Record<string, unknown>,
    phrase: string,
  ): Promise<number[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: { in: SETTLED_STATUSES },
        refundOfId: null,
        listing: {
          status: 'SOLD',
          isDealListing: false, // deep house-deal sales must not skew comps
          category: categoryFilter,
          title: { contains: phrase, mode: 'insensitive' },
        },
      },
      select: { listingPrice: true, quantity: true },
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => Math.round(r.listingPrice / Math.max(1, r.quantity)));
  }

  private async gatherActiveAsksByTitle(
    categoryFilter: Record<string, unknown>,
    phrase: string,
  ): Promise<number[]> {
    const rows = await this.prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        isDealListing: false, // exclude first-party Daily Deals from comps
        price: { not: null },
        category: categoryFilter,
        title: { contains: phrase, mode: 'insensitive' },
      },
      select: { price: true },
      take: 200,
    });
    return rows
      .map((r) => r.price)
      .filter((p): p is number => typeof p === 'number' && p > 0);
  }

  private buildCategoryFilter(
    input: PriceEstimateInput,
  ): Record<string, unknown> | null {
    if (input.categorySlug) {
      return {
        OR: [
          { slug: input.categorySlug },
          { parent: { slug: input.categorySlug } },
        ],
      };
    }
    if (input.categoryId) {
      return { OR: [{ id: input.categoryId }, { parentId: input.categoryId }] };
    }
    return null;
  }

  // ── web anchor ─────────────────────────────────────────────────────────
  //
  // ⚠️ THE "WEB" IN web-retail IS A REAL SEARCH AGAIN (2026-09-07), AND IT
  // COSTS TWO CALLS. It was Anthropic's server-side `web_search_20250305` with
  // max_uses 1; the provider move to Gemini briefly reduced it to the model's
  // own recall, because the neutral contract had no way to say "search". It
  // does now — `grounding: { web: true }` — but on Gemini 2.5 that pairs with
  // NEITHER json mode NOR tools, and the json pairing fails QUIETLY: a search
  // runs and is billed while groundingChunks comes back empty. So the anchor
  // is two steps and must stay two steps:
  //
  //   1. GROUND. A prose call that searches and reports what SA retailers are
  //      actually asking, with the shop named. No schema — none is allowed.
  //   2. EXTRACT. A `json: { schema }` call over step 1's OWN TEXT and nothing
  //      else, which is the cheap, deterministic half. It reads what step 1
  //      found; it is explicitly forbidden to supply a price of its own, so a
  //      failed search cannot be laundered into a recalled number by the
  //      second model turn.
  //
  // ⚠️ BASIS AND CONFIDENCE DO NOT MOVE. This still reports basis
  // 'web-retail' at confidence 'low', and it should: a grounded NEW retail
  // price is a good input to a rough SECONDHAND estimate, not a good estimate.
  // The uncertainty that keeps this 'low' lives in CONDITION_DEPRECIATION —
  // five hand-set fractions — not in whether the retail figure was searched.
  // Everything is still bucketed to R50 and labelled indicative under CPA s41.
  //
  // Both steps sit inside ONE try/catch and one cache entry: a failure at
  // either returns null, exactly as before, and the caller falls through to
  // active asks. The per-user daily budget is charged once per anchor, not
  // once per call — the second call is an implementation detail of the first.
  private async webRetailAnchor(
    input: PriceEstimateInput,
    make?: string,
    model?: string,
  ): Promise<number | null> {
    if (!this.llm.isConfigured()) return null;
    // Seller-typed make/model/title — sanitised (newlines/quotes stripped,
    // capped) before interpolation so a crafted title can't break out of
    // the quoted span or smuggle instructions into the web-search prompt
    // (injection audit fix 2026-07-20).
    const descriptor = sanitizePromptValue(
      [make, model, input.title?.trim()].filter(Boolean).join(' '),
      160,
    );
    if (!descriptor) return null;

    // Normalise the cache key so trivial string variation ("tent", "tent ",
    // "tent." …) can't force a fresh billed call each time — collapse to
    // lowercase alphanumeric words, capped in length.
    const key = descriptor
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!key) return null;
    const cached = this.webAnchorCache.get(key);
    if (cached && Date.now() - cached.at < WEB_ANCHOR_TTL_MS) {
      return cached.retailZar;
    }

    // Hard per-user daily ceiling on the billed anchor — the real backstop
    // against a denial-of-wallet loop (IP throttling + key variation are both
    // gameable). No userId (Ask GG path) → skip this gate (quota bounds it).
    if (input.userId && !this.consumeUserWebAnchorBudget(input.userId)) {
      return null;
    }

    let retailZar: number | null = null;
    try {
      // ── step 1: search ──────────────────────────────────────────────
      const found = await this.llm.complete({
        messages: [
          {
            role: 'user',
            content:
              `You are pricing a piece of outdoor / hunting / fishing / shooting gear for a South African secondhand marketplace. ` +
              `Item: "${descriptor}". ` +
              `Search the web for what South African retailers are CURRENTLY asking for this item BRAND NEW, and report what you find in a few plain sentences. ` +
              `Name the retailer beside each price. Prefer South African shops; if you can only find a foreign price, say which country and currency it was in. ` +
              `If the search turns up nothing credible for this exact item, say so plainly — do not fall back on a price you remember.`,
          },
        ],
        maxTokens: 700,
        grounding: { web: true },
        // ⚠️ NO `thinking: { budgetTokens: 0 }` HERE. This step has to read
        // several results and pick the ones that are the same item; the
        // extraction step below is the one that wants no reasoning.
        purpose: 'listing.price-estimate.search',
        timeoutMs: 30_000,
      });

      // ── step 2: extract ─────────────────────────────────────────────
      // ⚠️ THE ONLY INPUT IS STEP 1'S TEXT. The descriptor is deliberately
      // NOT repeated here: give this turn the item and it can answer from
      // memory when the search found nothing, which is precisely the
      // recalled price the grounded step exists to replace.
      const resp = await this.llm.complete({
        system:
          'You extract one number from a research note. Use ONLY what the note says. ' +
          'If the note reports no credible South African retail price, answer null — never supply a price of your own.',
        messages: [
          {
            role: 'user',
            content:
              `Research note:\n"""\n${found.text.slice(0, 4000)}\n"""\n\n` +
              `Give the typical CURRENT new retail price in South Africa in whole South African Rand (not cents). ` +
              `If the note only carries a foreign price, convert it roughly to ZAR. ` +
              `Use null if the note reports no credible price. Put the retailer(s) the note names in the note field.`,
          },
        ],
        maxTokens: 512,
        json: { schema: WEB_ANCHOR_SCHEMA },
        thinking: { budgetTokens: 0 },
        purpose: 'listing.price-estimate',
      });
      const parsed = this.extractJson(resp.text);
      const val = parsed?.retailZar;
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        retailZar = val;
      }
    } catch (err) {
      this.logger.warn(
        `web retail anchor failed for "${descriptor}": ${(err as Error).message}`,
      );
      retailZar = null;
    }

    // Cache the outcome (including a not-found null) to avoid re-billing the
    // same item; evict oldest when full.
    if (this.webAnchorCache.size >= WEB_ANCHOR_CACHE_MAX) {
      const oldest = this.webAnchorCache.keys().next().value;
      if (oldest !== undefined) this.webAnchorCache.delete(oldest);
    }
    this.webAnchorCache.set(key, { retailZar, at: Date.now() });
    return retailZar;
  }

  private extractJson(text: string): { retailZar?: unknown; note?: unknown } | null {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as { retailZar?: unknown; note?: unknown };
    } catch {
      return null;
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private range(pricesCents: number[]): { low: number; high: number; mid: number } {
    const sorted = [...pricesCents].sort((a, b) => a - b);
    if (sorted.length < 4) {
      return {
        low: sorted[0],
        high: sorted[sorted.length - 1],
        mid: sorted[Math.floor(sorted.length / 2)],
      };
    }
    return {
      low: this.percentile(sorted, 0.25),
      high: this.percentile(sorted, 0.75),
      mid: this.percentile(sorted, 0.5),
    };
  }

  private percentile(sorted: number[], p: number): number {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round((sorted.length - 1) * p)),
    );
    return sorted[idx];
  }

  // Returns true (and increments) while the user is under the daily web-anchor
  // ceiling; false once they've hit it. Day-keyed so it resets at UTC midnight;
  // the map is tiny (one entry per active seller/day) and self-prunes on read.
  private consumeUserWebAnchorBudget(userId: string): boolean {
    const day = new Date().toISOString().slice(0, 10);
    const cur = this.webAnchorUserBudget.get(userId);
    if (!cur || cur.day !== day) {
      this.webAnchorUserBudget.set(userId, { day, count: 1 });
      return true;
    }
    if (cur.count >= MAX_WEB_ANCHOR_PER_USER_PER_DAY) return false;
    cur.count += 1;
    return true;
  }

  private normaliseCondition(c?: string): string {
    const up = (c ?? '').toUpperCase();
    return CONDITION_DEPRECIATION[up] !== undefined ? up : 'GOOD';
  }

  private conditionLabel(c: string): string {
    return c.toLowerCase().replace('_', ' ');
  }
}
