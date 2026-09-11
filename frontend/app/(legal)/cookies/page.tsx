// Cookie Policy — covers the actual cookies the platform uses today.
// Essential, functional and a FIRST-PARTY analytics item (`gg_did`) are in
// use; marketing is the only category that is genuinely "none at this time".
// That category is still written out in full, rather than dropped, so adding
// one later is an edit to a section that already exists instead of a section
// somebody has to remember to write.
//
// ⚠️ THIS TABLE IS A POPIA DISCLOSURE, NOT DOCUMENTATION, so a cookie that is
// set and not listed — or listed with a retention the code does not honour —
// is a false statement to users rather than a stale comment. A cookie LISTED
// AND SET BY NOTHING is the same false statement pointing the other way, and
// it is the drift this file keeps producing. Three times over by 2026-09-11,
// and no drift left a trace anywhere:
//   * `__session` / `__client_uat` were Clerk's, and Clerk was removed on
//     2026-09-10. The platform stopped setting them and kept disclosing them.
//   * `gg_admin_sess` was listed as "up to 8 hours" from the era when the
//     admin JWT WAS the session. The admin auth hardening cut it to the
//     access token's fifteen minutes and added a second, thirty-day
//     `gg_admin_rt` that nothing here mentioned.
//   * `theme` and `NEXT_LOCALE` were listed and are set by NOTHING — not by
//     us, not by Next. Removed 2026-09-11. There is no light/dark preference
//     to remember (the dark theme is retired, and `viewport.themeColor` in
//     app/layout.tsx is #FFFFFF under BOTH `prefers-color-scheme` arms), and
//     there is no i18n at all: no `i18n` block in next.config.mjs, no
//     next-intl, no language picker, and App Router Next sets NEXT_LOCALE on
//     its own for nobody. `NEXT_LOCALE` was additionally attributed to
//     "Next.js" in the Set-by column while section 4 flatly said there are no
//     third-party cookies — a reader could not tell which half to believe,
//     and the answer was neither: the row should not have existed.
//
// The values are not guesses and must not become guesses. Every item named in
// 2.1, 2.2 and 2.3 is anchored to the code that writes it, and so is every
// retention in them BAR ONE — see the second warning below. Read them out of
// the code:
//   ao_at / ao_rt             backend/src/auth/auth.controller.ts (res.cookie),
//                             names in backend/src/auth/extract-token.ts,
//                             ACCESS_TTL_SECONDS (15m) + REFRESH_TTL_MS (30d)
//                             in backend/src/auth/session.service.ts
//   gg_admin_sess/gg_admin_rt backend/src/admin/admin.controller.ts (res.cookie
//                             and both names), ADMIN_ACCESS_TTL_SECONDS (15m) +
//                             ADMIN_REFRESH_TTL_MS (30d) in
//                             backend/src/admin/admin-session.service.ts
//   gg_did                    DEVICE_KEY in frontend/lib/activity-beacon.ts
//   gg-*-draft                draftKey in frontend/app/listings/new/page.tsx and
//                             components/profile-completion-modal.tsx
//   gg-preview                frontend/app/preview/route.ts (NextResponse
//                             .cookies.set), read at frontend/middleware.ts
//                             as COMING_SOON_COOKIE
//
// ⚠️ FIVE PLACES SET A COOKIE, NOT FOUR, AND THE FIFTH IS NOT A res.cookie()
// CALL. This header said "those four res.cookie() calls are the only places
// anything in this repo sets a cookie" — which is what you get by grepping for
// `res.cookie(` and stopping. app/preview/route.ts sets `gg-preview` through
// NextResponse.cookies.set: first-party, httpOnly, thirty days, in a real
// visitor's browser. It is the coming-soon bypass, and the route gates on the
// SECRET rather than on COMING_SOON_GATE, so it still sets the cookie when the
// gate is off. A disclosure that omits a cookie we set is the same false
// statement to users as one that lists a cookie we do not.
//
// Sweep with all five spellings, not one: res.cookie(, cookies.set(,
// Set-Cookie, setHeader('Set-, document.cookie =.
//
// (frontend/lib/desk-auth.ts also writes document.cookie, but only to expire
// `gg_admin_sess` at max-age=0 — a clear, never a set.) Change a TTL in any of
// them and this table is part of the same change.
//
// ⚠️ TWO CLAIMS ON THIS PAGE THE REPO CANNOT SETTLE. The anchors above do not
// cover them, and nothing here has verified them:
//   * 2.3's "the activity events themselves are deleted after 12 months".
//     Nothing deletes them. `UserEvent` has no purge cron and there is no
//     deleteMany anywhere under backend/src/activity. Either write the purge
//     or take the sentence back to the operator — do not quietly soften it,
//     because a stated retention period is the thing a data subject relies on.
//   * Section 4's "no third-party service embedded in this Platform sets a
//     cookie in your browser". True of everything in this repo. Cloudflare
//     sits in front of the origin and its bot management sets `__cf_bm` when
//     it is switched on, which is a dashboard setting no file here can read.
//     Check the zone before re-asserting it.

import { SUPPORT_EMAIL } from '@/lib/brand';
import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Cookie Policy',
  description:
    'What cookies All Outdoor uses, why, and how to manage them.',
};

export default function CookiesPage() {
  return (
    <>
      {/*
        ⚠️ BUMP THIS WHENEVER THE TABLES BELOW CHANGE. Section 5 promises the
        reader that "we will update this page and the last updated date at the
        top" — a corrected disclosure carrying its old date says the old
        wording was accurate on this date, which is the opposite of what
        happened.
      */}
      <LegalDocHeader title="Cookie Policy" lastUpdated="Effective 11 September 2026" />

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
        All Outdoor.
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
            ['ao_at', 'All Outdoor', 'Your signed-in session — keeps you signed in across pages', 'Up to 15 minutes (renewed while you browse)'],
            ['ao_rt', 'All Outdoor', 'Renews the session above so you are not signed out every 15 minutes', 'Up to 30 days'],
            ['gg_admin_sess', 'All Outdoor', 'Admin-only — the signed-in token for the admin panel', 'Up to 15 minutes'],
            ['gg_admin_rt', 'All Outdoor', 'Admin-only — renews the admin panel session', 'Up to 30 days'],
            ['gg-preview', 'All Outdoor', 'Set only if you opened the site through a preview link we sent you — lets you past the coming-soon screen', 'Up to 30 days'],
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
        <strong>First-party only — no third-party analytics.</strong> We
        do not use Google Analytics or any comparable third-party
        analytics service, and no third-party analytics cookie is set on
        this Platform. We do keep our own first-party record of how the
        Platform is used, and to recognise a returning browser without
        double-counting it we store a randomly generated device
        identifier in your browser. It contains no name, email or other
        personal detail, it is never shared with an ad network, and
        where you are signed out it is the only thing the activity is
        linked to. What we do with that activity, how long we keep it
        and how to object to it are set out in sections 3.7, 9 and 10 of
        our{' '}
        <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>.
      </p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Item</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Set by</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Purpose</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Retention</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
            <td style={{ padding: '6px 8px 6px 0', fontFamily: 'monospace' }}>gg_did</td>
            <td style={{ padding: '6px 8px' }}>All Outdoor</td>
            <td style={{ padding: '6px 8px' }}>
              Random first-party device identifier used to group activity
              from the same browser
            </td>
            <td style={{ padding: '6px 0' }}>
              Stored in <code>localStorage</code> until you clear site
              data; the activity events themselves are deleted after 12
              months
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        If we ever add a third-party analytics provider, we will update
        this policy and ask for your opt-in consent before setting any
        analytics cookie.
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
        <li><strong>Clear site data</strong> — to fully reset All Outdoor in your browser, open DevTools → Application → Storage → Clear site data. You'll be signed out, your drafts will be lost and you'll have to opt back in to any preferences.</li>
      </ul>

      <h2>4. Third-party cookies</h2>
      <p>
        <strong>There are none.</strong> Every cookie listed above is
        first-party — set by All Outdoor on alloutdoor.co.za — and no
        third-party service embedded in this Platform sets a cookie in
        your browser. Sign-in is handled by our own servers; we do not
        use a hosted identity provider, an analytics tag or an
        advertising pixel. If that ever changes we will name the
        operator here, link its policy, and ask for your renewed
        consent first.
      </p>

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
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </>
  );
}
