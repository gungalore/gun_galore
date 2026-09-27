'use client';

import {
  formatDay,
  formatDays,
  formatWhen,
  journey,
  type ElapsedBasis,
  type TrackerEventView,
} from '@/lib/licence-tracker-api';
import TrackerStatusBadge from './TrackerStatusBadge';

// ────────────────────────────────────────────────────────────────────
// WHAT WE HAVE SEEN, NEWEST FIRST, AND WHAT WE CANNOT SEE AT ALL.
//
// ⚠️ THE SUBMISSION ROW IS THE OLDEST ENTRY, SO IT PRINTS LAST. It seeds the
// history rather than sitting at the top of it: the enquiry has never told us
// anything about the day the application was lodged, and a row dated before
// every observation belongs under them. It is drawn even when SAPS has
// answered nothing, because otherwise an untouched tracker is an empty page
// with no indication that it is working.
//
// ⚠️ WE CANNOT RECOVER THE PAST AND THE SCREEN SAYS SO. The SAPS enquiry
// returns the CURRENT status and nothing else; there is no history endpoint
// to ask for. A member who started tracking in September must not be left
// believing the three rows below are the whole life of an application lodged
// in March.
//
// ⚠️ AND EACH ROW CARRIES HOW LONG THAT STEP TOOK — WITH ITS BASIS NAMED.
// `journey()` measures on SAPS's own status dates wherever both rows have one,
// and falls back to our observation stamps only when they do not. The two are
// not the same measurement: a weekly sweep notices on Sunday what SAPS moved on
// Tuesday. A figure printed without saying which clock it came off is a number
// the member cannot check, so the wording differs for each.
// ────────────────────────────────────────────────────────────────────

/** The two streams are named differently on purpose: one is evidence, the
 *  other is the member's own note. */
function sourceWord(source: TrackerEventView['source']): string {
  return source === 'SAPS' ? 'SAPS enquiry' : 'You noted';
}

/**
 * ⚠️ THE BASIS IS PART OF THE SENTENCE, NOT A FOOTNOTE. "447 days after the
 * previous status SAPS printed" and "447 days after the previous one we saw"
 * are different claims, and the member is entitled to know which they are
 * reading — especially on the row where a slow poll makes ours the bigger
 * number.
 */
export function elapsedWord(
  days: number,
  basis: ElapsedBasis | null,
): string {
  const span = formatDays(days);
  if (basis === 'lodged') return `${span} after you lodged it`;
  if (basis === 'seen') return `${span} after the previous one we saw`;
  return `${span} after the previous status SAPS printed`;
}

function Row({
  source,
  when,
  status,
  body,
  nextStep,
  statusDate,
  firearm,
  elapsed,
  elapsedBasis,
}: {
  source: string;
  when: string;
  status: string | null;
  body: string | null;
  nextStep: string | null;
  statusDate: string | null;
  firearm: string | null;
  /** How long this step took. `null` when it cannot be measured. */
  elapsed: number | null;
  elapsedBasis: ElapsedBasis | null;
}) {
  return (
    <li className="relative border-l border-[var(--border)] pb-4 pl-4 last:pb-0">
      {/* ⚠️ NO `var(--x, var(--y))` IN A TAILWIND ARBITRARY VALUE — the
          fallback's comma is the class's argument separator and the class
          silently never compiles. `--text-tertiary` is defined; use it. */}
      <span
        aria-hidden="true"
        className="absolute -left-[3.5px] top-[6px] h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]"
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {source}
        </span>
        <span className="text-[12px] text-[var(--text-tertiary)]">{when}</span>
        {status && (
          <TrackerStatusBadge status={status} outcome="row" />
        )}
      </div>

      {/* ⚠️ ABOVE THE BODY, BECAUSE IT IS ABOUT THE GAP BEFORE THIS ROW, not
          about what the row says. Printed only when it could actually be
          measured — an em dash here would read as a step that took no time. */}
      {elapsed !== null && (
        <p className="m-0 mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
          {elapsedWord(elapsed, elapsedBasis)}
        </p>
      )}

      {body && (
        <p className="m-0 mt-1 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
          {body}
        </p>
      )}

      {firearm && (
        <p className="m-0 mt-1 text-[12.5px] text-[var(--text-tertiary)]">
          {firearm}
        </p>
      )}

      {nextStep && (
        <p className="m-0 mt-1 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
          <span className="font-medium">Next: </span>
          {nextStep}
        </p>
      )}

      {statusDate && (
        <p className="m-0 mt-1 text-[12px] text-[var(--text-tertiary)]">
          Status date {formatDay(statusDate)}
        </p>
      )}
    </li>
  );
}

export default function TrackerTimeline({
  events,
  submittedOn,
}: {
  events: TrackerEventView[];
  /** When the member said they lodged it — a claim of theirs, not a SAPS
   *  observation, and worded as one. */
  submittedOn: string | null;
}) {
  const ordered = journey(events, submittedOn);

  return (
    <section className="mt-5">
      <h2 className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        History
      </h2>

      {ordered.length === 0 && !submittedOn ? (
        <p className="m-0 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
          We have not read SAPS for this application yet. When you press Check
          now, whatever it answers is recorded here.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {ordered.map(({ event: e, elapsedDays, basis }) => (
            <Row
              key={e.id}
              source={sourceWord(e.source)}
              when={formatWhen(e.observedAt)}
              status={e.status}
              body={e.statusDescription}
              nextStep={e.nextStep}
              statusDate={e.statusDate}
              elapsed={elapsedDays}
              elapsedBasis={basis}
              firearm={
                [e.make, e.calibre, e.serial].filter(Boolean).join(' · ') ||
                null
              }
            />
          ))}

          {submittedOn && (
            <Row
              source="You"
              when={formatDay(submittedOn)}
              status={null}
              body="You lodged this application."
              nextStep={null}
              statusDate={null}
              firearm={null}
              // ⚠️ NOTHING PRECEDES THIS ROW, SO NOTHING CAN BE MEASURED. The
              // whole span from here to the first observation is carried by
              // that observation's own "after you lodged it" line.
              elapsed={null}
              elapsedBasis={null}
            />
          )}
        </ol>
      )}

      <p className="m-0 mt-3 text-[12px] leading-[1.5] text-[var(--text-tertiary)]">
        The SAPS enquiry answers with the current status only, so we cannot
        show you anything from before the first time you checked here.
      </p>
    </section>
  );
}
