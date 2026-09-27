'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  daysSince,
  formatDay,
  formatDays,
  formatWhen,
  kindLabel,
  trackerLabel,
  type TrackerView,
} from '@/lib/licence-tracker-api';
import TrackerStatusBadge from './TrackerStatusBadge';

// ────────────────────────────────────────────────────────────────────
// ONE TRACKED APPLICATION.
//
// ⚠️ THE CARD IS A LINK AND THE BUTTONS ARE ITS SIBLINGS, NEVER ITS CHILDREN.
// A <button> nested in an <a> is invalid HTML, and the browsers that tolerate
// it still follow the link on the way to the click — so "Check now" would
// open the detail page instead. Same shape as components/licence-pack/
// application-row.tsx, which learned it first.
//
// ⚠️ `serialSeen` IS NOT `serial`, AND THEY ARE BOTH SHOWN WHEN THEY DIFFER.
// `serial` is what the member typed; `serialSeen` is what SAPS PRINTS. When
// those disagree the enquiry returns no rows at all, and the member has no
// way to guess why — a mis-typed serial is invisible on a card that only ever
// echoes back what they typed.
// ────────────────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="block">
      <span className="block text-[10.5px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className="block text-[13px] leading-[1.4] text-[var(--text-secondary)]">
        {value}
      </span>
    </span>
  );
}

export default function TrackerCard({
  tracker,
  onCheck,
  checking,
  onOpenHistory,
  notice,
  onStop,
  stopping,
}: {
  tracker: TrackerView;
  onCheck: (id: string) => void;
  checking: boolean;
  /**
   * Opens the journey window. ⚠️ HANDED IN RATHER THAN DERIVED FROM `tracker`
   * because the summary carries no events — the history is a second fetch, and
   * only the page can own a loading state and an error for it.
   */
  onOpenHistory: (id: string) => void;
  /**
   * A cooldown refusal or a failed check, from the member's last tap. ⚠️ IT
   * LIVES IN THE CARD, NOT AT THE TOP OF THE PAGE — a member tracking three
   * applications taps Check on the third, and a message in the page header is
   * a message about a different row.
   */
  notice: string | null;
  onStop: (id: string) => void;
  stopping: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = trackerLabel(tracker);
  // ⚠️ NULL WHEN THE MEMBER NEVER SAID. The card cannot fall back to its own
  // creation date without printing "1067 days since you lodged it" over a
  // tracker made last week, which is a sentence that is simply false.
  const days = daysSince(tracker.submittedOn);

  return (
    <li className="gg-tile mb-2 overflow-hidden rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex items-stretch">
        <Link
          href={`/licence-centre/tracking/${tracker.id}`}
          className="flex min-w-0 flex-1 items-start justify-between gap-3 px-[14px] py-3 no-underline hover:bg-[var(--bg-card-hover)]"
        >
          <span className="min-w-0">
            <span className="block text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
              {name}
            </span>
            <span className="mt-[2px] block font-mono text-[12px] text-[var(--text-tertiary)]">
              {tracker.reference}
            </span>
            <span className="mt-[2px] block text-[12px] text-[var(--text-tertiary)]">
              {kindLabel(tracker.kind)}
            </span>
            {days !== null && (
              <span className="mt-[2px] block text-[12px] text-[var(--text-tertiary)]">
                {formatDays(days)} since you lodged it
              </span>
            )}
          </span>
          <TrackerStatusBadge
            status={tracker.status}
            outcome={tracker.lastOutcome}
            asking={checking}
          />
        </Link>

        {/* ⚠️ ONE RAIL, TWO ROWS, AND THE HISTORY BELOW THE CHECK. They are
            siblings of the link and never inside it — a <button> in an <a> is
            invalid, and the browsers that tolerate it still follow the link on
            the way to the click, so "View history" would open the detail page
            instead. Same shape as the Check button it sits under. */}
        <span className="flex flex-shrink-0 flex-col border-l border-[var(--border-divider)]">
          <button
            type="button"
            aria-label={`Check ${name} with SAPS now`}
            onClick={() => onCheck(tracker.id)}
            disabled={checking || stopping}
            className="flex min-h-[44px] flex-1 items-center justify-center px-3.5 text-[12.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-45"
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
          <button
            type="button"
            aria-label={`See the history of ${name}`}
            onClick={() => onOpenHistory(tracker.id)}
            disabled={stopping}
            className="flex min-h-[40px] items-center justify-center border-t border-[var(--border-divider)] px-3.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-45"
          >
            View history
          </button>
        </span>
      </div>

      {/* The facts SAPS answered with. Omitted entirely while we have none, so
          an empty grid of labels never reads as a card that failed to load. */}
      {(tracker.applicationType ||
        tracker.calibre ||
        tracker.make ||
        tracker.statusDate) && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--border-divider)] px-[14px] py-2.5 sm:grid-cols-4">
          {tracker.applicationType && (
            <Fact label="Application" value={tracker.applicationType} />
          )}
          {tracker.make && <Fact label="Make" value={tracker.make} />}
          {tracker.calibre && <Fact label="Calibre" value={tracker.calibre} />}
          {tracker.statusDate && (
            <Fact label="Status date" value={formatDay(tracker.statusDate)} />
          )}
        </div>
      )}

      {/* ⚠️ ONLY WHEN IT DISAGREES WITH WHAT WAS TYPED. SAPS echoing back the
          serial we sent is not news; SAPS printing a different one is the
          single most likely explanation for an empty result. */}
      {tracker.serialSeen &&
        tracker.serial &&
        tracker.serialSeen !== tracker.serial && (
          <p className="m-0 border-t border-[var(--border-divider)] px-[14px] py-2 text-[12px] leading-[1.5] text-[var(--gold-strong)]">
            SAPS prints the serial as <strong>{tracker.serialSeen}</strong>,
            but this tracker was saved with <strong>{tracker.serial}</strong>.
          </p>
        )}

      {tracker.lastOutcome === 'no_records' && !tracker.status && (
        <p className="m-0 border-t border-[var(--border-divider)] px-[14px] py-2 text-[12px] leading-[1.5] text-[var(--text-tertiary)]">
          SAPS holds no record against this reference yet. That is normal for
          one just lodged, and it is not a refusal.
        </p>
      )}

      {tracker.lastOutcome === 'error' && (
        <p className="m-0 border-t border-[var(--border-divider)] px-[14px] py-2 text-[12px] leading-[1.5] text-[var(--gold-strong)]">
          We could not read SAPS on the last check. That does not mean the
          status moved — it means we could not see it.
          {tracker.lastError ? (
            <span className="mt-[2px] block text-[var(--text-tertiary)]">
              {tracker.lastError}
            </span>
          ) : null}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--border-divider)] px-[14px] py-2">
        <span className="text-[11.5px] text-[var(--text-tertiary)]">
          {/* ⚠️ "NOT READ YET" MUST NOT STAND WHILE WE ARE MID-READ. A card is
              asked about the moment it is added, so this line is only ever
              seen in flight — and it read as "we looked and found nothing",
              which is the sentence that sent the member to Check now. */}
          {tracker.sapsUpdatedOn
            ? `SAPS data as at ${formatDay(tracker.sapsUpdatedOn)}`
            : checking
              ? 'Asking SAPS now…'
              : 'SAPS data: not read yet'}
          {tracker.lastCheckedAt
            ? ` · we last asked ${formatWhen(tracker.lastCheckedAt)}`
            : ''}
        </span>

        {/* Two taps, not a dialog: stopping tracking is reversible in wording
            only — there is no route back into the list — so it must not fire
            on one mis-tap, and it must say what survives. */}
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-[11.5px] text-[var(--text-secondary)]">
              Stop asking SAPS about it? What we already recorded stays.
            </span>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={stopping}
              className="text-[11.5px] font-medium text-[var(--text-secondary)] underline disabled:opacity-45"
            >
              Keep tracking
            </button>
            <button
              type="button"
              aria-label={`Stop tracking ${name}`}
              onClick={() => onStop(tracker.id)}
              disabled={stopping}
              className="text-[11.5px] font-medium text-[var(--red)] underline disabled:opacity-45"
            >
              {stopping ? 'Stopping…' : 'Stop tracking'}
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Stop tracking ${name}`}
            onClick={() => setConfirming(true)}
            className="text-[11.5px] text-[var(--text-tertiary)] underline hover:text-[var(--text-secondary)]"
          >
            Stop tracking
          </button>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className="m-0 border-t border-[var(--gold-line)] bg-[var(--gold-wash)] px-[14px] py-2 text-[12px] leading-[1.5] text-[var(--gold-strong)]"
        >
          {notice}
        </p>
      )}
    </li>
  );
}
