'use client';

// Wishlist context + hook.
//
// One source of truth for "which listings has the user saved" — a Set
// of listing IDs hydrated on sign-in from /wishlist/ids and kept in
// sync with optimistic add/remove calls. Anything that needs the
// heart state (listing cards, featured rails, listing detail) reads
// from this hook so we don't N+1-fetch the user's wishlist on every
// card render.
//
// Provider must be mounted ONCE in app/layout.tsx (inside ClerkProvider).
// Signed-out users get a no-op state (empty set, toggle no-ops to a
// "please sign in" toast handled by the caller).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useAuth, useUser } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface WishlistState {
  /** True once the initial /wishlist/ids fetch has resolved (or
   * confirmed signed-out). UI can show a neutral state while
   * `ready === false` to avoid flickering an empty heart for one
   * frame before hydration. */
  ready: boolean;
  /** Whether the current user is signed in (mirrors useUser().isSignedIn
   * but exposed here so callers don't need a second hook). */
  isSignedIn: boolean;
  /** Number of saved listings. Used for the tab-bar count badge. */
  count: number;
  /** Returns true if the given listing is in the wishlist. */
  isSaved: (listingId: string) => boolean;
  /** Optimistically toggles a listing's saved state. Returns a promise
   * that resolves once the server confirms, OR rejects (and rolls
   * back) on error. The optimistic update is applied SYNCHRONOUSLY
   * so the heart icon updates without waiting for the network. */
  toggle: (listingId: string) => Promise<void>;
}

const WishlistContext = createContext<WishlistState>({
  ready: false,
  isSignedIn: false,
  count: 0,
  isSaved: () => false,
  toggle: async () => {},
});

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const [ready, setReady] = useState(false);
  // Track the latest Clerk user so we can wipe state on sign-out
  // without keeping a stale set around.
  const lastSignedIn = useRef<boolean | null | undefined>(null);

  // Hydration: on sign-in load the user's saved IDs once.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // Wipe state on sign-out so the next sign-in doesn't briefly
      // show the previous user's hearts.
      setIds(new Set());
      setReady(true);
      lastSignedIn.current = false;
      return;
    }
    // Avoid re-fetching on every re-render of a signed-in session.
    if (lastSignedIn.current === true && ready) return;
    lastSignedIn.current = true;

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setReady(true);
          return;
        }
        const r = await fetch(`${API_URL}/wishlist/ids`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) {
          // Endpoint not deployed yet → leave set empty, mark ready
          // so heart icons render unselected instead of forever
          // showing a "loading" placeholder.
          if (!cancelled) setReady(true);
          return;
        }
        const data = (await r.json()) as string[];
        if (!cancelled) {
          setIds(new Set(data));
          setReady(true);
        }
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken, ready]);

  const isSaved = useCallback(
    (listingId: string) => ids.has(listingId),
    [ids],
  );

  const toggle = useCallback(
    async (listingId: string) => {
      // Signed-out → no-op. Callers should gate the heart on signed-in
      // state (or show a sign-in prompt) before invoking toggle.
      if (!isSignedIn) return;

      const willAdd = !ids.has(listingId);
      // Optimistic update.
      setIds((prev) => {
        const next = new Set(prev);
        if (willAdd) next.add(listingId);
        else next.delete(listingId);
        return next;
      });
      // Mild tap haptic on supported devices (Android Chrome, etc.).
      // iOS doesn't expose vibration to web apps but the no-op is
      // safe.
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(8);
        } catch {
          /* ignore */
        }
      }

      try {
        const token = await getToken();
        if (!token) throw new Error('no-token');
        const r = await fetch(`${API_URL}/wishlist/${listingId}`, {
          method: willAdd ? 'POST' : 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`api-${r.status}`);
      } catch {
        // Rollback the optimistic change so the heart state matches
        // server reality.
        setIds((prev) => {
          const next = new Set(prev);
          if (willAdd) next.delete(listingId);
          else next.add(listingId);
          return next;
        });
        throw new Error('Wishlist toggle failed');
      }
    },
    [isSignedIn, ids, getToken],
  );

  const value = useMemo<WishlistState>(
    () => ({
      ready,
      isSignedIn: !!isSignedIn,
      count: ids.size,
      isSaved,
      toggle,
    }),
    [ready, isSignedIn, ids, isSaved, toggle],
  );

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist(): WishlistState {
  return useContext(WishlistContext);
}
