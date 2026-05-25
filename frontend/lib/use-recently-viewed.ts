'use client';

// useRecentlyViewed — pure-client localStorage stack of recently-
// viewed listing IDs.
//
// Maintains a most-recent-first list of up to 20 listing IDs the
// user has opened. New visits push the ID to the front (deduped);
// list trims to MAX. The recently-viewed rail uses the IDs to ask
// the backend for fresh listing data via /listings?ids=cuid1,cuid2,…
//
// Why localStorage (not server-side):
//   - No backend round-trip on every listing detail open
//   - Works for signed-out users too
//   - Privacy: never leaves the user's device
//
// Storage size: each ID is ~25 chars + a comma = ~26 bytes. 20 IDs
// = ~520 bytes. Negligible.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'gg-recently-viewed-v1';
const MAX_ENTRIES = 20;

interface UseRecentlyViewed {
  /** Most-recent-first list of listing IDs. Empty array until the
   * effect that reads localStorage has run on mount (avoids the SSR
   * hydration mismatch where the server has no localStorage). */
  ids: string[];
  /** Push a listing to the front of the list. Deduped. Safe to call
   * on every listing-detail mount — internal no-op if the ID is
   * already at position 0. */
  push: (listingId: string) => void;
  /** Wipe the list. Surfaced as a "Clear history" affordance on
   * any UI that wants it. */
  clear: () => void;
}

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string').slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_ENTRIES)));
  } catch {
    /* private mode / quota — silent */
  }
}

export function useRecentlyViewed(): UseRecentlyViewed {
  const [ids, setIds] = useState<string[]>([]);

  // Hydrate on mount. Empty initial state means the SSR'd HTML has
  // no rail content; client renders the rail after read().
  useEffect(() => {
    setIds(read());
    // Listen for changes from other tabs — if the user opens another
    // listing in a different tab, the rail here should update.
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setIds(read());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const push = useCallback((listingId: string) => {
    if (typeof window === 'undefined') return;
    const current = read();
    if (current[0] === listingId) return; // already at top — no-op
    const next = [listingId, ...current.filter((id) => id !== listingId)].slice(0, MAX_ENTRIES);
    write(next);
    setIds(next);
  }, []);

  const clear = useCallback(() => {
    if (typeof window === 'undefined') return;
    write([]);
    setIds([]);
  }, []);

  return { ids, push, clear };
}
