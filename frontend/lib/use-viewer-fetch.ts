'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback } from 'react';

/**
 * Client-side twin of `lib/api-viewer.ts` (the server helper).
 *
 * Catalogue endpoints return different results depending on whether the caller
 * is signed in: anonymous callers see only publicly-visible categories, members
 * see the full catalogue. A client component that fetches without the Clerk
 * token therefore shows a signed-in member the cut-down public storefront.
 *
 * CACHING RULE, load-bearing: the browser HTTP cache keys on URL, NOT on the
 * Authorization header. A member's response cached under `/api/categories`
 * would be replayed to the same browser after sign-out — leaking members-only
 * categories to a signed-out session on the same device. So every viewer-varying
 * client fetch uses `cache: 'no-store'`, and any module-level cache must be
 * keyed by signed-in state (see `catCacheKey` usages).
 *
 * Returns null when there is no session, so callers can branch/key on it.
 */
export function useViewerFetch() {
  const { getToken, isSignedIn } = useAuth();

  const viewerFetch = useCallback(
    async (url: string, init?: Omit<RequestInit, 'cache'>) => {
      let token: string | null = null;
      try {
        token = await getToken();
      } catch {
        // No session / Clerk hiccup — proceed anonymously. Degrades to
        // showing LESS, never more.
      }
      return fetch(url, {
        ...init,
        cache: 'no-store',
        headers: {
          ...(init?.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    [getToken],
  );

  return { viewerFetch, isSignedIn: !!isSignedIn };
}

/**
 * Cache key for module-level caches of viewer-varying data. Two buckets only —
 * "member" and "anonymous" — which is all the API distinguishes.
 */
export function viewerCacheKey(isSignedIn: boolean): 'member' | 'anon' {
  return isSignedIn ? 'member' : 'anon';
}
