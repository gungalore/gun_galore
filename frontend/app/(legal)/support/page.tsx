// /support — the public support landing page. Static, no auth and no
// form, so a signed-out visitor (or a reviewer) sees real contact
// channels instead of a "please sign in" wall. It signposts the FAQ
// and the complaints procedure, and offers a sign-in CTA for the
// authenticated support-ticket area. This replaces the previous
// /support link, which showed a sign-in prompt to logged-out users.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Support',
  description:
    'How to get help on Gun Galore — contact channels, FAQ, complaints and support tickets.',
};

export default function SupportPage() {
  return (
    <>
      <LegalDocHeader title="Support" lastUpdated="Effective 16 July 2026" />

      <p>
        Need a hand? Most questions are answered on our{' '}
        <a href="/faq" style={{ color: 'var(--red)' }}>
          Help &amp; FAQ
        </a>{' '}
        page — how payment is held until delivery, how firearm dealer
        transfers work, KYC, refunds and delivery. If you still need
        us, reach out using the channels below. We aim to respond
        within <strong>2 business days</strong>.
      </p>

      <h2>Contact channels</h2>
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
          <a href="tel:+27743039999" style={{ color: 'var(--red)' }}>
            +27 74 303 9999
          </a>
        </p>
      </div>

      <h2>Support tickets</h2>
      <p>
        Signed-in members can open a support ticket to track a
        conversation with our team from start to finish — useful for
        anything tied to a specific order, listing or payout.
      </p>
      <p>
        <a
          href="/sign-in"
          style={{
            display: 'inline-block',
            background: 'var(--red)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500,
            padding: '10px 16px',
            borderRadius: 8,
          }}
        >
          Sign in to open a support ticket
        </a>
      </p>

      <h2>Complaints</h2>
      <p>
        If something has gone wrong and you want to lodge a formal
        complaint, our{' '}
        <a href="/complaints" style={{ color: 'var(--red)' }}>
          complaints procedure
        </a>{' '}
        explains how to raise it, the timelines we work to, and the
        external bodies you can escalate to if we cannot resolve the
        matter to your satisfaction.
      </p>
    </>
  );
}
