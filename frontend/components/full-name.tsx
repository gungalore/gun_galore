'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// THE WHOLE NAME OF A DOCUMENT WHOSE ROW IS TOO NARROW FOR IT.
//
// Operator, 2026-09-07: "make all the documents display their full name when
// the cursor stands still on one for more than 0.75 seconds — and the same for
// the mobile and PWA, just don't know how we are going to manage that since
// there is no cursor."
//
// One component, two gestures, one dwell:
//   • a mouse that rests on the name for HOLD_MS opens it; moving off closes it.
//   • a finger that holds the name for HOLD_MS opens it; lifting closes it.
//     A finger that moves more than a few pixels is a scroll, not a hold, and
//     the timer is dropped so a list can be flicked through a name.
//
// ⚠️ ONLY WHEN THE NAME IS ACTUALLY CUT SHORT. A name that fits its row has
// nothing more to show, and a bubble repeating it would be noise on every
// hover. The check is the browser's own: the text is wider than the box.
//
// ⚠️ NO `title` ATTRIBUTE. The native tooltip has its own delay we cannot set,
// never appears on touch at all, and on iOS a long press over a `title` raises
// the copy sheet instead. We draw the bubble ourselves, fixed-positioned so a
// clipped list row cannot clip it too.
// ────────────────────────────────────────────────────────────────────

export const HOLD_MS = 750;
const MOVE_CANCEL_PX = 8;

export function FullName({
  children,
  className = '',
  as: Tag = 'span',
}: {
  /** The name. A plain string, so we can read it back for the bubble. */
  children: string;
  /** Classes for the clipped element; `truncate` and `block` are added. */
  className?: string;
  as?: 'span' | 'p';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [at, setAt] = useState<{ x: number; y: number; w: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  const close = useCallback(() => {
    clear();
    setAt(null);
  }, [clear]);

  const arm = useCallback(
    (x: number, y: number) => {
      clear();
      const el = ref.current;
      // Nothing to show when the row is wide enough for the whole name.
      if (!el || el.scrollWidth <= el.clientWidth + 1) return;
      start.current = { x, y };
      timer.current = setTimeout(() => {
        const r = el.getBoundingClientRect();
        setAt({ x: r.left, y: r.bottom, w: Math.max(r.width, 160) });
      }, HOLD_MS);
    },
    [clear],
  );

  // Anything that scrolls the page or moves focus takes the bubble with it.
  useEffect(() => {
    if (!at) return;
    const off = () => close();
    window.addEventListener('scroll', off, { capture: true, passive: true });
    window.addEventListener('resize', off);
    window.addEventListener('keydown', off);
    return () => {
      window.removeEventListener('scroll', off, { capture: true });
      window.removeEventListener('resize', off);
      window.removeEventListener('keydown', off);
    };
  }, [at, close]);

  useEffect(() => clear, [clear]);

  const onPointerDown = (e: React.PointerEvent) => {
    // A mouse is handled by the rest below; this is the finger.
    if (e.pointerType === 'mouse') return;
    arm(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) close();
  };
  const onPointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    arm(e.clientX, e.clientY);
  };

  return (
    <>
      <Tag
        ref={ref as React.RefObject<HTMLSpanElement & HTMLParagraphElement>}
        className={`block truncate ${className}`}
        // The long-press context menu (iOS copy sheet, Android selection)
        // would otherwise land on top of the bubble. Only while a hold is
        // armed or showing, so ordinary right-clicks elsewhere are untouched.
        onContextMenu={(e) => {
          if (timer.current || at) e.preventDefault();
        }}
        onPointerEnter={onPointerEnter}
        onPointerLeave={close}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={close}
        onPointerCancel={close}
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
      >
        {children}
      </Tag>
      {at && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[70] rounded-[8px] border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[12.5px] font-medium leading-snug text-[var(--text-primary)] shadow-lg"
          style={{
            left: Math.max(8, Math.min(at.x, window.innerWidth - at.w - 8)),
            top: at.y + 4,
            maxWidth: Math.min(360, window.innerWidth - 16),
            minWidth: Math.min(at.w, window.innerWidth - 16),
            overflowWrap: 'anywhere',
          }}
        >
          {children}
        </span>
      )}
    </>
  );
}
