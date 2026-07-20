'use client';

// Sticky featured-listings strip — sits just above the bottom tab bar
// in standalone-PWA mode, on the shopping surface pages only.
//
// Visible on:
//   * /                                 (All listings — homepage)
//   * /?listingType=BUY_NOW             (Marketplace)
//   * /?listingType=AUCTION             (Auctions)
//   * /?listingType=TAKE_A_SHOT         (Take a Shot)
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
import { useScrollDirection } from '@/lib/use-scroll-direction';

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
    listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT' | 'SWOP';
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
  if (l.listingType === 'SWOP') {
    return 'Swap';
  }
  return formatRand(l.price);
}

// Pages the strip is allowed to render on. usePathname() + manual
// match (not searchParams.get — pathname '/' covers every ?listingType
// variant since they all live on the same route).
function shouldShow(pathname: string): boolean {
  if (pathname === '/') return true;
  return false;
}

export function StickyFeaturedStrip() {
  const isStandalone = useStandalone();
  const pathname = usePathname();
  const eligible = isStandalone && shouldShow(pathname);
  const scrollDir = useScrollDirection();
  // Hide in sync with the bottom tab bar when the user scrolls down.
  // Same threshold (managed by useScrollDirection — always show above
  // 80px from the top).
  const hideChrome = scrollDir === 'down';

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

  // Unsold slots COLLAPSE (2026-07-19 — same rule as the desktop rail +
  // homepage marquee): only slots carrying a listing render, and with none
  // occupied the whole strip hides. A wall of "bid for this spot" nudges on
  // the installed app's home reads as a dead site to its most committed
  // users; sellers still find featured bidding in the Shop/More sheets.
  const occupied = (slots ?? []).filter((s) => s.currentListing);
  const visible = eligible && occupied.length > 0;

  // Tell globals.css to extend body padding while the strip is actually
  // VISIBLE (not merely eligible — an empty collapsed strip must not
  // reserve 110px of dead space). Cleanup on hide/unmount/navigation.
  useEffect(() => {
    if (!visible) return;
    document.body.dataset.hasStickyStrip = 'true';
    return () => {
      delete document.body.dataset.hasStickyStrip;
    };
  }, [visible]);

  if (!visible) return null;

  const live = occupied;

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
        // Hide-on-scroll-down sync with the bottom tab bar. Strip
        // height is ~110pt; slide down by tab-bar-offset + strip
        // height + safe-area so it fully disappears off-screen.
        transform: hideChrome
          ? 'translateY(calc(60px + 110px + env(safe-area-inset-bottom)))'
          : 'translateY(0)',
        transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'transform',
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
// Sized to read clearly at a glance on the bottom strip — 182×83
// with a 55×55 cover image. (Earlier draft was 140×64; user asked
// for ~30% larger so the cards stop feeling like an afterthought.)
//
// Occupied slot → clickable listing card with cover photo + price.
// Vacant / auction-running slot → dashed "bid for this spot" nudge
// linking to /featured/bid (same fallback as the inline rail).
function StickyCard({ slot }: { slot: RailSlot }) {
  const featuredGlow =
    '0 0 14px rgba(232, 181, 58, 0.32),' +
    ' 0 0 5px rgba(200, 16, 46, 0.30)';

  const baseStyle: React.CSSProperties = {
    width: 182,
    height: 83,
    padding: 8,
    borderRadius: 8,
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    boxShadow: featuredGlow,
    textDecoration: 'none',
    display: 'flex',
    gap: 9,
    flexShrink: 0,
  };

  if (slot.currentListing) {
    const l = slot.currentListing;
    const cover = l.images[0]?.url;
    return (
      <Link href={`/listings/${l.id}`} style={baseStyle}>
        <div
          style={{
            width: 55,
            height: 55,
            flexShrink: 0,
            borderRadius: 5,
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
              sizes="55px"
            />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
          <div
            style={{
              fontSize: 13.5,
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
              fontSize: 12,
              marginTop: 3,
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

  // Vacant / auction-open — vibrant gold-glow "bid for this spot" nudge
  // (shared .gg-bid-spot rig; operator 2026-07-20 "easy to miss").
  // Centred single-column layout: no image, just slot number + CTA.
  return (
    <Link
      href="/featured/bid"
      className="gg-bid-spot"
      style={{
        ...baseStyle,
        background:
          'radial-gradient(120% 100% at 50% 0%, rgba(232, 181, 58, 0.16) 0%, transparent 70%), var(--bg-inset)',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
      }}
    >
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: '#e8b53a',
          textTransform: 'uppercase',
        }}
      >
        ★ Spot #{slot.slotNumber} open
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--red)',
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <i className="gg-bid-dot" aria-hidden="true" />
        Bid for this spot →
      </div>
    </Link>
  );
}
