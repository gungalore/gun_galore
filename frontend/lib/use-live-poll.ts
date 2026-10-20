'use client';

import { useEffect, useRef } from 'react';

/**
 * Run `fn` on an interval, but only while it is useful and safe to do so.
 *
 * The marketplace polls instead of pushing: there is no SSE/WebSocket in this
 * codebase, and the house pattern (see use-admin-poll, the feed counts and the
 * auction panel) is a small, cache-busted GET. This hook is the shared part of
 * that pattern for anything a BUYER is reading, so it takes a harder line than
 * the admin one:
 *
 *   - PAUSED WHEN THE TAB IS HIDDEN. A phone in a pocket must not keep the
 *     catalogue warm at the buyer's battery and our database's expense.
 *   - PAUSED OFFLINE. A failed fetch is not an error worth showing; it just
 *     leaves the last good render on screen.
 *   - PAUSED WHILE A FIELD OR DIALOG HAS FOCUS. A silent re-render under
 *     someone mid-search or mid-checkout is the one place polling becomes
 *     user-hostile.
 *
 * A dropped poll is swallowed by design: the caller's refresh path compares
 * against the last good state, so "no answer" must never become "empty page".
 */
export function useLivePoll(
  fn: () => Promise<void> | void,
  intervalMs: number,
  enabled = true,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function paused(): boolean {
      if (typeof document === 'undefined') return true;
      if (document.visibilityState !== 'visible') return true;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return true;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        if (active.isContentEditable) return true;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
          return true;
        }
      }
      const dialog = document.querySelector<HTMLElement>(
        '[role="dialog"], dialog[open], [aria-modal="true"]',
      );
      // getClientRects() is empty for anything inside display:none, so a
      // permanently-mounted-but-closed modal cannot pause polling forever.
      if (dialog && dialog.getClientRects().length > 0) return true;
      return false;
    }

    async function tick() {
      if (cancelled || paused()) return;
      try {
        await fnRef.current();
      } catch {
        // Keep the last good render; the next tick retries.
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), intervalMs);

    // Waking the tab (or coming back online) should not wait a full interval.
    const wake = () => void tick();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, [enabled, intervalMs]);
}
