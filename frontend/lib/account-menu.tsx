'use client';

import Link from 'next/link';
import {
  ACCOUNT_GROUPS,
  LogoutIcon,
  type AccountMenuGroup,
  type AccountMenuItem,
} from './account-menu-data';

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
