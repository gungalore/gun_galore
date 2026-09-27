'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { LicenceApiError } from '@/lib/licence-centre-api';
import {
  formatDay,
  formatWhen,
  kindLabel,
  licenceTrackerApi,
  retryMessage,
  TrackerCooldownError,
  trackerLabel,
  type TrackerDetail,
} from '@/lib/licence-tracker-api';
import TrackerStatusBadge from '@/components/licence-tracker/TrackerStatusBadge';
import TrackerJourney from '@/components/licence-tracker/TrackerJourney';

// ────────────────────────────────────────────────────────────────────
// ONE APPLICATION, AND EVERYTHING WE HAVE EVER SEEN ABOUT IT.
//
// ⚠️ A 404 IS SHOWN AS "WE COULD NOT FIND IT", NOT AS AN ERROR. The service
// answers 404 rather than 403 for another member's id — deliberately, so an id
// cannot be probed for existence — which makes the two indistinguishable from
// here and means neither gets a different message.
//
// ⚠️ THE JOURNEY IS THE PAGE HERE, AND IT IS NOT ALSO PUT IN A WINDOW. The
// list opens the sheet because a summary row carries no events; this route is
// the deep link, it has the full detail already, and a "View history" button
// that opened a modal of the content directly beneath it would be a second
// copy of the same thing with its own scroll.
// ────────────────────────────────────────────────────────────────────

const INPUT =
  'mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-3 py-2 text-[14px] text-[var(--text-primary)]';
const LABEL = 'block text-[12px] font-medium text-[var(--text-secondary)]';
const HINT =
  'mt-1 block text-[11.5px] leading-[1.45] text-[var(--text-tertiary)]';

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

/** Today, as a `YYYY-MM-DD` value for a date input — local, not UTC. */
function todayValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ⚠️ A DATE THE MEMBER PICKED IS TURNED INTO LOCAL NOON, NEVER MIDNIGHT.
 * `new Date('2026-09-03')` parses as midnight UTC, which renders as the 2nd
 * for anyone west of Greenwich — and the member chose a DAY, so we put it in
 * the middle of their own day instead of on the boundary between two.
 */
function localNoon(dateValue: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    12,
    0,
    0,
  ).toISOString();
}

export default function TrackerDetailPage() {
  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [detail, setDetail] = useState<TrackerDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [milestone, setMilestone] = useState({
    title: '',
    status: '',
    nextStep: '',
    observedAt: '',
  });
  const [savingEvent, setSavingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await licenceTrackerApi.get(getToken, id));
    } catch (err) {
      if (err instanceof LicenceApiError && err.status === 404) {
        setMissing(true);
        return;
      }
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = useCallback(async () => {
    setChecking(true);
    setNotice(null);
    try {
      await licenceTrackerApi.check(getToken, id);
      // ⚠️ THE CHECK ANSWERS WITH THE SUMMARY, NOT THE HISTORY. A new SAPS
      // observation was very likely just written and the timeline below would
      // not contain it — so we re-read the detail rather than patching the
      // card and leaving the member staring at a list missing the row they
      // pressed the button to see.
      setDetail(await licenceTrackerApi.get(getToken, id));
    } catch (err) {
      setNotice(
        err instanceof TrackerCooldownError
          ? retryMessage(err.retryAfter)
          : (err as Error).message,
      );
    } finally {
      setChecking(false);
    }
  }, [getToken, id]);

  const addMilestone = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!milestone.title.trim()) {
        setEventError('Give the milestone a title.');
        return;
      }
      setSavingEvent(true);
      setEventError(null);
      try {
        const updated = await licenceTrackerApi.addEvent(getToken, id, {
          title: milestone.title.trim(),
          status: milestone.status.trim() || null,
          nextStep: milestone.nextStep.trim() || null,
          observedAt: milestone.observedAt
            ? localNoon(milestone.observedAt)
            : null,
        });
        setDetail(updated);
        setMilestone({ title: '', status: '', nextStep: '', observedAt: '' });
      } catch (err) {
        setEventError((err as Error).message);
      } finally {
        setSavingEvent(false);
      }
    },
    [getToken, id, milestone],
  );

  if (missing) {
    return (
      <main className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5">
        <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
          Application Tracker
        </h1>
        <p className="m-0 mt-3 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
          We could not find that application. It may have been removed, or the
          link may be from another account.
        </p>
        <Link
          href="/licence-centre/tracking"
          className="mt-3 inline-block text-[13px] text-[var(--text-secondary)] underline"
        >
          Back to your tracked applications
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5">
      <Link
        href="/licence-centre/tracking"
        className="text-[12.5px] text-[var(--text-tertiary)] underline"
      >
        Tracked applications
      </Link>

      {detail === null ? (
        <p className="mt-4 text-[13.5px] text-[var(--text-tertiary)]">
          {error ?? 'Loading…'}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
              {trackerLabel(detail)}
            </h1>
            <TrackerStatusBadge
              status={detail.status}
              outcome={detail.lastOutcome}
            />
          </div>

          <p className="m-0 mt-1 font-mono text-[12.5px] text-[var(--text-tertiary)]">
            {detail.reference} · {kindLabel(detail.kind)}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={check}
              disabled={checking}
              className="min-h-[44px] rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--bg-card)] px-4 text-[13.5px] font-medium text-[var(--text-primary)] disabled:opacity-45"
            >
              {checking ? 'Checking…' : 'Check now'}
            </button>
            <span className="text-[11.5px] text-[var(--text-tertiary)]">
              {detail.lastCheckedAt
                ? `We last asked ${formatWhen(detail.lastCheckedAt)}`
                : 'We have not asked yet'}
            </span>
          </div>

          {notice && (
            <p
              role="status"
              className="mt-3 rounded-[var(--r-sm)] border border-[var(--gold-line)] bg-[var(--gold-wash)] px-3 py-2 text-[12.5px] leading-[1.5] text-[var(--gold-strong)]"
            >
              {notice}
            </p>
          )}

          {detail.lastOutcome === 'no_records' && !detail.status && (
            <p className="m-0 mt-3 text-[13px] leading-[1.55] text-[var(--text-secondary)]">
              SAPS has no record yet against this reference. That is normal for
              an application that was lodged recently, and it is not a refusal.
            </p>
          )}

          {detail.lastOutcome === 'error' && (
            <p className="m-0 mt-3 text-[13px] leading-[1.55] text-[var(--gold-strong)]">
              Our last attempt to read SAPS failed, so what is below may be
              older than it looks. We will try again on the next check.
              {detail.lastError ? (
                <span className="mt-[2px] block text-[12px] text-[var(--text-tertiary)]">
                  {detail.lastError}
                </span>
              ) : null}
            </p>
          )}

          <section className="gg-tile mt-4 grid grid-cols-2 gap-x-3 gap-y-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:grid-cols-3">
            {detail.applicationType && (
              <Fact label="Application" value={detail.applicationType} />
            )}
            {detail.applicationNumber && (
              <Fact label="Application no." value={detail.applicationNumber} />
            )}
            {detail.make && <Fact label="Make" value={detail.make} />}
            {detail.calibre && <Fact label="Calibre" value={detail.calibre} />}
            {detail.serial && (
              <Fact label="Serial on file" value={detail.serial} />
            )}
            {detail.serialSeen && detail.serialSeen !== detail.serial && (
              <Fact label="Serial SAPS prints" value={detail.serialSeen} />
            )}
            {detail.statusDate && (
              <Fact label="Status date" value={formatDay(detail.statusDate)} />
            )}
            <Fact
              label="SAPS data as at"
              value={
                detail.sapsUpdatedOn ? formatDay(detail.sapsUpdatedOn) : '—'
              }
            />
            {detail.submittedOn && (
              <Fact
                label="You lodged it"
                value={formatDay(detail.submittedOn)}
              />
            )}
          </section>

          <p className="m-0 mt-2 text-[11.5px] leading-[1.5] text-[var(--text-tertiary)]">
            &ldquo;SAPS data as at&rdquo; is when the Service last refreshed its
            own records. It is not when we last asked.
          </p>

          <TrackerJourney tracker={detail} events={detail.events} />

          <form
            className="gg-tile mt-5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-4"
            onSubmit={addMilestone}
          >
            <h2 className="m-0 text-[15px] font-medium text-[var(--text-primary)]">
              Add something you did
            </h2>
            <p className="m-0 mt-1 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
              Handed it in, booked an interview, called the DFO. This goes on
              your own timeline marked as yours — we never send it to SAPS.
            </p>

            <label className={`${LABEL} mt-3`} htmlFor="milestone-title">
              What happened
            </label>
            <input
              id="milestone-title"
              value={milestone.title}
              onChange={(e) =>
                setMilestone((m) => ({ ...m, title: e.target.value }))
              }
              maxLength={200}
              placeholder="Handed the application in at the DFO"
              className={INPUT}
            />

            <label className={`${LABEL} mt-3`} htmlFor="milestone-status">
              Status
            </label>
            <input
              id="milestone-status"
              value={milestone.status}
              onChange={(e) =>
                setMilestone((m) => ({ ...m, status: e.target.value }))
              }
              maxLength={60}
              className={INPUT}
            />
            <span className={HINT}>
              Optional, and only for you — this is your own note, not something
              SAPS said.
            </span>

            <label className={`${LABEL} mt-3`} htmlFor="milestone-next">
              What happens next
            </label>
            <input
              id="milestone-next"
              value={milestone.nextStep}
              onChange={(e) =>
                setMilestone((m) => ({ ...m, nextStep: e.target.value }))
              }
              maxLength={500}
              className={INPUT}
            />

            <label className={`${LABEL} mt-3`} htmlFor="milestone-date">
              When
            </label>
            <input
              id="milestone-date"
              type="date"
              value={milestone.observedAt}
              max={todayValue()}
              onChange={(e) =>
                setMilestone((m) => ({ ...m, observedAt: e.target.value }))
              }
              className={INPUT}
            />
            <span className={HINT}>
              Leave it blank for now. You can date something in the past if you
              are writing it up afterwards.
            </span>

            {eventError && (
              <p role="alert" className="mt-3 text-[13px] text-[var(--red)]">
                {eventError}
              </p>
            )}

            <button
              type="submit"
              disabled={savingEvent}
              className="mt-4 min-h-[44px] w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-4 text-[13.5px] font-medium text-[var(--text-primary)] disabled:opacity-45 sm:w-auto"
            >
              {savingEvent ? 'Adding…' : 'Add to my timeline'}
            </button>
          </form>

          <p className="m-0 mt-5 text-[11.5px] leading-[1.5] text-[var(--text-tertiary)]">
            All Outdoor is not affiliated with the South African Police
            Service. We read the status enquiry SAPS publishes and record what
            it answers; your DFO can tell you more than it can.
          </p>
        </>
      )}
    </main>
  );
}
