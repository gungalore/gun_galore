'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { Me } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Dashboard header identity block: greets the user by name and — while the
// profile isn't finished — shows a clickable completeness bar that opens
// the unified profile form (/profile/edit, "every part that has to be
// filled out"). The percent comes from the profileCompleteness that GET
// /users/me computes (buyer = name/phone/address; seller adds banking/
// identity/verification). Hides the bar at 100%.
//
// Self-fetches /users/me CLIENT-side (same pattern as the nav
// ProfileCompletionRing) because the dashboard's SERVER-side fetches to
// the backend come back empty for authed users, whereas the browser's own
// token call works fine.
function fillColour(p: number): string {
  if (p >= 67) return '#22c55e';
  if (p >= 34) return '#f59e0b';
  return 'var(--red)';
}

export function DashboardProfileProgress() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [me, setMe] = useState<Me | null>(null);

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
        const text = await res.text();
        const data = text ? (JSON.parse(text) as Me) : null;
        if (!cancelled && data) setMe(data);
      } catch {
        // Non-fatal — header just falls back to "My Dashboard".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  const name = me?.firstName?.trim() || me?.username || null;
  const percent = me?.profileCompleteness?.percent ?? 0;
  const missingCount = me?.profileCompleteness?.missing?.length ?? 0;

  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <h1
        className="text-xl font-medium"
        style={{ color: 'var(--text-primary)', margin: 0 }}
      >
        {name ? `Hi, ${name}` : 'My Dashboard'}
      </h1>

      {me && percent < 100 ? (
        <Link
          href="/profile/edit"
          aria-label={`Profile ${percent}% complete — click to finish setting up`}
          style={{
            display: 'block',
            textDecoration: 'none',
            marginTop: 10,
            maxWidth: 440,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 5,
            }}
          >
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Complete your profile
              {missingCount
                ? ` — ${missingCount} thing${missingCount === 1 ? '' : 's'} left`
                : ''}
            </span>
            <span
              className="text-xs"
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {percent}% →
            </span>
          </div>
          <div
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
                width: `${Math.max(3, percent)}%`,
                background: fillColour(percent),
                borderRadius: 999,
                transition: 'width 0.3s',
              }}
            />
          </div>
        </Link>
      ) : me && percent >= 100 ? (
        <p className="text-xs" style={{ color: '#22c55e', marginTop: 6 }}>
          Profile complete ✓
        </p>
      ) : null}
    </div>
  );
}
