'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ActionRow,
  EmptyState,
  Icon,
  SkeletonRows,
  useAdminToast,
  type AdminIconName,
} from '@/components/admin/admin-ui';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  adminSearch,
  formatRand,
  type AdminSearchResults,
  type AlertCount,
  type AttentionQueue,
} from '@/lib/admin-api';

const TABS: Array<{
  href: string;
  label: string;
  icon: AdminIconName;
  badge?: 'people' | 'operate' | 'money';
}> = [
  { href: '/admin/warden', label: 'Warden', icon: 'shield' },
  { href: '/admin/money', label: 'Money', icon: 'wallet', badge: 'money' },
  { href: '/admin/people', label: 'People', icon: 'users', badge: 'people' },
  { href: '/admin/operate', label: 'Operate', icon: 'layers', badge: 'operate' },
  { href: '/admin/insights', label: 'Insights', icon: 'chart' },
];

export function AdminTabBar() {
  const pathname = usePathname();
  // One shared poll for both badges. 60s: the tab bar is chrome, not a board,
  // and a badge that lags half a minute is still a badge that is right.
  const { data } = useAdminPoll<AttentionQueue>(
    () => adminFetch<AttentionQueue>('/admin/command/attention-queue'),
    60_000,
  );
  const { data: alerts } = useAdminPoll<AlertCount>(
    () => adminFetch<AlertCount>('/admin/alerts/count'),
    60_000,
  );
  // The tab badge is easy to miss while working another board. Raise one toast
  // when a listing actually enters the review queue; the first poll is only a
  // baseline, so opening the panel on an existing queue stays quiet.
  const { toast } = useAdminToast();
  const lastPendingListings = useRef<number | null>(null);
  const pendingListings = data?.pendingListings;
  useEffect(() => {
    if (pendingListings === undefined) return;
    if (lastPendingListings.current === null) {
      lastPendingListings.current = pendingListings;
      return;
    }
    if (pendingListings > lastPendingListings.current) {
      const added = pendingListings - lastPendingListings.current;
      toast(
        `${added} new listing${added === 1 ? '' : 's'} waiting — open Operate`,
        'cyan',
      );
    }
    lastPendingListings.current = pendingListings;
  }, [pendingListings, toast]);

  function badgeFor(tab: (typeof TABS)[number]): number {
    if (tab.badge === 'people') {
      // Dealer verification lives on Money (it is a money-hold decision), so
      // People counts only stalled identities.
      return data?.kycStalled ?? 0;
    }
    if (tab.badge === 'money') {
      return (
        (data?.disputedPayments ?? 0) +
        (data?.dealerVerificationsPendingReview ?? 0) +
        (data?.dispatchSlaAtRisk ?? 0) +
        (data?.salesAwaitingAccept ?? 0)
      );
    }
    if (tab.badge === 'operate') {
      // ⚠️ UNRESOLVED, NOT URGENT. The inbox lists every unresolved alert, so a
      // badge counting only the urgent ones pointed at a screen showing more
      // rows than the badge — and the rest could never be cleared.
      return (data?.pendingListings ?? 0) + (alerts?.unresolved ?? 0);
    }
    return 0;
  }

  return (
    <nav className="adm-tabbar" aria-label="Admin sections">
      {TABS.map((tab) => {
        const active =
          pathname === tab.href || pathname?.startsWith(`${tab.href}/`) === true;
        const badge = badgeFor(tab);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="adm-tab"
            data-active={active}
            aria-current={active ? 'page' : undefined}
            style={{ textDecoration: 'none' }}
          >
            {badge > 0 ? (
              <span className="adm-tab-badge">{badge > 99 ? '99+' : badge}</span>
            ) : null}
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminHeader() {
  const { admin, isGod, signOut } = useAdminSession();
  const [clock, setClock] = useState('--:--');
  const [countdown, setCountdown] = useState(15);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function update() {
      setClock(
        new Date().toLocaleTimeString('en-ZA', {
          timeZone: 'Africa/Johannesburg',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      );
    }
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCountdown((c) => (c <= 1 ? 15 : c - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="adm-header">
      <div className="adm-brand">
        <span className="adm-brand-badge">
          <Icon name="shield" size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="adm-brand-title">ALL Outdoor</div>
          <div className="adm-brand-sub">
            WARDEN OS{admin?.email ? ` // ${admin.email.split('@')[0]}` : ''}
          </div>
        </div>
      </div>
      <div className="adm-header-actions">
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          style={{ padding: 9, minWidth: 40 }}
          aria-label="Search members, listings and orders"
          title="Search"
          onClick={() => setSearchOpen(true)}
        >
          <Icon name="search" size={16} />
        </button>
        <span className="adm-live" title={clock}>
          <span className="adm-dot" />
          POLL {countdown}s
        </span>
        <span className="adm-god" data-role={admin?.role}>
          {isGod ? 'SUPERADMIN' : 'READ-ONLY'}
        </span>
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          style={{ padding: 9, minWidth: 40 }}
          aria-label="Sign out"
          title="Sign out"
          onClick={() => void signOut()}
        >
          <Icon name="logout" size={16} />
        </button>
      </div>
      {searchOpen ? <AdminSearchOverlay onClose={() => setSearchOpen(false)} /> : null}
    </header>
  );
}

/**
 * Global lookup — a username, an email, a listing title, a GG-ORD or a gateway
 * reference, from any board.
 *
 * ⚠️ ONLY MEMBERS HAVE A DETAIL ROUTE IN THIS DESK. Listings, transactions and
 * orders are listed with the identifiers an operator needs to work them, but
 * deliberately not turned into links to a page that does not exist.
 */
function AdminSearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      setLoading(true);
      try {
        const found = await adminSearch(q);
        if (!cancelled) {
          setResults(found);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Search failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  const groups = results
    ? [
        {
          label: 'Members',
          rows: results.users.map((u) => ({
            key: String(u.id),
            title: `@${String(u.username ?? u.email ?? u.id)}`,
            caption: [
              typeof u.email === 'string' ? u.email : null,
              u.isBanned ? 'BANNED' : null,
              u.accountClosedAt ? 'CLOSED' : null,
            ]
              .filter(Boolean)
              .join(' · '),
            href: `/admin/people/${String(u.id)}`,
          })),
        },
        {
          label: 'Listings',
          rows: results.listings.map((l) => ({
            key: String(l.id),
            title: String(l.title ?? l.id),
            caption: [
              typeof l.referenceNumber === 'string' ? l.referenceNumber : null,
              typeof l.status === 'string' ? l.status : null,
              typeof l.price === 'number' ? formatRand(l.price) : null,
            ]
              .filter(Boolean)
              .join(' · '),
            href: '/admin/operate#listings',
          })),
        },
        {
          label: 'Orders & transactions',
          rows: [
            ...results.orders.map((o) => ({
              key: `order-${String(o.id)}`,
              title: String(o.orderReference ?? o.id),
              caption: [
                'ORDER',
                typeof o.status === 'string' ? o.status : null,
                typeof o.buyerTotal === 'number' ? formatRand(o.buyerTotal) : null,
              ]
                .filter(Boolean)
                .join(' · '),
              href: '/admin/money',
            })),
            ...results.transactions.map((t) => ({
              key: `tx-${String(t.id)}`,
              title:
                (t.listing as { title?: string } | undefined)?.title ??
                String(t.id).slice(0, 12),
              caption: [
                typeof t.paymentStatus === 'string' ? t.paymentStatus : null,
                typeof t.buyerTotal === 'number' ? formatRand(t.buyerTotal) : null,
              ]
                .filter(Boolean)
                .join(' · '),
              href: '/admin/money',
            })),
          ],
        },
      ].filter((group) => group.rows.length > 0)
    : [];

  return (
    <div
      className="adm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ alignItems: 'flex-start', paddingTop: 80, padding: 20 }}
    >
      <div
        className="adm-card"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        style={{ width: '100%', maxWidth: 560, background: '#090e13', borderRadius: 18 }}
      >
        <div className="adm-card-head">
          <span className="adm-card-title">Search</span>
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            style={{ padding: 6, minWidth: 32 }}
            aria-label="Close search"
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <input
          className="adm-input"
          autoFocus
          value={query}
          placeholder="Username, email, listing, GG-ORD or gateway reference…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim().length < 2 ? (
          <p className="adm-sub" style={{ margin: 0 }}>
            Type at least two characters.
          </p>
        ) : error ? (
          <EmptyState icon="alert" title="Search unavailable" caption={error} />
        ) : loading && !results ? (
          <SkeletonRows rows={3} />
        ) : groups.length === 0 ? (
          <EmptyState title="Nothing matches" caption="Try a shorter fragment or a reference number." />
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="adm-label">{group.label}</div>
              {group.rows.map((row) => (
                <a
                  key={row.key}
                  href={row.href}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                  onClick={onClose}
                >
                  <ActionRow
                    icon={group.label === 'Members' ? 'users' : group.label === 'Listings' ? 'doc' : 'wallet'}
                    title={row.title}
                    caption={row.caption}
                    trailing={<Icon name="chevron" size={14} />}
                  />
                </a>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
