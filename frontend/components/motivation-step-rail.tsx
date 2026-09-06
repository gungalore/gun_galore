'use client';

import { useEffect, useRef } from 'react';
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

/**
 * The colour for a status. Paired with a glyph — never load-bearing alone.
 *
 * ⚠️ EXPORTED, because the vertical navigator beside this rail shows the same
 * six steps and must not invent a second vocabulary for them. One tone table,
 * two layouts — the phone gets the rail, the desktop gets the navigator, and a
 * step that reads "done" in one can never read "started" in the other.
 *
 * ⚠️ EVERY COLOUR HERE IS A TOKEN, DERIVED — NEVER A LITERAL rgba().
 * The ink was tokenised and the ring and fill were not: they carried
 * rgba(47,158,107,…) and rgba(212,154,58,…), which are the RETIRED DARK-THEME
 * green and amber. --success is #1F7A50 and --warning is #8F6E0F on the white
 * retail theme, so a "complete" circle drew a pale mint ring round dark-green
 * ink — two different greens for one idea, on one circle. color-mix keeps the
 * dilution and takes the value from the token, so the next retune reaches all
 * three at once. (⚠️ NOT `var(--success)18` — a custom property cannot be
 * alpha-diluted by concatenation; it expands to two tokens and the whole
 * declaration dies at computed-value time.)
 */
export function tone(status: StepStatus): { ring: string; fill: string; ink: string } {
  switch (status) {
    case 'complete':
      return {
        ring: 'color-mix(in srgb, var(--success) 55%, transparent)',
        fill: 'color-mix(in srgb, var(--success) 16%, transparent)',
        ink: 'var(--success)',
      };
    case 'active':
      return { ring: 'var(--red)', fill: 'var(--red)', ink: '#fff' };
    case 'partial':
      return {
        ring: 'color-mix(in srgb, var(--warning) 50%, transparent)',
        fill: 'color-mix(in srgb, var(--warning) 14%, transparent)',
        ink: 'var(--warning)',
      };
    default:
      return { ring: 'var(--border)', fill: 'transparent', ink: 'var(--text-tertiary)' };
  }
}

/** Tick, dot, or the step number. See the glyph note in the file header. */
export function glyph(status: StepStatus, n: number): string {
  if (status === 'complete') return '✓';
  if (status === 'partial') return '•';
  return String(n);
}

/** What a screen reader hears instead of the colour. */
export function stateWord(status: StepStatus): string {
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

  // ⚠️ ELEVEN STEPS DO NOT FIT AT 390px, AND THE RAIL SCROLLS RATHER THAN
  // SHRINKS. Eleven flex items across a 358px content box is a 32px circle
  // with nothing round it — below the 44px minimum and unhittable with a
  // thumb. So the strip scrolls horizontally at full size and the ACTIVE step
  // is brought into view whenever it changes, because a progress rail whose
  // current step is off-screen tells the member nothing at all.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current?.children[current - 1] as HTMLElement | undefined;
    // `block: 'nearest'` so bringing a step into view never scrolls the PAGE —
    // the member is reading the form, not the rail.
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [current]);

  return (
    <nav aria-label="Progress" className="mb-5">
      <ol
        ref={listRef}
        className="flex w-full items-start justify-between gap-1 overflow-x-auto"
      >
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
                // ⚠️ 44px MINIMUM, and it is the BUTTON that has to reach it,
                // not the circle. A 28px circle with 4px of padding is a 36px
                // target — under the floor, and the one control on this page
                // somebody taps while walking.
                className="flex min-h-[44px] w-full min-w-[44px] flex-col items-center justify-center gap-1.5 rounded px-0.5 py-1.5"
                style={{ outlineOffset: 2 }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
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
                    fontWeight: n === current ? 500 : 400,
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
