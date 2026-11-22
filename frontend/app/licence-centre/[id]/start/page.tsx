'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import {
  motivationsApi,
  type IntakeDocumentItem,
  type IntakeMode,
  type DocumentEngineStatus,
  type IntakeState,
  type MotivationFulfilmentMode,
  type MotivationOutputMode,
} from '@/lib/motivations-api';
import IntakeBlocked from '@/components/licence-centre/intake-blocked';
import BetaNotice from '@/components/licence-centre/beta-notice';
import DocumentAddButtons, {
  type DocumentAddOutcome,
} from '@/components/motivation/document-add-buttons';

const keyOf = (i: IntakeDocumentItem) => `${i.source}:${i.sourceId}`;

/**
 * ⚠️ A THROTTLE IS NOT A SERVER ERROR THE MEMBER SHOULD READ RAW.
 * Reloading this screen a few times can trip the 60/min limiter, and
 * "ThrottlerException: Too Many Requests" tells somebody nothing they can act
 * on. Everything else keeps its own message.
 */
function readableError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/throttl|too many requests|\b429\b/i.test(message)) {
    return 'Too many attempts in a row — wait a minute, then try again.';
  }
  return message;
}

function Tick({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border"
      style={{
        borderColor: on ? 'var(--red)' : 'var(--border)',
        background: on ? 'var(--red)' : 'var(--bg-inset)',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {on ? (
        <svg viewBox="0 0 24 24" width="13" height="13">
          <path
            d="M5 13l4 4L19 7"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function DocumentRow({
  item,
  selected,
  onToggle,
}: {
  item: IntakeDocumentItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const locked = item.tick === 'attached' || item.tick === 'required';
  const blocked = item.tick === 'blocked';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={locked || blocked}
      className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left"
      style={{
        borderColor: selected ? 'var(--red)' : 'var(--border)',
        background: selected ? 'var(--red-wash)' : 'var(--bg-card)',
        opacity: blocked ? 0.65 : 1,
      }}
    >
      <Tick on={selected || locked} disabled={locked || blocked} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {item.title}
          </span>
          {item.tick === 'required' ? (
            <span className="hidden" style={{ background: 'var(--red)', color: '#fff' }}>
              Required
            </span>
          ) : null}
          {item.tick === 'attached' ? (
            <span className="hidden">
              Already added
            </span>
          ) : null}
          {item.tick === 'suggested' ? (
            <span className="hidden">
              Suggested
            </span>
          ) : null}
        </span>
        <span className="hidden">
          {item.tickReason ??
            (item.alreadyHere
              ? 'Already on this application.'
              : 'Optional — add it if it belongs in your pack.')}
        </span>
      </span>
    </button>
  );
}

export default function IntakeStartPage() {
  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();

  const [data, setData] = useState<IntakeState | null>(null);
  const [profile, setProfile] = useState<{
    answers: Record<string, string>;
    fields: { key: string; label: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [engine, setEngine] = useState<DocumentEngineStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placeConfirmed, setPlaceConfirmed] = useState(false);
  /**
   * The product chosen on step 1, waiting for step 2 (Print / Download or
   * Print and Deliver). The interview does not start until both are answered —
   * that is the "second option after the user has selected one" the operator
   * asked for.
   */
  const [pendingOutput, setPendingOutput] =
    useState<MotivationOutputMode | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await motivationsApi.intake(getToken, id);
      setData(next);
      setError(null);
    } catch (err) {
      setError(readableError(err));
    }
  }, [getToken, id]);

  useEffect(() => {
    if (id) void load();
    void motivationsApi
      .profile(getToken)
      .then((p) => setProfile({ answers: p.answers, fields: p.fields }))
      .catch(() => setProfile(null));
  }, [id, load, getToken]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void motivationsApi
      .engineStatus(getToken)
      .then((status) => {
        if (live) setEngine(status);
      })
      .catch(() => {
        if (live) setEngine(null);
      });
    return () => {
      live = false;
    };
  }, [getToken, id]);

  useEffect(() => {
    if (!data) return;
    if (data.stage === 'INTERVIEW') {
      router.replace(`/licence-centre/${id}/interview`);
      return;
    }
    if (data.stage === 'REVIEW') {
      router.replace(`/licence-centre/${id}/pack`);
      return;
    }
    setSelected((prev) => {
      if (prev.size) return prev;
      return new Set(
        [...data.documents.items, ...data.evidence.items]
          .filter((i) => i.tick === 'attached' || i.tick === 'required')
          .map(keyOf),
      );
    });
  }, [data, id, router]);

  const docs = useMemo(
    () =>
      (data?.documents.items ?? []).filter(
        (i) => !i.evidenceType && i.kind !== 'EVIDENCE',
      ),
    [data],
  );
  const evidence = data?.evidence.items ?? [];
  const selectedItems = useMemo(
    () =>
      [...docs, ...evidence].filter(
        (i) => selected.has(keyOf(i)) && !i.alreadyHere && i.tick !== 'blocked',
      ),
    [docs, evidence, selected],
  );
  const needsPlace = selectedItems.some((i) => i.askPlace);

  /**
   * Upload the applicant's own documents before the interview.
   *
   * The vault can be empty — a first-time applicant, or somebody who deleted
   * their documents — and this screen used to render a bare "Documents" heading
   * with no way to add one. The server classifies each file, reads what it can
   * and attaches it to this application, so the next reload lists it here.
   */
  async function addFiles(
    files: FileList | File[] | null,
    onProgress?: (done: number, total: number, file?: string) => void,
  ): Promise<DocumentAddOutcome[]> {
    if (!files?.length) return [];
    const list = Array.from(files);
    const outcomes: DocumentAddOutcome[] = [];
    const trusted: Record<string, string> = {};
    setUploading(true);
    setError(null);
    try {
      for (const [index, file] of list.entries()) {
        onProgress?.(index, list.length, file.name);
        try {
          const added = await motivationsApi.addUpload(getToken, id, '', file);
          const fields = (added.suggestions ?? [])
            .filter((s) => s.trusted && s.value)
            .map((s) => ({ key: s.key, label: s.label, value: s.value }));
          for (const s of added.suggestions ?? []) {
            if (s.trusted && s.key && s.value) trusted[s.key] = s.value;
          }
          outcomes.push({
            file: file.name,
            label: added.label || added.kind,
            kind: added.kind,
            uploadId: added.id,
            mimeType: file.type,
            unitStandards: added.unitStandards,
            fields,
          });
        } catch (err) {
          outcomes.push({ file: file.name, error: (err as Error).message });
        }
        onProgress?.(index + 1, list.length);
      }

      if (Object.keys(trusted).length) {
        try {
          await motivationsApi.applyExtraction(getToken, id, trusted);
        } catch (err) {
          setError(readableError(err));
        }
      }
      const next = await motivationsApi.intake(getToken, id);
      setData(next);
      return outcomes;
    } finally {
      setUploading(false);
    }
  }

  async function start(mode: IntakeMode) {
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.startIntake(getToken, id, mode);
      setData(next);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Choosing the result starts the interview.
   *
   * ⚠️ THE EXTRA "START THE INTERVIEW" CARD WAS A STEP WITH NO CHOICE IN IT.
   * The member had already said what they wanted; the card only repeated the
   * promise and made them press a second time. A result is now a decision and
   * an action: set the output, start the interview, go there. Documents are
   * still taken per topic inside the interview, so nothing is skipped by not
   * showing a document picker first.
   */
  /**
   * Step 1: choose the product. Nothing is written and the interview does not
   * start yet — step 2 is the fulfilment choice below the cards.
   */
  function chooseOutput(outputMode: MotivationOutputMode) {
    if (busy || uploading) return;
    setError(null);
    setPendingOutput(outputMode);
  }

  /**
   * Step 2: choose how the finished document reaches them.
   *
   * ⚠️ ONE PAYMENT, NOT TWO. The choice is stored on the application now; the
   * pack screen adds the R75 + courier quote to the single Yoco amount when the
   * member pays. DIGITAL is the no-extra-charge PDF.
   */
  async function chooseFulfilment(mode: MotivationFulfilmentMode) {
    if (busy || uploading || !pendingOutput) return;
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.setIntakeOutput(getToken, id, pendingOutput);
      await motivationsApi.setFulfilment(getToken, id, mode);
      const next = await motivationsApi.startIntake(getToken, id, 'INTERVIEW');
      setData(next);
      router.push(`/licence-centre/${id}/interview`);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function continueToNext() {
    if (!data || uploading) return;
    if (needsPlace && !placeConfirmed) {
      setError('Tick the safe-at-this-address confirmation before continuing.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.selectIntakeDocuments(
        getToken,
        id,
        selectedItems.map((i) => ({ source: i.source, sourceId: i.sourceId })),
        placeConfirmed,
      );
      setData(next);
      if (data.mode === 'INTERVIEW') {
        router.push(`/licence-centre/${id}/interview`);
      } else {
        router.push(`/licence-centre/${id}/pack`);
      }
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function skipUpload() {
    if (!data || uploading) return;
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.selectIntakeDocuments(
        getToken,
        id,
        [],
        false,
      );
      setData(next);
      router.push(`/licence-centre/${id}/interview`);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function switchSection(licenceType: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.changeIntakeSection(
        getToken,
        id,
        licenceType,
      );
      setData(next);
      setSelected(new Set());
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-8">
        <p className="text-[13.5px] text-[var(--red)]">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-8">
        <p className="text-[13.5px] text-[var(--text-tertiary)]">Loading…</p>
      </main>
    );
  }

  if (data.blocked) {
    return (
      <IntakeBlocked
        blocked={data.blocked}
        busy={busy}
        onSwitch={(licenceType) => void switchSection(licenceType)}
      />
    );
  }


  if (!data.mode) {
    const known = profile ? Object.keys(profile.answers).length : 0;
    const step = pendingOutput ? 2 : 1;
    const primaryButton =
      'mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-[13.5px] font-medium text-white disabled:opacity-50';
    return (
      <main className="mx-auto w-full max-w-[680px] px-4 pb-12 pt-5">
        {/* The beta popup, once per application. This is the first screen a
            new motivation opens on; the sheet shows it too if they arrive
            there first, and the per-id key stops it appearing twice. */}
        <BetaNotice motivationId={id} />

        <div className="flex min-h-[36px] items-center justify-between gap-3">
          {step === 2 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setPendingOutput(null);
              }}
              className="inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] disabled:opacity-50"
            >
              <span aria-hidden="true">&#8592;</span> Back
            </button>
          ) : (
            <Link
              href="/licence-centre/applications"
              className="inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] no-underline"
            >
              <span aria-hidden="true">&#8592;</span> Back to your applications
            </Link>
          )}
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            Step {step} of 2
          </span>
        </div>

        <p className="mt-3 text-[12px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          {data.licenceTypeLabel} · {data.referenceNumber}
        </p>

        {step === 1 ? (
          <>
            <h1 className="mt-1 font-[family-name:var(--font-head)] text-[24px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
              What do you need today?
            </h1>
            <p className="mt-2 max-w-[58ch] text-[13.5px] leading-6 text-[var(--text-secondary)]">
              Choose the result. The next step is how you want it — the
              interview starts once both are chosen.
            </p>

            <div className="mt-5 space-y-4">
              <section
                className="rounded-xl border p-4"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
              >
                <h2 className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.25] text-[var(--text-primary)]">
                  Motivation letter only
                </h2>
                <p className="m-0 mt-1 text-[13px] leading-6 text-[var(--text-secondary)]">
                  The legal motivation on its own — the document you sign and
                  hand to the DFO. This is where most people start, and it needs
                  no documents.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => chooseOutput('MOTIVATION_ONLY')}
                  className={primaryButton}
                  style={{ background: 'var(--red)' }}
                >
                  Choose Motivation letter only
                </button>
              </section>

              <section
                className="rounded-xl border p-4"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
              >
                <h2 className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.25] text-[var(--text-primary)]">
                  Print-ready pack
                </h2>
                <p className="m-0 mt-1 text-[13px] leading-6 text-[var(--text-secondary)]">
                  The same motivation plus every annexure, lettered in the order
                  the DFO works through, with the document checks done — the pack
                  you walk in with. It needs your documents uploaded.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => chooseOutput('PRINT_READY')}
                  className={primaryButton}
                  style={{ background: 'var(--red)' }}
                >
                  Choose Print-ready pack
                </button>
              </section>
            </div>

            {profile && known > 0 ? (
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
              >
                <div>
                  <p className="m-0 text-[13.5px] font-medium text-[var(--text-primary)]">
                    We remember {known} detail{known === 1 ? '' : 's'} from your
                    profile.
                  </p>
                  <p className="m-0 mt-0.5 text-[12px] leading-5 text-[var(--text-secondary)]">
                    Your safe, premises, association and personal details will be
                    filled in — check them once and continue.
                  </p>
                </div>
                <a
                  href="/licence-centre/profile"
                  className="rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  Review profile
                </a>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="mt-1 font-[family-name:var(--font-head)] text-[24px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
              How would you like it?
            </h1>
            <p className="mt-2 max-w-[58ch] text-[13.5px] leading-6 text-[var(--text-secondary)]">
              Both include the PDF in your account. Print and Deliver adds
              printing, binding and courier delivery to the same payment.
            </p>
            <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
              Selected: {pendingOutput === 'PRINT_READY' ? 'Print-ready pack' : 'Motivation letter only'}
            </p>

            <div className="mt-5 space-y-4">
              <section
                className="rounded-xl border p-4"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
              >
                <h2 className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.25] text-[var(--text-primary)]">
                  Print / Download
                </h2>
                <p className="m-0 mt-1 text-[13px] leading-6 text-[var(--text-secondary)]">
                  The PDF is included and stays in your account. Print it
                  yourself, at no extra charge.
                </p>
                <p className="m-0 mt-2 text-[12px] font-medium text-[var(--text-tertiary)]">
                  Included
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void chooseFulfilment('DIGITAL')}
                  className={primaryButton}
                  style={{ background: 'var(--red)' }}
                >
                  Choose Print / Download
                </button>
              </section>

              <section
                className="rounded-xl border p-4"
                style={{ borderColor: 'var(--red)', background: 'var(--bg-card)' }}
              >
                <h2 className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.25] text-[var(--text-primary)]">
                  Print and Deliver (R75)
                </h2>
                <p className="m-0 mt-1 text-[13px] leading-6 text-[var(--text-secondary)]">
                  We print, bind and courier it to your door. R75 plus the
                  courier rate, added to the same payment. Your address is
                  confirmed before you pay.
                </p>
                <p className="m-0 mt-2 text-[12px] font-medium text-[var(--text-tertiary)]">
                  +R75 + delivery
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void chooseFulfilment('DELIVER')}
                  className={primaryButton}
                  style={{ background: 'var(--red)' }}
                >
                  Choose Print and Deliver
                </button>
              </section>
            </div>

            {busy ? (
              <p className="mt-3 text-[12.5px] text-[var(--text-tertiary)]">
                Starting your interview…
              </p>
            ) : null}
          </>
        )}

        {error ? (
          <p className="mt-3 text-[13px] leading-5 text-[var(--red)]">{error}</p>
        ) : null}
      </main>
    );
  }
  /**
   * ⚠️ NO DOCUMENT PICKER BEFORE THE INTERVIEW. The section is already chosen
   * and the output mode is already chosen. Documents are selected per topic as
   * the interview reaches them, so this screen only starts it.
   */
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-10">
      <BetaNotice motivationId={id} />
      <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {data.licenceTypeLabel} — {data.referenceNumber}
      </p>
      <h1 className="mt-1 font-[family-name:var(--font-head)] text-[24px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
        Ready to start
      </h1>
      <p className="mt-2 text-[13.5px] leading-6 text-[var(--text-secondary)]">
        We will take what you already have from your Document Library as each
        topic comes up, then ask only the gaps.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void start('INTERVIEW')}
        className="mt-6 w-full rounded-xl px-4 py-3 text-[14px] font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--red)' }}
      >
        {busy ? 'Starting…' : 'Continue to the interview'}
      </button>
      {error ? (
        <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p>
      ) : null}
    </main>
  );
}

