'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  motivationsApi,
  type MotivationSummary,
} from '@/lib/motivations-api';
import { LICENCE_TYPES, licenceLabel } from '@/lib/licence-labels';

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

const STATUS_WORDS: Record<string, string> = {
  DRAFT: 'In progress',
  GENERATING: 'Being written',
  NEEDS_MORE_INFO: 'Needs more from you',
  COMPLETED: 'Ready',
  FAILED: 'Could not be written',
  ABANDONED: 'Put aside',
};

export default function ApplicationsPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<MotivationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = await motivationsApi.list(getToken);
        if (live) setRows(list);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [getToken]);

  const start = useCallback(
    async (licenceType: string) => {
      setStarting(licenceType);
      try {
        const created = await motivationsApi.create(getToken, licenceType);
        router.push(`/licence-centre/${created.id}`);
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

      {error ? (
        <p className="mt-3 text-[13.5px] text-[var(--red)]">{error}</p>
      ) : null}

      {rows === null ? (
        <p className="mt-4 text-[13.5px] text-[var(--text-tertiary)]">
          Loading…
        </p>
      ) : rows.length ? (
        <section className="mt-5">
          <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
            Yours
          </p>
          <ul className="m-0 list-none p-0">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/licence-centre/${r.id}`}
                  className="gg-tile mb-2 flex items-center justify-between gap-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[14px] py-3 no-underline"
                >
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
                      {licenceLabel(r.licenceType)}
                    </span>
                    <span className="mt-[2px] block font-mono text-[12px] text-[var(--text-tertiary)]">
                      {r.referenceNumber}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-[12px] text-[var(--text-tertiary)]">
                    {STATUS_WORDS[r.status] ?? r.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
