'use client';

// Service-worker update banner.
//
// Serwist runs in "prompt-to-update" mode (`skipWaiting: false` +
// `clientsClaim: false`) — a freshly deployed SW installs but PARKS in
// the `waiting` state instead of seizing the open page. That's
// deliberate: an auto-activating SW breaks an already-open PWA when the
// old page then requests a chunk the new build replaced. So the old SW
// keeps serving this session cleanly until the user opts in here.
// Tapping Reload posts SKIP_WAITING to the waiting worker, waits for it
// to take control (`controllerchange`), then reloads into the new bundle.
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
//   4. Tapping the banner activates the waiting worker (SKIP_WAITING)
//      and reloads once it takes control, so the new bundles load.
//
// Mounted ONCE in app/layout.tsx. Hidden until a real update is
// detected; persists until the user taps reload or dismisses (the
// dismissal is per-session — they'll see it again next deploy).

import { useEffect, useState } from 'react';

// sessionStorage key — stamped when the user taps Reload (inside
// applyUpdateAndReload). After the reload lands, the SW's
// `controllerchange` fires again on the fresh page and, without this
// gate, would immediately re-show the banner. We suppress it for 60s
// after a tap so the reloaded view stays clean.
const RELOAD_FLAG_KEY = 'gg-sw-reload-at';
const SUPPRESS_MS = 60_000;

/**
 * Dismissal, persisted — and scoped to ONE update.
 *
 * 🚨 IT USED TO BE A BARE `useState(false)` THAT WAS NEVER RESET, which broke
 * in both directions at once:
 *
 *  · TOO STICKY. Tapping × on the first deploy's banner set `dismissed` for the
 *    life of the tab. Every later update still fired setUpdateReady(true)
 *    internally and never reached the screen — so an admin who dismissed once
 *    in the morning was never told again, and kept working against stale code
 *    with no way to know. On the Desk that is the surface where the answer to
 *    "why did that not save" is "you are on yesterday's bundle".
 *
 *  · TOO LEAKY. Being in-memory only, it also did not survive a remount — and
 *    the file's own header claimed the dismissal was "per-session". A mobile
 *    tab suspended by the OS and resumed comes back with dismissed=false and
 *    re-shows a notice the operator already waved away.
 *
 * The fix is one key holding WHICH update was dismissed. A fresh
 * updatefound → installed cycle is a genuinely different service worker, so it
 * clears the key and the banner returns; a remount inside the same update
 * reads the key and stays quiet.
 */
const DISMISS_KEY = 'gg-sw-dismissed-generation';

/** Bumped once per detected update, so a dismissal can name the one it meant. */
let updateGeneration = 0;

function readDismissedGeneration(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function markDismissed(generation: number) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DISMISS_KEY, String(generation));
  } catch {
    /* private mode / quota — falls back to in-memory only */
  }
}

function clearDismissed() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

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
  // The generation this banner is showing, and the one the operator waved
  // away. Equal => stay hidden; a newer generation => show again.
  const [generation, setGeneration] = useState(0);
  const [dismissedGeneration, setDismissedGeneration] = useState<number | null>(
    () => readDismissedGeneration(),
  );
  const dismissed = dismissedGeneration !== null && dismissedGeneration >= generation;

  // Activate the parked (waiting) service worker, then reload into the
  // new bundle. Because the SW ships with `skipWaiting: false`, a plain
  // reload would NOT pick up the new code (the old worker still controls
  // the page). We message the waiting worker to skipWaiting and reload
  // the moment it takes control. A short timeout is a safety net in case
  // `controllerchange` doesn't fire (or there's no waiting worker).
  async function applyUpdateAndReload() {
    // Suppress the banner on the freshly-reloaded page (see RELOAD_FLAG_KEY).
    markReloading();
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const waiting = reg?.waiting;
      if (waiting) {
        let done = false;
        const reloadOnce = () => {
          if (done) return;
          done = true;
          window.location.reload();
        };
        // Reload on whichever signal lands first. `controllerchange` is
        // the normal path; the waiting worker's `statechange → activated`
        // is a more reliable trigger on iOS standalone (where
        // controllerchange sometimes doesn't fire). The 3s timeout is a
        // last-resort fallback if neither arrives.
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          reloadOnce,
          { once: true },
        );
        waiting.addEventListener('statechange', () => {
          if (waiting.state === 'activated') reloadOnce();
        });
        window.setTimeout(reloadOnce, 3000);
        waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
    } catch {
      /* fall through to a plain reload */
    }
    // No waiting worker (already active / unsupported) — just reload.
    window.location.reload();
  }

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
        // Same update the stored dismissal (if any) refers to — do not
        // clear it; a remount must not re-raise a waved-away notice.
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
              // 🚨 A NEW WORKER FINISHED INSTALLING — a different update
              // from any the operator has already dismissed. Bump past the
              // stored generation and clear it, or a single × in the
              // morning silences every deploy for the rest of the day.
              updateGeneration += 1;
              clearDismissed();
              setDismissedGeneration(null);
              setGeneration(updateGeneration);
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
      className="gg-sw-banner"
      style={{
        position: 'fixed',
        // Sit just above the bottom tab bar. The shop's bar is
        // --shell-tab-h (62px), so 72 clears it with a 10px gap.
        //
        // ⚠️ THE DESK'S BAR IS 78px, NOT 62. This banner renders on EVERY
        // route — it is mounted in the root layout with no path check — so on
        // the Desk the hard-coded 72 put it 6px INSIDE the bottom tab bar.
        // The lift is a variable now, and globals.css raises it for the Desk.
        bottom: 'calc(var(--sw-banner-lift, 72px) + env(safe-area-inset-bottom))',
        left: 12,
        right: 12,
        // ⚠️ 58, NOT 70. The house rule (globals.css) is that modals and
        // sheets live at z >= 60 and must be able to cover the chrome, and the
        // shop's tab bar sits at 55 as the number that rule is measured
        // against. At 70 this ambient notice was IN modal territory: on the
        // Desk it painted over an open drawer (z 61), so a Reload button
        // floated on top of a half-finished money decision — and pressing it
        // discards that work. 58 is above the chrome, below every modal.
        zIndex: 58,
        padding: '12px 14px',
        borderRadius: 12,
        // Shop skin by default; the Desk overrides these three in globals.css.
        // They were flat shop tokens, which resolve on the Desk too — to
        // #FFFFFF on a #101312 ground, with the brand red on a surface whose
        // rule is that colour is ONLY ever state.
        background: 'var(--sw-banner-bg, var(--bg-card))',
        border: '0.5px solid var(--sw-banner-line, var(--red))',
        color: 'var(--sw-banner-ink, var(--text-primary))',
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
          // take a second on flaky mobile). applyUpdateAndReload stamps
          // the sessionStorage flag so the freshly-reloaded page also
          // suppresses the banner for 60s — otherwise the
          // controllerchange that fires post-reload would re-show it.
          markDismissed(generation);
          setDismissedGeneration(generation);
          void applyUpdateAndReload();
        }}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          background: 'var(--sw-banner-accent, var(--red))',
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
        onClick={() => {
          markDismissed(generation);
          setDismissedGeneration(generation);
        }}
        aria-label="Dismiss update notice"
        style={{
          padding: '4px 8px',
          background: 'transparent',
          color: 'var(--sw-banner-ink-dim, var(--text-tertiary))',
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
