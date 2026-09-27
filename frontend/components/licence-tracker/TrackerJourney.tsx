'use client';

import {
  daysSince,
  formatDay,
  formatDays,
  observations,
  SAPS_STAGES,
  stageFor,
  terminalFor,
  type TrackerEventView,
  type TrackerView,
} from '@/lib/licence-tracker-api';
import TrackerStatusBadge from './TrackerStatusBadge';
import TrackerTimeline from './TrackerTimeline';

// ────────────────────────────────────────────────────────────────────
// THE WHOLE JOURNEY: how long it has been, where it stands on the usual
// path, and everything we have ever seen about it.
//
// ⚠️ ONE RULE GOVERNS EVERY WORD IN THIS FILE. We are not SAPS. The days
// counter is arithmetic on a date the member gave us. The ladder is the order
// in which the statuses SAPS PRINTS tend to arrive — every rung is one of
// those statuses, none is a step we invented, and none is a promise. The
// ellipses, the "usually", and the disclaimer at the foot are load-bearing.
//
// ⚠️ AND NOTHING IS INFERRED FROM POSITION. Marking the rungs below the
// member's current one as "done" would be us deciding that an approved
// application necessarily passed through CFR — which is a claim about their
// file we cannot make from a status line. A rung is marked SEEN only when one
// of the member's own recorded rows actually carries it.
// ────────────────────────────────────────────────────────────────────

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border)] px-1.5 py-[1px] text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
      {children}
    </span>
  );
}

/**
 * How long it has been, from the day the member said they lodged it.
 *
 * ⚠️ NO DATE, NO NUMBER. Falling back to when we started tracking, or to
 * SAPS's first status date, would put a figure on screen that answers a
 * different question from the one the label asks — "1 067 days since you
 * lodged it" over a tracker created last week is simply a false sentence. The
 * prompt is quieter than the counter and it is editable, which is the trade
 * the Automate rule asks for: fill in what we can stand behind, and ask for
 * the rest rather than guessing it.
 */
function DaysCounter({ submittedOn }: { submittedOn: string | null }) {
  const days = daysSince(submittedOn);

  if (days === null) {
    return (
      <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--text-tertiary)]">
        Add the date you lodged it and we will show how long it has been.
      </p>
    );
  }

  return (
    <p className="m-0 text-[13px] leading-[1.5] text-[var(--text-secondary)]">
      <span className="text-[19px] font-medium text-[var(--text-primary)]">
        {formatDays(days)}
      </span>{' '}
      since you lodged it on {formatDay(submittedOn)}.
    </p>
  );
}

/**
 * The usual path, with the member's position on it.
 *
 * ⚠️ AN UNRECOGNISED STATUS IS NOT PLACED ANYWHERE. A status nobody here has
 * seen gets its own sentence naming the raw text rather than a rung, because a
 * position on this ladder is itself an assertion about where the application
 * is. Same for a terminal one: a refusal is not a later stage of an approval,
 * so it is lifted out of the ladder entirely.
 */
function StageLadder({
  status,
  seen,
}: {
  status: string | null;
  /** Statuses actually present in the recorded history, lower-cased. */
  seen: Set<string>;
}) {
  const at = stageFor(status);
  const terminal = terminalFor(status);
  const unplaced = status?.trim() && at === null && terminal === null;

  return (
    <section className="mt-4">
      <h2 className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        The usual path
      </h2>

      {terminal && (
        <div className="mb-3 rounded-[var(--r-sm)] border border-[var(--red-line)] bg-[var(--red-wash)] px-3 py-2">
          <p className="m-0 text-[13px] font-medium text-[var(--red)]">
            {terminal.label}
          </p>
          <p className="m-0 mt-0.5 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
            {terminal.blurb}
          </p>
        </div>
      )}

      {unplaced && (
        <p className="m-0 mb-3 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
          SAPS is showing a status that is not on this path:{' '}
          <strong className="font-medium">{status}</strong>. That is not a
          warning — it is a status we do not have a place for, so we have not
          guessed at one.
        </p>
      )}

      <ol className="m-0 list-none p-0">
        {SAPS_STAGES.map((stage, i) => {
          const here = !terminal && at === i;
          return (
            <li
              key={stage.status}
              className="flex gap-2.5 border-l border-[var(--border)] pb-3 pl-3 last:pb-0"
            >
              {/* ⚠️ THE MARKER IS FILLED FOR "YOU ARE HERE" AND NOTHING ELSE.
                  A filled dot on every rung below would be a progress claim. */}
              <span
                aria-hidden="true"
                className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: here ? 'var(--red)' : 'transparent',
                  border: here
                    ? 'none'
                    : '1.5px solid var(--border-strong)',
                }}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className="text-[13px] font-medium"
                    style={{
                      color: here
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                    }}
                  >
                    {stage.label}
                  </span>
                  {here && <Tag>you are here</Tag>}
                  {!here && seen.has(stage.status) && <Tag>seen before</Tag>}
                </span>
                <span className="mt-0.5 block text-[12px] leading-[1.5] text-[var(--text-tertiary)]">
                  {stage.blurb}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="m-0 mt-3 text-[11.5px] leading-[1.5] text-[var(--text-tertiary)]">
        This is the order these usually follow. SAPS can skip a stage, repeat
        one, or answer with one we have not seen — and we are not SAPS, so this
        is not a decision about your application.
      </p>
    </section>
  );
}

export default function TrackerJourney({
  tracker,
  events,
}: {
  tracker: TrackerView;
  events: TrackerEventView[];
}) {
  const seen = new Set(
    events
      .map((e) => e.status?.trim().toLowerCase())
      .filter((s): s is string => Boolean(s)),
  );

  // ⚠️ THE MOST RECENT THING SAPS SAID, AND ONLY SAPS. A MEMBER milestone
  // carries a "what happens next" of the member's own making — the box is on
  // the same form — so a search across every row would happily print their
  // note under the heading "In SAPS's own words". The source is the filter,
  // not the presence of the field.
  const said = observations(events).find(
    (e) => e.source === 'SAPS' && (e.nextStep || e.statusDescription),
  );

  return (
    <div>
      <DaysCounter submittedOn={tracker.submittedOn} />

      {(said?.statusDescription || said?.nextStep) && (
        <div className="mt-3 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2">
          <p className="m-0 text-[10.5px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
            In SAPS&rsquo;s own words
          </p>
          {said?.statusDescription && (
            <p className="m-0 mt-1 text-[13px] leading-[1.55] text-[var(--text-secondary)]">
              {said.statusDescription}
            </p>
          )}
          {said?.nextStep && (
            <p className="m-0 mt-1 text-[13px] leading-[1.55] text-[var(--text-secondary)]">
              <span className="font-medium">Next step: </span>
              {said.nextStep}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          Where it stands
        </span>
        <TrackerStatusBadge
          status={tracker.status}
          outcome={tracker.lastOutcome}
        />
      </div>

      <StageLadder status={tracker.status} seen={seen} />

      <TrackerTimeline events={events} submittedOn={tracker.submittedOn} />
    </div>
  );
}
