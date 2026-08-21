'use client';

// ────────────────────────────────────────────────────────────────────
// THE STEP RAIL, as the operator's Natshoot reference sets it: a numbered
// circle per step across the top, a tick once a step is behind you, the
// current one filled, the rest outlined.
//
// ⚠️ IT IS A PROGRESS INDICATOR, NOT A NAVIGATOR. The steps are not clickable.
// Somebody who has verified their number and answered the three statutory
// questions must not be able to jump back and change the number the code went
// to — and a rail that looks tappable but is not is worse than one that
// obviously is not. Back is a button, on the step, where it can be reasoned
// about.
// ────────────────────────────────────────────────────────────────────

export interface StepDef {
  key: string;
  label: string;
}

export default function WitnessStepper({
  steps,
  current,
}: {
  steps: readonly StepDef[];
  /** 0-based index of the step being shown. */
  current: number;
}) {
  return (
    <ol
      className="flex w-full items-center justify-between gap-1 overflow-x-auto px-1 py-4"
      aria-label="Progress"
    >
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={s.key}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done || active
                  ? 'bg-[var(--brand,#1b3a2f)] text-white'
                  : 'border border-[var(--border)] text-[var(--text-secondary)]',
              ].join(' ')}
            >
              {done ? (
                // A tick, drawn — an emoji or a font glyph here renders
                // differently on every phone the link lands on.
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M5 13l4 4L19 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span
              className={[
                'truncate text-xs sm:text-sm',
                active
                  ? 'font-semibold text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)]',
              ].join(' ')}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="mx-1 hidden h-px flex-1 bg-[var(--border)] sm:block"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
