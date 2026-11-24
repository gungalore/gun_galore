'use client';

// Service-worker update gate.
//
// Serwist runs in "prompt-to-update" mode (`skipWaiting: false` +
// `clientsClaim: false`) — a freshly deployed SW installs but PARKS in the
// `waiting` state instead of seizing the open page. That is deliberate: an
// auto-activating SW breaks an already-open PWA when the old page requests a
// chunk the new build replaced. The old SW keeps serving this session until the
// member explicitly refreshes here.
//
// ⚠️ THIS IS A BLOCKING MODAL, NOT A BANNER (operator, 2026-11-24). The old
// bottom banner sat under the floating Report a bug button on the PWA and could
// be dismissed. It now covers the viewport on desktop and PWA, has no dismiss
// control, and traps focus on the one Refresh button, so the stale bundle
// cannot be used by accident.
//
// Detection:
//   1. On mount, a `waiting` worker means this page is already stale.
//   2. `updatefound` + `installed` means a new worker has finished downloading.
//   3. `controllerchange` catches a worker that activated late.
// In every case, the gate appears. Tapping Refresh posts SKIP_WAITING to the
// waiting worker, waits for it to take control, then reloads into the new
// bundle.
//
// Mounted ONCE in app/layout.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';

// sessionStorage key — stamped when the user taps Refresh. After the reload
// lands, the SW's `controllerchange` fires again on the fresh page and, without
// this gate, would immediately re-show the gate. Suppress it for 60s.
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
  const [waiting, setWaiting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const refreshRef = useRef<HTMLButtonElement>(null);

  const applyUpdateAndReload = useCallback(async () => {
    markReloading();
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const waitingWorker = reg?.waiting;
      if (waitingWorker) {
        let done = false;
        const reloadOnce = () => {
          if (done) return;
          done = true;
          window.location.reload();
        };
        // Reload on whichever signal lands first. `controllerchange` is the
        // normal path; the waiting worker's `statechange → activated` is more
        // reliable on iOS standalone. The 3s timeout is the last resort.
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          reloadOnce,
          { once: true },
        );
        waitingWorker.addEventListener('statechange', () => {
          if (waitingWorker.state === 'activated') reloadOnce();
        });
        window.setTimeout(reloadOnce, 3000);
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
    } catch {
      /* fall through to a plain reload */
    }
    // No waiting worker (already active / unsupported) — just reload.
    window.location.reload();
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    let cancelled = false;
    // True for the first 60s after Refresh — the controllerchange that fires
    // on the freshly-reloaded page is the SAME update already acknowledged.
    const inReloadWindow = isInRecentReloadWindow();
    // ⚠️ A FIRST INSTALL ALSO FIRES controllerchange. Without this snapshot, a
    // brand-new visitor would be told to refresh the page they just loaded.
    // A stale page by definition already had a controller at mount.
    const hadControllerAtMount = !!navigator.serviceWorker.controller;

    function trackInstallation(reg: ServiceWorkerRegistration) {
      // Already a waiting worker? — this page is stale.
      if (!inReloadWindow && reg.waiting && navigator.serviceWorker.controller) {
        setWaiting(true);
      }
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (
            installing.state === 'installed' &&
            // A controller exists only for an update, not a first install.
            navigator.serviceWorker.controller &&
            !cancelled &&
            !isInRecentReloadWindow()
          ) {
            setWaiting(true);
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

    function onControllerChange() {
      if (
        cancelled ||
        !hadControllerAtMount ||
        isInRecentReloadWindow()
      ) {
        return;
      }
      setWaiting(true);
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

  // The gate owns the screen: stop the page behind it from scrolling. In the
  // installed app the document itself does not scroll — the shell pane does —
  // so lock both, or a touch drag can still move the board under the overlay.
  useEffect(() => {
    if (!waiting) return;
    const previousBody = document.body.style.overflow;
    const pane = document.querySelector<HTMLElement>('[data-shell-pane]');
    const previousPane = pane?.style.overflow;
    document.body.style.overflow = 'hidden';
    if (pane) pane.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBody;
      if (pane && previousPane !== undefined) pane.style.overflow = previousPane;
    };
  }, [waiting]);

  // Put the one action in reach immediately; there is no other control.
  useEffect(() => {
    if (waiting) refreshRef.current?.focus();
  }, [waiting]);

  if (!waiting) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sw-update-title"
      aria-describedby="sw-update-description"
      onKeyDown={(event) => {
        // No Escape dismissal, and keep Tab on the single action.
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          refreshRef.current?.focus();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        // Above every sheet, the bug-report FAB (60) and the tab bar (55).
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        touchAction: 'none',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 12,
          padding: '22px 20px 20px',
          background: 'var(--sw-banner-bg, var(--bg-card))',
          border: '1px solid var(--sw-banner-line, var(--border))',
          color: 'var(--sw-banner-ink, var(--text-primary))',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h2
          id="sw-update-title"
          style={{
            margin: 0,
            fontFamily: 'var(--font-head)',
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: '-0.01em',
          }}
        >
          Update available
        </h2>
        <p
          id="sw-update-description"
          style={{
            margin: '8px 0 18px',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--sw-banner-ink-dim, var(--text-secondary))',
          }}
        >
          A new version of ALL Outdoor is ready. Refresh now to load the latest
          version — this only takes a moment.
        </p>
        <button
          ref={refreshRef}
          type="button"
          onClick={() => {
            if (reloading) return;
            setReloading(true);
            void applyUpdateAndReload();
          }}
          disabled={reloading}
          style={{
            width: '100%',
            minHeight: 46,
            borderRadius: 8,
            border: 'none',
            background: 'var(--sw-banner-accent, var(--action-primary-bg))',
            color: '#fff',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            fontWeight: 700,
            cursor: reloading ? 'wait' : 'pointer',
            opacity: reloading ? 0.75 : 1,
          }}
        >
          {reloading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
    </div>
  );
}
