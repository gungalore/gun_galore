// AML & Competitions Policy — covers two related-but-distinct topics:
//
//   1. AML posture (voluntary FICA-aligned controls) — GunGalore is
//      not a designated accountable institution but voluntarily
//      applies KYC, contact-detail filtering and audit retention
//      consistent with FICA principles. Worth disclosing publicly so
//      sellers / partners / regulators can see the controls.
//
//   2. CPA § 36 (paid competitions / raffles) — South African law
//      requires every paid competition to offer a free postal-entry
//      route with equal weight in the draw, plus verifiable random
//      selection. Both are implemented in the codebase
//      (RafflesService.runDraw uses crypto.randomBytes + published
//      seed hash); this document explains it.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'AML & Competitions Policy — Gun Galore',
  description:
    'How GunGalore handles anti-money-laundering controls and complies with the Consumer Protection Act Section 36 for paid competitions.',
};

export default function AmlPolicyPage() {
  return (
    <>
      <LegalDocHeader
        title="AML & Competitions Policy"
        lastUpdated="pre-launch · v0.1 draft"
      />

      <h2>1. Why this policy exists</h2>
      <p>
        This document explains two things: (a) the anti-money-laundering
        ("<strong>AML</strong>") controls GunGalore (Pty) Ltd applies
        voluntarily across the marketplace, and (b) how the
        competitions we run comply with the Consumer Protection Act 68
        of 2008 ("<strong>CPA</strong>"), specifically the rules around
        promotional competitions in Section 36.
      </p>

      <h2>2. AML posture</h2>
      <p>
        GunGalore is <strong>not a designated accountable institution</strong>{' '}
        under the Financial Intelligence Centre Act 38 of 2001 ("FICA")
        and is not licensed as a financial services provider. We
        process payments through Stitch Express, which is licensed.
        Nevertheless, we voluntarily implement a number of controls
        that mirror accountable-institution practice, because doing so
        protects our buyers, sellers and the integrity of the
        marketplace.
      </p>

      <h3>2.1 Know-Your-Customer (KYC)</h3>
      <p>
        Every Seller must complete identity verification before their
        first payout can be released. The verification flow runs through
        VerifyNow (a South African KYC provider) and includes:
      </p>
      <ul>
        <li>South African ID number lookup against the Department of Home Affairs;</li>
        <li>Selfie face-match against the Home Affairs ID photo;</li>
        <li>A manual review of the Seller's bank details against their verified identity before the first payout, to confirm the payout account belongs to the verified person.</li>
      </ul>
      <p>
        If face-match fails three times, the account is flagged for
        manual admin review and the Seller is directed to contact
        support. KYC outcomes (pass, fail, attempts) are retained for
        audit; the selfie image itself is not retained.
      </p>

      <h3>2.2 Contact-detail filtering</h3>
      <p>
        All user-to-user freeform fields (offer notes, counter-offer
        notes, rating comments, listing descriptions, listing
        photographs and pre-purchase Q&amp;A) are screened by an
        automated filter that blocks phone numbers, email addresses,
        social-media handles, URLs and other indicators that a party
        is trying to take the deal off-platform. Repeated bypass
        attempts surface in our Trust &amp; Safety queue and may
        result in account suspension.
      </p>

      <h3>2.3 Audit trail</h3>
      <p>
        Every administrative action that affects a user, listing,
        transaction or competition (ban, refund, KYC override,
        moderation decision, etc.) is recorded in an immutable audit
        log together with the admin's identity, the reason given and
        before/after values. Audit records are retained for at least
        5 years.
      </p>

      <h3>2.4 Transaction monitoring</h3>
      <p>
        Transactions above an internal high-value threshold are routed
        to <strong>Pending Admin Verification</strong> before payout
        release. A funds-held mechanism applies to most transactions
        by default — the buyer's payment is captured at checkout but
        only released to the seller once delivery is confirmed (or the
        confirmation window elapses without dispute).
      </p>

      <h3>2.5 Reporting suspicious activity</h3>
      <p>
        While GunGalore is not obliged under FICA to file Suspicious
        Transaction Reports, we will cooperate fully with the Financial
        Intelligence Centre, the South African Police Service and any
        other competent authority where compelled by valid legal
        process. If you suspect money laundering, fraud or any other
        criminal activity on the Platform, please email{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        . We investigate every report.
      </p>

      <h2>3. Competitions — CPA Section 36</h2>
      <p>
        Where GunGalore runs a paid-entry competition (a "raffle"),
        Section 36 of the Consumer Protection Act and its accompanying
        regulations apply. Our competitions comply as follows.
      </p>

      <h3>3.1 Free postal-entry route</h3>
      <p>
        Every competition accepts <strong>free entries by post</strong>.
        The free-entry form is downloadable from each competition page
        as a PDF, and contains the postal address, the deadline (which
        is the same as the paid-entry deadline) and the unique
        reference code that admin uses to capture the entry into the
        same draw pool as paid entries. There is no limit on the
        number of free entries any one person may submit, and free
        entries carry equal weight to paid entries in the draw.
      </p>
      <p
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 6,
          padding: 12,
          fontFamily: 'monospace',
          fontSize: 13,
        }}
      >
        Postal entries to be sent to:
        <br />
        GunGalore Free Entry
        <br />
        [PO BOX TBC — to be confirmed before launch of paid competitions]
        <br />
        South Africa
      </p>

      <h3>3.2 Verifiable random draw</h3>
      <p>
        Each draw uses cryptographically secure random number
        generation, with both a pre-publication commitment and a
        post-draw seed disclosure so that any member of the public can
        independently verify the outcome:
      </p>
      <ol>
        <li>A 256-bit random <strong>seed</strong> is generated using <code>crypto.randomBytes(32)</code>.</li>
        <li>The SHA-256 <strong>hash of the seed</strong> is recorded against the competition <em>before</em> the draw runs and is visible on the competition's draw-proof page.</li>
        <li>Winner indices are derived from <code>SHA-256(seed || ':' || position)</code> with rejection sampling, against the eligible-ticket list sorted by ticket number.</li>
        <li>After the draw, the raw seed is published. Anyone can recompute the SHA-256 hash to verify it matches the pre-published commitment, and replay the index derivation to verify the winning ticket.</li>
      </ol>

      <h3>3.3 Cooling window</h3>
      <p>
        Draws do not run instantly when a competition sells out. A{' '}
        <strong>24-hour cooling window</strong> elapses between
        sell-out and the draw, during which postal entries that are in
        transit may still be entered, and any payment reversal can
        settle. The exact draw time is published on the competition
        page once cooling begins.
      </p>

      <h3>3.4 Backup winners</h3>
      <p>
        Each draw selects one winner and up to two backup winners,
        using the same verifiable algorithm. If the primary winner
        fails to claim within the claim window (see 3.5), the first
        backup is promoted; if they also fail, the second backup is
        promoted. After all three positions lapse, the competition
        moves to <strong>Expired Unclaimed</strong> status and the
        prize is retained pending a separate decision.
      </p>

      <h3>3.5 Claim window</h3>
      <p>
        Winners have <strong>7 days</strong> from notification to claim
        their prize. Notifications are sent immediately on draw by
        email and SMS to the contact details on the winner's account.
        Winners are responsible for keeping their contact details
        current.
      </p>

      <h3>3.6 Refunds and cancellation</h3>
      <p>
        Tickets are <strong>non-refundable</strong> once payment is
        confirmed, except where GunGalore cancels the competition. If
        the competition is cancelled before the draw runs, all paid
        ticket holders receive a full refund via the original payment
        method.
      </p>

      <h3>3.7 Eligibility for entry</h3>
      <p>
        To enter any GunGalore competition you must be at least 18
        years old and a permanent resident of, or lawfully present in,
        the Republic of South Africa. Where the prize is a firearm or
        any item subject to the Firearms Control Act, the winner must
        hold the relevant SAPS Competency Certificate and Possession
        Licence before the prize can be transferred. If the winner is
        not able to lawfully take possession, the prize will be
        redirected to the next backup winner.
      </p>

      <h3>3.8 Independent verification</h3>
      <p>
        The full audit trail for every competition — including the
        pre-published seed hash, the published seed after the draw,
        the eligible-ticket list and the winning ticket number — is
        retained for at least 5 years and is available on request to
        any participant.
      </p>

      <h2>4. Contact</h2>
      <p>
        For any AML- or competition-related enquiry, contact:{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        .
      </p>
    </>
  );
}
