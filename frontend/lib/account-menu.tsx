'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  ACCOUNT_GROUPS,
  LogoutIcon,
  type AccountMenuGroup,
  type AccountMenuItem,
} from './account-menu-data';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Client renderer for the buyer/seller account menu.
//
// Every account surface — the desktop "Account ▾" dropdown and the mobile
// hamburger drawer (both in nav.tsx) and the installed-PWA "More" sheet (in
// bottom-tab-bar.tsx) — renders from ACCOUNT_GROUPS via <AccountMenuList/>.
// Before this they each hard-coded their own copy of the link list, which is
// why they drifted (different order, labels, casing). Keeping the data in one
// place (account-menu-data.tsx) means they physically can't drift again.
//
// The data/icons/types live in ./account-menu-data (NO 'use client'), so a
// Server Component (e.g. the /account hub) can import ACCOUNT_GROUPS directly
// from there and .map() the real array. Importing that value through this
// 'use client' module would hand the server a client-reference proxy instead
// (→ "ACCOUNT_GROUPS.map is not a function"). Re-exported below only for the
// CLIENT surfaces (nav / bottom-tab-bar), where a client reference is fine.
export {
  ACCOUNT_GROUPS,
  LogoutIcon,
  type AccountMenuGroup,
  type AccountMenuItem,
};

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  return pathname.startsWith(href + '/');
}

// Per-module unresolved-notification count badge — an iOS-app-icon-style
// red pill. Shows the number (capped "9+"). Nothing renders at 0.
function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread`}
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        borderRadius: 9,
        background: 'var(--red)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '18px',
        textAlign: 'center',
        flexShrink: 0,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

// ── Shared renderer used by all three surfaces ───────────────────────
export function AccountMenuList({
  pathname,
  onNavigate,
  showChevron = false,
  compact = false,
}: {
  pathname: string | null;
  onNavigate?: () => void;
  showChevron?: boolean;
  compact?: boolean;
}) {
  const rowPad = compact ? '8px 12px' : '11px 16px';
  const headPad = compact ? '10px 12px 4px' : '14px 16px 6px';
  const fontSize = compact ? 13 : 15;

  // Per-module unresolved counts, keyed by menu href. Fetched once when the
  // menu opens (this component only mounts then) — the badges reflect the
  // same "action needed" rows the bell counts. Fails silent (empty = no
  // badges) so the menu always renders.
  const { getToken } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`${API_URL}/notifications/me/module-counts`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return;
        const data = (await r.json()) as Record<string, number>;
        if (!cancelled) setCounts(data ?? {});
      } catch {
        /* network blip — leave badges empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <>
      {ACCOUNT_GROUPS.map((group, gi) => (
        <div key={group.title}>
          <p
            style={{
              margin: 0,
              padding: headPad,
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-tertiary)',
              borderTop: gi === 0 ? undefined : '0.5px solid var(--border)',
            }}
          >
            {group.title}
          </p>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: rowPad,
                  fontSize,
                  textDecoration: 'none',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  background: active ? 'rgba(200,16,46,0.14)' : 'transparent',
                  borderLeft: active
                    ? '2px solid var(--red)'
                    : '2px solid transparent',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    color: active ? 'var(--red)' : 'var(--text-tertiary)',
                    flexShrink: 0,
                  }}
                >
                  <item.Icon />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
                <CountBadge count={counts[item.href] ?? 0} />
                {showChevron && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
