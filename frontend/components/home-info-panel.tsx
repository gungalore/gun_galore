import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';

/**
 * "Good to know" — the quiet answers strip that sits near the bottom of the
 * landing page, above the footer.
 *
 * WHY IT LOOKS LIKE THIS. The selling pitch used to be a full section sitting
 * directly above the featured placements: a headline, a paragraph, two CTAs
 * and a numbered three-step explainer. It pushed the paid advertising down
 * the page and made the landing view read like a recruitment pitch rather
 * than a storefront. Everything it said is still here — nothing was dropped —
 * but it is folded away so the page above stays clean.
 *
 * Native <details>/<summary>: no JavaScript, no hydration cost, works with
 * the keyboard and with a screen reader for free, and it is one tap from
 * every answer. Closed by default so the page reads as a shop.
 */

const SECTIONS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How selling works',
    a: (
      <>
        <p>
          List free — no listing fee, no subscription, nothing charged up
          front. Photos, a description and the price you want, and your gear
          goes in front of every buyer in the store.
        </p>
        <p>
          Sell it your way: at a fixed price, by auction, by taking offers, or
          swop it for something else. On a fixed-price sale you receive
          exactly the price you set — our commission is added on top for the
          buyer, never taken out of your price.
        </p>
        <p>
          When it sells we book the courier and send you the waybill. Once
          delivery is confirmed, you&rsquo;re paid.
        </p>
      </>
    ),
  },
  {
    q: 'Buying and delivery',
    a: (
      <>
        <p>
          Secure card checkout. Most items ship by courier — to your door or a
          pickup point near you — with a live rate quoted at checkout and
          tracking on your order page.
        </p>
        <p>
          The seller is only paid once you confirm the item arrived as
          described. If something is wrong, raise it from the order page
          before you confirm and our team reviews it.
        </p>
      </>
    ),
  },
  {
    q: 'What it costs',
    a: (
      <>
        <p>
          Browsing, bidding and listing are free. On a fixed-price listing our
          commission and the card fee are built into the price the buyer sees,
          so nothing is deducted from you. On an auction or an accepted offer,
          commission comes out of the settled price and the buyer pays the
          transaction fee.
        </p>
        <p>
          Commission is banded — 9% on the first R5,000, then 7%, 5% and 3% on
          higher portions. The full schedule and a worked example are on the{' '}
          <Link href="/fees" style={{ color: 'var(--red)' }}>Fees</Link> page.
        </p>
      </>
    ),
  },
  {
    q: 'Front-page placement',
    a: (
      <>
        <p>
          The featured strip at the top of the store is the first thing every
          visitor sees. Ten spots run there, and sellers bid for them — win
          one and your listing sits at the top of {BRAND_NAME} for the
          duration of your tier.
        </p>
        <p>
          <Link href="/featured/bid" style={{ color: 'var(--red)' }}>
            Bid for a spot →
          </Link>
        </p>
      </>
    ),
  },
];

const LINKS: [string, string][] = [
  ['Full selling guide', '/how-selling-works'],
  ['Help & FAQ', '/faq'],
  ['Fees', '/fees'],
  ['Condition guide', '/condition-guide'],
  ['Contact us', '/contact'],
];

export function HomeInfoPanel() {
  return (
    <section className="mt-20 sm:mt-24" aria-labelledby="good-to-know">
      <div
        className="pt-12"
        style={{ borderTop: '1px solid var(--hairline)' }}
      >
        <p
          className="text-[11px] uppercase mb-3"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.2em',
            fontWeight: 600,
          }}
        >
          Good to know
        </p>
        <h2
          id="good-to-know"
          className="text-2xl sm:text-3xl m-0 mb-8"
          style={{ color: 'var(--text-primary)' }}
        >
          Everything you need, one tap away
        </h2>

        <div className="max-w-[760px]">
          {SECTIONS.map((s) => (
            <details
              key={s.q}
              className="gg-disclose"
              style={{ borderBottom: '1px solid var(--hairline)' }}
            >
              <summary
                className="flex items-center justify-between gap-4 cursor-pointer select-none"
                style={{
                  padding: '18px 2px',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  listStyle: 'none',
                }}
              >
                <span>{s.q}</span>
                {/* Rotates to a minus via the CSS in globals.css. aria-hidden
                    because <details> already announces its own state. */}
                <span className="gg-disclose-mark" aria-hidden>
                  +
                </span>
              </summary>
              <div
                className="text-sm gg-disclose-body"
                style={{
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                  paddingBottom: 20,
                  maxWidth: '62ch',
                }}
              >
                {s.a}
              </div>
            </details>
          ))}
        </div>

        {/* Deep links for anyone who wants the full documents. */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-8">
          {LINKS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="text-sm"
              style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
            >
              {label} →
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
