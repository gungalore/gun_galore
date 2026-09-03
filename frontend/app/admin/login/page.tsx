'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { setDeskToken } from '@/lib/desk-auth';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // credentials: 'include' so the browser stores the httpOnly
      // Set-Cookie the backend now sends. Without this, fetch's default
      // (same-origin) usually works for our same-origin API, but include
      // is explicit + safe for any future cross-origin variant.
      const res = await fetch(`${API_URL}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      if (!res.ok) {
        setError('Invalid credentials');
        return;
      }
      const { token } = await res.json();
      // Primary storage: localStorage (bypasses all cookie-blocking
      // browser configs we've hit). Each admin page reads from here
      // via lib/admin-auth.adminFetch().
      setDeskToken(token);
      // Secondary: also try to set the JS cookie. Works in most
      // environments and lets server-component admin pages (legacy)
      // still gate via cookies(). Privacy-extension envs ignore this
      // silently — the localStorage path covers them.
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      try {
        document.cookie = `gg_admin_sess=${token}; path=/; max-age=${8 * 3600}; SameSite=Lax${secure}`;
      } catch {}
      router.push('/admin');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-[360px] rounded-[10px] p-7"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: 'var(--red)' }}>
          All Outdoor Admin
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-[6px] text-sm outline-none"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-[6px] text-sm outline-none"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          {error && (
            <p className="text-xs" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-[6px] text-sm font-medium"
            style={{ background: 'var(--red)', color: '#fff', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
