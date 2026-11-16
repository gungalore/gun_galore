// The homepage's seller feature — the one loud statement of the sell-side
// offer, set full-bleed directly under the hero and above "Latest listings".
//
// WHY A BAND AND NOT HERO COPY. The hero is capped at a 330px band and its copy
// column is sized around the buyer headline; a second display headline in there
// would fight the one that is already there. This is the first section of the
// page body instead — and on phones, where the hero is display:none below
// 768px, it is the very first content block under the shop-mode bar.
//
// ⚠️ "ON BUY NOW" IS LOAD-BEARING, NOT PADDING. The seller receives their full
// asking price on a Buy Now sale (backend/src/payments/fee.calculator.ts: the
// buyer pays the Platform Fee, `sellerPayout: item`, "the seller pays no
// commission on a Buy Now sale"). On an AUCTION the seller pays 5% of the hammer
// out of the payout (AUCTION_SPLIT_RATE; /fees §3). Dropping the qualifier would
// make this headline contradict the published fee schedule, so do not shorten it
// — the spec asserts the whole sentence.
//
// Server component, deliberately: no hooks, no client bundle, no fetch. The
// copy is identical for every viewer, so there is nothing here to cache or
// personalise. It is also static on purpose — the hero already owns the page's
// entrance animation, and a second reveal competing with it is worse than none.

import Link from 'next/link';

export function SellerPromoBand() {
  return (
    <section
      aria-labelledby="seller-promo-heading"
      style={{
        // A CARD SURFACE, not the page ground: the band has to read as a raised
        // feature between the dark hero and the warm listing page. Only a
        // bottom rule — on phones the shop-mode bar above already draws one, and
        // on desktop the hero supplies the edge, so a top border would leave a
        // double line under the bar.
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <div className="mx-auto grid max-w-[var(--page-max)] gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:items-end lg:gap-12 lg:py-12">
        <div className="min-w-0 flex flex-col gap-2.5">
          <p
            className="m-0 text-[11px] uppercase"
            style={{
              // --text-tertiary fails AA on card surfaces in the dark theme;
              // the -on-card alias is the existing stand-in (globals.css).
              color: 'var(--text-tertiary-on-card)',
              letterSpacing: '0.2em',
              fontWeight: 700,
            }}
          >
            For sellers
          </p>

          {/* The brand red on "100% payout" is set at 27px+/800 in both themes,
              which clears the 3:1 large-text threshold. It is not a small-text
              colour here — keep it on the display line only. */}
          <h2
            id="seller-promo-heading"
            className="m-0"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 'clamp(1.7rem, 7vw, 4.75rem)',
              lineHeight: 1.02,
              letterSpacing: '-0.03em',
            }}
          >
            {/* Two block lines, with the space BETWEEN them made explicit: the
                visual break is a CSS line break, but the accessible name must
                still read as two sentences rather than "free.100%". */}
            <span className="block" style={{ textWrap: 'balance' }}>
              Sellers list for free.
            </span>{' '}
            <span className="block" style={{ textWrap: 'balance' }}>
              <span style={{ color: 'var(--red)' }}>100% payout</span> on Buy Now.
            </span>
          </h2>
        </div>

        <div className="min-w-0">
          <p
            className="m-0 max-w-[46ch] text-sm sm:text-[15px]"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            On Buy Now the buyer pays the Platform Fee at checkout, so nothing
            comes off your price.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              href="/listings/new"
              // Same shape as the hero's primary button (h-46, --r-sm), so the
              // two read as the same control in two contexts.
              className="gg-press inline-flex h-[46px] items-center justify-center rounded-[var(--r-sm)] bg-[var(--red)] px-6 text-sm font-semibold text-white transition-colors hover:bg-[var(--red-hover)]"
            >
              Start selling
            </Link>
            <Link
              href="/fees"
              className="text-sm font-semibold"
              style={{
                // --link is the light-theme red for body-size text; on the dark
                // theme --accent-text is the lighter alias that actually passes
                // there. The fallback picks --link when the alias is undefined.
                color: 'var(--accent-text, var(--link))',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              See fees →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
