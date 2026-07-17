'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Me } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// A thin circular profile-completeness ring that HUGS the account avatar
// in the nav. It wraps the avatar (passed as children) and draws an arc
// around it. Purely visual — pointer-events:none — so the account button
// underneath still opens the menu on click. Disappears entirely at 100%
// so a fully set-up user just sees a clean avatar.
//
// The wrapper keeps a FIXED size whether or not the arc is drawn, so the
// ring appearing/disappearing never shifts the nav layout (no CLS). This
// replaces the older standalone ProfileCompletionRing chip so the ring now
// reads as part of the account tag itself.

const SIZE = 34; // ring box; the avatar is 28, so the arc sits just outside it
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function AvatarCompletionRing({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [percent, setPercent] = useState<number | null>(null);

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
        // Guard the empty-body case (a 200 with no body → JSON parse throw)
        // that a brand-new account can return before it's synced.
        const text = await res.text();
        const data = text ? (JSON.parse(text) as Me) : null;
        if (!cancelled && data?.profileCompleteness) {
          setPercent(data.profileCompleteness.percent);
        }
      } catch {
        // Non-fatal — no ring, the avatar just renders on its own.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  // Draw the arc only once we know the profile is incomplete. Before the
  // fetch resolves, when signed out, or at 100%, we render just the avatar
  // in the same fixed-size box — so nothing ever reflows.
  const showRing = percent !== null && percent < 100;
  const offset = showRing ? CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE : 0;
  // Tint: amber in the middle band, brand red otherwise (green would read
  // as "done" — matches the retired ProfileCompletionRing ramp).
  const stroke = percent !== null && percent >= 34 && percent < 67 ? '#f59e0b' : 'var(--red)';

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: SIZE,
        height: SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      title={showRing ? `Profile ${percent}% complete` : undefined}
    >
      {children}
      {showRing && (
        <svg
          width={SIZE}
          height={SIZE}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="var(--border)"
            strokeWidth={STROKE}
            fill="none"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={stroke}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: 'stroke-dashoffset 280ms ease' }}
          />
        </svg>
      )}
    </span>
  );
}
