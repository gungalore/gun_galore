// SINGLE SOURCE OF TRUTH (data) for the buyer/seller account menu.
//
// This module has NO 'use client' directive on purpose: it holds plain data
// (ACCOUNT_GROUPS) + purely-presentational icon components, so it can be
// imported by BOTH Server Components (e.g. the server-rendered /account hub)
// and Client Components (the nav dropdown, mobile drawer, PWA More-sheet via
// <AccountMenuList/> in account-menu.tsx).
//
// Why the split exists: a Server Component that imports a *value* (like the
// ACCOUNT_GROUPS array) from a 'use client' module receives a client-reference
// PROXY instead of the real array, so `ACCOUNT_GROUPS.map(...)` throws
// "map is not a function" at render time. Keeping the data here — out of the
// 'use client' boundary — is what lets the server hub render it.

import type { FC, ReactNode } from 'react';

export type IconC = FC;

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
const SearchAlertIcon: IconC = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
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
      { href: '/saved-searches', label: 'Saved searches', Icon: SearchAlertIcon },
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
