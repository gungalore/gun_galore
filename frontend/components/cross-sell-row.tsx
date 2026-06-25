'use client';

// CrossSellRow — "You might also need…". A SECONDARY suggestion row that
// renders below the user's primary results (or on a listing detail page).
// It NEVER touches the primary results — separate fetch, separate section,
// self-hides when empty.
//
// Fetches the generic, data-driven cross-sell engine
// (GET /listings/cross-sell). Two modes:
//   - search/browse: pass fromCategoryId (+ q for the calibre signal) +
//     excludeIds (the listing ids already on screen).
//   - listing detail: pass listingId.
//
// Compliance is enforced server-side (only crossSellEligible categories +
// ACTIVE listings), so this never surfaces powder / primers / live ammo.

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils';
import type { Listing } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Props {
  /** Search/browse mode: the category to draw complements from. */
  fromCategoryId?: string;
  /** Listing-detail mode: complements for this listing. */
  listingId?: string;
  /** The user's search query — used for the calibre/relevance signal. */
  q?: string;
  /** Comma-separated ids already on screen, so the row doesn't repeat them. */
  excludeIds?: string;
  /** Header copy. */
  title?: string;
}

export function CrossSellRow({
  fromCategoryId,
  listingId,
  q,
  excludeIds,
  title = 'You might also need…',
}: Props) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!fromCategoryId && !listingId) {
      setLoaded(true);
      return;
    }
    const params = new URLSearchParams();
    if (listingId) params.set('listingId', listingId);
    if (fromCategoryId) params.set('fromCategoryId', fromCategoryId);
    if (q) params.set('q', q);
    if (excludeIds) params.set('excludeIds', excludeIds);

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${API_URL}/listings/cross-sell?${params.toString()}`,
          { cache: 'no-store' },
        );
        if (!r.ok) {
          if (!cancelled) {
            setListings([]);
            setLoaded(true);
          }
          return;
        }
        const data = (await r.json()) as { suggestions: Listing[] };
        if (!cancelled) {
          setListings(data.suggestions ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setListings([]);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromCategoryId, listingId, q, excludeIds]);

  // Self-hide when there's nothing to suggest.
  if (!loaded) return null;
  if (listings.length === 0) return null;

  return (
    <section
      aria-label={title}
      style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 0 8px' }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--text-primary)',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-tertiary)',
            margin: '2px 0 0',
          }}
        >
          Related items from across Gun Galore
        </p>
      </header>
      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 8,
          scrollbarWidth: 'thin',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {listings.map((l) => {
          const img = l.images?.find((i) => i.isPrimary) ?? l.images?.[0];
          return (
            <Link
              key={l.id}
              href={`/listings/${l.id}`}
              style={{
                flex: '0 0 160px',
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  paddingBottom: '60%',
                  background: 'var(--bg-inset)',
                }}
              >
                {img && (
                  <Image
                    src={img.url}
                    alt={l.title}
                    fill
                    sizes="160px"
                    style={{ objectFit: 'cover' }}
                  />
                )}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {l.title}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--red)',
                    margin: '4px 0 0',
                    fontWeight: 500,
                  }}
                >
                  {l.price
                    ? formatPrice(l.price)
                    : l.listingType === 'TAKE_A_SHOT'
                      ? 'Make offer'
                      : '—'}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
