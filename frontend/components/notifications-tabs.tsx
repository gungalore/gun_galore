'use client';

// Notifications page — tab strip across the top of /notifications.
//
// Three tabs: Buyer / Seller / Account. Each tab renders the active
// count as a red pill next to the label whenever > 0 — this is the
// per-tab indicator that tells the user at a glance which area has
// unfinished business.
//
// Pattern mirrors `admin/(protected)/featured/tabs.tsx` — a Link-based
// strip with a red bottom border for the active tab. URL-driven via
// ?tab=buyer|seller|account.

import Link from 'next/link';
import type { ActiveCount, NotificationCategory } from '@/lib/notifications';

interface Tab {
  key: NotificationCategory;
  label: string;
  query: string; // ?tab= value
}

const TABS: Tab[] = [
  { key: 'BUYER', label: 'Buyer', query: 'buyer' },
  { key: 'SELLER', label: 'Seller', query: 'seller' },
  { key: 'ACCOUNT', label: 'Account', query: 'account' },
];

export function NotificationsTabs({
  current,
  activeCount,
}: {
  current: NotificationCategory;
  activeCount: ActiveCount;
}) {
  return (
    <nav
      aria-label="Notification categories"
      style={{
        display: 'flex',
        gap: 6,
        borderBottom: '0.5px solid var(--border)',
        marginBottom: 12,
        overflowX: 'auto',
      }}
    >
      {TABS.map((tab) => {
        const isActive = current === tab.key;
        const count =
          tab.key === 'BUYER'
            ? activeCount.buyer
            : tab.key === 'SELLER'
              ? activeCount.seller
              : activeCount.account;
        return (
          <Link
            key={tab.key}
            href={`/notifications?tab=${tab.query}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: isActive
                ? '2px solid var(--red)'
                : '2px solid transparent',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'color 120ms',
            }}
          >
            {tab.label}
            {count > 0 && (
              <span
                aria-label={`${count} unresolved`}
                style={{
                  minWidth: 18,
                  height: 18,
                  padding: '0 6px',
                  borderRadius: 9,
                  background: 'var(--red)',
                  color: '#fff',
                  fontSize: 10.5,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
