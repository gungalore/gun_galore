'use client';

/**
 * THE BENCH — the toast.
 *
 * One at a time, last wins, 2.2 s, then it tells the page it is done and the
 * page clears the message. The component owns the clock and nothing else:
 * `message` in, `onDone` out, exactly as ToastProps declares it.
 */
import * as React from 'react';
import type { ToastProps } from './contract';

/** §7: 2.2 s, one at a time. */
const TOAST_MS = 2200;

/**
 * Clearance above the bottom tab bar, from `Pwa.dc.html`: the board draws the
 * toast at bottom 100 over a 62px bar.
 */
const TAB_BAR_GAP = 38;

// Layout effect in the browser, plain effect on the server. The bottom is
// measured from the live tab bar, and measuring after paint would show the
// toast at the desktop position for one frame and then jump it.
const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Where the toast sits.
 *
 * `.bench .toast` pins it 24px off the bottom, which is right on the desktop.
 * On a phone the tab bar owns that corner, so the toast has to clear it.
 *
 * ⚠️ MEASURED, NOT RE-DERIVED. The bar shows below 768px OR in the installed
 * app at any width, and it grows by the safe-area inset on a notched phone —
 * three conditions already expressed in globals.css. Reading the bar's own
 * height keys on the same truth those rules do (`body:has([data-shell-tabs])`)
 * and cannot drift from them. No bar, or a hidden one, measures 0 and the
 * stylesheet's 24px stands.
 */
function useToastBottom(active: boolean): number | undefined {
  const [bottom, setBottom] = React.useState<number | undefined>(undefined);

  useIsoLayoutEffect(() => {
    if (!active) return;
    const bar = document.querySelector('[data-shell-tabs]');
    const h = bar ? bar.getBoundingClientRect().height : 0;
    setBottom(h > 0 ? h + TAB_BAR_GAP : undefined);
  }, [active]);

  return bottom;
}

function IconTick() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      // The tick sits on the dark toast, where --success at full strength is
      // too dark to read. Lightened toward the toast's own ink with
      // color-mix rather than by inventing a second green.
      stroke="color-mix(in srgb, var(--success) 55%, var(--bg-inset))"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** The failure glyph: a cross on a warning-tinted stroke, same size as the tick. */
function IconCross() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="color-mix(in srgb, var(--warning) 70%, var(--bg-inset))"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Toast({ message, onDone, tone = 'ok' }: ToastProps) {
  const bottom = useToastBottom(message !== null);

  // The latest onDone without restarting the clock. The page rebuilds its
  // callbacks freely; the toast's 2.2 s should not restart because it did.
  const doneRef = React.useRef(onDone);
  React.useEffect(() => {
    doneRef.current = onDone;
  });

  React.useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => doneRef.current(), TOAST_MS);
    // A new message replaces the old one and takes the full 2.2 s with it —
    // "last wins" is this cleanup, not a queue.
    return () => window.clearTimeout(t);
  }, [message]);

  if (!message) return null;

  return (
    // ⚠️ THE SCOPE IS CARRIED, NOT ASSUMED — AND IT CANNOT BE A CLASS ON THE
    // TOAST ITSELF. The module's only rule for this element is `.bench .toast`,
    // a DESCENDANT selector: an element is not its own ancestor, so
    // `className="bench toast"` would match nothing. (OverlayShell gets away
    // with re-declaring `bench` on its own panel because `.bench-modal` /
    // `.bench-sheet` are unscoped top-level rules; there is no such rule here.)
    // A fixed, z-70 layer is exactly the thing a page mounts at its very end,
    // outside the wrapper — and unscoped this loses its pinning, its dark
    // plate and its face, and renders as a plain block in the flow.
    // `display: contents` supplies the ancestor without generating a box, so
    // nothing about the surrounding layout changes.
    <div className="bench" style={{ display: 'contents' }}>
      <div
        // Re-keying on the message remounts the div, so a second toast plays
        // the rise-and-fade again instead of silently swapping its text. (An
        // identical message twice in a row does not replay; the page clears to
        // null between toasts, which restarts it.)
        key={message}
        className="toast"
        role="status"
        aria-live="polite"
        style={{
          ...(bottom !== undefined ? { bottom } : null),
          // `.toast` is nowrap; a long line would otherwise run off both edges
          // of a phone. 360 is the phone board's own cap.
          maxWidth: 'min(360px, calc(100vw - 32px))',
          // Nothing here is clickable, and for 2.2 s it sits over the bottom
          // centre of the screen — where a thumb is. Without this it eats the
          // tap on whatever it happens to be covering.
          pointerEvents: 'none',
        }}
      >
        {tone === 'error' ? <IconCross /> : <IconTick />}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{message}</span>
      </div>
    </div>
  );
}
