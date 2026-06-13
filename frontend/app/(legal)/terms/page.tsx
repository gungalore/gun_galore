// Terms of Service — the master contract between Gun Galore and
// every user of the platform. Drafted with reference to:
//   - Electronic Communications and Transactions Act 25 of 2002 (§ 43)
//   - Consumer Protection Act 68 of 2008
//   - Protection of Personal Information Act 4 of 2013
//   - Firearms Control Act 60 of 2000
//
// Conventions in this file:
//   - "GunGalore" / "we" / "us" / "our" = GunGalore (Pty) Ltd
//   - "you" / "your" = any user of the platform
//   - Per the operator's policy, this document NEVER uses the word
//     "escrow" (regulated SA financial term that GunGalore is not
//     registered to operate). The funds-held mechanism is described
//     as "payment held" or "funds held" throughout.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Terms of Service — Gun Galore',
  description:
    'The contract governing your use of GunGalore (Pty) Ltd. Drafted under South African law.',
};

export default function TermsPage() {
  return (
    <>
      <LegalDocHeader title="Terms of Service" lastUpdated="pre-launch · v0.1 draft" />

      <h2>1. About us</h2>
      <p>
        These Terms of Service (<strong>"Terms"</strong>) form a binding
        agreement between you and <strong>GunGalore (Pty) Ltd</strong>{' '}
        (registration number <strong>2026/393321/07</strong>), a private
        company registered in the Republic of South Africa with its
        registered office at <strong>36 Sterappel Crescent, Langeberg
        Glen, Cape Town, 7570</strong>{' '}
        (collectively "<strong>GunGalore</strong>", "<strong>we</strong>",
        "<strong>us</strong>" or "<strong>our</strong>"). GunGalore
        operates the website and applications available at{' '}
        <a href="https://gungalore.co.za" style={{ color: 'var(--red)' }}>
          gungalore.co.za
        </a>{' '}
        (the "<strong>Platform</strong>").
      </p>

      <h2>2. What GunGalore does</h2>
      <p>
        GunGalore is an online marketplace that allows registered users
        ("<strong>Sellers</strong>") to list firearms, ammunition,
        accessories and related outdoor goods for sale or auction, and
        allows other registered users ("<strong>Buyers</strong>") to
        purchase those goods. GunGalore is a <strong>platform</strong> —
        we do not own, stock, dispatch or directly sell any of the goods
        listed on the Platform. Where a transaction involves a firearm
        or any other item subject to the Firearms Control Act, physical
        possession is transferred only through a SAPS-licensed dealer.
        GunGalore is not a SAPS-licensed dealer and does not handle
        firearms in any physical capacity.
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
        <a href="/firearms-compliance" style={{ color: 'var(--red)' }}>Firearms Compliance Policy</a>{' '}
        and{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
      </p>
      <p>
        We may amend these Terms from time to time. Material amendments
        will be notified to you by email and posted on the Platform at
        least <strong>14 days before</strong> they take effect. Your
        continued use of the Platform after that period constitutes
        acceptance of the amended Terms. If you do not agree, you may
        close your account at any time.
      </p>

      <h2>4. Eligibility</h2>
      <p>
        To register and use GunGalore you must:
      </p>
      <ul>
        <li>be at least <strong>18 years old</strong>;</li>
        <li>be a permanent resident of, or lawfully present in, the Republic of South Africa;</li>
        <li>have the legal capacity to enter into a binding contract;</li>
        <li>not have been previously banned by GunGalore;</li>
        <li>where you list, bid on or purchase a firearm or any item subject to the Firearms Control Act, hold (and continue to hold throughout the transaction) the relevant <strong>SAPS Competency Certificate</strong> and any required <strong>Possession Licence</strong>; and</li>
        <li>where applicable, complete our identity verification (KYC) process before payouts are released to you.</li>
      </ul>

      <h2>5. Your account</h2>
      <p>
        You agree to:
      </p>
      <ul>
        <li>provide accurate, current and complete information when you register;</li>
        <li>keep your account credentials confidential and not share access with any third party;</li>
        <li>notify us immediately at <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>support@gungalore.co.za</a> of any unauthorised use of your account;</li>
        <li>maintain a single GunGalore account (multiple accounts per natural person are not permitted); and</li>
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
        ratings, notes and other content you submit to the Platform must
        comply with our{' '}
        <a href="/acceptable-use" style={{ color: 'var(--red)' }}>Acceptable Use Policy</a>.
        We reserve the right (but assume no obligation) to remove,
        modify, hide or reject any listing or content that, in our
        reasonable opinion, breaches that policy, breaches any law, or
        is otherwise harmful to GunGalore or its users.
      </p>
      <p>
        You retain ownership of any content you submit. By submitting
        content you grant GunGalore a non-exclusive, royalty-free,
        worldwide licence to host, display, copy, distribute and make
        derivative works of that content for the purpose of operating
        and promoting the Platform.
      </p>
      <p>
        Listings, ratings and pre-purchase Q&amp;A are automatically
        moderated for prohibited content (including contact details
        intended to route around the Platform). Repeated attempts to
        bypass these controls may result in suspension or permanent
        ban.
      </p>

      <h2>7. Payments and the funds-held mechanism</h2>
      <p>
        All payments on GunGalore are processed by{' '}
        <strong>Stitch Express</strong>, a licensed South African
        payment service provider. By making a payment you authorise
        Stitch Express to capture funds from your chosen payment
        instrument, and you authorise GunGalore to instruct release of
        the seller payout in accordance with these Terms.
      </p>
      <p>
        For most transactions, GunGalore operates a{' '}
        <strong>funds-held mechanism</strong>: the Buyer's payment is
        captured by Stitch Express at checkout and the resulting
        amount (less commission and processing fees) is held until the
        Buyer confirms delivery of the item, the Buyer's confirmation
        window elapses, or a dispute is resolved. Once one of these
        triggers occurs, GunGalore instructs Stitch Express to release
        the seller payout to the Seller's verified bank account.
      </p>
      <p>
        For the avoidance of doubt: the funds-held mechanism is a{' '}
        <strong>buyer-protection mechanism</strong> and not a
        regulated banking, savings or investment product. GunGalore is
        not a bank and does not provide deposit-taking or fund-custody
        financial services. GunGalore does not pay interest on funds held, does not
        guarantee the availability of those funds against the
        insolvency of Stitch Express, and is not a registered financial
        services provider.
      </p>
      <p>
        Where a Buyer and Seller elect to use the{' '}
        <strong>"private arrangement"</strong> shipping option for a
        firearm transfer (where both parties travel to a SAPS-licensed
        dealer to complete the transfer themselves), the Buyer
        explicitly consents that payment is captured and released
        immediately to the Seller upon successful payment, and that the
        funds-held mechanism does not apply to that transaction.
      </p>

      <h2>8. Fees, commission and payouts</h2>
      <p>
        GunGalore charges Sellers a <strong>banded commission</strong>{' '}
        on the listing price of each completed sale, plus a{' '}
        <strong>processing fee</strong> charged by Stitch Express
        (passed through to the Seller in full). The exact commission
        bands and processing-fee structure are displayed to the Seller
        on the Sell form before publishing a listing and snapshotted
        onto each Transaction record at the point of sale. Sellers may
        review the current fee schedule at any time via the in-product
        fee explainer.
      </p>
      <p>
        Where the Platform offers paid placement features (for example,
        Featured Slot auctions), the cost of those features is
        non-refundable except as expressly set out in the relevant
        product T&amp;Cs.
      </p>
      <p>
        Payouts are made in South African Rand (ZAR) by electronic
        funds transfer to the Seller's bank account. Before the first
        payout we manually review the Seller's bank details against
        their verified identity to confirm the account belongs to the
        Seller. We do not pay out to third parties or to accounts not
        in the Seller's name.
      </p>

      <h2>9. Shipping and delivery</h2>
      <p>
        Shipping is the responsibility of the Seller, using the
        shipping method chosen by the Buyer at checkout from the
        options the Seller has enabled. Available methods include
        locker-to-locker (Pudo), door-to-door courier (The Courier
        Guy), licensed-dealer transfer (for firearms and barrels) and
        private arrangement (firearms only — see paragraph 7). Shipping
        costs are quoted live at checkout and paid by the Buyer.
      </p>
      <p>
        The Seller must dispatch within 48 hours of payment being
        confirmed. If dispatch is not confirmed within that window,
        GunGalore will send a reminder; if dispatch is still not
        confirmed within a further extended period, GunGalore reserves
        the right to cancel the transaction and refund the Buyer in
        full.
      </p>

      <h2>10. Auctions, Take-a-Shot offers and Buy Now</h2>
      <p>
        GunGalore supports three sale modes: <strong>Buy Now</strong>{' '}
        (fixed-price purchase), <strong>Auction</strong> (timed bidding
        with optional reserve and snipe-protection extension) and{' '}
        <strong>Take-a-Shot</strong> (buyer-initiated price offer with
        a 48-hour Seller response window and a one-counter limit). The
        operating rules of each mode are summarised on the Platform
        and described in detail in our help materials. Submitting a
        bid, offer or Buy Now purchase constitutes a binding offer to
        purchase the listed item at the stated price, subject only to
        the Seller's response window where applicable.
      </p>

      <h2>11. Competitions</h2>
      <p>
        From time to time GunGalore runs competitions (raffles).
        Specific rules for each competition, including how entries can
        be obtained (paid and free postal entry), the draw mechanism
        and the claim window, are governed by our{' '}
        <a href="/aml-policy" style={{ color: 'var(--red)' }}>AML &amp; Competitions Policy</a>{' '}
        and the per-competition rules displayed on the relevant
        competition page. Competitions comply with Section 36 of the
        Consumer Protection Act, including the requirement to offer a
        free postal-entry route.
      </p>

      <h2>12. Disputes and refunds</h2>
      <p>
        If you believe a Buyer or Seller has not met their obligations
        — for example, an item arrived damaged or never arrived — you
        may raise a dispute within the time limits set out in our{' '}
        <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>.
        Disputes are reviewed by the GunGalore admin team within{' '}
        <strong>48 hours of receipt</strong>, and outcomes may include
        full refund, partial refund, release to Seller or referral to
        the appropriate authorities. Nothing in these Terms limits the
        rights you have under the Consumer Protection Act, in
        particular Section 56 (which gives Buyers a 6-month right to
        return defective goods).
      </p>

      <h2>13. Suspension and termination</h2>
      <p>
        We may suspend or terminate your account immediately, with or
        without notice, where we reasonably believe that you have:
      </p>
      <ul>
        <li>breached these Terms or any of the policies they incorporate;</li>
        <li>provided false information or impersonated another person;</li>
        <li>engaged in fraud, money laundering, intimidation or any criminal activity;</li>
        <li>attempted to bypass our payment, moderation or contact-detail safeguards; or</li>
        <li>failed to complete KYC or other compliance obligations within a reasonable time.</li>
      </ul>
      <p>
        You may close your account at any time by emailing{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        . Account closure does not relieve you of any liability for
        transactions in progress, fees due or warranties given.
      </p>

      <h2>14. Intellectual property</h2>
      <p>
        The Platform (including its software, design, brand, written
        content and structure) is owned by GunGalore (or its licensors)
        and is protected by South African and international copyright,
        trade mark and other intellectual-property laws. Except as
        expressly permitted by these Terms, you may not copy, modify,
        reverse-engineer, sublicense or create derivative works from
        the Platform.
      </p>

      <h2>15. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by South African law, GunGalore
        will not be liable to you for any indirect, incidental,
        consequential, special or punitive damages (including but not
        limited to loss of profits, loss of goodwill or loss of data)
        arising out of or in connection with your use of the Platform.
      </p>
      <p>
        GunGalore's aggregate liability to you in respect of any
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

      <h2>16. Indemnity</h2>
      <p>
        You agree to indemnify, defend and hold harmless GunGalore,
        its directors, officers, employees and agents from and against
        any third-party claim, action, demand, loss, damage, fine,
        penalty or expense (including reasonable legal fees) arising
        out of or related to (a) your breach of these Terms, (b) your
        breach of any law, including the Firearms Control Act, the
        Consumer Protection Act or the Protection of Personal
        Information Act, (c) any goods you list or transact on the
        Platform, or (d) any content you submit to the Platform.
      </p>

      <h2>17. Force majeure</h2>
      <p>
        Neither party will be liable for any failure or delay in
        performance caused by events beyond its reasonable control,
        including natural disasters, war, civil unrest, government
        action, power or internet outages, or acts or omissions of
        third-party service providers (including Stitch Express,
        VerifyNow, Pudo, The Courier Guy, Cloudinary, Resend or
        Clerk).
      </p>

      <h2>18. Notices and communications</h2>
      <p>
        Notices to you will be sent to the email address registered on
        your account and, where appropriate, by SMS to your verified
        phone number. Notices to GunGalore must be sent to{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>{' '}
        or by post to the registered address set out in paragraph 1.
      </p>

      <h2>19. Severability</h2>
      <p>
        If any provision of these Terms is found by a competent court
        to be unenforceable, that provision will be severed and the
        remainder of these Terms will continue in full force and
        effect.
      </p>

      <h2>20. Governing law and jurisdiction</h2>
      <p>
        These Terms are governed by and construed in accordance with
        the laws of the Republic of South Africa. You and GunGalore
        irrevocably submit to the exclusive jurisdiction of the High
        Court of South Africa (Western Cape Division, Cape Town) over
        any dispute arising out of or in connection with these Terms.
      </p>

      <h2>21. Complaints and contact</h2>
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
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        <br />
        <strong>Postal:</strong> GunGalore (Pty) Ltd, 36 Sterappel Crescent, Langeberg Glen, Cape Town, 7570
      </p>

      <h2>22. ECT Act § 43 disclosures</h2>
      <p>
        In compliance with Section 43 of the Electronic Communications
        and Transactions Act 25 of 2002:
      </p>
      <ul>
        <li><strong>Full registered name:</strong> GunGalore (Pty) Ltd</li>
        <li><strong>Registration number:</strong> 2026/393321/07</li>
        <li><strong>Trading as:</strong> Gun Galore</li>
        <li><strong>Director:</strong> Gerhard Johan Petrus Fourie</li>
        <li><strong>Physical address:</strong> 36 Sterappel Crescent, Langeberg Glen, Cape Town, 7570, South Africa</li>
        <li><strong>Email:</strong> support@gungalore.co.za</li>
        <li><strong>VAT registration:</strong> Not yet registered for VAT</li>
        <li><strong>Membership of self-regulatory bodies:</strong> None at this time</li>
      </ul>
    </>
  );
}
