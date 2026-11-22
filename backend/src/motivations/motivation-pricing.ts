// ────────────────────────────────────────────────────────────────────
// WHAT A MOTIVATION COSTS.
//
// Operator, 2026-11-20: "On the motivations. I want to paygate it." → R295,
// charged when the member presses "Write my motivation".
//
// ⚠️ ONE PRICE, AND THE OLD TABLE IS GONE ON PURPOSE. The August design had
// four cells — R199 standard, R99 for AO Pro or for a firearm bought here, free
// for both — and a comment arguing that the discount was a reason to do the
// other thing. None of it was ever wired: `priceMotivation` had no callers,
// there is no voucher or store-credit system to honour "bought here", and AO
// Pro can no longer be bought at all. Leaving a second, richer price list
// beside a flat R295 is exactly how a checkout ends up charging a number the
// UI never showed. The operator priced it flat, so the code has one number.
//
// PURE — no Nest, no Prisma, no clock. The authoritative price the checkout is
// created for comes from the setting (motivation_price_cents), because an
// operator must be able to change it without a deploy; this constant is the
// fallback that setting defaults to, and the copy helper.
// ────────────────────────────────────────────────────────────────────

/** The default price in cents — R295. Mirrors FLAGS.motivationPriceCents. */
export const MOTIVATION_PRICE_CENTS = 29_500;

/**
 * Printing, binding and the A4 envelope — R75.
 *
 * Mirrors FLAGS.motivationPrintFeeCents. Charged ONLY when the member picks
 * "Print and Deliver"; the digital "Print / Download" option costs nothing
 * extra. Delivery is quoted separately from the pickup address.
 */
export const MOTIVATION_PRINT_FEE_CENTS = 7_500;

/** R29500 → "R295". Whole rands, because the price is whole. */
export function formatPrice(cents: number): string {
  if (cents === 0) return 'Free';
  return `R${Math.round(cents / 100)}`;
}
