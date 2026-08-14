import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Help & FAQ — ${BRAND_NAME}`,
  description:
    'Answers to common questions about buying and selling on All Outdoor: how payment is held until delivery, KYC, refunds and disputes, fees, and delivery.',
  alternates: { canonical: '/faq' },
};

// Curated, indexable FAQ. Plain data so we can also emit FAQPage JSON-LD.
// Keep answers accurate to current platform behaviour. NOTE: never use the
// word "escrow" — we are not registered for it; say "funds held".
//
// PUBLIC SURFACE — this array feeds FAQPage structured data that Google can
// lift straight into the SERP, so it is one of the most crawler-visible things
// on the site. Regulated categories are members-only, so their rules live in
// the Regulated Items Annex (members) and NOT here. Do not reintroduce
// firearm, ammunition or dealer-transfer answers to this array: it would
// re-publish exactly the content the members-only gate exists to withhold,
// and it would describe a process the reader cannot actually reach.
const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is All Outdoor?',
    // Answer 1 is the single most-read sentence on the site and it feeds the
    // FAQPage JSON-LD Google lifts into the SERP, so it describes the PUBLIC
    // store: the outdoor catalogue a signed-out visitor can actually browse.
    // Regulated stock is members-only and is not advertised here.
    a: 'All Outdoor is a South African new and secondhand outdoor store — camping and overlanding kit, fishing tackle, optics, knives, clothing and outdoor gear. You can buy at a set price, bid in auctions, make an offer ("Take a Shot"), or swop item for item. Some regulated categories are available to registered members only.',
  },
  {
    q: 'How does payment protection work?',
    a: 'When you pay for an order, the funds are held by All Outdoor and only released to the seller after delivery is confirmed. If something goes wrong before then, you can raise a dispute and request a refund. This protects buyers from paying for items that never arrive.',
  },
  {
    // The operator's hard line, stated plainly where buyers and platform
    // reviewers both look. Enforced in code at listing-create, not just here.
    q: 'Do you sell ammunition?',
    a: 'No. All Outdoor does not sell ammunition. Live ammunition may not be listed, sold or traded on this platform under any circumstances, by anyone, and listings that attempt it are removed.',
  },
  {
    q: 'Do I need to verify my identity (KYC)?',
    a: 'Sellers complete identity verification (KYC) before they can receive payouts — this keeps the store trustworthy for everyone. Buyers create a standard account.',
  },
  {
    q: 'How do refunds and disputes work?',
    a: 'If your order has been paid but a problem arises before you confirm delivery, open a dispute from the order page. An admin reviews it and either releases the funds to the seller or refunds you. Because payment is held until delivery, you are not out of pocket while a dispute is resolved. See our Refund & Dispute Policy for full detail.',
  },
  {
    q: 'What does it cost to buy or sell?',
    // Operator decision 2026-08-15: on Buy Now our cut is built INTO the
    // listed price instead of deducted from the seller, so this answer must
    // separate the two modes. Full detail (bands, worked example) on /fees.
    a: 'Listing is free, and browsing and bidding cost nothing. On a Buy Now listing you enter what you want to receive and get exactly that — our commission and the card transaction fee are included in the price buyers see, so nothing is deducted from you. On an auction or an accepted offer the price is whatever the bid or offer settled at, our commission comes out of that, and the buyer pays a transaction fee. Commission is banded (9% on the first R5,000, then 7%, 5% and 3% on higher portions, minimum R10). Delivery is quoted at checkout and paid by the buyer. See the Fees page for a worked example.',
  },
  {
    q: 'How can I pay?',
    a: 'Secure card payments are launching soon. You can browse, bid and list in the meantime — card checkout switches on as soon as it is ready. Whichever method you use, your payment is held until delivery is confirmed.',
  },
  {
    // Regulated-category delivery rules (dealer transfer) are legally
    // load-bearing but they belong to members-only stock, so they live in the
    // Regulated Items Annex rather than the public FAQ. Nothing here is
    // softened — it simply describes the catalogue this page's reader can buy.
    q: 'How is my order delivered?',
    a: 'Most items ship via our courier partners — Pudo locker-to-locker or The Courier Guy door-to-door — with live rate quotes at checkout and tracking on the order page. Bulky items are collected, or you can arrange your own transporter; either way your payment is held until you confirm you have the item.',
  },
  {
    q: 'How do I sell on All Outdoor?',
    // Four selling modes, matching /how-selling-works and the sell form —
    // Swop was live long before this answer was written and kept being left
    // out, which is why sellers never discovered it.
    a: 'Create a listing from the Sell page — add photos, a description and a price (or set it up as an auction, a Take-a-Shot, or a Swop / Trade). Listings are checked before going live. Complete seller verification (KYC) to receive payouts. Registered members listing in a regulated category are asked for the extra details the law requires.',
  },
  {
    q: 'Is my personal information safe?',
    a: 'Yes. We only show your username publicly — never your real name — and we handle personal data in line with POPIA. See our Privacy Policy for how we collect, use and protect your information.',
  },
];

export default function FaqPage() {
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <main className="max-w-[760px] mx-auto px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      <h1
        className="text-3xl"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        Help &amp; FAQ
      </h1>
      <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
        Common questions about buying and selling on All Outdoor. Still stuck?{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          style={{ color: 'var(--red)', textDecoration: 'underline' }}
        >
          Email support
        </a>{' '}
        or ask{' '}
        <Link
          href="/ask-gg"
          style={{ color: 'var(--red)', textDecoration: 'underline' }}
        >
          Ask Boet
        </Link>
        .
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {FAQS.map((f) => (
          <details
            key={f.q}
            className="rounded-[8px] p-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <summary
              className="cursor-pointer text-base"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {f.q}
            </summary>
            <p
              className="text-sm mt-3"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}
            >
              {f.a}
            </p>
          </details>
        ))}
      </div>

      <p className="text-xs mt-8" style={{ color: 'var(--text-tertiary)' }}>
        This page is a general guide. For the binding detail see our{' '}
        <Link href="/terms" style={{ color: 'var(--text-secondary)' }}>
          Terms
        </Link>
        ,{' '}
        <Link href="/refund-policy" style={{ color: 'var(--text-secondary)' }}>
          Refund &amp; Dispute Policy
        </Link>{' '}
        and{' '}
        <Link href="/acceptable-use" style={{ color: 'var(--text-secondary)' }}>
          Acceptable Use Policy
        </Link>{' '}
        pages. Additional terms apply to regulated categories. See the{' '}
        <Link
          href="/members/regulated-items"
          style={{ color: 'var(--text-secondary)' }}
        >
          Regulated Items Annex
        </Link>
        , available to registered members.
      </p>
    </main>
  );
}
