'use client';

import { useEffect, useRef } from 'react';

// ────────────────────────────────────────────────────────────────────
// A SMALL STYLED CONFIRM.
//
// ⚠️ THE REPO USED window.confirm IN PLACES AND THIS IS THE REPLACEMENT FOR
// THE ONES THAT MATTER. The operator asked for a styled modal, not a browser
// dialog, when a signed consent is about to be overwritten — operator,
// 2026-10-13: "a pop up must warn them that the current one will be
// overwritten with the new one." A native dialog cannot be themed and looks
// like the page is being hijacked.
//
// ⚠️ REAL FOCUS AND ESCAPE, NOT DECORATION. `aria-modal="true"` is a promise
// the focus is inside the dialog and Escape closes it; a styled div that makes
// neither promise lies to a screen reader. Kept deliberately small — this is a
// warning with two buttons, not a surface.
// ────────────────────────────────────────────────────────────────────

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Plain sentences. No legalese. */
  body: string;
  /** Defaults to "Continue". */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[440px] rounded-t-[var(--r-lg)] bg-[var(--bg-card)] p-4 sm:rounded-[var(--r-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="m-0 text-[15px] font-medium text-[var(--text-primary)]">
          {title}
        </p>
        <p className="m-0 mt-2 text-[13px] leading-[1.45] text-[var(--text-secondary)]">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[40px] rounded-[var(--r-sm)] border border-[var(--border)] px-3 text-[13px] text-[var(--text-secondary)]"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="min-h-[40px] rounded-[var(--r-sm)] bg-[var(--red)] px-3 text-[13px] font-medium text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
