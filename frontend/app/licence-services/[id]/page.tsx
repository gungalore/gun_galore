'use client';

// ────────────────────────────────────────────────────────────────────
// THE PACK SCREEN. Phase 2 of the licence-application rebuild.
//
// The wizard at /motivations/[id] asks questions, then asks for documents,
// then generates a pack. This inverts that: it starts from what the member
// already holds and only asks for what is genuinely missing. The pack is the
// object, not the form.
//
// ⚠️ BEHIND A FLAG, AND THE FLAG IS OFF. NEXT_PUBLIC_LICENCE_SERVICES_ENABLED
// must be exactly 'true' or this route sends the member back to the wizard.
// Nothing about this screen is finished enough to be somebody's only way in.
//
// ⚠️ READ-ONLY, ON PURPOSE, UNTIL PHASE 2b. There is no editing here yet, and
// three whole areas of the application — the firearms the member already owns,
// the six declaration questions, and the safe details — have no home on this
// screen at all. That is why the classic-view link below is not a courtesy: it
// is the only way to answer those questions, and it stays above the fold in
// every state of this page including the error one. The build plan says it in
// as many words: do not ship Phase 2 without 2b. This is Phase 2 landing
// first, flagged off, so 2b has something to land on.
//
// ⚠️ ONE CALL. GET :id/pack returns the checklist, the 271 coverage, the
// provenance map and the prefill count together. The wizard assembles itself
// from eight separate endpoints, which is how two halves of one screen end up
// disagreeing about the same row while both are "correct".
// ────────────────────────────────────────────────────────────────────

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  motivationsApi,
  MotivationApiError,
  type MotivationField,
  type MotivationPack,
} from '@/lib/motivations-api';
import { readDraft } from '@/lib/motivation-draft';
import {
  PACK_SCREEN_SHIPPED,
  canOpenPackScreen,
  clearPreviewOptIn,
} from '@/lib/licence-services-preview';
import { useMotivationAutosave } from '@/hooks/use-motivation-autosave';
import PackSection from '@/components/licence-pack/pack-section';
import { licenceLabel } from '@/lib/licence-labels';
import PackGroup from '@/components/licence-pack/pack-group';
import PrefillBanner from '@/components/licence-pack/prefill-banner';
import Saps271Meter from '@/components/licence-pack/saps271-meter';

// ⚠️ RESOLVED IN AN EFFECT, NOT AT MODULE SCOPE. The build-time half of this
// is a constant, but the preview half reads sessionStorage, which does not
// exist while the page is rendered on the server — reading it up here is a
// hydration mismatch and a crash.

export default function LicenceServicesPackPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  // null = not decided yet. Nothing renders and nothing redirects until it is
  // resolved, so a member never sees a flash of the wrong screen.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pack, setPack] = useState<MotivationPack | null>(null);
  const [fields, setFields] = useState<MotivationField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missingRequired, setMissingRequired] = useState<string[]>([]);
  const [draftKeys, setDraftKeys] = useState(0);
  // One row open at a time. A pack with every note expanded is a wall of text
  // and loses the scannability the whole design is for.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = useCallback(async () => getToken(), [getToken]);

  // ⚠️ THE REDIRECT RUNS IN AN EFFECT, NOT DURING RENDER. Calling
  // router.replace() in the render body of a client component fires during
  // hydration and React warns about updating another component while
  // rendering. An effect that runs once is the boring, correct shape.
  useEffect(() => {
    const ok = canOpenPackScreen(window.location.search);
    setAllowed(ok);
    if (!ok) router.replace(`/motivations/${id}`);
  }, [id, router]);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    (async () => {
      try {
        // In parallel: two independent reads, and the pack is the slower.
        const [p, d] = await Promise.all([
          motivationsApi.pack(token, id),
          motivationsApi.get(token, id),
        ]);
        // Sequential, because the registry is keyed on the licence type and
        // only the detail knows it.
        const f = await motivationsApi.fields(token, d.licenceType);
        if (!alive) return;
        setPack(p);
        setFields(f.fields);
        setMissingRequired(d.missingRequired ?? []);

        // ⚠️ THE LOCAL DRAFT WINS OVER THE SERVER'S COPY, because it is
        // NEWER: it holds whatever was typed inside the last debounce window,
        // or after a save that failed. Same key and same rule as the wizard —
        // see lib/motivation-draft.ts — so a member can move between the two
        // screens mid-sentence without losing a word.
        const draft = readDraft(id);
        setDraftKeys(Object.keys(draft).length);
        setAnswers({ ...(d.answers ?? {}), ...draft });
      } catch (ex) {
        if (!alive) return;
        setError(
          ex instanceof MotivationApiError
            ? ex.message
            : 'We could not open this application.',
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [allowed, id, token]);

  const autosave = useMotivationAutosave({
    id,
    token,
    answers,
    ready: Boolean(pack),
    onSaved: (res) => setMissingRequired(res.missingRequired ?? []),
  });

  const setAnswer = useCallback(
    (key: string, value: string) => {
      autosave.markDirty();
      setAnswers((cur) => ({ ...cur, [key]: value }));
    },
    [autosave],
  );

  const missing = useMemo(() => new Set(missingRequired), [missingRequired]);

  // Nothing to paint until the gate is resolved, or while the effect above is
  // bouncing them to the wizard.
  if (!allowed) return null;

  return (
    <main className="mx-auto w-full max-w-[var(--page-max)] px-4 py-6">
      {/* ⚠️ SAY IT IS A PREVIEW, LOUDLY. Somebody who opted in three pages ago
          and forgot must not mistake an unfinished screen for the real one and
          conclude their application has lost three sections. */}
      {!PACK_SCREEN_SHIPPED && (
        <div
          className="mb-4 rounded-[var(--r-md)] border px-3 py-2"
          style={{
            borderColor: 'var(--gold-line)',
            background: 'var(--gold-wash)',
          }}
        >
          <p className="text-[13px] text-[var(--text-primary)]">
            <span className="font-semibold">Preview.</span> This is the new
            pack screen, still being built. You cannot upload or scan documents
            from here yet, and the SAPS 271 questions only appear once you have
            asked us to fill that form in — the classic view below does both.
            Everything you type here is saved to the same application.
          </p>
        </div>
      )}

      {/* ⚠️ ABOVE THE FOLD, IN EVERY STATE, INCLUDING THE ERROR ONE. */}
      <ClassicViewLink id={id} />

      <SaveState state={autosave.state} refused={autosave.refused} />

      {loading && (
        <p className="mt-6 text-sm text-[var(--text-secondary)]">
          Opening your pack…
        </p>
      )}

      {error && !loading && (
        <div className="mt-6 rounded-[var(--r-md)] border border-[var(--border)] p-4">
          <p className="text-sm text-[var(--text-primary)]">{error}</p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Your answers are safe. Open the classic view above to carry on.
          </p>
        </div>
      )}

      {pack && !loading && (
        <>
          <header className="mt-5">
            <p className="text-xs uppercase tracking-[.11em] text-[var(--text-tertiary)]">
              {pack.referenceNumber}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
              {licenceLabel(pack.licenceType)}
            </h1>
          </header>

          <div className="mt-4">
            <PrefillBanner
              prefill={pack.prefill}
              provenance={pack.provenance}
            />
          </div>

          {draftKeys > 0 && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              You have unsaved changes from the classic view. Open it above to
              keep working on them.
            </p>
          )}

          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
            <div className="space-y-8">
              <PackSummary
                pack={pack}
              openRow={openRow}
                onToggle={(key) =>
                  setOpenRow((cur) => (cur === key ? null : key))
                }
              />

              {/* ── PHASE 2b: THE THREE AREAS THE PACK HAD NO HOME FOR ────
                  Without these the screen looks finished and is not. Each is a
                  registry section the server already groups; the visibility
                  rule is `visibleFields`, which mirrors the server's own
                  isVisible(). */}
              <PackSection
                title="Firearms you already own"
                intro="Most of these come from your Document Centre. Check them against your licence cards — what SAPS holds is what the form must say."
                section="Firearms you already own"
                fields={fields}
                answers={answers}
                missing={missing}
                onChange={setAnswer}
              />

              <PackSection
                title="Storage and safety"
                intro="Where the firearm will be kept, and the safe it will be kept in."
                section="Storage and safety"
                fields={fields}
                answers={answers}
                missing={missing}
                onChange={setAnswer}
              />

              {/* ⚠️ LAST, AND NOT BY ACCIDENT. Meeting six questions about
                  convictions on the first screen makes an application feel
                  like a charge sheet. Nothing can help with them and nothing
                  ever prefills them — they are the applicant's own statements
                  under section 120(9)(f). */}
              <PackSection
                title="Declarations"
                intro="Only you can answer these. We never fill them in, and nothing you have uploaded changes them."
                section="History"
                fields={fields}
                answers={answers}
                missing={missing}
                onChange={setAnswer}
              />
            </div>

            <Saps271Meter coverage={pack.coverage} />
          </div>
        </>
      )}
    </main>
  );
}

/**
 * The way back to the screen that can actually answer everything.
 *
 * ⚠️ NOT A COURTESY LINK. Until Phase 2b lands, the firearms a member already
 * owns, the six declaration questions and the safe details have no home on
 * this screen. A member who cannot find their way back to the wizard cannot
 * finish their application at all.
 */
function ClassicViewLink({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={`/motivations/${id}`}
        className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] underline"
      >
        Continue in classic view
      </Link>

      {/* ⚠️ A WAY OUT OF THE PREVIEW, NOT JUST A WAY BACK TO THE OTHER SCREEN.
          Without this, opting in is a one-way door for the rest of the tab —
          every later visit lands here again and the member has no idea why. */}
      {!PACK_SCREEN_SHIPPED && (
        <button
          type="button"
          onClick={() => {
            clearPreviewOptIn();
            window.location.href = `/motivations/${id}`;
          }}
          className="text-xs text-[var(--text-tertiary)] underline"
        >
          Leave preview
        </button>
      )}
    </div>
  );
}

/** The left column: the pack itself, group by group. */
function PackSummary({
  pack,
  openRow,
  onToggle,
}: {
  pack: MotivationPack;
  openRow: string | null;
  onToggle: (key: string) => void;
}) {
  const { oursDone, oursTotal, theirsTotal } = pack.checklist;
  return (
    <section>
      {/* ⚠️ NO HEADING OF OUR OWN HERE. The server's first section is itself
          titled "Your pack", so an h2 above it rendered the words twice — seen
          on the live screen, not in a review. The counts stand alone. */}
      <div className="flex items-baseline justify-end gap-3">
        <p className="text-[13px] text-[var(--text-secondary)]">
          {oursDone} of {oursTotal} done
          {/* ⚠️ COUNTED SEPARATELY, NEVER FOLDED INTO THE TOTAL. Rows waiting
              on somebody else are not the member's to finish, and rolling them
              into one score makes them look behind on work they cannot do. */}
          {theirsTotal > 0 && ` · ${theirsTotal} with someone else`}
        </p>
      </div>

      <div className="mt-4 space-y-6">
        {pack.checklist.sections.map((section) => (
          <PackGroup
            key={section.key}
            section={section}
            expandedKey={openRow}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * What happened to the last save.
 *
 * ⚠️ A REFUSAL IS OUR FAULT AND SAYS SO. The server refuses a REGISTERED
 * field's value when the form and the validator disagree — never because the
 * member typed something wrong — and the wizard's own banner has said so in
 * those words since it was written. Telling somebody to fix an answer that is
 * not wrong sends them round a loop with no exit.
 */
function SaveState({ state, refused }: { state: string; refused: string[] }) {
  if (refused.length > 0) {
    return (
      <p className="mt-3 rounded-[var(--r-sm)] border border-[var(--warning)] px-3 py-2 text-[13px] text-[var(--text-primary)]">
        We could not store{' '}
        {refused.length === 1 ? 'one of your answers' : 'some of your answers'}.
        This is a fault on our side, not something you typed wrong — please tell
        support. What you typed is still on this device.
      </p>
    );
  }
  if (state === 'idle') return null;
  return (
    <p className="mt-3 text-[12px] text-[var(--text-tertiary)]">
      {state === 'saving'
        ? 'Saving…'
        : state === 'saved'
          ? 'Saved'
          : 'Not saved'}
    </p>
  );
}
