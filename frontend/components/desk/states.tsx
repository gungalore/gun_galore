'use client';

/**
 * THE DESK — the three states every data surface owes the operator:
 * still loading, nothing to do, and it broke.
 *
 * ⚠️ A REGION THAT FAILS DOES NOT TAKE THE PAGE WITH IT. The pile, the
 * ribbon, the rail and the feed load independently, and when one of them
 * 500s the others stay live and usable. The failed one shows what it asked
 * for and what came back — not a spinner that never resolves, and not a
 * toast that has scrolled away by the time anyone looks.
 */
import * as React from 'react';
import { Button } from './primitives';
import { IconAlert, IconCheck, IconRefresh } from './icons';

/* ────────────────────────────────────────────────────────────────────────
 * Skeleton
 * ──────────────────────────────────────────────────────────────────────── */

function Bar({ w, h = 12 }: { w: number | string; h?: number }) {
  return (
    <span
      style={{
        display: 'block',
        width: w,
        height: h,
        borderRadius: 'var(--dk-radius-pill)',
        background: 'var(--dk-inset)',
        animation: 'dk-skeleton 1.4s ease-in-out infinite',
      }}
    />
  );
}

/**
 * A card-shaped placeholder in the card's own rhythm.
 *
 * ⚠️ NO SPINNER. A spinner says "something is happening somewhere"; a
 * skeleton in the shape of the thing says "three cards are coming and they
 * will be here". The second is the only one the operator can plan around,
 * and it is also the one that does not shift the layout when data lands.
 */
export function SkeletonCard() {
  return (
    // ⚠️ THE SAME TWO CLASSES DeskCard WEARS, AND THAT IS THE POINT OF A
    // SKELETON: the surface, the hairline, the radius and the 14/16 padding
    // all follow .dk-card for free, so the placeholder reads as the thing it
    // is standing in for rather than as a grey box.
    //
    // ⚠️ THE GAP DOES NOT FOLLOW FOR FREE — IT IS A HAND MIRROR OF card.tsx.
    // DeskCard overrides `.dk-stack`'s `gap: var(--dk-gap)` (10px) with an
    // inline `gap: 8`, and an inline style beats a class. This element carried
    // no gap and took the 10px token, so it opened 6px more across its three
    // gaps than the card it stands in for.
    //
    // ⚠️ AND THAT DOES NOT MEAN THE PILE STOPS MOVING WHEN DATA LANDS. It
    // cannot, and a comment here used to claim it did. DeskCard renders
    // between TWO and FIVE children — the row and the headline are
    // unconditional, meta, note and the actions row are each conditional —
    // while this always draws four bars of 14/15/12/34 against child heights
    // of 22, 20.25 (15px x 1.35), 18.125 (--dk-fs-body x 1.45) and
    // --dk-h-control. Measured at 1280px the skeleton is ~133px against ~126px
    // for a three-child card and ~152px for a four-child one, so it is taller
    // than some cards and shorter than others and no single set of bar heights
    // fixes that. What the mirror buys is narrower and real: the gap stops
    // being a SECOND, independent source of that movement, drifting on its own
    // every time somebody edits one file and not the other.
    //
    // ⚠️ --dk-h-control IS 44px ON A PHONE (tokens.css) AND THIS BAR IS A HARD
    // 34, so the bottom bar is a second hand mirror that nothing pins. It is
    // left as it is deliberately — the skeleton is an approximation and the
    // spec only pins what can be exactly true — but do not read the gap pin as
    // covering it.
    //
    // Both gap numbers are literals in two files. states.spec.tsx pins them
    // equal, because the silent failure is editing one of them — or editing
    // --dk-gap and assuming it reaches both, which it now reaches neither.
    <div
      aria-hidden="true"
      className="dk-card dk-stack"
      style={{ gap: 8, padding: '14px 16px' }}
    >
      <span className="dk-row" style={{ gap: 8 }}>
        <Bar w={14} h={14} />
        <Bar w={96} h={10} />
        <Bar w={64} h={10} />
      </span>
      <Bar w="72%" h={15} />
      <Bar w="54%" h={12} />
      <span className="dk-row" style={{ gap: 8, marginTop: 4 }}>
        <Bar w={92} h={34} />
        <Bar w={78} h={34} />
      </span>
    </div>
  );
}

export function SkeletonPile({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading the pile" className="dk-stack">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * FailedRegion
 * ──────────────────────────────────────────────────────────────────────── */

export interface FailedRegionProps {
  /** "Couldn't load the pile" */
  title: string;
  /** The request that failed and what the server said, verbatim. */
  detail: string;
  onRetry: () => void;
  /** Reassurance that the blast radius is this box and nothing else. */
  scopeNote?: string;
}

export function FailedRegion({
  title,
  detail,
  onRetry,
  scopeNote = 'only this region failed',
}: FailedRegionProps) {
  return (
    <div
      role="alert"
      className="dk-card dk-stack"
      style={{
        gap: 12,
        padding: '16px 18px',
        // One declaration over .dk-card, which is why there is no
        // `.dk-card--bad` modifier: a modifier class to carry a single border
        // colour is how a closed layer stops being closed. The wash is
        // deliberately NOT applied — a red-filled slab reads as "the whole
        // page is broken" when the failure is one region.
        border: '1px solid var(--dk-bad-line)',
      }}
    >
      <span className="dk-row" style={{ gap: 8 }}>
        <IconAlert size={14} style={{ color: 'var(--dk-bad)' }} />
        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--dk-ink)' }}>{title}</span>
      </span>
      <pre
        className="dk-mono"
        style={{
          margin: 0,
          fontSize: 11.5,
          lineHeight: 1.55,
          color: 'var(--dk-ink-2)',
          background: 'var(--dk-ground)',
          border: '1px solid var(--dk-line)',
          borderRadius: 8,
          padding: '10px 12px',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {detail}
      </pre>
      <span className="dk-row">
        <Button variant="primary" icon={IconRefresh} onClick={onRetry}>
          Retry
        </Button>
        <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>{scopeNote}</span>
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * All clear
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ THE EMPTY PILE IS A RESULT, NOT AN ABSENCE. "Nothing needs you" is the
 * best outcome the Desk has, so it is stated plainly and once — no
 * illustration, no encouragement, no confetti. The line underneath says what
 * happens next, because the operator's real question at that moment is not
 * "is it empty" but "will it tell me when it isn't".
 */
export function AllClear({
  next,
  refresh = 'The pile refreshes every 60 seconds.',
}: {
  next: string;
  refresh?: string;
}) {
  return (
    <div
      className="dk-stack"
      style={{ alignItems: 'center', gap: 14, padding: '64px 24px', textAlign: 'center' }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          border: '1px solid var(--dk-line-2)',
          color: 'var(--dk-ink-2)',
        }}
      >
        <IconCheck size={20} />
      </span>
      <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--dk-ink)' }}>
        Nothing needs you.
      </span>
      <span style={{ fontSize: 13, color: 'var(--dk-ink-2)', maxWidth: '46ch', lineHeight: 1.5 }}>
        {next}
      </span>
      <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>{refresh}</span>
    </div>
  );
}
