import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Resale-value estimator (audit finding: a seller-acquisition magnet nothing
// else in SA offers). Produces an INDICATIVE, non-binding price range for a
// secondhand item, from — in priority order:
//   1. real SOLD comps (aggregate only, POPIA-safe — never individual rows),
//   2. a web-anchored SA retail price depreciated by condition (leads while
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

// Per-user daily ceiling on the billed web-anchor (Haiku + web search),
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

// Bound the AI spend: one Haiku + web-search call per DISTINCT item per day.
const WEB_ANCHOR_TTL_MS = 24 * 60 * 60 * 1000;
const WEB_ANCHOR_CACHE_MAX = 500;

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
  private readonly client: Anthropic | null;
  private readonly model: string;
  // itemKey -> { retailZar (rands, null = looked-up-but-not-found), at }
  private readonly webAnchorCache = new Map<
    string,
    { retailZar: number | null; at: number }
  >();
  // clerkUserId -> { day (YYYY-MM-DD), count } — per-user daily web-anchor budget.
  private readonly webAnchorUserBudget = new Map<
    string,
    { day: string; count: number }
  >();

  constructor(private readonly prisma: PrismaService) {
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
    this.model =
      process.env.ANTHROPIC_MODEL_PRICE_ESTIMATE ?? 'claude-haiku-4-5-20251001';
  }

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
          note: `Based on ${soldCount} recent sales of similar items on Gun Galore.`,
          disclaimer: DISCLAIMER,
        };
      }
    }

    // ── 2. Web-anchored SA retail, depreciated by condition (leads while the
    // comp base is thin). One cached Haiku + web-search call per item/day,
    // hard-capped per user.
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
  private async webRetailAnchor(
    input: PriceEstimateInput,
    make?: string,
    model?: string,
  ): Promise<number | null> {
    if (!this.client) return null;
    const descriptor = [make, model, input.title?.trim()]
      .filter(Boolean)
      .join(' ')
      .trim();
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
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 1,
          } as never,
        ],
        messages: [
          {
            role: 'user',
            content:
              `You are pricing a piece of outdoor / hunting / fishing / shooting gear for a South African secondhand marketplace. ` +
              `Item: "${descriptor}". ` +
              `Use web search to find the CURRENT typical NEW retail price in South Africa, in South African Rand (ZAR). ` +
              `Prefer SA retailers; if only a foreign price exists, convert roughly to ZAR. ` +
              `Respond with ONLY a JSON object and nothing else: {"retailZar": <number or null>, "note": "<short source note>"}. ` +
              `retailZar is the new retail price in whole rands (not cents). Use null if you cannot find a credible price.`,
          },
        ],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const parsed = this.extractJson(text);
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
