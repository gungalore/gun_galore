'use client';

import type { StepStatus } from './step-accordion';

// ────────────────────────────────────────────────────────────────────
// THE MOTIVATION WIZARD'S PROGRESS RAIL.
//
// Operator, 2026-08-24: "a horizontal progress indicator style stepper. This
// page is becoming messy."
//
// ⚠️ THIS ONE IS A NAVIGATOR, UNLIKE witness-stepper.tsx. That rail states in
// its own header that it is deliberately not clickable, because a witness who
// has verified a code must not jump back and change it. The opposite is true
// here: NOTHING IS EVER LOCKED on this form (see the note on stepStatus in the
// motivation page). People fill a licence application in the order their
// paperwork comes to hand, and a step you cannot open is indistinguishable
// from a broken page. So every step is a real button.
//
// ⚠️ COLOUR IS NEVER THE ONLY SIGNAL. Amber-on-green is the red/green-blind
// failure pair, and "done" vs "started" is exactly the distinction this rail
// exists to make. Each circle carries a GLYPH as well as a colour — a tick for
// complete, a dot for started, the number otherwise — so the state survives
// both colour blindness and a monochrome print.
//
// ⚠️ NO SHADOWS, AND NOT BECAUSE OF TASTE. globals.css kills every box-shadow
// globally with `* { box-shadow: none !important }`, which also makes every
// Tailwind `ring-*` utility render nothing. Depth here is borders plus the
// --bg-* layers, and focus is an `outline`.
// ────────────────────────────────────────────────────────────────────

export interface RailStep {
  key: string;
  /** Short enough to sit under a 28px circle on a desktop rail. */
  label: string;
  status: StepStatus;
}

/** The colour for a status. Paired with a glyph — never load-bearing alone. */
function tone(status: StepStatus): { ring: string; fill: string; ink: string } {
  switch (status) {
    case 'complete':
      // The same green the StepAccordion badge uses.
      return { ring: 'rgba(34,197,94,.45)', fill: 'rgba(34,197,94,.14)', ink: '#22c55e' };
    case 'active':
      return { ring: 'var(--red)', fill: 'var(--red)', ink: '#fff' };
    case 'partial':
      return {
        ring: 'rgba(212,154,58,.5)',
        fill: 'rgba(212,154,58,.14)',
        ink: 'var(--warning)',
      };
    default:
      return { ring: 'var(--border)', fill: 'transparent', ink: 'var(--text-tertiary)' };
  }
}

/** Tick, dot, or the step number. See the glyph note in the file header. */
function glyph(status: StepStatus, n: number): string {
  if (status === 'complete') return '✓';
  if (status === 'partial') return '•';
  return String(n);
}

/** What a screen reader hears instead of the colour. */
function stateWord(status: StepStatus): string {
  if (status === 'complete') return 'done';
  if (status === 'partial') return 'started';
  if (status === 'active') return 'current';
  return 'not started';
}

export default function MotivationStepRail({
  steps,
  current,
  onJump,
}: {
  steps: readonly RailStep[];
  /** 1-based number of the step on screen. 0 = everything collapsed. */
  current: number;
  onJump: (n: number) => void;
}) {
  const currentStep = steps[current - 1];

  return (
    <nav aria-label="Progress" className="mb-5">
      <ol className="flex w-full items-start justify-between gap-1">
        {steps.map((s, i) => {
          const n = i + 1;
          const t = tone(s.status);
          return (
            <li key={s.key} className="flex min-w-0 flex-1 flex-col items-center">
              <button
                type="button"
                onClick={() => onJump(n)}
                aria-current={n === current ? 'step' : undefined}
                aria-label={`Step ${n}, ${s.label}, ${stateWord(s.status)}`}
                className="flex w-full flex-col items-center gap-1.5 rounded px-0.5 py-1"
                style={{ outlineOffset: 2 }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    border: `1px solid ${t.ring}`,
                    background: t.fill,
                    color: t.ink,
                  }}
                >
                  {glyph(s.status, n)}
                </span>
                {/*
                  ⚠️ LABELS ARE DESKTOP-ONLY. Six labelled circles do not fit at
                  375px — each flex item gets about 62px against a 28px circle,
                  leaving roughly 17px of label, which is not a word. The phone
                  gets the circles plus the one-line caption below instead.
                */}
                <span
                  className="hidden w-full truncate text-center text-[11px] leading-tight md:block"
                  style={{
                    color:
                      n === current ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: n === current ? 600 : 400,
                  }}
                >
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* The phone's substitute for the labels. Hidden once they fit. */}
      {currentStep && (
        <p className="mt-1 text-center text-xs text-[var(--text-secondary)] md:hidden">
          <span className="gg-nums">
            Step {current} of {steps.length}
          </span>{' '}
          · {currentStep.label}
        </p>
      )}
    </nav>
  );
}
