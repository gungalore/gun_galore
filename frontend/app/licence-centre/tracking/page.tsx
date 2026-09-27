'use client';

import { useAuth } from '@/lib/auth';
import { useCallback, useEffect, useState } from 'react';
import AddTrackerForm from '@/components/licence-tracker/AddTrackerForm';
import TrackerCard from '@/components/licence-tracker/TrackerCard';
import TrackerHistorySheet from '@/components/licence-tracker/TrackerHistorySheet';
import TrackerJourney from '@/components/licence-tracker/TrackerJourney';
import {
  kindLabel,
  licenceTrackerApi,
  retryMessage,
  TrackerCooldownError,
  trackerLabel,
  type CreateTrackerBody,
  type TrackerDetail,
  type TrackerView,
} from '@/lib/licence-tracker-api';

// ────────────────────────────────────────────────────────────────────
// THE SAPS APPLICATION TRACKER.
//
// ⚠️ WE ARE NOT SAPS AND NOTHING HERE MAY READ AS THOUGH WE WERE. We read the
// public status enquiry the Service itself publishes, keep what it says, and
// show it back. No affiliation, no outcome promised, no "we can speed this
// up" — the disclaimer at the foot of this page is not boilerplate, it is the
// boundary of what this screen is allowed to be.
//
// ⚠️ AND THE DFO IS STILL THE ONLY PLACE A DECISION IS MADE. The enquiry is a
// convenience; the DFO can answer things it never will.
// ────────────────────────────────────────────────────────────────────

export default function TrackingPage() {
  const { getToken } = useAuth();

  /** null = we have not asked yet, so nothing that looks like a state is
   *  shown before we know the answer. */
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [trackers, setTrackers] = useState<TrackerView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  /** Per-card, because a cooldown is per-application — and a message about
   *  the third card belongs on the third card. */
  const [notices, setNotices] = useState<Record<string, string>>({});

  /**
   * The journey window. ⚠️ `id` IS CARRIED SEPARATELY FROM `detail` because
   * the list row is a summary with no events on it, so opening the history is
   * a second fetch — and the window has to draw its own title and reference
   * while that fetch is still in the air.
   */
  const [history, setHistory] = useState<{
    id: string;
    detail: TrackerDetail | null;
    error: string | null;
  } | null>(null);

  /**
   * ⚠️ STATUS FIRST, THEN THE LIST — and only if the feature is on. A disabled
   * feature answers 404 on every other route by design (the service gates
   * them), and calling list() anyway would put "Not Found" on a screen whose
   * real message is "this is not switched on".
   */
  const load = useCallback(async () => {
    try {
      const status = await licenceTrackerApi.status(getToken);
      setEnabled(status.enabled);
      if (!status.enabled) return;
      setTrackers(await licenceTrackerApi.list(getToken));
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = useCallback(
    async (id: string) => {
      setCheckingId(id);
      setNotices((n) => {
        const next = { ...n };
        delete next[id];
        return next;
      });
      try {
        const updated = await licenceTrackerApi.check(getToken, id);
        setTrackers((ts) => (ts ?? []).map((t) => (t.id === id ? updated : t)));
      } catch (err) {
        // ⚠️ A COOLDOWN IS AN ANSWER, NOT A FAILURE, and it carries the exact
        // moment to come back. "Try again later" on a screen whose entire
        // purpose is the wait is the least useful sentence available.
        const message =
          err instanceof TrackerCooldownError
            ? retryMessage(err.retryAfter)
            : (err as Error).message;
        setNotices((n) => ({ ...n, [id]: message }));
      } finally {
        setCheckingId(null);
      }
    },
    [getToken],
  );

  /**
   * ⚠️ THE FIRST ENQUIRY RUNS THE MOMENT THE ROW EXISTS. Making the member add
   * a tracker and then press Check now is two steps for one intention, and the
   * card sitting in between reads as though we had already asked SAPS and been
   * told nothing — which is a sentence this screen must never say about an
   * enquiry it has not made yet.
   *
   * ⚠️ AND IT IS NOT FOLDED INTO THE POST. The enquiry is a two-leg handshake
   * with a 20s timeout on each leg, so a create that waited on it would hold
   * "Start tracking" for up to forty seconds. The row lands at once and the
   * card carries the wait.
   *
   * Resolves true only when the tracker exists, so the form clears on that and
   * keeps the member's typing on anything else.
   */
  const create = useCallback(
    async (body: CreateTrackerBody): Promise<boolean> => {
      setAdding(true);
      setFormError(null);
      let created: TrackerView;
      try {
        created = await licenceTrackerApi.create(getToken, body);
      } catch (err) {
        setFormError((err as Error).message);
        return false;
      } finally {
        setAdding(false);
      }
      // Newest first, matching the server's own order — so the row the
      // member just made is the one under their thumb.
      setTrackers((ts) => [created, ...(ts ?? [])]);
      // Deliberately not awaited: `check` reports its own failures on the card
      // and never throws, so the form is free while SAPS is thinking.
      void check(created.id);
      return true;
    },
    [getToken, check],
  );

  const stop = useCallback(
    async (id: string) => {
      setStoppingId(id);
      try {
        await licenceTrackerApi.remove(getToken, id);
        // The service deactivates rather than deletes, and the list only
        // returns active rows — so it leaves this screen while its history
        // stays behind, which is what the confirm text promises.
        setTrackers((ts) => (ts ?? []).filter((t) => t.id !== id));
      } catch (err) {
        setNotices((n) => ({ ...n, [id]: (err as Error).message }));
      } finally {
        setStoppingId(null);
      }
    },
    [getToken],
  );

  /**
   * ⚠️ THE ROW IS NOT OPTIMISTIC HERE, AND THAT IS THE POINT. The history is
   * evidence — dates SAPS printed and days we subtracted from them — so the
   * window opens on a "Loading…" line and fills in when the server answers.
   * Drawing it from whatever the card happens to hold would show a journey
   * built from a summary that has no events on it at all.
   */
  const openHistory = useCallback(
    async (id: string) => {
      setHistory({ id, detail: null, error: null });
      try {
        const detail = await licenceTrackerApi.get(getToken, id);
        // Guarded against a second tap on a different card: without it, the
        // slower of two fetches would overwrite the window the member is
        // actually looking at.
        setHistory((h) => (h?.id === id ? { id, detail, error: null } : h));
      } catch (err) {
        const message = (err as Error).message;
        setHistory((h) => (h?.id === id ? { id, detail: null, error: message } : h));
      }
    },
    [getToken],
  );

  /** The summary from the list, upgraded to the full detail once it lands. */
  const shown = history
    ? {
        row: history.detail ?? trackers?.find((t) => t.id === history.id) ?? null,
        detail: history.detail,
        error: history.error,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5">
      <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
        Application Tracker
      </h1>

      {enabled === false ? (
        <div className="gg-tile mt-4 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <p className="m-0 text-[14px] font-medium text-[var(--text-primary)]">
            The tracker is not switched on.
          </p>
          <p className="m-0 mt-1 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
            We are not reading application statuses at the moment. Your
            applications and documents in the rest of the Licence Centre are
            unaffected.
          </p>
        </div>
      ) : (
        <>
          <p className="m-0 mt-2 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
            Save your application reference and we will ask SAPS&rsquo;s public
            status enquiry about it, keep a record of what it says, and let you
            know when the answer changes. You can still follow up with your DFO
            at any time — they know more than the enquiry does.
          </p>

          {loadError ? (
            <p role="alert" className="mt-3 text-[13.5px] text-[var(--red)]">
              {loadError}
            </p>
          ) : null}

          {enabled === null ? (
            <p className="mt-4 text-[13.5px] text-[var(--text-tertiary)]">
              Loading…
            </p>
          ) : (
            <>
              {trackers === null ? (
                <p className="mt-4 text-[13.5px] text-[var(--text-tertiary)]">
                  Loading…
                </p>
              ) : trackers.length ? (
                <ul className="m-0 mt-4 list-none p-0">
                  {trackers.map((t) => (
                    <TrackerCard
                      key={t.id}
                      tracker={t}
                      checking={checkingId === t.id}
                      onOpenHistory={openHistory}
                      notice={notices[t.id] ?? null}
                      onCheck={check}
                      onStop={stop}
                      stopping={stoppingId === t.id}
                    />
                  ))}
                </ul>
              ) : (
                <p className="m-0 mt-4 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                  You are not tracking anything yet. Add an application below
                  and we will start watching it.
                </p>
              )}

              <AddTrackerForm
                onCreate={create}
                busy={adding}
                error={formError}
              />
            </>
          )}
        </>
      )}

      <p className="m-0 mt-5 text-[11.5px] leading-[1.5] text-[var(--text-tertiary)]">
        All Outdoor is not affiliated with the South African Police Service. We
        read the status enquiry SAPS publishes and record what it answers; we
        cannot change an application, and nothing on this page is a decision.
      </p>

      {shown && (
        <TrackerHistorySheet
          title={shown.row ? trackerLabel(shown.row) : 'Your application'}
          subtitle={
            shown.row
              ? `${shown.row.reference} · ${kindLabel(shown.row.kind)}`
              : null
          }
          onClose={() => setHistory(null)}
        >
          {shown.error ? (
            <p role="alert" className="m-0 mt-2 text-[13.5px] text-[var(--red)]">
              {shown.error}
            </p>
          ) : shown.detail ? (
            <TrackerJourney
              tracker={shown.detail}
              events={shown.detail.events}
            />
          ) : (
            <p className="m-0 mt-2 text-[13.5px] text-[var(--text-tertiary)]">
              Loading…
            </p>
          )}
        </TrackerHistorySheet>
      )}
    </main>
  );
}
