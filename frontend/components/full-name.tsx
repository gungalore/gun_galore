'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// THE WHOLE NAME OF A DOCUMENT, WHEN THE POINTER RESTS ON ITS CARD.
//
// Operator, 2026-09-07: "if the mouse stands still for longer than 0.75 on
// the card it must pop up the full name", and the earlier bubble was "way too
// small". So:
//   • the listener sits on the CARD - the nearest ancestor marked
//     data-name-card - not on the name, and it fires when the mouse has not
//     moved for HOLD_MS anywhere on it; moving again hides it and re-arms;
//   • on a phone or the PWA a finger held still on the card for HOLD_MS does
//     the same, and lifting or scrolling hides it;
//   • it shows whether or not the row cut the name short - the point is the
//     name, at a size that can be read, wherever the pointer is;
//   • no native `title`: its delay cannot be set and it never shows on touch.
// ────────────────────────────────────────────────────────────────────

export const HOLD_MS = 750;
const MOVE_CANCEL_PX = 8;

export function FullName({
  children,
  className = '',
  as: Tag = 'span',
}: {
  /** The name. A plain string, so we can show it again in the bubble. */
  children: string;
  /** Classes for the clipped element; `block truncate` are added. */
  className?: string;
  as?: 'span' | 'p';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host: HTMLElement = (el.closest('[data-name-card]') as HTMLElement | null) ?? el;

    const hide = () => {
      clear();
      last.current = null;
      setAt(null);
    };
    const arm = (x: number, y: number) => {
      clear();
      last.current = { x, y };
      timer.current = setTimeout(() => setAt({ x, y }), HOLD_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        // Any movement restarts the clock; a shown bubble goes away until the mouse rests again.
        setAt(null);
        arm(e.clientX, e.clientY);
        return;
      }
      // A finger that travels is a scroll, not a hold.
      if (!last.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) hide();
    };
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') arm(e.clientX, e.clientY);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') arm(e.clientX, e.clientY);
    };
    const onContext = (e: Event) => {
      // The long-press copy sheet would otherwise land on top of the bubble.
      if (timer.current || last.current) e.preventDefault();
    };
    host.addEventListener('pointerenter', onEnter);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', hide);
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerup', hide);
    host.addEventListener('pointercancel', hide);
    host.addEventListener('contextmenu', onContext);
    return () => {
      hide();
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', hide);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointerup', hide);
      host.removeEventListener('pointercancel', hide);
      host.removeEventListener('contextmenu', onContext);
    };
  }, [clear]);

  // Anything that scrolls the page or moves focus takes the bubble with it.
  useEffect(() => {
    if (!at) return;
    const off = () => setAt(null);
    window.addEventListener('scroll', off, { capture: true, passive: true });
    window.addEventListener('resize', off);
    window.addEventListener('keydown', off);
    return () => {
      window.removeEventListener('scroll', off, { capture: true });
      window.removeEventListener('resize', off);
      window.removeEventListener('keydown', off);
    };
  }, [at]);

  const width = typeof window === 'undefined' ? 480 : Math.min(480, window.innerWidth - 24);
  const left = at ? Math.max(12, Math.min(at.x - 24, (typeof window === 'undefined' ? 0 : window.innerWidth) - width - 12)) : 0;

  return (
    <>
      <Tag ref={ref as React.RefObject<HTMLSpanElement & HTMLParagraphElement>} className={`block truncate ${className}`}>
        {children}
      </Tag>
      {at && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[70] rounded-[12px] border-2 border-[var(--border-hover)] bg-[var(--bg-card)] px-4 py-3 text-[16px] font-semibold leading-snug text-[var(--text-primary)] shadow-2xl"
          style={{ left, top: at.y + 18, width: 'max-content', maxWidth: width, overflowWrap: 'anywhere' }}
        >
          {children}
        </span>
      )}
    </>
  );
}
