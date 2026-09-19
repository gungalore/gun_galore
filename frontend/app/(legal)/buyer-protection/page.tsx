// Buyer Protection — what the Buyer Protection Fee actually buys. Public
// (linked from /fees and checkout), so it must be reachable signed-out.
//
// House rules: never the word "escrow" (say "funds held" / "payment held");
// no payment provider named; no promise the platform does not keep. Every
// protection described here is one the platform actually performs: funds are
// held until delivery is confirmed (or a dealer transfer is verified), seller
// identity is checked before payout, and disputes route to a human with a
// refund where the claim is valid.

import { SUPPORT_EMAIL } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Buyer Protection',
  description:
    'What the All Outdoor Buyer Protection Fee covers — funds held until completion, verified sellers, and dispute resolution.',
};

export default function BuyerProtectionPage() {
  return (
    <>
      <LegalDocHeader
        title="Buyer Protection"
        lastUpdated="Effective 19 September 2026"
      />

      <h2>What it is</h2>
      <p>
        Every order on All Outdoor carries a{' '}
        <strong>Buyer Protection Fee</strong> — <strong>3.28% + R1.15</strong>{' '}
        (VAT included), charged at checkout on the item price and the
        carrier&apos;s rate together. The fee funds the protections below, on
        every sale, whether you buy at a fixed price, win an auction or have an
        offer accepted.
      </p>

      <h2>What you get</h2>
      <ul>
        <li>
          <strong>Your payment is held until the sale completes.</strong> We do
          not release the seller&apos;s money when you pay. It is held until you
          confirm the item arrived as described — or, for an item that changes
          hands through a licensed dealer, until we have verified that transfer
          is complete.
        </li>
        <li>
          <strong>Verified sellers.</strong> A seller must pass an identity
          check, and have their bank details reviewed against that identity,
          before they can be paid out.
        </li>
        <li>
          <strong>Dispute resolution.</strong> If the item does not arrive, or
          is not as described, raise an issue instead of confirming delivery.
          That freezes the payment and puts the order in front of our team.
        </li>
        <li>
          <strong>A refund where a claim is valid.</strong> If we find in your
          favour, the payment is refunded to you and the seller is not paid.
        </li>
      </ul>

      <h2>What it is not</h2>
      <p>
        The fee is not insurance, and it does not change the fact that the
        agreement of sale is between you and the seller. It does not cover:
      </p>
      <ul>
        <li>buyer&apos;s remorse, or a change of mind after delivery;</li>
        <li>
          an item you inspected and accepted, where the fault was apparent at
          the time;
        </li>
        <li>
          a hand-over the parties arrange privately outside our managed
          delivery (a &ldquo;private arrangement&rdquo; sale), where payment
          protection does not apply; or
        </li>
        <li>
          losses caused by something outside our control after a correct
          delivery.
        </li>
      </ul>

      <h2>How to raise a claim</h2>
      <p>
        Open the order and choose <strong>raise an issue</strong> — do not
        confirm delivery. Tell us what is wrong and attach any photographs or
        documents. We hold the payment while we look into it, and we tell both
        parties the outcome. If you are unsure, contact us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>{' '}
        before confirming.
      </p>

      <h2>Related</h2>
      <p>
        See <a href="/fees" style={{ color: 'var(--red)' }}>Fees</a> for the
        full fee schedule,{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refunds</a>{' '}
        for how refunds are processed, and{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>
          How payments work
        </a>{' '}
        for the payment lifecycle.
      </p>
    </>
  );
}
