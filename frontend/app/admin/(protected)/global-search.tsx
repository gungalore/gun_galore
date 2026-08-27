'use client';

// Sticky type-ahead in the admin header. Searches users, listings,
// transactions in parallel via /admin/search. Renders grouped results
// in a dropdown. Keyboard accessible: ↑/↓ to navigate, Enter to open,
// Esc to close.

import { useState, useEffect, useRef, useMemo, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

interface SearchResult {
  users: {
    id: string;
    username: string | null;
    email: string;
    sellerTier: string;
    isBanned: boolean;
  }[];
  listings: {
    id: string;
    referenceNumber: string | null;
    title: string;
    status: string;
    listingType: string;
    price: number | null;
    seller: { username: string | null };
  }[];
  transactions: {
    id: string;
    paymentStatus: string;
    buyerTotal: number;
    createdAt: string;
    listing: { title: string; referenceNumber: string | null };
  }[];
  orders: {
    id: string;
    orderReference: string | null;
    status: string;
    buyerTotal: number;
    createdAt: string;
    buyer: { username: string | null };
    _count: { transactions: number };
  }[];
}

export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Flatten results into a single navigable list. The dropdown
  // renders them in groups, but ↑/↓ should move through ALL items
  // regardless of group. memoised so the index stays valid as long
  // as the results don't change.
  const flatItems = useMemo(() => {
    if (!results) return [] as { href: string; type: 'user' | 'listing' | 'transaction' | 'order' }[];
    return [
      ...results.users.map((u) => ({ href: `/admin/users/${u.id}`, type: 'user' as const })),
      ...results.listings.map((l) => ({ href: `/admin/listings/${l.id}`, type: 'listing' as const })),
      ...results.transactions.map((t) => ({ href: `/admin/transactions/${t.id}`, type: 'transaction' as const })),
      ...results.orders.map((o) => ({ href: `/admin/orders/${o.id}`, type: 'order' as const })),
    ];
  }, [results]);

  // Reset the active row whenever the result set changes so we never
  // point past the end of the list.
  useEffect(() => {
    setActiveIndex(0);
  }, [flatItems.length]);

  // Debounce — 200ms after the user stops typing.
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await adminFetch(
          `/admin/search?q=${encodeURIComponent(q.trim())}`,
        );
        if (res.ok) {
          const data = (await res.json()) as SearchResult;
          setResults(data);
          setOpen(true);
        }
      } catch {
        // Silent — search is best-effort.
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  // Close on outside click + ⌘K to focus.
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function navigate(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  // ↑ / ↓ moves through the flat result list; Enter opens the
  // currently-active item. Mouse hover ALSO updates activeIndex so
  // both inputs feel consistent.
  function handleInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || flatItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) navigate(item.href);
    }
  }

  const hasResults =
    results &&
    (results.users.length > 0 ||
      results.listings.length > 0 ||
      results.transactions.length > 0 ||
      results.orders.length > 0);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
        onKeyDown={handleInputKey}
        placeholder="Search users · listings · transactions · orders · refs · IDs   (⌘K)"
        aria-label="Search admin: users, listings, transactions"
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
        className="w-full px-3 py-2 rounded-[6px] text-sm outline-none"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 480,
            overflowY: 'auto',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {loading && (
            <p
              className="text-xs px-3 py-3 text-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Searching…
            </p>
          )}

          {!loading && !hasResults && q.length >= 2 && (
            <p
              className="text-xs px-3 py-3 text-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No matches for "{q}"
            </p>
          )}

          {/* IIFE to keep a flat row-index counter across the three
              groups so activeIndex (from the keyboard) lines up with
              the rendered row even though they're in separate groups. */}
          {(() => {
            if (!results) return null;
            let idx = -1;
            return (
              <>
                {results.users.length > 0 && (
                  <ResultGroup label={`Users (${results.users.length})`}>
                    {results.users.map((u) => {
                      idx += 1;
                      const active = idx === activeIndex;
                      return (
                        <ResultRow
                          key={u.id}
                          active={active}
                          onClick={() => navigate(`/admin/users/${u.id}`)}
                          onMouseEnter={((i) => () => setActiveIndex(i))(idx)}
                          title={`@${u.username ?? '(no username)'}`}
                          sub={u.email}
                          chip={u.isBanned ? 'BANNED' : u.sellerTier}
                          chipColor={u.isBanned ? 'var(--red)' : 'var(--text-secondary)'}
                        />
                      );
                    })}
                  </ResultGroup>
                )}
                {results.listings.length > 0 && (
                  <ResultGroup label={`Listings (${results.listings.length})`}>
                    {results.listings.map((l) => {
                      idx += 1;
                      const active = idx === activeIndex;
                      return (
                        <ResultRow
                          key={l.id}
                          active={active}
                          onClick={() => navigate(`/admin/listings/${l.id}`)}
                          onMouseEnter={((i) => () => setActiveIndex(i))(idx)}
                          title={l.title}
                          sub={`${l.referenceNumber ?? l.id.slice(0, 8)} · @${l.seller.username ?? 'anon'} · R${((l.price ?? 0) / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`}
                          chip={l.status}
                          chipColor="var(--text-secondary)"
                        />
                      );
                    })}
                  </ResultGroup>
                )}
                {results.transactions.length > 0 && (
                  <ResultGroup label={`Transactions (${results.transactions.length})`}>
                    {results.transactions.map((t) => {
                      idx += 1;
                      const active = idx === activeIndex;
                      return (
                        <ResultRow
                          key={t.id}
                          active={active}
                          onClick={() => navigate(`/admin/transactions/${t.id}`)}
                          onMouseEnter={((i) => () => setActiveIndex(i))(idx)}
                          title={t.listing.title}
                          sub={`${t.listing.referenceNumber ?? t.id.slice(0, 8)} · R${(t.buyerTotal / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`}
                          chip={t.paymentStatus}
                          chipColor="var(--text-secondary)"
                        />
                      );
                    })}
                  </ResultGroup>
                )}
                {results.orders.length > 0 && (
                  <ResultGroup label={`Orders (${results.orders.length})`}>
                    {results.orders.map((o) => {
                      idx += 1;
                      const active = idx === activeIndex;
                      return (
                        <ResultRow
                          key={o.id}
                          active={active}
                          onClick={() => navigate(`/admin/orders/${o.id}`)}
                          onMouseEnter={((i) => () => setActiveIndex(i))(idx)}
                          title={o.orderReference ?? o.id.slice(0, 8)}
                          sub={`@${o.buyer.username ?? 'anon'} · ${o._count.transactions} line${o._count.transactions === 1 ? '' : 's'} · R${(o.buyerTotal / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`}
                          chip={o.status}
                          chipColor="var(--text-secondary)"
                        />
                      );
                    })}
                  </ResultGroup>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <p
        className="text-[10px] uppercase tracking-wider px-3 pt-2 pb-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function ResultRow({
  onClick,
  onMouseEnter,
  title,
  sub,
  chip,
  chipColor,
  active,
}: {
  onClick: () => void;
  onMouseEnter?: () => void;
  title: string;
  sub: string;
  chip: string;
  chipColor: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={active}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        background: active ? 'var(--bg-inset)' : 'transparent',
        border: 'none',
        borderLeft: active ? '2px solid var(--red)' : '2px solid transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          className="text-sm truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </p>
        <p
          className="text-xs truncate"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {sub}
        </p>
      </div>
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
        style={{ background: `color-mix(in srgb, ${chipColor} 9%, transparent)`, color: chipColor }}
      >
        {chip.replace(/_/g, ' ')}
      </span>
    </button>
  );
}
