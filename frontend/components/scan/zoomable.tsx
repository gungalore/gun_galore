'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// Pinch, drag and double-tap a photograph.
//
// ⚠️ POINTER EVENTS, NOT WEBKIT GESTURE EVENTS. Safari exposes
// `gesturestart`/`gesturechange`, which give scale and rotation for free and
// are considerably less code. They are also WebKit-only, so building on them
// ships pinch-to-zoom to the iPhone and nothing to the Samsung — exactly the
// split the operator's rule forbids: "no feature gets deployed for the one and
// not for the other". Pointer events are on both, so both get the same
// behaviour and there is one implementation to be wrong.
//
// ⚠️ AND NOT THE BROWSER'S OWN PINCH ZOOM. This lives inside a fixed,
// full-screen overlay; the page behind it does not scroll and the visual
// viewport does not pan. Leaving it to the browser means the member pinches
// and nothing happens, which is what they will report.
// ────────────────────────────────────────────────────────────────────

/** Furthest in. Past about 6x a 1200px preview is showing its own pixels. */
export const MAX_SCALE = 6;
export const DOUBLE_TAP_SCALE = 2.5;
/** How long between taps still counts as a double tap. */
const DOUBLE_TAP_MS = 300;
/** How far apart two taps may land and still be the same gesture, in px. */
const DOUBLE_TAP_SLOP = 24;
/** Below this we call it "not zoomed" — floating point never lands on 1. */
export const ZOOMED_AT = 1.01;

interface Point {
  x: number;
  y: number;
}

/**
 * Keep a transformed image overlapping its frame.
 *
 * ⚠️ CLAMPED AGAINST THE HOST BOX, NOT THE IMAGE'S NATURAL SIZE. The image is
 * object-fit: contain inside the host, so its rendered box is the host's box in
 * whichever axis is letterboxed. Clamping against naturalWidth lets a portrait
 * photograph in a landscape host be dragged entirely off screen, and there is
 * no gesture that brings it back.
 */
export function clampPan(
  scale: number,
  x: number,
  y: number,
  host: { width: number; height: number },
): Point {
  const maxX = Math.max(0, (host.width * scale - host.width) / 2);
  const maxY = Math.max(0, (host.height * scale - host.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

export default function Zoomable({
  src,
  alt,
  onZoomChange,
}: {
  src: string;
  alt: string;
  /** Told when zoom leaves or returns to 1, so a parent can hide chrome. */
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);

  const pointers = useRef(new Map<number, Point>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  );
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  useEffect(() => {
    onZoomChange?.(scale > ZOOMED_AT);
  }, [scale, onZoomChange]);

  // Reset when the photograph changes — a new page must not open half zoomed
  // into wherever the last one was being inspected.
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, [src]);

  const apply = useCallback((s: number, x: number, y: number) => {
    const next = Math.min(MAX_SCALE, Math.max(1, s));
    const host = hostRef.current?.getBoundingClientRect();
    const at =
      next <= ZOOMED_AT
        ? { x: 0, y: 0 }
        : clampPan(next, x, y, host ?? { width: 0, height: 0 });
    setScale(next);
    setTx(at.x);
    setTy(at.y);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setDragging(true);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(b.x - a.x, b.y - a.y), scale };
      panStart.current = null;
      return;
    }
    if (pointers.current.size !== 1) return;

    panStart.current = { x: e.clientX, y: e.clientY, tx, ty };

    // Double tap, handled on DOWN rather than UP so it cannot be swallowed by
    // the pan that a slightly-moved finger starts.
    const now = performance.now();
    const prev = lastTap.current;
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null;
      const r = hostRef.current?.getBoundingClientRect();
      if (!r) return;
      if (scale > ZOOMED_AT) {
        apply(1, 0, 0);
      } else {
        // Zoom towards the tap, so the point under the finger stays under the
        // finger. That is what makes it read as magnifying rather than jumping.
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        apply(
          DOUBLE_TAP_SCALE,
          -dx * (DOUBLE_TAP_SCALE - 1),
          -dy * (DOUBLE_TAP_SCALE - 1),
        );
      }
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (pinchStart.current.dist > 0) {
        apply((pinchStart.current.scale * dist) / pinchStart.current.dist, tx, ty);
      }
      return;
    }

    // ⚠️ PAN ONLY WHILE ZOOMED IN. At 1x there is nowhere to go, and a drag
    // that moves nothing reads as a broken screen.
    if (pointers.current.size === 1 && panStart.current && scale > ZOOMED_AT) {
      const p = panStart.current;
      apply(scale, p.tx + (e.clientX - p.x), p.ty + (e.clientY - p.y));
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      panStart.current = null;
      setDragging(false);
    }
  };

  const zoomed = scale > ZOOMED_AT;

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      // ⚠️ touchAction none, or the browser claims the gesture to scroll the
      // overlay and pointermove stops arriving mid-pinch.
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        touchAction: 'none',
        cursor: zoomed ? 'grab' : 'zoom-in',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          // No transition while a finger is down — an image lagging behind a
          // moving finger is what makes pinch feel broken.
          transition: dragging ? 'none' : 'transform 140ms ease-out',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      />
      {!zoomed && (
        <span
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 8,
            transform: 'translateX(-50%)',
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 11,
            color: '#fff',
            background: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          Pinch or double-tap to zoom
        </span>
      )}
    </div>
  );
}
