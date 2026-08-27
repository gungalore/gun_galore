'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  MotivationApiError,
  MotivationSummary,
  motivationsApi,
} from '@/lib/motivations-api';
import { licenceCentreApi } from '@/lib/licence-centre-api';
import VaultConsentModal, { snoozed } from '@/components/vault-consent';

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
  const { getToken, userId } = useAuth();
  const router = useRouter();
  const token = useCallback(() => getToken(), [getToken]);

  const [rows, setRows] = useState<MotivationSummary[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  /**
   * ⚠️ THE PAGE ALREADY FETCHED THIS AND THREW IT AWAY. status() returns
   * canStart, cap, used and freeRemaining; only `enabled` was kept. So the
   * page knew perfectly well that no new motivation could be started and
   * still rendered five enabled buttons that could not work.
   */
  const [canStart, setCanStart] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ── MAY WE KEEP YOUR DOCUMENTS? ─────────────────────────────────────
  //
  // Operator, 2026-08-22: "we also need to launch a window asking the user for
  // us to keep the documents and explain why. Maybe when they first launch the
  // Motivation Centre." This is that first launch.
  //
  // ⚠️ HERE AND NOT IN THE WIZARD. The wizard skips a poll tick while any
  // blocking overlay is up, so a window over it would stop it noticing its own
  // generation finishing — somebody would sit watching "Writing it…" behind a
  // consent notice.
  const [askConsent, setAskConsent] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await motivationsApi.status(token);
        if (!alive) return;
        setEnabled(s.enabled);
        setCanStart(s.canStart);
        // With the flag off every other call 404s, so do not make them.
        if (s.enabled) setRows(await motivationsApi.list(token));

        // ⚠️ A SECOND CALL, DELIBERATELY. The status route above takes no
        // @CurrentUser — it reads settings only — so the consent state cannot
        // ride on it however convenient that would be.
        //
        // Fails to silence: the client falls back to "already answered", so a
        // slow or failed call costs the prompt rather than showing it to
        // somebody who has already said yes.
        if (s.enabled) {
          const c = await licenceCentreApi.consent(token);
          if (!alive) return;
          setRetentionDays(c.retentionDays ?? null);
          if (c.ask && !snoozed(userId ?? '')) setAskConsent(true);
        }
      } catch {
        if (alive) setEnabled(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, userId]);

  if (enabled === false) {
    return (
      <main className="mx-auto max-w-[var(--content-max)] px-4 py-10">
        <h1 className="text-2xl font-semibold">Motivation Centre</h1>
        <p className="mt-3 text-[var(--text-secondary)]">
          We are still putting this together. It will appear here when it opens.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-8">
      {askConsent && userId && (
        <VaultConsentModal
          token={token}
          userId={userId}
          retentionDays={retentionDays}
          onDone={() => setAskConsent(false)}
        />
      )}
      <h1 className="text-2xl font-semibold">Motivation Centre</h1>
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

        {/* ⚠️ SAY IT BEFORE THEY CLICK, NOT AFTER. The server refuses with a
            perfectly clear 409 — "The free beta is full for now" — and the
            page rendered that message BELOW five cards, 83px under the fold
            on a 855px viewport. Clicking the top card therefore looked like
            nothing happening at all, and the explanation was somewhere the
            member never scrolled to.
            Stated up front, and the buttons that cannot work are disabled. */}
        {!canStart && (
          <p
            role="status"
            className="mt-2 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3 text-sm"
          >
            The free beta is full, and paid motivations are not open yet. You
            can still finish and download any application already listed above.
          </p>
        )}

        {/* The error lives ABOVE the list. Wherever they clicked, it is the
            next thing they see rather than the last. */}
        {error && (
          <p role="alert" className="mt-2 text-sm text-[var(--red)]">
            {error}
          </p>
        )}

        <ul className="mt-2 space-y-2">
          {LICENCE_TYPES.map((t) => (
            <li key={t.value}>
              <button
                type="button"
                disabled={starting || !canStart}
                className="w-full rounded border border-[var(--border)] bg-[var(--bg-card)] p-3 text-left hover:bg-[var(--bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
      </section>

      <p className="mt-8 text-xs text-[var(--text-tertiary-on-card)]">
        We prepare the document; the decision is the Registrar&apos;s. Nothing
        here is legal advice, and you sign and submit the motivation as your own.
      </p>
    </main>
  );
}
