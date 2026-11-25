'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * The Buy CTA, with sign-in moved to the click.
 *
 * Content is behind the 18+ gate, so a signed-out visitor CAN see a listing.
 * Buying, however, is an action and needs an account. This component sends a
 * signed-out click straight to sign-in with the checkout URL as the return
 * path, instead of navigating to `/checkout/...` only for the middleware to
 * bounce it — the difference is one wasted page load and a moment of "why am
 * I on this screen?".
 *
 * A signed-in member gets a plain Link, unchanged. Until the session has
 * loaded we render the Link: navigation to checkout still funnels through
 * middleware, so an early click is safe, never a dead end.
 */
export function BuyNowCta({
  listingId,
  className,
  style,
  children,
}: {
  listingId: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const href = `/checkout/${listingId}`;

  if (isLoaded && !isSignedIn) {
    return (
      <button
        type="button"
        onClick={() =>
          router.push(`/sign-in?redirect_url=${encodeURIComponent(href)}`)
        }
        className={className}
        style={{ ...style, border: style?.border ?? 'none', cursor: 'pointer' }}
      >
        {children}
      </button>
    );
  }

  return (
    <Link href={href} className={className} style={style}>
      {children}
    </Link>
  );
}
