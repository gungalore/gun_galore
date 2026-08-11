'use client';

import { useState, useEffect, useRef, useId, FormEvent } from 'react';
import Link from 'next/link';
// We import the LEGACY useSignUp from @clerk/nextjs/legacy because Clerk 7
// has a new "Signals"-based API that returns a SignUpFutureResource — that
// API requires a different call style. The legacy hook gives us
// { isLoaded, signUp, setActive } which matches the imperative flow we want
// (create → prepareEmailAddressVerification → attemptEmailAddressVerification).
import { useSignUp } from '@clerk/nextjs/legacy';
import { useRouter, useSearchParams } from 'next/navigation';
import { isClerkAPIResponseError } from '@clerk/nextjs/errors';
import { readCampaignAttrib, clearCampaignAttrib } from '@/lib/campaign-attrib';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Version stamp recorded with each consent so we can prove WHICH Terms /
// Privacy Policy a user accepted (POPIA accountability). Bump when the
// policies materially change.
const POLICY_VERSION = '2026-07-17';
// sessionStorage key the app-wide <ConsentSync/> flushes to the backend once
// the session is live. Used ONLY for the Google/OAuth path (where we can't
// attach unsafeMetadata to the redirect) — the email path records consent via
// Clerk unsafeMetadata instead (per-user, race-free). sessionStorage (per-tab,
// cleared on tab close) + a timestamp TTL keeps a leftover record from an
// abandoned OAuth attempt from ever attaching to a different account.
const PENDING_CONSENT_KEY = 'gg_pending_consent';

function consentPayload(marketing: boolean) {
  return {
    terms: true,
    privacy: true,
    age: true,
    marketing,
    policyVersion: POLICY_VERSION,
  };
}

// Only accept a same-origin, single-slash-rooted relative path as a post-auth
// redirect target — never an absolute, protocol-relative ("//evil"), or
// backslash-tricked ("/\evil" → browsers normalise "\" to "/") URL.
function safeRelativePath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return null;
  }
  return raw;
}

// OAuth-only: stash the consent (tagged with a timestamp) in per-tab
// sessionStorage so <ConsentSync/> can record it after the redirect completes.
function writePendingConsent(marketing: boolean) {
  try {
    sessionStorage.setItem(
      PENDING_CONSENT_KEY,
      JSON.stringify({ ...consentPayload(marketing), ts: Date.now() }),
    );
  } catch {
    // Storage unavailable (private mode) — consent still gated in the UI; the
    // record is best-effort. Never block sign-up on this.
  }
}

type Step = 'form' | 'verify';

type UsernameStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken'; reason: string }
  | { kind: 'error' }; // availability endpoint failed — advisory only

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '10px 12px',
  fontSize: '14px',
  // NOTE: no `outline: none` — keyboard users need a visible focus ring.
};

function Field({
  label,
  required,
  children,
  hint,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-xs mb-1.5"
        style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--red)', marginLeft: 4 }} aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export default function SignUpForm() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to land after sign-up — honour a same-origin ?redirect_url, else
  // /dashboard. Validated so it can never become an open redirect.
  const redirectTarget = safeRelativePath(searchParams.get('redirect_url')) ?? '/dashboard';

  const ids = {
    firstName: useId(),
    lastName: useId(),
    username: useId(),
    email: useId(),
    phone: useId(),
    password: useId(),
    usernameStatus: useId(),
  };

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
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedAge, setAgreedAge] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({
    kind: 'idle',
  });
  const [submitting, setSubmitting] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const formErrorRef = useRef<HTMLDivElement>(null);

  // Verification step
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifyNotice, setVerifyNotice] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Move focus to the error banner on a failed submit so screen-reader +
  // keyboard users aren't stranded (the banner also announces via role=alert).
  useEffect(() => {
    if (formError && formErrorRef.current) {
      formErrorRef.current.focus();
      formErrorRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [formError]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

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
        if (!res.ok) throw new Error(`status ${res.status}`);
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
        // Advisory only — the endpoint hiccupped. Do NOT block sign-up; Clerk
        // enforces uniqueness server-side and returns a real error on submit.
        setUsernameStatus({ kind: 'error' });
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [form.username]);

  const consentOk = agreedTerms && agreedAge;

  // Build the SA E.164 number: strip non-digits AND a single leading 0
  // (users type "082…" but E.164 is +27 82…), then prefix +27.
  function phoneToE164(raw: string): string {
    return '+27' + raw.replace(/\D/g, '').replace(/^0/, '');
  }

  // ── Step 1: create the Clerk SignUp + send verification email ──────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    setFormError('');
    setSubmitting(true);

    try {
      await signUp.create({
        emailAddress: form.email.trim(),
        password: form.password,
        username: form.username.trim().toLowerCase(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        // Phone + consent go in unsafeMetadata — our webhook / lazy-sync read
        // them from there. Phone → User.phone (unverified; the OTP flow marks
        // it verified). consent → the timestamped POPIA record. Attaching
        // consent to the Clerk user (not browser storage) makes it per-user
        // and race-free: it can never attach to a different account.
        unsafeMetadata: {
          phone: phoneToE164(form.phone),
          consent: consentPayload(marketing),
          // Campaign attribution — the key parked by the welcome banner when
          // this visit arrived on a marketing SMS link. Rides the same
          // per-user unsafeMetadata channel as consent so it can never attach
          // to the wrong account. Undefined when the visit wasn't campaign-led.
          ...(readCampaignAttrib()
            ? { campaignKey: readCampaignAttrib() }
            : {}),
        },
      });
      // Attributed — don't let a second signup in the same session claim the
      // same blast.
      clearCampaignAttrib();

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setStep('verify');
      setResendCooldown(30);
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
        // Consent is flushed to the backend by the app-wide <ConsentSync/>
        // once the session is live — no token juggling here.
        router.push(redirectTarget);
      } else {
        // Never surface a raw Clerk status string to the user.
        setVerifyError(
          "We couldn't finish verifying your account. Request a new code, or contact support if this keeps happening.",
        );
      }
    } catch (err) {
      setVerifyError(prettyClerkError(err));
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (!isLoaded || !signUp || resendCooldown > 0) return;
    setVerifyError('');
    setVerifyNotice('');
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setVerifyNotice(`A new code is on its way to ${form.email}.`);
      setResendCooldown(30);
    } catch (err) {
      setVerifyError(prettyClerkError(err));
    }
  }

  // Abandon the in-progress sign-up and return to the form (e.g. the user
  // mistyped their email). Clerk keeps the pending sign-up server-side, so we
  // just reset our local step; a fresh submit with a corrected email starts
  // over cleanly.
  function handleStartOver() {
    setStep('form');
    setCode('');
    setVerifyError('');
    setVerifyNotice('');
  }

  async function handleGoogleSSO() {
    if (!isLoaded || !signUp) return;
    if (!consentOk) {
      setFormError(
        'Please agree to the Terms & Privacy Policy and confirm you are 18 or older before continuing.',
      );
      return;
    }
    setFormError('');
    setSsoLoading(true);
    try {
      writePendingConsent(marketing);
      await signUp.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: redirectTarget,
      });
    } catch (err) {
      setFormError(prettyClerkError(err));
      setSsoLoading(false);
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
        onStartOver={handleStartOver}
        verifying={verifying}
        error={verifyError}
        notice={verifyNotice}
        resendCooldown={resendCooldown}
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
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          South Africa&apos;s outdoor, hunting and sport marketplace — sign up
          to buy or sell.
        </p>

        {/* Top-level form error (announced + focus-managed) */}
        {formError && (
          <div
            ref={formErrorRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="mb-4 px-3 py-2 rounded-[6px] text-xs"
            style={{
              background: 'rgba(200,16,46,0.08)',
              border: '0.5px solid var(--red)',
              color: 'var(--red)',
              outline: 'none',
            }}
          >
            {formError}
          </div>
        )}

        {/* Google SSO */}
        <button
          type="button"
          onClick={handleGoogleSSO}
          disabled={ssoLoading || !consentOk}
          className="w-full py-2.5 rounded-[6px] text-sm flex items-center justify-center gap-2 mb-4"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            fontWeight: 500,
            cursor: ssoLoading || !consentOk ? 'not-allowed' : 'pointer',
            opacity: consentOk ? 1 : 0.5,
          }}
          title={
            consentOk
              ? undefined
              : 'Agree to the Terms & confirm you are 18+ to continue'
          }
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
          {ssoLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <span style={{ flex: 1, height: 1, background: 'var(--border)', opacity: 0.5 }} />
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            or
          </span>
          <span style={{ flex: 1, height: 1, background: 'var(--border)', opacity: 0.5 }} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* First name + Surname */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" required htmlFor={ids.firstName}>
              <input
                id={ids.firstName}
                type="text"
                required
                aria-required
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                style={inputStyle}
                autoComplete="given-name"
                placeholder="Gerhard"
              />
            </Field>
            <Field label="Surname" required htmlFor={ids.lastName}>
              <input
                id={ids.lastName}
                type="text"
                required
                aria-required
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
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor={ids.username}
                className="block text-xs"
                style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
              >
                Username
                <span style={{ color: 'var(--red)', marginLeft: 4 }} aria-hidden>
                  *
                </span>
              </label>
              {form.username && (
                <span
                  id={ids.usernameStatus}
                  role="status"
                  aria-live="polite"
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
                  {usernameStatus.kind === 'error' &&
                    "Couldn't check right now — we'll confirm on submit"}
                </span>
              )}
            </div>
            <input
              id={ids.username}
              type="text"
              required
              aria-required
              aria-describedby={form.username ? ids.usernameStatus : undefined}
              aria-invalid={usernameStatus.kind === 'taken'}
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_]+"
              value={form.username}
              onChange={(e) =>
                set('username', e.target.value.replace(/\s+/g, '').toLowerCase())
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
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Shown publicly on your listings. Lowercase letters, numbers, and underscores.
            </p>
          </div>

          {/* Email */}
          <Field label="Email address" required htmlFor={ids.email}>
            <input
              id={ids.email}
              type="email"
              required
              aria-required
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
            htmlFor={ids.phone}
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
                aria-hidden
              >
                +27
              </span>
              <input
                id={ids.phone}
                type="tel"
                required
                aria-required
                aria-label="Cell number (South African, without the country code)"
                pattern="0?[0-9 ]{8,12}"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value.replace(/[^\d ]/g, ''))}
                style={inputStyle}
                autoComplete="tel"
                placeholder="82 000 0000"
              />
            </div>
          </Field>

          {/* Password */}
          <Field label="Password" required htmlFor={ids.password} hint="At least 8 characters.">
            <div style={{ position: 'relative' }}>
              <input
                id={ids.password}
                type={showPassword ? 'text' : 'password'}
                required
                aria-required
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
                aria-label={showPassword ? 'Hide password' : 'Show password'}
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

          {/* Consent — Terms/Privacy and the 18+ affirmation are SEPARATE,
              both required; marketing is a distinct optional opt-in. */}
          <div className="space-y-2 pt-1">
            <label
              className="flex items-start gap-2 text-xs cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                style={{ marginTop: 2, accentColor: 'var(--red)', cursor: 'pointer' }}
              />
              <span>
                I agree to the{' '}
                <Link href="/terms" style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}>
                  Terms
                </Link>{' '}
                and{' '}
                <Link href="/privacy" style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}>
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            <label
              className="flex items-start gap-2 text-xs cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={agreedAge}
                onChange={(e) => setAgreedAge(e.target.checked)}
                style={{ marginTop: 2, accentColor: 'var(--red)', cursor: 'pointer' }}
              />
              <span>I confirm I am 18 years of age or older.</span>
            </label>
            <label
              className="flex items-start gap-2 text-xs cursor-pointer"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                style={{ marginTop: 2, accentColor: 'var(--red)', cursor: 'pointer' }}
              />
              <span>
                Send me occasional deals and product news (optional — you can opt out anytime).
              </span>
            </label>
          </div>

          {/* Clerk CAPTCHA mount point — required when smart bot protection is on.
              Clerk auto-detects and hides this when not needed. */}
          <div id="clerk-captcha" />

          {(() => {
            // Username availability is ADVISORY: block only on a confirmed
            // 'taken'. 'idle' / 'checking' / 'error' still allow submit — Clerk
            // enforces uniqueness server-side and returns a real error.
            const canSubmit =
              consentOk && usernameStatus.kind !== 'taken' && !submitting;
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

        <p className="text-xs text-center mt-5" style={{ color: 'var(--text-tertiary)' }}>
          Already have an account?{' '}
          <Link href="/sign-in" style={{ color: 'var(--red)', textDecoration: 'none' }}>
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
  onStartOver,
  verifying,
  error,
  notice,
  resendCooldown,
}: {
  email: string;
  code: string;
  setCode: (c: string) => void;
  onSubmit: (e: FormEvent) => void;
  onResend: () => void;
  onStartOver: () => void;
  verifying: boolean;
  error: string;
  notice: string;
  resendCooldown: number;
}) {
  const codeId = useId();
  return (
    <div className="w-full max-w-[480px]">
      <div className="text-center mb-6">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span
            className="text-xl tracking-tight"
            style={{ color: 'var(--text-primary)', fontWeight: 500, letterSpacing: '-0.01em' }}
          >
            Gun<span style={{ color: 'var(--red)' }}>·</span>Galore
          </span>
        </Link>
      </div>

      <div
        className="rounded-[8px] p-6 sm:p-8"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <h1 className="text-xl mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          Check your email
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          We sent a 6-digit code to{' '}
          <span style={{ color: 'var(--text-primary)' }}>{email}</span>. Enter it below to finish
          creating your account.{' '}
          <button
            type="button"
            onClick={onStartOver}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--red)',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
              fontSize: 'inherit',
            }}
          >
            Wrong email? Start over
          </button>
        </p>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
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
        {!error && notice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 px-3 py-2 rounded-[6px] text-xs"
            style={{
              background: 'rgba(34,197,94,0.08)',
              border: '0.5px solid rgba(34,197,94,0.4)',
              color: '#22c55e',
            }}
          >
            {notice}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Verification code" required htmlFor={codeId}>
            <input
              id={codeId}
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              aria-required
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

        <p className="text-xs text-center mt-5" style={{ color: 'var(--text-tertiary)' }}>
          Didn&apos;t get the code?{' '}
          <button
            type="button"
            onClick={onResend}
            disabled={resendCooldown > 0}
            style={{
              background: 'transparent',
              border: 'none',
              color: resendCooldown > 0 ? 'var(--text-tertiary)' : 'var(--red)',
              cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
              padding: 0,
            }}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
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
    return first.longMessage ?? first.message ?? 'Something went wrong.';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
