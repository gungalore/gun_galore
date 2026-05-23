'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
// We import the LEGACY useSignUp from @clerk/nextjs/legacy because Clerk 7
// has a new "Signals"-based API that returns a SignUpFutureResource — that
// API requires a different call style. The legacy hook gives us
// { isLoaded, signUp, setActive } which matches the imperative flow we want
// (create → prepareEmailAddressVerification → attemptEmailAddressVerification).
import { useSignUp } from '@clerk/nextjs/legacy';
import { useRouter } from 'next/navigation';
import { isClerkAPIResponseError } from '@clerk/nextjs/errors';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Sign-up flow
// ─────────────
// Step 1 ("form"): user fills first/last/username/email/cell/password and submits.
//   We call signUp.create(...) which puts Clerk in a missing_email_address state
//   and emails a 6-digit code.
// Step 2 ("verify"): we show a code-input. attemptEmailAddressVerification.
//   On status=complete we activate the session and redirect to /dashboard.
//   Our backend webhook receives `user.created` and upserts the row in our DB.
// Step 3 ("done"): unused fallthrough — Clerk has already navigated us away.

type Step = 'form' | 'verify';

type UsernameStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken'; reason: string };

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '10px 12px',
  fontSize: '14px',
  outline: 'none',
};

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label
        className="block text-xs mb-1.5"
        style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>
        )}
      </label>
      {children}
      {hint && (
        <p
          className="text-xs mt-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export default function SignUpForm() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [step, setStep] = useState<Step>('form');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    phone: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({
    kind: 'idle',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Verification step
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ── Debounced username availability check ──────────────────────────
  useEffect(() => {
    const u = form.username.trim();
    if (!u) {
      setUsernameStatus({ kind: 'idle' });
      return;
    }
    setUsernameStatus({ kind: 'checking' });
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/users/username-check?u=${encodeURIComponent(u)}`,
          { signal: ctrl.signal },
        );
        const data: { available: boolean; reason?: string } = await res.json();
        if (data.available) {
          setUsernameStatus({ kind: 'available' });
        } else {
          setUsernameStatus({
            kind: 'taken',
            reason: data.reason ?? 'Unavailable',
          });
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setUsernameStatus({ kind: 'idle' });
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [form.username]);

  // ── Step 1: create the Clerk SignUp + send verification email ──────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    setFormError('');
    setSubmitting(true);

    try {
      // Phone digits without spaces, plus +27 prefix for E.164 storage.
      const phoneE164 = '+27' + form.phone.replace(/\D/g, '');

      await signUp.create({
        emailAddress: form.email.trim(),
        password: form.password,
        username: form.username.trim().toLowerCase(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        // Phone goes in unsafeMetadata — our webhook reads it from there
        // and stores it in User.phone. We skip Clerk's phone-verification
        // flow because the number is only used for SMS notifications,
        // not authentication.
        unsafeMetadata: { phone: phoneE164 },
      });

      // Trigger email verification
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setStep('verify');
    } catch (err) {
      setFormError(prettyClerkError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step 2: verify the 6-digit code Clerk emailed the user ────────
  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    setVerifyError('');
    setVerifying(true);

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push('/dashboard');
      } else {
        setVerifyError(
          `Verification incomplete — status: ${result.status}. Please try again.`,
        );
      }
    } catch (err) {
      setVerifyError(prettyClerkError(err));
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (!isLoaded || !signUp) return;
    setVerifyError('');
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
    } catch (err) {
      setVerifyError(prettyClerkError(err));
    }
  }

  async function handleGoogleSSO() {
    if (!isLoaded || !signUp) return;
    setFormError('');
    try {
      await signUp.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/dashboard',
      });
    } catch (err) {
      setFormError(prettyClerkError(err));
    }
  }

  // ─────────────────────────── RENDER ───────────────────────────────

  if (!isLoaded) {
    return (
      <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <VerifyStep
        email={form.email}
        code={code}
        setCode={setCode}
        onSubmit={handleVerify}
        onResend={handleResend}
        verifying={verifying}
        error={verifyError}
      />
    );
  }

  return (
    <div className="w-full max-w-[480px]">
      {/* Logo / brand — centred wordmark, 5:1 aspect locked. */}
      <div className="flex justify-center mb-6">
        <Link href="/" aria-label="Gun Galore">
          <img
            src="/logo.svg"
            alt="Gun Galore"
            style={{ height: 48, width: 'auto' }}
          />
        </Link>
      </div>

      {/* Card */}
      <div
        className="rounded-[8px] p-6 sm:p-8"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <h1
          className="text-xl mb-1"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Create your account
        </h1>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--text-tertiary)' }}
        >
          South Africa&apos;s firearms marketplace — sign up to buy, sell, or enter competitions.
        </p>

        {/* Google SSO */}
        <button
          type="button"
          onClick={handleGoogleSSO}
          className="w-full py-2.5 rounded-[6px] text-sm flex items-center justify-center gap-2 mb-4"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path
              fill="#4285F4"
              d="M15.68 8.18c0-.6-.05-1.18-.15-1.74H8v3.3h4.3a3.68 3.68 0 0 1-1.6 2.4v2h2.6c1.5-1.4 2.38-3.45 2.38-5.96Z"
            />
            <path
              fill="#34A853"
              d="M8 16c2.16 0 3.97-.72 5.3-1.95l-2.6-2c-.72.48-1.64.77-2.7.77a4.68 4.68 0 0 1-4.4-3.23H1v2.03A8 8 0 0 0 8 16Z"
            />
            <path
              fill="#FBBC05"
              d="M3.6 9.6A4.8 4.8 0 0 1 3.34 8c0-.55.1-1.1.26-1.6V4.36H1A8 8 0 0 0 0 8c0 1.3.31 2.52.86 3.6L3.6 9.6Z"
            />
            <path
              fill="#EA4335"
              d="M8 3.18c1.18 0 2.24.4 3.07 1.2l2.3-2.3A8 8 0 0 0 8 0 8 8 0 0 0 .86 4.4l2.74 2.04A4.7 4.7 0 0 1 8 3.18Z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <span
            style={{
              flex: 1,
              height: 1,
              background: 'var(--border)',
              opacity: 0.5,
            }}
          />
          <span
            className="text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            or
          </span>
          <span
            style={{
              flex: 1,
              height: 1,
              background: 'var(--border)',
              opacity: 0.5,
            }}
          />
        </div>

        {/* Top-level form error */}
        {formError && (
          <div
            className="mb-4 px-3 py-2 rounded-[6px] text-xs"
            style={{
              background: 'rgba(200,16,46,0.08)',
              border: '0.5px solid var(--red)',
              color: 'var(--red)',
            }}
          >
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* First name + Surname */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" required>
              <input
                type="text"
                required
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                style={inputStyle}
                autoComplete="given-name"
                placeholder="Gerhard"
              />
            </Field>
            <Field label="Surname" required>
              <input
                type="text"
                required
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                style={inputStyle}
                autoComplete="family-name"
                placeholder="Fourie"
              />
            </Field>
          </div>

          {/* Username with live availability check */}
          <div>
            <label
              className="block text-xs mb-1.5 flex items-center justify-between"
              style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
            >
              <span>
                Username
                <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>
              </span>
              {form.username && (
                <span
                  className="text-xs"
                  style={{
                    color:
                      usernameStatus.kind === 'available'
                        ? '#22c55e'
                        : usernameStatus.kind === 'taken'
                          ? 'var(--red)'
                          : 'var(--text-tertiary)',
                    fontWeight: 400,
                  }}
                >
                  {usernameStatus.kind === 'checking' && 'Checking…'}
                  {usernameStatus.kind === 'available' && '✓ Available'}
                  {usernameStatus.kind === 'taken' && '✕ ' + usernameStatus.reason}
                </span>
              )}
            </label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_]+"
              value={form.username}
              onChange={(e) =>
                set(
                  'username',
                  e.target.value.replace(/\s+/g, '').toLowerCase(),
                )
              }
              style={{
                ...inputStyle,
                borderColor:
                  usernameStatus.kind === 'available'
                    ? '#22c55e60'
                    : usernameStatus.kind === 'taken'
                      ? 'var(--red)'
                      : 'var(--border)',
              }}
              autoComplete="username"
              placeholder="gerhardf"
            />
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Shown publicly on listings and competition entries. Lowercase letters, numbers, and underscores.
            </p>
          </div>

          {/* Email */}
          <Field label="Email address" required>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              style={inputStyle}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>

          {/* Cell number */}
          <Field
            label="Cell number"
            required
            hint="We use this for SMS-based delivery and dispute notifications."
          >
            <div className="flex gap-2">
              <span
                className="flex items-center px-3 text-sm rounded-[6px]"
                style={{
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-tertiary)',
                }}
              >
                +27
              </span>
              <input
                type="tel"
                required
                pattern="[0-9 ]{8,12}"
                value={form.phone}
                onChange={(e) =>
                  set('phone', e.target.value.replace(/[^\d ]/g, ''))
                }
                style={inputStyle}
                autoComplete="tel"
                placeholder="82 000 0000"
              />
            </div>
          </Field>

          {/* Password */}
          <Field label="Password" required hint="At least 8 characters.">
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                style={{ ...inputStyle, paddingRight: 56 }}
                autoComplete="new-password"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-xs"
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          {/* Terms */}
          <label
            className="flex items-start gap-2 text-xs cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{
                marginTop: 2,
                accentColor: 'var(--red)',
                cursor: 'pointer',
              }}
            />
            <span>
              I agree to the{' '}
              <Link
                href="/terms"
                style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
              >
                Terms
              </Link>
              {' '}and{' '}
              <Link
                href="/privacy"
                style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
              >
                Privacy Policy
              </Link>
              {' '}and I am over 18 years old.
            </span>
          </label>

          {/* Clerk CAPTCHA mount point — required when smart bot protection is on.
              Clerk auto-detects and hides this when not needed. */}
          <div id="clerk-captcha" />

          {(() => {
            const canSubmit =
              agreed &&
              usernameStatus.kind === 'available' &&
              !submitting;
            return (
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full py-3 rounded-[6px] text-sm font-medium transition-opacity"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  opacity: canSubmit ? 1 : 0.5,
                }}
              >
                {submitting ? 'Creating account…' : 'Create account'}
              </button>
            );
          })()}
        </form>

        <p
          className="text-xs text-center mt-5"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Already have an account?{' '}
          <Link
            href="/sign-in"
            style={{ color: 'var(--red)', textDecoration: 'none' }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────── Verification step ───────────────────────────

function VerifyStep({
  email,
  code,
  setCode,
  onSubmit,
  onResend,
  verifying,
  error,
}: {
  email: string;
  code: string;
  setCode: (c: string) => void;
  onSubmit: (e: FormEvent) => void;
  onResend: () => void;
  verifying: boolean;
  error: string;
}) {
  return (
    <div className="w-full max-w-[480px]">
      <div className="text-center mb-6">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span
            className="text-xl tracking-tight"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            Gun
            <span style={{ color: 'var(--red)' }}>·</span>
            Galore
          </span>
        </Link>
      </div>

      <div
        className="rounded-[8px] p-6 sm:p-8"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <h1
          className="text-xl mb-1"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Check your email
        </h1>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--text-tertiary)' }}
        >
          We sent a 6-digit code to{' '}
          <span style={{ color: 'var(--text-primary)' }}>{email}</span>. Enter it below to finish creating your account.
        </p>

        {error && (
          <div
            className="mb-4 px-3 py-2 rounded-[6px] text-xs"
            style={{
              background: 'rgba(200,16,46,0.08)',
              border: '0.5px solid var(--red)',
              color: 'var(--red)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Verification code" required>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{
                ...inputStyle,
                fontSize: '20px',
                letterSpacing: '0.4em',
                textAlign: 'center',
                fontFamily: 'monospace',
              }}
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
            />
          </Field>

          <button
            type="submit"
            disabled={code.length !== 6 || verifying}
            className="w-full py-3 rounded-[6px] text-sm font-medium"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              cursor: code.length === 6 && !verifying ? 'pointer' : 'not-allowed',
              opacity: code.length === 6 && !verifying ? 1 : 0.5,
            }}
          >
            {verifying ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>

        <p
          className="text-xs text-center mt-5"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Didn&apos;t get the code?{' '}
          <button
            type="button"
            onClick={onResend}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--red)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Resend
          </button>
        </p>
      </div>
    </div>
  );
}

// Clerk surfaces errors as `ClerkAPIError` arrays. Surface the first one
// in plain English; fall back to a generic message.
function prettyClerkError(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    const first = err.errors[0];
    if (!first) return 'Something went wrong. Please try again.';
    // longMessage is friendlier than message
    return first.longMessage ?? first.message ?? 'Something went wrong.';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
