'use client';

// Sticky featured-listings strip — sits just above the bottom tab bar
// in standalone-PWA mode, on the shopping surface pages only.
//
// Visible on:
//   * /                                 (All listings — homepage)
//   * /?listingType=BUY_NOW             (Marketplace)
//   * /?listingType=AUCTION             (Auctions)
//   * /?listingType=TAKE_A_SHOT         (Take a Shot)
//   * /competitions                     (Competitions)
//
// Mirrors the existing FeaturedRail data source (GET /api/featured/rail)
// but renders ~30% smaller cards in a horizontally-auto-scrolling strip
// that hugs the tab bar. Treats the rail like a persistent mini-player
// — same featured promotions reachable from any of the surface pages
// without having to scroll back to the top.
//
// Sets `body[data-has-sticky-strip="true"]` while mounted so a CSS rule
// in globals.css can extend the body's bottom padding to clear both
// the strip AND the tab bar (otherwise the last row of listings sits
// behind the strip).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useStandalone } from '@/lib/use-standalone';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─── Types (mirror FeaturedRail) ──────────────────────────────────
interface RailSlot {
  id: string;
  slotNumber: number;
  status: 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
  featuredUntil: string | null;
  currentListing: null | {
    id: string;
    title: string;
    price: number | null;
    listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT';
    currentBid: number | null;
    buyNowPrice: number | null;
    seller: { username: string | null };
    images: { url: string }[];
    category: { name: string };
  };
  currentAuction: null | {
    id: string;
    kind: 'SCHEDULED' | 'AD_HOC';
    status: 'OPEN' | 'CLOSED_AWARDED' | 'CLOSED_NO_BIDS' | 'CANCELLED_BY_ADMIN';
    openedAt: string;
    closesAt: string | null;
  };
}

function formatRand(cents: number | null): string {
  if (cents == null) return '—';
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function listingHeadline(l: NonNullable<RailSlot['currentListing']>): string {
  if (l.listingType === 'AUCTION') {
    return formatRand(l.currentBid ?? l.price);
  }
  if (l.listingType === 'TAKE_A_SHOT') {
    return 'Make offer';
  }
  return formatRand(l.price);
}

// Pages the strip is allowed to render on. usePathname() + manual
// match (not searchParams.get — pathname '/' covers every ?listingType
// variant since they all live on the same route).
function shouldShow(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname === '/competitions') return true;
  return false;
}

export function StickyFeaturedStrip() {
  const isStandalone = useStandalone();
  const pathname = usePathname();
  const eligible = isStandalone && shouldShow(pathname);

  const [slots, setSlots] = useState<RailSlot[] | null>(null);

  // Fetch + revalidate every 60s — same cadence as FeaturedRail so a
  // user visiting both surfaces sees the same featured snapshot.
  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/featured/rail`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as RailSlot[];
        if (!cancelled) setSlots(data);
      } catch {
        // Decorative — keep the last good snapshot on network blip.
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [eligible]);

  // Tell globals.css to extend body padding while the strip is mounted
  // (so listing grids don't sit behind it). Cleanup on unmount or when
  // the user navigates off a shopping surface.
  useEffect(() => {
    if (!eligible) return;
    document.body.dataset.hasStickyStrip = 'true';
    return () => {
      delete document.body.dataset.hasStickyStrip;
    };
  }, [eligible]);

  if (!eligible) return null;
  if (!slots || slots.length === 0) return null;

  // Show all 10 slots — occupied slots render as clickable listing
  // cards, vacant / auction-running slots render as "bid for this
  // spot" nudges linking to /featured/bid. Same behaviour as the
  // existing mobile FeaturedRail. (Earlier version filtered to
  // occupied-only, which produced an empty strip when no listings
  // had won featured spots yet — exactly the state of the rail on
  // a fresh site.)
  const live = slots;

  return (
    <aside
      className="app-chrome"
      aria-label="Featured listings"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        // Sit just above the 60pt tab bar (which itself pads
        // env(safe-area-inset-bottom) below it).
        bottom: 'calc(60px + env(safe-area-inset-bottom))',
        zIndex: 50,
        background: 'rgba(15, 15, 15, 0.92)',
        borderTop: '0.5px solid var(--border)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Tiny header band — labels the strip + offers a "bid for spot"
          shortcut. Single row, very short to keep the strip slim. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '4px 12px 0',
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.08em',
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
          }}
        >
          Featured
        </span>
        <Link
          href="/featured/bid"
          style={{
            fontSize: 9.5,
            color: 'var(--red)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Bid for a spot →
        </Link>
      </div>

      <style>{`
        @keyframes ggStickyStripScroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .gg-sticky-strip-track:hover .gg-sticky-strip-inner,
        .gg-sticky-strip-track:active .gg-sticky-strip-inner {
          animation-play-state: paused;
        }
      `}</style>

      <div
        className="gg-sticky-strip-track"
        style={{
          overflow: 'hidden',
          paddingTop: 4,
          paddingBottom: 6,
        }}
      >
        <div
          className="gg-sticky-strip-inner"
          style={{
            display: 'flex',
            gap: 8,
            paddingLeft: 12,
            paddingRight: 12,
            width: 'max-content',
            animation: 'ggStickyStripScroll 70s linear infinite',
          }}
        >
          {/* Doubled track for the seamless loop technique (same as the
              existing FeaturedRail). */}
          {[...live, ...live].map((slot, i) => (
            <StickyCard key={`${slot.id}-${i}`} slot={slot} />
          ))}
        </div>
      </div>
    </aside>
  );
}

// ─── One compact card ─────────────────────────────────────────────
// Sized ~30% smaller than the existing mobile FeaturedRail card
// (200×100 → 140×64 with proportionally smaller padding, image, text).
//
// Occupied slot → clickable listing card with cover photo + price.
// Vacant / auction-running slot → dashed "bid for this spot" nudge
// linking to /featured/bid (same fallback as the inline rail).
function StickyCard({ slot }: { slot: RailSlot }) {
  const featuredGlow =
    '0 0 12px rgba(232, 181, 58, 0.30),' +
    ' 0 0 4px rgba(200, 16, 46, 0.28)';

  const baseStyle: React.CSSProperties = {
    width: 140,
    height: 64,
    padding: 6,
    borderRadius: 6,
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    boxShadow: featuredGlow,
    textDecoration: 'none',
    display: 'flex',
    gap: 7,
    flexShrink: 0,
  };

  if (slot.currentListing) {
    const l = slot.currentListing;
    const cover = l.images[0]?.url;
    return (
      <Link href={`/listings/${l.id}`} style={baseStyle}>
        <div
          style={{
            width: 42,
            height: 42,
            flexShrink: 0,
            borderRadius: 4,
            overflow: 'hidden',
            background: 'var(--bg-inset)',
            position: 'relative',
            alignSelf: 'center',
          }}
        >
          {cover ? (
            <Image
              src={cover}
              alt={l.title}
              fill
              className="object-cover"
              sizes="42px"
            />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
          <div
            style={{
              fontSize: 10.5,
              lineHeight: 1.2,
              color: 'var(--text-primary)',
              fontWeight: 500,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {l.title}
          </div>
          <div
            style={{
              fontSize: 9.5,
              marginTop: 2,
              color: 'var(--red)',
              fontWeight: 600,
            }}
          >
            {listingHeadline(l)}
          </div>
        </div>
      </Link>
    );
  }

  // Vacant / auction-open — dashed border + "bid for this spot" nudge.
  // Centred single-column layout: no image, just slot number + CTA.
  return (
    <Link
      href="/featured/bid"
      style={{
        ...baseStyle,
        background: 'var(--bg-inset)',
        borderStyle: 'dashed',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
        }}
      >
        Slot #{slot.slotNumber}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--red)',
          fontWeight: 600,
        }}
      >
        Bid for this spot →
      </div>
    </Link>
  );
}
