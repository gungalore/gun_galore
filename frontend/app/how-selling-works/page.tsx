import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How selling works — Gun Galore',
  description:
    'The three ways to sell on Gun Galore — Marketplace (Buy Now), Auction, and Take a Shot — what each one is, who it suits, and how it works, so you list your item the right way.',
  alternates: { canonical: '/how-selling-works' },
};

// Keep this copy in sync with the SELL_MODES cards on /listings/new.
// NOTE: never use the word "escrow" — say "funds held".
const MODES: {
  name: string;
  tagline: string;
  bestFor: string[];
  how: string[];
}[] = [
  {
    name: 'Marketplace (Buy Now)',
    tagline: 'A fixed price — the fastest, cleanest way to sell.',
    bestFor: [
      'Everyday gear with a known, fair market price',
      'When you just want it sold without waiting',
      'Selling several identical units (set a quantity and the listing stays live until they all sell)',
    ],
    how: [
      'You set one price. The buyer taps Buy and pays — no waiting, no negotiation.',
      'Payment is held by Gun Galore until the buyer confirms delivery, then released to you.',
      'List more than one unit by setting the quantity; the listing stays up until every unit is sold.',
    ],
  },
  {
    name: 'Auction',
    tagline: 'Let buyers compete and bid the price up.',
    bestFor: [
      'Rare, collectible or high-demand items',
      "When you're not sure how high the price could go",
      'When you want a deadline that creates urgency',
    ],
    how: [
      'You set a duration and a starting bid. Buyers bid; the highest bid at the end wins.',
      'Set a hidden reserve to protect yourself — the item only sells if bidding reaches your minimum.',
      'Bids in the final 2 minutes extend the end time by 2 minutes, so nobody wins by sniping at the last second.',
    ],
  },
  {
    name: 'Take a Shot',
    tagline: 'Buyers name their price; you decide.',
    bestFor: [
      "Items that are hard to price, or where you're open to offers",
      'When you want to test what buyers will actually pay',
      'When negotiation suits you better than a fixed price',
    ],
    how: [
      'Buyers send you an offer. You can accept, decline, or counter once.',
      'Set an optional hidden auto-accept price — offers at or above it are flagged to you for one-tap confirmation. Declining any offer needs a reason and records a strike (genuine buyer concerns go to admin review instead); keep your listings accurate — three strikes suspends selling on your account. Countering is always penalty-free.',
      'As with every sale, payment is held until delivery is confirmed before it reaches you.',
    ],
  },
  {
    name: 'Swop / Trade',
    tagline: 'Trade your gear for someone else’s — add cash if it’s not an even deal.',
    bestFor: [
      'Upgrading your kit without laying out cash',
      'Item-for-item deals, with optional cash either way',
      'When you’d rather trade than sell',
    ],
    how: [
      'You list the item you want to trade — no price. Buyers browse and propose a swap: their item, plus optional cash in either direction.',
      'You accept, decline, or counter the cash once. Gun Galore arranges both couriers and any cash is held until both parcels are delivered, then released.',
      'Firearms can be swapped too — each side transfers through a SAPS-licensed dealer, exactly like a normal firearm sale.',
    ],
  },
];

export default function HowSellingWorksPage() {
  return (
    <main className="max-w-[760px] mx-auto px-4 py-10">
      <h1
        className="text-3xl"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        How selling works
      </h1>
      <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
        There are three ways to list an item on Gun Galore. Pick the one that
        fits what you&apos;re selling — you can always change it before it goes
        live.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        {MODES.map((m) => (
          <section
            key={m.name}
            className="rounded-[10px] p-5"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <h2
              className="text-lg"
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              {m.name}
            </h2>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              {m.tagline}
            </p>

            <p
              className="text-xs mt-4 mb-1"
              style={{ color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              Best for
            </p>
            <ul className="flex flex-col gap-1">
              {m.bestFor.map((b) => (
                <li
                  key={b}
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
                >
                  • {b}
                </li>
              ))}
            </ul>

            <p
              className="text-xs mt-4 mb-1"
              style={{ color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              How it works
            </p>
            <ul className="flex flex-col gap-1">
              {m.how.map((h) => (
                <li
                  key={h}
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
                >
                  • {h}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Firearms note — a method, not a 4th selling style. */}
      <div
        className="rounded-[10px] p-5 mt-4"
        style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
      >
        <h2 className="text-base" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          Selling a firearm?
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          You can list a firearm as Marketplace or Auction, but by law it can&apos;t
          be couriered — it&apos;s transferred through a SAPS-licensed dealer and the
          buyer collects there once the paperwork is done. You&apos;ll capture the
          serial and licence details when you list. See{' '}
          <Link href="/firearms-compliance" style={{ color: 'var(--red)', textDecoration: 'underline' }}>
            Firearms Compliance
          </Link>{' '}
          for the full process.
        </p>
      </div>

      <p className="text-sm mt-6" style={{ color: 'var(--text-secondary)' }}>
        Whichever you choose, the basics are the same: listings are checked
        before they go live, the buyer&apos;s payment is{' '}
        <strong style={{ color: 'var(--text-primary)' }}>held until delivery is confirmed</strong>,
        and our commission is shown up front before you list.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/listings/new"
          className="inline-block text-sm px-5 py-2.5 rounded-[6px]"
          style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
        >
          Start selling
        </Link>
        <Link
          href="/faq"
          className="inline-block text-sm px-5 py-2.5 rounded-[6px]"
          style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          More FAQs
        </Link>
      </div>
    </main>
  );
}
