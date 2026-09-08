'use client';

import { Chevron } from './sheet-disclosure';

// ────────────────────────────────────────────────────────────────────
// ONE SECTION OF THE SHEET: a heading you can tap, one sentence, and a list of
// rows underneath it.
//
// ⚠️ IT FOLDS NOW, AND IT DID NOT BEFORE. SPEC-BUILD §3 chose a flat scroll
// with the chip strip as the only navigation, which was right against the
// canvas's sample data and is not survivable against a real vault: measured on
// a live application with five owned firearms, the page was 26,351px tall —
// 27.7 screens — with 351 form controls, and Chrome's renderer timed out
// screenshotting it. Seven of the eight sections were off-screen at all times.
//
// ⚠️ THE HEADING IS STILL AN <h2>, WITH A BUTTON INSIDE IT. A fold whose
// heading stops being a heading takes the page's outline with it, and the
// outline is how somebody using a screen reader moves through eight sections
// without listening to all 351 controls.
//
// ⚠️ `scroll-margin-top` IS STILL THE WHOLE REASON THIS IS A COMPONENT. The
// section chips are anchor links and the strip is sticky, so without a scroll
// margin every tap lands the heading BEHIND the strip. 120px clears the shell
// header and the strip together.
//
// ⚠️ THE BLURB IS ONE SENTENCE. The copy rules say so and it is worth
// enforcing by shape: the screen this replaces repeated a four-line footnote
// about how sections are counted on all eleven steps, above the fold.
// ────────────────────────────────────────────────────────────────────

export interface SheetSectionProps {
  id: string;
  title: string;
  blurb: string;
  /**
   * Controlled, because the chips have to be able to open what they scroll to.
   * A chip that lands you on a closed heading is worse than the scroll it
   * replaced.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The right-hand state on the header.
   *
   * ⚠️ A FOLD MUST NOT HIDE A "Still needed". The page passes this from the
   * same `missing` list the progress pill, the chip dots and the footer read,
   * so a closed section still says how much of it is outstanding.
   */
  meta?: React.ReactNode;
  children: React.ReactNode;
}

export default function SheetSection({
  id,
  title,
  blurb,
  open,
  onOpenChange,
  meta,
  children,
}: SheetSectionProps) {
  return (
    <section
      id={id}
      className="scroll-mt-[120px] border-b border-[var(--border-divider)] px-4 pb-2 pt-3 last:border-b-0"
      aria-labelledby={`${id}-h`}
    >
      <h2 id={`${id}-h`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex min-h-[44px] w-full items-center gap-[10px] bg-transparent py-1 text-left"
        >
          <Chevron open={open} />
          <span className="min-w-0 flex-1">
            <span className="block font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.2] tracking-[-0.01em] text-[var(--text-primary)]">
              {title}
            </span>
            {blurb ? (
              <span className="mt-1 block text-[13.5px] leading-[1.4] text-[var(--text-tertiary)]">
                {blurb}
              </span>
            ) : null}
          </span>
          {meta ? (
            <span className="flex-shrink-0 text-[11px] font-medium">
              {meta}
            </span>
          ) : null}
        </button>
      </h2>

      {/*
        ⚠️ UNMOUNTED WHEN CLOSED. `hidden` would leave all 351 controls in the
        tree and the renderer exactly as busy as it was.
      */}
      {open ? <div className="mt-2">{children}</div> : null}
    </section>
  );
}
