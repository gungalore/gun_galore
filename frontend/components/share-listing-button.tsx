'use client';

// Share button — wraps navigator.share() with a clipboard-copy
// fallback. Used on the listing-detail page next to the Wishlist
// button. Tiny inline component, no external deps.
//
// Behaviour:
//   - If the browser supports Web Share (iOS Safari, Android Chrome,
//     most modern mobile), tap fires the OS share sheet.
//   - If not (desktop, older mobile), tap copies the URL to clipboard
//     and shows a 2s "Link copied" toast.
//   - If the Web Share fails (user dismissed, or canShare returned
//     false), gracefully falls back to clipboard.
//
// Always builds the canonical URL from window.location.origin + the
// pathname/handle we're passed, so it works from the listing detail
// page without needing the server to inject a full URL.

import { useState } from 'react';

interface Props {
  /** Optional title for the share sheet — defaults to document.title. */
  title?: string;
  /** Optional message body for the share sheet. */
  text?: string;
  /** Optional override URL (defaults to current location). */
  url?: string;
}

function IconShare() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

export function ShareListingButton({ title, text, url }: Props) {
  const [toast, setToast] = useState<string | null>(null);

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast('Link copied');
    } catch {
      setToast('Could not copy link');
    }
    window.setTimeout(() => setToast(null), 2000);
  }

  async function onClick() {
    const shareUrl =
      url ??
      (typeof window !== 'undefined' ? window.location.href : '');
    const shareTitle =
      title ??
      (typeof document !== 'undefined' ? document.title : 'Gun Galore');

    // Web Share API check — `navigator.share` is undefined on desktop
    // browsers. `canShare` gates the data shape on iOS.
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        const payload = { title: shareTitle, text, url: shareUrl };
        if (nav.canShare && !nav.canShare(payload)) {
          await copyToClipboard(shareUrl);
          return;
        }
        await nav.share(payload);
        // No toast on success — the OS share sheet is feedback enough.
        return;
      } catch (err) {
        // User dismissed the share sheet (AbortError) — silent no-op.
        if ((err as Error)?.name === 'AbortError') return;
        // Anything else → clipboard fallback.
        await copyToClipboard(shareUrl);
        return;
      }
    }

    // No Web Share support → clipboard.
    await copyToClipboard(shareUrl);
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={onClick}
        aria-label="Share listing"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 16px',
          borderRadius: 8,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 140ms, border-color 140ms, color 140ms',
        }}
      >
        <IconShare />
        Share
      </button>
      {toast && (
        <span
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--bg-deep)',
            border: '0.5px solid var(--border-hover)',
            color: 'var(--text-primary)',
            fontSize: 12,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {toast}
        </span>
      )}
    </span>
  );
}
