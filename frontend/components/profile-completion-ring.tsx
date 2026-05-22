'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Me } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Ambient profile-completion indicator that lives in the nav next to
// the user chip. Shows a small circular percent ring; hovering pops a
// checklist of missing sections, each a deep link to the right place
// on /profile/edit. Hides itself entirely at 100% so the nav stays
// clean once the seller is set up.
//
// House philosophy: never blocking, never modal, never popup. This
// indicator is just "always visible, gently nagging" so the seller has
// agency over when to finish setup. JIT modals on Buy / Sell / Offer
// catch them at the moment of intent (handled elsewhere).

// Lookup table from `missing` keys to human-readable + deep-link.
const MISSING_LABEL: Record<
  'name' | 'phone' | 'address',
  { label: string; href: string; helper: string }
> = {
  name: {
    label: 'Your name',
    href: '/profile/edit',
    helper: 'Required for legal sale records.',
  },
  phone: {
    label: 'Verified phone number',
    href: '/profile/edit',
    helper: 'Buyers + couriers need to reach you. We send a one-time code.',
  },
  address: {
    label: 'Pickup / delivery address',
    href: '/profile/edit',
    helper: 'So we can find your nearest Pudo locker + quote shipping.',
  },
};

// Sizes (px). Tweak these together to scale the whole ring.
const SIZE = 28;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProfileCompletionRing() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
        // Non-fatal — ring just doesn't render, nav stays as-is.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  // Outside-click to close the tooltip dropdown.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (!isLoaded || !isSignedIn || !me) return null;
  const { percent, missing } = me.profileCompleteness;
  // Disappear at 100% — no reason to clutter the nav for fully set-up users.
  if (percent >= 100) return null;

  // SVG stroke-dashoffset trick for the progress arc.
  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  // Tint ramps from red (0%) through amber (50%) to green (100%).
  const stroke =
    percent >= 67
      ? 'var(--red)' // close to done — still our brand red, not green; green looks "done"
      : percent >= 34
        ? '#f59e0b'
        : 'var(--red)';

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Profile ${percent}% complete — click to finish setup`}
        title={`Profile ${percent}% complete`}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width={SIZE} height={SIZE} aria-hidden>
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
          <text
            x="50%"
            y="50%"
            dy="0.35em"
            textAnchor="middle"
            fontSize="9"
            fontWeight={500}
            fill="var(--text-primary)"
          >
            {percent}
          </text>
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 60,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            padding: 14,
            width: 280,
          }}
        >
          <p
            className="text-xs uppercase mb-2"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.08em',
              fontWeight: 500,
            }}
          >
            Finish setup &mdash; {percent}%
          </p>
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            A complete profile means one-click checkout and faster KYC when
            your first sale lands.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {missing.map((key) => {
              const item = MISSING_LABEL[key];
              return (
                <li key={key} style={{ marginBottom: 8 }}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    style={{
                      display: 'block',
                      padding: '8px 10px',
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                      borderRadius: 6,
                      textDecoration: 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--text-primary)',
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{ color: 'var(--red)', fontSize: 12 }}
                        aria-hidden
                      >
                        &rarr;
                      </span>
                    </div>
                    <div
                      style={{
                        color: 'var(--text-tertiary)',
                        fontSize: 11,
                        marginTop: 2,
                        lineHeight: 1.4,
                      }}
                    >
                      {item.helper}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
