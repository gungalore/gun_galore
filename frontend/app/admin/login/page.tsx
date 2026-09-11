'use client';

/**
 * Sign in to the Desk.
 *
 * ⚠️ IT WAS THE WRONG PRODUCT. See app/admin/login/layout.tsx for the full
 * account; in short, this page sat outside every Desk convention and rendered
 * a cream storefront card as the front door of a near-black control room — and
 * as the first screen of the installed PWA on every expired session.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '../../../components/desk';
import {
  DESK_API_URL,
  clearLingeringSession,
  setDeskToken,
} from '../../../lib/desk-auth';

/**
 * ⚠️ ONE SOURCE FOR THE API BASE, AND IT IS NOT DEFINED HERE.
 *
 * This file used to declare its own:
 *   `process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? …`
 * which is the exact duplicated-constant bug lib/desk-auth.ts documents as
 * fixed. It agreed with the real one only because INTERNAL_API_URL is unset —
 * the day it is set, the sign-in POST goes to one host and every subsequent
 * fetch to another, and the symptom reads as "login works, nothing loads".
 * (It was also dead in a client bundle: Next replaces a non-NEXT_PUBLIC_ var
 * with `undefined` there, so it could never have held a value anyway.)
 */
const LOGIN_PATH = '/admin/auth/login';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  /**
   * ⚠️ CLEAR ANY LINGERING SESSION ON MOUNT, which is what lib/desk-auth.ts's
   * header has always claimed this screen does. It did not: the function was
   * exported with zero callers, so an expired-but-present token survived a
   * visit to the sign-in page and the next deskFetch bounced straight back
   * here. Arriving at the front door means the previous session is over.
   */
  React.useEffect(() => {
    clearLingeringSession();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${DESK_API_URL}${LOGIN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The backend also sets an httpOnly gg_admin_sess cookie. The header
        // is the credential the guard actually reads; the cookie exists for
        // server components. Keep both in step — see signOutOfDesk().
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (res.status === 429) {
        setError('Too many attempts. Wait a minute and try again.');
        return;
      }
      if (!res.ok) {
        // Deliberately one message for a wrong password and an unknown
        // address. The admin roster is not a thing to let anyone enumerate.
        setError('That email and password do not match.');
        return;
      }

      const { token } = (await res.json()) as { token?: string };
      if (!token) {
        setError('Signed in, but no session came back. Try again.');
        return;
      }
      setDeskToken(token);

      // replace(), and straight to the board: push('/admin') left the closed
      // door in history and then bounced through a redirect to get here.
      router.replace('/admin/desk');
    } catch {
      setError('We could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'var(--dk-ground)',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--dk-surface)',
          border: '1px solid var(--dk-line)',
          borderRadius: 'var(--dk-radius-card)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--dk-ink-3)',
            }}
          >
            All Outdoor
          </p>
          <h1
            style={{
              margin: '4px 0 0',
              fontSize: 18,
              fontWeight: 500,
              color: 'var(--dk-ink)',
            }}
          >
            Desk
          </h1>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>Email</span>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>
            Password
          </span>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {/* One form-level message, and deliberately no per-field error state.
            Input prints its own copy beneath each box, so passing it to both
            would say the same thing three times — and a red border on BOTH
            fields claims we know which one is wrong, when refusing to say is
            the whole point of the single message.

            role="alert" so a screen reader announces the refusal; the old
            markup was a bare <p> that told a sighted user the form had failed
            and told everyone else nothing. */}
        {error ? (
          <p
            role="alert"
            style={{ margin: 0, fontSize: 12, color: 'var(--dk-bad)' }}
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" block loading={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
