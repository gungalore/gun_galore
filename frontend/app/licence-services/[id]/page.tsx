'use client';

// ────────────────────────────────────────────────────────────────────
// THE LICENCE APPLICATION WIZARD. Built to the design mockup.
//
// ⚠️ THIS REPLACED A FLAT PACK SCREEN ON 2026-08-29, AND THE REASON IS WORTH
// KEEPING. The build plan contradicts itself: §3.0c says "the design is now a
// ten-step wizard rather than a single pack screen", and §8's Phase 2 still
// describes the pack screen it superseded. The first version of this route
// followed §8, which was the stale half — nobody compared it against the
// artboard until the operator asked how the two matched, and the answer was
// that they were different information architectures.
//
// The mechanics here are the mockup's, read off Main.dc.html rather than
// approximated: one panel visible at a time, a clickable rail of numbered
// dots, a fixed 340px SAPS 271 column on every step, and a Back / hint /
// Continue footer. Operator, 2026-08-29: "I want to match the mechanics of how
// it works and visually appears with styling and flow. Not word for word the
// same."
//
// ⚠️ TEN STEPS, NOT THE ARTBOARD'S NINE — the licence section leads. Operator:
// "I added the Section list as it is already there and obvious to have."
//
// ⚠️ BEHIND A FLAG, AND THE FLAG IS OFF. See lib/licence-services-preview.ts.
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
import { licenceLabel, LICENCE_SECTION } from '@/lib/licence-labels';
import {
  PACK_SCREEN_SHIPPED,
  canOpenPackScreen,
  clearPreviewOptIn,
} from '@/lib/licence-services-preview';
import { useMotivationAutosave } from '@/hooks/use-motivation-autosave';
import WizardRail, { WIZARD_STEPS } from '@/components/licence-pack/wizard-rail';
import { visibleFields } from '@/lib/motivations-api';
import FieldInput from '@/components/motivation-field-input';
import PackGroup from '@/components/licence-pack/pack-group';
import PrefillBanner from '@/components/licence-pack/prefill-banner';
import Saps271Meter from '@/components/licence-pack/saps271-meter';
import CaptureCards from '@/components/licence-pack/capture-cards';
import ReadResult from '@/components/licence-pack/read-result';
import FieldGrid from '@/components/licence-pack/field-grid';
import YesNoPills from '@/components/licence-pack/yes-no-pills';
import PackSection from '@/components/licence-pack/pack-section';

export default function LicenceServicesWizardPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pack, setPack] = useState<MotivationPack | null>(null);
  const [fields, setFields] = useState<MotivationField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missingRequired, setMissingRequired] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const token = useCallback(async () => getToken(), [getToken]);

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
        const [p, d] = await Promise.all([
          motivationsApi.pack(token, id),
          motivationsApi.get(token, id),
        ]);
        const f = await motivationsApi.fields(token, d.licenceType);
        if (!alive) return;
        setPack(p);
        setFields(f.fields);
        setMissingRequired(d.missingRequired ?? []);
        // The local draft wins: it is newer than the server's copy by exactly
        // the debounce window. Same key as the wizard at /motivations/[id].
        setAnswers({ ...(d.answers ?? {}), ...readDraft(id) });
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
    onResponse: (res) => setMissingRequired(res.missingRequired ?? []),
  });

  const setAnswer = useCallback(
    (key: string, value: string) => {
      autosave.markDirty();
      setAnswers((cur) => ({ ...cur, [key]: value }));
    },
    [autosave],
  );

  /**
   * ONE UPLOAD, ONE CODE PATH — the same discipline the wizard's own
   * addOneUpload keeps, and for the same reason: every door on this screen
   * funnels through here so they cannot drift on what happens after a file
   * lands.
   *
   * ⚠️ SEQUENTIAL, NOT Promise.all. Each upload counts the rows already on the
   * application against the cap and writes a new one; firing them together
   * would let three reads see the same count.
   *
   * ⚠️ AND THE PACK IS RE-READ AFTERWARDS. A document can satisfy a checklist
   * row and fill several answers, so the coverage rail and the pack list are
   * both stale the moment one lands. Re-reading is what makes the 271 meter
   * move while somebody watches.
   */
  const addFiles = useCallback(
    async (kind: string, files: File[]) => {
      setBusyKind(kind);
      setUploadErr(null);
      try {
        for (const file of files) {
          await motivationsApi.addUpload(token, id, kind, file);
        }
        const [p, d] = await Promise.all([
          motivationsApi.pack(token, id),
          motivationsApi.get(token, id),
        ]);
        setPack(p);
        setMissingRequired(d.missingRequired ?? []);
        // ⚠️ ONLY WHAT IS STILL EMPTY. A document that reads a serial must not
        // overwrite one the member typed and corrected — MEMBER always wins,
        // the same rule the provenance spine enforces server-side.
        setAnswers((cur) => {
          const next = { ...cur };
          for (const [k, v] of Object.entries(d.answers ?? {})) {
            if (!(next[k] ?? '').trim() && v) next[k] = v;
          }
          return next;
        });
      } catch (ex) {
        setUploadErr(
          ex instanceof MotivationApiError
            ? ex.message
            : 'That upload did not work.',
        );
      } finally {
        setBusyKind(null);
      }
    },
    [id, token],
  );

  const missing = useMemo(() => new Set(missingRequired), [missingRequired]);
  const steps = WIZARD_STEPS;
  const current = steps[Math.min(step, steps.length - 1)];
  const last = step === steps.length - 1;

  if (!allowed) return null;

  if (loading) {
    return (
      <main className="px-4 py-8 sm:px-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Opening your application…
        </p>
      </main>
    );
  }

  if (error || !pack) {
    return (
      <main className="px-4 py-8 sm:px-6">
        <div className="rounded-[var(--r-md)] border border-[var(--border)] p-4">
          <p className="text-sm text-[var(--text-primary)]">
            {error ?? 'We could not open this application.'}
          </p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Your answers are safe.{' '}
            <Link href={`/motivations/${id}`} className="underline">
              Open the classic view
            </Link>{' '}
            to carry on.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── the chrome bar ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3.5 border-b border-[var(--border)] px-4 py-3 sm:px-6">
        <div className="text-[12.5px] text-[var(--text-tertiary)]">
          Licence services /{' '}
          <span className="font-medium text-[var(--text-secondary)]">
            {pack.referenceNumber} — {LICENCE_SECTION[pack.licenceType] ?? ''},{' '}
            {licenceLabel(pack.licenceType).toLowerCase()}
          </span>
        </div>
        <div className="ml-auto text-[12px] text-[var(--text-tertiary)]">
          <SaveState state={autosave.state} refused={autosave.refused} />
        </div>
      </div>

      <WizardRail steps={steps} current={step} onGo={setStep} />

      {!PACK_SCREEN_SHIPPED && (
        <div
          className="border-b px-4 py-2 sm:px-6"
          style={{
            borderColor: 'var(--gold-line)',
            background: 'var(--gold-wash)',
          }}
        >
          <p className="text-[12.5px] text-[var(--text-primary)]">
            <span className="font-semibold">Preview.</span> Still being built —
            you cannot upload or scan documents from here yet.{' '}
            <Link href={`/motivations/${id}`} className="underline">
              Classic view
            </Link>{' '}
            ·{' '}
            <button
              type="button"
              onClick={() => {
                clearPreviewOptIn();
                window.location.href = `/motivations/${id}`;
              }}
              className="underline"
            >
              Leave preview
            </button>
          </p>
        </div>
      )}

      {/* ── body: the step, and the 271 beside it on every step ── */}
      <div className="grid flex-1 grid-cols-1 gap-[26px] px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
              Step {step + 1} of {steps.length} · {current.fills}
            </div>
            <h1 className="mb-1.5 mt-1.5 text-[26px] font-bold tracking-[-.02em] text-[var(--text-primary)]">
              {current.title}
            </h1>
            <p className="max-w-[78ch] text-[14.5px] text-[var(--text-secondary)]">
              {current.blurb}
            </p>
          </div>

          {step === 0 && (
            <PrefillBanner
              prefill={pack.prefill}
              provenance={pack.provenance}
            />
          )}

          {uploadErr && (
            <p className="text-[13px] text-[var(--red)]">{uploadErr}</p>
          )}

          <StepBody
            stepKey={current.key}
            sections={current.sections}
            documents={current.documents}
            motivationId={id}
            busyKind={busyKind}
            onFiles={addFiles}
            pack={pack}
            fields={fields}
            answers={answers}
            missing={missing}
            onChange={setAnswer}
            openRow={openRow}
            onToggleRow={(k) => setOpenRow((cur) => (cur === k ? null : k))}
          />
        </div>

        <Saps271Meter coverage={pack.coverage} />
      </div>

      {/* ── footer ──────────────────────────────────────────────── */}
      {/* ⚠️ STICKY, NOT STATIC. The mockup pins this bar because its frame is a
          fixed 1080px with overflow:hidden; a real page scrolls, and a Continue
          button that scrolls away is a wizard somebody gets stuck in. */}
      <div className="sticky bottom-0 z-10 mt-6 flex items-center gap-3.5 border-t border-[var(--border)] bg-[var(--bg-card)] px-4 py-[15px] sm:px-6">
        <button
          type="button"
          onClick={() => setStep((n) => Math.max(0, n - 1))}
          disabled={step === 0}
          className="rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-5 py-[11px] text-[13.5px] font-medium text-[var(--text-secondary)] disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex-1 text-[12.5px] text-[var(--text-tertiary)]">
          {/* ⚠️ THE HINT IS DERIVED, NEVER A HARDCODED SENTENCE PER STEP. The
              mockup's HINTS array is nine written lines because it is a
              picture; on a real application the only honest hint is what this
              member still has outstanding. */}
          {hintFor(current.sections, fields, missing)}
        </div>
        <button
          type="button"
          onClick={() =>
            last
              ? router.push(`/motivations/${id}`)
              : setStep((n) => Math.min(steps.length - 1, n + 1))
          }
          className="rounded-[var(--r-sm)] border-0 bg-[var(--red)] px-6 py-[11px] text-[13.5px] font-semibold text-white"
        >
          {last ? 'Open your pack' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

/** What each step actually asks. */
function StepBody({
  stepKey,
  sections,
  documents,
  motivationId,
  busyKind,
  onFiles,
  pack,
  fields,
  answers,
  missing,
  onChange,
  openRow,
  onToggleRow,
}: {
  stepKey: string;
  sections?: string[];
  documents?: { kind: string; title: string; subtitle?: string }[];
  motivationId: string;
  busyKind: string | null;
  onFiles: (kind: string, files: File[]) => void;
  pack: MotivationPack;
  fields: MotivationField[];
  answers: Record<string, string>;
  missing: Set<string>;
  onChange: (key: string, value: string) => void;
  openRow: string | null;
  onToggleRow: (key: string) => void;
}) {
  // The first step restates what was chosen when the application was started.
  // ⚠️ READ-ONLY, DELIBERATELY. Changing the section changes which documents
  // are required and which questions are asked; it is not a field to flip
  // halfway through, it is a new application.
  if (stepKey === 'section') {
    return (
      <div className="gg-tile max-w-[820px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[17px] py-[15px]">
        <div className="text-[12.5px] text-[var(--text-tertiary)]">
          You are applying under
        </div>
        <div className="mt-1 text-[18px] font-bold text-[var(--text-primary)]">
          {LICENCE_SECTION[pack.licenceType] ?? ''} —{' '}
          {licenceLabel(pack.licenceType).toLowerCase()}
        </div>
        <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
          Chosen when you started this application. To apply under a different
          section, start a new one — the documents and the questions are not the
          same.
        </p>
      </div>
    );
  }

  // The last step is the pack itself: what we produce, what you gather, and
  // what somebody else has to send.
  if (stepKey === 'pack') {
    return (
      <div className="max-w-[820px] space-y-6">
        {pack.checklist.sections.map((s) => (
          <PackGroup
            key={s.key}
            section={s}
            expandedKey={openRow}
            onToggle={onToggleRow}
          />
        ))}
      </div>
    );
  }

  // "Where it is from" has no registry section of its own — the routing
  // question lives in "The firearm" and the seller's half is his to complete.
  if (stepKey === 'source') {
    return (
      <div className="gg-tile max-w-[820px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[17px] py-[15px]">
        <p className="text-[13.5px] text-[var(--text-secondary)]">
          You answered this on the previous step. On a private sale we send the
          current owner a link to complete his own half of the form — his
          details, his licence card, and the declaration he signs. Send it from
          the classic view for now.
        </p>
      </div>
    );
  }

  const stepFields = (sections ?? []).flatMap((sec) =>
    visibleFields(fields, answers).filter((f) => f.section === sec),
  );

  return (
    <div className="max-w-[800px] space-y-4">
      {/* Capture first — photographing the document is what fills the page. */}
      {documents?.map((d) => (
        <CaptureCards
          key={d.kind}
          motivationId={motivationId}
          kind={d.kind}
          title={d.title}
          subtitle={d.subtitle}
          busy={busyKind !== null}
          onFiles={(files) => onFiles(d.kind, files)}
          onArrived={() => onFiles(d.kind, [])}
        />
      ))}

      {/* ⚠️ EACH STEP GETS THE ARTBOARD'S OWN BLOCK, NOT ONE GENERIC PANEL.
          The design uses a different shape per step for a reason: a document
          being read is a review with confidence pills; a settled list of
          facts is a two-column grid; six questions nobody can prefill are
          six visible yes/no pairs; owned firearms are collapsible cards. One
          panel for all of them is the thing that made the live screen look
          nothing like the design. */}
      {stepKey === 'owned' ? (
        // Collapsible per-firearm cards, and the row rule that shows the LAST
        // row in use rather than a count of how many — see
        // lib/owned-firearm-rows.ts and the bug its spec records.
        <PackSection
          title=""
          section="Firearms you already own"
          fields={fields}
          answers={answers}
          missing={missing}
          onChange={onChange}
        />
      ) : stepKey === 'declarations' ? (
        // ⚠️ VISIBLE PILL PAIRS, AND NOTHING PRE-SELECTED. The artboard draws
        // all six answered "No" because it is a picture of a finished
        // application; shipping that would put words about somebody's
        // criminal record in their mouth, on a form signed under s 120(9)(f).
        <div className="divide-y divide-[var(--border-divider)]">
          {stepFields.map((f) =>
            f.kind === 'yesno' ? (
              <YesNoPills
                key={f.key}
                field={f}
                value={answers[f.key] ?? ''}
                missing={missing.has(f.key)}
                onChange={(v) => onChange(f.key, v)}
              />
            ) : (
              <div key={f.key} className="py-2.5">
                <FieldInput
                  field={f}
                  value={answers[f.key] ?? ''}
                  missing={missing.has(f.key)}
                  onChange={(v) => onChange(f.key, v)}
                />
              </div>
            ),
          )}
        </div>
      ) : stepKey === 'about' || stepKey === 'case' ? (
        // A settled list of facts, two columns, sensitive values masked while
        // collapsed and shown while being corrected.
        <FieldGrid
          fields={stepFields}
          answers={answers}
          provenance={pack.provenance}
          missing={missing}
          onChange={onChange}
        />
      ) : stepFields.length > 0 ? (
        // A document being read: every line with where its value came from.
        <ReadResult
          section={(sections ?? [])[0] ?? ''}
          fields={stepFields}
          answers={answers}
          provenance={pack.provenance}
          missing={missing}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

/**
 * What is still outstanding on this step, counted rather than written.
 *
 * ⚠️ COUNTS ONLY WHAT IS REQUIRED AND STILL EMPTY, from the server's own
 * missingRequired. A hint invented on the client would drift from the gate
 * that actually decides whether a pack can be produced.
 */
function hintFor(
  sections: string[] | undefined,
  fields: MotivationField[],
  missing: Set<string>,
): string {
  if (!sections?.length) return '';
  const mine = fields.filter(
    (f) => sections.includes(f.section) && missing.has(f.key),
  );
  if (!mine.length) return 'Nothing outstanding here.';
  return mine.length === 1
    ? 'One answer still needed.'
    : `${mine.length} answers still needed.`;
}

function SaveState({ state, refused }: { state: string; refused: string[] }) {
  if (refused.length > 0) {
    return (
      <span className="text-[var(--warning)]">
        Not saved — please tell support
      </span>
    );
  }
  if (state === 'saving') return <span>Saving…</span>;
  if (state === 'saved') return <span>Saved a moment ago</span>;
  if (state === 'error') return <span>Not saved</span>;
  return null;
}
