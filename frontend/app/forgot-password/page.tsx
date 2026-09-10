'use client';

import { useState } from 'react';
import Link from 'next/link';
import { av } from '@/lib/asset-version';

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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Swallowed on purpose — see the note below.
    } finally {
      // ⚠️ THE SAME ANSWER EITHER WAY, INCLUDING ON FAILURE. Whether that
      // address has an account is not this page's to disclose: a form that
      // says "no such account" is a free list of who banks here. The server
      // returns 200 regardless for the same reason.
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: 'var(--bg-deep)' }}
    >
      <Link href="/" aria-label="All Outdoor">
        <img
          src={av('/logo-nav-dark.svg')}
          alt="All Outdoor"
          style={{ height: 44, width: 'auto' }}
        />
      </Link>

      {sent ? (
        <div className="w-full max-w-sm text-center">
          <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
            Check your email.
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            If that address has an account, a reset link is on its way. It works
            once and expires in an hour.
          </p>
          <Link
            href="/sign-in"
            className="text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Reset your password
          </p>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ ...field, marginTop: 4 }}
            />
          </label>
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
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <Link
            href="/sign-in"
            className="text-xs text-center"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Back to sign in
          </Link>
        </form>
      )}
    </main>
  );
}
