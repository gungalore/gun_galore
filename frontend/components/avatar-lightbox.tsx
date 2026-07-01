'use client';

import { useEffect, useState } from 'react';

// Site-wide click-to-enlarge for user profile photos.
//
// <AvatarLightbox/> is mounted once in the root layout and listens for a
// `gg:view-avatar` window event. Any avatar anywhere opens it by calling
// viewAvatar(src, name) — or, more simply, by rendering <ClickableAvatar/>.
// Decoupled via a window event so no provider/context threading is needed.

export function viewAvatar(src: string, name?: string) {
  if (typeof window === 'undefined' || !src) return;
  window.dispatchEvent(
    new CustomEvent('gg:view-avatar', { detail: { src, name } }),
  );
}

export function AvatarLightbox() {
  const [view, setView] = useState<{ src: string; name?: string } | null>(null);

  useEffect(() => {
    function onView(e: Event) {
      const d = (e as CustomEvent).detail as { src?: string; name?: string };
      if (d?.src) setView({ src: d.src, name: d.name });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setView(null);
    }
    window.addEventListener('gg:view-avatar', onView);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('gg:view-avatar', onView);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = view ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [view]);

  if (!view) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={view.name ? `${view.name}'s profile photo` : 'Profile photo'}
      onClick={() => setView(null)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        onClick={(e) => e.stopPropagation()}
        src={view.src}
        alt={view.name ? `${view.name}'s profile photo` : 'Profile photo'}
        style={{
          maxWidth: 'min(440px, 88vw)',
          maxHeight: '70vh',
          width: 'auto',
          height: 'auto',
          borderRadius: 16,
          objectFit: 'contain',
          border: '0.5px solid rgba(255,255,255,0.18)',
        }}
      />
      {view.name && (
        <p style={{ color: '#fff', fontSize: 15, fontWeight: 500, margin: 0 }}>
          {view.name}
        </p>
      )}
      <button
        type="button"
        onClick={() => setView(null)}
        style={{
          background: 'rgba(255,255,255,0.14)',
          color: '#fff',
          border: 'none',
          borderRadius: 999,
          padding: '8px 20px',
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  );
}

// Circular avatar that enlarges on click (when it has a photo). Falls back to
// an initial letter when there's no photo. Use anywhere a user's avatar shows.
export function ClickableAvatar({
  src,
  name,
  size = 40,
  initial,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  initial?: string;
}) {
  const letter = (initial ?? name ?? 'G').charAt(0).toUpperCase();
  const canView = !!src;
  return (
    <button
      type="button"
      onClick={canView ? () => viewAvatar(src as string, name ?? undefined) : undefined}
      aria-label={canView ? `View ${name ?? 'user'}'s profile photo` : undefined}
      disabled={!canView}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
        padding: 0,
        border: '0.5px solid var(--border)',
        background: 'var(--red)',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.42),
        fontWeight: 500,
        cursor: canView ? 'zoom-in' : 'default',
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        letter
      )}
    </button>
  );
}
