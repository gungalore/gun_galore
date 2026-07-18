'use client';

import React, { useEffect, useRef } from 'react';
import { animateOpen, animateClose, popIn } from '@/lib/anim';

// Accordion-style wizard step. Used on the Sell form to declutter the
// page: only one step expanded at a time, completed steps roll up green,
// the current step is red, locked future steps are dim.
//
// Four states:
//   locked   — previous step is incomplete. Bar is dim; clicking does nothing.
//   active   — current step. Bar is red; expanded; the Continue button at
//              the bottom advances to the next step.
//   complete — every required field in this step is filled. Bar is green;
//              collapsed; clicking re-opens for edits.
//   idle     — OPTIONAL and empty (edit surfaces like /profile/edit):
//              neutral chrome, fully clickable, tagged "· Optional".
//              Green would lie ("done" when nothing's filled) and red
//              would nag for something that isn't required yet.
//
// Body open/close is GSAP-driven (smooth real-height interpolation, not
// the janky max-height trick). The status badge pops in when the step
// flips to "complete".

export type StepStatus = 'locked' | 'active' | 'complete' | 'idle';

interface Props {
  number: number;
  title: string;
  description?: string;
  status: StepStatus;
  expanded: boolean;
  onToggle: () => void;
  /** Right-side summary text shown when collapsed (e.g. "Glock 17 Gen 5 · Pistols") */
  summary?: string;
  /** Body content — only rendered when expanded */
  children: React.ReactNode;
  /** Continue button click — usually advances to the next step */
  onContinue?: () => void;
  /** Disable continue (when current step has validation errors despite being expanded) */
  continueDisabled?: boolean;
  /** Last step in the form gets no Continue — the form's Review button takes over */
  hideContinue?: boolean;
}

export function StepAccordion({
  number,
  title,
  description,
  status,
  expanded,
  onToggle,
  summary,
  children,
  onContinue,
  continueDisabled,
  hideContinue,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLSpanElement | null>(null);

  // Animate open / close whenever the expanded prop flips.
  // First render: if expanded, leave it open (skip animateOpen so the page
  // renders fully laid-out for SSR).
  //
  // Duration is deliberately slow (0.6s) — the steps are big content
  // chunks and a faster pop makes the seller lose their place. The eye
  // wants time to follow the unfold.
  const STEP_ANIM_MS = 0.6;
  const firstRun = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (firstRun.current) {
      firstRun.current = false;
      if (!expanded) {
        el.style.height = '0px';
        el.style.overflow = 'hidden';
        el.style.opacity = '0';
      }
      return;
    }
    if (expanded) animateOpen(el, STEP_ANIM_MS);
    else animateClose(el, STEP_ANIM_MS);
  }, [expanded]);

  // Pop the badge whenever this step flips to complete.
  const prevStatus = useRef<StepStatus>(status);
  useEffect(() => {
    if (prevStatus.current !== 'complete' && status === 'complete') {
      popIn(badgeRef.current);
    }
    prevStatus.current = status;
  }, [status]);

  // Status colour
  const accent =
    status === 'complete'
      ? '#22c55e'
      : status === 'active'
        ? 'var(--red)'
        : 'var(--text-tertiary)';

  // Locked steps can't be opened
  const clickable = status !== 'locked';

  return (
    <section
      className="rounded-[8px] overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${
          status === 'active'
            ? 'var(--red)'
            : status === 'complete'
              ? 'rgba(34,197,94,0.4)'
              : 'var(--border)'
        }`,
        opacity: status === 'locked' ? 0.55 : 1,
        transition: 'border-color 600ms ease, opacity 600ms ease',
      }}
    >
      {/* Header bar — always visible */}
      <button
        type="button"
        onClick={clickable ? onToggle : undefined}
        disabled={!clickable}
        className="w-full flex items-center gap-3 sm:gap-4 px-5 sm:px-6 py-4 text-left"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          cursor: clickable ? 'pointer' : 'not-allowed',
          transition: 'background-color 200ms ease',
        }}
      >
        {/* Status badge — round, brand-coloured */}
        <span
          ref={badgeRef}
          className="flex items-center justify-center shrink-0 rounded-full text-xs font-medium"
          style={{
            width: 28,
            height: 28,
            background:
              status === 'complete'
                ? 'rgba(34,197,94,0.15)'
                : status === 'active'
                  ? 'var(--red)'
                  : 'var(--bg-inset)',
            color:
              status === 'complete'
                ? '#22c55e'
                : status === 'active'
                  ? '#fff'
                  : 'var(--text-tertiary)',
            border:
              status === 'complete'
                ? '0.5px solid rgba(34,197,94,0.4)'
                : status === 'active'
                  ? '0.5px solid var(--red)'
                  : '0.5px solid var(--border)',
            transition: 'background-color 500ms ease, color 500ms ease, border-color 500ms ease',
          }}
        >
          {status === 'complete' ? '✓' : number}
        </span>

        {/* Title block */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs uppercase"
              style={{
                color: accent,
                letterSpacing: '0.12em',
                fontWeight: 500,
                transition: 'color 280ms ease',
              }}
            >
              Step {number}
            </span>
            {status === 'complete' && (
              <span
                className="text-xs"
                style={{ color: '#22c55e', fontWeight: 500 }}
              >
                · Done
              </span>
            )}
            {status === 'active' && (
              <span
                className="text-xs"
                style={{ color: 'var(--red)', fontWeight: 500 }}
              >
                · Up next
              </span>
            )}
            {status === 'idle' && (
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}
              >
                · Optional
              </span>
            )}
          </div>
          <div
            className="text-base sm:text-lg mt-0.5"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </div>
          {summary && !expanded && (
            <div
              className="text-xs mt-1 truncate"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {summary}
            </div>
          )}
        </div>

        {/* Chevron */}
        <span
          className="shrink-0"
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 18,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 500ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          ▾
        </span>
      </button>

      {/* Body — GSAP animates real height. No max-height hack. */}
      <div ref={bodyRef}>
        <div
          className="px-5 sm:px-6 pb-5 sm:pb-6"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          {description && (
            <p
              className="text-sm mt-4 mb-5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {description}
            </p>
          )}
          <div className="space-y-4">{children}</div>

          {/* Continue button — bottom of expanded body */}
          {!hideContinue && (
            <div
              className="mt-6 pt-5 flex items-center justify-end gap-3"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              <button
                type="button"
                onClick={onContinue}
                disabled={continueDisabled}
                className="px-5 py-2.5 rounded-[6px] text-sm"
                style={{
                  background: continueDisabled ? 'var(--bg-inset)' : 'var(--red)',
                  color: continueDisabled
                    ? 'var(--text-tertiary)'
                    : '#fff',
                  fontWeight: 500,
                  border: 'none',
                  cursor: continueDisabled ? 'not-allowed' : 'pointer',
                  transition: 'transform 180ms ease, background-color 200ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!continueDisabled) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                Continue →
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
