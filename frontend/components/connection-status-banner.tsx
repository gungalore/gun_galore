'use client';

// Online/offline status banner.
//
// Reads navigator.onLine via useSyncExternalStore (SSR-safe — initial
// snapshot is `true`, hydrates to the actual value on mount).
//
// Visual behaviour:
//   - When offline: slim red sticky bar at the top: "You're offline —
//     actions paused".
//   - When the connection RECOVERS (online flips back true while a
//     previous offline was shown): green "Back online" toast for 3s.
//   - 500 ms debounce on the first drop to avoid flicker on flaky
//     connections (mobile users walking between cell + wifi areas).
//
// Mounted ONCE in app/layout.tsx. Self-positions at the top of the
// viewport above all chrome.

import { useEffect, useState, useSyncExternalStore } from 'react';

function getSnapshot(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

// Initial server snapshot — assume online so we don't render a red
// bar pre-hydration on a healthy connection.
function getServerSnapshot(): boolean {
  return true;
}

export function ConnectionStatusBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // The user-visible state (with 500 ms debounce on first drop so a
  // momentary connection blip doesn't flash the bar).
  const [showOffline, setShowOffline] = useState(false);
  // True once we've seen an offline state — used to gate the
  // "Back online" toast so it doesn't show on initial page load.
  const [wasOffline, setWasOffline] = useState(false);
  const [showRecovered, setShowRecovered] = useState(false);

  useEffect(() => {
    if (!online) {
      // Debounce the offline state — wait 500ms before showing the
      // banner to absorb instant blips.
      const t = window.setTimeout(() => {
        setShowOffline(true);
        setWasOffline(true);
      }, 500);
      return () => window.clearTimeout(t);
    }
    // Came back online.
    if (showOffline) {
      setShowOffline(false);
      if (wasOffline) {
        setShowRecovered(true);
        const t = window.setTimeout(() => setShowRecovered(false), 3000);
        return () => window.clearTimeout(t);
      }
    }
  }, [online, showOffline, wasOffline]);

  if (!showOffline && !showRecovered) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 'env(safe-area-inset-top, 0)',
        left: 0,
        right: 0,
        zIndex: 80, // above PublicNav (z-50) + tab bar (z-55/56)
        padding: '8px 16px',
        background: showOffline ? 'var(--red)' : 'var(--success)',
        color: '#fff',
        fontSize: 13,
        fontWeight: 500,
        textAlign: 'center',
        transition: 'opacity 200ms',
        // No box-shadow per house style.
      }}
    >
      {showOffline
        ? "You're offline — actions paused."
        : 'Back online — you can keep going.'}
    </div>
  );
}
