'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  MotivationApiError,
  MotivationSummary,
  motivationsApi,
} from '@/lib/motivations-api';

// The way in. Lists what someone has started and lets them begin another.
//
// BEHIND THE LOGIN, like everything in this module. middleware.ts's
// isPublicRoute is an ALLOW-LIST with default deny, so this route is
// authenticated by having no entry there — nothing to add, and nothing to
// forget to add.
//
// ⚠️ NO OUTCOME LANGUAGE anywhere on this page. We sell structure and
// completeness, never odds.

const LICENCE_TYPES = [
  {
    value: 'S13_SELF_DEFENCE',
    label: 'Self-defence',
    section: 'Section 13',
    blurb: 'One firearm — a handgun or a shotgun that is not fully automatic.',
  },
  {
    value: 'S15_OCCASIONAL_HUNTER',
    label: 'Occasional hunting or sport-shooting',
    section: 'Section 15',
    blurb: 'For someone who hunts or shoots, without dedicated status.',
  },
  {
    value: 'S16_DEDICATED_HUNTER',
    label: 'Dedicated hunter',
    section: 'Section 16',
    blurb: 'Endorsed by an accredited hunting association.',
  },
  {
    value: 'S16_DEDICATED_SPORT',
    label: 'Dedicated sports shooter',
    section: 'Section 16',
    blurb: 'Endorsed by an accredited sport-shooting association.',
  },
  {
    value: 'S24_RENEWAL',
    label: 'Renewing an existing licence',
    section: 'Section 24',
    blurb: 'The purpose has not changed — you are renewing what you hold.',
  },
];

const STATUS_COPY: Record<string, string> = {
  DRAFT: 'In progress',
  NEEDS_MORE_INFO: 'A few questions to answer',
  GENERATING: 'Being prepared',
  COMPLETED: 'Ready',
  FAILED: 'Needs another look',
  ABANDONED: 'Set aside',
};

export default function MotivationsPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const token = useCallback(() => getToken(), [getToken]);

  const [rows, setRows] = useState<MotivationSummary[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await motivationsApi.status(token);
        if (!alive) return;
        setEnabled(s.enabled);
        // With the flag off every other call 404s, so do not make them.
        if (s.enabled) setRows(await motivationsApi.list(token));
      } catch {
        if (alive) setEnabled(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (enabled === false) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Licence motivations</h1>
        <p className="mt-3 text-[var(--text-secondary)]">
          We are still putting this together. It will appear here when it opens.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Firearm licence motivation</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        We ask you about your circumstances, then prepare a formal motivation
        you sign and hand in with your application — along with a checklist of
        everything to take to the police station.
      </p>

      {rows && rows.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-tertiary-on-card)]">
            Your applications
          </h2>
          <ul className="mt-2 divide-y divide-[var(--border-divider)] rounded border border-[var(--border)]">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 p-3 text-left text-sm hover:bg-[var(--bg-card-hover)]"
                  onClick={() => router.push(`/motivations/${r.id}`)}
                >
                  <span>
                    <span className="font-medium">{r.referenceNumber}</span>
                    <span className="block text-xs text-[var(--text-tertiary-on-card)]">
                      {LICENCE_TYPES.find((t) => t.value === r.licenceType)
                        ?.label ?? r.licenceType}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {STATUS_COPY[r.status] ?? r.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-tertiary-on-card)]">
          Start a new one
        </h2>
        <ul className="mt-2 space-y-2">
          {LICENCE_TYPES.map((t) => (
            <li key={t.value}>
              <button
                type="button"
                disabled={starting}
                className="w-full rounded border border-[var(--border)] bg-[var(--bg-card)] p-3 text-left hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
                onClick={async () => {
                  setStarting(true);
                  setError(null);
                  try {
                    const created = await motivationsApi.create(token, t.value);
                    router.push(`/motivations/${created.id}`);
                  } catch (e) {
                    setError(
                      e instanceof MotivationApiError
                        ? e.message
                        : 'We could not start that just now.',
                    );
                    setStarting(false);
                  }
                }}
              >
                <span className="text-xs uppercase tracking-wide text-[var(--text-tertiary-on-card)]">
                  {t.section}
                </span>
                <span className="block font-medium">{t.label}</span>
                <span className="block text-sm text-[var(--text-secondary)]">{t.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}
      </section>

      <p className="mt-8 text-xs text-[var(--text-tertiary-on-card)]">
        We prepare the document; the decision is the Registrar&apos;s. Nothing
        here is legal advice, and you sign and submit the motivation as your own.
      </p>
    </main>
  );
}
