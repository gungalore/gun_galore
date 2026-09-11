'use client';

/**
 * Sign in to the Desk.
 *
 * ⚠️ IT WAS THE WRONG PRODUCT. See app/admin/login/layout.tsx for the full
 * account; in short, this page sat outside every Desk convention and rendered
 * a cream storefront card as the front door of a near-black control room — and
 * as the first screen of the installed PWA on every expired session.
 *
 * 🚨 AND IT COULD NOT SIGN IN AN ADMIN WITH AN AUTHENTICATOR. The form was one
 * step and never read a refusal body, so the 401 carrying
 * `code: 'TOTP_REQUIRED'` — which means the password was CORRECT — rendered as
 * "That email and password do not match." with no code box anywhere. The step
 * machine lives in lib/desk-admin-login.ts; this page owns only what is on
 * screen.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '../../../components/desk';
import { clearLingeringSession } from '../../../lib/desk-auth';
import { signInToDesk } from '../../../lib/desk-admin-login';

/**
 * ⚠️ THE API BASE IS NOT DEFINED HERE, AND NEITHER IS THE LOGIN PATH.
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

/** Which half of the second factor the operator is typing. */
type SecondFactor = 'app' | 'recovery';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [step, setStep] = React.useState<'credentials' | 'code'>('credentials');
  const [factor, setFactor] = React.useState<SecondFactor>('app');
  const [code, setCode] = React.useState('');
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
      const outcome = await signInToDesk({
        email,
        password,
        // ⚠️ THE PASSWORD IS RESENT ON THE SECOND STEP, because this backend
        // has no intermediate "half-signed-in" ticket — /admin/auth/login is
        // one call that takes all three. That is why the password stays in
        // state rather than being cleared once the first step succeeds.
        ...(step === 'code'
          ? factor === 'app'
            ? { totpCode: code }
            : { recoveryCode: code }
          : {}),
      });

      switch (outcome.kind) {
        case 'need-code':
          setStep('code');
          setCode('');
          return;
        case 'in':
          // replace(), and straight to the board: push('/admin') left the
          // closed door in history and then bounced through a redirect.
          router.replace('/admin/desk');
          return;
        default:
          setError(outcome.message);
          return;
      }
    } finally {
      setBusy(false);
    }
  }

  const onCodeStep = step === 'code';

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

        {/* ⚠️ THE EMAIL AND PASSWORD STAY MOUNTED AND GO READ-ONLY on the
            second step rather than unmounting. Unmounting them empties the
            browser's own record of the form, and a password manager that has
            already filled a field it can no longer see does not re-fill it on
            the retry — so a mistyped code turned into a re-typed password.
            Disabled, not hidden: the operator can see which account they are
            signing into while they read the code off the phone. */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>Email</span>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus={!onCodeStep}
            disabled={onCodeStep}
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
            disabled={onCodeStep}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {onCodeStep ? (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>
                {factor === 'app' ? 'Code from your authenticator app' : 'Recovery code'}
              </span>
              <Input
                // The box the operator is about to type into, focused the
                // moment it mounts — they are already holding the phone.
                // autoFocus rather than a ref effect: the field is mounted by
                // the step change, so there is nothing to re-focus later, and
                // Input is a plain function component with no forwarded ref.
                autoFocus
                key={factor}
                name={factor === 'app' ? 'totpCode' : 'recoveryCode'}
                // one-time-code lets iOS and Android offer the code from the
                // notification; it is wrong for a written-down recovery code,
                // which no keyboard can suggest.
                autoComplete={factor === 'app' ? 'one-time-code' : 'off'}
                inputMode={factor === 'app' ? 'numeric' : 'text'}
                placeholder={factor === 'app' ? '123456' : 'XXXXX-XXXXX'}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>

            {/* ⚠️ A RECOVERY CODE OPENS A READ-ONLY SESSION, and saying so
                HERE is the difference between an operator choosing it and an
                operator discovering it when their first decision is refused.
                See AdminJwtGuard: recoveryOnly is checked before the role, so
                even a Full admin can only read. */}
            <button
              type="button"
              onClick={() => {
                setFactor((f) => (f === 'app' ? 'recovery' : 'app'));
                setCode('');
                setError(null);
              }}
              style={{
                alignSelf: 'stretch',
                // ⚠️ IT HAS TO BE TAPPABLE, AND IT WAS 17px TALL. This is the
                // ONE control on the locked-out path — the operator reaching
                // it has lost their phone — and it was a bare underlined
                // sentence with padding: 0. --dk-h-control is 34px at the desk
                // and 44px under 1024px, which is the platform minimum tap
                // target shell.tsx names for exactly this reason. Stretching
                // rather than hugging the text also stops the target being a
                // mid-paragraph word run.
                minHeight: 'var(--dk-h-control)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 2px',
                background: 'none',
                border: 'none',
                font: 'inherit',
                fontSize: 11.5,
                lineHeight: 1.5,
                textAlign: 'left',
                color: 'var(--dk-ink-3)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              {factor === 'app'
                ? 'Lost the phone? Use a recovery code — that session can read but not change anything.'
                : 'Use the code from your authenticator app instead.'}
            </button>
          </>
        ) : null}

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
          {busy ? 'Signing in…' : onCodeStep ? 'Verify and sign in' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
