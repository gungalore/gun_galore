'use client';

// RecentlyViewedRail — horizontal scroll of cards for the listings
// the user has recently opened. Reads IDs from localStorage via
// useRecentlyViewed, fetches fresh listing data from the backend's
// /listings?ids=cuid1,cuid2,… endpoint, and renders compact cards.
//
// Self-hides when there are < 2 entries (one card alone reads as
// confusing dead chrome). Also self-hides when the fetch returns
// nothing (e.g. every recent listing has since been removed) — no
// "nothing here" empty state on this surface.
//
// Mounted on:
//   - homepage (below the featured marquee)
//   - listing detail (bottom — "More from your recently viewed")
//   - /wishlist empty state (gives a 0-save user something to come
//     back to)

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRecentlyViewed } from '@/lib/use-recently-viewed';
import { formatPrice } from '@/lib/utils';
import type { Listing } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Props {
  /** Header copy. Default "Recently viewed". Listing-detail uses
   * "More from your recent views" so it doesn't say the same thing
   * as the homepage rail. */
  title?: string;
  /** Skip this listing ID from the rail (used on listing detail so
   * the current page's own card isn't repeated in the rail below). */
  excludeId?: string;
}

export function RecentlyViewedRail({
  title = 'Recently viewed',
  excludeId,
}: Props) {
  const { ids, clear } = useRecentlyViewed();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const wanted = ids.filter((id) => id !== excludeId).slice(0, 12);
    if (wanted.length === 0) {
      setListings([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${API_URL}/listings?ids=${encodeURIComponent(wanted.join(','))}`,
          { cache: 'no-store' },
        );
        if (!r.ok) {
          if (!cancelled) {
            setListings([]);
            setLoaded(true);
          }
          return;
        }
        const data = (await r.json()) as { listings: Listing[] };
        if (!cancelled) {
          setListings(data.listings ?? []);
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
  }, [ids, excludeId]);

  // Self-hide when nothing meaningful to show.
  if (!loaded) return null;
  if (listings.length < 2) return null;

  return (
    <section
      aria-label={title}
      style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '24px 16px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
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
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 12,
            fontSize: 11,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {listings.length} on this device
          {/* UX-1g — clears the localStorage history; the rail then
              self-hides (drops below the 2-item threshold). */}
          <button
            type="button"
            onClick={clear}
            aria-label="Clear recently viewed"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              textDecoration: 'underline',
            }}
          >
            Clear all
          </button>
        </span>
      </header>
      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 8,
          // Hide the scrollbar but keep horizontal swipe.
          scrollbarWidth: 'thin',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {listings.map((l) => {
          const img = l.images.find((i) => i.isPrimary) ?? l.images[0];
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
                      : l.listingType === 'SWOP'
                        ? 'Swap'
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
