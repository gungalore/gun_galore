'use client';

// PushOptInBanner — slim card mounted at the top of /notifications.
// Surfaces the "Enable push" CTA for signed-in users on supported
// devices. Self-hides when:
//   - the user isn't signed in
//   - the backend has no VAPID config
//   - push isn't supported (older browsers)
//   - push is already enabled on this device
//   - the user dismissed it (14-day localStorage flag)
//
// iOS special-case: web push only works in installed PWAs (16.4+).
// If the user is on iOS Safari in browser mode we show a different
// message pointing at the install flow instead of the Enable button
// that would silently fail.

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { usePush } from '@/lib/use-push';

const DISMISS_KEY = 'gg-push-banner-dismissed-until';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iP(ad|hone|od)/.test(navigator.userAgent);
}

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

function markDismissed() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      DISMISS_KEY,
      String(Date.now() + DISMISS_MS),
    );
  } catch {
    /* ignore */
  }
}

export function PushOptInBanner() {
  const { isSignedIn } = useUser();
  const push = usePush();
  const [dismissed, setDismissed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(isDismissed());
  }, []);

  // Hide entirely under any of these conditions.
  if (!isSignedIn) return null;
  if (!push.ready) return null;
  if (!push.vapidReady) return null;
  if (push.enabled) return null;
  if (dismissed) return null;
  if (push.permission === 'denied') return null;

  // iOS-in-browser → can't enable here; show install hint instead.
  const iosInBrowser = isIos() && !push.standalone;
  if (iosInBrowser) {
    return (
      <div
        role="region"
        aria-label="Install hint"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          marginBottom: 14,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border-hover)',
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{ flex: 1 }}>
          Install Gun Galore to your home screen first, then enable
          push notifications from this page.
        </span>
        <button
          type="button"
          onClick={() => {
            markDismissed();
            setDismissed(true);
          }}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 18,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
    );
  }

  if (!push.supported) return null;

  async function onEnable() {
    setHint(null);
    const ok = await push.enable();
    if (!ok) {
      // Either permission denied or backend failed. Permission state
      // already updated in the hook. Surface a friendlier reason.
      if (push.permission === 'denied') {
        setHint(
          "You'll need to enable notifications in your browser settings — they were blocked.",
        );
      } else {
        setHint("Couldn't enable push right now. Try again in a moment.");
      }
    }
  }

  return (
    <div
      role="region"
      aria-label="Push notifications"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 14,
        borderRadius: 10,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--red)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'rgba(200,16,46,0.18)',
          color: 'var(--red)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 9a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 14V9z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M10 19a2 2 0 0 0 4 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text-primary)',
          }}
        >
          Get notified instantly
        </p>
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.4,
          }}
        >
          {hint ??
            'New offers, outbids and sales reach you the moment they happen.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onEnable}
        disabled={push.busy}
        style={{
          padding: '8px 14px',
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: push.busy ? 'wait' : 'pointer',
          flexShrink: 0,
        }}
      >
        {push.busy ? 'Enabling…' : 'Enable'}
      </button>
      <button
        type="button"
        onClick={() => {
          markDismissed();
          setDismissed(true);
        }}
        aria-label="Dismiss for 14 days"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          padding: '4px 8px',
          marginLeft: -4,
        }}
      >
        ×
      </button>
    </div>
  );
}

// Compact toggle for the More sheet under "My account". Uses the
// same hook so state stays in sync with the banner. Renders nothing
// (saves a row) when the conditions for showing the toggle aren't
// met (no VAPID, not signed in, not supported).
export function PushToggleRow() {
  const { isSignedIn } = useUser();
  const push = usePush();

  if (!isSignedIn) return null;
  if (!push.ready) return null;
  if (!push.vapidReady) return null;
  if (!push.supported) return null;

  const iosInBrowser = isIos() && !push.standalone;
  if (iosInBrowser) return null; // covered by banner on /notifications

  const onClick = () => {
    if (push.busy) return;
    if (push.enabled) void push.disable();
    else void push.enable();
  };

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={push.busy}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '13px 20px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 14,
          textAlign: 'left',
          cursor: push.busy ? 'wait' : 'pointer',
        }}
      >
        <span>Push notifications</span>
        <span
          style={{
            fontSize: 12,
            color: push.enabled ? 'var(--success, #2f9e6b)' : 'var(--text-tertiary)',
            fontWeight: push.enabled ? 600 : 400,
          }}
        >
          {push.busy ? '…' : push.enabled ? 'Enabled' : 'Off'}
        </span>
      </button>
    </li>
  );
}
