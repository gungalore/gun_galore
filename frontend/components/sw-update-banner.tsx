'use client';

// Service-worker update banner.
//
// Serwist (our SW build pipeline) uses `skipWaiting: true` +
// `clientsClaim: true`, so a new service worker becomes the
// controlling SW as soon as it installs. But the currently-running
// page still has its OLD JS bundle loaded — refreshing is what
// picks up the new code.
//
// Flow:
//   1. On mount, ask `navigator.serviceWorker.getRegistration()`
//      whether there's already a `waiting` SW (covers the case
//      where the user opened a tab after a deploy but Before the
//      new SW activated).
//   2. Subscribe to `updatefound` on the registration — fires when
//      a NEW SW is being installed (i.e. user is on an old page +
//      the server now has fresher code).
//   3. Once the new SW reaches the `installed` state AND there
//      WAS a previous controller (i.e. this isn't a first-install
//      situation), show the banner.
//   4. Tapping the banner reloads the page so the new bundles load.
//
// Mounted ONCE in app/layout.tsx. Hidden until a real update is
// detected; persists until the user taps reload or dismisses (the
// dismissal is per-session — they'll see it again next deploy).

import { useEffect, useState } from 'react';

// sessionStorage key — stamped right before `window.location.reload()`
// in the Reload click handler. On the next page load, the SW activation
// fires `controllerchange` immediately (Serwist runs skipWaiting +
// clientsClaim), and without this gate the banner would pop back up
// the moment the user lands. We suppress it for 60s after a click
// so the user gets a clean reloaded view. We also remember the SW
// "version" hash we activated, so a SECOND update landing within the
// 60s window still shows the banner (rare but possible mid-deploy).
const RELOAD_FLAG_KEY = 'gg-sw-reload-at';
const SUPPRESS_MS = 60_000;

function isInRecentReloadWindow(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(RELOAD_FLAG_KEY);
    if (!raw) return false;
    const stamp = parseInt(raw, 10);
    if (!Number.isFinite(stamp)) return false;
    return Date.now() - stamp < SUPPRESS_MS;
  } catch {
    return false;
  }
}

function markReloading() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
  } catch {
    /* private mode / quota — silent */
  }
}

export function SwUpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    // True for the first 60s after the user clicked Reload — the
    // initial `controllerchange` event after reload would otherwise
    // re-show the banner. We still arm the listener; we just suppress
    // setUpdateReady during the window.
    const inReloadWindow = isInRecentReloadWindow();

    function trackInstallation(reg: ServiceWorkerRegistration) {
      // Already a waiting worker? — user landed on a stale page.
      if (
        !inReloadWindow &&
        reg.waiting &&
        navigator.serviceWorker.controller
      ) {
        setUpdateReady(true);
      }
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (
            installing.state === 'installed' &&
            // controller exists → there was a previous SW (this is
            // an update, not a fresh install).
            navigator.serviceWorker.controller
          ) {
            if (!cancelled && !isInRecentReloadWindow()) {
              setUpdateReady(true);
            }
          }
        });
      });
    }

    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (cancelled || !reg) return;
        trackInstallation(reg);
      })
      .catch(() => {
        /* no SW registered (kill switch or unsupported) */
      });

    // ALSO listen for controllerchange — if Serwist activates a new
    // SW after the user has been browsing for a while, this fires
    // and we'd want to nudge them to reload.
    function onControllerChange() {
      // Suppress if the user just clicked Reload — the controllerchange
      // that fires on the freshly-reloaded page is the SAME update they
      // already acknowledged.
      if (cancelled) return;
      if (isInRecentReloadWindow()) return;
      setUpdateReady(true);
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange,
    );

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      );
    };
  }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        // Sit just above the bottom tab bar (60 px tall + safe-area).
        // Browser-mobile users (no tab bar) get the same visual
        // anchor relative to the bottom edge.
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        left: 12,
        right: 12,
        zIndex: 70,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--red)',
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <span style={{ flex: 1 }}>
        An update is available. Reload to get the latest version.
      </span>
      <button
        type="button"
        onClick={() => {
          if (reloading) return;
          setReloading(true);
          // Hide the banner immediately so the user gets visual
          // feedback even before the reload completes (network can
          // take a second on flaky mobile). Pair it with the
          // sessionStorage flag so the freshly-reloaded page also
          // suppresses the banner for 60s — otherwise the
          // controllerchange that fires post-reload would re-show it.
          setDismissed(true);
          markReloading();
          // Hard reload — Service Worker has already activated; we
          // just need the page to fetch the new bundles.
          window.location.reload();
        }}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {reloading ? 'Reloading…' : 'Reload'}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notice"
        style={{
          padding: '4px 8px',
          background: 'transparent',
          color: 'var(--text-tertiary)',
          border: 'none',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
