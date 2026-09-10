'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '../../lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const field: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '0.5px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: 20,
  letterSpacing: '0.35em',
  textAlign: 'center',
};

/** The code lives five minutes at the provider; nudge before it lapses. */
const RESEND_COOLDOWN_S = 60;

export function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { adopt } = useSession();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    setEmail(params.get('email') ?? '');
  }, [params]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`${API_URL}/auth/verify-email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        expiresAt?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? 'That code is not right.');
        return;
      }
      if (data.accessToken && data.expiresAt) {
        await adopt(data.accessToken, data.expiresAt);
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || !email) return;
    setError(null);
    setCooldown(RESEND_COOLDOWN_S);
    try {
      const res = await fetch(`${API_URL}/auth/resend-email-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setNote(res.ok ? 'A new code is on its way.' : null);
      if (!res.ok) setError(data.message ?? 'Could not send a new code.');
    } catch {
      setError('We could not reach the server.');
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
      <p className="text-sm text-center" style={{ color: 'var(--text-primary)' }}>
        Enter the 6-digit code we emailed to
      </p>
      <p
        className="text-sm text-center -mt-2 mb-1"
        style={{ color: 'var(--text-secondary)' }}
      >
        {email || 'your address'}
      </p>

      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={8}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        style={field}
        aria-label="Verification code"
      />

      {error && (
        <p className="text-xs text-center" style={{ color: 'var(--red)' }} role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          {note}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || code.length < 4}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          opacity: busy || code.length < 4 ? 0.6 : 1,
        }}
      >
        {busy ? 'Checking…' : 'Verify'}
      </button>

      <button
        type="button"
        onClick={resend}
        disabled={cooldown > 0}
        className="text-xs py-1"
        style={{
          background: 'none',
          border: 'none',
          color: cooldown > 0 ? 'var(--text-faint)' : 'var(--text-tertiary)',
        }}
      >
        {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
      </button>
    </form>
  );
}
