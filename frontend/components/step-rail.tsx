'use client';

// The horizontal step rail — one system, every multi-step flow.
//
// Operator, 2026-08-27: "all multi step setups has to have the same horizontal
// step rail system", applied everywhere such a flow exists rather than only
// where a design board happens to draw one.
//
// Before this, four flows each invented their own progress display: Sell had a
// vertical accordion with numbered headers, the motivation wizard had a
// left-hand side rail, checkout had nothing, and KYC had nothing. Same job,
// four answers, and a seller who lists an item then writes a motivation met two
// different ideas of what "step 3" looks like.
//
// ⚠️ FIVE LABELLED STEPS DO NOT FIT ACROSS A 390px PHONE. The design pack knows
// this — its mobile boards draw a single-line "Photos · Step 1 of 4" row with a
// progress track instead of the rail. So this component is one half of a pair,
// and `mobile` decides where the other half comes from:
//
//   'inline' (default) — this component draws the compact row itself, below md.
//                        Self-sufficient: works on ANY route.
//   'shell'            — the flow publishes its step with useShellStep() and the
//                        mobile shell header draws the row under the page title,
//                        which is where the pack puts it. Only valid where the
//                        shell actually mounts.
//
// ⚠️ 'shell' IS NOT SAFE EVERYWHERE, AND THE DEFAULT IS DELIBERATELY THE OTHER
// ONE. lib/shell-routes.ts lists routes that get no shell at all — /admin,
// /sign-in, /sign-up, /offline — and the chromeless statutory routes /witness
// and /consent get none either. On any of those, useShellStep resolves to the
// context's no-op default and silently does nothing, so a 'shell' rail would
// show a full step display on a desktop and NOTHING WHATSOEVER on a phone.
// Defaulting to 'inline' means getting this wrong costs a row in a slightly
// different place, rather than no progress indicator at all for most users.
//
// Values are the pack's own, read off SellListing.dc.html:
//   rail      15px 24px padding, white, 1px bottom rule, 12px gap
//   circle    24px, complete #1F7A50 + tick, current #C8102E, upcoming outlined
//   label     12.5px — 600 complete, 700 current, 500 upcoming
//   connector 1px hairline, flex:1, min-width 16px

import type { CSSProperties } from 'react';

export type StepRailStep = {
  label: string;
  /** Done. Renders a tick rather than a number. */
  complete?: boolean;
};

function Tick() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 10 17.5 19 7"
        stroke="#fff"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StepRail({
  steps,
  current,
  onJump,
  mobile = 'inline',
  className = '',
}: {
  steps: StepRailStep[];
  /** 1-based. */
  current: number;
  /** Omit to make the rail purely indicative. */
  onJump?: (step: number) => void;
  /** Where the phone-sized display comes from. See the note above. */
  mobile?: 'inline' | 'shell';
  className?: string;
}) {
  if (steps.length === 0) return null;

  const here = steps[current - 1];
  const pct = Math.max(0, Math.min(100, Math.round((current / steps.length) * 100)));

  return (
    <>
      {mobile === 'inline' && here && (
        <div
          className="gg-step-rail-inline"
          style={{
            // Same rule as the rail below: the class owns `display`, because it
            // is what flips at the breakpoint.
            flexDirection: 'column',
            gap: 8,
            padding: '12px 16px',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {here.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>
              Step {current} of {steps.length}
            </span>
          </div>
          <div
            aria-hidden
            style={{
              height: 5,
              borderRadius: 999,
              background: 'var(--bg-inset)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: 'var(--red)',
                transition: 'width var(--dur-base) var(--ease-out)',
              }}
            />
          </div>
        </div>
      )}

    <nav
      aria-label="Progress"
      className={`gg-step-rail ${className}`}
      style={{
        // ⚠️ NO `display` HERE. An inline display beats the .gg-step-rail class
        // that hides this below md, so setting it inline put the full desktop
        // rail on phones alongside the compact row — both at once. The class
        // owns display; everything else is inline.
        alignItems: 'center',
        gap: 12,
        padding: '15px 24px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flex: 1,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {steps.map((s, i) => {
          const n = i + 1;
          const isCurrent = n === current;
          const isComplete = Boolean(s.complete) && !isCurrent;

          const circle: CSSProperties = {
            width: 24,
            height: 24,
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontFamily: 'var(--font-display), Archivo, sans-serif',
            fontSize: 11.5,
            lineHeight: 1,
            ...(isComplete
              ? { background: 'var(--success)', color: '#fff', fontWeight: 700 }
              : isCurrent
                ? { background: 'var(--red)', color: '#fff', fontWeight: 700 }
                : {
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-hover)',
                    color: 'var(--text-faint)',
                    fontWeight: 600,
                  }),
          };

          const label: CSSProperties = {
            fontSize: 12.5,
            whiteSpace: 'nowrap',
            color: isComplete || isCurrent ? 'var(--text-primary)' : 'var(--text-faint)',
            fontWeight: isCurrent ? 700 : isComplete ? 600 : 500,
          };

          // Only somewhere the member has already been is worth offering. A
          // step they have not reached is not a link to a shortcut, it is a
          // link to an empty form.
          const reachable = Boolean(onJump) && (isComplete || isCurrent);

          const inner = (
            <>
              <span style={circle}>{isComplete ? <Tick /> : n}</span>
              <span style={label}>{s.label}</span>
            </>
          );

          return (
            <li
              key={s.label + n}
              style={{ display: 'contents' }}
            >
              {reachable ? (
                <button
                  type="button"
                  onClick={() => onJump?.(n)}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="gg-press"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    borderRadius: 999,
                  }}
                >
                  {inner}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  {inner}
                </span>
              )}
              {n < steps.length && (
                <span
                  aria-hidden
                  style={{
                    flex: 1,
                    height: 1,
                    minWidth: 16,
                    background: 'var(--border)',
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
    </>
  );
}
