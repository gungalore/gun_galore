'use client';

// Active-route highlighting for the admin sidebar. Renders the same
// list of links the layout previously hard-coded, but with a usePathname
// check so the current section gets a red left-border + tinted bg.
// Lives as its own client component because Link styling based on
// pathname needs hooks (the layout is a server component).

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/analytics', label: 'Analytics' },
  { href: '/admin/trust-safety', label: 'Trust & Safety' },
  { href: '/admin/health', label: 'System Health' },
  { href: '/admin/credits', label: 'Credits' },
  { href: '/admin/freshness-graveyard', label: 'Freshness' },
  { href: '/admin/listings', label: 'Listings' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/transactions', label: 'Transactions' },
  { href: '/admin/competitions', label: 'Competitions' },
  { href: '/admin/featured', label: 'Featured Slots' },
  { href: '/admin/postal-entries', label: 'Postal Entries' },
  { href: '/admin/dealers', label: 'Dealers' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/broadcast', label: 'Broadcast' },
  { href: '/admin/kyc', label: 'KYC Credits' },
  { href: '/admin/audit', label: 'Audit Log' },
  { href: '/admin/admins', label: 'Admins' },
];

export default function SidebarNav() {
  const pathname = usePathname();

  // Match the deepest non-empty segment so /admin/users/abc highlights
  // "Users", not just "Overview". /admin (exact) matches Overview only.
  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <nav className="flex flex-col gap-1 text-sm">
      {ITEMS.map(({ href, label }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className="px-2 py-1.5 rounded-[6px] transition-colors"
            style={{
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: active ? 500 : 400,
              background: active ? 'rgba(200,16,46,0.10)' : 'transparent',
              borderLeft: active
                ? '2px solid var(--red)'
                : '2px solid transparent',
              textDecoration: 'none',
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
