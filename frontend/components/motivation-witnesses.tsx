'use client';

import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async () => {
    const res = await motivationsApi.witnesses(getToken, motivationId);
    setRows(res.witnesses);
  }, [getToken, motivationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Object URLs pin their blob until revoked.
  useEffect(
    () => () => {
      Object.values(sigUrl).forEach((u) => URL.revokeObjectURL(u));
    },
    [sigUrl],
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

  if (!rows) return null;
  const bySlot = new Map(rows.map((r) => [r.slot, r]));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">Character witnesses</h3>
        <p className="text-xs text-[var(--text-secondary)]">Two statements</p>
      </div>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Two people who know you complete a statement about your character. We
        SMS each of them a link; they fill it in and sign it on their own
        phone, and it prints into your pack.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger,#b3261e)]">
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
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input
                    value={draft[slot]?.name ?? ''}
                    onChange={(e) =>
                      setDraft((x) => ({
                        ...x,
                        [slot]: { ...(x[slot] ?? { phone: '' }), name: e.target.value },
                      }))
                    }
                    placeholder="Their full name"
                    className="rounded border border-[var(--border)] px-3 py-2 text-sm"
                  />
                  <input
                    value={draft[slot]?.phone ?? ''}
                    onChange={(e) =>
                      setDraft((x) => ({
                        ...x,
                        [slot]: { ...(x[slot] ?? { name: '' }), phone: e.target.value },
                      }))
                    }
                    inputMode="tel"
                    placeholder="Their cell number"
                    className="rounded border border-[var(--border)] px-3 py-2 text-sm"
                  />
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
                  className="mt-2 rounded bg-[var(--brand,#1b3a2f)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
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
                  : w.openedAt
                    ? ' · they have opened the link'
                    : ' · link sent, not opened yet'}
              </p>

              {w.status !== 'COMPLETED' && (
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
                {w.status !== 'COMPLETED' && (
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
                        : `Remove ${w.invitedName}? Their link will stop working.`,
                    );
                    if (ok) void remove(w);
                  }}
                  className="rounded px-3 py-1.5 text-sm text-[var(--danger,#b3261e)] underline disabled:opacity-50"
                >
                  Delete
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
    <div className="mt-3 rounded bg-[var(--bg-subtle,#f6f6f6)] p-3 text-sm">
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
                answers[k] === 'Yes' ? '' : 'font-medium text-[var(--danger,#b3261e)]'
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
