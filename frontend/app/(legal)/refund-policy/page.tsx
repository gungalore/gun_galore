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

import Link from 'next/link';
import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Refund & Dispute Policy',
  description:
    'When refunds happen, how the dispute process works, and your statutory rights under the Consumer Protection Act.',
};

export default function RefundPolicyPage() {
  return (
    <>
      <LegalDocHeader
        title="Refund & Dispute Policy"
        lastUpdated="Effective 24 June 2026 · Updated 16 July 2026"
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
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      <p>
        For most transactions, GunGalore holds the buyer's payment
        through our appointed third-party payment service provider (a
        licensed South African payment service provider) until delivery
        is confirmed:
      </p>
      <ol>
        <li><strong>You pay</strong> — the payment service provider captures the amount from your chosen payment method and the transaction moves to <strong>Payment held</strong>.</li>
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
            <li><strong>Full refund to you</strong> — payment is reversed to your original payment method; you receive the full amount including shipping (typically 3–7 business days).</li>
            <li><strong>Partial refund</strong> — for cases where the item is usable but not as-described; agreed split is refunded to you, the balance released to the seller.</li>
            <li><strong>Release to seller</strong> — where the dispute is not upheld; payment releases as normal. You will be told why.</li>
            <li><strong>Escalation</strong> — where there is suspected fraud or criminal conduct, the matter is referred to SAPS and may be paused indefinitely.</li>
          </ul>
        </li>
      </ol>

      <h2>4. Seller doesn't dispatch — automatic refund</h2>
      <p>
        For courier orders (PUDO and The Courier Guy), the seller has{' '}
        <strong>5 days from accepting your order</strong> to dispatch it.
        We send them a reminder before the deadline. If they still haven't
        dispatched by the end of that window, the system{' '}
        <strong>automatically refunds you in full</strong> and notifies
        both parties — you don't need to do anything. The refund records
        as a &quot;dispatch SLA auto-refund&quot; in your transaction
        history. (This automatic refund applies to courier orders;
        collection and dealer-transfer orders follow the dispute route in
        section&nbsp;6 instead.)
      </p>

      <h2>4a. Item damaged in transit</h2>
      <p>
        If your parcel arrives damaged, <strong>do not confirm receipt</strong>.
        Photograph the packaging and the damage, then raise it from the order
        page (or lodge a{' '}
        <Link href="/complaints/new" style={{ color: 'var(--red)' }}>
          formal complaint
        </Link>
        ) within 48&nbsp;hours of delivery. Your payment stays held while we
        investigate with you, the seller and the courier. Where the courier is
        at fault we pursue the courier claim; where the item was misrepresented
        or poorly packed we resolve it in line with sections&nbsp;2 and&nbsp;6.
      </p>

      <h2>5. What is not refundable</h2>
      <ul>
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
        directly to them:
      </p>
      <ul>
        <li>
          <strong>National Consumer Commission (NCC)</strong> —{' '}
          <a href="mailto:complaints@thencc.org.za" style={{ color: 'var(--red)' }}>
            complaints@thencc.org.za
          </a>
          .
        </li>
        <li>
          <strong>Consumer Goods &amp; Services Ombud (CGSO)</strong> —{' '}
          <a href="https://www.cgso.org.za" style={{ color: 'var(--red)' }}>
            www.cgso.org.za
          </a>
          , 011 781 2607,{' '}
          <a href="mailto:complaints@cgso.org.za" style={{ color: 'var(--red)' }}>
            complaints@cgso.org.za
          </a>
          .
        </li>
        <li>
          <strong>Payment-related complaints</strong> — a dispute about how
          your payment itself was handled can be taken to the National
          Financial Ombud Scheme South Africa (NFO),{' '}
          <a href="https://www.nfosa.co.za" style={{ color: 'var(--red)' }}>
            www.nfosa.co.za
          </a>
          .
        </li>
      </ul>

      <h2>7. Items sold directly by Gun Galore (Daily Deals)</h2>
      <p>
        Most listings on the platform are sold by independent sellers, with
        GunGalore acting as facilitator. <strong>Daily Deals are
        different</strong>: these are first-party sales where{' '}
        <strong>Gun Galore is the seller</strong> and supplier. Because we are
        the supplier for a Daily Deal, the following apply to us directly:
      </p>
      <ul>
        <li>
          <strong>6-month CPA warranty (Sections 55 &amp; 56)</strong> — the
          implied warranty of quality runs against Gun Galore as supplier. If a
          Daily Deal item fails to be of good quality, in good working order and
          free of defects within 6 months of delivery, you may return it to us
          for repair, replacement or refund, at your election, at no charge.
        </li>
        <li>
          <strong>7-day right to return (ECT Act Section 44 cooling-off)</strong>{' '}
          — a Daily Deal is a distance sale of goods, so you have{' '}
          <strong>7 days from delivery</strong> to cancel and return the item
          for any reason for a full refund of the purchase price. The item must
          be returned complete and undamaged; you are responsible for the return
          shipping cost of a change-of-mind return, and we refund the purchase
          price once we receive it. (This cooling-off right does not apply where
          the ECT Act excludes it — for example goods made to your
          specification, or which by their nature cannot be returned.)
        </li>
        <li>
          <strong>Damaged, faulty or not-as-described</strong> — you are covered
          by the same held-payment and dispute process as the rest of the site
          (paragraphs 1–3 above): raise it before confirming delivery and we
          make it right at our cost.
        </li>
      </ul>
      <p>
        To exercise a Daily Deal return, email{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>{' '}
        with your order reference within the applicable window and we will
        arrange the return and refund. Your payment for a Daily Deal is held in
        the same way as any other order and only released once the item has
        shipped.
      </p>

      <h2>8. Chargebacks</h2>
      <p>
        If you initiate a chargeback through your bank or card
        provider without first raising a dispute with GunGalore, your
        account may be suspended while the chargeback is investigated.
        We strongly prefer the in-platform dispute route — it is
        faster, your seller is protected from punitive chargeback
        fees, and the outcome is generally the same.
      </p>

      <h2>9. Contact</h2>
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
