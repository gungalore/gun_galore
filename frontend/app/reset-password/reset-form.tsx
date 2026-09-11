'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { HelpTip } from '@/components/help-tip';
import { authErrorMessage } from '@/lib/auth-error';
import { PasswordRulesTip } from '@/components/password-rules';
import {
  PASSWORD_MIN,
  PASSWORD_HINT,
  passwordProblem,
} from '@/lib/password-rule';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const field: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '0.5px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: 15,
};

export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(params.get('token') ?? '');
  }, [params]);

  // The same rule the sign-up form and the API use — see lib/password-rule.ts.
  // It was a bare length check here, which quietly stopped being the whole
  // rule the day the number and the special character were added.
  const passwordIssue = passwordProblem(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || passwordIssue || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(
          authErrorMessage(
            res,
            data,
            'That reset link is no longer valid. Request a new one.',
          ),
        );
        return;
      }
      setDone(true);
    } catch {
      setError('We could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="w-full max-w-sm text-center">
        <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
          Your password is changed.
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Every other device has been signed out.
        </p>
        <button
          type="button"
          onClick={() => router.push('/sign-in')}
          className="px-4 py-2 rounded-[6px] text-sm"
          style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
        >
          Sign in
        </button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="w-full max-w-sm text-center">
        <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
          That link is incomplete.
        </p>
        <Link
          href="/forgot-password"
          className="text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          Request a new one
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
        Choose a new password
      </p>

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          New password
          {/* Above, not below — the input sits directly under this label. */}
          <HelpTip title="New password" side="top">
            <PasswordRulesTip password={password} />
          </HelpTip>
        </span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          aria-invalid={passwordIssue ? true : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...field, marginTop: 4 }}
        />
      </label>
      {/* The rule stays visible; the tooltip is the long form, not the only
          form. A requirement reachable only by hover is one a phone meets by
          trial and error. */}
      <p className="text-xs -mt-1" style={{ color: 'var(--text-faint)' }}>
        {PASSWORD_HINT}
      </p>

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ ...field, marginTop: 4 }}
        />
      </label>

      {(passwordIssue || mismatch || error) && (
        <p className="text-xs" style={{ color: 'var(--red)' }} role="alert">
          {error ?? passwordIssue ?? 'Those two do not match.'}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !!passwordIssue || mismatch || !password}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          opacity: busy || passwordIssue || mismatch || !password ? 0.6 : 1,
        }}
      >
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
