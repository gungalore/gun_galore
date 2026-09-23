'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminLogin, adminMe, adminTokens } from '@/lib/admin-api';
import { Icon } from '@/components/admin/admin-ui';

/**
 * Admin sign-in.
 *
 * ⚠️ IT READS `?next=` FROM location.search, NOT useSearchParams(). The hook
 * forces the whole route behind a Suspense boundary at build time, which for a
 * single-field login form is all cost and no benefit.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState('/admin/warden');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('next');
    if (target && target.startsWith('/admin')) setNext(target);

    // Already signed in? Skip the form.
    if (adminTokens.access() || adminTokens.refresh()) {
      void adminMe()
        .then(() => router.replace(next))
        .catch(() => {
          /* stale pair — the form below is the way back in */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminLogin({
        email: email.trim(),
        password,
        ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
      });
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="adm-login-wrap">
      <form className="adm-card adm-login-card" onSubmit={submit}>
        <div className="adm-brand" style={{ marginBottom: 4 }}>
          <span className="adm-brand-badge">
            <Icon name="shield" size={18} />
          </span>
          <div>
            <div className="adm-brand-title">ALL Outdoor</div>
            <div className="adm-brand-sub">WARDEN OS</div>
          </div>
        </div>

        <p className="adm-sub">
          Operator sign-in. TOTP is required once your account has it enrolled.
        </p>

        <label className="adm-label" htmlFor="adm-email">
          Email
        </label>
        <input
          id="adm-email"
          className="adm-input"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="adm-label" htmlFor="adm-password">
          Password
        </label>
        <input
          id="adm-password"
          className="adm-input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {showTotp ? (
          <>
            <label className="adm-label" htmlFor="adm-totp">
              Authenticator code
            </label>
            <input
              id="adm-totp"
              className="adm-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
          </>
        ) : (
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            style={{ padding: '8px 12px', fontSize: 12 }}
            onClick={() => setShowTotp(true)}
          >
            <Icon name="lock" size={14} />
            I have an authenticator code
          </button>
        )}

        {error ? (
          <p style={{ color: 'var(--adm-red)', fontSize: 12.5 }}>{error}</p>
        ) : null}

        <button
          type="submit"
          className="adm-btn"
          data-tone="cyan"
          disabled={busy}
        >
          {busy ? 'Verifying…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
