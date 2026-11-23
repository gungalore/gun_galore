// Refund & Dispute Policy — states the operator's refund position plainly:
// we refund an order only when the item is not delivered, and condition,
// description, damage, fit and change of mind are between the Buyer and the
// Seller. The contract of sale is theirs; our role is the marketplace, payment
// facilitation and seller verification. Nothing here limits the Buyer's
// statutory rights against the seller under the Consumer Protection Act.
//
// Mapped to the actual implementation:
//   - Payment is collected by the appointed third-party payment service
//     provider and the Seller is paid only once delivery is confirmed
//     (transactions.service.ts: funds held -> released on confirm-delivery
//     or by the auto-release cron).
//   - The courier dispatch-SLA auto-refund after 5 days is unchanged.
//   - A non-delivery report from the order page pauses the payout while the
//     admin team checks it against the courier record (raiseDispute in
//     TransactionsService).
//   - Condition complaints are recorded and passed to the Seller; they are
//     not a refund route and do not pause the Seller's payout.

import Link from 'next/link';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Refund & Dispute Policy',
  description:
    'When ALL Outdoor refunds an order that is not delivered, what is not a refund ground, and your statutory rights under the Consumer Protection Act.',
};

export default function RefundPolicyPage() {
  return (
    <>
      <LegalDocHeader
        title="Refund & Dispute Policy"
        lastUpdated="Effective 24 June 2026 · Updated 23 November 2026"
      />

      <h2>Quick reference</h2>
      <div
        style={{
          background: 'rgba(34,197,94,0.06)',
          border: '0.5px solid var(--success)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          fontSize: 14,
          color: 'var(--text-primary)',
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>We refund an order only when the item is not delivered.</strong>{' '}
          That means the seller never dispatches it, never hands it over
          (collection, dealer transfer or private arrangement), or the courier
          records no delivery. That refund is <strong>full</strong>: the item
          price, delivery and the Platform Fee.
        </p>
        <p style={{ margin: '10px 0 0' }}>
          <strong>Condition is not a refund ground.</strong> If an item is not
          as described, arrives damaged, does not fit, is not what you expected
          or you have changed your mind, that is between you and the seller.
          Message the seller from the order page and, if you want it on record,
          lodge a complaint. We record it, pass it to the seller and can act
          against a seller who misdescribes an item — but we do not refund it
          and we do not hold the seller&apos;s payout for it.
        </p>
      </div>

      <h2>1. How payment works, and when the seller is paid</h2>
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      <p>
        ALL Outdoor is an online marketplace and a payment facilitator. Sellers
        are identity- and bank-verified before they can receive a payout. We do
        not inspect, test, own, store or warrant the goods. The contract of sale
        is between the buyer and the seller, and the seller is responsible for
        the listing, the description and the condition of the item.
      </p>
      <p>
        For most transactions, the buyer&apos;s payment is collected by our
        appointed third-party payment service provider (a licensed South African
        payment service provider), and the seller is paid only once delivery is
        confirmed:
      </p>
      <ol>
        <li><strong>You pay</strong> — the payment service provider captures the amount from your chosen payment method and the transaction moves to <strong>Paid — awaiting delivery</strong>.</li>
        <li><strong>Seller dispatches</strong> — they confirm dispatch, which starts your delivery clock.</li>
        <li><strong>You receive the parcel</strong> — check that the item has arrived before doing anything else.</li>
        <li><strong>You confirm delivery</strong> — the seller is paid and the transaction completes.</li>
      </ol>
      <p>
        The &quot;Confirm delivery&quot; button is intentionally a two-step flow
        with a three-point checklist. Confirm only when you have the item: once
        you confirm, the seller is paid immediately and the transaction
        completes. If the item has <strong>not</strong> arrived, report that from
        the order page before you confirm (section 2). A condition issue is
        raised with the seller, not through a platform refund (section 3).
      </p>
      <p>
        Where a transaction uses the{' '}
        <strong>in-person handover</strong> option (the buyer and seller meet
        and complete the handover themselves, at a licensed dealer for a
        firearm), the payment is collected and the seller is paid when the buyer
        confirms the handover, or automatically five days after payment if the
        buyer has not reported that the item was never handed over. Both parties
        receive a WhatsApp, SMS, email and in-app confirmation link. If the
        seller never hands the item over, that is non-delivery and the refund is
        full, including the Platform Fee (section 2). On a buyer-requested
        cancellation the Platform Fee is non-refundable on this option (section
        4). See our{' '}
        <Link href="/terms" style={{ color: 'var(--red)' }}>
          Terms of Service
        </Link>{' '}
        section 7 for the binding text. Additional terms apply to regulated
        categories. See the{' '}
        <Link href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </Link>
        , available to registered members.
      </p>

      <h2>2. When we refund — the item is not delivered</h2>
      <p>We refund an order only where the item is not delivered. That means:</p>
      <ul>
        <li>
          <strong>The seller never accepts or never dispatches the item</strong>{' '}
          — the order is paid and nothing is sent.
        </li>
        <li>
          <strong>The seller never hands the item over</strong> — on a
          collection, a dealer transfer or a private arrangement, the hand-over
          never happens.
        </li>
        <li>
          <strong>The courier records no delivery</strong> — the parcel is not
          recorded as delivered to you.
        </li>
      </ul>
      <p>
        <strong>The refund is full.</strong> You are refunded the item price, the
        delivery charge and the Platform Fee, back to your original payment
        method. Report a non-delivery from the order page before you confirm
        delivery, and our team checks it against the courier or hand-over record.
      </p>
      <p>
        <strong>The automatic 5-day refund for courier orders is unchanged.</strong>{' '}
        The seller has five days from accepting your order to dispatch it. We
        send a reminder before the deadline. If the window lapses with no
        dispatch, the system <strong>automatically refunds you in full</strong>{' '}
        and notifies both parties — you do not need to do anything. The refund
        records as a &quot;dispatch SLA auto-refund&quot; in your transaction
        history. Collection orders, dealer transfers and private arrangements do
        not run on that automatic timer: if one of those is never handed over,
        report it from the order page and our team checks the record and refunds
        you in full.
      </p>
      <p>
        <strong>An item that has been delivered is not a non-delivery.</strong>{' '}
        Where the courier records delivery, or you confirm receipt, the item has
        been delivered; a complaint about what was in the parcel, its condition
        or its description is a matter for the seller (section 3), not a platform
        refund.
      </p>

      <h2>3. What we do not refund, and what to do instead</h2>
      <p>We do not refund an order for any of the following:</p>
      <ul>
        <li>
          <strong>Condition</strong> — the item is worn, scratched, damaged,
          faulty, incomplete or otherwise not in the condition you expected.
        </li>
        <li>
          <strong>&quot;Not as described&quot;</strong> — the item is not the
          model, specification, colour, accessories or finish you expected.
        </li>
        <li>
          <strong>Damage after delivery</strong> — anything that happens to the
          item once it has been delivered.
        </li>
        <li>
          <strong>Wrong expectation, fit or suitability</strong> — the item does
          not suit your purpose, size or preference.
        </li>
        <li>
          <strong>Change of mind</strong> — you no longer want the item.
        </li>
        <li>
          <strong>Location or travel</strong> — the item is further away than you
          wanted, you cannot get to it, it costs more than you expected to
          collect, or a licensed dealer you must use is inconvenient. Every
          listing shows the town and province before you buy, and you confirm at
          checkout that you have seen it.
        </li>
      </ul>
      <p>
        These are matters between you and the seller. We do not inspect, test or
        warrant the goods, and we are not the seller. We verify the seller&apos;s
        identity and bank details and facilitate the payment; the seller is
        responsible for the accuracy of the listing and the condition of the
        item.
      </p>
      <p>
        <strong>Ask before you buy.</strong> Read the listing carefully and ask
        any question you need answered before you pay. Listings now have a public{' '}
        <strong>Questions &amp; answers</strong> section built from previous
        buyer and seller conversations. Ask your question there; the seller
        usually replies, and answered questions stay published on the listing —
        the seller cannot hide them.
      </p>
      <p>
        <strong>After delivery.</strong> Message the seller from the order page.
        If you want the matter on record, lodge a{' '}
        <Link href="/complaints" style={{ color: 'var(--red)' }}>
          complaint
        </Link>
        . We record it, pass it to the seller and can act against a seller who
        misdescribes items. We do not refund it and we do not hold the
        seller&apos;s payout for it.
      </p>
      <p>
        None of this limits your rights against the seller under the Consumer
        Protection Act — see section 5.
      </p>

      <h2>4. Cancelling an order, and the 4% handling fee</h2>
      <p>
        You cannot self-cancel a paid order, and you cannot cancel it at all once
        the seller has marked it dispatched. To cancel before dispatch, use{' '}
        <strong>Request cancellation</strong> on the order page (or email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        ). This <strong>freezes the order</strong> — the seller is told not to
        dispatch and no payment is released while our team reviews it. If a
        cancellation for your convenience is approved, we refund you, less the
        costs below.
      </p>
      <ul>
        <li>
          <strong>A 4% transaction handling fee is retained.</strong> It is
          calculated on the item price plus delivery and recovers the
          non-recoverable payment-gateway, interchange and electronic-funds
          reversal costs already incurred in taking and reversing your payment.
          It is a reasonable cancellation charge under section 17(3) of the
          Consumer Protection Act, not a penalty. The Platform Fee itself is
          refunded to you.
        </li>
        <li>
          <strong>Delivery is not refundable once the parcel is committed.</strong>{' '}
          If the seller has accepted the order and a courier waybill has been
          booked, the delivery charge stands, because the carrier charge cannot
          be reliably voided. Delivery is fully refunded if no waybill was
          booked.
        </li>
        <li>
          <strong>Once the item has been dispatched, the order cannot be
          cancelled.</strong> From that point the only platform refund route is
          non-delivery (section 2). A condition or description issue after
          dispatch is between you and the seller (section 3).
        </li>
        <li>
          <strong>The 4% fee does not apply when the cancellation is the
          seller&rsquo;s fault.</strong> If the seller declines the sale, never
          dispatches, or never delivers the item, you are refunded{' '}
          <strong>in full — including the Platform Fee and delivery</strong>.
        </li>
        <li>
          <strong>No cancellation fee applies on death or hospitalisation of the
          buyer.</strong> This is required by section 17(5) of the Consumer
          Protection Act.
        </li>
        <li>
          <strong>The Platform Fee on an in-person handover.</strong> If you
          chose an in-person handover (arrange privately / meet the seller), the
          Platform Fee is non-refundable on a buyer-requested cancellation. It is
          not retained where the seller never hands the item over: non-delivery
          on this option is refunded in full, including the Platform Fee, under
          section 2.
        </li>
      </ul>
      <p>
        <strong>Seller failure charge (unchanged).</strong> Where a paid sale
        ends because the seller declined it, failed to dispatch it or never
        delivered it, the seller failure charge in section 11 of the{' '}
        <Link href="/terms" style={{ color: 'var(--red)' }}>
          Terms of Service
        </Link>{' '}
        applies to the seller. It does not apply to condition complaints, which
        are not a refund route on this platform.
      </p>

      <h2>5. Your statutory rights under the Consumer Protection Act</h2>
      <p>
        Nothing in this policy excludes or limits the rights you have
        under the Consumer Protection Act 68 of 2008, including:
      </p>
      <ul>
        <li><strong>Section 55</strong> — the right to safe, good-quality goods that are reasonably suitable for the purposes for which they are generally intended, are of good quality, in good working order and free of any defects.</li>
        <li><strong>Section 56</strong> — an implied warranty of quality lasting <strong>6 months</strong> from the date of delivery; if the goods fail to meet the standards in Section 55 within that period, you may require the supplier (the seller) to repair them, replace them or refund the price. (For private-individual sellers, ALL Outdoor acts only as facilitator; for goods sold by a business or licensed-dealer Seller, Section 56 applies directly to that Seller.)</li>
        <li><strong>Section 17</strong> — the right to cancel an advance reservation within reasonable terms.</li>
        <li><strong>Section 19</strong> — the right to delivery at the agreed time and place. Section&nbsp;19 applies <em>unless otherwise expressly provided or anticipated in an agreement</em>: where a listing is marked collection-only, or is a regulated item that transfers through a licensed dealer, the town shown on the listing is the agreed place, and you confirm it at checkout before paying.</li>
      </ul>
      <p>
        We limit our own role and our own refunds. We do not, and cannot, erase
        the seller&apos;s statutory obligations to you. Where a complaint against
        ALL Outdoor cannot be resolved by us and falls within the jurisdiction of
        the National Consumer Commission or the Consumer Goods and Services
        Ombud, you may escalate it directly to them:
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

      <h2>6. Chargebacks</h2>
      <p>
        Chargebacks are unchanged. If you initiate a chargeback through your bank
        or card provider without first raising the issue with ALL Outdoor, your
        account may be suspended while the chargeback is investigated. We prefer
        you report a non-delivery from the order page or lodge a complaint first
        — it is faster, your seller is protected from punitive chargeback fees,
        and the outcome is generally the same.
      </p>

      <h2>7. Contact</h2>
      <p>
        For any refund or complaint enquiry that you cannot resolve via
        the in-product flows, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        . Please include the order reference number in the subject
        line so we can find it quickly.
      </p>
    </>
  );
}
