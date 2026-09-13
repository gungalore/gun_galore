'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { Me } from '@/lib/types';
import { safeJson } from '@/lib/safe-json';
import { useScrollLock } from '@/lib/use-scroll-lock';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ────────────────────────────────────────────────────────────────────
// The post-sign-up channel-preferences sheet.
//
// Operator decision: after sign-up, ask the member how they want to hear
// from us — WhatsApp, SMS, Email — and record it as a Meta-auditable
// opt-in (see backend NotificationConsent + CLAUDE.md "The
// channel-preferences sheet"). Shows ONCE, ever: server-side
// `channelPrefsPromptedAt`, not localStorage, because it is half of the
// consent record and has to survive a reinstall or a second device.
//
// Dismissible, NOT a wall — "show once and not nag". Both submitting and
// dismissing stamp the same server field via two backend routes
// (POST /users/me/channel-prefs and .../channel-prefs/dismiss), so a
// decline counts as answered exactly like a submit does.
//
// This component fetches its own /users/me rather than trusting a prop,
// so it can be mounted unconditionally right after email verification at
// sign-up (see sign-up-form.tsx) and still do the right thing for an
// account that — for whatever reason — already has the field stamped
// (e.g. a retried verify): it renders nothing and calls onDone straight
// away, exactly as if the member had dismissed it.
// ────────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'show' | 'hidden';

export function ChannelPrefsSheet({ onDone }: { onDone: () => void }) {
  const { getToken } = useAuth();

  const [state, setState] = useState<LoadState>('loading');
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(true);
  const [whatsapp, setWhatsapp] = useState(false);
  const [whatsappChannelEnabled, setWhatsappChannelEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // onDone is an inline arrow at the call site — a new function every
  // render. Read it through a ref so the load effect below can run once,
  // the same convention date-picker-sheet.tsx and profile-setup-prompt.tsx
  // use for their own caller-supplied callbacks.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Same reasoning for getToken: useAuth() hands back a fresh function
  // identity on every render (it is a plain object literal in the hook),
  // so putting it in the effect's dependency array would re-run the load
  // — and re-fetching /users/me after the member has already toggled a
  // switch would stomp their in-progress choice back to the server
  // defaults. Mount-only, read through a ref.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        const res = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) {
            setState('hidden');
            onDoneRef.current();
          }
          return;
        }
        const data = (await res.json()) as Me | null;
        if (cancelled) return;
        if (!data || data.channelPrefsPromptedAt) {
          // Already answered (or answered by the time this loaded) — never
          // shown twice, so proceed exactly as a dismiss would.
          setState('hidden');
          onDoneRef.current();
          return;
        }
        setEmail(data.notifyEmailEnabled !== false);
        setSms(data.notifySmsEnabled !== false);
        const flagOn = data.whatsappChannelEnabled === true;
        setWhatsappChannelEnabled(flagOn);
        setWhatsapp(flagOn && data.notifyWhatsappEnabled === true);
        setState('show');
      } catch {
        if (!cancelled) {
          setState('hidden');
          onDoneRef.current();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only — see the getTokenRef/onDoneRef note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useScrollLock(state === 'show');

  useEffect(() => {
    if (state !== 'show') return;
    const raf = requestAnimationFrame(() => setEntered(true));
    dialogRef.current?.focus();
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const dismiss = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/users/me/channel-prefs/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best-effort — a failed dismiss must not trap the member on this
      // sheet. The sheet re-showing once more on a rare failure is a far
      // better outcome than blocking sign-up.
    } finally {
      setBusy(false);
      onDoneRef.current();
    }
  }, [busy, getToken]);

  const submit = useCallback(async () => {
    if (busy) return;
    // Mirrors the server floor (users.service.ts): at least one of Email or
    // SMS has to survive. WhatsApp never counts towards it.
    if (!email && !sms) {
      setError(
        'Keep at least one of Email or SMS on so we can reach you about your orders.',
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me/channel-prefs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          emailEnabled: email,
          smsEnabled: sms,
          // Never send `true` while the channel is gated off — the switch
          // itself is disabled in that state, but a body built by hand
          // must not disagree with what the UI shows.
          whatsappEnabled: whatsappChannelEnabled ? whatsapp : false,
        }),
      });
      if (!res.ok) {
        const e = await safeJson<{ message?: string }>(res, {});
        setError(e.message ?? 'Could not save your preferences.');
        return;
      }
      onDoneRef.current();
    } catch {
      setError('Could not save your preferences.');
    } finally {
      setBusy(false);
    }
  }, [busy, email, sms, whatsapp, whatsappChannelEnabled, getToken]);

  if (state !== 'show') return null;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void dismiss();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.55)',
        opacity: entered ? 1 : 0,
        transition: 'opacity 200ms ease',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gg-channel-prefs-title"
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          padding: 24,
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
          outline: 'none',
          transform: entered ? 'translateY(0)' : 'translateY(16px)',
          opacity: entered ? 1 : 0,
          transition: 'transform 220ms ease, opacity 220ms ease',
        }}
      >
        <h2
          id="gg-channel-prefs-title"
          style={{
            color: 'var(--text-primary)',
            fontSize: 18,
            fontWeight: 500,
            margin: '0 0 6px',
          }}
        >
          How should we reach you?
        </h2>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 13,
            lineHeight: 1.5,
            margin: '0 0 18px',
          }}
        >
          Order updates, shipping, offers and bids, and licence reminders.
        </p>

        {error && (
          <p
            role="alert"
            style={{ color: 'var(--red)', fontSize: 13, margin: '0 0 12px' }}
          >
            {error}
          </p>
        )}

        <ChannelRow
          label="WhatsApp"
          note={whatsappChannelEnabled ? undefined : 'Coming soon'}
          on={whatsapp}
          disabled={!whatsappChannelEnabled}
          onClick={() => setWhatsapp((v) => !v)}
        />
        <ChannelRow
          label="SMS"
          on={sms}
          onClick={() => setSms((v) => !v)}
          bordered
        />
        <ChannelRow
          label="Email"
          on={email}
          onClick={() => setEmail((v) => !v)}
          bordered
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            style={{
              flex: 1,
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '11px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            Save preferences
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={busy}
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              borderRadius: 8,
              padding: '11px 16px',
              fontSize: 14,
              fontWeight: 400,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelRow({
  label,
  note,
  on,
  disabled = false,
  onClick,
  bordered = false,
}: {
  label: string;
  note?: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  bordered?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between py-2"
      style={bordered ? { borderTop: '0.5px solid var(--border)' } : undefined}
    >
      <div>
        <p style={{ color: 'var(--text-primary)', fontSize: 14, margin: 0 }}>
          {label}
        </p>
        {note && (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12, margin: 0 }}>
            {note}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label} notifications`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? undefined : onClick}
        style={{
          width: 44,
          height: 26,
          borderRadius: 13,
          border: 'none',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          background: on ? '#00a03c' : 'var(--border-hover)',
          position: 'relative',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </button>
    </div>
  );
}
