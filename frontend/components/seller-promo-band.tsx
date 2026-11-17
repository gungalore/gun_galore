// The seller statement's MOBILE fallback.
//
// On desktop the same sentence lives inside <Hero />, in the left copy column.
// The hero is display:none below 768px (operator, 2026-09-30), so without this
// strip the seller offer would vanish on phones entirely. This is therefore
// mobile-only (`md:hidden`), headline-only, and carries no buttons or fee
// explainer — those were removed with the desktop band.
//
// ⚠️ "ON BUY NOW" IS LOAD-BEARING, NOT PADDING. The seller receives their full
// asking price on a Buy Now sale (backend/src/payments/fee.calculator.ts: the
// buyer pays the Platform Fee, `sellerPayout: item`, "the seller pays no
// commission on a Buy Now sale"). On an AUCTION the seller pays 5% of the hammer
// out of the payout (AUCTION_SPLIT_RATE; /fees §3). Dropping the qualifier would
// make this headline contradict the published fee schedule.
//
// THE HEADLINE IS A CLIENT ISLAND for its once-per-launch word animation; the
// rest of the strip is server-rendered. On desktop the hero owns the entrance
// animation instead, which is why this file is hidden there.

import { SellerPromoHeadline } from './seller-promo-headline';

export function SellerPromoBand() {
  return (
    <section
      aria-labelledby="seller-promo-heading"
      className="md:hidden"
      style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <div className="mx-auto max-w-[var(--page-max)] px-4 py-6 sm:px-6 sm:py-7">
        <SellerPromoHeadline />
      </div>
    </section>
  );
}
