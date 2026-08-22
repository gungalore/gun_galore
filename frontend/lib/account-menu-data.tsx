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
import { PRO_NAME } from './brand';

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
const ShieldDocIcon: IconC = () => (
  <Svg>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9 11h6M9 14h4" />
  </Svg>
);

const DocIcon: IconC = () => (
  <Svg>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);

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
const SwapIcon: IconC = () => (
  <Svg>
    <path d="M4 7h13M14 3l4 4-4 4" />
    <path d="M20 17H7M10 21l-4-4 4-4" />
  </Svg>
);
const WalletIcon: IconC = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <path d="M16 12h5M3 9h18" />
  </Svg>
);
const TruckIcon: IconC = () => (
  <Svg>
    <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
    <circle cx="7" cy="18" r="1.6" />
    <circle cx="17" cy="18" r="1.6" />
  </Svg>
);
const CrownIcon: IconC = () => (
  <Svg>
    <path d="M4 17h16l1-9-5 3.5L12 6l-4 5.5L3 8l1 9z" />
    <path d="M5 20h14" />
  </Svg>
);
const HelpIcon: IconC = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.6c0 1.6-2.4 2.1-2.4 3.4" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);
const FaqIcon: IconC = () => (
  <Svg>
    <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5z" />
  </Svg>
);
const BookIcon: IconC = () => (
  <Svg>
    <path d="M12 6a4 4 0 0 0-4-3H4v15h5a3 3 0 0 1 3 2 3 3 0 0 1 3-2h5V3h-4a4 4 0 0 0-4 3z" />
    <path d="M12 6v14" />
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
      // Swaps live under Buying (both parties "shop" the other's item).
      // Without this entry /my/swaps was only reachable from notification
      // links — a member who cleared their inbox couldn't get back to a
      // live swap.
      { href: '/my/swaps', label: 'Swaps', Icon: SwapIcon },
      { href: '/wishlist', label: 'Wishlist', Icon: HeartIcon },
      { href: '/saved-searches', label: 'Saved searches', Icon: SearchAlertIcon },
    ],
  },
  {
    // Spans both directions — incoming (bought) + outgoing (sold) shipments
    // and firearm hand-off — so it sits between Buying and Selling.
    title: 'Shipping',
    items: [
      { href: '/shipping', label: 'Shipping', Icon: TruckIcon },
    ],
  },
  {
    // Neither buying nor selling: the member's own compliance paperwork.
    // The motivation writer lived only at a direct URL until now — it belongs
    // beside the vault that feeds it.
    // ⚠️ TWO CENTRES, AND THE OPERATOR NAMED BOTH (2026-08-22): "so we will
    // have Document Centre and Motivation Centre".
    //
    // The rename is real work, not decoration. A module whose first section is
    // firearm licences and whose second is a photograph of somebody's gun safe
    // stopped being a licence tracker the day it absorbed the application
    // paperwork — and nobody looking for their ID copy would think to open
    // something called the Licence Centre.
    //
    // ⚠️ MEMBER-FACING ONLY. The backend prefix, the module directory and the
    // scan hand-off's `dest` string all stay `licence-centre`: a phone
    // mid-hand-off is holding a token minted against that path, and renaming
    // it would strand whoever is standing at their desk right now.
    title: 'Licences',
    items: [
      { href: '/documents', label: 'Document Centre', Icon: ShieldDocIcon },
      { href: '/motivations', label: 'Motivation Centre', Icon: DocIcon },
    ],
  },
  {
    title: 'Selling',
    items: [
      { href: '/my/listings', label: 'Listings', Icon: StoreIcon },
      { href: '/my/sales', label: 'Sales', Icon: ReceiptIcon },
      { href: '/my/earnings', label: 'Earnings', Icon: WalletIcon },
      { href: '/offers/received', label: 'Offers received', Icon: InboxIcon },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
      { href: '/profile', label: 'Profile', Icon: UserIcon },
      { href: '/subscribe', label: PRO_NAME, Icon: CrownIcon },
      { href: '/settings', label: 'Settings', Icon: SettingsIcon },
      { href: '/notifications', label: 'Notifications', Icon: BellIcon },
    ],
  },
  // Shared with the /account hub (which used to hard-code its own copy —
  // the exact drift the single-source file exists to prevent).
  {
    title: 'Help',
    items: [
      { href: '/support', label: 'Support & tickets', Icon: HelpIcon },
      { href: '/faq', label: 'FAQ', Icon: FaqIcon },
      { href: '/how-selling-works', label: 'How selling works', Icon: BookIcon },
    ],
  },
];
