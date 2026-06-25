'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

// Nav notification bell — replaces the old always-on sticky "Urgent
// Notifications" strip. A bell sits in the top nav (desktop + mobile-web;
// the installed-PWA bottom tab bar has its own bell). A red count badge
// shows ONLY when there are must-act items, so it costs zero content space
// the rest of the time. Clicking opens a dropdown listing the items, with
// a link through to the full /notifications page.
//
// Fetches the same /api/users/me/urgent feed the strip used, every 60s.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface UrgentNotification {
  id: string;
  label: string;
  href?: string;
  severity?: 'info' | 'warning' | 'critical';
}

const SEV_COLOR: Record<NonNullable<UrgentNotification['severity']>, string> = {
  info: '#6ea8fe',
  warning: '#f59e0b',
  critical: 'var(--red)',
};

export function UrgentBell() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [items, setItems] = useState<UrgentNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

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
        if (!cancelled) setItems(data.notifications ?? []);
      } catch {
        // Decorative — keep the last snapshot on a network blip.
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isLoaded, isSignedIn, getToken]);

  // Close the dropdown on outside-click + Escape + route change.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!isLoaded || !isSignedIn) return null;
  const count = items.length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          count > 0
            ? `${count} urgent notification${count === 1 ? '' : 's'}`
            : 'Notifications'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative p-2 rounded-[6px]"
        style={{
          color: count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
          border: '0.5px solid var(--border)',
          lineHeight: 0,
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 999,
              background: 'var(--red)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: '16px',
              textAlign: 'center',
              border: '1.5px solid var(--bg-deep)',
            }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 rounded-[8px] py-1 z-50"
          style={{
            width: 300,
            maxWidth: '90vw',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
          role="menu"
        >
          <div
            className="px-3 py-2 text-xs uppercase"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.08em',
              borderBottom: '0.5px solid var(--border)',
            }}
          >
            Urgent
          </div>

          {count === 0 ? (
            <div
              className="px-3 py-4 text-sm"
              style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}
            >
              All clear — nothing needs your attention.
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {items.map((n) => {
                const dot = SEV_COLOR[n.severity ?? 'critical'];
                const row = (
                  <span
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm"
                    style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        background: dot,
                        flexShrink: 0,
                      }}
                    />
                    <span>{n.label}</span>
                  </span>
                );
                return n.href ? (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="block transition-opacity hover:opacity-80"
                    style={{ textDecoration: 'none' }}
                    role="menuitem"
                  >
                    {row}
                  </Link>
                ) : (
                  <div key={n.id} role="menuitem">
                    {row}
                  </div>
                );
              })}
            </div>
          )}

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm transition-opacity hover:opacity-80"
            style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              borderTop: '0.5px solid var(--border)',
            }}
            role="menuitem"
          >
            View all notifications →
          </Link>
        </div>
      )}
    </div>
  );
}
