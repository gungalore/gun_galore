import { SellerTier } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// THE SELLER TRUST SCORE, IN ONE PURE FUNCTION.
//
// Audit, 2026-11-27: the dashboard painted six bars, and four of them were
// FABRICATED from `trustScore × weight` on the client — no caller ever saw the
// per-component points the score was actually built from. Two of the real
// components were also wrong:
//
//   • DELIVERY SUCCESS PENALISED HONEST SELLERS. It divided by EVERY
//     non-refunded transaction (HELD/in-flight included) and counted only
//     `shippingStatus = DELIVERED` — so a seller with three in-flight orders
//     scored 2/5, and a collection (COLLECTED, never DELIVERED) scored zero.
//   • SWAP LEGS COUNTED. Synthetic swap settlement/refund rows are accounting
//     entries, not sales; they inflated denominators and could never be rated.
//
// ⚠️ THE RULE THE SCORE AND THE TIER BOTH USE: a sale is COMPLETE when
// `paymentStatus = RELEASED` (and it is not a swap leg). Delivery success is
// the share of those completed sales whose shipping status is DELIVERED or
// COLLECTED. In-flight (HELD), refunded and swap rows are excluded everywhere.
//
// PURE — no Prisma, no clock (the clock is a parameter), so every band and
// threshold is testable.
// ────────────────────────────────────────────────────────────────────

/** The six components, in the order the dashboard renders them. */
export interface TrustComponents {
  /** Completed sales, max 25 — 25 sales earns the cap. */
  sales: number;
  /** Average star rating, max 25 — 5.0★ earns the cap. */
  rating: number;
  /** Delivery success over completed sales, max 20. */
  delivery: number;
  /** Paid→dispatched speed, max 15; DEFAULT when there is no data. */
  dispatch: number;
  /** Listing quality (avg moderation confidence), max 10. */
  quality: number;
  /** Account age, max 5 — full at two years. */
  age: number;
}

export interface TrustResult {
  trustScore: number;
  components: TrustComponents;
  /** RELEASED, non-swap sales. The number the tier is computed from. */
  completedSales: number;
  /** Mean stars over completed sales, to one decimal, or null. */
  averageRating: number | null;
  tier: SellerTier;
}

/** The transaction columns this calculator reads. */
export interface TrustTransactionRow {
  paymentStatus: string;
  shippingStatus?: string | null;
  paidAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  /** Present only on synthetic swap money rows — excluded from every count. */
  swapId?: string | null;
  rating?: { stars: number } | null;
}

/** The listing columns this calculator reads. */
export interface TrustListingRow {
  claudeConfidence?: number | null;
}

export interface TrustInput {
  transactions: readonly TrustTransactionRow[];
  listings: readonly TrustListingRow[];
  createdAt: Date | string;
  /** Injected so the age component is deterministic in tests. */
  now?: Date;
}

/**
 * ⚠️ KEPT AT 7.5 ON PURPOSE. A seller with no dispatch data must not be
 * rewarded (15) or punished (0) for history they do not have; 7.5 is half of
 * the 15-point component and is documented here and in the guide book.
 */
export const DISPATCH_DEFAULT_POINTS = 7.5;

/** The maximum each component can earn. Order matches the dashboard. */
export const TRUST_COMPONENT_MAX = {
  sales: 25,
  rating: 25,
  delivery: 20,
  dispatch: 15,
  quality: 10,
  age: 5,
} as const;

const DELIVERED_STATES = new Set(['DELIVERED', 'COLLECTED']);

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The tier bands, unchanged from the original score. Sales are the volume gate
 * and the score the quality gate: 3/50 ESTABLISHED, 10/70 TRUSTED, 25/85
 * TOP_SELLER. DEALER is retired (2026-09) and never returned.
 */
export function tierFor(completedSales: number, trustScore: number): SellerTier {
  if (completedSales >= 25 && trustScore >= 85) return 'TOP_SELLER';
  if (completedSales >= 10 && trustScore >= 70) return 'TRUSTED';
  if (completedSales >= 3 && trustScore >= 50) return 'ESTABLISHED';
  return 'NEW';
}

export function computeTrust(input: TrustInput): TrustResult {
  const now = input.now ?? new Date();

  /**
   * ⚠️ SWAP LEGS ARE NOT SALES. They are synthetic settlement/refund rows
   * (`swapId` set): counting one in the denominator made a seller's delivery
   * rate depend on how the platform booked a swap, and the rating path already
   * refuses them.
   */
  const sales = input.transactions.filter((t) => !t.swapId);
  /** A COMPLETED SALE is RELEASED money. Everything else is in flight or out. */
  const released = sales.filter((t) => t.paymentStatus === 'RELEASED');
  const completedSales = released.length;

  // Component 1 — Completed sales (max 25)
  const salesScore = Math.min(TRUST_COMPONENT_MAX.sales, completedSales);

  // Component 2 — Rating average over completed sales (max 25)
  const stars = released
    .filter((t) => t.rating)
    .map((t) => t.rating!.stars);
  const avgRating =
    stars.length > 0 ? stars.reduce((sum, value) => sum + value, 0) / stars.length : 0;
  const ratingScore =
    (avgRating / 5) * TRUST_COMPONENT_MAX.rating;

  // Component 3 — Delivery success over COMPLETED sales (max 20)
  // ⚠️ COLLECTED IS A SUCCESS. A firearm collection is never stamped DELIVERED.
  // ⚠️ NO COMPLETED SALES = 0, not a perfect score.
  const delivered = released.filter(
    (t) => t.shippingStatus != null && DELIVERED_STATES.has(t.shippingStatus),
  ).length;
  const deliveryScore =
    completedSales > 0
      ? (delivered / completedSales) * TRUST_COMPONENT_MAX.delivery
      : 0;

  // Component 4 — Dispatch speed (max 15): avg hours paid→dispatched
  const dispatched = released.filter((t) => t.paidAt && t.dispatchedAt);
  let dispatchScore = DISPATCH_DEFAULT_POINTS;
  if (dispatched.length > 0) {
    const avgHours =
      dispatched.reduce((sum, t) => {
        const hours =
          (new Date(t.dispatchedAt!).getTime() -
            new Date(t.paidAt!).getTime()) /
          3_600_000;
        return sum + hours;
      }, 0) / dispatched.length;
    dispatchScore =
      avgHours < 24 ? 15 : avgHours < 48 ? 10 : avgHours < 72 ? 5 : 0;
  }

  // Component 5 — Listing quality (max 10): avg moderation confidence
  const avgConfidence =
    input.listings.length > 0
      ? input.listings.reduce(
          (sum, listing) => sum + (listing.claudeConfidence ?? 0.5),
          0,
        ) / input.listings.length
      : 0.5;
  const qualityScore = avgConfidence * TRUST_COMPONENT_MAX.quality;

  // Component 6 — Account age (max 5, full at two years)
  const ageYears =
    (now.getTime() - new Date(input.createdAt).getTime()) /
    (1_000 * 60 * 60 * 24 * 365);
  const ageScore = Math.min(
    TRUST_COMPONENT_MAX.age,
    (ageYears / 2) * TRUST_COMPONENT_MAX.age,
  );

  /**
   * ⚠️ THE COMPONENTS ARE THE TRUE POINTS, NOT ROUNDED BARS. `trustScore` is
   * their sum rounded to the integer the database stores; the dispatch default
   * of 7.5 is deliberately kept, so `Math.round(Σ components) === trustScore`
   * is the reconciliation the dashboard test asserts. A component can never
   * exceed its own cap.
   */
  const components: TrustComponents = {
    sales: round2(salesScore),
    rating: round2(ratingScore),
    delivery: round2(deliveryScore),
    dispatch: round2(dispatchScore),
    quality: round2(qualityScore),
    age: round2(ageScore),
  };
  const trustScore = Math.round(
    components.sales +
      components.rating +
      components.delivery +
      components.dispatch +
      components.quality +
      components.age,
  );

  return {
    trustScore,
    components,
    completedSales,
    averageRating: stars.length > 0 ? Math.round(avgRating * 10) / 10 : null,
    tier: tierFor(completedSales, trustScore),
  };
}
