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

function TypeBadge({ t }: { t: SearchHit['listingType'] }) {
  const label =
    t === 'BUY_NOW' ? 'Buy Now' : t === 'AUCTION' ? 'Auction' : 'Take a Shot';
  return (
    <span
      style={{
        fontSize: 10,
        color: 'var(--text-tertiary)',
        background: 'var(--bg-deep)',
        border: '0.5px solid var(--border)',
        borderRadius: 3,
        padding: '1px 5px',
      }}
    >
      {label}
    </span>
  );
}

export function LiveSearch({
  placeholder = 'Search listings…',
  className,
  style,
}: {
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
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
    router.push(`/?q=${encodeURIComponent(term)}`);
  }

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: 'relative', ...style }}
    >
      <form onSubmit={onSubmit}>
        <input
          type="search"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if (hits && hits.length > 0) setOpen(true);
          }}
          style={inputStyle}
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
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        textDecoration: 'none',
                        borderBottom: '0.5px solid var(--border-divider, var(--border))',
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          flexShrink: 0,
                          borderRadius: 4,
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
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                            marginBottom: 2,
                          }}
                        >
                          {h.referenceNumber && (
                            <span
                              style={{
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: 10,
                                color: 'var(--text-tertiary)',
                              }}
                            >
                              {h.referenceNumber}
                            </span>
                          )}
                          <TypeBadge t={h.listingType} />
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h.title}
                        </div>
                        <div
                          style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
                        >
                          {h.category.name}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'var(--red)',
                          fontWeight: 500,
                          flexShrink: 0,
                        }}
                      >
                        {h.price ? formatPrice(h.price) : '—'}
                      </div>
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
                    router.push(`/?q=${encodeURIComponent(q.trim())}`);
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
