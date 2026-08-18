import { SubscriptionTier } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// WHAT A MOTIVATION COSTS.
//
// Operator, 2026-08-18. Two things move the price — an AO Pro subscription,
// and whether the firearm was bought here — and they stack:
//
//                        │ firearm bought elsewhere │ firearm bought on site
//   ─────────────────────┼──────────────────────────┼───────────────────────
//   no subscription      │           R199           │          R99
//   AO Pro               │            R99           │          FREE
//
// The shape is deliberate and worth stating, because it is the whole
// commercial argument: the discount is never a discount on the motivation, it
// is a reason to do the OTHER thing. A R100 saving on a motivation is a strong
// nudge toward buying the firearm here rather than privately, and a free
// motivation is a reason to hold the subscription. Fly-by-night writers charge
// R450-R1,000 for one document; every cell in this table undercuts that, so we
// never have to compete on price alone.
//
// PURE — no Nest, no Prisma, no clock. The caller establishes the two facts;
// this decides the money. That split is what makes the table testable and what
// keeps a pricing change to one file.
//
// ⚠️ NOTHING HERE CHARGES ANYBODY YET. Payments are off until Peach goes live
// (PAYMENTS_LIVE), and until then the capped free beta runs — see
// motivation-quota.service.ts. This module is what the beta ends INTO, and it
// is also what the UI quotes from, so the price a member is shown while the
// beta runs is the price they will actually pay.
// ────────────────────────────────────────────────────────────────────

/** Standard price, in cents, when nothing applies. */
export const MOTIVATION_PRICE_CENTS = 19_900;

/** Discounted price, in cents. Reached by EITHER lever on its own. */
export const MOTIVATION_DISCOUNT_CENTS = 9_900;

/**
 * Why the price is what it is.
 *
 * Carried alongside the number because the UI has to explain it — "R99, because
 * you bought the firearm here" converts, and "R99" on its own does not. It is
 * also what a support query is answered from.
 */
export type MotivationPriceReason =
  | 'standard'
  | 'pro_subscription'
  | 'firearm_bought_here'
  | 'pro_and_firearm_bought_here';

export interface MotivationPrice {
  cents: number;
  reason: MotivationPriceReason;
  /** True when there is nothing to collect, so no payment step at all. */
  free: boolean;
  /** What the standard price would have been. Drives "was R199" in the UI. */
  standardCents: number;
  savedCents: number;
}

export interface MotivationPriceInputs {
  /** The member's tier at the moment of pricing. */
  tier: SubscriptionTier;
  /**
   * Whether this motivation is for a firearm bought THROUGH THE PLATFORM.
   *
   * The caller establishes this from a real order, never from anything the
   * applicant types — it is worth R100 to R199, so it is exactly the sort of
   * claim someone would make. See the note on linkage below.
   */
  firearmBoughtOnSite: boolean;
}

/**
 * Price one motivation.
 *
 * FREE is a real outcome, not a zero-rand charge: the caller must skip the
 * payment step entirely rather than send a 0.00 authorisation, which Peach
 * would reject and which would leave a member staring at a failed payment for
 * a benefit they are entitled to.
 */
export function priceMotivation({
  tier,
  firearmBoughtOnSite,
}: MotivationPriceInputs): MotivationPrice {
  const isPro = tier === SubscriptionTier.PRO;

  const cents =
    isPro && firearmBoughtOnSite
      ? 0
      : isPro || firearmBoughtOnSite
        ? MOTIVATION_DISCOUNT_CENTS
        : MOTIVATION_PRICE_CENTS;

  const reason: MotivationPriceReason =
    isPro && firearmBoughtOnSite
      ? 'pro_and_firearm_bought_here'
      : isPro
        ? 'pro_subscription'
        : firearmBoughtOnSite
          ? 'firearm_bought_here'
          : 'standard';

  return {
    cents,
    reason,
    free: cents === 0,
    standardCents: MOTIVATION_PRICE_CENTS,
    savedCents: MOTIVATION_PRICE_CENTS - cents,
  };
}

/** How the price is explained to the member. Never promises an outcome. */
export const PRICE_REASON_COPY: Record<MotivationPriceReason, string> = {
  standard: 'Motivation pack',
  pro_subscription: 'AO Pro member price',
  firearm_bought_here: 'You bought the firearm here',
  pro_and_firearm_bought_here:
    'Free — AO Pro, on a firearm you bought here',
};

/** R19 900 → "R199". Whole rands, because every price in the table is whole. */
export function formatPrice(cents: number): string {
  if (cents === 0) return 'Free';
  return `R${Math.round(cents / 100)}`;
}
