'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLivePoll } from '@/lib/use-live-poll';
import { SocialProofPill } from './social-proof-pill';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// The PDP is a single row lookup, so it can afford to be fresher than a grid.
const POLL_MS = 15_000;

/**
 * Live saved-count + status for a listing the buyer is already looking at.
 *
 * The count is the real Wishlist total and moves locally the moment THIS
 * viewer taps the heart (the provider broadcasts `gg:wishlist`), then
 * reconciles with the server on the next poll. A status change means the
 * listing sold, went to payment-pending or was withdrawn while the buyer had
 * it open - at that point the server-rendered page is stale in ways this
 * component cannot patch (CTAs, banners), so it triggers one silent refresh.
 */
export function LiveListingStats({
  listingId,
  initialCount,
}: {
  listingId: string;
  initialCount: number;
}) {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [count, setCount] = useState(initialCount);
  const status = useRef('ACTIVE');

  // Mirror the viewer's own heart press immediately, before the next poll.
  useEffect(() => {
    function onToggle(event: Event) {
      const detail = (
        event as CustomEvent<{ listingId?: string; saved?: boolean }>
      ).detail;
      if (detail?.listingId !== listingId) return;
      if (typeof detail.saved !== 'boolean') return;
      setCount((current) => Math.max(0, current + (detail.saved ? 1 : -1)));
    }
    window.addEventListener('gg:wishlist', onToggle);
    return () => window.removeEventListener('gg:wishlist', onToggle);
  }, [listingId]);

  const poll = useCallback(async () => {
    const token = isSignedIn ? await getToken() : null;
    const res = await fetch(
      `${API_URL}/listings/${encodeURIComponent(listingId)}/stats`,
      {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      status?: unknown;
      wishlistCount?: unknown;
    };
    if (
      typeof data.wishlistCount === 'number' &&
      Number.isFinite(data.wishlistCount)
    ) {
      setCount(data.wishlistCount);
    }
    if (typeof data.status === 'string' && data.status !== status.current) {
      status.current = data.status;
      router.refresh();
    }
  }, [getToken, isSignedIn, listingId, router]);

  useLivePoll(poll, POLL_MS, isLoaded);

  return <SocialProofPill count={count} minCount={1} />;
}
