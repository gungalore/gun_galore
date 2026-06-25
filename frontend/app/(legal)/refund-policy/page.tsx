// Refund & Dispute Policy — explains when and how refunds happen,
// the dispute flow timeline, and what the buyer's statutory rights
// are under the Consumer Protection Act.
//
// Mapped to the actual implementation:
//   - Funds-held mechanism in transactions.service.ts (HELD → RELEASED
//     on confirm-delivery or auto-release after the cron decides)
//   - Buyer-initiated dispute (raise-dispute-button.tsx + raiseDispute
//     in TransactionsService) — sets paymentStatus DISPUTED, pauses
//     dispatch-SLA auto-refund, raises admin alert
//   - Admin dossier actions: release / refund / resolve-dispute-release

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Refund & Dispute Policy — Gun Galore',
  description:
    'When refunds happen, how the dispute process works, and your statutory rights under the Consumer Protection Act.',
};

export default function RefundPolicyPage() {
  return (
    <>
      <LegalDocHeader
        title="Refund & Dispute Policy"
        lastUpdated="Effective 24 June 2026"
      />

      <h2>Quick reference</h2>
      <div
        style={{
          background: 'rgba(34,197,94,0.06)',
          border: '0.5px solid #22c55e',
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          fontSize: 14,
          color: 'var(--text-primary)',
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>If your item never arrived, arrived damaged or is
          not what was listed:</strong> raise a dispute on the
          transaction page <em>before</em> you click "Confirm
          delivery". Payment is held while the admin team reviews
          (typically within 48 hours). Don't click confirm if you're
          unhappy — that releases payment to the seller and is final.
        </p>
      </div>

      <h2>1. How payment held works</h2>
      <p>
        For most transactions, GunGalore holds the buyer's payment
        through Stitch Express until delivery is confirmed:
      </p>
      <ol>
        <li><strong>You pay</strong> — Stitch captures the amount from your card or EFT and the transaction moves to <strong>Payment held</strong>.</li>
        <li><strong>Seller dispatches</strong> — they confirm dispatch on the platform, which starts your delivery clock.</li>
        <li><strong>You receive the parcel</strong> — inspect it before doing anything else.</li>
        <li><strong>You confirm delivery</strong> — the funds release to the seller and the transaction completes.</li>
      </ol>
      <p>
        The "Confirm delivery" button is intentionally a two-step
        flow with a three-point inspection checklist. Once you confirm,
        funds release immediately and the transaction is final — you
        will <strong>not</strong> be able to raise a dispute afterwards
        on the same issue.
      </p>
      <p>
        Where a transaction uses the{' '}
        <strong>Private Arrangement</strong> transfer option for a
        licence-controlled item (buyer and seller go to a SAPS-licensed
        dealer together), payment captures and releases immediately. The
        funds-held mechanism does not apply, because the buyer expressly
        waives it at checkout and physical possession happens face-to-face.
        See our{' '}
        <a href="/terms" style={{ color: 'var(--red)' }}>Terms of Service</a>{' '}
        paragraph 7 for the binding text.
      </p>

      <h2>2. When you can raise a dispute</h2>
      <p>
        You can raise a dispute on a transaction <strong>provided all
        of the following are true</strong>:
      </p>
      <ul>
        <li>The transaction's payment status is still <strong>Payment held</strong>.</li>
        <li>The seller has confirmed dispatch (we don't accept disputes against undispatched orders — see paragraph 4 for what happens there instead).</li>
        <li>You have not already confirmed delivery on this transaction.</li>
      </ul>
      <p>
        Disputes can be raised for these reasons:
      </p>
      <ul>
        <li><strong>Arrived damaged</strong> — item is broken, scratched, malfunctioning, or otherwise not in the condition described.</li>
        <li><strong>Wrong item</strong> — what you received doesn't match the listing (different model, calibre, accessories missing, etc.).</li>
        <li><strong>Never arrived</strong> — seller marked dispatched but the parcel never showed up.</li>
        <li><strong>Other</strong> — describe in your own words.</li>
      </ul>

      <h2>3. How a dispute is reviewed and resolved</h2>
      <ol>
        <li>You click <strong>Raise dispute</strong> on the transaction page, pick a reason and write at least 10 characters describing what happened. (The admin team may ask for photos by email if relevant.)</li>
        <li>The transaction moves to <strong>Disputed</strong> status. The funds stay held; the dispatch-SLA auto-refund cron is paused; both you and the seller see a "Dispute raised — admin is reviewing" notice on the transaction page.</li>
        <li>An admin alert is raised with the dispute details so the team sees it immediately. <strong>We aim to make first contact within 48 hours.</strong></li>
        <li>The admin team gathers evidence from you, the seller and (where relevant) the courier's tracking record.</li>
        <li>One of four outcomes is recorded, with a written reason in the audit log:
          <ul>
            <li><strong>Full refund to you</strong> — payment is reversed via Stitch; you receive the full amount including shipping back to your original payment method (typically 3–7 business days).</li>
            <li><strong>Partial refund</strong> — for cases where the item is usable but not as-described; agreed split is refunded to you, the balance released to the seller.</li>
            <li><strong>Release to seller</strong> — where the dispute is not upheld; payment releases as normal. You will be told why.</li>
            <li><strong>Escalation</strong> — where there is suspected fraud or criminal conduct, the matter is referred to SAPS and may be paused indefinitely.</li>
          </ul>
        </li>
      </ol>

      <h2>4. Seller doesn't dispatch — automatic refund</h2>
      <p>
        If the seller doesn't confirm dispatch within 48 hours of your
        payment, the system sends them a reminder. If they still don't
        dispatch, the dispatch-SLA cron will{' '}
        <strong>automatically refund you in full</strong> (typically
        within 24 hours of the SLA breach) and notify both parties.
        You don't need to do anything — the refund is automatic and
        records as a "dispatch SLA auto-refund" in your transaction
        history.
      </p>

      <h2>5. What is not refundable</h2>
      <ul>
        <li><strong>Raffle tickets</strong> — once payment is confirmed, tickets are non-refundable unless GunGalore cancels the competition. See our{' '}
          <a href="/aml-policy" style={{ color: 'var(--red)' }}>AML &amp; Competitions Policy</a>{' '}
          for the cancellation provisions.
        </li>
        <li><strong>Featured-slot bid wins</strong> — the cost of buying a featured-listing slot at auction is non-refundable except where the listing is removed by us for an admin-side error.</li>
        <li><strong>Shipping costs on cancelled orders</strong> where the cancellation is the buyer's choice and the parcel has already been collected by the courier.</li>
      </ul>

      <h2>6. Your statutory rights under the Consumer Protection Act</h2>
      <p>
        Nothing in this policy excludes or limits the rights you have
        under the Consumer Protection Act 68 of 2008, including:
      </p>
      <ul>
        <li><strong>Section 55</strong> — the right to safe, good-quality goods that are reasonably suitable for the purposes for which they are generally intended, are of good quality, in good working order and free of any defects.</li>
        <li><strong>Section 56</strong> — an implied warranty of quality lasting <strong>6 months</strong> from the date of delivery; if the goods fail to meet the standards in Section 55 within that period, you may require the supplier (the seller) to repair them, replace them or refund the price. (For private-individual sellers, GunGalore acts only as facilitator; for goods sold by SAPS-licensed dealer Sellers, Section 56 applies directly to that dealer.)</li>
        <li><strong>Section 17</strong> — the right to cancel an advance reservation within reasonable terms.</li>
        <li><strong>Section 19</strong> — the right to delivery at the agreed time and place.</li>
      </ul>
      <p>
        Where a dispute cannot be resolved by GunGalore and falls
        within the jurisdiction of the National Consumer Commission or
        the Consumer Goods and Services Ombud, you may escalate it
        there. Contact details are publicly available; we will provide
        them on request.
      </p>

      <h2>7. Chargebacks</h2>
      <p>
        If you initiate a chargeback through your bank or card
        provider without first raising a dispute with GunGalore, your
        account may be suspended while the chargeback is investigated.
        We strongly prefer the in-platform dispute route — it is
        faster, your seller is protected from punitive chargeback
        fees, and the outcome is generally the same.
      </p>

      <h2>8. Contact</h2>
      <p>
        For any refund or dispute enquiry that you cannot resolve via
        the in-product flows, email{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        . Please include the order reference number in the subject
        line so we can find it quickly.
      </p>
    </>
  );
}
