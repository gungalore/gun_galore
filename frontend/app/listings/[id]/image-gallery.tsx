'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Subset of Prisma's ListingImage that the gallery actually reads.
// Mirrors the inline interface used on the listing detail page so we
// don't drag a deep relation type across the client/server boundary.
interface GalleryImage {
  id: string;
  url: string;
  isPrimary?: boolean;
}

// Self-contained gallery for the listing detail page.
//   - Top: hero image, clickable to open the lightbox.
//   - Below: horizontal thumbnail strip that swaps the hero in place
//     (instant, no overlay) — same behaviour as the marketplace
//     thumbnails you'd expect.
//   - Lightbox: fullscreen modal with ← → navigation (keyboard +
//     on-screen buttons), Esc / click-outside to close, thumbnail
//     strip at the bottom to jump directly, and a 2× zoom toggle on
//     click. Body scroll locked while open.
//
// Why this lives in its own component: the parent page is a server
// component, but the gallery needs useState + keyboard handlers + a
// portal-like overlay. Splitting keeps the rest of the page server-
// rendered for SEO.
export function ImageGallery({
  images,
  title,
}: {
  images: GalleryImage[];
  title: string;
}) {
  // Active hero / lightbox cursor. Both views read the same index so
  // closing the lightbox returns the user to the picture they were
  // looking at, not the original primary.
  const initial = Math.max(
    0,
    images.findIndex((i) => i.isPrimary),
  );
  const [activeIdx, setActiveIdx] = useState(initial);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // Portal target — created on mount once the document is available
  // (server-rendering guard). Without a portal the lightbox renders
  // inside the page's <PageReveal>, whose CSS transform creates a
  // containing block that traps position:fixed inside the grid — the
  // dim backdrop ends up clipped to the gallery column instead of
  // covering the viewport.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const hasImages = images.length > 0;
  const active = hasImages ? images[activeIdx] ?? images[0] : null;

  // Keyboard navigation — only while lightbox is open. Esc closes,
  // ← / → step through. Hooked at document level so it fires
  // regardless of focus inside the modal.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setLightboxOpen(false);
        setZoomed(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + images.length) % images.length);
        setZoomed(false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % images.length);
        setZoomed(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxOpen, images.length]);

  // Body scroll lock while the lightbox is open. Without this the
  // page jumps + you can scroll the listing underneath the overlay,
  // which feels broken.
  useEffect(() => {
    if (!lightboxOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen]);

  const openAt = useCallback((idx: number) => {
    setActiveIdx(idx);
    setLightboxOpen(true);
    setZoomed(false);
  }, []);

  if (!hasImages || !active) {
    return (
      <div
        className="relative rounded-[6px] overflow-hidden"
        style={{ aspectRatio: '4 / 3', background: 'var(--bg-inset)' }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          No photos
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Hero — clickable to open lightbox at this index. Cursor
          zoom-in tells the user it expands; tabbable + Enter/Space
          for keyboard users.
          NOTE: aspectRatio gives the button its intrinsic height; we
          do NOT use the paddingBottom % hack here because button
          elements default-style "padding" to a non-zero browser
          stylesheet rule that would override paddingBottom. */}
      <button
        type="button"
        onClick={() => openAt(activeIdx)}
        aria-label={`Open ${title} photos`}
        className="relative rounded-[6px] overflow-hidden block w-full"
        style={{
          aspectRatio: '4 / 3',
          background: 'var(--bg-inset)',
          cursor: 'zoom-in',
          border: 0,
          padding: 0,
        }}
      >
        <Image
          src={active.url}
          alt={title}
          fill
          className="object-contain"
          priority
          sizes="(max-width: 1024px) 100vw, 60vw"
        />
      </button>

      {/* Thumbnail strip — instant in-page swap. Active thumbnail
          gets a red outline so the user knows which one is in the
          hero. */}
      {images.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {images.map((img, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveIdx(idx)}
                onDoubleClick={() => openAt(idx)}
                aria-label={`Show photo ${idx + 1} of ${images.length}`}
                aria-current={isActive ? 'true' : undefined}
                className="relative flex-shrink-0 w-20 h-20 rounded-[4px] overflow-hidden"
                style={{
                  background: 'var(--bg-inset)',
                  border: isActive
                    ? '1.5px solid var(--red)'
                    : '0.5px solid var(--border)',
                  cursor: 'pointer',
                  padding: 0,
                  opacity: isActive ? 1 : 0.85,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                <Image
                  src={img.url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Lightbox overlay. Renders via a React Portal at document.body
          so position:fixed actually escapes ancestor transforms (the
          parent <PageReveal> uses transform for its animation, which
          would otherwise turn fixed into absolute). Click the dim
          backdrop to close, click the image to toggle 2× zoom, arrows
          on left/right edges step through. */}
      {lightboxOpen && mounted && createPortal((
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} — photo viewer`}
          onClick={() => {
            setLightboxOpen(false);
            setZoomed(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.92)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Close button — fixed top-right, large hit target. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxOpen(false);
              setZoomed(false);
            }}
            aria-label="Close photo viewer"
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 40,
              height: 40,
              borderRadius: 20,
              background: 'rgba(255, 255, 255, 0.1)',
              border: '0.5px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: '40px',
              padding: 0,
            }}
          >
            ✕
          </button>

          {/* Counter — fixed top-left. Tells the user where they
              are in the set. */}
          <div
            style={{
              position: 'absolute',
              top: 22,
              left: 22,
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: 13,
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {activeIdx + 1} / {images.length}
          </div>

          {/* Prev / Next arrows. Hidden when there's only one image. */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIdx(
                    (i) => (i - 1 + images.length) % images.length,
                  );
                  setZoomed(false);
                }}
                aria-label="Previous photo"
                style={{
                  position: 'absolute',
                  left: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '0.5px solid rgba(255, 255, 255, 0.2)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 22,
                  padding: 0,
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIdx((i) => (i + 1) % images.length);
                  setZoomed(false);
                }}
                aria-label="Next photo"
                style={{
                  position: 'absolute',
                  right: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '0.5px solid rgba(255, 255, 255, 0.2)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 22,
                  padding: 0,
                }}
              >
                ›
              </button>
            </>
          )}

          {/* Image — click to toggle 2× zoom. We use a native img tag
              with maxWidth/maxHeight inside the viewport bounds + a
              CSS transform for the zoom. overflow:auto on the wrapper
              lets the user pan a zoomed image. */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              setZoomed((z) => !z);
            }}
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              overflow: zoomed ? 'auto' : 'visible',
              cursor: zoomed ? 'zoom-out' : 'zoom-in',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.url}
              alt={`${title} — photo ${activeIdx + 1}`}
              style={{
                maxWidth: zoomed ? 'none' : '90vw',
                maxHeight: zoomed ? 'none' : '85vh',
                width: zoomed ? '180vw' : 'auto',
                height: zoomed ? 'auto' : 'auto',
                objectFit: 'contain',
                transition: 'all 0.18s ease-out',
                userSelect: 'none',
              }}
              draggable={false}
            />
          </div>

          {/* Zoom hint — small label so users know clicking does
              something. Hidden when zoomed in to reduce clutter. */}
          {!zoomed && (
            <div
              style={{
                position: 'absolute',
                bottom: images.length > 1 ? 110 : 22,
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Click photo to zoom 2× · ← → to navigate · Esc to close
            </div>
          )}

          {/* Thumbnail strip at the bottom — quick jump to any
              photo without arrowing through them. Click stops
              propagation so the backdrop click-to-close doesn't fire. */}
          {images.length > 1 && (
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
                background: 'rgba(255, 255, 255, 0.06)',
                borderRadius: 6,
                maxWidth: '90vw',
                overflowX: 'auto',
              }}
            >
              {images.map((img, idx) => {
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      setActiveIdx(idx);
                      setZoomed(false);
                    }}
                    aria-label={`Jump to photo ${idx + 1}`}
                    aria-current={isActive ? 'true' : undefined}
                    style={{
                      position: 'relative',
                      width: 56,
                      height: 56,
                      flexShrink: 0,
                      borderRadius: 4,
                      border: isActive
                        ? '1.5px solid var(--red)'
                        : '0.5px solid rgba(255, 255, 255, 0.2)',
                      padding: 0,
                      cursor: 'pointer',
                      background: 'transparent',
                      overflow: 'hidden',
                      opacity: isActive ? 1 : 0.6,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ), document.body)}
    </>
  );
}
