'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Live-search typeahead for the marketplace. Talks to the existing
// /listings?q=… endpoint which is already Meilisearch-backed when a `q`
// is present — Meilisearch's default typo tolerance (1 typo for 5-8
// char words, 2 for ≥9) handles bad spelling for us, so "glok" still
// finds "Glock".
//
// Behaviour:
//   - debounce input by 180ms so we don't fire on every keystroke
//   - show top 6 matches in a dropdown panel
//   - clicking a hit navigates to /listings/[id]
//   - pressing Enter goes to the full results page at /?q=...
//   - Esc closes the dropdown
//   - clicking outside closes the dropdown

interface SearchHit {
  id: string;
  referenceNumber: string | null;
  title: string;
  price: number | null;
  listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT';
  images: { url: string; isPrimary: boolean }[];
  category: { name: string };
}

// The /listings browse endpoint returns paginated data shape. We only
// care about the first few hits.
interface BrowseResponse {
  listings: SearchHit[];
  total: number;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
};

function typeLabel(t: SearchHit['listingType']): string {
  if (t === 'BUY_NOW') return 'Buy Now';
  if (t === 'AUCTION') return 'Auction';
  return 'Take a Shot';
}

// Each module gets a small colour accent so the user can scan results
// and tell at a glance which buying surface they belong to.
function typeColor(t: SearchHit['listingType']): string {
  if (t === 'AUCTION') return '#f59e0b'; // amber — time-sensitive
  if (t === 'TAKE_A_SHOT') return '#a78bfa'; // violet — offer-based
  return 'var(--text-secondary)'; // BUY_NOW — neutral
}

export function LiveSearch({
  placeholder = 'Search listings…',
  className,
  style,
  variant,
  onNavigate,
  defaultValue,
  preserveParams,
}: {
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  // 'attached' — strips the input's own border/background/radius so it can
  // sit flush inside a shared bordered control (the nav's Categories+search
  // unit). Default keeps the standalone bordered box.
  variant?: 'attached';
  // Fired whenever this search navigates. Containers that overlay the page
  // (the mobile burger drawer) use it to close themselves — they can't rely
  // on a route-change effect because search pushes "/?q=…", a query-only
  // change that leaves usePathname() untouched.
  onNavigate?: () => void;
  // Seed the box with the CURRENT query (results page) so the user sees
  // what they searched and can edit it. The component remounts on
  // server-rendered navigations, so a plain initial state is enough.
  defaultValue?: string;
  // Extra query params to KEEP when submitting a search — the FilterBar
  // passes the active surface/filters (listingType, categoryId, …) so
  // searching within Auctions stays within Auctions. Global boxes (nav,
  // drawer) pass nothing and search site-wide. `page` is intentionally
  // never preserved (a new search restarts at page 1).
  preserveParams?: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValue ?? '');

  // Build the full-results URL, carrying any preserved filters.
  function resultsHref(term: string): string {
    const params = new URLSearchParams(preserveParams ?? {});
    params.set('q', term);
    return `/?${params.toString()}`;
  }
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Outside-click + Esc handler.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Debounced fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setBusy(false);
      // Cancel any in-flight request from a longer previous query.
      abortRef.current?.abort();
      return;
    }
    setBusy(true);
    debounceRef.current = setTimeout(async () => {
      // Cancel previous request — otherwise an older slower response
      // could overwrite the newer query's results.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const url = `${API_URL}/listings?q=${encodeURIComponent(term)}&limit=6`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          setHits([]);
          return;
        }
        const data = (await res.json()) as BrowseResponse;
        setHits(data.listings ?? []);
        setOpen(true);
      } catch (err) {
        // Aborted by a newer search — silent.
        if ((err as Error).name === 'AbortError') return;
        setHits([]);
      } finally {
        setBusy(false);
      }
    }, 180);
  }, [q]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setOpen(false);
    onNavigate?.();
    router.push(resultsHref(term));
  }

  const finalInputStyle: React.CSSProperties =
    variant === 'attached'
      ? {
          ...inputStyle,
          border: 'none',
          background: 'transparent',
          borderRadius: 0,
        }
      : inputStyle;

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: 'relative',
        ...(variant === 'attached' ? { display: 'flex' } : {}),
        ...style,
      }}
    >
      <form onSubmit={onSubmit} style={variant === 'attached' ? { flex: 1 } : undefined}>
        <input
          type="search"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if (hits && hits.length > 0) setOpen(true);
          }}
          style={finalInputStyle}
          aria-label="Search listings"
          autoComplete="off"
        />
      </form>

      {open && hits !== null && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 60,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            maxHeight: 420,
            overflowY: 'auto',
          }}
        >
          {hits.length === 0 ? (
            <div
              style={{
                padding: '14px 16px',
                fontSize: 13,
                color: 'var(--text-tertiary)',
              }}
            >
              {busy ? 'Searching…' : `No results for “${q}”`}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {hits.map((h) => {
                const img =
                  h.images.find((i) => i.isPrimary)?.url ?? h.images[0]?.url;
                return (
                  <li key={h.id}>
                    <Link
                      href={`/listings/${h.id}`}
                      onClick={() => {
                        setOpen(false);
                        setQ('');
                        onNavigate?.();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        textDecoration: 'none',
                        borderBottom:
                          '0.5px solid var(--border-divider, var(--border))',
                      }}
                    >
                      {/* Cover image — square thumbnail, left */}
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          flexShrink: 0,
                          borderRadius: 6,
                          background: 'var(--bg-inset)',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt=""
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            —
                          </span>
                        )}
                      </div>

                      {/* Right column — title on top, module type below */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            color: 'var(--text-primary)',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 3,
                          }}
                        >
                          {h.title}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: typeColor(h.listingType),
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>
                            {typeLabel(h.listingType)}
                          </span>
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            · {h.category.name}
                          </span>
                        </div>
                      </div>

                      {/* Price — right edge, small + muted so the title
                          stays dominant. */}
                      {h.price && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--text-secondary)',
                            fontWeight: 500,
                            flexShrink: 0,
                          }}
                        >
                          {formatPrice(h.price)}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
              {/* Footer row — "see all" link to the full results page */}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                    router.push(resultsHref(q.trim()));
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'var(--bg-inset)',
                    border: 'none',
                    borderTop: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  See all results for &ldquo;{q}&rdquo; →
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
