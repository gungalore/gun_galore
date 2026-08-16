import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';

/**
 * The landing page's seller block, for a store with nothing listed yet.
 *
 * It replaces two orphans. The featured availability bar used to float alone
 * in a stretch of black with no section identity, and the cold-start card was
 * a paragraph of centred text marooned inside a 1600px-wide box — a lot of
 * dark container around very little content, which reads cheap however good
 * the words are. Both said something worth saying and neither looked composed.
 *
 * Now they are one section with a single argument: here is why you should be
 * the first seller, here is exactly what happens when you are, and here is the
 * paid placement if you want the front page. No card chrome — a full-bleed
 * section with real vertical room, because deliberate space reads more
 * expensive than a bordered box does.
 *
 * `featuredSlot` takes the availability bar, which is a client component that
 * fetches its own counts and self-hides when no slots exist. Passing it in as
 * a node keeps this a server component.
 */
export function FoundingSellerSection({
  featuredSlot,
}: {
  featuredSlot?: React.ReactNode;
}) {
  return (
    <section className="mt-14 sm:mt-20" aria-labelledby="founding-seller-heading">
      {/* ── The pitch ─────────────────────────────────────────────── */}
      <div className="text-center">
        <p
          className="text-[11px] uppercase mb-4"
          style={{
            color: 'var(--red)',
            letterSpacing: '0.2em',
            fontWeight: 600,
          }}
        >
          Sell through the store
        </p>

        <h2
          id="founding-seller-heading"
          className="text-3xl sm:text-4xl lg:text-5xl m-0 mb-5"
          style={{ color: 'var(--text-primary)', lineHeight: 1.08 }}
        >
          Be first on the shelf
        </h2>

        <p
          className="text-base sm:text-lg mx-auto"
          style={{
            color: 'var(--text-secondary)',
            lineHeight: 1.65,
            maxWidth: '54ch',
          }}
        >
          Camping and overlanding kit, fishing tackle, optics, knives, outdoor
          clothing. {BRAND_NAME} has just opened — if it&rsquo;s good gear
          you&rsquo;re not using, put it up today. Sell it your way: at your
          price, by auction, by taking offers, or swop it for something you
          actually want. And on a fixed-price sale you receive exactly the
          price you set — our commission is added on top for the buyer, never
          taken out of your price.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          <Link
            href="/listings/new"
            className="inline-flex items-center justify-center px-7 text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 600,
              textDecoration: 'none',
              minHeight: 48,
              borderRadius: 'var(--r-md)',
            }}
          >
            List your first item →
          </Link>
          <Link
            href="/how-selling-works"
            className="inline-flex items-center justify-center px-7 text-sm"
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              // A ghost button needs a border you can actually see, or it
              // reads as disabled text rather than the secondary action.
              border: '1px solid var(--hairline)',
              textDecoration: 'none',
              minHeight: 48,
              borderRadius: 'var(--r-md)',
              fontWeight: 500,
            }}
          >
            How selling works
          </Link>
        </div>

        {/* Honest urgency: checkout is genuinely pre-launch (the FAQ says the
            same), and early listings genuinely inherit the whole first wave
            of buyers. True twice over, and it converts. */}
        <p
          className="text-xs mt-4"
          style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
        >
          Card checkout is switching on shortly. Gear listed today is on the
          shelf for the first buyers through the door.
        </p>
      </div>

      {/* ── What actually happens ─────────────────────────────────────
          Premium marketplaces show the mechanism instead of asserting
          trustworthiness. These three steps are the whole seller journey and
          they are genuinely sequential, which is the only thing that earns a
          numbered treatment. */}
      <div
        className="mt-14 sm:mt-16 pt-12 grid gap-10 sm:gap-8 sm:grid-cols-3"
        style={{ borderTop: '1px solid var(--hairline)' }}
      >
        {[
          {
            n: '01',
            title: 'Put it on the shelf',
            body: 'Photos, a description and the price you want. Listing is free — no fees, no subscription, nothing charged up front.',
          },
          {
            n: '02',
            title: 'We do the selling',
            body: 'Your gear goes in front of every buyer in the store — search, the categories, and the front page if you take a featured spot. You get told the moment it sells.',
          },
          {
            n: '03',
            title: 'Sold — we handle the rest',
            body: 'We book the courier and send you the waybill. Once delivery is confirmed, you’re paid — you set what you wanted for it, and that’s exactly what you get.',
          },
        ].map((step) => (
          <div key={step.n}>
            <p
              className="gg-nums text-xs mb-3"
              style={{
                color: 'var(--gold)',
                letterSpacing: '0.14em',
                fontWeight: 600,
              }}
            >
              {step.n}
            </p>
            <h3
              className="text-base m-0 mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              {step.title}
            </h3>
            <p
              className="text-sm m-0"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
            >
              {step.body}
            </p>
          </div>
        ))}
      </div>

      {/* ── Paid placement ────────────────────────────────────────────
          Last, and quiet. It is an upsell to someone who has already decided
          to sell, so it earns a place on the page but not the loudest one.
          The bar self-hides when no slots exist, and this whole strip goes
          with it rather than leaving a stranded heading. */}
      {featuredSlot && (
        <div
          className="mt-14 sm:mt-16 pt-12 text-center"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <p
            className="text-[11px] uppercase mb-3"
            style={{
              color: 'var(--gold)',
              letterSpacing: '0.2em',
              fontWeight: 600,
            }}
          >
            Front-page placement
          </p>
          <p
            className="text-sm mx-auto mb-1"
            style={{
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
              maxWidth: '46ch',
            }}
          >
            The featured strip is the first thing every visitor sees. Bid for
            one of the ten spots and your listing runs at the top of the store.
          </p>
          {featuredSlot}
        </div>
      )}
    </section>
  );
}
