'use client';

// Grouped, collapsible admin sidebar. The old flat 20-item wall is now
// bucketed into five scannable sections (Operations / Moderation /
// Marketplace / Ask GG / System) plus a standalone Command Center. The
// section containing the current route auto-expands; the operator's
// open/closed choices persist in localStorage. Active link keeps the red
// left-border + tint. Lives in a client component because both the
// active-route highlight and the collapse state need hooks.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  // Extra path prefixes that also mark this item active — e.g. System
  // Health now lives as a tab under "Analytics & Health".
  aliases?: string[];
}
interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

const TOP: NavItem = { href: '/admin', label: 'Command Center' };

const GROUPS: NavGroup[] = [
  {
    key: 'operations',
    label: 'Operations',
    items: [
      { href: '/admin/listings', label: 'Listings' },
      { href: '/admin/transactions', label: 'Transactions' },
      { href: '/admin/users', label: 'Users' },
      { href: '/admin/manual-payments', label: 'Manual Payments' },
    ],
  },
  {
    key: 'moderation',
    label: 'Moderation',
    items: [
      { href: '/admin/trust-safety', label: 'Trust & Safety' },
      { href: '/admin/freshness-graveyard', label: 'Stale Listings' },
    ],
  },
  {
    key: 'marketplace',
    label: 'Marketplace',
    items: [
      { href: '/admin/categories', label: 'Categories' },
      { href: '/admin/dealers', label: 'Dealers' },
      { href: '/admin/competitions', label: 'Competitions' },
      { href: '/admin/featured', label: 'Featured Slots' },
      { href: '/admin/postal-entries', label: 'Postal Entries' },
      { href: '/admin/credits', label: 'Credits' },
    ],
  },
  {
    key: 'askgg',
    label: 'Ask GG',
    items: [
      { href: '/admin/ask-gg/kb', label: 'Knowledge Base' },
      { href: '/admin/ask-gg/experts', label: 'Experts' },
      { href: '/admin/reloading', label: 'Reloading Library' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    items: [
      {
        href: '/admin/analytics',
        label: 'Analytics & Health',
        aliases: ['/admin/health'],
      },
      { href: '/admin/audit', label: 'Audit Log' },
      { href: '/admin/settings', label: 'Settings' },
      { href: '/admin/broadcast', label: 'Broadcast' },
      { href: '/admin/admins', label: 'Admins' },
    ],
  },
];

const STORE_KEY = 'gg-admin-nav-open';

function itemActive(item: NavItem, pathname: string): boolean {
  const hrefs = [item.href, ...(item.aliases ?? [])];
  return hrefs.some((h) => pathname === h || pathname.startsWith(h + '/'));
}

export default function SidebarNav() {
  const pathname = usePathname();
  const activeGroupKey =
    GROUPS.find((g) => g.items.some((it) => itemActive(it, pathname)))?.key ??
    null;

  // The active group starts open. This is deterministic from the pathname
  // (identical on server + client) so there's no hydration mismatch; saved
  // preferences merge in after mount.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(activeGroupKey ? [activeGroupKey] : []),
  );

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      if (Array.isArray(saved) && saved.length) {
        setOpen((prev) => new Set([...prev, ...saved]));
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Navigating into a collapsed section always reveals it.
  useEffect(() => {
    if (activeGroupKey) {
      setOpen((prev) =>
        prev.has(activeGroupKey) ? prev : new Set([...prev, activeGroupKey]),
      );
    }
  }, [activeGroupKey]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <nav className="flex flex-col gap-0.5 text-sm">
      <NavLink item={TOP} active={pathname === '/admin'} />

      {GROUPS.map((g) => {
        const isOpen = open.has(g.key);
        const hasActive = g.key === activeGroupKey;
        return (
          <div key={g.key} className="mt-2">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              aria-expanded={isOpen}
              className="w-full flex items-center justify-between px-2 py-1 rounded-[6px]"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: hasActive
                  ? 'var(--text-secondary)'
                  : 'var(--text-tertiary)',
              }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                {g.label}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                style={{
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s',
                  opacity: 0.55,
                }}
              >
                <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-0.5 mt-0.5">
                {g.items.map((it) => (
                  <NavLink
                    key={it.href}
                    item={it}
                    active={itemActive(it, pathname)}
                    indent
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  item,
  active,
  indent,
}: {
  item: NavItem;
  active: boolean;
  indent?: boolean;
}) {
  return (
    <Link
      href={item.href}
      className="py-1.5 rounded-[6px] transition-colors"
      style={{
        paddingLeft: indent ? '18px' : '8px',
        paddingRight: '8px',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: active ? 500 : 400,
        background: active ? 'rgba(200,16,46,0.10)' : 'transparent',
        borderLeft: active ? '2px solid var(--red)' : '2px solid transparent',
        textDecoration: 'none',
      }}
    >
      {item.label}
    </Link>
  );
}
