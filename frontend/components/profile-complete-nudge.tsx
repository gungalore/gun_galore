'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth, useUser } from '../lib/auth';
import { Me } from '@/lib/types';
import { isChromelessRoute } from '@/lib/chromeless-routes';
import { isTabRoute } from '@/lib/shell-routes';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Small persistent reminder bubble, bottom-left, for a signed-in member whose
// profile isn't 100% complete yet.
//
// Distinct from ProfileSetupPrompt (a one-time full-screen welcome dialog,
// only for accounts created in the last 14 days, shown once ever per
// browser): this one has no signup-age limit and keeps coming back — closed
// with the ✕ it hides for the rest of THIS browser session only
// (sessionStorage, not localStorage), so the next visit shows it again for
// as long as the profile stays incomplete. That's the gap the nav's
// AvatarCompletionRing and the one-time welcome dialog don't cover: a
// returning member past their first two weeks currently gets no reminder
// beyond a small ring around their avatar.
const SESSION_DISMISS_PREFIX = 'gg-profile-nudge-dismissed-';

// Same spirit as ProfileSetupPrompt's exclusion list — never nag on an auth
// screen, the KYC wizard, the profile editor itself, checkout, or admin.
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

function dismissedThisSession(userId: string): boolean {
  try {
    return (
      window.sessionStorage.getItem(`${SESSION_DISMISS_PREFIX}${userId}`) === '1'
    );
  } catch {
    return false;
  }
}

function markDismissedThisSession(userId: string) {
  try {
    window.sessionStorage.setItem(`${SESSION_DISMISS_PREFIX}${userId}`, '1');
  } catch {
    /* private mode / quota — worst case it re-shows on the next render */
  }
}

export function ProfileCompleteNudge() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume hidden until checked
  const [entered, setEntered] = useState(false);

  const userId = user?.id ?? null;

  // Same lightweight /users/me fetch the nav ring and welcome dialog use.
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
        /* silent — no nudge */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    if (!userId) return;
    setDismissed(dismissedThisSession(userId));
  }, [userId]);

  // Entry transition once we know it should actually show.
  useEffect(() => {
    if (dismissed) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [dismissed]);

  if (!isLoaded || !isSignedIn || !me || !userId) return null;
  if (me.profileCompleteness.percent >= 100) return null;
  if (dismissed) return null;
  if (isChromelessRoute(pathname)) return null;
  if (EXCLUDED_PREFIXES.some((p) => pathname?.startsWith(p))) return null;

  const percent = me.profileCompleteness.percent;
  // Sit clear of the mobile tab bar when this route carries one — same offset
  // math the install bar uses (the min() clamp guards against Chrome-for-iOS
  // over-reporting the safe-area inset).
  const tabBarPresent = isTabRoute(pathname);

  function close() {
    markDismissedThisSession(userId as string);
    setDismissed(true);
  }

  function goComplete() {
    // ⚠️ NO session-dismiss here, unlike close(). Clicking through hides this
    // on /profile/edit via EXCLUDED_PREFIXES already; if they navigate away
    // without actually finishing, the reminder should come back rather than
    // silently staying suppressed for the rest of the session because they
    // once clicked its own button.
    router.push('/profile/edit');
  }

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 'max(12px, env(safe-area-inset-left))',
        bottom: tabBarPresent
          ? 'calc(var(--shell-tab-h) + min(env(safe-area-inset-bottom), 34px) + 12px)'
          : 'max(12px, env(safe-area-inset-bottom))',
        zIndex: 52,
        width: 'min(300px, calc(100vw - 24px))',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 14,
        padding: '14px 16px',
        transform: entered ? 'translateY(0)' : 'translateY(12px)',
        opacity: entered ? 1 : 0,
        transition: 'transform 220ms ease, opacity 220ms ease',
      }}
    >
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 22,
          height: 22,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          lineHeight: 1,
          cursor: 'pointer',
          borderRadius: 6,
        }}
      >
        ✕
      </button>
      <p
        style={{
          margin: '0 20px 10px 0',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text-primary)',
          lineHeight: 1.4,
        }}
      >
        Profile {percent}% complete
      </p>
      <button
        type="button"
        onClick={goComplete}
        style={{
          width: '100%',
          padding: '9px 12px',
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Get fully verified here
      </button>
    </div>
  );
}
