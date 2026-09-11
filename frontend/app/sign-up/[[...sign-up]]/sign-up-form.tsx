'use client';

import { useState, useEffect, useRef, useId, FormEvent } from 'react';
import { av } from '@/lib/asset-version';
import Link from 'next/link';
import { useSession } from '../../../lib/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { readCampaignAttrib, clearCampaignAttrib } from '@/lib/campaign-attrib';
import { StepRail, type StepRailStep } from '@/components/step-rail';
import { HelpTip } from '@/components/help-tip';
import { PasswordRulesTip } from '@/components/password-rules';
import {
  PASSWORD_MIN,
  PASSWORD_HINT,
  passwordProblem,
} from '@/lib/password-rule';
import { authErrorMessage } from '@/lib/auth-error';

// ⚠️ NEXT_PUBLIC_ ONLY. This file is 'use client'; Next inlines nothing else,
// so an INTERNAL_API_URL here is always undefined in the browser.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Version stamp recorded with each consent so we can prove WHICH Terms /
// Privacy Policy a user accepted (POPIA accountability). Bump when the
// policies materially change.
const POLICY_VERSION = '2026-07-17';
// ⚠️ THE PASSWORD RULE IS NOT DEFINED HERE ANY MORE — it is in
// lib/password-rule.ts, alongside the reset form's copy and a spec that
// checks both against the backend DTO. It has been 15 (the old hosted
// provider's own instance setting) and 12, and each move left one screen
// behind: a floor stated too high has the browser's own minLength refuse a
// password the API accepts, and stated too low has the member fill in a whole
// form and get bounced on the last click. That is why no screen holds a
// literal.
// ⚠️ THE PENDING-CONSENT CHANNEL IS GONE WITH THE OAUTH PATH IT SERVED.
// Consent used to be parked in sessionStorage during a Google redirect and
// flushed by an app-wide <ConsentSync/> once a session existed, because there
// was nowhere to attach it mid-redirect. Consent now travels in the register
// request body and is written in the same transaction as the account — which
// is what "race-free" was reaching for all along.

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

type Step = 'form' | 'verify';

// This two-screen flow (details → verify) is hand-rolled by us — Clerk only
// supplies the imperative signUp.create / attemptEmailAddressVerification
// calls, not any UI — so it gets the house step rail like every other
// multi-step setup. Desktop only: /sign-up is a NO_SHELL route
// (lib/shell-routes.ts) with no mobile header at any width, so there is no
// shell surface for useShellStep to publish a mobile-row counterpart to.
function signupSteps(current: 1 | 2): StepRailStep[] {
  return [
    { label: 'Your details', complete: current > 1 },
    { label: 'Verify email' },
  ];
}

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
  tip,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
  /**
   * Optional ⓘ beside the label, opening the house <HelpTip/>. Use it for a
   * rule that needs more than the one-line `hint` — never for the rule
   * itself, which must stay visible. A requirement only reachable by hover
   * is a requirement a phone cannot read.
   */
  tip?: React.ReactNode;
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
        {/* ⚠️ side="top", not the default "bottom". On a form field the input
            is ALWAYS directly under its label, so a popover that drops down
            covers the box the member opened it to help them fill in — and on
            this form it also lands on the Terms link. Above covers a field
            they have already dealt with. */}
        {tip && (
          <HelpTip title={label} side="top">
            {tip}
          </HelpTip>
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
  const { adopt } = useSession();
  // Nothing to wait for any more — the old hook reported when the identity
  // provider's client had booted. Kept as a constant so the render guard
  // below stays where it is rather than being unpicked.
  const isLoaded = true;
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
    passwordIssue: useId(),
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
  // Derived, not state: a second copy of "is the password acceptable" is a
  // second copy that can be stale by one keystroke.
  const passwordIssue = passwordProblem(form.password);
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
    setFormError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Consent travels WITH the account, in one request, and is written in
        // the same transaction. It used to ride the identity provider's
        // unsafeMetadata and reach us through a webhook, which meant the
        // account and the POPIA record could exist apart.
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          username: form.username.trim().toLowerCase(),
          phone: phoneToE164(form.phone),
          ...consentPayload(marketing),
          // The key parked by the welcome banner when this visit arrived on a
          // marketing SMS link. Absent when the visit was not campaign-led.
          ...(readCampaignAttrib()
            ? { campaignKey: readCampaignAttrib() }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        setFormError(
          authErrorMessage(res, data, 'Something went wrong. Please try again.'),
        );
        return;
      }

      // Attributed — don't let a second signup in the same session claim the
      // same blast.
      clearCampaignAttrib();
      setStep('verify');
      setResendCooldown(30);
    } catch (err) {
      setFormError(prettyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step 2: verify the 6-digit code Clerk emailed the user ────────
  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setVerifyError('');
    setVerifying(true);

    try {
      const res = await fetch(`${API_URL}/auth/verify-email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim(), code: code.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        expiresAt?: string;
        message?: string;
      };
      if (!res.ok) {
        setVerifyError(
          authErrorMessage(
            res,
            data,
            "We couldn't finish verifying your account. Request a new code, or contact support if this keeps happening.",
          ),
        );
        return;
      }
      // The account is live and the response carried the session. Adopt it
      // before navigating so the destination renders signed in.
      if (data.accessToken && data.expiresAt) {
        await adopt(data.accessToken, data.expiresAt);
      }
      router.push(redirectTarget);
      router.refresh();
    } catch (err) {
      setVerifyError(prettyAuthError(err));
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setVerifyError('');
    setVerifyNotice('');
    // ⚠️ START THE COOLDOWN BEFORE THE CALL, NOT AFTER. Every code costs us a
    // Didit credit, and the provider caps sends per address on its own side —
    // a member tapping through a slow request would burn both.
    setResendCooldown(30);
    try {
      const res = await fetch(`${API_URL}/auth/resend-email-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        setVerifyError(
          authErrorMessage(res, data, 'Could not send a new code.'),
        );
        return;
      }
      setVerifyNotice(`A new code is on its way to ${form.email}.`);
    } catch (err) {
      setVerifyError(prettyAuthError(err));
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

  // ⚠️ GOOGLE SIGN-IN IS GONE, AND IT WAS A REAL FEATURE — do not read its
  // absence as an oversight. It relied on the identity provider's hosted
  // redirect, which is what carried the OAuth handshake; nothing here can
  // replace it without an OAuth client of our own. The brief was a username,
  // a password and an email address, so that is what sign-up offers.

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
        <Link href="/" aria-label="All Outdoor">
          <img
            src={av('/logo-nav-dark.svg')}
            alt="All Outdoor"
            style={{ height: 48, width: 'auto' }}
          />
        </Link>
      </div>

      <StepRail steps={signupSteps(1)} current={1} className="mb-6" />

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
          South Africa&apos;s outdoor gear marketplace — sign up
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

          {/* Password. The rule lives in lib/password-rule.ts — the hint, the
              tooltip and the live check below all read it, so none of them
              can state a rule the API does not enforce. */}
          <Field
            label="Password"
            required
            htmlFor={ids.password}
            hint={PASSWORD_HINT}
            tip={<PasswordRulesTip password={form.password} />}
          >
            <div style={{ position: 'relative' }}>
              <input
                id={ids.password}
                type={showPassword ? 'text' : 'password'}
                required
                aria-required
                minLength={PASSWORD_MIN}
                aria-describedby={passwordIssue ? ids.passwordIssue : undefined}
                aria-invalid={passwordIssue ? true : undefined}
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
            {/* Live, and only once they have typed something — see
                passwordProblem(), which stays quiet on an empty field. */}
            {passwordIssue && (
              <p
                id={ids.passwordIssue}
                className="text-xs mt-1"
                style={{ color: 'var(--red)' }}
              >
                {passwordIssue}
              </p>
            )}
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

          {(() => {
            // Username availability is ADVISORY: block only on a confirmed
            // 'taken'. 'idle' / 'checking' / 'error' still allow submit — the
            // API enforces uniqueness and returns a real error.
            //
            // The PASSWORD rule is not advisory: the API refuses it outright,
            // so blocking here turns a bounced submit into a message beside
            // the field the member is already looking at.
            const canSubmit =
              consentOk &&
              usernameStatus.kind !== 'taken' &&
              !passwordProblem(form.password) &&
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
      {/* Same lockup as the first sign-up step above — this one was a
          hand-rolled text wordmark and got missed in the rebrand sweep, so
          every new user saw "Gun·Galore" at the moment they typed their
          verification code. */}
      <div className="flex justify-center mb-6">
        <Link href="/" aria-label="All Outdoor">
          <img
            src={av('/logo-nav-dark.svg')}
            alt="All Outdoor"
            style={{ height: 48, width: 'auto' }}
          />
        </Link>
      </div>

      {/* Step 1 shows complete + reachable here so tapping it re-uses the same
          "start over" reset offered by the link below. */}
      <StepRail
        steps={signupSteps(2)}
        current={2}
        onJump={(n) => n === 1 && onStartOver()}
        className="mb-6"
      />

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

// For a THROWN error — a dropped connection, a DNS failure — not for an HTTP
// response the server actually sent. Those go through authErrorMessage(),
// which knows about rate limits and framework strings.
function prettyAuthError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
