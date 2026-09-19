// Data deletion instructions — public. Meta (and POPIA) expect a clear,
// reachable page explaining how a user asks us to delete their data, what is
// deleted, and what we must keep by law. Linked from the Privacy Policy and
// usable without signing in.

import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Delete your data',
  description:
    'How to ask All Outdoor to delete your personal information, what is deleted, and what we are required to keep.',
};

export default function DataDeletionPage() {
  return (
    <>
      <LegalDocHeader
        title="Delete your data"
        lastUpdated="Effective 19 September 2026"
      />

      <h2>How to request deletion</h2>
      <p>
        You can ask us to delete the personal information we hold about you in
        either of these ways:
      </p>
      <ol>
        <li>
          <strong>In the app.</strong> Open <strong>Account</strong> and choose{' '}
          <strong>Close account</strong>. This starts the deletion process and
          is the fastest route.
        </li>
        <li>
          <strong>By email.</strong> Send an email from the address registered
          on your account to{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
            {SUPPORT_EMAIL}
          </a>{' '}
          with the subject <strong>&ldquo;Delete my data&rdquo;</strong>. Tell
          us your username so we can find the right account.
        </li>
      </ol>
      <p>
        We may ask for reasonable proof that you are the account holder before
        we act, so that nobody else can delete your data.
      </p>

      <h2>What happens next</h2>
      <ul>
        <li>
          We action a verified request within <strong>30 days</strong>.
        </li>
        <li>
          We <strong>delete or de-identify</strong> your account and the
          personal information attached to it, as set out in paragraph 9 of our{' '}
          <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>.
        </li>
        <li>
          Your public listings, ratings and Q&amp;A are removed or permanently
          de-identified within 90 days, so that the history of a sale does not
          identify you.
        </li>
      </ul>

      <h2>What we are required to keep</h2>
      <p>
        We cannot delete everything, because the law requires us to keep some
        records for a set period. These are kept securely and only for the
        purpose the law requires:
      </p>
      <ul>
        <li>
          <strong>Transaction, tax and anti-fraud records</strong> — kept for 5
          years, in line with South African record-keeping law.
        </li>
        <li>
          <strong>Identity-verification records for regulated categories</strong>{' '}
          — where the law requires a prescribed transfer or record-keeping
          document to be retained, we keep it for the period that law requires.
        </li>
        <li>
          <strong>Identity-verification hash</strong> — kept for up to 12
          months after deletion to prevent someone re-registering under an
          identity we have already verified.
        </li>
      </ul>
      <p>
        Our{' '}
        <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>{' '}
        sets out each category and its retention period in full (paragraph 9).
      </p>

      <h2>Communications</h2>
      <p>
        If you receive marketing or WhatsApp messages from us, you can opt out
        at any time without deleting your account — change your notification
        preferences in <strong>Account</strong>, reply <strong>STOP</strong> to
        a message, or use the unsubscribe link in any marketing email.
        Transactional messages needed to run an active order are sent while
        that order is in progress.
      </p>

      <h2>Contact</h2>
      <p>
        For any question about deleting your data, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>{' '}
        or call {SUPPORT_PHONE_DISPLAY}. Our Information Officer&apos;s details
        are in paragraph 2 of the{' '}
        <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>.
      </p>
    </>
  );
}
