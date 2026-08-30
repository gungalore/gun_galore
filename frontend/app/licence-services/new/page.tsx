'use client';

// ────────────────────────────────────────────────────────────────────
// STEP ONE OF AN APPLICATION THAT DOES NOT EXIST YET.
//
// Operator, 2026-08-29: "Motivation centre landing page and Section 1 of an
// application is basically the same thing, why not incorporate them into one?"
// They were. The Centre asked which section you wanted, created the row, and
// then step one of the wizard restated the answer back at you — the same
// question and its own echo, on two screens, with a page load between them.
//
// This is the merge. The Centre keeps what only it can do (what is in flight,
// and one door), and the question moved here, where it is drawn as step one of
// eleven because that is what it is.
//
// ⚠️ A STATIC SEGMENT BESIDE A DYNAMIC ONE, AND THAT IS FINE. Next resolves
// /licence-services/new to this file ahead of [id], and no motivation id can
// collide with it — they are cuids. It is not a route collision, but
// `next build` is the only thing that would say so if it ever became one, so
// this route ships with a build, never with tsc alone.
//
// ⚠️ NOTHING TO ADD TO middleware.ts. isPublicRoute is an ALLOW-LIST with
// default deny, so a new route under an authenticated tree is authenticated by
// having no entry there — nothing to add, and nothing to forget to add.
// ────────────────────────────────────────────────────────────────────

import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MotivationApiError, motivationsApi } from '@/lib/motivations-api';
import { canOpenPackScreen } from '@/lib/licence-services-preview';
import WizardRail, { WIZARD_STEPS } from '@/components/licence-pack/wizard-rail';
import SectionChooser from '@/components/licence-pack/section-chooser';

export default function NewLicenceApplicationPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const token = useCallback(async () => getToken(), [getToken]);

  const [canStart, setCanStart] = useState(true);
  /**
   * Whether the module is switched on at all.
   *
   * ⚠️ NOT THE SAME THING AS A FULL BETA, AND SAYING SO WRONGLY IS WORSE THAN
   * SAYING NOTHING. status() reports canStart:false for BOTH — the cap being
   * reached and the whole module being off — so leaning on canStart alone
   * tells somebody the free beta is full when in fact nothing has opened yet.
   * The Centre never sends anybody here in that state, but a typed URL does.
   */
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Where a freshly created application opens.
   *
   * ⚠️ THIS SCREEN IS NOT GATED, AND DELIBERATELY SO — IT IS WHERE THE GATE
   * GETS DECIDED. The preview flag guards the half-built pack screen at
   * /licence-services/[id]; choosing a section was never part of that, and it
   * is now the Centre's ONLY door. Bouncing an ungated member back to the
   * Centre would leave the one button there dead.
   *
   * So the gate moves to the destination instead — the same `packHref` rule
   * the Centre used to carry, in the one place that still needs it. Read once
   * on mount rather than at click time because `readPreviewOptIn` writes the
   * `?preview=1` opt-in into sessionStorage as a side effect, and it should
   * happen when the member arrives, not when they commit.
   */
  const [packScreen, setPackScreen] = useState(false);
  useEffect(() => {
    setPackScreen(canOpenPackScreen(window.location.search));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // ⚠️ FALSE ON A FAILED READ IS THE API's OWN CHOICE, AND IT IS THE RIGHT
      // ONE HERE TOO: offering five cards that 409 puts the member back where
      // they started with no explanation. status() already defaults canStart
      // to false when it cannot tell.
      const s = await motivationsApi.status(token);
      if (!alive) return;
      setEnabled(s.enabled);
      setCanStart(s.canStart);
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const step = WIZARD_STEPS[0];

  const choose = async (value: string) => {
    setBusy(value);
    setError(null);
    try {
      const created = await motivationsApi.create(token, value);
      // ⚠️ replace, NOT push. Back from step one of a real application should
      // reach the Centre, not a chooser for an application they have already
      // started — where choosing again would silently start a second one.
      router.replace(
        packScreen
          ? `/licence-services/${created.id}`
          : `/motivations/${created.id}`,
      );
    } catch (e) {
      setError(
        e instanceof MotivationApiError
          ? e.message
          : 'We could not start that just now.',
      );
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── the chrome bar ─────────────────────────────────────── */}
      {/* Where the reference number sits on a real application. There is no
          number yet — saying so is better than an empty slot that looks like
          something failed to load. */}
      <div className="flex flex-wrap items-center gap-3.5 border-b border-[var(--border)] px-4 py-3 sm:px-6">
        <div className="text-[12.5px] text-[var(--text-tertiary)]">
          Licence services /{' '}
          <span className="font-medium text-[var(--text-secondary)]">
            New application
          </span>
        </div>
      </div>

      <WizardRail steps={WIZARD_STEPS} current={0} onGo={() => {}} interactive={false} />

      <div className="flex-1 px-4 pt-6 sm:px-6">
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
              Step 1 of {WIZARD_STEPS.length} · {step.fills}
            </div>
            <h1 className="mb-1.5 mt-1.5 text-[26px] font-bold tracking-[-.02em] text-[var(--text-primary)]">
              {step.title}
            </h1>
            <p className="max-w-[78ch] text-[14.5px] text-[var(--text-secondary)]">
              {step.blurb}
            </p>
          </div>

          {enabled === false ? (
            /* The Centre's own words for this state, so a member who reaches
               one screen or the other is told the same thing. */
            <p className="max-w-[820px] text-[13.5px] text-[var(--text-secondary)]">
              We are still putting this together. It will appear here when it
              opens.
            </p>
          ) : (
            <SectionChooser
              canStart={canStart}
              busy={busy}
              error={error}
              onChoose={choose}
            />
          )}

          <p className="pb-10 text-[12.5px]">
            <Link
              href="/motivations"
              className="text-[var(--text-secondary)] underline underline-offset-2"
            >
              Back to your applications
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
