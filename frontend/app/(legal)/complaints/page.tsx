// /complaints — the full complaints-handling procedure and the
// external escalation routes, broken down by subject matter. Split
// out from /legal so it has a canonical URL that the footer, /legal
// and /contact can all link to. Intake is email + phone; escalation
// points to the correct consumer, privacy, payment and firearms
// forums — never an industry association.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Complaints',
  description:
    'How to raise a complaint with GunGalore, our resolution timeframes, and where to escalate if we cannot resolve it.',
};

export default function ComplaintsPage() {
  return (
    <>
      <LegalDocHeader title="Complaints" lastUpdated="Effective 16 July 2026" />

      <p>
        We take every complaint seriously. This page explains how to
        raise a complaint with <strong>GunGalore (Pty) Ltd</strong>, how
        quickly we aim to respond, and — if we cannot resolve the matter
        to your satisfaction — which independent body you can escalate
        it to, depending on the subject.
      </p>

      <h2>1. How to raise a complaint</h2>
      <p>You can lodge a complaint through either of these channels:</p>
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
        <strong>Telephone:</strong>{' '}
        <a href="tel:+27743039999" style={{ color: 'var(--red)' }}>
          +27 74 303 9999
        </a>
      </p>
      <p>
        To help us resolve your complaint quickly, please include as much
        of the following as you can:
      </p>
      <ul>
        <li>Your account username or the email address on your account;</li>
        <li>The reference number of the listing, order or transaction involved (if any);</li>
        <li>A clear description of what went wrong and what outcome you are seeking;</li>
        <li>Any supporting screenshots, messages or documents.</li>
      </ul>

      <h2>2. How we handle your complaint</h2>
      <ul>
        <li>We aim to <strong>acknowledge</strong> your complaint within <strong>2 business days</strong> of receiving it.</li>
        <li>We aim to <strong>resolve</strong> it within <strong>14 business days</strong>. Where a matter is complex or depends on a third party — for example a courier, a SAPS-licensed dealer handling a firearm transfer, or a payment reconciliation — it may take longer; if so, we will tell you, explain why, and keep you updated on progress.</li>
        <li>Every complaint is logged, assigned an owner and recorded together with its outcome.</li>
      </ul>

      <h2>3. If you are not satisfied — external escalation</h2>
      <p>
        If we cannot resolve your complaint, or you are unhappy with the
        outcome, you may escalate it — free of charge — to the
        independent body responsible for the type of matter involved.
        Please give us the chance to resolve it first, but you are never
        obliged to do so before approaching one of the bodies below.
      </p>

      <h3>3.1 Privacy and personal information</h3>
      <p>
        For complaints about how we have handled your personal
        information under the Protection of Personal Information Act 4 of
        2013 (POPIA), you may lodge a complaint with the Information
        Regulator:
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
        <strong>Information Regulator (South Africa)</strong>
        <br />
        JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001
        <br />
        Email:{' '}
        <a href="mailto:enquiries@inforegulator.org.za" style={{ color: 'var(--red)' }}>
          enquiries@inforegulator.org.za
        </a>
        <br />
        Web:{' '}
        <a href="https://inforegulator.org.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>
          inforegulator.org.za
        </a>
      </p>

      <h3>3.2 Consumer disputes (Consumer Protection Act)</h3>
      <p>
        For a consumer dispute under the Consumer Protection Act 68 of
        2008 that we have not been able to resolve, you may approach:
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
        <strong>National Consumer Commission (NCC)</strong>
        <br />
        Web:{' '}
        <a href="https://www.thencc.gov.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>
          thencc.gov.za
        </a>
        <br />
        <br />
        <strong>Consumer Goods and Services Ombud (CGSO)</strong>
        <br />
        Web:{' '}
        <a href="https://www.cgso.org.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>
          cgso.org.za
        </a>
      </p>

      <h3>3.3 Payment disputes</h3>
      <p>
        For a dispute about a payment — for example money debited or held
        in connection with a purchase — you may escalate to:
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
        <strong>National Financial Ombud Scheme South Africa (NFO)</strong>
        <br />
        Web:{' '}
        <a href="https://www.nfosa.co.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>
          nfosa.co.za
        </a>
      </p>
      <p>
        You may also raise a payment dispute through your own bank or
        card issuer's dispute process.
      </p>

      <h3>3.4 Firearms-related matters</h3>
      <p>
        For matters involving the lawful handling, transfer or licensing
        of firearms under the Firearms Control Act 60 of 2000, contact
        the South African Police Service (SAPS) — through your nearest
        SAPS station or the SAPS Central Firearms Register.
      </p>

      <h2>4. Related documents</h2>
      <ul>
        <li>
          <a href="/refund-policy" style={{ color: 'var(--red)' }}>Refund &amp; Dispute Policy</a>{' '}
          — when refunds happen, how disputes are reviewed, and your rights under the CPA.
        </li>
        <li>
          <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>{' '}
          — how we handle your personal information under POPIA.
        </li>
        <li>
          <a href="/legal" style={{ color: 'var(--red)' }}>Legal &amp; compliance</a>{' '}
          — all our legal documents and statutory disclosures in one place.
        </li>
      </ul>
    </>
  );
}
