'use client';

import { useAuth } from '../../../lib/auth';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  motivationsApi,
  type MotivationQuotaStatus,
  type MotivationSummary,
} from '@/lib/motivations-api';
import { LICENCE_TYPES } from '@/lib/licence-labels';
import ApplicationRow from '@/components/licence-pack/application-row';
import { formatPrice } from '@/lib/utils';

// ────────────────────────────────────────────────────────────────────
// YOUR APPLICATIONS, AND THE FIVE THINGS YOU CAN APPLY FOR.
//
// ⚠️ IT IS AT /licence-centre/applications, NOT AT /licence-centre.
// MOTIVATION-REBUILD-BRIEF.md §0 ruling E: `/licence-centre` is the Document
// Centre's own second door — `/documents` re-exports that page, and
// notification-module.ts deep-links every `licence_centre_*` reminder to it.
// Taking the index would have sent every licence-expiry reminder to a list of
// applications.
//
// ⚠️ THE FIVE TYPES COME FROM lib/licence-labels.ts VERBATIM. Label, section
// and blurb are that file's to own — it exists because three hand-synced
// copies had already drifted over what to call a section 24.
//
// ⚠️ NO OUTCOME LANGUAGE, ANYWHERE. Every blurb says who a section is FOR,
// never who is likely to get it. "Endorsed by an accredited association" is a
// requirement; "your best chance" would be a prediction, and this product does
// not make those.
// ────────────────────────────────────────────────────────────────────

/**
 * The two piles a member actually thinks in.
 *
 * Operator, 2026-09-09: "splitting it into In progress and completed".
 *
 * ⚠️ COMPLETED IS THE ONLY STATUS THAT MEANS FINISHED, and everything else
 * belongs in the other pile — a FAILED run included, because FAILED became
 * regenerable on 2026-09-09 and the member's next move is to open it and try
 * again. Putting it under "Completed" would tell them the opposite. ABANDONED
 * is not finished either; it is put aside, which is a kind of in progress.
 */
function isFinished(r: MotivationSummary): boolean {
  return r.status === 'COMPLETED';
}

export default function ApplicationsPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<MotivationSummary[] | null>(null);
  const [quota, setQuota] = useState<MotivationQuotaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  /**
   * ⚠️ NAMED SO A DELETION CAN RE-RUN IT. Routing back to this page after an
   * erase would re-render the same client state; the row has to go because the
   * list was fetched again, not because we hid it.
   */
  const load = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([
        motivationsApi.list(getToken),
        // The price line is a nice-to-have: a quota read that fails must not
        // take the applications list down with it.
        motivationsApi.status(getToken).catch(() => null),
      ]);
      setRows(list);
      setQuota(status);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = useCallback(
    async (licenceType: string) => {
      setStarting(licenceType);
      try {
        const created = await motivationsApi.create(getToken, licenceType);
        router.push(`/licence-centre/${created.id}/start`);
      } catch (err) {
        setError((err as Error).message);
        setStarting(null);
      }
    },
    [getToken, router],
  );

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5">
      <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
        Licence applications
      </h1>
      <a
        href="/licence-centre/profile"
        className="mt-2 inline-block text-[12.5px] font-medium"
        style={{ color: 'var(--red)' }}
      >
        Review your remembered licence profile →
      </a>

      {/*
        ⚠️ THE PRICE IS STATED BEFORE ANY WORK, NOT AT THE PAY BUTTON. The
        member is about to spend an evening on an application; finding out it
        costs R295 only when they press Write is the worst possible moment.
      */}
      {quota?.paidMode && quota.priceCents ? (
        <p
          className="mt-2 text-[12.5px] leading-5"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {formatPrice(quota.priceCents)} per motivation — you pay when you are
          ready to write it. Building the application is free.
        </p>
      ) : null}
      {quota?.paidMode && !quota.paymentsLive ? (
        <p role="status" className="mt-2 text-[12.5px] text-[var(--gold-strong)]">
          Payments are not open yet. You can still start an application, and the
          price will not change.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-[13.5px] text-[var(--red)]">{error}</p>
      ) : null}

      {rows === null ? (
        <p className="mt-4 text-[13.5px] text-[var(--text-tertiary)]">
          Loading…
        </p>
      ) : rows.length ? (
        <>
          {(
            [
              ['In progress', rows.filter((r) => !isFinished(r))],
              ['Completed', rows.filter(isFinished)],
            ] as [string, MotivationSummary[]][]
          )
            .filter(([, list]) => list.length > 0)
            .map(([label, list]) => (
              <section key={label} className="mt-5">
                <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
                  {label}
                </p>
                <ul className="m-0 list-none p-0">
                  {list.map((r) => (
                    <ApplicationRow
                      key={r.id}
                      row={r}
                      token={getToken}
                      onChanged={() => void load()}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </>
      ) : null}

      <section className="mt-6">
        <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
          {rows?.length ? 'Start another' : 'What are you applying for?'}
        </p>
        <ul className="m-0 list-none p-0">
          {LICENCE_TYPES.map((t) => (
            <li key={t.value}>
              <button
                type="button"
                disabled={starting !== null}
                onClick={() => void start(t.value)}
                className="gg-tile mb-2 block w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[14px] py-3 text-left disabled:opacity-50"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
                    {t.label}
                  </span>
                  <span className="text-[12px] text-[var(--text-tertiary)]">
                    {t.section}
                  </span>
                </span>
                <span className="mt-[3px] block text-[13px] leading-[1.4] text-[var(--text-secondary)]">
                  {t.blurb}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
