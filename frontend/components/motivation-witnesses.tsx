'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { motivationsApi, type WitnessSummary } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE APPLICANT'S HALF: two slots, and what is in them.
//
// Operator, 2026-08-21: "The applicant must enter the name and cell number of
// the two persons. We will then send them a link to electronicly fill in the
// form and sign it... The applicant must be able to view the statement once
// it's filled out. They have full right to delete it. if they delete it the
// spot to enter a new witness name and number opens."
//
// ⚠️ THE ONE-HOUR EXPIRY IS SAID OUT LOUD, TWICE. It is short on purpose — it
// forces the applicant to phone their witness before sending, which is the
// conversation that should happen anyway — but an applicant who does not know
// that will send two links, go to lunch, and find both dead. The warning is
// next to the button, not in a help page.
//
// ⚠️ AND DELETING SAYS WHAT IT DESTROYS. A signed statement is somebody else's
// work, given as a favour; "Remove" on its own is too small a word for it.
// ────────────────────────────────────────────────────────────────────

const SLOTS = [1, 2] as const;

export default function MotivationWitnesses({
  motivationId,
}: {
  motivationId: string;
}) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<WitnessSummary[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<
    Record<number, { name: string; phone: string }>
  >({});
  const [open, setOpen] = useState<string | null>(null);
  const [sigUrl, setSigUrl] = useState<Record<string, string>>({});

  /**
   * ⚠️ A FAILED LOAD USED TO BE INVISIBLE, FOREVER.
   *
   * This had no try at all, and the render below returns null while `rows` is
   * null — so a dropped request left `rows` null for the life of the page and
   * the whole witness section simply did not exist. Nothing on screen, nothing
   * in the console the member can see, and no way to try again: an applicant
   * whose statements are outstanding is told nothing is outstanding.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await motivationsApi.witnesses(getToken, motivationId);
      setRows(res.witnesses);
      setLoadFailed(false);
    } catch {
      // Only the FIRST load can strand the section — a failed poll leaves the
      // rows already on screen alone, which is the honest thing to do.
      setLoadFailed((prev) => prev || rowsRef.current === null);
    }
  }, [getToken, motivationId]);

  // Read inside `load` rather than closed over, so the callback identity does
  // not change with the rows and restart the poll on every read.
  const rowsRef = useRef<WitnessSummary[] | null>(null);
  rowsRef.current = rows;

  useEffect(() => {
    void load();
  }, [load]);

  // ── Watch for the witness finishing ───────────────────────────────
  //
  // ⚠️ THE APPLICANT HAS NO OTHER WAY TO FIND OUT. A witness completes on
  // their own phone, minutes or hours later, and nothing on this page would
  // change until it was reloaded — so the operator watched somebody sign and
  // saw nothing happen here. There is no push channel to a browser tab, so it
  // polls.
  //
  // Only while something is still outstanding: two signed statements poll
  // nothing, forever. And only while the tab is visible, because a page left
  // open overnight in a background tab should not spend the night asking.
  const pending = (rows ?? []).some(
    (r) => r.status !== 'COMPLETED' && r.status !== 'DECLINED',
  );
  useEffect(() => {
    if (!pending) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(tick, 20_000);
    // Catch up the moment they come back to the tab, rather than making them
    // wait out the rest of an interval that ran while it was hidden.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [pending, load]);

  // ── Object URLs pin their blob until revoked ──────────────────────
  //
  // ⚠️ ON UNMOUNT ONLY, THROUGH A REF. This depended on `sigUrl`, so React ran
  // the cleanup on every CHANGE as well as on unmount — and the change is a
  // second signature being opened. Viewing witness 2 revoked witness 1's URL
  // while its <img> was still pointing at it, and the first signature turned
  // into a broken image with nothing to say why. The ref is written during
  // render so the unmount cleanup sees the final set.
  const sigUrlRef = useRef<Record<string, string>>({});
  sigUrlRef.current = sigUrl;
  useEffect(
    () => () => {
      Object.values(sigUrlRef.current).forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const invite = async (slot: number) => {
    const d = draft[slot];
    if (!d?.name?.trim() || !d?.phone?.trim()) {
      setError('Please give a name and a cell number.');
      return;
    }
    setBusy(slot);
    setError(null);
    try {
      await motivationsApi.inviteWitness(getToken, motivationId, {
        slot,
        name: d.name.trim(),
        phone: d.phone.trim(),
      });
      setDraft((x) => ({ ...x, [slot]: { name: '', phone: '' } }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the link.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (w: WitnessSummary) => {
    setBusy(w.slot);
    setError(null);
    try {
      await motivationsApi.removeWitness(getToken, motivationId, w.id);
      setOpen(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that.');
    } finally {
      setBusy(null);
    }
  };

  const showSignature = async (w: WitnessSummary) => {
    if (sigUrl[w.id]) return;
    const url = await motivationsApi.witnessSignatureUrl(
      getToken,
      motivationId,
      w.id,
    );
    if (url) setSigUrl((s) => ({ ...s, [w.id]: url }));
  };

  // ⚠️ A LOADING SECTION AND A FAILED ONE ARE NOT THE SAME THING, and both
  // used to render as nothing at all.
  if (!rows) {
    if (!loadFailed) return null;
    return (
      <div role="alert" className="mt-4 rounded border border-[var(--border)] p-3">
        <p className="text-sm">
          We could not load your witnesses just now.
        </p>
        <button
          type="button"
          onClick={() => {
            setLoadFailed(false);
            void load();
          }}
          className="mt-2 min-h-[44px] rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
        >
          Try again
        </button>
      </div>
    );
  }
  const bySlot = new Map(rows.map((r) => [r.slot, r]));

  return (
    <div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--red)]">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {SLOTS.map((slot) => {
          const w = bySlot.get(slot);

          if (!w) {
            return (
              <div
                key={slot}
                className="rounded border border-[var(--border)] p-3"
              >
                <p className="text-sm font-medium">Witness {slot}</p>
                {/* ⚠️ REAL LABELS, NOT PLACEHOLDERS. A placeholder is not a
                    label: it is announced inconsistently, it disappears the
                    moment a character is typed, and it fails contrast almost
                    everywhere — so somebody returning to a half-filled pair of
                    boxes has no way to tell which one wanted the number. */}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="block font-medium">Their full name</span>
                    <input
                      value={draft[slot]?.name ?? ''}
                      onChange={(e) =>
                        setDraft((x) => ({
                          ...x,
                          [slot]: { ...(x[slot] ?? { phone: '' }), name: e.target.value },
                        }))
                      }
                      autoComplete="name"
                      placeholder="As it appears on their ID"
                      className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] text-[var(--text-primary)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="block font-medium">Their cell number</span>
                    <input
                      value={draft[slot]?.phone ?? ''}
                      onChange={(e) =>
                        setDraft((x) => ({
                          ...x,
                          [slot]: { ...(x[slot] ?? { name: '' }), phone: e.target.value },
                        }))
                      }
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="072 123 4567"
                      className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] text-[var(--text-primary)] px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                {/* ⚠️ THE WARNING GOES HERE, NEXT TO THE BUTTON. */}
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  The link works for one hour. Phone them first and tell them it
                  is coming — otherwise it will expire before they see it.
                </p>
                <button
                  type="button"
                  disabled={busy === slot}
                  onClick={() => invite(slot)}
                  className="mt-2 rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {busy === slot ? 'Sending…' : 'Send the link'}
                </button>
              </div>
            );
          }

          return (
            <div
              key={slot}
              className="rounded border border-[var(--border)] p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  Witness {slot} — {w.invitedName}
                </p>
                <StatusPill status={w.status} />
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {w.invitedPhone}
                {w.status === 'COMPLETED' && w.signedAt
                  ? ` · signed ${new Date(w.signedAt).toLocaleDateString('en-ZA')}`
                  : w.status === 'DECLINED' && w.declinedAt
                    ? ` · declined ${new Date(w.declinedAt).toLocaleDateString('en-ZA')}`
                    : w.openedAt
                      ? ' · they have opened the link'
                      : ' · link sent, not opened yet'}
              </p>

              {/* ⚠️ A DECLINE IS NOT A FAULT, and the wording has to carry
                  that. Nobody is obliged to give a character statement about
                  anybody. The applicant needs to know so they can ask somebody
                  else — not to be told their witness let them down. */}
              {w.status === 'DECLINED' && (
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  They chose not to take this up. Nothing was recorded about
                  them. Remove them below to free the slot and ask somebody
                  else.
                </p>
              )}

              {w.status !== 'COMPLETED' && w.status !== 'DECLINED' && (
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  Links last one hour. If theirs has expired, send another.
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {w.status === 'COMPLETED' && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(open === w.id ? null : w.id);
                      void showSignature(w);
                    }}
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                  >
                    {open === w.id ? 'Hide statement' : 'View statement'}
                  </button>
                )}
                {w.status !== 'COMPLETED' && w.status !== 'DECLINED' && (
                  <button
                    type="button"
                    disabled={busy === slot}
                    onClick={() => invite(slot)}
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Send a new link
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy === slot}
                  onClick={() => {
                    const ok = window.confirm(
                      w.status === 'COMPLETED'
                        ? `Delete ${w.invitedName}'s signed statement? It will not be filed with your application, and it cannot be recovered — they would have to complete a new one.`
                        : w.status === 'DECLINED'
                          ? `Remove ${w.invitedName} and free this slot for somebody else?`
                          : `Remove ${w.invitedName}? Their link will stop working.`,
                    );
                    if (ok) void remove(w);
                  }}
                  className="rounded px-3 py-1.5 text-sm text-[var(--red)] underline disabled:opacity-50"
                >
                  {w.status === 'DECLINED' ? 'Remove' : 'Delete'}
                </button>
              </div>

              {open === w.id && w.answers && (
                <Statement
                  answers={w.answers}
                  place={w.signedPlace ?? null}
                  signedAt={w.signedAt}
                  signatureUrl={sigUrl[w.id]}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label =
    status === 'COMPLETED'
      ? 'Signed'
      : status === 'DECLINED'
        ? 'Declined'
        : status === 'VERIFIED'
          ? 'In progress'
          : 'Link sent';
  return (
    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
      {label}
    </span>
  );
}

const QUESTION_LABELS: Record<string, string> = {
  fit_and_proper: 'A fit and proper person',
  stable_and_not_violent: 'Stable, and not inclined to violence',
  not_dependent: 'Free of dependence on any intoxicating substance',
};

function Statement({
  answers,
  place,
  signedAt,
  signatureUrl,
}: {
  answers: Record<string, string>;
  place: string | null;
  signedAt: string | null;
  signatureUrl?: string;
}) {
  const row = (k: string, v?: string) =>
    v ? (
      <div className="flex gap-2 py-0.5">
        <span className="w-40 shrink-0 text-[var(--text-secondary)]">{k}</span>
        <span>{v}</span>
      </div>
    ) : null;

  return (
    <div className="mt-3 rounded bg-[var(--bg-inset)] p-3 text-sm">
      {row('Name', [answers.first_names, answers.surname].filter(Boolean).join(' '))}
      {row('Identity number', answers.id_number)}
      {row('Daytime number', answers.daytime_phone)}
      {row(
        'Relationship',
        answers.relationship === 'Other'
          ? answers.relationship_other
          : answers.relationship,
      )}
      {row('Known each other', answers.known_for)}

      <div className="mt-2 border-t border-[var(--border)] pt-2">
        {Object.entries(QUESTION_LABELS).map(([k, label]) => (
          <div key={k} className="flex gap-2 py-0.5">
            <span className="w-40 shrink-0 text-[var(--text-secondary)]">
              {label}
            </span>
            <span
              className={
                answers[k] === 'Yes' ? '' : 'font-medium text-[var(--red)]'
              }
            >
              {answers[k]}
            </span>
          </div>
        ))}
      </div>

      {answers.explain && (
        <p className="mt-2 whitespace-pre-wrap border-t border-[var(--border)] pt-2">
          <span className="text-[var(--text-secondary)]">Explanation: </span>
          {answers.explain}
        </p>
      )}
      {answers.comment && (
        <p className="mt-2 whitespace-pre-wrap">
          <span className="text-[var(--text-secondary)]">Their comment: </span>
          {answers.comment}
        </p>
      )}

      <div className="mt-3 border-t border-[var(--border)] pt-2">
        {signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signatureUrl}
            alt="Their signature"
            className="h-20 w-auto max-w-full rounded border border-[var(--border)] bg-white"
          />
        ) : (
          <p className="text-xs text-[var(--text-secondary)]">Signature stored.</p>
        )}
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {place ? `Signed at ${place}` : 'Signed'}
          {signedAt
            ? ` on ${new Date(signedAt).toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}`
            : ''}
        </p>
      </div>
    </div>
  );
}
