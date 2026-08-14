// How payments work — the canonical "funds held" explainer. Pulls the
// story that otherwise lives scattered across /how-selling-works, /faq
// and /refund-policy into one page a buyer, a seller, or a due-diligence
// reviewer can read end to end.
//
// Mapped to the actual implementation: payment held on checkout, released
// on confirm-delivery / verified dealer transfer (SAPS 534 for firearms),
// manual bank-detail review before the first payout, commission-only revenue.
//
//   PUBLIC PAGE — the regulated-category detail lives in the members-only
//   Regulated Items Annex (/members/regulated-items). Keep the copy here
//   generic ("items that require a licence or permit").
//
// House rules baked in:
//   NEVER name a payment provider here until a contract is signed (TPPP).
//   NEVER use the word "escrow" — say "funds held" / "payment held".
//   NEVER claim automated bank-account verification — it is a MANUAL review.

import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'How Payments Work',
  description:
    'How All Outdoor holds a buyer\'s payment until the sale completes, then releases it to the seller — and how regulated items, refunds and disputes are handled.',
};

export default function HowPaymentsWorkPage() {
  return (
    <>
      <LegalDocHeader
        title="How payments work"
        lastUpdated="Effective 15 August 2026"
      />

      <p>
        All Outdoor is a managed marketplace. When you buy something, your
        payment is <strong>held by All Outdoor</strong> until the sale has
        safely completed, and only then released to the seller. That single
        step is what protects both sides of every sale — the buyer isn't
        paying a stranger directly, and the seller knows the money is
        already in hand before they part with the goods.
      </p>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 24 }}>
        Card payments are launching soon. This page explains how a payment
        flows once you check out; you can browse and list in the meantime.
      </p>

      <h2>1. The flow, step by step</h2>
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      <p>
        Payments are handled by our appointed third-party payment service
        provider (a licensed South African payment service provider). Here
        is what happens on an ordinary couriered sale:
      </p>
      <ol>
        <li>
          <strong>The buyer pays.</strong> At checkout the payment is taken
          and the transaction moves to <strong>Payment held</strong>. The
          money sits with All Outdoor — it is <em>not</em> paid straight to
          the seller.
        </li>
        <li>
          <strong>The seller dispatches.</strong> The seller confirms
          dispatch on the platform, which starts the delivery clock. For
          courier orders we book the waybill and share tracking.
        </li>
        <li>
          <strong>The buyer receives and inspects the item.</strong>
        </li>
        <li>
          <strong>Delivery is confirmed.</strong> Once the buyer confirms
          delivery (or the item is confirmed delivered), the held funds are
          released.
        </li>
        <li>
          <strong>The seller is paid.</strong> The seller's proceeds are
          released to the seller's bank account. On a{' '}
          <strong>Buy Now</strong> sale that is the seller's full asking
          price — our commission and the transaction fee are built into
          the price the buyer saw, so nothing comes off the payout. On an{' '}
          <strong>auction</strong> or an accepted{' '}
          <strong>Take-a-Shot offer</strong> the price is whatever the bid
          or offer settled at, and the proceeds are that price less our
          commission.
        </li>
      </ol>

      <h2>2. Items that require a licence or permit are held to a stricter step</h2>
      <p>
        An item that requires a licence or permit is never shipped directly
        between private individuals. It is handed over through a licensed
        dealer, and both buyer and seller must hold every authorisation the
        relevant authority requires for that category. The payment stays
        held until the{' '}
        <strong>transfer is verified as complete</strong> — not merely until
        the parcel is handed over. Only after that verification is the
        seller paid. Additional terms apply to regulated categories. See the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>Regulated Items Annex</a>
        , available to registered members.
      </p>

      <h2>3. How sellers are paid</h2>
      <p>
        Payouts go to the seller's own South African bank account. Before a
        seller's <strong>first</strong> payout, our team carries out a{' '}
        <strong>manual review</strong> of the seller's bank details against
        their verified identity (KYC is provided by VerifyNow, a South
        African KYC provider). This is a person-checked review — it is{' '}
        <strong>not</strong> an automated bank-account check. It exists to
        make sure money is only ever paid to the verified account holder.
      </p>
      <p>
        All Outdoor earns a <strong>commission</strong> on completed sales and
        nothing more — we do not take a spread on the buyer's money and we
        do not earn interest that belongs to sellers. On a Buy Now listing
        that commission, and the card <strong>transaction fee</strong>, are
        included in the price the buyer sees rather than deducted from the
        seller; on an auction or accepted offer the commission comes out of
        the settled price and the buyer pays the transaction fee. Both
        numbers — what the seller receives and what the buyer will see —
        are shown to the seller before a listing is published. The full fee
        schedule is on our{' '}
        <a href="/fees" style={{ color: 'var(--red)' }}>Fees</a> page.
      </p>

      <h2>4. Refunds</h2>
      <p>
        Because the payment is held rather than paid straight through, a
        refund before delivery is straightforward: the held amount is
        returned to the buyer's original payment method and nothing is paid
        to the seller. When and how refunds happen — including your
        statutory rights under the Consumer Protection Act — is set out in
        full in our{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
      </p>

      <h2>5. Disputes</h2>
      <p>
        If an item never arrives, arrives damaged, or is not what was
        listed, raise a dispute on the transaction page{' '}
        <em>before</em> confirming delivery. Confirming delivery releases
        the payment to the seller and is final. While a dispute is open the
        payment stays held and our team reviews it. The dispute timeline and
        escalation routes are covered in the{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>
        {' '}and our{' '}
        <a href="/complaints" style={{ color: 'var(--red)' }}>Complaints procedure</a>.
      </p>

      <h2>6. Where we operate</h2>
      <p>
        All Outdoor serves <strong>South Africa only</strong>, and all
        payments are made and held in <strong>South African Rand (ZAR)</strong>.
        We do not support cross-border payments or other currencies.
      </p>

      <h2>7. Questions</h2>
      <p>
        For anything about payments, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        {' '}or call {SUPPORT_PHONE_DISPLAY}. See also our{' '}
        <a href="/terms" style={{ color: 'var(--red)' }}>Terms of Service</a>
        {' '}and{' '}
        <a href="/legal" style={{ color: 'var(--red)' }}>Legal &amp; Company Information</a>.
      </p>
    </>
  );
}
