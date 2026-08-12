// /contact — the single public "how to reach us" page. Static, no
// auth and deliberately no form: email and phone only, plus the
// registered company details a visitor (or a regulator) needs to
// know exactly who they are dealing with. Links onward to complaints
// handling and the full legal index.

import { SUPPORT_PHONE_TEL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Contact',
  description:
    'How to reach ALLOUTDOOR (PTY) LTD — email, phone and registered company details.',
};

export default function ContactPage() {
  return (
    <>
      <LegalDocHeader title="Contact us" lastUpdated="Effective 16 July 2026" />

      <p>
        All Outdoor is operated by ALLOUTDOOR (PTY) LTD. You can reach us
        by email or phone using the details below. We aim to respond
        within <strong>2 business days</strong>.
      </p>

      <h2>Get in touch</h2>
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>Email:</strong>{' '}
          <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
            support@gungalore.co.za
          </a>
          <br />
          <strong>Phone:</strong>{' '}
          <a href={`tel:${SUPPORT_PHONE_TEL}`} style={{ color: 'var(--red)' }}>
            {SUPPORT_PHONE_DISPLAY}
          </a>
        </p>
      </div>

      <h2>Company details</h2>
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>Full registered name:</strong> ALLOUTDOOR (PTY) LTD
          <br />
          <strong>Registration number:</strong> 2026/639713/07
          <br />
          <strong>Trading as:</strong> All Outdoor
          <br />
          <strong>Director:</strong> Gerhard Johan Petrus Fourie
          <br />
          <strong>Registered office:</strong> 36 Sterappel Crescent,
          Langeberg Glen, Cape Town, 7570, South Africa
          <br />
          <strong>VAT registration:</strong> Not yet registered for VAT
        </p>
      </div>

      <h2>Complaints</h2>
      <p>
        Have a complaint rather than a general query? Our{' '}
        <a href="/complaints" style={{ color: 'var(--red)' }}>
          complaints procedure
        </a>{' '}
        sets out how to raise it, how quickly we respond, and the
        external bodies you can escalate to if we cannot resolve things
        to your satisfaction.
      </p>

      <h2>Legal &amp; compliance</h2>
      <p>
        Our full set of legal documents and statutory disclosures —
        including the Electronic Communications and Transactions Act
        § 43 details for ALLOUTDOOR (PTY) LTD — is collected on the{' '}
        <a href="/legal" style={{ color: 'var(--red)' }}>
          Legal &amp; compliance
        </a>{' '}
        page.
      </p>
    </>
  );
}
