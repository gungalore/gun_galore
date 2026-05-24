'use client';

// Heart-shaped Save-for-later button.
//
// Two visual modes:
//   - "overlay"   — absolutely-positioned heart pill on a listing card
//                   image. Default. Used on listing cards + featured
//                   rails + sticky featured strip.
//   - "inline"    — full-width / pill button on the listing-detail
//                   page next to the Buy / Share CTAs.
//
// Always stops propagation + preventDefault when nested inside a Link
// (every listing card wraps the image in <Link>), so the parent
// navigation does NOT trigger when the user only tapped the heart.
//
// When signed out, the heart still renders but the press surfaces a
// gentle "Sign in to save listings" message via an inline overlay
// rather than silently no-op-ing. Doesn't auto-redirect — the user
// is mid-browse and doesn't want to be yanked to the sign-in screen.

import { useState } from 'react';
import { SignInButton } from '@clerk/nextjs';
import { useWishlist } from '@/lib/use-wishlist';

interface Props {
  listingId: string;
  /** Visual variant. "overlay" floats on a card image; "inline" is a
   * full-width pill for use next to other CTAs on listing detail. */
  variant?: 'overlay' | 'inline';
  /** Optional callback when the toggle succeeds (lets the parent
   * surface a toast). */
  onChange?: (saved: boolean) => void;
}

export function WishlistButton({
  listingId,
  variant = 'overlay',
  onChange,
}: Props) {
  const { isSignedIn, isSaved, toggle, ready } = useWishlist();
  const [busy, setBusy] = useState(false);
  // When signed-out users tap the heart, briefly show a sign-in
  // hint (auto-clears after 2.5s). Avoids the worse alternatives of
  // a silent no-op or a full-page redirect.
  const [signInHint, setSignInHint] = useState(false);

  const saved = isSaved(listingId);

  async function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Card images wrap in <Link>; the parent navigation must not fire.
    e.preventDefault();
    e.stopPropagation();
    if (!isSignedIn) {
      setSignInHint(true);
      window.setTimeout(() => setSignInHint(false), 2500);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await toggle(listingId);
      onChange?.(!saved);
    } catch {
      // Hook rolled back automatically; surface nothing intrusive —
      // the heart returning to its previous state is enough feedback.
    } finally {
      setBusy(false);
    }
  }

  const fill = saved ? 'var(--red)' : 'none';
  const stroke = saved ? 'var(--red)' : '#fff';
  // The icon's bounding circle. Slightly larger hit area than visual
  // size for thumb-friendly tapping.
  const iconSize = variant === 'overlay' ? 28 : 18;

  const heart = (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        transition: 'transform 140ms cubic-bezier(0.4, 0, 0.2, 1)',
        transform: saved ? 'scale(1.06)' : 'scale(1)',
      }}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !ready}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 16px',
          borderRadius: 8,
          background: saved ? 'rgba(200,16,46,0.08)' : 'var(--bg-card)',
          border: `0.5px solid ${saved ? 'var(--red)' : 'var(--border)'}`,
          color: saved ? 'var(--red)' : 'var(--text-secondary)',
          fontSize: 14,
          fontWeight: 500,
          cursor: busy ? 'wait' : 'pointer',
          transition: 'background 140ms, border-color 140ms, color 140ms',
        }}
      >
        {heart}
        {saved ? 'Saved' : 'Save to wishlist'}
      </button>
    );
  }

  // overlay variant
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !ready}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
        style={{
          // Absolute-positioned by the parent (listing card uses
          // `relative` on the image container). Wrapping with a span
          // lets the parent decide where it sits without us hardcoding
          // top/right values.
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 2,
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(10, 10, 10, 0.55)',
          border: '0.5px solid rgba(255,255,255,0.12)',
          // No drop shadow per house style. The semi-transparent
          // dark background gives enough separation from the image
          // without needing a glow.
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: busy ? 'wait' : 'pointer',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          transition: 'background 140ms, transform 140ms',
        }}
      >
        {heart}
      </button>
      {signInHint && (
        /* Tiny non-blocking toast anchored to the heart. Renders only
           on signed-out tap; auto-clears via setTimeout. Stops click
           propagation so a stray tap doesn't bubble. */
        <SignInButton mode="modal">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            style={{
              position: 'absolute',
              top: 48,
              right: 6,
              zIndex: 3,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border-hover)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              lineHeight: 1.3,
              cursor: 'pointer',
              maxWidth: 160,
              textAlign: 'left',
              whiteSpace: 'normal',
            }}
          >
            Sign in to save listings →
          </button>
        </SignInButton>
      )}
    </>
  );
}
