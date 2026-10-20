'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLivePoll } from '@/lib/use-live-poll';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// 20s is the browse-grid heartbeat. The poll itself is tiny (two aggregates
// behind /listings/live-version), and only a CHANGED token triggers the
// expensive part - re-running the server-rendered page.
const POLL_MS = 20_000;

// A busy hour of saves must not turn every open tab into a 20s full refresh.
// When the token moves again inside this window we leave it un-acknowledged,
// so the next tick after the window still sees the difference and refreshes.
const MIN_REFRESH_MS = 60_000;

/**
 * Silent catalogue refresh for the discovery grids.
 *
 * Polls a viewer-scoped change token and calls `router.refresh()` only when
 * something actually changed (a listing was published, sold, edited, or
 * saved). This keeps new stock and "sold" transitions appearing without the
 * buyer pulling to refresh, while idle tabs cost one small GET per 20s.
 *
 * The token deliberately includes SAVES: the cards' social-proof counts are
 * part of what must stay current.
 */
export function LiveCatalogRefresh() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const version = useRef<string | null>(null);
  const lastRefresh = useRef(Date.now());

  useLivePoll(
    async () => {
      const token = isSignedIn ? await getToken() : null;
      const res = await fetch(`${API_URL}/listings/live-version`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { v?: unknown };
      if (typeof data.v !== 'string') return;

      // First answer is the baseline, not a change.
      if (version.current === null) {
        version.current = data.v;
        lastRefresh.current = Date.now();
        return;
      }
      if (data.v === version.current) return;
      if (Date.now() - lastRefresh.current < MIN_REFRESH_MS) return;

      version.current = data.v;
      lastRefresh.current = Date.now();
      router.refresh();
    },
    POLL_MS,
    isLoaded,
  );

  return null;
}
