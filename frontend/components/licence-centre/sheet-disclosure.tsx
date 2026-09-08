'use client';

import { useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// ONE FOLD. A header you can tap, and everything under it.
//
// ⚠️ IT EXISTS BECAUSE THE SHEET IS 26,000px TALL. Measured on a live
// application with five owned firearms: 26,351px of document, 351 form
// controls, and Chrome's renderer timing out on a screenshot of it. The flat
// scroll was the right call against the canvas's sample data and is not
// survivable against a real vault. Sections, owned firearms and the licence
// card's serial rows all fold through this one component.
//
// ⚠️ A BUTTON AND A REGION, NOT <details>. `<details>` cannot be driven from
// outside, and the section chips have to be able to open the section they
// scroll to — a chip that lands you on a closed heading is worse than the
// scroll it replaced. So it takes an optional controlled `open`.
//
// ⚠️ THE HEADER MUST SAY WHAT IS INSIDE WITHOUT BEING OPENED. A fold that
// hides a "Still needed" behind a chevron is a form that lies about how much
// is left, so `meta` carries the count and the page passes it from the same
// `missing` list the footer and the chips read.
// ────────────────────────────────────────────────────────────────────

export interface SheetDisclosureProps {
  /** Heading text. */
  summary: React.ReactNode;
  /** One line under the summary, shown open or closed. */
  note?: string;
  /** The right-hand side of the header — a count, a state word. */
  meta?: React.ReactNode;
  /** Uncontrolled starting state. Ignored when `open` is supplied. */
  defaultOpen?: boolean;
  /** Controlled mode — supply with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Tightens the header for a nested fold, e.g. one owned firearm. */
  dense?: boolean;
  children: React.ReactNode;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-150 ${
        open ? 'rotate-90' : ''
      }`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function SheetDisclosure({
  summary,
  note,
  meta,
  defaultOpen = false,
  open,
  onOpenChange,
  dense = false,
  children,
}: SheetDisclosureProps) {
  const [self, setSelf] = useState(defaultOpen);
  const isOpen = open ?? self;

  return (
    <div className="border-b border-[var(--border-divider)] last:border-b-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          if (onOpenChange) onOpenChange(!isOpen);
          else setSelf((v) => !v);
        }}
        className={`flex w-full min-h-[44px] items-center gap-[10px] bg-transparent text-left ${
          dense ? 'py-[9px]' : 'py-[11px]'
        }`}
      >
        <Chevron open={isOpen} />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate font-medium leading-[1.3] text-[var(--text-primary)] ${
              dense ? 'text-[13.5px]' : 'text-[14.5px]'
            }`}
          >
            {summary}
          </span>
          {note ? (
            <span className="mt-[2px] block text-[12px] leading-[1.35] text-[var(--text-tertiary)]">
              {note}
            </span>
          ) : null}
        </span>
        {meta ? (
          <span className="flex-shrink-0 text-[11px] font-medium">{meta}</span>
        ) : null}
      </button>

      {/*
        ⚠️ UNMOUNTED WHEN CLOSED, NOT HIDDEN. The point of the fold is that a
        page with 351 controls does not mount 351 controls; `hidden` would keep
        every one of them in the tree and leave the renderer exactly as busy.
      */}
      {isOpen ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}
