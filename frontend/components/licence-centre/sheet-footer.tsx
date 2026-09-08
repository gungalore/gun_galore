'use client';

// ────────────────────────────────────────────────────────────────────
// THE ONE RED BUTTON ON THE SHEET.
//
// ⚠️ ONE NUMBER, THREE VIEWS, AND NEVER A FOURTH. The progress pill in the
// strip, the dot on each section chip and this footer all read the SAME
// `missing` list from the server. The screen this replaces had four separate
// progress systems — a rail that ticked steps, a footer that counted answers,
// a right-hand panel with per-letter percentages, and a chip cloud on the pack
// step — and they could and did contradict each other. The walkthrough caught
// a step showing a green tick while its own panel read "H Declarations 0%".
//
// ⚠️ RED IS FOR THIS BUTTON AND NOTHING ELSE ON THE PAGE. Everything else red
// is text. On the pack screen there is no red button at all — Print and
// Download are outlined — because by then the decision has been made.
// ────────────────────────────────────────────────────────────────────

export interface SheetFooterProps {
  /** How many required items are still empty. The only input. */
  missingCount: number;
  onWrite: () => void;
  busy?: boolean;
}

export default function SheetFooter({
  missingCount,
  onWrite,
  busy = false,
}: SheetFooterProps) {
  const blocked = missingCount > 0;

  return (
    <div className="sticky bottom-0 z-[3] border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3">
      <button
        type="button"
        disabled={blocked || busy}
        onClick={onWrite}
        className={`flex min-h-[44px] w-full items-center justify-center rounded-[var(--r-sm)] bg-[var(--red)] px-4 text-[15px] font-medium text-white ${
          blocked || busy ? 'opacity-50' : 'hover:bg-[#A00D24]'
        }`}
      >
        {busy ? 'Writing your motivation…' : 'Write my motivation'}
      </button>
      {/*
        ⚠️ THE LINE APPEARS ONLY WHILE SOMETHING IS OUTSTANDING. A count of
        zero renders nothing rather than "0 things still needed" — a footer
        that congratulates you for finishing is noise, and the enabled button
        already says the same thing.
      */}
      {blocked ? (
        <div className="mt-2 text-center text-[12px] text-[var(--text-tertiary)]">
          {missingCount} thing{missingCount === 1 ? '' : 's'} still needed above
        </div>
      ) : null}
    </div>
  );
}
