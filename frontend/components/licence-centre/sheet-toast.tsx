'use client';

import { useEffect } from 'react';

// ────────────────────────────────────────────────────────────────────
// "Read your competency certificate · 3 rows filled".
//
// ⚠️ IT REPORTS WHAT HAPPENED, IT IS NOT A TASK. The screen this replaces put
// a banner reading "We added 3 documents from your Document Centre … Got it"
// at the top of ALL TEN steps until it was dismissed, above the fold every
// time. A thing that happened once should be said once.
//
// ⚠️ AND THE ROWS IT FILLED CHANGE IN PLACE. The toast is the notice; the
// evidence is the sheet itself updating underneath it. If the rows did not
// move, the toast is lying and no wording fixes that.
// ────────────────────────────────────────────────────────────────────

export interface SheetToastProps {
  /** One line. Null when there is nothing to say. */
  message: string | null;
  onDismiss: () => void;
  /** Milliseconds. Four seconds is long enough to read one line. */
  timeoutMs?: number;
}

export default function SheetToast({
  message,
  onDismiss,
  timeoutMs = 4000,
}: SheetToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(t);
  }, [message, onDismiss, timeoutMs]);

  if (!message) return null;

  return (
    // ⚠️ `role="status"`, NOT `alert`. Nothing here needs interrupting for —
    // a screen reader should hear it when it finishes what it is saying.
    <div
      role="status"
      aria-live="polite"
      className="gg-tile pointer-events-none fixed inset-x-4 bottom-[84px] z-[6] mx-auto max-w-[420px] rounded-[var(--r-md)] bg-[var(--text-primary)] px-4 py-3 text-center text-[13px] text-white"
    >
      {message}
    </div>
  );
}
