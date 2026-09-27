'use client';

import { useRef, useState } from 'react';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { useScrollLock } from '@/lib/use-scroll-lock';
import { useStandalone } from '@/lib/use-standalone';

// ────────────────────────────────────────────────────────────────────
// THE JOURNEY, IN A WINDOW.
//
// ⚠️ ITS SHAPE FOLLOWS THE DEVICE, AND SO DOES ITS WAY OUT. A phone gets a
// sheet rising from the foot of the screen; an installed PWA gets the whole
// screen, because there is no browser chrome behind it to return to and a
// floating panel over a void looks like a broken page. Both get the × in the
// corner, Escape, and a tap on the backdrop.
//
// ⚠️ THE DRAG BANNER SAYS WHAT DRAGGING DOES, IN WORDS. A grey pill with no
// label is a guess: half the people who see one try to scroll the page with
// it. "Drag down to close" is a sentence, the pill sits directly above it, and
// the strip is the only thing on the panel that drags — so the platform's own
// scroll still owns the content underneath.
//
// ⚠️ AND THE DRAG IS DELIBERATELY HARD TO TRIGGER BY ACCIDENT. A flick has to
// travel CLOSE_AFTER px, measured from where the finger landed, before it
// closes anything — a short drag springs back. Closing a member's history
// because they tapped-and-twitched is the failure mode this threshold exists
// for.
// ────────────────────────────────────────────────────────────────────

/** How far the panel must be dragged before letting go closes it. */
const CLOSE_AFTER = 110;

export default function TrackerHistorySheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** Where the finger went down, in clientY — `null` between drags. */
  const from = useRef<number | null>(null);
  /** The live offset, readable in pointerup without waiting for a render. */
  const at = useRef(0);

  const standalone = useStandalone();

  // ⚠️ lockScroll IS OFF HERE ON PURPOSE. `useScrollLock` is the one written
  // for the installed app, where the shell pane owns the scroll and locking
  // `body` does nothing at all; the trap's own copy of that logic predates it.
  // The trap still owns the keyboard and Escape.
  const panelRef = useFocusTrap<HTMLDivElement>({ onClose, lockScroll: false });
  useScrollLock(true);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // A drag that starts on the × would otherwise drag and press at once.
    if ((e.target as HTMLElement).closest('button, a')) return;
    from.current = e.clientY;
    at.current = 0;
    setDragging(true);
    // Guarded: jsdom has no pointer capture, and a capture that throws would
    // take the whole drag with it.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (from.current === null) return;
    // Downwards only. Dragging up should do nothing, not lift the sheet.
    const dy = Math.max(0, e.clientY - from.current);
    at.current = dy;
    setDragY(dy);
  }

  function onPointerUp() {
    if (from.current === null) return;
    from.current = null;
    setDragging(false);
    if (at.current >= CLOSE_AFTER) {
      onClose();
      return;
    }
    at.current = 0;
    setDragY(0);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gg-tracker-journey-title"
        // Stands the Ask Boet dock down: he is z-60 too and, being last in
        // <body>, wins the tie on DOM order. Same reason listing-preview-modal
        // carries it.
        data-blocking-overlay="true"
        className={
          'flex w-full flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] ' +
          (standalone
            ? // The whole screen, at every width — a PWA has no chrome behind it.
              'h-[100dvh] max-h-[100dvh] max-w-none rounded-none border-0 sm:h-[100dvh] sm:max-h-[100dvh] sm:max-w-none sm:rounded-none'
            : 'max-h-[92dvh] rounded-t-[16px] sm:max-h-[85vh] sm:max-w-[640px] sm:rounded-[var(--r-md)]')
        }
        style={{
          transform: `translateY(${dragY}px)`,
          // No transition while a finger is down, or the panel would lag the
          // drag by the length of the animation.
          transition: dragging ? 'none' : 'transform 200ms ease',
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative shrink-0 cursor-grab touch-none select-none border-b border-[var(--border)] active:cursor-grabbing"
        >
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-[7px] h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--border-strong)]"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-1.5 pt-[18px]">
            <span className="text-[11.5px] text-[var(--text-secondary)]">
              Drag down to close
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the history"
              className="-mr-1 min-h-[36px] px-2 text-[20px] leading-none text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              ×
            </button>
          </div>
        </div>

        <header className="shrink-0 px-4 pb-3 pt-3">
          <h2
            id="gg-tracker-journey-title"
            className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.2] text-[var(--text-primary)]"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="m-0 mt-0.5 font-mono text-[12px] text-[var(--text-tertiary)]">
              {subtitle}
            </p>
          )}
        </header>

        {/* ⚠️ THE ONLY SCROLLING THING IN HERE, and it stops at its own end —
            `overscroll-contain` keeps a flick at the bottom from pulling the
            page behind the sheet. */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-4 pb-5"
          style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
