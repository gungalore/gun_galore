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
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  motivationsApi,
  MotivationApiError,
  type MotivationPack,
} from '@/lib/motivations-api';
import { readDraft } from '@/lib/motivation-draft';
import { licenceLabel } from '@/lib/licence-labels';
import PackGroup from '@/components/licence-pack/pack-group';
import PrefillBanner from '@/components/licence-pack/prefill-banner';
import Saps271Meter from '@/components/licence-pack/saps271-meter';

const FLAG_ON = process.env.NEXT_PUBLIC_LICENCE_SERVICES_ENABLED === 'true';

export default function LicenceServicesPackPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [pack, setPack] = useState<MotivationPack | null>(null);
  const [draftKeys, setDraftKeys] = useState(0);
  // One row open at a time. A pack with every note expanded is a wall of text
  // and loses the scannability the whole design is for.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = useCallback(async () => getToken(), [getToken]);

  // ⚠️ THE FLAG REDIRECT RUNS IN AN EFFECT, NOT DURING RENDER. Calling
  // router.replace() in the render body of a client component fires during
  // hydration and React warns about updating another component while
  // rendering. An effect that runs once is the boring, correct shape.
  useEffect(() => {
    if (!FLAG_ON) router.replace(`/motivations/${id}`);
  }, [id, router]);

  useEffect(() => {
    if (!FLAG_ON) return;
    let alive = true;
    (async () => {
      try {
        // ⚠️ ONE REQUEST, NOT TWO. The wizard also calls `get()` for the
        // answers, and this screen will need them the moment it can edit —
        // but it cannot yet, and a request whose response nothing reads is a
        // request that only costs the member a slower page.
        const p = await motivationsApi.pack(token, id);
        if (!alive) return;
        setPack(p);
        // The unsent draft is the wizard's, and it is the same draft — see
        // lib/motivation-draft.ts. Counted rather than merged for now,
        // because this screen cannot edit yet and silently showing an answer
        // the server has never seen would be worse than saying so.
        setDraftKeys(Object.keys(readDraft(id)).length);
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
  }, [id, token]);

  // Nothing to paint while the effect above is bouncing them to the wizard.
  if (!FLAG_ON) return null;

  return (
    <main className="mx-auto w-full max-w-[var(--page-max)] px-4 py-6">
      {/* ⚠️ ABOVE THE FOLD, IN EVERY STATE, INCLUDING THE ERROR ONE. */}
      <ClassicViewLink id={id} />

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
            <PackSummary
              pack={pack}
              openRow={openRow}
              onToggle={(key) =>
                setOpenRow((cur) => (cur === key ? null : key))
              }
            />
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
    <Link
      href={`/motivations/${id}`}
      className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] underline"
    >
      Continue in classic view
    </Link>
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
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
          Your pack
        </h2>
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
