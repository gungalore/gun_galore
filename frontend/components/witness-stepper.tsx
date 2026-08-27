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
//
// ⚠️ NOT components/step-rail.tsx, DELIBERATELY. Operator 2026-08-27: "all
// multi step setups has to have the same horizontal step rail system" — so the
// colours and sizing below (green complete, red current, outlined upcoming;
// 24px circle; 12.5px label) are lifted from that shared component to match
// its look. But the component itself is hidden below 768px (`.gg-step-rail`
// in app/globals.css) and expects a paired "Step X of N" row published by the
// mobile shell header — and /witness is chromeless (lib/chromeless-routes.ts):
// no shell mounts here, so nothing would ever publish that row. Importing it
// as-is would leave a witness who opened this on a phone, which given it
// arrives by SMS is most of them, with no progress indicator at all. This
// stepper stays its own component, visible at every width, for that reason.
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
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px]',
                done
                  ? 'bg-[var(--success)] font-bold text-white'
                  : active
                    ? 'bg-[var(--red)] font-bold text-white'
                    : 'border border-[var(--border-hover)] font-semibold text-[var(--text-faint)]',
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
                'truncate text-[12.5px]',
                done
                  ? 'font-semibold text-[var(--text-primary)]'
                  : active
                    ? 'font-bold text-[var(--text-primary)]'
                    : 'font-medium text-[var(--text-faint)]',
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
