'use client';

import {
  statusTone,
  type TrackerOutcome,
  type TrackingTone,
} from '@/lib/licence-tracker-api';

// ────────────────────────────────────────────────────────────────────
// ONE WORDS-ONLY PILL, AND THE FOUR THINGS IT CAN BE SAYING.
//
// ⚠️ A STATUS AND AN OUTCOME ARE TWO AXES AND THIS FILE KEEPS THEM APART. A
// status is what SAPS printed. An outcome is what our last attempt to read it
// did — and "no record yet", "we could not read it" and "we have never asked"
// are three different facts a member will act on differently. Collapsing them
// into one grey "no status" pill would tell somebody their just-lodged
// application has a problem when SAPS has simply not filed it yet.
//
// ⚠️ EVERY WORD ON THIS PILL IS ONE SAPS PRINTED, OR OURS ABOUT OUR OWN
// FAILURE. Nothing here is a verdict this platform reached. A DFO reads the
// enquiry; we only repeat it, and the card says so in words beside this.
// ────────────────────────────────────────────────────────────────────

/**
 * What the badge should read, given both axes.
 *
 * ⚠️ A KNOWN STATUS WINS OVER THE OUTCOME. A tracker can hold a status SAPS
 * gave us last week and a failed read this morning; the member's question is
 * still "where is my application", and the honest answer is last week's
 * status PLUS the card's notice that we are currently blind — not a pill that
 * has forgotten the status entirely because the last poll failed.
 *
 * ⚠️ AND `asking` IS A THIRD THING AGAIN — IT IS NOT A RESULT YET.
 * A tracker is read the moment it is added, so the state the pill must never
 * show is the finished-looking "No status read yet" over a card whose first
 * enquiry is still in flight. That reads as the platform having looked and
 * found nothing, which is why the member reaches for Check now. It sits BELOW
 * the two real outcomes on purpose: an answer we already hold is not made
 * truer by the fact that we are re-asking.
 */
export function badgeState(
  status: string | null | undefined,
  outcome: TrackerOutcome | null | undefined,
  asking = false,
): TrackingTone {
  if (status?.trim()) return statusTone(status);
  if (outcome === 'no_records') {
    return {
      label: 'SAPS has no record yet',
      colour: 'var(--text-secondary)',
      wash: 'var(--bg-inset)',
      line: 'transparent',
    };
  }
  if (outcome === 'error') {
    return {
      label: 'We could not read it',
      colour: 'var(--gold-strong)',
      wash: 'var(--gold-wash)',
      line: 'var(--gold-line)',
    };
  }
  if (asking) {
    return {
      label: 'Asking SAPS…',
      colour: 'var(--text-tertiary)',
      wash: 'var(--bg-inset)',
      line: 'transparent',
    };
  }
  return statusTone(null);
}

export default function TrackerStatusBadge({
  status,
  outcome,
  asking = false,
}: {
  status: string | null;
  outcome: TrackerOutcome;
  /** An enquiry is in flight for this tracker right now. */
  asking?: boolean;
}) {
  const tone = badgeState(status, outcome, asking);
  return (
    <span
      // ⚠️ COLOUR IS THE SECOND SIGNAL, NEVER THE FIRST. The label carries the
      // whole meaning in words for a screen reader and for the one member in
      // twelve who cannot tell this gold from this green — the same rule the
      // provenance pills follow.
      className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium"
      style={{
        background: tone.wash,
        color: tone.colour,
        border: `1px solid ${tone.line}`,
      }}
    >
      {tone.label}
    </span>
  );
}
