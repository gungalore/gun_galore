'use client';

// Shared tab strip for the three reporting surfaces, unified under one
// "Analytics & Health" home so the operator flips between them in place
// instead of hunting separate sidebar links:
//   • Sales              → /admin/analytics
//   • Operational Health → /admin/analytics/health   (KYC funnel, SLA, refund risk)
//   • System Health      → /admin/health             (services / crons / queues)
// The active tab is derived from the pathname so all three pages render an
// identical strip with the right one highlighted.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/analytics', label: 'Sales' },
  { href: '/admin/analytics/health', label: 'Operational Health' },
  { href: '/admin/health', label: 'System Health' },
];

export default function AnalyticsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-2 mb-5 flex-wrap">
      {TABS.map((t) =>
        pathname === t.href ? (
          <span
            key={t.href}
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--red)', color: '#fff' }}
          >
            {t.label}
          </span>
        ) : (
          <Link
            key={t.href}
            href={t.href}
            className="px-3 py-1.5 rounded-full text-xs"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
            }}
          >
            {t.label}
          </Link>
        ),
      )}
    </div>
  );
}
