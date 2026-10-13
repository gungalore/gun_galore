'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { motivationsApi } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE OWNER'S CONSENT LETTER, READ-ONLY.
//
// ⚠️ THE SHEET THE PACK PRINTS, NOT A SUMMARY. The server renders the same
// consent sheet the finished motivation carries, from the same builder, in the
// DEFAULT style — the member's own colourway is applied when the whole
// motivation is generated, not here (operator, 2026-10-13: "Just show the
// consent letter using a default style. We can rerender it according to the
// user picked style when we create the whole motivation.").
//
// ⚠️ A BLOB URL, NOT A src TO A ROUTE. The endpoint needs an Authorization
// header and there is no public URL for it — the bytes are rendered per
// request. The URL is ours to revoke; leaving it would pin the PDF for the life
// of the tab.
// ────────────────────────────────────────────────────────────────────

export interface ConsentLetterModalProps {
  motivationId: string;
  open: boolean;
  onClose: () => void;
}

export default function ConsentLetterModal({
  motivationId,
  open,
  onClose,
}: ConsentLetterModalProps) {
  const { getToken } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    let made: string | null = null;
    setFailed(false);
    setUrl(null);
    void motivationsApi
      .sellerConsentLetterUrl(getToken, motivationId)
      .then((u) => {
        made = u;
        if (live) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [open, getToken, motivationId]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex bg-black/70 p-0 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="The owner's consent letter"
        className="m-auto flex h-[92vh] w-full max-w-[820px] flex-col overflow-hidden rounded-none bg-[var(--bg-card)] sm:h-[90vh] sm:rounded-[var(--r-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
          <p className="m-0 text-[14px] font-medium text-[var(--text-primary)]">
            The owner&rsquo;s consent letter
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-[36px] rounded-[var(--r-sm)] border border-[var(--border)] px-3 text-[13px] text-[var(--text-secondary)]"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-[var(--bg-inset)]">
          {failed ? (
            <p className="p-4 text-[13px] text-[var(--text-secondary)]">
              We could not open the letter just now.
            </p>
          ) : url ? (
            <iframe
              title="The owner's consent letter"
              src={url}
              className="h-full w-full"
            />
          ) : (
            <p className="p-4 text-[13px] text-[var(--text-tertiary)]">
              Opening the letter&hellip;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
