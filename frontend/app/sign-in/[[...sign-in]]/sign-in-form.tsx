'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '../../../lib/auth';

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

/**
 * ⚠️ RELATIVE PATHS ONLY. `redirect_url` comes off the query string, which
 * anybody can write. Sending the member to an absolute URL after sign-in is an
 * open redirect — the classic phishing shape, where the link looks like ours
 * and the landing page is not. The middleware applies the same rule.
 */
function safeRedirect(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { adopt } = useSession();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setUnverified(null);

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        expiresAt?: string;
        message?: string;
        code?: string;
        email?: string;
      };

      if (!res.ok) {
        // The one failure worth distinguishing: an account that exists but
        // has never proved its email. Anything else gets the same message,
        // so the form cannot be used to enumerate accounts.
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          setUnverified(data.email ?? identifier);
          return;
        }
        setError(data.message ?? 'Email, username or password is not right.');
        return;
      }

      if (data.accessToken && data.expiresAt) {
        await adopt(data.accessToken, data.expiresAt);
      }
      router.push(safeRedirect(params.get('redirect_url')));
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  if (unverified) {
    return (
      <div className="w-full max-w-sm text-center">
        <p className="text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
          Verify your email address to finish signing in.
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          We sent a code to {unverified}.
        </p>
        <Link
          href={`/verify-email?email=${encodeURIComponent(unverified)}`}
          className="inline-block px-4 py-2 rounded-[6px] text-sm"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          Enter the code
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Email or username
        <input
          type="text"
          autoComplete="username"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          style={{ ...field, marginTop: 4 }}
        />
      </label>

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...field, marginTop: 4 }}
        />
      </label>

      {error && (
        <p className="text-xs" style={{ color: 'var(--red)' }} role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <div className="flex items-center justify-between pt-1">
        <Link
          href="/forgot-password"
          className="text-xs"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Forgot password?
        </Link>
        <Link
          href="/sign-up"
          className="text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          Create an account
        </Link>
      </div>
    </form>
  );
}
