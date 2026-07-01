'use client';

import Link from 'next/link';
import type { FC, ReactNode } from 'react';

// SINGLE SOURCE OF TRUTH for the buyer/seller account menu.
//
// Every account surface — the desktop "Account ▾" dropdown and the mobile
// hamburger drawer (both in nav.tsx) and the installed-PWA "More" sheet (in
// bottom-tab-bar.tsx) — renders from ACCOUNT_GROUPS via <AccountMenuList/>.
// Before this they each hard-coded their own copy of the link list, which is
// why they drifted (different order, labels, casing). Keeping the data here
// means they physically can't drift again.

type IconC = FC;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

// ── Icons (24×24, currentColor stroke — inherit row colour) ──────────
const OrdersIcon: IconC = () => (
  <Svg>
    <path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2L12 3z" />
    <path d="M12 12l8-4.2M12 12v9M12 12L4 7.2" />
  </Svg>
);
const TagIcon: IconC = () => (
  <Svg>
    <path d="M4 4h7l9 9-7 7-9-9V4z" />
    <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);
const GavelIcon: IconC = () => (
  <Svg>
    <path d="M14 4l6 6m-3-3l-7 7m-4-4l5 5m-5-5l-3 3 4 4 3-3m9-13l3 3" />
    <path d="M4 20h12" />
  </Svg>
);
const HeartIcon: IconC = () => (
  <Svg>
    <path d="M12 21C7 17 4 13.5 4 10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 3.5-3 7-8 11z" />
  </Svg>
);
const StoreIcon: IconC = () => (
  <Svg>
    <path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" />
    <path d="M3 10l2-5h14l2 5z" />
    <path d="M3 10h18" />
  </Svg>
);
const ReceiptIcon: IconC = () => (
  <Svg>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);
const InboxIcon: IconC = () => (
  <Svg>
    <path d="M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6z" />
    <path d="M4 13h5l1 2h4l1-2h5" />
  </Svg>
);
const TicketIcon: IconC = () => (
  <Svg>
    <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
    <path d="M14 6.5v11" strokeDasharray="1.5 2" />
  </Svg>
);
const TrophyIcon: IconC = () => (
  <Svg>
    <path d="M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H5a2 2 0 0 0 2 2m10-2h2a2 2 0 0 1-2 2M10 16h4l1 4H9l1-4z" />
  </Svg>
);
const DashboardIcon: IconC = () => (
  <Svg>
    <path d="M4 4h7v9H4zM4 15h7v5H4zM13 4h7v5h-7zM13 11h7v9h-7z" />
  </Svg>
);
const UserIcon: IconC = () => (
  <Svg>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
  </Svg>
);
const SettingsIcon: IconC = () => (
  <Svg>
    <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h13M20 17h0" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="18.5" cy="17" r="2" />
  </Svg>
);
const BellIcon: IconC = () => (
  <Svg>
    <path d="M6 9a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 14V9z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Svg>
);
export const LogoutIcon: IconC = () => (
  <Svg>
    <path d="M15 12H4M11 8l-4 4 4 4M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
  </Svg>
);

// ── Structure ────────────────────────────────────────────────────────
export interface AccountMenuItem {
  href: string;
  label: string;
  Icon: IconC;
}
export interface AccountMenuGroup {
  title: string;
  items: AccountMenuItem[];
}

export const ACCOUNT_GROUPS: AccountMenuGroup[] = [
  {
    title: 'Buying',
    items: [
      { href: '/my/orders', label: 'Orders', Icon: OrdersIcon },
      { href: '/my/offers', label: 'Offers made', Icon: TagIcon },
      { href: '/my/bids', label: 'Bids', Icon: GavelIcon },
      { href: '/wishlist', label: 'Wishlist', Icon: HeartIcon },
    ],
  },
  {
    title: 'Selling',
    items: [
      { href: '/my/listings', label: 'Listings', Icon: StoreIcon },
      { href: '/my/sales', label: 'Sales', Icon: ReceiptIcon },
      { href: '/offers/received', label: 'Offers received', Icon: InboxIcon },
    ],
  },
  {
    title: 'Competitions',
    items: [
      { href: '/my/tickets', label: 'Tickets', Icon: TicketIcon },
      { href: '/dashboard/raffle-wins', label: 'Wins', Icon: TrophyIcon },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
      { href: '/profile', label: 'Profile', Icon: UserIcon },
      { href: '/settings', label: 'Settings', Icon: SettingsIcon },
      { href: '/notifications', label: 'Notifications', Icon: BellIcon },
    ],
  },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  // Only match sub-routes for non-/dashboard entries so /dashboard doesn't
  // light up while on /dashboard/raffle-wins.
  return href !== '/dashboard' && pathname.startsWith(href + '/');
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
