'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError } from '@/lib/admin-api';

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Poll a fetcher on an interval.
 *
 * ⚠️ FAILURES DO NOT CLEAR THE LAST GOOD DATA. A dropped poll must leave the
 * card showing the last known figure with its timestamp, never an empty state
 * — an empty panel reads as "nothing to do", which is the worst possible
 * wrong answer on a money or health screen.
 *
 * ⚠️ A 401 IS SURFACED, NOT SWALLOWED. The session gate needs to see it to
 * bounce to /admin/login.
 */
export function useAdminPoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Keep the latest fetcher without re-arming the interval on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const value = await fetcherRef.current();
        if (cancelled) return;
        setData(value);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof AdminApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Request failed';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    const id = window.setInterval(() => void run(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tick, ...deps]);

  return { data, error, loading, refresh };
}
