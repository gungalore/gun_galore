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
   * How many required answers this section still owes.
   *
   * ⚠️ A NUMBER, NOT A RENDERED NODE. It was `meta?: React.ReactNode` and every
   * caller built its own span, which is how two sections end up with two
   * different ideas of what "done" looks like. The pill is drawn here, once,
   * so every section's reads the same and lines up in the same place.
   *
   * ⚠️ AND A FOLD MUST NOT HIDE A "Still needed". This comes from the same
   * `missing` list the progress pill, the chip dots and the footer read, so a
   * closed section still says how much of it is outstanding.
   */
  missingCount: number;
  children: React.ReactNode;
}

export default function SheetSection({
  id,
  title,
  blurb,
  open,
  onOpenChange,
  missingCount,
  children,
}: SheetSectionProps) {
  const done = missingCount === 0;
  return (
    <section
      id={id}
      className="scroll-mt-[120px] border-b border-[var(--border-divider)] px-4 pb-2 pt-3 last:border-b-0"
      aria-labelledby={`${id}-h`}
    >
      <h2 id={`${id}-h`} className="m-0">
        {/*
          ⚠️ A WASH ON THE HEADER, NOT ON THE SECTION. Operator, 2026-09-08:
          "give the sections a red hue background just to distinguage them from
          their dropdown content." Tinting the whole section would put a colour
          behind every input in it; tinting the header alone is what actually
          separates the two, and it keeps the rows on the white ground the
          theme is built for.

          ⚠️ --red-wash, NEVER A HAND-MIXED rgba. `var(--red)` + an alpha is two
          tokens and dies silently, taking the whole declaration with it — see
          the CSS traps in CLAUDE.md. The negative margin lets it bleed into the
          section's own 16px gutters so it reads as a band rather than a chip.
        */}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="-mx-4 flex min-h-[44px] w-[calc(100%+2rem)] items-center gap-[10px] border-y border-[var(--red-line)] bg-[var(--red-wash)] px-4 py-2 text-left"
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
          {/*
            ⚠️ THE SAME PILL AS THE PROGRESS FIGURE IN THE STRIP, deliberately.
            Green for done, amber for outstanding, the same radius, the same
            weight, the same tokens — a second pill vocabulary on one screen is
            a second thing to learn. Operator, 2026-09-08: "Done should be in a
            green pill and x still needed in an amber pill."

            ⚠️ color-mix FOR THE AMBER, NEVER `var(--warning)` + AN ALPHA. That
            concatenation is two tokens, not a colour, and it takes the whole
            declaration down with it — see the CSS traps in CLAUDE.md. There is
            no --warning-wash to reach for.
          */}
          <span
            className={`flex min-h-[26px] flex-shrink-0 items-center whitespace-nowrap rounded-full border px-[11px] text-[12px] font-medium leading-none ${
              done
                ? 'border-[var(--success-line)] bg-[var(--success-wash)] text-[var(--success)]'
                : 'border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]'
            }`}
          >
            {done ? 'Done' : `${missingCount} still needed`}
          </span>
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
