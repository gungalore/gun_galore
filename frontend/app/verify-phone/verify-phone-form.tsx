'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useSession } from '@/lib/auth';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 6,
  border: '0.5px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: 15,
};

const codeField: React.CSSProperties = {
  ...field,
  fontSize: 20,
  letterSpacing: '0.35em',
  textAlign: 'center',
};

interface Me {
  email: string;
  emailVerifiedAt: string | null;
  phone: string | null;
  phoneVerified: boolean;
}

/**
 * Phone verification against our own OTP rail (SMSPortal — the one that already
 * carries every action SMS).
 *
 * The number IS written to the account when the code is requested, but
 * `phoneVerified` stays false until the code is entered, so a typo is never
 * treated as a verified contact.
 */
export function VerifyPhoneForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { getToken } = useAuth();
  const { refresh } = useSession();

  const next = params.get('next') || '/profile/edit';

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as Me;
        if (cancelled) return;
        setMe(data);
        setPhone(data.phone ?? '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me/phone/request-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sent?: boolean;
        stub?: boolean;
        message?: string | string[];
      };
      if (!res.ok) {
        setError(
          Array.isArray(data.message)
            ? data.message.join(' ')
            : (data.message ?? 'We could not send the code just now.'),
        );
        return;
      }
      setStage('code');
      setNote(
        data.stub
          ? 'Development mode: the code was written to the SMS log, not sent.'
          : 'We sent a 6-digit code by SMS. It expires in 10 minutes.',
      );
    } catch {
      setError('We could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me/phone/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        message?: string | string[];
      };
      if (!res.ok) {
        setError(
          Array.isArray(data.message)
            ? data.message.join(' ')
            : (data.message ?? 'That code is not right.'),
        );
        return;
      }
      await refresh().catch(() => undefined);
      router.push(next);
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Loading your account…
      </p>
    );
  }

  if (me?.phoneVerified) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl" style={{ color: 'var(--text-primary)' }}>
          Your phone number is verified
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {me.phone} is confirmed. Nothing else to do.
        </p>
        <Link href={next} className="text-sm" style={{ color: 'var(--red)' }}>
          Continue
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl" style={{ color: 'var(--text-primary)' }}>
          Verify your phone number
        </h1>
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
        >
          We use your number for delivery updates and, when you sell, for your
          payout. It is never shown to other members.
        </p>
      </div>

      {me && !me.emailVerifiedAt && (
        <p
          className="text-xs rounded-[6px] p-3"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          Your email address is still unverified.{' '}
          <Link
            href={`/verify-email?email=${encodeURIComponent(me.email)}`}
            style={{ color: 'var(--red)' }}
          >
            Verify it here
          </Link>{' '}
          — both are needed before you can buy or sell.
        </p>
      )}

      {stage === 'phone' ? (
        <form onSubmit={requestCode} className="space-y-3">
          <label
            className="text-xs uppercase"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
          >
            Mobile number
          </label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            placeholder="082 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={field}
          />
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            South African numbers can be typed as 082 123 4567 — we add the
            country code.
          </p>
          {error && (
            <p className="text-xs" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}
          {note && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {note}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || phone.trim().length < 9}
            className="w-full rounded-[6px] px-4 py-2 text-sm"
            style={{
              background: busy ? 'var(--bg-card)' : 'var(--red)',
              color: busy ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Enter the 6-digit code sent to {phone.trim()}
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={codeField}
          />
          {error && (
            <p className="text-xs" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}
          {note && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {note}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || code.length < 4}
            className="w-full rounded-[6px] px-4 py-2 text-sm"
            style={{
              background: busy ? 'var(--bg-card)' : 'var(--red)',
              color: busy ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {busy ? 'Verifying…' : 'Verify number'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage('phone');
              setCode('');
              setError(null);
              setNote(null);
            }}
            className="text-xs"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}
