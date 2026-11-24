'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMotivationBusy } from '@/lib/motivation-busy';

/**
 * The always-on Marketplace / Auction / Community switch.
 *
 * ⚠️ THE "SHOP" TAB IS GONE ON PURPOSE (operator, 2026-11-23). The storefront
 * is three destinations now: the fixed-price Marketplace, timed Auctions, and
 * the members' Community feed. The logo is the way home, so a fourth "Shop"
 * segment only repeated it.
 *
 * It lives in the global chrome (desktop nav, the mobile drawer, and the
 * installed-PWA root header) and it NAVIGATES. The active segment follows the
 * pathname, plus `listingType=AUCTION` on `/` for the auction surface.
 *
 * ⚠️ THE QUERY PARAM IS READ BEHIND A SUSPENSE BOUNDARY. `useSearchParams` in
 * the header used to put the whole header behind a boundary, so the
 * prerendered HTML shipped with no header and it popped in after hydration.
 * The exported wrapper renders a static three-link fallback (Marketplace
 * active) and only the tiny inner component opts into the search params, so
 * the header itself is always present in the first payload.
 */

type Mode = 'marketplace' | 'auction' | 'community';

const MODES: ReadonlyArray<{ key: Mode; label: string; href: string }> = [
  // Marketplace is the BUY_NOW surface, not the bare "/" landing page. The
  // logo and the Home tab already own "/".
  { key: 'marketplace', label: 'Marketplace', href: '/?listingType=BUY_NOW' },
  { key: 'auction', label: 'Auction', href: '/?listingType=AUCTION' },
  { key: 'community', label: 'Community', href: '/community' },
];

type Props = {
  /** Full-width variant for the mobile drawer. */
  full?: boolean;
  /** `sm` is the tighter variant for the installed-PWA shell header. */
  size?: 'md' | 'sm';
};

function ToggleView({
  active,
  full = false,
  size = 'md',
}: Props & { active: Mode }) {
  const activeIndex = Math.max(
    0,
    MODES.findIndex((mode) => mode.key === active),
  );
  const pad = size === 'sm' && !full ? 2 : 3;
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  // Measured, not a fixed third. The labels are different lengths
  // ("Marketplace" is nearly twice "Auction"), and an equal-thirds indicator
  // would sit under the wrong segment on a narrow PWA header. offsetLeft/Width
  // are relative to the padded container, so the indicator hugs the active
  // label exactly at every width.
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = linkRefs.current[activeIndex];
    if (!el) return;
    const measure = () => {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIndex, full, size]);

  return (
    <div
      role="group"
      aria-label="Marketplace sections"
      style={{
        position: 'relative',
        display: 'inline-flex',
        // The labels are nowrap; if this shrinks they overlap rather than
        // wrapping. It is ~190px at size="sm", which fits the 360px root row
        // once the 400px wishlist rule drops the heart.
        flexShrink: 0,
        width: full ? '100%' : undefined,
        padding: pad,
        background: 'var(--bg-inset)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        // The indicator is absolutely positioned, so the links have to lay
        // out over it rather than beside a real flex child.
        isolation: 'isolate',
      }}
    >
      <span
        aria-hidden="true"
        className="gg-view-toggle-indicator"
        style={{
          position: 'absolute',
          top: pad,
          bottom: pad,
          left: 0,
          width: indicator.width,
          borderRadius: 999,
          // The selected segment is the theme action accent, diluted so it
          // stays a pill rather than a second solid CTA: electric blue on the
          // dark theme, veld ochre/brown on the light one. Keeping it
          // translucent lets the track show through (operator, 2026-11-24).
          background: 'color-mix(in srgb, var(--red) 22%, transparent)',
          border: '1px solid var(--red-line)',
          transform: `translateX(${indicator.left}px)`,
          opacity: indicator.width > 0 ? 1 : 0,
        }}
      />
      {MODES.map((mode, index) => {
        const selected = mode.key === active;
        return (
          <Link
            key={mode.key}
            ref={(el) => {
              linkRefs.current[index] = el;
            }}
            href={mode.href}
            aria-current={selected ? 'page' : undefined}
            className="gg-view-toggle-link"
            style={{
              position: 'relative',
              zIndex: 1,
              flex: full ? '1 1 0' : '0 0 auto',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding:
                size === 'sm' && !full ? '5px 4px' : '6px 12px',
              borderRadius: 999,
              color: selected
                ? 'var(--text-primary)'
                : 'var(--text-secondary)',
              fontSize: size === 'sm' && !full ? 10 : 13,
              fontWeight: 600,
              lineHeight: 1,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {mode.label}
          </Link>
        );
      })}
    </div>
  );
}

function ViewModeToggleWithParams(props: Props) {
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();

  const community =
    pathname === '/community' || pathname.startsWith('/community/');
  // Hero landing pages, category pages and every other shop route are the
  // Marketplace surface. Only the explicit auction surface on "/" is Auction.
  const auction =
    !community &&
    pathname === '/' &&
    searchParams.get('listingType') === 'AUCTION';

  const active: Mode = community
    ? 'community'
    : auction
      ? 'auction'
      : 'marketplace';

  return <ToggleView {...props} active={active} />;
}

export function ViewModeToggle(props: Props) {
  const busy = useMotivationBusy();

  // Switching views mid-save would drop the member out of an in-flight action;
  // see lib/motivation-busy.ts.
  if (busy) return null;

  return (
    <Suspense fallback={<ToggleView {...props} active="marketplace" />}>
      <ViewModeToggleWithParams {...props} />
    </Suspense>
  );
}
