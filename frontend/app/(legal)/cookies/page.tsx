// Cookie Policy — covers the actual cookies the platform uses today.
// Only essential + functional categories are in use; we list
// analytics + marketing categories as "currently none" so the
// document can stay current if we add them later.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Cookie Policy — Gun Galore',
  description:
    'What cookies GunGalore uses, why, and how to manage them.',
};

export default function CookiesPage() {
  return (
    <>
      <LegalDocHeader title="Cookie Policy" lastUpdated="pre-launch · v0.1 draft" />

      <h2>1. What cookies are</h2>
      <p>
        Cookies are small text files that a website asks your browser
        to store. They allow the site to remember things between page
        loads — like that you're signed in, what your theme
        preference is, or that you've already dismissed a notice. SA
        law treats certain cookies as personal information processing
        under POPIA, so we have to tell you what we set and give you
        a way to manage non-essential ones.
      </p>

      <h2>2. Categories of cookies we use</h2>

      <h3>2.1 Strictly necessary (always on)</h3>
      <p>
        These cookies are essential for the Platform to work. Without
        them you can't sign in, your basket can't survive a page
        navigation and your dispute submission can't be matched back
        to your account. You can't disable these and continue to use
        GunGalore.
      </p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Cookie</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Set by</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Purpose</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Retention</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['__session', 'Clerk', 'Your authenticated session — keeps you signed in across pages', 'Session (deleted when you sign out)'],
            ['__client_uat', 'Clerk', 'Helps Clerk detect when your session was last active', 'Up to 30 days'],
            ['gg_admin_sess', 'GunGalore', 'Admin-only — JWT for the admin panel session', 'Up to 8 hours'],
            ['theme', 'GunGalore', 'Remembers your light/dark theme preference', 'Up to 1 year'],
            ['NEXT_LOCALE', 'Next.js', 'Remembers the language variant you selected', 'Up to 1 year'],
          ].map(([cookie, by, purpose, retention], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0', fontFamily: 'monospace' }}>{cookie}</td>
              <td style={{ padding: '6px 8px' }}>{by}</td>
              <td style={{ padding: '6px 8px' }}>{purpose}</td>
              <td style={{ padding: '6px 0' }}>{retention}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>2.2 Functional</h3>
      <p>
        These cookies remember non-essential choices that improve your
        experience — for example, dismissing a one-time onboarding
        banner, or remembering that you closed the profile-completion
        prompt. They are not used for tracking or for any purpose
        other than honouring your earlier interaction.
      </p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Cookie</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Purpose</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Retention</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['gg-profile-completion-draft-*', 'Persists your in-progress profile completion form so refreshing the page or losing connection doesn\'t lose your typing', 'Until you submit or clear the draft'],
            ['gg-listing-new-draft', 'Persists your in-progress Sell form for the same reason', 'Until you publish or clear the draft'],
          ].map(([cookie, purpose, retention], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0', fontFamily: 'monospace' }}>{cookie}</td>
              <td style={{ padding: '6px 8px' }}>{purpose}</td>
              <td style={{ padding: '6px 0' }}>{retention}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
        }}
      >
        Technical note: the items in this table are stored in your
        browser's <code>localStorage</code> rather than as HTTP
        cookies, but POPIA treats both the same way for consent
        purposes, so we list them here for transparency.
      </p>

      <h3>2.3 Analytics</h3>
      <p>
        <strong>None at this time.</strong> When we add a privacy-respecting
        analytics provider (Plausible, PostHog or similar), we will
        update this policy and ask for your opt-in consent before
        setting any analytics cookie.
      </p>

      <h3>2.4 Marketing</h3>
      <p>
        <strong>None at this time.</strong> We do not run paid
        advertising on the Platform and do not embed third-party
        marketing pixels. If that ever changes, we will update this
        policy and require opt-in consent before any marketing cookie
        is set.
      </p>

      <h2>3. How to manage cookies</h2>
      <p>You can manage cookies in two ways:</p>
      <ul>
        <li><strong>Browser settings</strong> — every modern browser lets you block all cookies, block third-party cookies, or delete cookies on exit. Check your browser's "Privacy" or "Site Settings" page for details. Blocking strictly necessary cookies will prevent you from signing in.</li>
        <li><strong>Clear site data</strong> — to fully reset GunGalore in your browser, open DevTools → Application → Storage → Clear site data. You'll be signed out, your drafts will be lost and you'll have to opt back in to any preferences.</li>
      </ul>

      <h2>4. Third-party cookies</h2>
      <p>
        Some of the cookies above are set by trusted third-party
        operators (Clerk for authentication, Next.js for locale).
        Each of these operators has its own privacy and cookie
        policy:
      </p>
      <ul>
        <li>Clerk: <a href="https://clerk.com/legal/privacy" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>clerk.com/legal/privacy</a></li>
      </ul>

      <h2>5. Changes to this policy</h2>
      <p>
        If we add or remove cookies, we will update this page and the
        "last updated" date at the top. Material changes — for
        example, adding analytics or marketing cookies — will trigger
        an in-product banner asking for your renewed consent.
      </p>

      <h2>6. Contact</h2>
      <p>
        Cookie-related questions can be sent to{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        .
      </p>
    </>
  );
}
