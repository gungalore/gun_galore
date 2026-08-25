'use client';

// ────────────────────────────────────────────────────────────────────
// THE FEATURED SLOT, IN THE GRID.
//
// A paid placement rendered as an ordinary listing card wearing a gold
// hairline and a "Featured" eyebrow — sitting in the flow of the results,
// where the eyes already are.
//
// ⚠️ THIS REPLACES THE STICKY BOTTOM STRIP, AND THE REASON IS ARITHMETIC.
// In the installed app the strip reserved 110px and the tab bar 60px, and
// globals.css padded the body by both: 170 of an iPhone 13's 812 points —
// 21% of the screen — spoken for before a single product loaded. A band that
// is always there is also a band people stop seeing; it sat below the fold of
// attention all day and readers learned to look past it, which is the worst
// possible outcome for something a seller PAID for.
//
// In-feed is the better product, not just the cheaper one: it is read as stock
// rather than as an advert, so it earns attention instead of spending it. What
// it must never be is disguised — hence the gold rule, the gold eyebrow and
// the word "Featured", which stay whatever else changes here.
//
// ⚠️ GOLD IS THE PAID-PLACEMENT SIGNAL AND NOTHING ELSE. Brand red means
// price / primary action / live. If a future card needs a third state, it does
// not get gold.
// ────────────────────────────────────────────────────────────────────

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useViewerFetch } from '@/lib/use-viewer-fetch';
import { CARD_PHOTO_ASPECT } from './listing-card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface RailListing {
  id: string;
  title: string;
  price: number | null;
  listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT' | 'SWOP';
  currentBid: number | null;
  images: { url: string }[];
  category: { name: string };
}

interface RailSlot {
  id: string;
  currentListing: RailListing | null;
}

function rand(cents: number | null): string {
  if (cents == null) return '—';
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function headline(l: RailListing): string {
  if (l.listingType === 'AUCTION') return rand(l.currentBid ?? l.price);
  if (l.listingType === 'TAKE_A_SHOT') return 'Make an offer';
  if (l.listingType === 'SWOP') return 'Swap';
  return rand(l.price);
}

/**
 * One featured listing, shaped like a card in the grid it sits in.
 *
 * Renders nothing at all when no slot is sold — the cold-start pitch on the
 * homepage already asks for bids, and a second empty-state in the middle of
 * the results would be a hole in the grid.
 *
 * @param index which occupied slot to show, so two of these on one page do not
 *              show the same listing.
 */
export function FeaturedInFeedCard({ index = 0 }: { index?: number }) {
  const { viewerFetch } = useViewerFetch();
  const [slots, setSlots] = useState<RailSlot[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // ⚠️ viewerFetch, NOT a cached fetch. A featured slot can hold a
        // members-only listing, and the backend blanks it for signed-out
        // callers — a shared cache here would serve one audience's occupant
        // to the other. See the public-visibility rules in CLAUDE.md.
        const res = await viewerFetch(`${API_URL}/featured/rail`);
        if (!res.ok) return;
        const data = (await res.json()) as RailSlot[];
        if (!cancelled) setSlots(Array.isArray(data) ? data : []);
      } catch {
        // Decorative. A network blip must never break the results grid it is
        // sitting inside.
      }
    }
    load();
    // Same 30s cadence as the rail, so a listing that sells drops out of both
    // surfaces at the same time rather than lingering in one.
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [viewerFetch]);

  const occupied = (slots ?? []).filter((s) => s.currentListing);
  if (occupied.length === 0) return null;
  const listing = occupied[index % occupied.length].currentListing!;
  const photo = listing.images?.[0];

  return (
    <Link href={`/listings/${listing.id}`} className="block group">
      <div
        className="rounded-[10px] overflow-hidden h-full transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--gold-line)',
        }}
      >
        <p
          className="flex items-center gap-1.5 px-2.5 pt-2"
          style={{
            fontSize: 9.5,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            fontFamily: 'var(--font-head)',
            fontWeight: 600,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.9 6.26L21.5 9.3l-4.9 4.46 1.3 6.74L12 17.2l-5.9 3.3 1.3-6.74L2.5 9.3l6.6-1.04Z" />
          </svg>
          Featured
        </p>

        <div className="relative" style={{ paddingBottom: CARD_PHOTO_ASPECT }}>
          {photo ? (
            <Image
              src={photo.url}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
            >
              No photo
            </div>
          )}
          <span
            className="absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{ background: 'rgba(0,0,0,0.72)', color: 'var(--text-secondary)' }}
          >
            {listing.category?.name}
          </span>
        </div>

        <div className="p-3">
          <p
            className="text-[13px] leading-snug line-clamp-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {listing.title}
          </p>
          <p
            className="mt-1.5"
            style={{
              color: 'var(--red)',
              fontWeight: 600,
              fontFamily: 'var(--font-head)',
              fontSize: 17,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {headline(listing)}
          </p>
        </div>
      </div>
    </Link>
  );
}
