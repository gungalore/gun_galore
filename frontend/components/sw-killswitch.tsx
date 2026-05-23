'use client';

import { useEffect } from 'react';

/**
 * Service worker kill switch.
 *
 * When NEXT_PUBLIC_DISABLE_PWA=true, this component:
 *   1. Unregisters every registered service worker for this origin
 *   2. Deletes every cache the SW had set up (Cache Storage API)
 *
 * This is how we remotely "kill" a buggy SW we previously shipped.
 * Without this, even after we stop generating /sw.js, the browser
 * keeps running the cached SW from a previous visit until the user
 * manually clears site data — which is asking too much of users.
 *
 * The script is a no-op when NEXT_PUBLIC_DISABLE_PWA isn't 'true',
 * so flipping the env var is the on/off switch.
 *
 * Cost: a useEffect on first render that's idempotent — running it
 * twice does nothing. So no perf concern leaving it in long-term.
 */
export function SwKillSwitch() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DISABLE_PWA !== 'true') return;
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
