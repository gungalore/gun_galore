'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

/**
 * THE BENCH — the signed-out prompt.
 *
 * A declared visitor can use the whole finder, but there is nowhere to keep a
 * shelf and no log to append to until they have an account. The copy says
 * exactly that and offers the one way out; the controls that would write —
 * Copy link, the load log, "Log this load" — are absent rather than dead, so a
 * guest never presses something that can only fail.
 *
 * ⚠️ ONE SENTENCE, THREE PLACES (the tool bar, the rail/sheet, the load card).
 * A prompt retyped per surface drifts into three different promises, and the
 * one a guest reads first is the one the others contradict. GUEST_PROMPT is the
 * spelling; the surfaces pass `compact` to fit, never different words.
 *
 * ⚠️ AND NO "SAVE" CONTROL IS OFFERED BESIDE IT. The bench saves itself on
 * every change for a member (see BenchRail's SavedBadge), so for a guest the
 * truthful state is "not saved" — a disabled Save button would imply the shelf
 * exists somewhere to be saved to.
 */
export const GUEST_PROMPT = 'Sign in to save your bench and load log';

/** Where signing in returns to — the finder, with its filters in the URL. */
export const GUEST_SIGN_IN_HREF = '/sign-in?redirect_url=/bench';

export default function GuestPrompt({
  compact = false,
  style,
}: {
  /** The rail/sheet's smaller line; the tool bar and card use the default. */
  compact?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 4,
        fontSize: compact ? 11.5 : 12.5,
        lineHeight: 1.35,
        color: 'var(--text-tertiary)',
        ...style,
      }}
    >
      {GUEST_PROMPT}.{' '}
      <Link
        href={GUEST_SIGN_IN_HREF}
        style={{ color: 'var(--link)', fontWeight: 500, whiteSpace: 'nowrap' }}
      >
        Sign in
      </Link>
    </span>
  );
}
