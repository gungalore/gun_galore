'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';

// 35px strip that sits directly under the 56px Nav. Reserved area
// for "you need to act on this NOW" prompts — pending payment,
// auction win awaiting payment, sale needs dispatch, etc.
//
// Layout:
//   [ URGENT NOTIFICATIONS ]  · pill · pill · pill ...
//
// Self-fetches from /api/users/me/urgent every 60s so the strip
// stays fresh without page reloads (e.g., seller dispatches → the
// "N sales need dispatch" pill drops one within a minute).
//
// Sits below the nav at top:56 so it sticks while the page scrolls.
// When KycBanner is also showing (rare — only for unverified sellers
// with a pending sale), they may visually compete; we accept that
// for now since both are critical-action surfaces.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface UrgentNotification {
  id: string;
  label: string;
  href?: string;
  severity?: 'info' | 'warning' | 'critical';
}

export function UrgentNotifications() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [notifications, setNotifications] = useState<UrgentNotification[]>([]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/users/me/urgent`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { notifications: UrgentNotification[] };
        if (!cancelled) setNotifications(data.notifications ?? []);
      } catch {
        // Decorative — keep the last snapshot on network blip.
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isLoaded, isSignedIn, getToken]);

  // Hide entire strip for signed-out users — nothing to notify about.
  if (!isLoaded || !isSignedIn) return null;

  return (
    <div
      role="region"
      aria-label="Urgent notifications"
      style={{
        position: 'sticky',
        top: 56,
        zIndex: 49,
        height: 35,
        background: 'var(--bg-deep)',
        borderBottom: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 16,
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--red)',
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        Urgent Notifications
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
      >
        {notifications.length === 0 ? (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
            }}
          >
            All clear
          </span>
        ) : (
          notifications.map((n) => <NotificationPill key={n.id} n={n} />)
        )}
      </div>
    </div>
  );
}

function NotificationPill({ n }: { n: UrgentNotification }) {
  const palette = {
    info: {
      bg: 'rgba(110, 168, 254, 0.14)',
      fg: '#6ea8fe',
      border: 'rgba(110, 168, 254, 0.35)',
    },
    warning: {
      bg: 'rgba(245, 158, 11, 0.14)',
      fg: '#f59e0b',
      border: 'rgba(245, 158, 11, 0.35)',
    },
    critical: {
      bg: 'rgba(200, 16, 46, 0.16)',
      fg: 'var(--red)',
      border: 'rgba(200, 16, 46, 0.45)',
    },
  };
  const c = palette[n.severity ?? 'critical'];

  const pill = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 11px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        border: `0.5px solid ${c.border}`,
        fontSize: 11.5,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        textDecoration: 'none',
        lineHeight: 1,
      }}
    >
      {n.label}
    </span>
  );

  return n.href ? (
    <Link href={n.href} style={{ textDecoration: 'none' }}>
      {pill}
    </Link>
  ) : (
    pill
  );
}
