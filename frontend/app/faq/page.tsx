import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Help & FAQ — Gun Galore',
  description:
    'Answers to common questions about buying and selling on Gun Galore: how payment is held until delivery, how firearm dealer transfers work, KYC, refunds and disputes, fees, and delivery.',
  alternates: { canonical: '/faq' },
};

// Curated, indexable FAQ. Plain data so we can also emit FAQPage JSON-LD.
// Keep answers accurate to current platform behaviour. NOTE: never use the
// word "escrow" — Gun Galore is not registered for it; say "funds held".
const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is Gun Galore?',
    a: 'Gun Galore is a South African online marketplace for firearms, optics, hunting and outdoor gear, ammunition and reloading components. You can buy at a set price, bid in auctions, or make an offer ("Take a Shot"). Sellers are private individuals and licensed dealers.',
  },
  {
    q: 'How does payment protection work?',
    a: 'When you pay for an order, the funds are held by Gun Galore and only released to the seller after delivery is confirmed (or, for firearms, after the dealer-transfer is verified). If something goes wrong before then, you can raise a dispute and request a refund. This protects buyers from paying for items that never arrive.',
  },
  {
    q: 'How do I buy a firearm — can it be couriered to my door?',
    a: 'No. By law, firearms are transferred through a SAPS-licensed dealer, not couriered to a home address. After payment, the firearm is sent to a dealer; you collect it there once the transfer paperwork (including your competency and licence application where applicable) is complete. Gun Galore holds your payment until the dealer transfer is verified.',
  },
  {
    q: 'Do I need to verify my identity (KYC)?',
    a: 'Sellers complete identity verification (KYC) before they can receive payouts — this keeps the marketplace trustworthy. Buyers create a standard account; for firearm purchases, your identity, competency and licence are handled as part of the regulated dealer-transfer process.',
  },
  {
    q: 'How do refunds and disputes work?',
    a: 'If your order has been paid but a problem arises before you confirm delivery, open a dispute from the order page. An admin reviews it and either releases the funds to the seller or refunds you. Because payment is held until delivery, you are not out of pocket while a dispute is resolved. See our Refund & Dispute Policy for full detail.',
  },
  {
    q: 'What does it cost to buy or sell?',
    a: 'Browsing and bidding are free. Sellers pay a commission on a completed sale, shown transparently before you list. Buyers see the full price, any applicable processing fee, and shipping before paying — no hidden charges at checkout.',
  },
  {
    q: 'How can I pay?',
    a: 'Checkout supports secure online payment and manual EFT (bank transfer with a unique reference). The available method is shown at checkout. Whichever you use, your payment is held until delivery is confirmed.',
  },
  {
    q: 'How is non-firearm gear delivered?',
    a: 'Non-firearm items ship via our courier partners — Pudo locker-to-locker or The Courier Guy door-to-door — with live rate quotes at checkout and tracking on the order page. Firearms always route through a licensed dealer instead.',
  },
  {
    q: 'How do I sell on Gun Galore?',
    a: 'Create a listing from the Sell page — add photos, a description and a price (or set it up as an auction or Take-a-Shot). Listings are checked before going live. Complete seller verification (KYC) to receive payouts. For firearms you will capture the serial and licence details required by law.',
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
        Common questions about buying and selling on Gun Galore. Still stuck?{' '}
        <a
          href="mailto:support@gungalore.co.za"
          style={{ color: 'var(--red)', textDecoration: 'underline' }}
        >
          Email support
        </a>{' '}
        or ask{' '}
        <Link
          href="/ask-gg"
          style={{ color: 'var(--red)', textDecoration: 'underline' }}
        >
          Ask GG
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
        <Link
          href="/firearms-compliance"
          style={{ color: 'var(--text-secondary)' }}
        >
          Firearms Compliance
        </Link>{' '}
        pages.
      </p>
    </main>
  );
}
