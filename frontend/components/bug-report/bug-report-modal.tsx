'use client';

import { useEffect } from 'react';
import { BugReportForm } from './bug-report-form';

export function BugReportModal({
  url,
  screenshot,
  capturing,
  onScreenshotChange,
  onClose,
}: {
  url: string;
  screenshot: File | null;
  capturing: boolean;
  onScreenshotChange: (file: File | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    // data-bug-report-skip keeps this sheet OUT of the auto-screenshot, so a
    // capture taken while it is open still shows the page behind it.
    <div
      data-bug-report-skip="true"
      role="dialog"
      aria-modal="true"
      aria-label="Report a bug"
      className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex: 200 }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.5)',
          border: 'none',
          cursor: 'pointer',
        }}
      />
      <div className="relative w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold m-0 text-[var(--text-primary)]">
            Report a bug
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--text-tertiary)] text-xl leading-none"
          >
            ✕
          </button>
        </div>
        <BugReportForm
          url={url}
          screenshot={screenshot}
          capturing={capturing}
          onScreenshotChange={onScreenshotChange}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
