'use client';

import { useEffect, useRef } from 'react';

// useMarquee — auto-scrolling marquee that is ALSO pausable + drag-pannable.
//
// Replaces the old CSS-keyframe translate approach (which can't be dragged).
// The inner track is DOUBLED by the caller ([...items, ...items]); we drive
// a single `offset` (px) applied as a transform on the inner element and
// wrap it modulo one-copy-width, so the loop stays seamless. Transform (not
// scrollLeft) is used so it works even when one copy is narrower than the
// container (few featured cards) — scrollLeft would clamp.
//
// Behaviour (operator 2026-07-21):
//   - auto-scrolls at `speedPxPerSec`
//   - pauses while the pointer is over the strip (mouse hover)
//   - click-drag pans it (fast drag = fast scroll); auto resumes from
//     wherever you let go
//   - a drag over a card link does NOT navigate (click suppressed if moved)
//   - respects prefers-reduced-motion (no auto-scroll; still draggable)
export function useMarquee(axis: 'x' | 'y', speedPxPerSec = 55) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    const reduce =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let raf = 0;
    let last = 0;
    let offset = 0;
    let paused = false;
    let dragging = false;
    let startClient = 0;
    let startOffset = 0;
    let moved = 0;

    const oneCopy = () =>
      (axis === 'x' ? inner.offsetWidth : inner.offsetHeight) / 2;

    const wrap = (v: number) => {
      const c = oneCopy();
      if (c <= 0) return v;
      return ((v % c) + c) % c;
    };

    const apply = () => {
      inner.style.transform =
        axis === 'x'
          ? `translate3d(${-offset}px,0,0)`
          : `translate3d(0,${-offset}px,0)`;
    };

    const tick = (t: number) => {
      if (!last) last = t;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (!paused && !dragging && !reduce) {
        offset = wrap(offset + speedPxPerSec * dt);
        apply();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onEnter = () => {
      paused = true;
    };
    const onLeave = () => {
      if (!dragging) paused = false;
    };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      startClient = axis === 'x' ? e.clientX : e.clientY;
      startOffset = offset;
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      container.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const cur = axis === 'x' ? e.clientX : e.clientY;
      const delta = cur - startClient;
      moved = Math.max(moved, Math.abs(delta));
      offset = wrap(startOffset - delta);
      apply();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      container.style.cursor = 'grab';
    };
    // Suppress the click that trails a real drag so panning over a card
    // link doesn't navigate. Capture phase so it beats the Link handler.
    const onClickCapture = (e: MouseEvent) => {
      if (moved > 6) {
        e.preventDefault();
        e.stopPropagation();
      }
      moved = 0;
    };

    container.style.cursor = 'grab';
    // Let the cross-axis page scroll pass through; capture the marquee axis.
    container.style.touchAction = axis === 'x' ? 'pan-y' : 'pan-x';
    container.style.userSelect = 'none';
    inner.style.willChange = 'transform';

    container.addEventListener('pointerenter', onEnter);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onUp);
    container.addEventListener('click', onClickCapture, true);

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('pointerenter', onEnter);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.removeEventListener('click', onClickCapture, true);
    };
  }, [axis, speedPxPerSec]);

  return { containerRef, innerRef };
}
