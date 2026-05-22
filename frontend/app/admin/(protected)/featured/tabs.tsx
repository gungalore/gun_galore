import Link from 'next/link';

type Tab = 'slots' | 'revenue' | 'settings' | 'banned' | 'audit';

const TABS: { id: Tab; label: string; href: string }[] = [
  { id: 'slots', label: 'Slots', href: '/admin/featured' },
  { id: 'revenue', label: 'Revenue', href: '/admin/featured/revenue' },
  { id: 'settings', label: 'Settings', href: '/admin/featured/settings' },
  { id: 'banned', label: 'Banned', href: '/admin/featured/banned' },
  { id: 'audit', label: 'Audit', href: '/admin/featured/audit' },
];

// Server-rendered tab strip used at the top of every Featured Slots
// admin page. Current-tab highlighting is a red bottom border; non-
// current tabs render with secondary text colour and a transparent
// border so layout doesn't shift on hover/select.
export function FeaturedTabs({ current }: { current: Tab }) {
  return (
    <div
      className="flex gap-1 mb-6"
      style={{ borderBottom: '0.5px solid var(--border)' }}
    >
      {TABS.map((t) => {
        const active = t.id === current;
        return (
          <Link
            key={t.id}
            href={t.href}
            className="px-3 py-2 text-sm"
            style={{
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: active
                ? '2px solid var(--red)'
                : '2px solid transparent',
              fontWeight: active ? 500 : 400,
              textDecoration: 'none',
              marginBottom: '-0.5px',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
