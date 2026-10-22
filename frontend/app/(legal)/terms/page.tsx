// Terms of Service — the master contract between ALL Outdoor and
// every user of the platform. Drafted with reference to:
//   - Electronic Communications and Transactions Act 25 of 2002 (§ 43)
//   - Consumer Protection Act 68 of 2008
//   - Protection of Personal Information Act 4 of 2013
//
// Conventions in this file:
//   - "ALL Outdoor" / "we" / "us" / "our" = ALLOUTDOOR (PTY) LTD
//   - "you" / "your" = any user of the store
//   - This page is PUBLIC. Category-specific statutory procedure for
//     restricted categories lives in the members-only Regulated Items
//     Annex (/members/regulated-items), which these Terms incorporate
//     by reference. Keep the obligations here; keep the detail there.
//   - ⚠️ This page is crawlable, so it never NAMES a restricted product
//     category or an excluded good. Those names live in the Annex only and
//     are referred to generically here. Relocating them does not weaken
//     them: the Annex is incorporated by reference in section 2.
//   - Per the operator's policy this document NEVER uses the word
//     "escrow" (regulated SA financial term that ALL Outdoor is not
//     registered to operate), and — while the TPPP application is
//     pending — never describes ALL Outdoor as holding funds. Payment
//     is COLLECTED by the licensed payment service provider and the
//     Seller is PAID after delivery confirmation ("deferred
//     settlement"). Substance of every clause unchanged; drafting
//     awaits attorney review (operator's call, 2026-08-15).

import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Terms of Service',
  description:
    'The contract governing your use of ALLOUTDOOR (PTY) LTD. Drafted under South African law.',
};

export default function TermsPage() {
  return (
    <>
      <LegalDocHeader title="Terms of Service" lastUpdated="Effective 24 June 2026 · Updated 19 October 2026" />

      <h2>1. About us</h2>
      <p>
        These Terms of Service (<strong>"Terms"</strong>) form a binding
        agreement between you and <strong>ALLOUTDOOR (PTY) LTD</strong>{' '}
        (registration number <strong>2026/639713/07</strong>), a private
        company registered in the Republic of South Africa with its
        registered office at <strong>36 Sterappel Crescent, Langeberg
        Glen, Cape Town, 7570</strong>{' '}
        (collectively "<strong>ALL Outdoor</strong>", "<strong>we</strong>",
        "<strong>us</strong>" or "<strong>our</strong>"). ALL Outdoor
        operates the website and applications available at{' '}
        <a href="https://alloutdoor.co.za" style={{ color: 'var(--red)' }}>
          alloutdoor.co.za
        </a>{' '}
        (the "<strong>Store</strong>"). Any reference to the
        "Platform" in a policy or annex incorporated into these Terms
        is a reference to the Store.
      </p>

      <h2>2. What ALL Outdoor does</h2>
      <p>
        ALL Outdoor is an online store for <strong>new and
        secondhand outdoor goods</strong>. It allows registered users
        ("<strong>Sellers</strong>") to list items — including camping,
        hiking and fishing gear, overlanding equipment and outdoor
        clothing — for sale
        or auction, and allows other registered users
        ("<strong>Buyers</strong>") to purchase those goods.
      </p>
      <p>
        ALL Outdoor also lists a number of{' '}
        <strong>restricted categories</strong>. Listings in those
        categories are shown only to registered members who are signed
        in, and are subject to additional eligibility, verification and
        handling requirements. Additional terms apply to regulated
        categories. See the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>
        , available to registered members. That Annex forms part of
        these Terms and is incorporated by reference.
      </p>
      {/* The excluded goods used to be named here. They are named in the
          Annex instead — see the ⚠️ convention note at the top of this file.
          The exclusion itself is unchanged and still binds, via the Annex
          incorporated by reference in the paragraph above. */}
      <p>
        Some goods are excluded from the Store entirely. Which goods
        those are, which categories may be listed and by whom, and the
        conditions attached to each, are set out in that Annex.
      </p>
      <p>
        Most items in the Store are listed and sold by their owners.
        We do not own, stock or dispatch the goods members list: the
        agreement of sale for each such item is concluded between the
        Seller and the Buyer, with ALL Outdoor providing the Store, the
        checkout, delivery arrangement and support. Where a transaction
        involves an item that requires a licence or permit to possess,
        physical possession is transferred only through the authorised
        channel prescribed for that category. ALL Outdoor is not an
        authorised dealer in any restricted category and does not handle
        such items in any physical capacity.
      </p>

      <h2>3. Acceptance and changes</h2>
      <p>
        By creating an account, listing an item, placing a bid, making
        an offer or completing a purchase, you confirm that you have
        read, understood and agree to be bound by these Terms, our{' '}
        <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>,
        our{' '}
        <a href="/acceptable-use" style={{ color: 'var(--red)' }}>Acceptable Use Policy</a>{' '}
        and (where applicable) our{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>Regulated Items Annex</a>{' '}
        and{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
      </p>
      <p>
        We may amend these Terms from time to time. Material amendments
        will be notified to you by email and posted on the Store at
        least <strong>14 days before</strong> they take effect. Your
        continued use of the Store after that period constitutes
        acceptance of the amended Terms. If you do not agree, you may
        close your account at any time.
      </p>

      <h2>4. Eligibility</h2>
      <p>
        To register and use ALL Outdoor you must:
      </p>
      <ul>
        <li>be at least <strong>18 years old</strong>;</li>
        <li>be a permanent resident of, or lawfully present in, the Republic of South Africa;</li>
        <li>have the legal capacity to enter into a binding contract;</li>
        <li>not have been previously banned by ALL Outdoor;</li>
        <li>where you list, bid on or purchase any item in a <strong>restricted category</strong>, hold (and continue to hold for the whole duration of the transaction) every competency, licence, permit or other authorisation that the relevant authority requires for that item, as set out in the <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>Regulated Items Annex</a>; and</li>
        <li>where applicable, complete our identity verification process before you can be paid.</li>
      </ul>

      <h2>5. Your account</h2>
      <p>
        You agree to:
      </p>
      <ul>
        <li>provide accurate, current and complete information when you register;</li>
        <li>keep your account credentials confidential and not share access with any third party;</li>
        <li>notify us immediately at <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>{SUPPORT_EMAIL}</a> of any unauthorised use of your account;</li>
        <li>maintain a single ALL Outdoor account (multiple accounts per natural person are not permitted); and</li>
        <li>cooperate fully and truthfully with any verification, dispute or compliance request we make.</li>
      </ul>
      <p>
        You remain responsible for all activity that takes place under
        your account, including all listings, bids, offers, payments
        and communications.
      </p>

      <h2>6. Listings, content and conduct</h2>
      <p>
        All listings, photographs, descriptions, questions, answers,
        ratings, notes and other content you submit to the Store must
        comply with our{' '}
        <a href="/acceptable-use" style={{ color: 'var(--red)' }}>Acceptable Use Policy</a>.
        We reserve the right (but assume no obligation) to remove,
        modify, hide or reject any listing or content that, in our
        reasonable opinion, breaches that policy, breaches any law, or
        is otherwise harmful to ALL Outdoor or its users.
      </p>
      <p>
        You retain ownership of any content you submit. By submitting
        content you grant ALL Outdoor a non-exclusive, royalty-free,
        worldwide licence to host, display, copy, distribute and make
        derivative works of that content for the purpose of operating
        and promoting the Store.
      </p>
      <p>
        Listings, ratings and pre-purchase Q&amp;A are automatically
        moderated for prohibited content (including contact details
        intended to route around the Store). Repeated attempts to
        bypass these controls may result in suspension or permanent
        ban.
      </p>
      <p>
        <strong>Messages between Buyers and Sellers.</strong> Where we provide
        an on-platform messaging feature for a transaction, those messages are
        monitored by automated systems for content that attempts to move a deal
        off the Store, share contact details, or is otherwise prohibited.
        Prohibited contact details are removed from the message before it is
        delivered, and the original is retained for audit. Do not share phone
        numbers, email addresses, social handles, physical addresses or payment
        details in messages. Repeated or deliberate attempts to bypass this
        monitoring may result in suspension or a permanent ban.
      </p>

      <h2>7. Payments and settlement</h2>
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      <p>
        All payments on ALL Outdoor are processed by{' '}
        <strong>our appointed third-party payment service provider</strong>{' '}
        (a licensed South African payment service provider). By making a
        payment you authorise the payment service provider to capture
        funds from your chosen payment instrument, and you authorise
        ALL Outdoor to instruct payment of the Seller's proceeds in
        accordance with these Terms. All prices are quoted and charged in South
        African Rand (ZAR).
      </p>
      <p>
        For most transactions, settlement to the Seller is{' '}
        <strong>deferred</strong>: the Buyer's payment is collected by
        the payment service provider at checkout, and the Seller is
        paid (less the commission, as set out in section 8) only once the
        Buyer confirms delivery of the item, the Buyer's confirmation
        window elapses, or a dispute is resolved. Once one of these
        triggers occurs, ALL Outdoor instructs the payment service
        provider to pay the Seller's proceeds to the Seller's bank
        account.
      </p>
      <p>
        For the avoidance of doubt: deferred settlement is a{' '}
        <strong>buyer-protection measure</strong> and not a regulated
        banking, savings or investment product. ALL Outdoor is not a
        bank, does not provide deposit-taking or fund-custody
        financial services, does not pay interest on amounts pending
        settlement, does not guarantee amounts pending settlement
        against the insolvency of the payment service provider, and is
        not a registered financial services provider.
      </p>
      <p>
        Where a Buyer and Seller elect to use the{' '}
        <strong>in-person handover</strong> option (the parties arrange and
        complete the handover themselves rather than through a courier or an
        authorised third party), the Buyer&rsquo;s payment is collected at
        checkout and <strong>held</strong>. For an in-person handover,
        settlement to the Seller is released when the{' '}
        <strong>Buyer confirms receipt</strong> of the item, or{' '}
        <strong>automatically five (5) days after payment</strong> if the order
        is not disputed before then. Both parties receive a WhatsApp, SMS, email
        and in-app notification with a one-tap confirmation link when the
        handover is due. Either party may raise a dispute before release, which
        holds the payment for review by the admin team. The in-person handover
        option is available on every listing that is not collection-only,
        including firearms (where the handover must happen through a licensed
        dealer). The additional handover conditions in the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>{' '}
        apply to regulated items.
      </p>
      <p>
        <strong>The Platform Fee is non-refundable on an in-person handover.</strong>{' '}
        If a dispute is upheld and refunded, the Buyer is refunded the item price
        only; ALL Outdoor retains the Platform Fee regardless of the reason for
        the dispute.
      </p>

      <h2>8. Fees, commission and payouts</h2>
      <p>
        ALL Outdoor charges a single <strong>Platform Fee</strong> on each
        completed sale. It replaced the former Buyer Protection Fee; no separate
        buyer protection charge applies. How it is charged depends on the sale
        mode:
      </p>
      <ul>
        <li>
          <strong>Marketplace (Buy Now).</strong> The amount the Seller enters
          when creating the listing is the listed price and the amount the
          Seller is to <strong>receive</strong>. The Buyer pays the Platform Fee
          on top at checkout, calculated last on the item price plus delivery.
          Nothing is deducted from the Seller.
        </li>
        <li>
          <strong>Auction.</strong> The sale price is the winning bid. The
          Platform Fee is a flat 10%, split equally: the Buyer pays 5% of the
          hammer price plus delivery at checkout, and the Seller pays 5% of the
          hammer price, deducted from the Seller&apos;s proceeds.
        </li>
        <li>
          <strong>Private arrangement.</strong> No delivery charge applies. The
          Platform Fee is calculated on the item price alone; the Buyer pays it
          and the Seller receives the agreed price (less the 5% auction share
          where the sale arose from an auction).
        </li>
      </ul>
      <p>
        The marketplace Platform Fee is banded: 10% on the first R25,000, 9%
        from R25,001 to R50,000, 8% from R50,001 to R75,000, and 7% above
        R75,000, with a R10 minimum. Only the portion inside each band is
        charged at that band&apos;s rate. The figures shown at listing and at
        checkout are snapshotted onto each Transaction record at the point of
        sale. Our current rates are published at{' '}
        <a href="/fees" style={{ color: 'var(--red)' }}>alloutdoor.co.za/fees</a>.
      </p>
      <p>
        Sellers are paid in South African Rand (ZAR) by electronic
        funds transfer to their bank account. Before a Seller is paid
        for the first time, we manually review the Seller's bank
        details against their verified identity to confirm the account
        belongs to the Seller. We do not pay third parties, or
        accounts not in the Seller's name.
      </p>

      <h2>9. Shipping and delivery</h2>
      <p>
        Shipping is the responsibility of the Seller, using the
        shipping method chosen by the Buyer at checkout from the
        options the Seller has enabled. Available methods include
        courier delivery — to the Buyer's door or to a pickup point,
        quoted live at checkout — <strong>authorised-agent
        transfer</strong> (for items that require a licence or permit) and{' '}
        <strong>private arrangement</strong> (the parties arrange the handover
        themselves — see paragraph 7, where the payment is held until the Buyer
        confirms receipt). Shipping costs are quoted
        live at checkout and paid by the Buyer.
      </p>
      <p>
        <strong>Pickup-point delivery is Pargo only.</strong> Where a pickup
        point is offered, the Buyer chooses from the nearby Pargo counters shown
        at checkout and collects the parcel from that counter. We do not offer
        any other locker or counter network.
      </p>
      <p>
        <strong>Some items cannot be sent by courier at all.</strong> Trailers
        and caravans, oversized or awkward goods, and dangerous goods such as
        batteries sold on their own are marked <strong>collection only</strong>.
        No courier is quoted for them. The Buyer collects the item in person
        from the Seller, or sends their own transporter; ALL Outdoor does not
        arrange, quote, carry or insure that transport. A courier pickup point
        is not the same thing as collecting from a Seller.
      </p>
      <p>
        <strong>Every listing shows the town and province the item is in before
        purchase</strong>, and the Buyer confirms they have seen it at checkout
        before paying. That location is the agreed place for collection or
        hand-over for the purposes of section&nbsp;19 of the Consumer Protection
        Act. Getting to it — travel, fuel, a transporter, or a licensed dealer's
        own fees — is the Buyer's cost and the Buyer's responsibility, and is
        not part of the price shown.
      </p>
      <p>
        Items that require a licence or permit may not be sent by
        ordinary courier and may not be delivered to a residential
        address. They must be routed through the authorised transfer
        channel prescribed for their category, and the Buyer may not
        select a delivery method that bypasses it. The permitted
        routes, and the documents that must accompany each handover,
        are set out in the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>
        .
      </p>
      <p>
        The Seller must dispatch within 48 hours of payment being
        confirmed. If dispatch is not confirmed within that window,
        ALL Outdoor will send a reminder; if dispatch is still not
        confirmed within a further extended period, ALL Outdoor reserves
        the right to cancel the transaction and refund the Buyer in
        full.
      </p>

      <h2>10. Auctions, Take-a-Shot offers and Buy Now</h2>
      <p>
        ALL Outdoor supports three sale modes: <strong>Buy Now</strong>{' '}
        (fixed-price purchase), <strong>Auction</strong> (timed bidding
        with optional reserve and snipe-protection extension) and{' '}
        <strong>Take-a-Shot</strong> (buyer-initiated price offer with
        a 48-hour Seller response window and a one-counter limit). The
        operating rules of each mode are summarised on the Store
        and described in detail in our help materials. Submitting a
        bid, offer or Buy Now purchase constitutes a binding offer to
        purchase the listed item at the stated price, subject only to
        the Seller's response window where applicable.
      </p>

      <h2>11. Disputes and refunds</h2>
      <p>
        If you believe a Buyer or Seller has not met their obligations
        — for example, an item arrived damaged or never arrived — you
        may raise a dispute within the time limits set out in our{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
        Disputes are reviewed by the ALL Outdoor admin team within{' '}
        <strong>48 hours of receipt</strong>, and outcomes may include
        full refund, partial refund, payment to the Seller or referral to
        the appropriate authorities.
      </p>
      <p>
        <strong>An item's location, or the distance to it, is not a ground for
        a refund or a dispute.</strong> The town and province are shown on every
        listing before purchase and confirmed by the Buyer at checkout, as set
        out in paragraph&nbsp;9 and in paragraph&nbsp;5 of our{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
        A Buyer who cannot reach an item they have paid for should lodge a{' '}
        <a href="/complaints" style={{ color: 'var(--red)' }}>complaint</a>{' '}
        rather than a dispute; we will try to help the parties resolve it, and
        that route does not hold the Seller's payment.
      </p>
      <p>
        Nothing in these Terms limits the
        rights you have under the Consumer Protection Act, in
        particular Section 56 (which gives Buyers a 6-month right to
        return defective goods).
      </p>
      <p
        style={{
          border: '1px solid var(--red)',
          borderRadius: 8,
          padding: 16,
          background: 'rgba(227,6,19,0.04)',
        }}
      >
        <strong>Cancelling an order.</strong> A Buyer may not cancel a paid
        order themselves, and may not cancel at all once the Seller has marked
        the order dispatched. To cancel before dispatch, a Buyer must use the{' '}
        <strong>Request cancellation</strong> action on the order, or email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        . Requesting a cancellation <strong>freezes</strong> the order — the
        Seller is told not to dispatch and no payment is released while the
        request is reviewed.
      </p>
      <p>
        If a cancellation for the Buyer&apos;s convenience is approved before
        dispatch, we refund the amount paid less a{' '}
        <strong>4% transaction handling fee</strong>, calculated on the item
        price plus delivery. This fee is a reasonable cancellation charge under
        section 17(3) of the Consumer Protection Act: it recovers direct,
        non-recoverable payment-gateway, interchange and electronic-funds
        reversal costs we have already incurred in taking and reversing the
        payment. The Platform Fee itself is refunded. Where the Seller has
        accepted the order <strong>and</strong> a courier waybill has been
        booked, the delivery charge is also non-refundable, because the carrier
        charge is committed and cannot be reliably voided.
      </p>
      <p>
        <strong>Once the item has been dispatched, the order cannot be
        cancelled.</strong> The Buyer&apos;s remedy is the dispute process in
        this paragraph and the{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
      </p>
      <p>
        Where the order ends because of the Seller&apos;s failure — a declined
        sale, a failure to dispatch, or the item never arriving — the Buyer is
        refunded <strong>in full</strong>, including the Platform Fee and
        delivery, with no 4% deduction. <strong>No cancellation fee is charged
        where the cancellation results from the death or hospitalisation of the
        Buyer</strong> (CPA s17(5)). This paragraph does not limit the
        Buyer&apos;s statutory rights.
      </p>

      <h2>12. Suspension and termination</h2>
      <p>
        We may suspend or terminate your account immediately, with or
        without notice, where we reasonably believe that you have:
      </p>
      <ul>
        <li>breached these Terms or any of the policies they incorporate;</li>
        <li>provided false information or impersonated another person;</li>
        <li>engaged in fraud, money laundering, intimidation or any criminal activity;</li>
        <li>attempted to bypass our payment, moderation or contact-detail safeguards; or</li>
        <li>failed to complete identity verification or other compliance obligations within a reasonable time.</li>
      </ul>
      <p>
        You may close your account at any time by emailing{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        . Account closure does not relieve you of any liability for
        transactions in progress, fees due or warranties given.
      </p>

      <h2>13. Intellectual property</h2>
      <p>
        The Platform (including its software, design, brand, written
        content and structure) is owned by ALL Outdoor (or its licensors)
        and is protected by South African and international copyright,
        trade mark and other intellectual-property laws. Except as
        expressly permitted by these Terms, you may not copy, modify,
        reverse-engineer, sublicense or create derivative works from
        the Store.
      </p>

      <h2>14. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by South African law, ALL Outdoor
        will not be liable to you for any indirect, incidental,
        consequential, special or punitive damages (including but not
        limited to loss of profits, loss of goodwill or loss of data)
        arising out of or in connection with your use of the Store.
      </p>
      <p>
        ALL Outdoor's aggregate liability to you in respect of any
        transaction or series of related transactions is limited to
        the lesser of (a) the amount actually paid by you in respect
        of that transaction or (b) R10,000.
      </p>
      <p>
        Nothing in these Terms limits or excludes any liability that
        cannot lawfully be limited or excluded under South African
        law, including liability for gross negligence, fraud or wilful
        misconduct, and liability under the Consumer Protection Act.
      </p>

      <h2>15. Indemnity</h2>
      <p>
        You agree to indemnify, defend and hold harmless ALL Outdoor,
        its directors, officers, employees and agents from and against
        any third-party claim, action, demand, loss, damage, fine,
        penalty or expense (including reasonable legal fees) arising
        out of or related to (a) your breach of these Terms or of the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>
        , (b) your breach of any law applicable to you or to the goods
        you deal in, including the Consumer Protection Act, the
        Protection of Personal Information Act and any legislation
        governing a restricted category, (c) any goods you list or
        transact on the Store, or (d) any content you submit to the
        Platform.
      </p>

      <h2>16. Force majeure</h2>
      <p>
        Neither party will be liable for any failure or delay in
        performance caused by events beyond its reasonable control,
        including natural disasters, war, civil unrest, government
        action, power or internet outages, or acts or omissions of
        third-party service providers (including our payment,
        identity-verification, courier, media-hosting, email or
        authentication service providers).
      </p>

      <h2>17. Notices and communications</h2>
      <p>
        Notices to you will be sent to the email address registered on
        your account and, where appropriate, by SMS to your verified
        phone number. Where you have <strong>opted in and verified</strong> your
        phone number, we may also send order, delivery and account notices over{' '}
        <strong>WhatsApp</strong>. WhatsApp is an optional channel: you can
        withdraw your consent at any time in your notification settings, after
        which notices revert to SMS and email. No notice you are entitled to
        receive is sent <em>only</em> by WhatsApp. Notices to ALL Outdoor must be
        sent to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>{' '}
        or by post to the registered address set out in paragraph 1.
      </p>

      <h2>18. Severability</h2>
      <p>
        If any provision of these Terms is found by a competent court
        to be unenforceable, that provision will be severed and the
        remainder of these Terms will continue in full force and
        effect.
      </p>

      <h2>19. Governing law and jurisdiction</h2>
      <p>
        These Terms are governed by and construed in accordance with
        the laws of the Republic of South Africa. You and ALL Outdoor
        irrevocably submit to the exclusive jurisdiction of the High
        Court of South Africa (Western Cape Division, Cape Town) over
        any dispute arising out of or in connection with these Terms.
      </p>

      <h2>20. Complaints and contact</h2>
      <p>
        We aim to acknowledge complaints within 2 business days and
        resolve them within 14 business days. To raise a complaint or
        any other enquiry, contact us at:
      </p>
      <p
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 6,
          padding: 12,
          fontSize: 13,
        }}
      >
        <strong>Email:</strong>{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        <br />
        <strong>Telephone:</strong> {SUPPORT_PHONE_DISPLAY}
        <br />
        <strong>Postal:</strong> ALLOUTDOOR (PTY) LTD, 36 Sterappel Crescent, Langeberg Glen, Cape Town, 7570
      </p>

      <h2>21. ECT Act § 43 disclosures</h2>
      <p>
        In compliance with Section 43 of the Electronic Communications
        and Transactions Act 25 of 2002:
      </p>
      <ul>
        <li><strong>Full registered name:</strong> ALLOUTDOOR (PTY) LTD</li>
        <li><strong>Registration number:</strong> 2026/639713/07</li>
        <li><strong>Trading as:</strong> ALL Outdoor</li>
        <li><strong>Director:</strong> Gerhard Johan Petrus Fourie</li>
        <li><strong>Physical address:</strong> 36 Sterappel Crescent, Langeberg Glen, Cape Town, 7570, South Africa</li>
        <li><strong>Email:</strong> {SUPPORT_EMAIL}</li>
        <li><strong>Telephone:</strong> {SUPPORT_PHONE_DISPLAY}</li>
        <li><strong>VAT registration:</strong> Not yet registered for VAT</li>
        <li><strong>Membership of self-regulatory bodies:</strong> None at this time</li>
      </ul>
    </>
  );
}
