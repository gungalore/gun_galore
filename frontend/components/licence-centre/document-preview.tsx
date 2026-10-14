'use client';

import { useEffect, useRef } from 'react';

// ────────────────────────────────────────────────────────────────────
// ONE ATTACHED DOCUMENT, FULL SCREEN.
//
// ⚠️ THE SHELF DRAWS THUMBNAILS; THIS SHOWS THE PAGE (2026-10-14). Operator,
// "I don't see the physical documents." A 72px tile is not enough to read a
// licence card, so the tile opens this: the actual image the member attached,
// or the PDF whole, with the name above it.
//
// ⚠️ THE URL IS OURS TO REVOKE. It is a blob URL the caller fetched from an
// authenticated route (no public URL exists). The caller revokes it on close —
// see DocumentShelf.closePreview. This only displays it.
// ────────────────────────────────────────────────────────────────────

export interface DocumentPreviewProps {
  label: string;
  /** An authenticated blob URL. The caller owns revoking it. */
  url: string;
  mime: string | null;
  onClose: () => void;
}

export default function DocumentPreview({
  label,
  url,
  mime,
  onClose,
}: DocumentPreviewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const isPdf = (mime ?? '') === 'application/pdf';

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex bg-black/80 p-0 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="m-auto flex h-[92vh] w-full max-w-[900px] flex-col overflow-hidden bg-[var(--bg-card)] sm:rounded-[var(--r-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2">
          <p className="m-0 truncate text-[14px] font-medium text-[var(--text-primary)]">
            {label}
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-[36px] flex-shrink-0 rounded-[var(--r-sm)] border border-[var(--border)] px-3 text-[13px] text-[var(--text-secondary)]"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-[var(--bg-inset)]">
          {isPdf ? (
            <iframe title={label} src={url} className="h-full w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label}
              className="mx-auto h-full max-h-full w-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}
