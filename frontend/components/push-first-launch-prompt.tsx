'use client';

// PushFirstLaunchPrompt — friendly card asking for push permission
// the first time a signed-in user opens the installed PWA.
//
// Matches the iOS/Android-native pattern (every native app asks for
// notifications shortly after install). Without this, users have to
// discover the opt-in banner on /notifications themselves, which most
// won't.
//
// Conditions to render (all must be true):
//   - Installed PWA (standalone mode) — browser-tab users get the
//     less-aggressive /notifications banner instead
//   - Signed in
//   - Push is supported in this browser
//   - Backend has VAPID configured
//   - User isn't already subscribed
//   - User hasn't dismissed within the snooze window (30 days)
//   - The state probe has finished (avoid flashing the prompt
//     during the initial fetch)
//
// Surfacing:
//   - Bottom-sheet card (matches the rest of the PWA chrome), 600ms
//     entrance delay so the page settles first (no in-your-face).
//
// Snooze: "Not now" sets a 30-day localStorage flag. "Enable" calls
// push.enable() — if granted, the prompt hides; if denied, the
// prompt hides AND we never ask again on this device (browser-level
// denial is sticky anyway).

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { usePush } from '@/lib/use-push';

const DISMISS_KEY = 'gg-push-firstlaunch-dismissed-until';
const ASKED_KEY = 'gg-push-firstlaunch-asked';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

function markDismissed(forever = false) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      DISMISS_KEY,
      String(forever ? Date.now() + 10 * 365 * 24 * 60 * 60 * 1000 : Date.now() + DISMISS_MS),
    );
    window.localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function PushFirstLaunchPrompt() {
  const { isSignedIn, isLoaded } = useUser();
  const push = usePush();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // Decide whether to show, with a 600 ms entrance delay so the
  // homepage hero/cards land first. Re-runs when sign-in / push
  // state changes.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) return;
    if (!push.ready) return;
    if (!push.supported) return;
    if (!push.vapidReady) return;
    if (!push.standalone) return; // browser-tab users → /notifications banner only
    if (push.enabled) return;
    if (push.permission === 'denied') return;
    if (isDismissed()) {
      setDismissed(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), 600);
    return () => window.clearTimeout(t);
  }, [
    isLoaded,
    isSignedIn,
    push.ready,
    push.supported,
    push.vapidReady,
    push.standalone,
    push.enabled,
    push.permission,
  ]);

  if (dismissed || !visible) return null;

  async function onEnable() {
    setHint(null);
    const ok = await push.enable();
    if (ok) {
      // Mark asked-forever so we never show this again — they've
      // either succeeded or the browser already remembers the
      // permission state.
      markDismissed(true);
      setVisible(false);
      return;
    }
    // Permission denied or backend failed.
    if (push.permission === 'denied') {
      // Sticky in the browser — never ask again.
      markDismissed(true);
      setVisible(false);
    } else {
      setHint("Couldn't enable right now — try again from the bell tab.");
    }
  }

  function onSnooze() {
    markDismissed(false);
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Enable push notifications"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        // Sit above the bottom tab bar (60 px tall + safe-area).
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        zIndex: 70,
        padding: 16,
        borderRadius: 14,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--red)',
        animation: 'gg-push-prompt-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
    >
      <style>{`
        @keyframes gg-push-prompt-up {
          from { transform: translateY(140%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(200,16,46,0.18)',
            color: 'var(--red)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
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
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Turn on notifications?
          </p>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.45,
            }}
          >
            {hint ??
              "We'll ping you when an auction you're in gets outbid, an offer lands, or a sale needs dispatching. Nothing else."}
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 14,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={onEnable}
          disabled={push.busy}
          style={{
            flex: 1,
            minWidth: 140,
            padding: '11px 14px',
            background: 'var(--red)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: push.busy ? 'wait' : 'pointer',
          }}
        >
          {push.busy ? 'Enabling…' : 'Turn on'}
        </button>
        <button
          type="button"
          onClick={onSnooze}
          style={{
            flex: 1,
            minWidth: 120,
            padding: '11px 14px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border-hover)',
            borderRadius: 8,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
