'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { Me } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// One-time post-signup "finish setting up your profile" welcome dialog.
//
// Philosophy: this is a WELCOME, not a nag. The persistent nav ring
// (ProfileCompletionRing) and the /profile segment bar
// (SellerVerificationProgress) already gently nudge forever. This dialog
// only greets a freshly-created account once, shows how far along they
// are (progress bar off the same `profileCompleteness.percent` the
// backend already computes in GET /users/me), and points them at
// /profile/edit. It is fully dismissible (×, "Maybe later", backdrop,
// Esc) — never a wall like the create-listing ProfileCompletionModal.
//
// Self-gating (mounted once in app/layout.tsx, renders null unless there
// is genuinely something to show):
//   - signed in AND /users/me loaded
//   - profile < 100% complete
//   - account created recently (a real new signup, not a returning user)
//   - not snoozed (per-user "Maybe later" window)
//   - not on an auth / KYC / create-listing / profile-edit / admin route
//   - at most once per browser session (so it doesn't re-pop on every
//     client navigation)

// Per-user snooze after any dismissal. Absolute-timestamp in localStorage,
// keyed by Clerk user id, re-arms after the window — the exact convention
// used by markProfileFinishLater / install-prompt / push-first-launch.
const SNOOZE_KEY_PREFIX = 'gg-profile-setup-until-';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Per-session "already shown" guard so a single session only auto-opens it
// once even as the user navigates around.
const SESSION_KEY_PREFIX = 'gg-profile-setup-shown-';
// Only greet accounts created within this window — beyond it, a user is
// "returning" and the persistent ring/bar are enough.
const NEW_SIGNUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Routes where the dialog must never appear: auth flows, the KYC wizard,
// the create-listing surface (which owns its own hard-wall completion
// modal), the profile editor itself, and all of /admin.
const EXCLUDED_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/sso-callback',
  '/kyc',
  '/listings/new',
  '/profile/edit',
  '/admin',
  '/checkout',
];

// Compact human labels for the `missing` keys (subset shown in the dialog).
// Defensive Partial<> — an unknown key added server-side before this
// bundle redeploys must never crash the dialog.
const MISSING_LABEL: Partial<Record<string, string>> = {
  name: 'Your name',
  phone: 'A verified phone number',
  address: 'Your delivery / pickup address',
  banking: 'Banking details (refunds & payouts)',
  identity: 'Your SA ID & date of birth',
  verification: 'Identity verification',
};

function snoozeActive(userId: string): boolean {
  try {
    const raw = window.localStorage.getItem(`${SNOOZE_KEY_PREFIX}${userId}`);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    if (!Number.isFinite(until)) return false;
    if (Date.now() < until) return true;
    window.localStorage.removeItem(`${SNOOZE_KEY_PREFIX}${userId}`); // expired
    return false;
  } catch {
    return false;
  }
}

function markSnoozed(userId: string) {
  try {
    window.localStorage.setItem(
      `${SNOOZE_KEY_PREFIX}${userId}`,
      String(Date.now() + SNOOZE_MS),
    );
  } catch {
    /* private mode / quota — silent */
  }
}

function shownThisSession(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(`${SESSION_KEY_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

function markShownThisSession(userId: string) {
  try {
    window.sessionStorage.setItem(`${SESSION_KEY_PREFIX}${userId}`, '1');
  } catch {
    /* silent */
  }
}

// Progress-bar fill colour ramps red → amber → green as the profile fills,
// so the bar reads as genuine forward progress (green = nearly there).
function fillColour(percent: number): string {
  if (percent >= 67) return '#22c55e';
  if (percent >= 34) return '#f59e0b';
  return 'var(--red)';
}

export function ProfileSetupPrompt() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const userId = user?.id ?? null;

  // Fetch /users/me once signed in (same lightweight pattern as the nav
  // ring). Non-fatal on error — the dialog just never shows.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as Me | null;
        if (!cancelled && data) setMe(data);
      } catch {
        /* silent — no dialog */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  // Decide whether to auto-open. Runs whenever inputs change; opens at most
  // once per session and only when every gate passes.
  useEffect(() => {
    if (open) return;
    if (!isLoaded || !isSignedIn || !me || !userId) return;
    if (me.profileCompleteness.percent >= 100) return;
    if (EXCLUDED_PREFIXES.some((p) => pathname?.startsWith(p))) return;

    // Only greet genuinely new accounts.
    const createdAt = user?.createdAt ? user.createdAt.getTime() : null;
    if (createdAt == null || Date.now() - createdAt > NEW_SIGNUP_WINDOW_MS) {
      return;
    }
    if (snoozeActive(userId)) return;
    if (shownThisSession(userId)) return;

    markShownThisSession(userId);
    setOpen(true);
  }, [open, isLoaded, isSignedIn, me, userId, pathname, user]);

  // Entry transition + body scroll lock + Esc-to-dismiss while open.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = useCallback(() => {
    if (userId) markSnoozed(userId);
    setEntered(false);
    setOpen(false);
  }, [userId]);

  const dismiss = useCallback(() => {
    close();
  }, [close]);

  const goComplete = useCallback(() => {
    close();
    router.push('/profile/edit');
  }, [close, router]);

  if (!open || !me) return null;

  const { percent, missing } = me.profileCompleteness;
  const topMissing = missing
    .map((k) => MISSING_LABEL[k])
    .filter((v): v is string => !!v)
    .slice(0, 3);
  const firstName = me.firstName?.trim();

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        // Backdrop click (not a click inside the card) dismisses.
        if (e.target === e.currentTarget) dismiss();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
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
        aria-labelledby="gg-profile-setup-title"
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          padding: 24,
          outline: 'none',
          transform: entered ? 'translateY(0)' : 'translateY(10px)',
          opacity: entered ? 1 : 0,
          transition: 'transform 220ms ease, opacity 220ms ease',
        }}
      >
        {/* Close (×) */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            width: 30,
            height: 30,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ✕
        </button>

        <p
          className="text-xs uppercase"
          style={{
            color: 'var(--red)',
            letterSpacing: '0.08em',
            fontWeight: 600,
            margin: 0,
          }}
        >
          Welcome to Gun Galore
        </p>
        <h2
          id="gg-profile-setup-title"
          style={{
            color: 'var(--text-primary)',
            fontSize: 20,
            fontWeight: 600,
            margin: '6px 0 6px',
            letterSpacing: '-0.01em',
          }}
        >
          {firstName ? `Let's finish your profile, ${firstName}` : "Let's finish your profile"}
        </h2>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          A complete profile means faster checkout, and everything's ready the
          moment you buy or sell. It only takes a minute.
        </p>

        {/* Progress bar */}
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 6,
            }}
          >
            <span
              className="text-xs uppercase"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.06em',
                fontWeight: 600,
              }}
            >
              Profile completeness
            </span>
            <span
              style={{
                color: 'var(--text-primary)',
                fontSize: 15,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {percent}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Profile ${percent}% complete`}
            style={{
              height: 8,
              borderRadius: 999,
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.max(2, percent)}%`,
                background: fillColour(percent),
                borderRadius: 999,
                transition: 'width 320ms ease',
              }}
            />
          </div>
        </div>

        {/* What's left */}
        {topMissing.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p
              className="text-xs"
              style={{
                color: 'var(--text-tertiary)',
                margin: '0 0 8px',
              }}
            >
              Still to add:
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {topMissing.map((label) => (
                <li
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                    padding: '4px 0',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--red)',
                      flexShrink: 0,
                    }}
                  />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 22,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={goComplete}
            style={{
              flex: 1,
              minWidth: 160,
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '11px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Complete my profile →
          </button>
          <button
            type="button"
            onClick={dismiss}
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              borderRadius: 9,
              padding: '11px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
