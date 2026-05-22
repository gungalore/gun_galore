// Firearms Compliance Policy — explains GunGalore's role and the
// legal obligations of buyers and sellers under the Firearms Control
// Act 60 of 2000 (FCA).
//
// Key positions:
//   - GunGalore is NOT a SAPS-licensed dealer and does NOT handle
//     firearms in any physical capacity.
//   - Every firearm transfer routes through a SAPS-licensed dealer.
//   - Live ammo is never sold P2P between private individuals.
//   - 18+ and valid competency cert required for both parties.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Firearms Compliance Policy — Gun Galore',
  description:
    'Our role, your responsibilities, and the legal framework for firearm sales on GunGalore under the Firearms Control Act 60 of 2000.',
};

export default function FirearmsCompliancePage() {
  return (
    <>
      <LegalDocHeader
        title="Firearms Compliance Policy"
        lastUpdated="pre-launch · v0.1 draft"
      />

      <h2>1. About this policy</h2>
      <p>
        This document explains the legal framework that governs the
        sale of firearms, ammunition and related items on GunGalore,
        and the responsibilities of every party involved. It is
        drafted with reference to the Firearms Control Act 60 of 2000
        ("the <strong>FCA</strong>") and its associated regulations.
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
          <strong>GunGalore is NOT a SAPS-licensed firearm dealer.</strong>{' '}
          We never take physical possession of firearms. Every firearm
          transfer on this Platform must complete through a
          SAPS-licensed dealer of the buyer's choice. Listing or
          attempting to transfer a firearm outside the dealer route
          breaches the FCA and will result in your account being
          permanently banned and reported to SAPS.
        </p>
      </div>

      <h2>2. Eligibility — buyer and seller</h2>
      <p>
        To list, bid on, offer for or purchase a firearm or any item
        subject to the FCA on GunGalore, you must:
      </p>
      <ul>
        <li>be at least <strong>18 years old</strong>;</li>
        <li>be a permanent resident of, or lawfully present in, the Republic of South Africa;</li>
        <li>hold a valid <strong>Competency Certificate</strong> issued by SAPS for the relevant firearm category;</li>
        <li>where you are the buyer of a firearm requiring a Possession Licence, either already hold a Possession Licence in that category or have applied for one and have a pending application on file;</li>
        <li>not be subject to a court order, interdict or licence revocation prohibiting you from possessing firearms;</li>
        <li>complete GunGalore KYC verification (Home Affairs ID lookup + selfie face-match) where you are a seller.</li>
      </ul>

      <h2>3. What counts as a "firearm" for this policy</h2>
      <p>
        For the purposes of GunGalore's firearm-compliance rules, the
        following are treated as firearms requiring dealer transfer:
      </p>
      <ul>
        <li>Any handgun, rifle or shotgun (whether self-loading, manually-operated or bolt-action) regulated under the FCA;</li>
        <li>Firearm <strong>barrels</strong>, regardless of whether the rest of the firearm changes hands separately;</li>
        <li>Receivers / frames bearing a serial number;</li>
        <li>Suppressors / sound moderators where their possession is restricted (refer to the FCA — note these are not normally listable on GunGalore — see our{' '}
          <a href="/acceptable-use" style={{ color: 'var(--red)' }}>Acceptable Use Policy</a>);
        </li>
        <li>Any other item the FCA classes as requiring a Possession Licence to acquire.</li>
      </ul>
      <p>
        Items such as scopes, optics, slings, holsters, cleaning kits,
        magazines (within legal capacity), gun safes, range gear and
        cases are <strong>not</strong> firearms for this policy and may
        be shipped through ordinary courier channels (Pudo / TCG).
      </p>

      <h2>4. Live ammunition</h2>
      <p>
        Loose live ammunition may <strong>not</strong> be sold
        peer-to-peer between private individuals on GunGalore. This
        category is restricted to SAPS-licensed dealer Sellers
        operating on the GunGalore New Store surface where supported.
        Listings of live ammunition by private Sellers will be
        removed.
      </p>

      <h2>5. The dealer-transfer process</h2>
      <p>
        Every firearm sale on GunGalore (other than the Private
        Arrangement option in paragraph 6) routes through a
        SAPS-licensed dealer. The flow is:
      </p>
      <ol>
        <li><strong>Buyer chooses a dealer</strong> at checkout, from the directory of dealers GunGalore has vetted. The chosen dealer is recorded against the transaction.</li>
        <li><strong>Seller dispatches</strong> the firearm to the chosen dealer using a courier service approved for firearm consignment, with full insurance and tracking.</li>
        <li><strong>Dealer receives, verifies and holds</strong> the firearm pending the buyer's appointment.</li>
        <li><strong>Buyer presents</strong> their Competency Certificate, Possession Licence (or proof of pending application, if the buyer is purchasing on the basis of an open application), and ID at the dealer's premises.</li>
        <li><strong>Dealer completes the SAPS transfer paperwork</strong> (SAPS 271 / Section 17 forms as applicable) and hands the firearm to the buyer.</li>
        <li><strong>Buyer confirms delivery</strong> on the GunGalore transaction page, which releases the seller payout.</li>
      </ol>
      <p>
        GunGalore is not party to the dealer's process and does not
        intermediate between the buyer and the dealer for licence
        paperwork. The dealer is the responsible party for ensuring
        the buyer has the right to take possession.
      </p>

      <h2>6. Private Arrangement (alternative for firearm transfers)</h2>
      <p>
        Buyer and Seller may, by mutual agreement, choose{' '}
        <strong>Private Arrangement</strong> at checkout. Under this
        option:
      </p>
      <ul>
        <li>Both parties travel to a SAPS-licensed dealer of their joint choice and complete the transfer in person.</li>
        <li>Payment captures and releases immediately at the point of payment — there is no funds-held mechanism for this transaction.</li>
        <li>The buyer's contact details are revealed to the seller (and vice versa) on payment, so the meet can be coordinated.</li>
        <li>The buyer expressly waives GunGalore's payment-held protection at checkout, via a two-checkbox + typed-confirmation gate.</li>
      </ul>
      <p>
        Private Arrangement is intended for cases where both parties
        live in the same town and the dealer round-trip courier cost
        would be disproportionate to the sale value. It is{' '}
        <strong>not</strong> a route for off-platform deal-making —
        the transfer must still complete through a SAPS-licensed
        dealer.
      </p>

      <h2>7. Seller responsibilities</h2>
      <p>As a seller of a firearm on GunGalore, you must:</p>
      <ul>
        <li>only list firearms you lawfully own, with proof of ownership available on request;</li>
        <li>list the correct serial number (partially masked in photographs — last 3 digits hidden);</li>
        <li>retain a copy of the SAPS Disposal Notification (SAPS 522) and the dealer's receipt of consignment for at least 5 years after the sale;</li>
        <li>cooperate fully with any SAPS investigation or audit relating to the transaction;</li>
        <li>not falsify any document, photograph or representation about the firearm or its history.</li>
      </ul>

      <h2>8. Buyer responsibilities</h2>
      <p>As a buyer of a firearm on GunGalore, you must:</p>
      <ul>
        <li>hold (or have a pending application for) the relevant Possession Licence and a current Competency Certificate;</li>
        <li>present those documents in person at the receiving dealer;</li>
        <li>not attempt to take possession of a firearm except through a SAPS-licensed dealer (or in person under the Private Arrangement option);</li>
        <li>retain a copy of the SAPS Possession Acquisition Notification (SAPS 271) for at least 5 years.</li>
      </ul>

      <h2>9. False declarations</h2>
      <p>
        Falsifying a Competency Certificate, Possession Licence,
        identity document or any other compliance document is a
        criminal offence under the FCA, the Identification Act 68 of
        1997 and section 99 of the Common Law of South Africa. Where
        we identify (or are informed of) any false declaration, your
        account will be permanently banned and the matter referred to
        SAPS.
      </p>

      <h2>10. Lost, stolen or recovered firearms</h2>
      <p>
        If a firearm transacted on GunGalore is later reported lost or
        stolen, contact SAPS immediately (10111) and notify us at{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>{' '}
        with the order reference. We will provide the dealer-transfer
        record and any other information we hold to support a SAPS
        investigation.
      </p>

      <h2>11. GunGalore's role and limitation</h2>
      <p>
        GunGalore facilitates the discovery, negotiation and payment
        of firearm sales. We are not the seller and we do not warrant
        the condition or provenance of any firearm listed by a
        third-party Seller. Our role in respect of firearm transfers
        is limited to:
      </p>
      <ul>
        <li>Verifying the Seller's identity via Home Affairs lookup and selfie face-match before payouts are released;</li>
        <li>Maintaining the directory of SAPS-licensed dealers users may choose from at checkout;</li>
        <li>Holding the buyer's payment until delivery is confirmed (other than for Private Arrangement);</li>
        <li>Recording the transaction for audit and providing the records to SAPS where compelled by valid legal process.</li>
      </ul>
      <p>
        We are not responsible for inspecting firearms, certifying
        them as safe, verifying serial numbers against SAPS records,
        or completing any part of the dealer-side transfer paperwork.
        Those are functions of the SAPS-licensed dealer.
      </p>

      <h2>12. Contact</h2>
      <p>
        For any firearms-compliance enquiry, contact{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        . Urgent matters (suspected illegal firearm activity, stolen
        firearm) should be reported to SAPS first (10111) and then
        notified to us.
      </p>
    </>
  );
}
