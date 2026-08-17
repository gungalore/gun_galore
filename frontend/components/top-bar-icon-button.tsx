'use client';

// TopBarIconButton — shared shell for the icon buttons that sit beside the
// search input in MobileSearchBar (wishlist, cart).
//
// They render side by side, so any style that lives in only one of them is a
// visible mismatch the moment someone tweaks it. One shell, thin callers.
//
// The count pill deliberately matches the Alerts bell and the nav's cart badge
// — a red corner pill is this app's single vocabulary for "there are N things
// waiting for you", and a second dialect would just make the first one quieter.

import Link from 'next/link';
import type { ReactNode } from 'react';

export function TopBarIconButton({
  href,
  label,
  active,
  count,
  children,
}: {
  href: string;
  /** The FULL accessible name, count included — e.g. "Cart, 3 items". The
   *  icon is aria-hidden and the pill is decorative, so this string is the
   *  only thing a screen reader gets. */
  label: string;
  /** Route match — draws the red border/tint so the current destination is
   *  legible without a text label. */
  active: boolean;
  /** Red corner pill. Hidden at 0, capped at "50+" so a hoarder's wishlist
   *  can't widen the button past its slot. */
  count: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Never shrink: on a 320px viewport flexbox would otherwise steal
        // width from the tap targets to feed the search input, and a 30px
        // button is below every touch-target guideline there is.
        flexShrink: 0,
        height: '100%',
        minHeight: 38, // matches LiveSearch input's vertical bounds
        minWidth: 48,
        padding: '0 12px',
        borderRadius: 6,
        background: active ? 'rgba(200,16,46,0.10)' : 'var(--bg-inset)',
        border: active ? '0.5px solid var(--red)' : '0.5px solid var(--border)',
        color: active ? 'var(--red)' : 'var(--text-secondary)',
        textDecoration: 'none',
        transition: 'background 140ms, border-color 140ms, color 140ms',
      }}
    >
      {children}
      {count > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            right: 4,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: 'var(--red)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            // Rides the button's own edge, so it needs a ring in the BAR's
            // colour (not the button's) to read as a separate object.
            border: '1.5px solid var(--bg-deep)',
          }}
        >
          {count > 50 ? '50+' : count}
        </span>
      )}
    </Link>
  );
}
