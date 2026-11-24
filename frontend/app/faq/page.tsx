import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Help & FAQ — ${BRAND_NAME}`,
  description:
    'Answers to common questions about buying and selling on ALL Outdoor: ordering, delivery, refunds and disputes, verification and fees.',
  alternates: { canonical: '/faq' },
};

// Curated, indexable FAQ. Plain data so we can also emit FAQPage JSON-LD.
// Keep answers accurate to current platform behaviour. NOTE: never use the
// word "escrow" — we are not registered for it. And per the operator
// (2026-08-15): never advertise that we hold funds — we present as an online
// store. Where mechanics need explaining, say when the SELLER IS PAID.
//
// PUBLIC SURFACE — this array feeds FAQPage structured data that Google can
// lift straight into the SERP, so it is one of the most crawler-visible things
// on the site. Regulated categories are members-only, so their rules live in
// the Regulated Items Annex (members) and NOT here. Do not reintroduce
// firearm, ammunition or dealer-transfer answers to this array: it would
// re-publish exactly the content the members-only gate exists to withhold,
// and it would describe a process the reader cannot actually reach.
//
// ⚠️ That holds even for an answer that PROHIBITS the goods. A "no, we do
// not sell X" entry lived here until 2026-08-21 and was removed: an
// automated policy classifier matches the noun, not the "no", and JSON-LD
// is the first thing it parses — so the denial scored against us exactly
// like an advert would. The prohibition itself is unchanged and still binds
// sellers: it is enforced in code at listing-create and published to members
// in the Regulated Items Annex. Restate it there, never here.
const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is ALL Outdoor?',
    // Answer 1 is the single most-read sentence on the site and it feeds the
    // FAQPage JSON-LD Google lifts into the SERP, so it describes the PUBLIC
    // store: the outdoor catalogue a signed-out visitor can actually browse.
    // Regulated stock is members-only and is not advertised here.
    a: 'ALL Outdoor is a South African new and secondhand outdoor store — camping and overlanding kit, fishing tackle, clothing and outdoor gear. You can buy at a set price, bid in auctions, or make an offer ("Take a Shot"). Some regulated categories are available to registered members only.',
  },
  {
    q: 'How does payment protection work?',
    // Payout trigger, not funds-holding: per the operator rule, public copy says
    // when the SELLER IS PAID. It covers non-delivery only.
    a: 'The seller is only paid after you confirm you have received the item. If the item is never delivered — the seller never dispatches or hands it over, or the courier records no delivery — we refund you in full, including delivery and the Platform Fee. That is what the Platform Fee funds. It does not cover the condition of an item: condition, description, fit and change of mind are between you and the seller.',
  },
  {
    q: 'Do I need to verify my identity?',
    a: 'Sellers complete identity verification before they can receive payouts — this keeps the store trustworthy for everyone. Buyers create a standard account.',
  },
  {
    q: 'How do refunds and disputes work?',
    a: 'We refund an order only when the item is not delivered. Report it from the order page before you confirm delivery and our team checks it against the courier or hand-over record; where there is no delivery you are refunded in full. For courier orders, a seller who does not dispatch within 5 days triggers an automatic full refund. Condition, description, fit and change of mind are not refund grounds — message the seller from the order page and, if you want it on record, lodge a complaint. See our Refund & Dispute Policy for full detail.',
  },
  {
    q: 'What if the item is not as described?',
    a: 'That is between you and the seller, not a platform refund. We do not inspect, test or warrant the goods, and the seller is responsible for the accuracy of the listing and the condition of the item. Read the listing and ask questions before you buy; after delivery, message the seller from the order page. You can also lodge a complaint — we record it, pass it to the seller and can act against a seller who misdescribes an item, but we do not refund it and we do not hold the seller\'s payout for it. Your rights against the seller under the Consumer Protection Act are unaffected. See our Refund & Dispute Policy for full detail.',
  },
  {
    q: 'How do I ask a question about a listing?',
    a: 'Every listing has a public Questions & answers section. Ask your question there before you buy — the seller usually replies, and answered questions stay published on the listing so other buyers can read them. A seller cannot hide an answered question. For anything about an order you have already placed, message the seller from the order page.',
  },
  {
    q: 'What does it cost to buy or sell?',
    // Operator decision 2026-10: one buyer-paid Platform Fee, calculated last
    // on item + delivery. Full detail (bands, worked example) on /fees.
    a: 'Listing is free, and browsing and bidding cost nothing. On a Marketplace listing your asking price is the listed price and you receive it in full — the buyer pays the Platform Fee on top at checkout, so nothing is deducted from you. On an auction the Platform Fee is a flat 10%, split 5% buyer / 5% seller. The buyer always pays delivery at checkout. Marketplace Platform Fees are banded (10% on the first R25,000, then 9%, 8% and 7% on higher portions, minimum R10). See the Fees page for a worked example.',
  },
  {
    q: 'How can I pay?',
    a: 'Secure card payments are launching soon. You can browse, bid and list in the meantime — card checkout switches on as soon as it is ready. Whichever method you use, the seller is only paid once your delivery is confirmed.',
  },
  {
    // Regulated-category delivery rules (dealer transfer) are legally
    // load-bearing but they belong to members-only stock, so they live in the
    // Regulated Items Annex rather than the public FAQ. Nothing here is
    // softened — it simply describes the catalogue this page's reader can buy.
    q: 'How is my order delivered?',
    a: 'Most items ship by courier — to your door or to a pickup point near you — with live rate quotes at checkout and tracking on the order page. Bulky items are collected, or you can arrange your own transporter; either way the seller is only paid once you confirm you have the item.',
  },
  {
    q: 'How do I sell on ALL Outdoor?',
    // Selling modes matching /how-selling-works and the sell form.
    a: 'Create a listing from the Sell page — add photos, a description and a price (or set it up as an auction or a Take-a-Shot). Listings are checked before going live. Complete seller verification to receive payouts. Registered members listing in a regulated category are asked for the extra details the law requires.',
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
        Common questions about buying and selling on ALL Outdoor. Still stuck?{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          style={{ color: 'var(--red)', textDecoration: 'underline' }}
        >
          Email support
        </a>
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
