'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Must match PASSWORD_MIN in backend/src/auth/dto/auth.dto.ts. */
const PASSWORD_MIN = 12;

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

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || tooShort || mismatch) return;
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
          data.message ?? 'That reset link is no longer valid. Request a new one.',
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
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...field, marginTop: 4 }}
        />
      </label>
      <p className="text-xs -mt-1" style={{ color: 'var(--text-faint)' }}>
        At least {PASSWORD_MIN} characters. Longer beats complicated.
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

      {(tooShort || mismatch || error) && (
        <p className="text-xs" style={{ color: 'var(--red)' }} role="alert">
          {error ??
            (tooShort
              ? `Use at least ${PASSWORD_MIN} characters.`
              : 'Those two do not match.')}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || tooShort || mismatch || !password}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          opacity: busy || tooShort || mismatch || !password ? 0.6 : 1,
        }}
      >
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
