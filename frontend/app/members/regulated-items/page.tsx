// Regulated Items Annex — the members-only half of the legal split.
//
// The public policies (/terms, /privacy, /paia, /aml-policy, /acceptable-use,
// /refund-policy, /fees, /how-payments-work, /about, /complaints,
// /how-selling-works, /condition-guide, /legal) keep every obligation that
// binds ALL users, worded generically. The category-specific statutory
// procedure lives HERE, and the public Terms incorporate this Annex by
// reference. A member is bound by the public documents PLUS this one; nothing
// may fall between the two.
//
// This route is sign-in gated in middleware (absent from isPublicRoute) and
// Disallow'd in robots.txt, and ../layout.tsx sets robots:{index:false}. It is
// therefore the document that CAN and SHOULD use the real words — firearm,
// licence, SAPS, dealer transfer, SAP 534. Softening language here defeats the
// point: this is the half that has to be legally precise.
//
// Key positions:
//   - All Outdoor is NOT a SAPS-licensed dealer and never takes custody.
//   - Every firearm transfer routes through a SAPS-licensed dealer.
//   - Live ammunition, primers and propellant powder are banned outright — no
//     dealer-storefront carve-out. Listable reloading components are limited to
//     projectiles/bullets and brass cases (the only seeded sub-categories).
//   - 18+, valid competency and licence required of BOTH parties, throughout.
//
// If you edit an obligation here, check whether its generalised twin on the
// public page still matches. Where the two differ, the stricter one governs.

// Shares the legal-document header with the public policies — this is the
// same class of document, it simply isn't public.
import { LegalDocHeader } from '../../(legal)/legal-frame';

export const metadata = {
  title: 'Regulated Items Annex',
  description:
    'Additional terms that apply to licence- and age-restricted categories on All Outdoor: our role, your obligations, and how those items are verified, transferred and paid for.',
};

const linkStyle = { color: 'var(--red)' };

export default function RegulatedItemsAnnexPage() {
  return (
    <>
      <LegalDocHeader
        title="Regulated Items Annex"
        lastUpdated="Effective 11 August 2026"
      />

      <h2>1. About this Annex</h2>
      <p>
        This Annex forms part of the{' '}
        <a href="/terms" style={linkStyle}>
          Terms of Service
        </a>{' '}
        and is incorporated into them by reference. It applies to every
        registered member who lists, bids on, offers for, buys, swops or
        otherwise deals in an item in a licence- or age-restricted
        category on All Outdoor. It adds to the public policies; it
        does not replace them. Where an obligation appears both here
        and, in generalised wording, on a public page, the two describe
        the same duty and the stricter statement governs.
      </p>
      <p>
        This Annex sets out our role and your obligations for licence-
        and age-restricted categories, including firearms under the
        Firearms Control Act 60 of 2000, and the specific procedure that
        applies to each restricted category on the Platform.
      </p>
      <p>
        It is drafted with reference to the Firearms Control Act 60 of
        2000 ("the <strong>FCA</strong>") and the regulations made under
        it, and is to be read together with the Terms of Service, which
        are drafted with reference to the Electronic Communications and
        Transactions Act 25 of 2002, the Consumer Protection Act 68 of
        2008 and the Protection of Personal Information Act 4 of 2013.
        Where this document and the FCA conflict, the FCA prevails.
      </p>

      <div
        style={{
          background: 'rgba(200,16,46,0.06)',
          border: '0.5px solid var(--red)',
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
          marginBottom: 24,
          fontSize: 14,
          color: 'var(--text-primary)',
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>All Outdoor is NOT a SAPS-licensed firearm dealer.</strong>{' '}
          We never take physical possession of firearms. Every firearm
          transfer on this Platform must complete through a
          SAPS-licensed dealer. Listing or attempting to transfer a
          firearm outside the dealer route breaches the FCA and will
          result in your account being permanently banned and reported
          to SAPS.
        </p>
      </div>

      <h2>2. Our role in a regulated transaction — we are not a licensed dealer</h2>
      <p>
        Where a transaction involves an item subject to the FCA,
        physical possession is transferred only through a SAPS-licensed
        dealer. All Outdoor is not a SAPS-licensed dealer and does not
        handle such items in any physical capacity. All Outdoor holds
        no dealer, manufacturer, gunsmith or import/export licence
        under the FCA, never takes custody of a firearm, and never
        receives, stores, transports or hands over a firearm. Our role
        in a firearm transaction is limited to hosting the listing,
        matching Buyer and Seller, and handling the money; the
        statutory transfer itself is performed by a SAPS-licensed
        dealer between the Seller and the Buyer.
      </p>
      <p>
        Concretely, in respect of firearm transfers our role is limited
        to:
      </p>
      <ul>
        <li>verifying the Seller&apos;s identity via Home Affairs lookup and selfie face-match before any payout is released;</li>
        <li>maintaining the directory of SAPS-licensed dealers members may choose from at checkout;</li>
        <li>holding the buyer&apos;s payment until the transfer is verified (other than on Private Arrangement — see paragraph 11);</li>
        <li>recording the transaction for audit and providing those records to SAPS or another competent authority where compelled by valid legal process.</li>
      </ul>
      <p>
        We are not the seller. We do not warrant the condition or
        provenance of any item listed by a third-party Seller, and we
        are not responsible for inspecting firearms, certifying them as
        safe, verifying serial numbers against SAPS records, or
        completing any part of the dealer-side transfer paperwork.
        Those are functions of the SAPS-licensed dealer, who is the
        responsible party for ensuring the buyer has the right to take
        possession.
      </p>

      <h2>3. Which categories this Annex covers</h2>
      <p>
        All Outdoor trades in firearms, gun parts, reloading components
        (projectiles/bullets and brass cases only), air rifles,
        self-defence items and shooting accessories. These categories
        are open to registered members only and are not browsable while
        signed out. Live ammunition, primers and propellant powder are
        excluded entirely — see paragraph 4.
      </p>
      <p>
        Items such as scopes, optics, slings, holsters, cleaning kits,
        magazines (within legal capacity), gun safes, range gear and
        cases are <strong>not</strong> firearms for the purposes of
        this Annex and may be shipped through ordinary courier channels
        (Pudo / The Courier Guy). The reloading components you may list
        are limited to <strong>projectiles/bullets and brass
        cases</strong>: those are lawful to list, are members-only, and
        remain subject to the law applicable to them; they are not
        ammunition and must not be conflated with it. Primers and
        propellant powder are <strong>not</strong> listable components —
        see paragraph 4.
      </p>

      <h2>
        4. Ammunition, primers and propellant powder — absolute
        prohibition
      </h2>
      <div
        style={{
          background: 'rgba(200,16,46,0.06)',
          border: '0.5px solid var(--red)',
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
          marginBottom: 16,
          fontSize: 14,
          color: 'var(--text-primary)',
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>
            All Outdoor does not sell ammunition. Live ammunition may
            not be listed, sold or traded on this platform under any
            circumstances. The same absolute prohibition applies to
            primers and propellant powder.
          </strong>
        </p>
      </div>
      <p>
        This prohibition is platform-wide and admits no exception: it
        binds private sellers and SAPS-licensed dealer sellers alike,
        applies to every category and every selling mode (including
        auctions, offers, swaps and dealer storefronts), and it
        supersedes and replaces any earlier provision of these terms
        permitting live ammunition to be sold by SAPS-licensed dealers
        through dealer storefronts where that capability is enabled. A
        listing that offers live ammunition, primers or propellant
        powder is removed on sight and the account that placed it is
        subject to the enforcement ladder in the{' '}
        <a href="/acceptable-use" style={linkStyle}>
          Acceptable Use Policy
        </a>
        .
      </p>
      <p>
        <strong>Primers and propellant powder</strong> fall squarely
        within this prohibition and may not be listed, sold or traded on
        the Platform under any circumstances. The Platform carries no
        category in which either can be listed, and no listing of either
        can be created.
      </p>
      <p>
        The reloading components that <em>may</em> be listed are limited
        to <strong>projectiles/bullets and brass cases</strong>. Those
        are not ammunition, are not covered by this prohibition, and
        remain listable in the appropriate category by registered
        members who comply with the law applicable to those components.
      </p>

      <h2>5. Items that may never be listed</h2>
      <p>
        The following are never permitted on the Platform, in addition
        to the prohibitions in the Acceptable Use Policy:
      </p>
      <ul>
        <li>
          <strong>Fully automatic firearms</strong>, and any firearm
          component prohibited under the FCA for civilian possession.
          Listing any of these will result in immediate removal and may
          result in account suspension or a permanent ban, and the
          matter may be referred to SAPS.
        </li>
        <li>
          <strong>Explosives, suppressors, silencers, prohibited
          large-capacity magazines</strong>, and any other item
          explicitly restricted under South African law. Listing any of
          these will result in immediate removal and may result in
          account suspension.
        </li>
        <li>
          <strong>Counterfeit or replica regulated items and
          accessories — including replica firearms —</strong> may never
          be listed or sold as genuine on the Platform. Listing any of
          these will result in immediate removal and may result in
          account suspension.
        </li>
        <li>
          <strong>Live ammunition, primers and propellant powder</strong>,
          without exception — see paragraph 4.
        </li>
      </ul>

      <h2>6. Eligibility — competency, licensing and age</h2>
      <p>
        Where you list, bid on or purchase any item subject to the FCA,
        you must hold (and continue to hold throughout the transaction)
        the relevant SAPS Competency Certificate and any required
        Possession Licence for that category of firearm. You must hold
        that competency and licence at the moment you list, at the
        moment you bid or make an offer, and at the moment the transfer
        is completed. If your competency or licence lapses, is
        suspended, is surrendered or is withdrawn at any point during a
        transaction, you must notify All Outdoor immediately and the
        transaction will be cancelled. Bidding on, offering for, or
        listing a firearm you are not lawfully entitled to possess is a
        breach of the Terms and may be reported to the South African
        Police Service.
      </p>
      <p>In full, to deal in an item subject to the FCA you must:</p>
      <ul>
        <li>be at least <strong>18 years old</strong>;</li>
        <li>be a permanent resident of, or lawfully present in, the Republic of South Africa;</li>
        <li>hold a valid <strong>Competency Certificate</strong> issued by SAPS for the relevant firearm category;</li>
        <li>where you are the buyer of a firearm requiring a Possession Licence, either already hold a Possession Licence in that category or have applied for one and have a pending application on file;</li>
        <li>not be subject to a court order, interdict or licence revocation prohibiting you from possessing firearms;</li>
        <li>complete All Outdoor KYC verification (Home Affairs ID lookup + selfie face-match) where you are a seller.</li>
      </ul>

      <h2>7. What counts as a "firearm" for this Annex</h2>
      <p>
        For the purposes of this Annex, the following are treated as
        firearms requiring dealer transfer:
      </p>
      <ul>
        <li>Any handgun, rifle or shotgun (whether self-loading, manually-operated or bolt-action) regulated under the FCA;</li>
        <li>Firearm <strong>barrels</strong>, regardless of whether the rest of the firearm changes hands separately;</li>
        <li>Receivers / frames bearing a serial number;</li>
        <li>Any other item the FCA classes as requiring a Possession Licence to acquire.</li>
      </ul>
      <p>
        Suppressors and sound moderators are dealt with in paragraph 5:
        they may not be listed on All Outdoor at all.
      </p>

      <h2>8. Listing a regulated item — conditions and disclosures</h2>
      <p>
        For licence- and age-restricted items subject to the FCA, you
        may only list the item where both you and the buyer hold the
        relevant SAPS Competency Certificate for the category
        concerned, and where the transfer is routed through a
        SAPS-licensed dealer. A listing that does not meet both of
        these conditions may not be published, and will be removed if
        it is.
      </p>
      <p>Before a listing in one of these categories goes live:</p>
      <ul>
        <li>
          A firearm may be listed as <strong>Marketplace (Buy Now)</strong>{' '}
          or <strong>Auction</strong> only. It cannot be couriered: it
          is transferred through a SAPS-licensed dealer and the buyer
          collects it there once the paperwork is done.
        </li>
        <li>
          You must capture the <strong>serial number and licence
          details</strong> at the point of listing. Serial numbers are
          partially masked in photographs (last 3 digits hidden).
        </li>
        <li>
          Sellers who list a firearm, a barrel or another item that may
          lawfully be held only under a licence or permit must, in
          addition to the standard identity verification required of
          every seller, supply the <strong>structured particulars of
          the licensed dealer</strong> at which the item is or will be
          held in stock, and may be required to{' '}
          <strong>demonstrate lawful possession</strong> of the item
          before the listing is published.
        </li>
        <li>
          Failure to supply or maintain these particulars is a ground
          for refusing to publish the listing, for withdrawing it, and
          for holding any payout.
        </li>
      </ul>
      <p>
        The encrypted South African identity number retained as part of
        standard seller verification is used to complete the SAP 534
        firearm-transfer form where such an item sells — see paragraph
        22.
      </p>

      <h2>9. Grading condition — firearms and firearm parts</h2>
      <p>
        The five condition grades (New, Like New, Good, Fair, Poor) in
        the public{' '}
        <a href="/condition-guide" style={linkStyle}>
          Condition Guide
        </a>{' '}
        apply to these listings exactly as they do to every other
        listing on the Platform, and payment is held until the buyer
        confirms the item arrived as described. Before you grade a
        firearm or firearm part, check:
      </p>
      <ol>
        <li>Bore and crown condition, plus an honest round count if you have any idea;</li>
        <li>Bluing or finish wear, safe rash, stock dings and any repairs;</li>
        <li>Function-check: action cycles, safety engages, trigger as it left the factory or modified;</li>
        <li>Every part included — magazines, mounts, tools, case and original paperwork.</li>
      </ol>
      <p>
        For a firearm or firearm part to be graded{' '}
        <strong>New</strong> it must be never used, never mounted and
        never fired, with no marks of any kind including mounting-ring
        marks or safe rash, and with its original box, tags, caps,
        tools and paperwork still with it. Sellers who consistently
        over-grade lose their standing on the Platform.
      </p>

      <h2>10. Transfer through a SAPS-licensed dealer</h2>
      <p>
        Every firearm sale on All Outdoor (other than the Private
        Arrangement option in paragraph 11) routes through a
        SAPS-licensed dealer. The flow is:
      </p>
      <ol>
        <li><strong>Buyer chooses a dealer</strong> at checkout, from the directory of dealers All Outdoor has vetted. The chosen dealer is recorded against the transaction.</li>
        <li><strong>Seller hands the firearm to a SAPS-licensed dealer</strong>, from where it moves between licensed dealers to the receiving dealer, fully insured and tracked. It is never couriered to the buyer.</li>
        <li><strong>Dealer receives, verifies and holds</strong> the item pending the buyer&apos;s appointment.</li>
        <li><strong>Buyer presents</strong> their Competency Certificate, Possession Licence (or proof of pending application, if the buyer is purchasing on the basis of an open application), and ID at the dealer&apos;s premises.</li>
        <li><strong>Dealer completes the SAPS transfer paperwork</strong> (SAP 534 / Section 17 forms as applicable) and hands the item to the buyer.</li>
        <li><strong>The completed transfer is verified</strong>, and only then is the seller&apos;s payout released — see paragraph 15.</li>
      </ol>
      <p>
        All Outdoor is not party to the dealer&apos;s process and does
        not intermediate between the buyer and the dealer for licence
        paperwork. Each hand-off must be accompanied by the documents
        SAPS requires for the transfer, including the parties&apos;
        Competency Certificates and Possession Licences and the
        completed SAP 534 firearm-transfer documentation where
        applicable.
      </p>

      <h2>11. Private Arrangement (alternative transfer route)</h2>
      <p>
        Buyer and Seller may, by mutual agreement, choose{' '}
        <strong>Private Arrangement</strong> at checkout. Under this
        option both parties travel to a SAPS-licensed dealer of their
        joint choice and complete the SAPS transfer paperwork in
        person. The option is offered only on categories subject to the
        FCA, and only where the <strong>Seller has consented in
        advance</strong> to that option being shown on the listing.
      </p>
      <ul>
        <li>Payment is captured and released immediately to the Seller upon successful payment. The funds-held mechanism does not apply to that transaction, and the Buyer explicitly consents to this at checkout via a two-checkbox and typed-confirmation gate.</li>
        <li>Because All Outdoor has no delivery event to verify in a private arrangement, <strong>no buyer-protection hold, delivery-confirmation window or dispute window is available</strong> on such a transaction. Buyers who want the funds-held protection must choose the licensed-dealer transfer option instead.</li>
        <li>The parties&apos; contact details are revealed to each other on payment so the meet can be coordinated. That sharing happens only with the Seller&apos;s recorded consent — see paragraph 22.</li>
      </ul>
      <p>
        Private Arrangement is intended for cases where both parties
        live in the same town and the dealer round-trip courier cost
        would be disproportionate to the sale value. It is{' '}
        <strong>not</strong> a route for off-platform deal-making — the
        transfer must still complete through a SAPS-licensed dealer.
      </p>

      <h2>12. Shipping and delivery restrictions</h2>
      <p>
        For firearms, barrels and other items subject to the FCA, the
        only permitted delivery methods are{' '}
        <strong>licensed-dealer transfer</strong> (the Seller hands the
        item to a SAPS-licensed dealer, who completes the SAPS transfer
        to the Buyer) and <strong>private arrangement</strong> (both
        parties attend a SAPS-licensed dealer together — see paragraph
        11). Such items:
      </p>
      <ul>
        <li>may not be sent by ordinary courier;</li>
        <li>may not be sent by locker-to-locker service;</li>
        <li>may not be delivered to a residential address.</li>
      </ul>
      <p>
        The Buyer may not select, and the Seller may not accept, any
        delivery method that bypasses the licensed-dealer channel. By
        law a firearm is transferred through a SAPS-licensed dealer and
        the buyer collects it there once the required paperwork is
        complete. Non-firearm gear ships via our courier partners, Pudo
        (locker-to-locker) and The Courier Guy (door-to-door).
      </p>

      <h2>13. Swop / Trade</h2>
      <p>
        Firearms may only change hands through a licensed dealer in
        terms of the FCA. A Swop / Trade in which one or both items is
        a firearm may not be completed by direct hand-over between the
        two members: each leg of the exchange must be routed through a
        SAPS-licensed dealer — exactly as on a normal firearm sale, in
        both directions — and each party must hold the competency and
        licence required for the item they are receiving before the
        exchange is funded.
      </p>
      <p>
        The proof-of-possession photograph required before funding does
        not replace, and is not evidence of, lawful possession — it
        establishes only that the item is in the declaring
        party&apos;s hands at the time of the photograph.
      </p>

      <h2>14. Daily Deals — All Outdoor as seller of record</h2>
      <p>
        Daily Deals never include items requiring a licence to possess.
        Where All Outdoor is itself the seller of record — that is, on
        Daily Deals — the goods offered are always unregulated outdoor
        goods. All Outdoor does not and will not sell any item subject
        to the FCA as principal, because it holds no dealer licence
        under that Act. Nothing in the Daily Deals programme may be
        read as All Outdoor dealing in firearms on its own account.
      </p>

      <h2>15. Payments, funds held and payouts</h2>
      <p>
        A firearm never ships between private individuals. It moves
        only between SAPS-licensed dealers, and both buyer and seller
        must hold the relevant SAPS competency for the category. The
        payment stays held until the SAP 534 dealer transfer is
        verified — not merely until the parcel is handed over. Only
        after that verification is the seller paid.
      </p>
      <p>
        For a firearm, therefore, confirmation of delivery is not the
        payout trigger; verification of the completed dealer transfer
        is. The only exception is Private Arrangement, where the Buyer
        has waived the hold and payment releases immediately on
        successful payment (paragraph 11).
      </p>

      <h2>16. Fees and charges on regulated transactions</h2>
      <ul>
        <li>
          <strong>No platform shipping fee.</strong> Firearm dealer
          transfers and in-person collection use no courier and
          therefore carry no All Outdoor shipping or handling fee.
        </li>
        <li>
          <strong>The dealer&apos;s own charges are yours.</strong> Any
          charge a SAPS-licensed dealer levies for receiving, storing,
          holding or processing a firearm pending the buyer&apos;s
          appointment is that dealer&apos;s own charge, is payable
          directly to that dealer by the party who agreed it, and is
          neither collected by nor refundable from All Outdoor.
        </li>
        <li>
          <strong>Swap service fee.</strong> On a Swap / Trade, each
          party pays a service fee for the leg they send: 1.5% of the
          item&apos;s declared value, with a minimum of R50 for a
          courier leg and a minimum of <strong>R100 for a firearm
          dealer-transfer leg</strong>, and a cap of R750 per leg. GG
          PRO members get 25% off the swap service fee.
        </li>
      </ul>
      <p>
        All other fees are as published on the public{' '}
        <a href="/fees" style={linkStyle}>
          Fees
        </a>{' '}
        page.
      </p>

      <h2>17. Refunds, disputes and cancellations</h2>
      <ul>
        <li>
          <strong>Private Arrangement — no funds-held protection.</strong>{' '}
          Where a transaction uses the Private Arrangement transfer
          option for a firearm, payment captures and releases
          immediately at the point of payment. The funds-held mechanism
          does not apply, because the buyer expressly waives it at
          checkout and physical possession happens face-to-face, and
          with it goes the practical ability to raise a held-payment
          dispute. See paragraph 11 above and paragraph 7 of the Terms
          of Service for the binding text.
        </li>
        <li>
          <strong>Dispatch-SLA auto-refund does not apply to
          dealer-transfer orders.</strong> The dispatch-SLA automatic
          refund applies to courier orders only. Collection orders and
          firearm dealer-transfer orders are not automatically refunded
          when the seller misses the 5-day dispatch window; the buyer
          must instead follow the dispute route set out in the{' '}
          <a href="/refund-policy" style={linkStyle}>
            Refund &amp; Dispute Policy
          </a>
          .
        </li>
        <li>
          <strong>CPA section 56 — dealer sellers.</strong> Where goods
          are sold by a SAPS-licensed dealer Seller, the Consumer
          Protection Act section 56 implied warranty of quality — six
          months from the date of delivery — applies directly to that
          dealer as supplier, and the buyer may require that dealer to
          repair, replace or refund. Where goods are sold by a
          private-individual Seller, All Outdoor acts only as
          facilitator.
        </li>
      </ul>

      <h2>18. Seller responsibilities</h2>
      <p>As a seller of a regulated item on All Outdoor, you must:</p>
      <ul>
        <li>only list items you lawfully own, with proof of ownership available on request;</li>
        <li>list the correct serial number (partially masked in photographs — last 3 digits hidden);</li>
        <li>retain a copy of the SAPS Disposal Notification (SAP 522) and the dealer&apos;s receipt of consignment for at least 5 years after the sale;</li>
        <li>cooperate fully with any SAPS investigation or audit relating to the transaction;</li>
        <li>not falsify any document, photograph or representation about the firearm or its history;</li>
        <li>furnish a valid South African identity number before a payout is released, so that the prescribed transfer form can be completed.</li>
      </ul>

      <h2>19. Buyer responsibilities</h2>
      <p>As a buyer of a regulated item on All Outdoor, you must:</p>
      <ul>
        <li>hold (or have a pending application for) the relevant Possession Licence and a current Competency Certificate;</li>
        <li>present those documents in person at the receiving dealer;</li>
        <li>not attempt to take possession of a firearm except through a SAPS-licensed dealer (or in person under the Private Arrangement option);</li>
        <li>retain a copy of the SAPS Possession Acquisition Notification (SAP 534) for at least 5 years.</li>
      </ul>

      <h2>20. False declarations</h2>
      <p>
        Falsifying a Competency Certificate, Possession Licence,
        identity document or any other compliance document is a
        criminal offence under the FCA and the Identification Act 68 of
        1997, and may constitute fraud at common law. Where we identify
        (or are informed of) any false declaration, your account will
        be permanently banned and the matter referred to SAPS.
      </p>

      <h2>21. Lost, stolen or recovered firearms</h2>
      <p>
        If a firearm transacted on All Outdoor is later reported lost or
        stolen, contact SAPS immediately (10111) and notify us at{' '}
        <a href="mailto:support@gungalore.co.za" style={linkStyle}>
          support@gungalore.co.za
        </a>{' '}
        with the order reference. We will provide the dealer-transfer
        record and any other information we hold to support a SAPS
        investigation.
      </p>

      <h2>22. Records, your personal information and PAIA</h2>

      <h3>22.1 Why we retain your encrypted identity number</h3>
      <p>
        Where a firearm is sold through All Outdoor, the FCA and its
        regulations require the transfer to be recorded on the
        prescribed SAP 534 firearm-transfer form, and the
        seller&apos;s South African identity number must be reproduced
        on that form. For that reason we retain your South African ID
        number, encrypted at rest with AES-GCM, for as long as your
        account is active. Where a SAP 534 transfer form or comparable
        statutory record has been completed, we keep the encrypted
        identity number for the period that the FCA and its regulations
        require that transfer record to be retained. Outside those
        obligations the encrypted identity number is deleted on account
        closure. The salted SHA-256 hash we separately derive from your
        identity number is used only for duplicate-registration checks
        and is retained while your account is active plus 12 months
        after deletion, as stated in the{' '}
        <a href="/privacy" style={linkStyle}>
          Privacy Policy
        </a>
        .
      </p>
      <p>
        Your data-subject rights of access, correction and objection
        under sections 23 to 25 of POPIA continue to apply to this
        record, and are exercised through the Information Officer named
        in the public Privacy Policy.
      </p>

      <h3>22.2 Legislation under which we process your personal information</h3>
      <p>
        For regulated categories, the law with which we comply when
        processing your personal information includes the FCA and the
        regulations made under it, in addition to the Consumer
        Protection Act 68 of 2008, the Financial Intelligence Centre
        Act 38 of 2001 and our tax obligations. Processing carried out
        to meet those obligations includes keeping the statutory
        records, registers and prescribed forms that those laws
        require, and recording the licence, permit and competency
        particulars of the parties to a transfer.
      </p>

      <h3>22.3 Consent to share contact details for a hand-over</h3>
      <p>
        Where a firearm, or another item that may lawfully be
        transferred only through a licensed dealer or between holders
        of the required competency or licence, is sold on the Platform,
        the hand-over takes place either by dealer transfer or by
        private arrangement between the parties. Where a private
        arrangement is used, we share the contact details necessary for
        that hand-over with the other party. That sharing is carried
        out on the ground of consent under section 11(1)(a) of POPIA.
        The seller&apos;s consent is required before any
        private-arrangement contact details are revealed, and consent
        may be withdrawn at any time before the details are released.
      </p>

      <h3>22.4 Records we hold under regulated-category legislation (PAIA)</h3>
      <p>
        In addition to the categories of records listed in the public{' '}
        <a href="/paia" style={linkStyle}>
          PAIA manual
        </a>
        , GunGalore (Pty) Ltd holds records in accordance with the FCA
        and the regulations made under it. These include
        dealer-transfer records; completed SAP 534 firearm-transfer
        forms; the particulars of the receiving licensed dealer; the
        licence, permit and competency particulars of the seller and
        the buyer captured for a transfer; and the registers and
        prescribed forms kept in connection with those transfers.
        Access to these records is subject to the request procedure,
        the prescribed request and access fees, the statutory 30-day
        decision period, and the grounds for refusal set out in the
        public PAIA manual, and to any restriction imposed by the FCA
        itself.
      </p>

      <h2>23. Complaints and escalation</h2>
      <p>
        Firearms-related complaints, and any complaint concerning the
        lawfulness of a firearm, its licensing, its storage or its
        transfer, may be escalated to the{' '}
        <strong>South African Police Service (SAPS)</strong>, and in
        particular to the Designated Firearms Officer at your nearest
        SAPS station or to the Central Firearms Registry. Nothing in
        our internal complaints process prevents you from reporting a
        matter directly to SAPS at any time, and we will cooperate with
        any lawful SAPS request for information.
      </p>
      <p>
        Where a complaint is complex or depends on a third party — for
        example a courier, a SAPS-licensed dealer handling a firearm
        transfer, or a payment reconciliation — resolution may take
        longer than 14 business days; if so, we will tell you, explain
        why, and keep you updated on progress. The internal complaints
        routes on the public{' '}
        <a href="/complaints" style={linkStyle}>
          Complaints
        </a>{' '}
        page (personal information, consumer-law and payment matters)
        are unaffected and remain available to you.
      </p>

      <h2>24. Cooperation with authorities</h2>
      <p>
        In addition to the Financial Intelligence Centre and any other
        competent authority, All Outdoor cooperates fully with the
        South African Police Service, including the Central Firearms
        Register, where compelled by valid legal process or where a
        report or notification is required in relation to a regulated
        item traded on the Platform. This does not limit the public
        commitment in our{' '}
        <a href="/aml-policy" style={linkStyle}>
          AML Policy
        </a>{' '}
        to cooperate with law enforcement generally, or the undertaking
        to investigate every report of suspected money laundering,
        fraud or other criminal activity sent to{' '}
        <a href="mailto:support@gungalore.co.za" style={linkStyle}>
          support@gungalore.co.za
        </a>
        .
      </p>

      <h2>25. Indemnity</h2>
      <p>
        You agree to indemnify, defend and hold harmless All Outdoor,
        its directors, officers, employees and agents from and against
        any third-party claim, action, demand, loss, damage, fine,
        penalty or expense (including reasonable legal fees) arising
        out of or related to your breach of the Firearms Control Act 60
        of 2000 or of any regulation, notice or condition made under
        it, including any breach relating to competency, licensing,
        possession, storage, transport or transfer of an item you list
        or transact on the Platform. This is the express application,
        to the FCA, of the indemnity in paragraph 18 of the Terms of
        Service; it adds to that indemnity and does not narrow it.
      </p>

      <h2>26. Contact</h2>
      <p>
        For any compliance enquiry, contact{' '}
        <a href="mailto:support@gungalore.co.za" style={linkStyle}>
          support@gungalore.co.za
        </a>
        . Urgent matters (suspected illegal firearm activity, stolen
        firearm) should be reported to SAPS first (10111) and then
        notified to us.
      </p>
    </>
  );
}
