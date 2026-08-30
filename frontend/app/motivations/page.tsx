'use client';

import { useAuth } from '@clerk/nextjs';
import { PACK_SCREEN_SHIPPED } from '@/lib/licence-services-preview';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MotivationSummary, motivationsApi } from '@/lib/motivations-api';
import { licenceCentreApi } from '@/lib/licence-centre-api';
import { licenceLabel, LICENCE_SECTION } from '@/lib/licence-labels';
import VaultConsentModal, { snoozed } from '@/components/vault-consent';
import DeleteApplication from '@/components/licence-pack/delete-application';
import { Breadcrumbs, type Crumb } from '@/components/breadcrumbs';

// The way in. Lists what someone has started and lets them begin another.
//
// BEHIND THE LOGIN, like everything in this module. middleware.ts's
// isPublicRoute is an ALLOW-LIST with default deny, so this route is
// authenticated by having no entry there — nothing to add, and nothing to
// forget to add.
//
// ⚠️ NO OUTCOME LANGUAGE anywhere on this page. We sell structure and
// completeness, never odds.
//
// ⚠️ THE FIVE SECTION CARDS USED TO LIVE HERE AND THEY DO NOT ANY MORE.
// Operator, 2026-08-29: "Motivation centre landing page and Section 1 of an
// application is basically the same thing, why not incorporate them into one?"
// — and they were: this page asked which section, created the row, and step
// one of the wizard then restated the answer back at the member. One question
// and its own echo, on two screens.
//
// "On motivation centre just have start a new application and the current
// pending applications." So: what is in flight, and one door. The choosing
// happens at /licence-services/new, drawn as step one of eleven, because that
// is what it is.

const MOTIVATIONS_TRAIL: Crumb[] = [
  { label: 'Home', href: '/' },
  { label: 'Account', href: '/account' },
  { label: 'Motivation Centre' },
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

  /**
   * Where opening an EXISTING application goes.
   *
   * ⚠️ THE BUILD FLAG ALONE WAS NOT ENOUGH, AND THAT IS WHY THE REBUILT
   * DESIGN SHIPPED INVISIBLE. NEXT_PUBLIC_LICENCE_SERVICES_ENABLED only
   * decides whether /licence-services/[id] will OPEN; this Centre still
   * pushed everybody to /motivations/[id] regardless, so turning the flag on
   * would have changed nothing anybody could see. One switch now drives both.
   *
   * The NEW-application half of this rule moved to /licence-services/new,
   * which decides where a freshly created row opens. It is the same rule; it
   * just belongs beside the create() call rather than here.
   */
  const packHref = (mid: string) =>
    PACK_SCREEN_SHIPPED ? `/licence-services/${mid}` : `/motivations/${mid}`;
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
        <Breadcrumbs trail={MOTIVATIONS_TRAIL} className="mb-6" />
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
      <Breadcrumbs trail={MOTIVATIONS_TRAIL} className="mb-6" />
      <h1 className="text-2xl font-semibold">Motivation Centre</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        We ask you about your circumstances, then prepare a formal motivation
        you sign and hand in with your application — along with a checklist of
        everything to take to the police station.
      </p>

      {/* ⚠️ THE DOOR COMES FIRST NOW, ABOVE THE LIST. With five cards it
          belonged under "your applications" — a menu you scrolled past what
          you already had to reach. As one button it is the page's only action,
          and a member arriving to start something should not have to read a
          list of what they started before to find it. */}
      <section className="mt-8">
        {canStart ? (
          <button
            type="button"
            onClick={() => router.push('/licence-services/new')}
            className="rounded-[var(--r-sm)] border-0 bg-[var(--red)] px-5 py-[11px] text-[14px] font-semibold text-white"
          >
            Start a new application
          </button>
        ) : (
          /* ⚠️ SAY IT INSTEAD OF THE BUTTON, NOT UNDER IT. The server refuses
             with a perfectly clear 409 and this page used to render that
             message below five enabled cards, well under the fold — so
             clicking looked like nothing happening at all. A door that cannot
             open is not a door; it is a sentence. */
          <p
            role="status"
            className="rounded-[var(--r-sm)] border p-3 text-[13.5px]"
            style={{
              borderColor: 'var(--gold-line)',
              background: 'var(--gold-wash)',
            }}
          >
            The free beta is full, and paid applications are not open yet. You
            can still finish and download any application listed below.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-tertiary-on-card)]">
          Your applications
        </h2>

        {rows && rows.length > 0 ? (
          <ul className="mt-2 divide-y divide-[var(--border-divider)] rounded border border-[var(--border)]">
            {/* ⚠️ THE ROW IS NO LONGER ONE BUTTON. It used to be a single
                <button> wrapping the whole row, and a button cannot contain a
                button — so making delete reachable from here meant splitting
                the open action off rather than nesting a control inside it and
                shipping invalid markup that swallows its own clicks. */}
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 p-3 hover:bg-[var(--bg-card-hover)]"
              >
                <button
                  type="button"
                  className="flex flex-1 items-center justify-between gap-4 text-left text-sm"
                  onClick={() => router.push(packHref(r.id))}
                >
                  <span>
                    <span className="font-medium">{r.referenceNumber}</span>
                    <span className="block text-xs text-[var(--text-tertiary-on-card)]">
                      {/* ⚠️ THE SHARED MAP, NOT A LOCAL COPY. This page carried
                          its own list of the five types and lib/licence-labels
                          carried two more, hand-synced by a comment. They had
                          already drifted once. */}
                      {LICENCE_SECTION[r.licenceType]
                        ? `${LICENCE_SECTION[r.licenceType]} — `
                        : ''}
                      {licenceLabel(r.licenceType)}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {STATUS_COPY[r.status] ?? r.status}
                  </span>
                </button>
                {/* ⚠️ DROPS THE ROW RATHER THAN NAVIGATING. The component's
                    default is to push to the Centre, which is where we
                    already are — a push here would look like nothing
                    happened while the row it deleted sat on screen until the
                    next load. */}
                <DeleteApplication
                  token={token}
                  motivationId={r.id}
                  reference={r.referenceNumber}
                  onDeleted={() =>
                    setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id))
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          /* ⚠️ AN EMPTY LIST IS NOT NOTHING. `rows === null` is still loading
             and says so by staying quiet; an empty array is a member who has
             never started one, and hiding the heading from them made the page
             look broken rather than new. */
          rows !== null && (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Nothing started yet. Whatever you begin appears here, and you can
              leave it and come back to it as often as you like.
            </p>
          )
        )}
      </section>

      <p className="mt-8 text-xs text-[var(--text-tertiary-on-card)]">
        We prepare the document; the decision is the Registrar&apos;s. Nothing
        here is legal advice, and you sign and submit the motivation as your own.
      </p>
    </main>
  );
}
