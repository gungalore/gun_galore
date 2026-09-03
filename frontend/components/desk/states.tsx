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
    <div
      aria-hidden="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Bar w={14} h={14} />
        <Bar w={96} h={10} />
        <Bar w={64} h={10} />
      </span>
      <Bar w="72%" h={15} />
      <Bar w="54%" h={12} />
      <span style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Bar w={92} h={34} />
        <Bar w={78} h={34} />
      </span>
    </div>
  );
}

export function SkeletonPile({ count = 3 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading the pile"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '16px 18px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-bad-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '64px 24px',
        textAlign: 'center',
      }}
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
