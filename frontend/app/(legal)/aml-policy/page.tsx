// AML Policy — GunGalore's voluntary FICA-aligned controls.
//
//   GunGalore is not a designated accountable institution but
//   voluntarily applies KYC, contact-detail filtering and audit
//   retention consistent with FICA principles. Worth disclosing
//   publicly so sellers / partners / regulators can see the controls.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'AML Policy',
  description:
    'How GunGalore handles anti-money-laundering controls across the marketplace.',
};

export default function AmlPolicyPage() {
  return (
    <>
      <LegalDocHeader
        title="AML Policy"
        lastUpdated="Effective 24 June 2026"
      />

      <h2>1. Why this policy exists</h2>
      <p>
        This document explains the anti-money-laundering
        ("<strong>AML</strong>") controls GunGalore (Pty) Ltd applies
        voluntarily across the marketplace. GunGalore is not a
        designated accountable institution, but we choose to disclose
        these controls publicly so buyers, sellers, partners and
        regulators can see how we protect the integrity of the
        marketplace.
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
        Every administrative action that affects a user, listing or
        transaction (ban, refund, KYC override, moderation decision,
        etc.) is recorded in an immutable audit log together with the
        admin's identity, the reason given and before/after values.
        Audit records are retained for at least 5 years.
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

      <h2>3. Contact</h2>
      <p>
        For any AML-related enquiry, contact:{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        .
      </p>
    </>
  );
}
