'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@/lib/use-scroll-lock';

export interface LightboxImage {
  id: string;
  url: string;
}

/**
 * The one fullscreen image viewer on the site.
 *
 * Extracted from the listing gallery so the community feed opens photos the
 * same way the marketplace does: fullscreen, click to toggle 2× zoom, drag
 * (mouse OR touch) to pan while zoomed, ← → to navigate, Esc / backdrop to
 * close. Rendered through a portal so an ancestor transform (e.g. PageReveal)
 * cannot trap `position: fixed`.
 *
 * ⚠️ WHY A PORTAL AND NOT JUST FIXED: a CSS transform on any ancestor creates
 * a containing block, so a `position: fixed` overlay renders relative to that
 * element instead of the viewport — the dim backdrop gets clipped to the
 * column. The listing gallery hit exactly this.
 */
export function ImageLightbox({
  images,
  startIndex = 0,
  title,
  onClose,
}: {
  images: LightboxImage[];
  startIndex?: number;
  title?: string;
  /** Called with the image index the user was on, so the caller can sync. */
  onClose: (index: number) => void;
}) {
  const ZOOM_SCALE = 2;
  const count = images.length;
  const [idx, setIdx] = useState(
    count > 0 ? Math.min(Math.max(0, startIndex), count - 1) : 0,
  );
  const [zoomed, setZoomed] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    moved: false,
  });
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const active = images[idx] ?? images[0];

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [zoomed, idx]);
  useScrollLock(true);

  const close = useCallback(() => onClose(idx), [onClose, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIdx((i) => (i - 1 + count) % count);
        setZoomed(false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIdx((i) => (i + 1) % count);
        setZoomed(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, count]);

  if (!mounted || !active) return null;

  const squareButton = {
    background: 'rgba(255,255,255,0.1)',
    border: '0.5px solid rgba(255,255,255,0.2)',
    color: '#fff',
    cursor: 'pointer',
    padding: 0,
  } as const;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title} — photo viewer` : 'Photo viewer'}
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        aria-label="Close photo viewer"
        style={{
          ...squareButton,
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: 20,
          fontSize: 18,
          lineHeight: '40px',
        }}
      >
        ✕
      </button>

      {count > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 22,
            left: 22,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {idx + 1} / {count}
        </div>
      )}

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i - 1 + count) % count);
              setZoomed(false);
            }}
            aria-label="Previous photo"
            style={{
              ...squareButton,
              position: 'absolute',
              left: 16,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 48,
              height: 48,
              borderRadius: 24,
              fontSize: 22,
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i + 1) % count);
              setZoomed(false);
            }}
            aria-label="Next photo"
            style={{
              ...squareButton,
              position: 'absolute',
              right: 16,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 48,
              height: 48,
              borderRadius: 24,
              fontSize: 22,
            }}
          >
            ›
          </button>
        </>
      )}

      <div
        ref={wrapperRef}
        onClick={(e) => {
          e.stopPropagation();
          if (dragRef.current.moved) {
            dragRef.current.moved = false;
            return;
          }
          setZoomed((z) => !z);
        }}
        onPointerDown={(e) => {
          if (!zoomed) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          dragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            startPanX: pan.x,
            startPanY: pan.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.active) return;
          const dx = e.clientX - dragRef.current.startX;
          const dy = e.clientY - dragRef.current.startY;
          if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true;
          const wrapper = wrapperRef.current;
          const img = imgRef.current;
          if (!wrapper || !img) return;
          const wr = wrapper.getBoundingClientRect();
          const overX = Math.max(0, (img.naturalWidth * ZOOM_SCALE - wr.width) / 2);
          const overY = Math.max(0, (img.naturalHeight * ZOOM_SCALE - wr.height) / 2);
          const maxX = Math.max(overX, wr.width * (ZOOM_SCALE - 1) * 0.5);
          const maxY = Math.max(overY, wr.height * (ZOOM_SCALE - 1) * 0.5);
          setPan({
            x: Math.max(-maxX, Math.min(maxX, dragRef.current.startPanX + dx)),
            y: Math.max(-maxY, Math.min(maxY, dragRef.current.startPanY + dy)),
          });
        }}
        onPointerUp={() => {
          dragRef.current.active = false;
        }}
        onPointerCancel={() => {
          dragRef.current.active = false;
          dragRef.current.moved = false;
        }}
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'hidden',
          cursor: zoomed ? (dragRef.current.active ? 'grabbing' : 'grab') : 'zoom-in',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: zoomed ? 'none' : 'auto',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={active.url}
          alt={title ? `${title} — photo ${idx + 1}` : `Photo ${idx + 1}`}
          style={{
            maxWidth: '90vw',
            maxHeight: '85vh',
            objectFit: 'contain',
            transform: zoomed
              ? `translate(${pan.x}px, ${pan.y}px) scale(${ZOOM_SCALE})`
              : 'none',
            transformOrigin: 'center center',
            transition: dragRef.current.active ? 'none' : 'transform 0.18s ease-out',
            userSelect: 'none',
            willChange: 'transform',
          }}
          draggable={false}
        />
      </div>

      {!zoomed && (
        <div
          style={{
            position: 'absolute',
            bottom: count > 1 ? 110 : 22,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 11,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Click to zoom 2× · drag to pan · ← → to navigate · Esc to close
        </div>
      )}

      {count > 1 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 6,
            maxWidth: '90vw',
            overflowX: 'auto',
          }}
        >
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => {
                setIdx(i);
                setZoomed(false);
              }}
              aria-label={`Jump to photo ${i + 1}`}
              aria-current={i === idx ? 'true' : undefined}
              style={{
                width: 56,
                height: 56,
                flexShrink: 0,
                borderRadius: 4,
                border:
                  i === idx
                    ? '1.5px solid var(--red)'
                    : '0.5px solid rgba(255,255,255,0.2)',
                padding: 0,
                cursor: 'pointer',
                background: 'transparent',
                overflow: 'hidden',
                opacity: i === idx ? 1 : 0.6,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
