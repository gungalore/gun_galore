// Terms of Service — the master contract between ALL Outdoor and every user
// of the Platform. Drafted with reference to the Electronic Communications and
// Transactions Act 25 of 2002 (section 43), the Consumer Protection Act 68 of
// 2008 and the Protection of Personal Information Act 4 of 2013.
//
// Restricted-category procedure lives in the members-only Regulated Items
// Annex (/members/regulated-items), which these Terms incorporate by reference.
// Public copy must not name excluded goods or restricted category slugs.
//
// House rule: never use the word "escrow". Payment is collected and held by the
// appointed payment service provider pending settlement; ALL Outdoor instructs
// the provider to release the Seller's proceeds under these Terms.

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
      <LegalDocHeader
        title="Terms of Service"
        lastUpdated="Effective 24 June 2026 · Updated 5 November 2026"
      />

      <h2>1. About us</h2>
      <p>
        These Terms of Service (<strong>&quot;Terms&quot;</strong>) form a
        binding agreement between you and <strong>ALLOUTDOOR (PTY) LTD</strong>{' '}
        (registration number <strong>2026/639713/07</strong>), a private company
        registered in the Republic of South Africa with its registered office at{' '}
        <strong>
          Essenhout Plein, Langeberg Glen, Cape Town, 7570
        </strong>{' '}
        (<strong>&quot;ALL Outdoor&quot;</strong>, <strong>&quot;we&quot;</strong>,{' '}
        <strong>&quot;us&quot;</strong> or <strong>&quot;our&quot;</strong>). We
        operate the website and applications available at{' '}
        <a href="https://alloutdoor.co.za" style={{ color: 'var(--red)' }}>
          alloutdoor.co.za
        </a>{' '}
        and the related services described in section 2 (together, the{' '}
        <strong>&quot;Platform&quot;</strong>).
      </p>
      <p>
        <strong>&quot;You&quot;</strong> means the person or business using the
        Platform. If you use the Platform for a business, you confirm that you
        are authorised to bind that business to these Terms.
      </p>

      <h2>2. What ALL Outdoor does</h2>
      <p>
        The Platform is an online marketplace for <strong>new and secondhand
        outdoor goods</strong>. Registered users (<strong>&quot;Sellers&quot;</strong>)
        may list items for sale by fixed price or auction, and other registered
        users (<strong>&quot;Buyers&quot;</strong>) may buy those items, place
        bids or make offers. We provide the marketplace, checkout, payment
        facilitation, delivery arrangement and support. We do not manufacture,
        own, stock, inspect or dispatch the goods sold by Sellers.
      </p>

      <h3>Regulated items</h3>
      <p>
        Some categories are restricted by law or by our own rules. Listings in
        those categories are available only to signed-in members who meet the
        additional eligibility, verification and handling requirements. The{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>{' '}
        forms part of these Terms and is incorporated by reference. Some goods
        are excluded from the Platform entirely; the Annex sets out which goods
        may be listed, by whom, and on what conditions.
      </p>

      <h3>Our role in a sale</h3>
      <p>
        For every sale of goods, the contract of sale is between the Seller and
        the Buyer. We are not the seller, buyer, agent, principal, partner,
        joint venturer or insurer of either party. We do not take title to the
        goods. We provide the venue, checkout, payment facilitation, delivery
        arrangement and dispute support described in these Terms. The Seller is
        responsible for the listing, title, legality, condition and delivery of
        the goods. The Buyer is responsible for eligibility, payment, the
        delivery information provided and lawful use of the goods.
      </p>
      <p>
        Where an item requires a licence or permit, physical possession is
        transferred only through the authorised channel prescribed for that
        category. ALL Outdoor is not an authorised dealer in any restricted
        category and does not handle such items in any physical capacity.
      </p>

      <h3>Other tools</h3>
      <p>
        The Platform also provides optional tools, including the Licence Centre
        (document storage and motivation preparation), The Bench (a reloading
        reference tool) and valuation tools. These are convenience tools. They
        are not legal, financial, firearms-licensing, safety or reloading
        advice, and we do not guarantee that an application will be approved, a
        valuation will be accurate or a load will be safe. Use the current
        official sources and a qualified professional where appropriate.
        Additional notices displayed in those tools form part of these Terms.
        Any charge for an optional tool will be shown before you use it.
      </p>

      <h2>3. Acceptance and changes</h2>
      <p>
        By creating an account, listing an item, placing a bid, making an offer
        or completing a purchase, you confirm that you have read, understood
        and agree to be bound by these Terms, our{' '}
        <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>,
        our{' '}
        <a href="/acceptable-use" style={{ color: 'var(--red)' }}>
          Acceptable Use Policy
        </a>{' '}
        and, where applicable, our{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>{' '}
        and{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>
          Refund &amp; Dispute Policy
        </a>
        . Your acceptance at registration applies to every later transaction,
        including the in-person handover, contact-sharing and Platform Fee terms
        in sections 7 and 8.
      </p>
      <p>
        We may update these Terms from time to time. If a change materially
        affects your rights or obligations, we will notify you by email or
        in-app notice and post the change on the Platform at least{' '}
        <strong>14 days before</strong> it takes effect. If you do not agree,
        stop using the Platform and close your account before the effective
        date. If you continue to use the Platform after the effective date, the
        updated Terms apply. We may make changes required by law immediately.
      </p>

      <h2>4. Eligibility</h2>
      <p>To register and use the Platform you must:</p>
      <ul>
        <li>
          be at least <strong>18 years old</strong>;
        </li>
        <li>
          be a permanent resident of, or lawfully present in, the Republic of
          South Africa;
        </li>
        <li>have the legal capacity to enter into a binding contract;</li>
        <li>not have been previously banned by ALL Outdoor;</li>
        <li>
          where you list, bid on or purchase an item in a restricted category,
          hold and continue to hold every competency, licence, permit or other
          authorisation required for that item for the whole transaction, as set
          out in the{' '}
          <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
            Regulated Items Annex
          </a>
          ; and
        </li>
        <li>
          complete any identity or bank verification we require. Identity
          verification is a Seller-only payout requirement; it is not a
          condition of buying, bidding or making an offer.
        </li>
      </ul>

      <h3>Firearm purchases and dealer transfers</h3>
      <p>
        By completing a firearm checkout you confirm that you are at least 21
        years old (or a dedicated sport shooter or dedicated hunter under 21
        with your legal guardian&apos;s written consent), that you are legally
        entitled to own and receive the firearm under South African law, and
        that you hold every SAPS competency required for its calibre and type.
        Submitting that confirmation dishonestly may be a criminal offence.
      </p>
      <p>
        On a dealer transfer, the payment service provider holds the payment
        while the Seller takes the firearm to a SAPS-licensed dealer to be
        signed over and booked into the dealer&apos;s stock register. The
        Seller then uploads the completed SAPS 534, the last line of the
        dealer&apos;s stock register, and a photograph of the firearm with its
        serial number visible. We use automated checks and human review where
        needed.
      </p>
      <p>
        Once the stock-in is verified, we send the Buyer the dealer&apos;s name,
        address and contact details and instruct the payment service provider
        to release the held funds to the Seller. Our role in the transaction
        ends there. The Buyer and Seller arrange the inter-dealer transfer or
        collection between themselves, subject to the Regulated Items Annex.
      </p>
      <p>
        The SAPS 534 should be completed in <strong>BLOCK LETTERS</strong> so it
        can be read. Unclear handwriting is flagged for manual review and delays
        the Seller&apos;s payout and everything that follows. The dealer name
        and location shown on the listing and at checkout identify where the
        firearm is being transferred. Location and distance are not grounds for
        a refund or dispute, as set out in sections 9 and 11.
      </p>

      <h2>5. Your account</h2>
      <p>You agree to:</p>
      <ul>
        <li>
          provide accurate, current and complete information when you register
          and keep it up to date;
        </li>
        <li>
          keep your account credentials confidential and not share access with
          any third party;
        </li>
        <li>
          notify us immediately at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
            {SUPPORT_EMAIL}
          </a>{' '}
          of any unauthorised use of your account;
        </li>
        <li>
          maintain a single ALL Outdoor account (multiple accounts per natural
          person are not permitted); and
        </li>
        <li>
          cooperate fully and truthfully with any verification, dispute or
          compliance request we make.
        </li>
      </ul>
      <p>
        You are responsible for all activity under your account, including
        listings, bids, offers, payments and communications. Our{' '}
        <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>{' '}
        explains how we process your personal information.
      </p>

      <h2>6. Listings, content and conduct</h2>
      <p>
        All listings, photographs, descriptions, questions, answers, ratings,
        messages and other content you submit must comply with our{' '}
        <a href="/acceptable-use" style={{ color: 'var(--red)' }}>
          Acceptable Use Policy
        </a>
        . We may remove, modify, hide or reject any listing or content that, in
        our reasonable opinion, breaches that policy, breaches any law or
        creates a risk for the Platform or its users. We are not obliged to
        monitor every listing, and removing one item does not make us
        responsible for the rest.
      </p>
      <p>
        You retain ownership of the content you submit. By submitting content,
        you grant ALL Outdoor a non-exclusive, royalty-free, worldwide licence
        to host, display, copy, distribute and make derivative works of that
        content for the purpose of operating, promoting and improving the
        Platform. You confirm that you own or have the right to use that content
        and that it does not infringe anyone else&apos;s rights.
      </p>
      <p>
        Listings, ratings and pre-purchase questions are moderated for
        prohibited content, including contact details intended to route around
        the Platform. Where we provide on-platform messaging, messages are
        monitored by automated systems for content that attempts to move a deal
        off the Platform, shares contact details or is otherwise prohibited.
        Prohibited contact details are removed before delivery and the original
        is retained for audit. Do not share phone numbers, email addresses,
        social handles, physical addresses or payment details in messages,
        except through any contact-reveal feature we provide after payment for
        an in-person handover. Repeated or deliberate attempts to bypass this
        monitoring may result in suspension or a permanent ban.
      </p>
      <p>
        <strong>No off-platform dealing.</strong> You may not use the Platform
        to arrange a sale outside it in order to avoid the Platform Fee or the
        payment protection described in these Terms. If you do, you lose that
        protection and we may suspend or terminate your account.
      </p>

      <h3>Seller undertakings</h3>
      <p>If you list an item, you confirm that:</p>
      <ul>
        <li>
          you have the legal right and authority to sell it and to transfer
          clear title;
        </li>
        <li>
          it is lawful to sell and possess it, and it is not stolen, counterfeit
          or subject to a third-party claim;
        </li>
        <li>
          the description, condition, photographs and disclosures are accurate
          and complete;
        </li>
        <li>
          you will comply with the Regulated Items Annex and every law that
          applies to the item and the sale; and
        </li>
        <li>
          you will dispatch or make the item available within the time required
          by these Terms and cooperate with any dispute.
        </li>
      </ul>

      <h3>Buyer undertakings</h3>
      <p>If you buy, bid or make an offer, you confirm that:</p>
      <ul>
        <li>
          you meet the eligibility requirements for the item and will maintain
          them for the whole transaction;
        </li>
        <li>
          you are authorised to use the payment method and have sufficient
          funds;
        </li>
        <li>
          the delivery information you provide is accurate and complete; and
        </li>
        <li>
          you will use the item lawfully, inspect it promptly and not raise a
          fraudulent dispute or chargeback.
        </li>
      </ul>

      <h2 id="payments">7. Payments and settlement</h2>
      <p>
        All prices are quoted and charged in South African Rand (ZAR). Payments
        are processed by our appointed third-party payment service provider (a
        licensed South African payment service provider). By making a payment,
        you authorise the provider to capture the amount from your chosen
        payment instrument and you authorise ALL Outdoor to instruct the
        provider to pay the Seller&apos;s proceeds in accordance with these
        Terms. A payment is not complete until the provider confirms it.
      </p>
      <p>
        For most transactions, settlement is <strong>deferred</strong>. The
        payment service provider collects the payment at checkout and holds it
        pending settlement. We instruct the provider to pay the Seller (less
        the applicable fees) once the release condition in these Terms or the{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>
          Refund &amp; Dispute Policy
        </a>{' '}
        is met: the Buyer confirms delivery, a dealer transfer is verified, the
        applicable private-arrangement period ends, or a dispute is resolved.
        We may delay settlement where a dispute, chargeback, fraud check,
        verification issue, legal order or unpaid amount requires it. We will
        release the amount once the issue is resolved.
      </p>
      <p>
        Deferred settlement is a buyer-protection measure. It is not a banking,
        savings, investment or deposit-taking product. ALL Outdoor is not a
        bank, does not pay interest on amounts pending settlement, does not
        guarantee those amounts against the insolvency of the payment service
        provider, and is not a registered financial services provider. We do
        not operate a wallet or stored-value balance.
      </p>

      <h3>In-person handover</h3>
      <p>
        Where the Buyer chooses the <strong>in-person handover</strong> option,
        the parties arrange and complete the handover themselves, at a
        SAPS-licensed dealer where the item is a firearm. The payment is
        collected at checkout and held pending settlement. It is released when
        the Buyer confirms receipt, or automatically <strong>five days after
        payment</strong> if no dispute is raised before then. We send WhatsApp,
        SMS, email and in-app notifications with a one-tap confirmation link
        when the handover is due, subject to your notification settings. Either
        party may raise a dispute before release, which holds the payment for
        review by our admin team. The in-person handover option is available on
        every listing that is not collection-only, including firearms, subject
        to the Regulated Items Annex.
      </p>
      <p>
        <strong>The Platform Fee on an in-person handover.</strong> If the
        Seller declines the order before dispatch, the Buyer is refunded in
        full. If a Buyer-requested cancellation or an upheld dispute results in
        a refund, the Buyer is refunded the item price only; the Platform Fee is
        non-refundable. Nothing in this clause limits a refund required by the
        Consumer Protection Act.
      </p>
      <p>
        <strong>Contact details for an in-person handover.</strong> When you
        choose an in-person handover, you agree that we may share your name,
        phone number and email address with the other party after payment so
        that you can arrange and complete the handover (for a firearm, at a
        SAPS-licensed dealer). Each party may use those details only for that
        purpose. There is no courier tracking and no delivery guarantee on an
        in-person handover: if you want tracking or a delivery guarantee, choose
        courier delivery (or dealer transfer for a firearm) instead. Your
        acceptance of these Terms at registration covers every in-person
        handover you later choose at checkout.
      </p>

      <h2>8. Fees, commission and payouts</h2>
      <p>
        We charge a single <strong>Platform Fee</strong> on each completed sale.
        The fee shown at listing and checkout is the fee that applies to that
        sale. Our current rates are published at{' '}
        <a href="/fees" style={{ color: 'var(--red)' }}>alloutdoor.co.za/fees</a>.
      </p>
      <ul>
        <li>
          <strong>Buy Now.</strong> The amount the Seller enters is the listed
          price and the amount the Seller is to receive. The Buyer pays the
          Platform Fee on top at checkout, calculated last on the item price
          plus delivery. Nothing is deducted from the Seller.
        </li>
        <li>
          <strong>Auction.</strong> The sale price is the winning bid. The
          Platform Fee is a flat 10%, split equally: the Buyer pays 5% of the
          combined hammer price and delivery charge at checkout, and the Seller
          pays 5% of the hammer price, deducted from the Seller&apos;s proceeds.
          An offer accepted on an auction uses the auction fee split; an offer
          accepted on a Buy Now listing uses the Buy Now fee.
        </li>
        <li>
          <strong>Private arrangement.</strong> There is no delivery charge, so
          the fee is calculated on the item price alone. The Buyer pays the fee
          and the Seller receives the agreed price, less the 5% auction share
          where the sale arose from an auction.
        </li>
      </ul>
      <p>
        The Buy Now Platform Fee is banded: 10% on the first R25,000, 9% from
        R25,001 to R50,000, 8% from R50,001 to R75,000 and 7% above R75,000,
        with a R10 minimum. Only the portion inside each band is charged at that
        band&apos;s rate. The fee is calculated on the whole line after
        quantity. The calculation shown at checkout is snapshotted onto the
        transaction and is not changed by later rate changes.
      </p>
      <p>
        Delivery carries no Platform margin. The Buyer pays the courier&apos;s
        live rate for the selected option.
      </p>
      <p>
        Sellers are paid in South African Rand by electronic funds transfer to
        the bank account linked to their account. Before the first payout, we
        verify that the bank account belongs to the verified Seller. We do not
        pay third parties or accounts not in the Seller&apos;s name. Payouts may
        be delayed while identity, bank or transaction checks are incomplete,
        or while a dispute, chargeback or amount owed is unresolved. Sellers are
        responsible for their own taxes and for maintaining accurate bank
        details.
      </p>

      <h2>9. Shipping and delivery</h2>
      <p>
        The Seller is responsible for packing and making the item available for
        collection or dispatch. The Buyer chooses from the delivery options
        offered for that listing at checkout, and pays the courier&apos;s live
        rate for the option selected. Depending on the listing, the options may
        include door delivery, a pickup point, collection in person, dealer
        transfer or a private arrangement. The Platform re-quotes the selected
        courier option at payment; the Buyer is not charged a browser-supplied
        price.
      </p>
      <p>
        <strong>Firearms and barrels are never sent by courier.</strong> They
        move only through <strong>DEALER_TRANSFER</strong> or{' '}
        <strong>PRIVATE_ARRANGE</strong>, as set out in the Regulated Items
        Annex. Items that require a licence or permit may not be sent by
        ordinary courier and may not be delivered to a residential address.
      </p>
      <p>
        <strong>Collection-only items.</strong> Trailers, caravans, oversized or
        awkward goods, and dangerous goods such as batteries sold on their own
        may be marked collection only. No courier is quoted for them. The Buyer
        collects the item from the Seller or sends their own transporter; ALL
        Outdoor does not arrange, quote, carry or insure that transport.
      </p>
      <p>
        Delivery may take up to <strong>10 business days from payment</strong>.
        Delivery dates are estimates and are not guaranteed. Delivery is
        available within the Republic of South Africa only; we do not ship
        cross-border.
      </p>
      <p>
        The Seller must <strong>accept a paid order within 48 hours</strong>. If
        the Seller does not accept, we may contact the Seller and may cancel the
        order and refund the Buyer in full. Once the Seller accepts, the Seller
        must <strong>dispatch or hand over the item within five days</strong>.
        If the Seller does not, we may remind the Seller, cancel the order and
        refund the Buyer in full. A dealer transfer must be delivered to the
        dealer within the same dispatch window. These remedies are in addition
        to the Buyer&apos;s other rights.
      </p>
      <p>
        Every listing shows the town and province the item is in before
        purchase, and the Buyer confirms at checkout that they have seen it.
        That location is the agreed place for collection or hand-over for the
        purposes of section 19 of the Consumer Protection Act. Travel, fuel, a
        transporter or a licensed dealer&apos;s own fees are the Buyer&apos;s
        cost and responsibility, and are not part of the price shown.
      </p>
      <p>
        Risk in the goods passes from the Seller to the Buyer when the item is
        delivered or collected. Title passes when the Buyer has paid in full and
        the item has been delivered or collected, unless the law provides
        otherwise. If the Buyer provides an incorrect address or refuses
        delivery, the Buyer is responsible for any re-delivery cost.
      </p>
      <p
        id="courier-reweigh"
        style={{
          border: '1px solid var(--red)',
          borderRadius: 8,
          padding: 16,
          background: 'rgba(227,6,19,0.04)',
        }}
      >
        <strong>Courier re-weigh charge — the Seller&apos;s liability.</strong>{' '}
        When the Seller offers courier delivery, the Seller states the packed
        parcel&apos;s weight and dimensions, and the courier rate the Buyer pays
        is calculated from that declaration. Couriers may weigh and measure a
        parcel when they collect it. If the parcel is heavier or larger than
        declared, the courier will still carry it and will bill ALL Outdoor the
        higher rate. <strong>The Seller is liable for that difference.</strong>{' '}
        We recover it by deducting it from the Seller&apos;s payout — from this
        sale, or, if this sale has already been paid out, by setting it off
        against any amount we later owe the Seller — and we issue the Seller an
        invoice showing the rate quoted, the amount the courier billed and the
        reason for the charge. The deduction is itemised on the Seller&apos;s
        remittance advice. The Buyer is never charged more than the delivery
        figure quoted at checkout, and no part of this difference is passed on to
        the Buyer. The charge is a recovery of the carrier&apos;s cost, not a
        penalty. Where a Seller repeatedly under-declares a parcel we may review
        the account.
      </p>

      <h2>10. Buy Now, offers and auctions</h2>
      <p>
        Listings are offered as <strong>Buy Now</strong> (fixed price) or{' '}
        <strong>Auction</strong> (timed bidding with an optional reserve and
        snipe-protection extension). Eligible Buy Now and Auction listings may
        also accept <strong>offers</strong> from Buyers.
      </p>
      <ul>
        <li>
          <strong>Buy Now.</strong> A completed purchase is binding at the listed
          price, subject to payment.
        </li>
        <li>
          <strong>Offers.</strong> An offer is a binding offer to buy at the
          amount stated for the period shown. The Seller may accept, reject or
          counter it. Once the Seller accepts, the Buyer must pay through the
          checkout within the time allowed. The Seller may accept only one
          offer for the item.
        </li>
        <li>
          <strong>Auctions.</strong> A bid is a binding offer to buy at the bid
          amount, subject to any reserve. The highest valid bid at the end of
          the auction wins, provided the reserve is met. The winner must pay
          through the checkout within the time allowed. If the winner does not
          pay, we may cancel the sale, relist the item or offer it to the next
          bidder.
        </li>
      </ul>
      <p>
        <strong>Minimum auction values.</strong> Because a longer auction costs
        more to operate, each duration carries a minimum committed value:{' '}
        <strong>3 days — R2,500</strong>; <strong>5 days — R5,000</strong>;{' '}
        <strong>7 days — R7,500</strong>; and <strong>14 days — R10,000</strong>.
        The minimum applies to the reserve where one is set, or otherwise to the
        starting bid. Where a reserve is set, the starting bid is calculated at
        70% of the reserve and may therefore sit below the minimum; it is the
        reserve that must meet it.
      </p>
      <p>
        We may cancel a bid, offer or auction, or remove a listing, where we
        reasonably believe there is an error, fraud, shill bidding, a breach of
        these Terms or a legal requirement. We are not liable for a bid or offer
        that is invalid for that reason.
      </p>

      <h2 id="disputes">11. Disputes, cancellations and refunds</h2>
      <p>
        If you believe a Buyer or Seller has not met their obligations, you may
        raise a dispute within the time limits in our{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>
          Refund &amp; Dispute Policy
        </a>
        . We aim to make first contact within <strong>48 hours</strong>. Outcomes
        may include a full refund, a partial refund, payment to the Seller or
        referral to the appropriate authorities. We may ask for photographs,
        tracking records or other evidence.
      </p>
      <p>
        <strong>An item&apos;s location, or the distance to it, is not a ground
        for a refund or a dispute.</strong> The town and province are shown on
        every listing before purchase and confirmed by the Buyer at checkout, as
        set out in section 9. A Buyer who cannot reach an item they have paid
        for should lodge a{' '}
        <a href="/complaints" style={{ color: 'var(--red)' }}>complaint</a>{' '}
        rather than a dispute; we will try to help the parties resolve it, and
        that route does not hold the Seller&apos;s payment. This does not
        restrict a claim for an item that never arrived, arrived damaged, or was
        not as described.
      </p>
      <p>
        Nothing in these Terms limits the rights you have under the Consumer
        Protection Act 68 of 2008, including section 56 (the six-month implied
        warranty of quality) and section 19 (delivery at the agreed time and
        place).
      </p>
      <p id="buyer-protection">
        <strong>Buyer protection.</strong> Every order includes the following
        safeguards, funded by the Platform Fee: the Seller is paid only once
        delivery is confirmed or a dealer transfer is verified; Sellers are
        identity-verified, and their bank details are reviewed against that
        identity, before any payout; raising an issue instead of confirming
        delivery freezes the payment and puts the order in front of our team;
        and where a claim is upheld the Buyer is refunded and the Seller is not
        paid. These safeguards are not insurance, and they do not change the
        fact that the agreement of sale is between the Buyer and the Seller.
        They do not cover buyer&apos;s remorse or a change of mind after
        delivery, an item the Buyer inspected and accepted where the fault was
        apparent at the time, or losses caused by something outside our control
        after a correct delivery.
      </p>

      <h3>Cancelling an order</h3>
      <p
        style={{
          border: '1px solid var(--red)',
          borderRadius: 8,
          padding: 16,
          background: 'rgba(227,6,19,0.04)',
        }}
      >
        A Buyer may not cancel a paid order without our approval. To cancel
        before dispatch, the Buyer must use the <strong>Request cancellation</strong>{' '}
        action on the order, or email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        . Requesting a cancellation <strong>freezes</strong> the order: the
        Seller is told not to dispatch and no payment is released while the
        request is reviewed. A cancellation cannot be requested after the Seller
        marks the order dispatched, after a private-arrangement handover has
        been recorded, or after a store collection has been confirmed. Once the
        item has been dispatched, the Buyer&apos;s remedy is the dispute process.
      </p>
      <p>
        If a cancellation for the Buyer&apos;s convenience is approved before
        dispatch, we refund the amount paid less a{' '}
        <strong>4% transaction handling fee</strong>, calculated on the item
        price plus delivery. This fee is a reasonable cancellation charge under
        section 17(3) of the Consumer Protection Act: it recovers direct,
        non-recoverable payment-gateway, interchange and electronic-funds
        reversal costs we have already incurred in taking and reversing the
        payment. The Platform Fee itself is refunded, except for an in-person
        handover, where section 7 applies. Where the Seller has accepted the
        order <strong>and</strong> a courier waybill has been booked, the
        delivery charge is also non-refundable, because the carrier charge is
        committed and cannot be reliably voided.
      </p>
      <p>
        Where the order ends because of the Seller&apos;s failure — a declined
        sale, a failure to dispatch, or the item never arriving — the Buyer is
        refunded <strong>in full</strong>, including the Platform Fee and
        delivery, with no 4% deduction, except for an in-person handover, where
        section 7 applies. No cancellation fee is charged where the cancellation
        results from the death or hospitalisation of the Buyer (Consumer
        Protection Act section 17(5)). This paragraph does not limit the
        Buyer&apos;s statutory rights.
      </p>
      <p
        id="seller-failure-charge"
        style={{
          border: '1px solid var(--red)',
          borderRadius: 8,
          padding: 16,
          background: 'rgba(227,6,19,0.04)',
        }}
      >
        <strong>Seller failure charge.</strong> If a paid sale ends because the
        Seller declined it, failed to dispatch it, or failed to deliver it, the
        Seller indemnifies ALL Outdoor for the costs of that refund that ALL
        Outdoor cannot recover: a payment-gateway charge of{' '}
        <strong>4% of the amount refunded</strong>, and the courier charge for
        any waybill already booked. ALL Outdoor may set that amount off against
        any amount it later owes the Seller, including a later payout, and will
        email the Seller after the delivery obligation period to state the
        amount and the reason. The charge is a recovery of cost, not a penalty,
        and does not apply where the failure was not the Seller&apos;s (for
        example, a courier failure or a Buyer-caused problem).
      </p>
      <p>
        Refunds are made through the payment service provider to the original
        payment method where possible. Timing depends on the provider and your
        bank. If a payment is reversed or charged back, you authorise us to
        recover the amount and any reasonable costs from you and to set them off
        against any amount we owe you. We may suspend an account while a
        chargeback or suspected fraud is investigated.
      </p>

      <h2>12. Suspension and termination</h2>
      <p>
        We may suspend or terminate your account immediately, with or without
        notice, where we reasonably believe that you have:
      </p>
      <ul>
        <li>breached these Terms or any policy they incorporate;</li>
        <li>provided false information or impersonated another person;</li>
        <li>
          engaged in fraud, money laundering, intimidation or any criminal
          activity;
        </li>
        <li>
          attempted to bypass our payment, moderation or contact-detail
          safeguards; or
        </li>
        <li>
          failed to complete identity verification or other compliance
          obligations within a reasonable time.
        </li>
      </ul>
      <p>
        We may also suspend a transaction or payout while we investigate a
        dispute, chargeback, fraud, verification issue or legal requirement. We
        will release amounts not subject to the issue once it is resolved.
      </p>
      <p>
        You may close your account at any time by emailing{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        . Account closure does not relieve you of liability for transactions in
        progress, fees due, warranties given or amounts owed.
      </p>

      <h2>13. Intellectual property</h2>
      <p>
        The Platform, including its software, design, brand, written content and
        structure, is owned by ALL Outdoor or its licensors and is protected by
        South African and international copyright, trade mark and other
        intellectual-property laws. Except as expressly permitted by these
        Terms, you may not copy, modify, reverse-engineer, sublicense or create
        derivative works from the Platform.
      </p>
      <p>
        If you send us feedback or suggestions, you grant us a perpetual,
        royalty-free licence to use them without obligation to you. Nothing in
        this section transfers ownership of your own content.
      </p>

      <h2>14. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by South African law, ALL Outdoor will
        not be liable to you for any indirect, incidental, consequential,
        special or punitive damages (including loss of profits, loss of goodwill
        or loss of data) arising out of or in connection with your use of the
        Platform.
      </p>
      <p>
        ALL Outdoor&apos;s aggregate liability to you in respect of any
        transaction or series of related transactions is limited to the lesser
        of (a) the amount actually paid by you in respect of that transaction or
        (b) R10,000.
      </p>
      <p>
        We do not warrant that every listing is accurate, that a Seller or Buyer
        will perform, or that the Platform will be uninterrupted or error-free.
        We may suspend the Platform for maintenance, security or legal reasons.
        Nothing in these Terms limits or excludes any liability that cannot
        lawfully be limited or excluded under South African law, including
        liability for gross negligence, fraud or wilful misconduct, and
        liability under the Consumer Protection Act.
      </p>

      <h2>15. Indemnity</h2>
      <p>
        You agree to indemnify, defend and hold harmless ALL Outdoor, its
        directors, officers, employees and agents from and against any
        third-party claim, action, demand, loss, damage, fine, penalty or
        expense (including reasonable legal fees) arising out of or related to
        (a) your breach of these Terms or of the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>
        , (b) your breach of any law applicable to you or to the goods you deal
        in, including the Consumer Protection Act, the Protection of Personal
        Information Act and any legislation governing a restricted category,
        (c) any goods you list or transact on the Platform, (d) any content you
        submit, or (e) any chargeback, fraudulent payment or claim arising from
        your use of the Platform. We may control the defence of a claim and you
        will cooperate with us.
      </p>

      <h2>16. Force majeure</h2>
      <p>
        Neither party is liable for a failure or delay in performance caused by
        an event beyond its reasonable control, including natural disasters,
        war, civil unrest, government action, power or internet outages, or acts
        or omissions of third-party service providers (including payment,
        identity-verification, courier, media-hosting, email or authentication
        providers). This does not excuse a party from paying an amount already
        due.
      </p>

      <h2>17. Notices and communications</h2>
      <p>
        Notices to you will be sent to the email address registered on your
        account and, where appropriate, by SMS to your verified phone number. If
        you have <strong>opted in and verified</strong> your phone number, we may
        also send order, delivery and account notices over{' '}
        <strong>WhatsApp</strong>. WhatsApp is an optional channel: you can
        withdraw your consent at any time in your notification settings, after
        which notices revert to SMS and email. No notice you are entitled to
        receive is sent <em>only</em> by WhatsApp. You must keep your contact
        details current.
      </p>
      <p>
        Notices to ALL Outdoor must be sent to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>{' '}
        or by post to the registered address in section 1. Electronic notices
        satisfy any requirement that a communication be in writing, unless the
        law requires otherwise.
      </p>

      <h2>18. General</h2>
      <p>
        If any provision of these Terms is found by a competent court to be
        unenforceable, it will be severed and the remainder will continue in
        full force. A failure to enforce a provision is not a waiver. These
        Terms, together with the policies and Annex incorporated by reference,
        are the entire agreement between you and ALL Outdoor about the Platform.
        You may not assign your rights or obligations without our written
        consent. We may assign our rights to a successor or purchaser of the
        business. No third party acquires rights under these Terms. Headings are
        for convenience only. Provisions that by their nature should survive
        termination (including payment, indemnity, liability and governing-law
        provisions) survive.
      </p>

      <h2>19. Governing law and jurisdiction</h2>
      <p>
        These Terms are governed by and construed in accordance with the laws of
        the Republic of South Africa. The parties submit to the jurisdiction of
        the courts of the Republic of South Africa. Nothing in this section
        prevents a consumer from referring a complaint to the National Consumer
        Commission, the National Consumer Tribunal, the Consumer Goods and
        Services Ombud, the Information Regulator or another forum that the law
        makes available to them.
      </p>

      <h2>20. Complaints and contact</h2>
      <p>
        We aim to acknowledge complaints within <strong>2 business days</strong>{' '}
        and resolve them within <strong>14 business days</strong>. To raise a
        complaint or any other enquiry, contact us at:
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
        <strong>Postal:</strong> ALLOUTDOOR (PTY) LTD, Essenhout Plein, Langeberg
        Glen, Cape Town, 7570
      </p>

      <h2>21. ECT Act section 43 disclosures</h2>
      <p>
        In compliance with section 43 of the Electronic Communications and
        Transactions Act 25 of 2002:
      </p>
      <ul>
        <li>
          <strong>Full registered name:</strong> ALLOUTDOOR (PTY) LTD
        </li>
        <li>
          <strong>Registration number:</strong> 2026/639713/07
        </li>
        <li>
          <strong>Trading as:</strong> ALL Outdoor
        </li>
        <li>
          <strong>Director:</strong> Gerhard Johan Petrus Fourie
        </li>
        <li>
          <strong>Physical address:</strong> Essenhout Plein, Langeberg Glen,
          Cape Town, 7570, South Africa
        </li>
        <li>
          <strong>Email:</strong> {SUPPORT_EMAIL}
        </li>
        <li>
          <strong>Telephone:</strong> {SUPPORT_PHONE_DISPLAY}
        </li>
        <li>
          <strong>VAT registration:</strong> Not yet registered for VAT
        </li>
        <li>
          <strong>Membership of self-regulatory bodies:</strong> None at this
          time
        </li>
      </ul>
    </>
  );
}
