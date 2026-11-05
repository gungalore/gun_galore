'use client';

import { useEffect } from 'react';

/**
 * Service worker kill switch.
 *
 * Runs automatically in development, and when NEXT_PUBLIC_DISABLE_PWA=true
 * in production. Either way it:
 *   1. Unregisters every registered service worker for this origin
 *   2. Deletes every cache the SW had set up (Cache Storage API)
 *
 * The dev arm exists because `next dev` does not generate a service worker,
 * but a previous local production build can leave one registered on
 * localhost. That stale worker then serves old JS chunks over HMR, which
 * presents as random behaviour that survives reloads and "fixes itself" only
 * after clearing site data.
 *
 * This is how we remotely "kill" a buggy SW we previously shipped.
 * Without this, even after we stop generating /sw.js, the browser
 * keeps running the cached SW from a previous visit until the user
 * manually clears site data — which is asking too much of users.
 *
 * Production stays a no-op unless NEXT_PUBLIC_DISABLE_PWA is 'true', so
 * flipping the env var remains the remote on/off switch.
 *
 * Cost: a useEffect on first render that's idempotent — running it
 * twice does nothing. So no perf concern leaving it in long-term.
 */
export function SwKillSwitch() {
  useEffect(() => {
    const disabled =
      process.env.NODE_ENV !== 'production' ||
      process.env.NEXT_PUBLIC_DISABLE_PWA === 'true';
    if (!disabled) return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));

        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }

        if (regs.length > 0) {
          // Log so devs can see in the console that the kill switch
          // did its job. Users won't see this; the next page nav will
          // just work because no SW intercepts requests anymore.
          // eslint-disable-next-line no-console
          console.log(
            `[sw-killswitch] unregistered ${regs.length} SW(s) + cleared caches`,
          );
        }
      } catch {
        // Silent. If unregister fails (rare), there's nothing useful
        // we can do — user will need to manually clear site data.
      }
    })();
  }, []);

  return null;
}
