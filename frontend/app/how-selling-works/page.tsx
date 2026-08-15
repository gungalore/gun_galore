import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How selling works — All Outdoor',
  // "Four", not three: Swop / Trade has been a live selling mode since the
  // S-module shipped and is rendered below with the other three. The count
  // is stated in three places (here, the intro line, and the sell-flow
  // HelpTip on /listings/new) — keep them in step.
  description:
    'The four ways to sell on All Outdoor — Buy Now, Auction, Take a Shot and Swop / Trade — what each one is, who it suits, and how it works, so you list your item the right way.',
  alternates: { canonical: '/how-selling-works' },
};

// Keep this copy in sync with the SELL_MODES cards on /listings/new.
// NOTE: never the word "escrow", and never advertise funds-holding — we
// present as an online store. Phrase mechanics as when the seller is PAID.
const MODES: {
  name: string;
  tagline: string;
  bestFor: string[];
  how: string[];
}[] = [
  {
    name: 'Buy Now',
    tagline: 'A fixed price — the fastest, cleanest way to sell.',
    bestFor: [
      'Everyday gear with a known, fair market price',
      'When you just want it sold without waiting',
      'Selling several identical units (set a quantity and the listing stays live until they all sell)',
    ],
    how: [
      'You set one price — what you want to RECEIVE. Our commission and the card transaction fee are added on top, and that total is the price buyers see. You are shown both numbers before you publish, and you receive your asking price in full: nothing is deducted from your payout.',
      'The buyer taps Buy and pays the listed price — no waiting, no negotiation. Nothing is added at their checkout except delivery.',
      'Payment is held by All Outdoor until the buyer confirms delivery, then released to you.',
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
      'Because the bidding sets the price, there is nothing to build our fee into: the sale price is the winning bid, our commission comes out of it, and the buyer pays a transaction fee on top.',
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
      'The offer sets the price, so — as with an auction — our commission comes out of the agreed price and the buyer pays a transaction fee on top.',
      'As with every sale, you are paid out once delivery is confirmed.',
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
      'You accept, decline, or counter the cash once. All Outdoor arranges both couriers, and any cash difference is paid over once both parcels are delivered.',
      'Items in a regulated category can be swopped too, but they are not couriered — each side is handed over the same way it would be on a normal sale in that category.',
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
        There are four ways to list an item on All Outdoor. Pick the one that
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

      {/* Regulated-category note — a hand-over method, not a fifth selling
          style. Members-only detail (which authority, which forms, what is
          captured) lives in the Regulated Items Annex. */}
      <div
        className="rounded-[10px] p-5 mt-4"
        style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
      >
        <h2 className="text-base" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          Selling in a regulated category?
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Some categories are open to registered members only, and an item
          that requires a licence or permit cannot be couriered. By law it is
          handed over through an authorised dealer and the buyer collects it
          there once the paperwork is done. You will be asked for the
          identifying and licence details the law requires when you list, and
          the listing is checked before it goes live. Additional terms apply
          to regulated categories. See the{' '}
          <Link href="/members/regulated-items" style={{ color: 'var(--red)', textDecoration: 'underline' }}>
            Regulated Items Annex
          </Link>
          , available to registered members.
        </p>
        <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          All Outdoor does not sell ammunition. Live ammunition may not be
          listed, sold or traded on this platform under any circumstances.
        </p>
      </div>

      <p className="text-sm mt-6" style={{ color: 'var(--text-secondary)' }}>
        Whichever you choose, the basics are the same: listing is free,
        listings are checked before they go live, you are{' '}
        <strong style={{ color: 'var(--text-primary)' }}>paid out once delivery is confirmed</strong>,
        and you are shown{' '}
        <strong style={{ color: 'var(--text-primary)' }}>both numbers — what you receive and what buyers will see</strong>{' '}
        before you publish. Delivery is quoted at checkout and paid by the
        buyer. The bands and a worked example are on our{' '}
        <Link href="/fees" style={{ color: 'var(--red)', textDecoration: 'underline' }}>
          Fees
        </Link>{' '}
        page.
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
