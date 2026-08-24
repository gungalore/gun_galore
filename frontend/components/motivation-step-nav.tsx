'use client';

import type { CSSProperties } from 'react';
import type { StepStatus } from './step-accordion';
import { glyph, stateWord, tone } from './motivation-step-rail';

// ────────────────────────────────────────────────────────────────────
// THE MOTIVATION WIZARD'S SIDE NAVIGATOR.
//
// Operator, 2026-08-24, choosing between three drawn directions: "We are going
// to go for the side view option, I like that."
//
// ⚠️ THIS REPLACES THE HORIZONTAL RAIL ON DESKTOP ONLY, and the rail stays for
// the phone. Six labelled circles do not fit at 375px — that is written up in
// motivation-step-rail, which falls back to circles plus a caption there — and
// a vertical list of six rows does not fit ABOVE the form on a phone either.
// So: navigator from `lg` up, rail below it, one `steps` array feeding both.
//
// ⚠️ THE COUNTS ARE THE WHOLE POINT OF THE SWITCH. A horizontal rail can carry
// a status and a short label and nothing else. This form has ~31 answerable
// fields spread over six steps of wildly uneven weight — Documents is uploads,
// Storage is six typed answers — and a rail that renders them as six equal
// segments says they are equal. "6 to answer" against a step is the thing a
// member actually needs to plan their evening around.
//
// ⚠️ THE VOCABULARY IS IMPORTED, NOT REDECLARED. tone/glyph/stateWord come from
// the rail so the two layouts cannot drift: a step that is amber-with-a-dot on
// the phone is amber-with-a-dot here. Re-implementing them "just for the side
// nav" is exactly how a design system grows two greens.
//
// ⚠️ NOTHING IS EVER LOCKED, same contract as the rail. People fill a licence
// application in the order their paperwork comes to hand, so every row is a
// real button — including the ones ahead of where they have reached.
// ────────────────────────────────────────────────────────────────────

export interface NavStep {
  key: string;
  label: string;
  status: StepStatus;
  /**
   * How many REQUIRED answers this step is still missing.
   *
   * ⚠️ FROM THE SAME `outstanding` UNION THE GENERATE GATE READS. If this
   * counted differently the form could show six zeroes and still be refused —
   * see the note on railSteps in the motivation page.
   */
  outstanding: number;
}

/**
 * A count, in words rather than as a bare number.
 *
 * ⚠️ "4" IN AMBER IS A COLOUR-ONLY SIGNAL and a screen reader hears nothing but
 * a digit. The design review caught this on the mock-up: the number needs its
 * unit, and the unit is what makes it actionable.
 */
function countLabel(status: StepStatus, outstanding: number): string {
  if (outstanding > 0) return `${outstanding} to answer`;
  if (status === 'complete') return 'Done';
  return 'Nothing outstanding';
}

export default function MotivationStepNav({
  steps,
  current,
  onJump,
  answered,
  answerable,
  className = '',
}: {
  steps: readonly NavStep[];
  /** 1-based number of the step on screen. */
  current: number;
  onJump: (n: number) => void;
  /** Required fields with something in them, across the whole application. */
  answered: number;
  /** Required fields in total. */
  answerable: number;
  className?: string;
}) {
  // Guard the divide: a licence type whose registry asks for nothing required
  // would otherwise render a NaN-width bar rather than an empty one.
  const pct = answerable > 0 ? Math.round((answered / answerable) * 100) : 0;

  return (
    <nav aria-label="Progress" className={className}>
      {/* ── the whole application, in one line ──────────────────── */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            Overall
          </span>
          <span className="gg-nums text-xs font-semibold text-[var(--text-primary)]">
            {answered} / {answerable}
          </span>
        </div>
        {/*
          A 4px track with a 2px cap — the one place a radius outside the
          6/10/16 scale is right, because it is half the height of the bar
          rather than a corner on a box.
        */}
        <div
          className="h-1 overflow-hidden rounded-[2px]"
          style={{ background: 'var(--border)' }}
          role="progressbar"
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={answerable}
          aria-label={`${answered} of ${answerable} answered`}
        >
          <div
            className="h-full"
            style={{ width: `${pct}%`, background: 'var(--red)' }}
          />
        </div>
      </div>

      <ol className="flex flex-col gap-0.5">
        {steps.map((s, i) => {
          const n = i + 1;
          const t = tone(s.status);
          const isCurrent = n === current;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onJump(n)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`Step ${n}, ${s.label}, ${stateWord(s.status)}, ${countLabel(
                  s.status,
                  s.outstanding,
                )}`}
                /*
                  ⚠️ THE RESTING BACKGROUND IS A CUSTOM PROPERTY, NOT AN INLINE
                  `background`. It was inline, and that silently killed the
                  hover: an inline declaration beats an author class rule
                  whatever its specificity, and Tailwind emits no !important
                  here — so every row was unhoverable and the five non-current
                  rows, being transparent, had no affordance at all. Setting a
                  VARIABLE inline and consuming it from a class puts both
                  states back in the cascade where the hover can win. Same
                  family of trap as `ring-*` rendering nothing on this site.
                */
                className="flex w-full items-center gap-2.5 rounded-[10px] bg-[var(--row-bg)] px-3 py-2.5 text-left hover:bg-[var(--bg-card-hover)]"
                style={
                  {
                    '--row-bg': isCurrent ? 'var(--bg-card)' : 'transparent',
                    border: `1px solid ${isCurrent ? 'var(--border)' : 'transparent'}`,
                    outlineOffset: 2,
                  } as CSSProperties
                }
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{
                    border: `1px solid ${t.ring}`,
                    background: t.fill,
                    color: t.ink,
                  }}
                >
                  {glyph(s.status, n)}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[13.5px] font-semibold"
                    style={{
                      color: isCurrent
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                    }}
                  >
                    {s.label}
                  </span>
                  {/* No second line here on purpose. It carried STEP_PLAN's
                      blurb, which only one of the six steps has and which runs
                      to 135 characters — in a ~125px slot that truncated to
                      "This is the step that…", a fragment that says nothing.
                      The step heading below the navigator already shows it in
                      full, where there is room for it. */}
                </span>

                <span
                  aria-hidden="true"
                  className="gg-nums shrink-0 text-[11.5px] font-semibold"
                  style={{
                    color:
                      s.outstanding > 0
                        ? 'var(--warning)'
                        : s.status === 'complete'
                          ? 'var(--success)'
                          : 'var(--text-tertiary)',
                  }}
                >
                  {countLabel(s.status, s.outstanding)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
