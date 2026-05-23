'use client';

// useStandalone() — true when the app is running as an installed PWA
// (no browser chrome), false when running in a normal browser tab.
//
// Two signals because no single API covers everything:
//   * `matchMedia('(display-mode: standalone)')` — modern browsers
//     (Chrome, Edge, Samsung, Firefox-on-Android, Safari 18+).
//   * `(navigator as any).standalone === true` — iOS Safari (which
//     does NOT honour the display-mode media query as of iOS 17;
//     it has its own legacy property instead).
//
// SSR-safe via useSyncExternalStore: server renders `false`, client
// hydrates with the real value, no warning, and the hook re-renders
// if the user switches between window modes (rare but possible).
//
// We also mirror the value onto <html data-standalone="true"> via the
// inline script in app/layout.tsx — that runs before paint so any
// CSS gated on `html[data-standalone="true"]` applies on the very
// first frame (no flash where the top nav shows then disappears).

import { useSyncExternalStore } from 'react';

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  if (mql?.matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mql = window.matchMedia?.('(display-mode: standalone)');
  if (!mql) return () => {};
  // .addEventListener exists on every browser we support; the older
  // .addListener fallback is no longer needed (Safari 14+, Chrome 14+).
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

// SSR snapshot — always false. Real value populates on hydration.
function getServerSnapshot(): boolean {
  return false;
}

export function useStandalone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
