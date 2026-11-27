// ────────────────────────────────────────────────────────────────────
// THE SELLER-TIER TOOLTIP, AS ONE STRING.
//
// ⚠️ NO DEALER TIER AND NO VISIBILITY PROMISE. The ladder is New →
// Established → Trusted → Top Seller. "Dealer" is a legacy stored value only —
// it is not awarded and is not described anywhere in copy — and no tier changes
// ranking or reach: the badge is a public display of the seller's record.
//
// Kept here so the copy can be asserted: the profile tooltip is a server
// component, and a spec cannot render it without an authenticated session.
// ────────────────────────────────────────────────────────────────────

export const SELLER_TIER_TOOLTIP =
  'Tiers reflect your selling record: New (just signed up), Established (3+ clean sales and a good trust score), Trusted (10+ clean sales and a strong score), Top Seller (25+ clean sales and a top score). Your tier is shown publicly on your listings and reflects your record only.';
