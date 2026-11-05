'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  motivationsApi,
  type DocumentEngineStatus,
  type IntakeChoice,
  type IntakeDocumentItem,
  type IntakeQuestion,
  type IntakeState,
} from '@/lib/motivations-api';
import IntakeBlocked from '@/components/licence-centre/intake-blocked';
import IntakeGroupCard, {
  type GroupAnswer,
} from '@/components/licence-centre/intake-group-card';
import ConsentCard from '@/components/licence-centre/consent-card';
import type { SheetResponse } from '@/components/licence-centre/contract';
import DocumentAddButtons, {
  type DocumentAddOutcome,
} from '@/components/motivation/document-add-buttons';

interface Turn {
  question: string;
  answer: string;
}

const keyOf = (i: IntakeDocumentItem) => `${i.source}:${i.sourceId}`;

function Progress({ q }: { q: IntakeQuestion }) {
  const pct = q.progress.total
    ? Math.round((q.progress.answered / q.progress.total) * 100)
    : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-inset)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--red)' }} />
      </div>
      <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
        {q.progress.answered}/{q.progress.total}
      </span>
    </div>
  );
}

export default function IntakeInterviewPage() {
  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();

  const [data, setData] = useState<IntakeState | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [evidenceSelected, setEvidenceSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<DocumentEngineStatus | null>(null);
  const submitting = useRef(false);
  const [detailFor, setDetailFor] = useState<IntakeQuestion | null>(null);
  const [detailValues, setDetailValues] = useState<Record<string, string>>({});
  const [deferredDocs, setDeferredDocs] = useState(false);
  const [manualDocs, setManualDocs] = useState<Set<string>>(new Set());
  const sourceFile = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [sourceMode, setSourceMode] = useState<'menu' | 'manual' | 'consent'>(
    'menu',
  );
  const [manualFirearm, setManualFirearm] = useState<Record<string, string>>(
    {},
  );
  const [manualSaving, setManualSaving] = useState(false);
  const [consentSigned, setConsentSigned] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await motivationsApi.intake(getToken, id);
      setData(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  const refreshSheet = useCallback(async () => {
    try {
      setSheet(await motivationsApi.sheet(getToken, id));
    } catch {
      setSheet(null);
    }
  }, [getToken, id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  useEffect(() => {
    if (id) void refreshSheet();
  }, [id, refreshSheet]);

  const applicantName =
    sheet?.items.find((i) => i.key === 'full_name')?.value ?? '';
  const consentFirearm = {
    firearm_type: sheet?.items.find((i) => i.key === 'firearm_type')?.value,
    firearm_make: sheet?.items.find((i) => i.key === 'firearm_make')?.value,
    firearm_model: sheet?.items.find((i) => i.key === 'firearm_model')?.value,
    firearm_calibre: sheet?.items.find((i) => i.key === 'firearm_calibre')
      ?.value,
    firearm_serial: sheet?.items.find((i) => i.key === 'firearm_serial')?.value,
  };

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
    if (data.stage === 'MODE' || data.stage === 'DOCUMENTS') {
      router.replace(`/licence-centre/${id}/start`);
      return;
    }
    // A REVIEW stage may still need a document. The edit sheet links back
    // here for that upload, so this page must not bounce it to the pack.
    if (data.stage === 'REVIEW' && !data.documents.missing.length) {
      router.replace(`/licence-centre/${id}/pack`);
    }
  }, [data, id, router]);

  const q = data?.question ?? null;
  const group = data?.group ?? null;
  const historyTurn =
    historyIndex !== null ? (turns[historyIndex] ?? null) : null;
  const choices = q?.choices ?? [];
  const isChipQuestion =
    !!q &&
    (q.kind === 'cards' ||
      q.kind === 'choice' ||
      q.kind === 'yesno' ||
      q.kind === 'multi' ||
      choices.length > 0);
  const showCustom =
    !!q && ((q.kind !== 'choice' && q.kind !== 'yesno') || !choices.length);

  const evidence = useMemo(
    () => (data?.evidence.items ?? []).filter((i) => !i.alreadyHere),
    [data],
  );

  const motivationOnly = data?.outputMode === 'MOTIVATION_ONLY';
  const missingDocs = data?.documents.missing ?? [];
  const sourceMissing = data ? !data.documents.sourceProofAttached : false;
  const sourceInTopic = !data?.topic || data.topic.id === 'firearm';
  const topicDocKinds = data?.topic
    ? new Set(data.topic.documents.map((document) => document.kind))
    : null;
  const dfoNeeds = (data?.documents.needs ?? []).filter(
    (n) =>
      !n.have &&
      n.kind !== 'FIREARM_SOURCE_PROOF' &&
      !manualDocs.has(n.kind) &&
      (topicDocKinds === null || topicDocKinds.has(n.kind)),
  );
  const showDocs =
    !!data &&
    !motivationOnly &&
    !deferredDocs &&
    ((sourceMissing && sourceInTopic) ||
      missingDocs.length > 0 ||
      dfoNeeds.length > 0);
  const openDocCount =
    (sourceMissing && sourceInTopic ? 1 : 0) + dfoNeeds.length;
  const vaultSourceDocs = (data?.documents.items ?? []).filter(
    (i) =>
      !i.alreadyHere &&
      (i.kind === 'FIREARM_SOURCE_PROOF' || i.kind === 'SELLER_LICENCE'),
  );

  async function send(body: {
    value?: string;
    values?: string[];
    message?: string;
    fields?: Record<string, string>;
  }) {
    if (!q || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const shown = body.message ?? body.values?.join(', ') ?? body.value ?? '';
    try {
      const next = await motivationsApi.answerIntake(getToken, id, {
        fieldKey: q.fieldKey,
        ...body,
      });
      setTurns((prev) => [
        ...prev,
        { question: q.label, answer: shown || 'Answered' },
      ]);
      setHistoryIndex(null);
      setData(next);
      setText('');
      setSelected([]);
      setDetailFor(null);
      setDetailValues({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  /**
   * \u26a0\ufe0f A WHOLE CATEGORY IN ONE POST. The server validates every answer before
   * it writes any of them, and rebuilds the interview once — so the member
   * waits for one round rather than one per question.
   */
  async function sendBatch(answers: GroupAnswer[]) {
    if (!group || !answers.length || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.answerIntakeBatch(
        getToken,
        id,
        answers,
      );
      setTurns((prev) => [
        ...prev,
        {
          question: group.title,
          answer: `${answers.length} ${answers.length === 1 ? 'answer' : 'answers'}`,
        },
      ]);
      setHistoryIndex(null);
      setData(next);
      setText('');
      setSelected([]);
      setDetailFor(null);
      setDetailValues({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function tapChoice(choice: IntakeChoice) {
    if (!q) return;
    if (q.multi) {
      setSelected((prev) =>
        prev.includes(choice.value)
          ? prev.filter((v) => v !== choice.value)
          : [...prev, choice.value],
      );
      return;
    }
    if (choice.value === 'Yes' && q.details?.length) {
      setDetailFor(q);
      setDetailValues({});
      return;
    }
    void send({ value: choice.value });
  }

  function submitText() {
    if (!q) return;
    const value = text.trim();
    if (!value) return;
    if (isChipQuestion) {
      void send({
        message: value,
        values: q.multi && selected.length ? selected : undefined,
      });
    } else {
      void send({ value });
    }
  }

  async function addEvidence() {
    const chosen = evidence.filter((i) => evidenceSelected.has(keyOf(i)));
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.selectIntakeDocuments(
        getToken,
        id,
        chosen.map((i) => ({ source: i.source, sourceId: i.sourceId })),
        false,
      );
      setData(next);
      setEvidenceSelected(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  type ReadSuggestion = {
    key: string;
    value: string;
    trusted: boolean;
  };

  async function applyReads(suggestions: ReadSuggestion[]) {
    /**
     * ⚠️ THE UPLOAD MUST WRITE WHAT IT READ. The server returns the fields as
     * suggestions and deliberately does not save them; dropping the return
     * value is why an annexure could be read perfectly and every box stayed
     * empty. `applyExtraction` only fills EMPTY fields, so typed answers win.
     */
    const answers: Record<string, string> = {};
    for (const s of suggestions) {
      if (s?.key && s.value && s.trusted) answers[s.key] = s.value;
    }
    if (Object.keys(answers).length) {
      await motivationsApi.applyExtraction(getToken, id, answers);
    }
  }

  async function uploadDocument(
    kind: string,
    files: FileList | File[] | null | undefined,
    onProgress?: (done: number, total: number, file?: string) => void,
  ): Promise<DocumentAddOutcome[]> {
    const list = files ? Array.from(files) : [];
    const outcomes: DocumentAddOutcome[] = [];
    const questionKey = q?.fieldKey;
    if (!list.length) return outcomes;
    setBusy(true);
    setError(null);
    try {
      const suggestions: ReadSuggestion[] = [];
      for (const [index, file] of list.entries()) {
        onProgress?.(index, list.length, file.name);
        try {
          const added = await motivationsApi.addUpload(
            getToken,
            id,
            kind,
            file,
          );
          const own = added?.suggestions ?? [];
          if (own.length) suggestions.push(...own);
          const trusted = own.filter((s) => s.trusted && s.value);
          outcomes.push({
            file: file.name,
            label: added.label || added.kind,
            kind: added.kind,
            uploadId: added.id,
            mimeType: file.type,
            unitStandards: added.unitStandards,
            answersQuestion: questionKey
              ? trusted.some((s) => s.key === questionKey)
              : undefined,
            fields: trusted.map((s) => ({
              key: s.key,
              label: s.label,
              value: s.value,
            })),
          });
        } catch (err) {
          /**
           * ⚠️ THE SAME FILE ALREADY ATTACHED IS NOT A DEAD END. The row is
           * there; what may be missing is a field the reader did not ask for
           * last time (the status certificate's "valid until" was one). Re-read
           * the stored row and apply its suggestions instead of making the
           * applicant delete and re-upload a document we already hold.
           */
          if (!/already attached/i.test((err as Error).message)) {
            outcomes.push({ file: file.name, error: (err as Error).message });
            continue;
          }
          const existing = (data?.documents.items ?? []).find(
            (item) =>
              item.source === 'upload' &&
              item.alreadyHere &&
              item.kind === kind,
          );
          if (!existing) {
            outcomes.push({ file: file.name, error: (err as Error).message });
            continue;
          }
          const reread = await motivationsApi.rereadUpload(
            getToken,
            id,
            existing.sourceId,
          );
          const own = reread.suggestions ?? [];
          if (own.length) suggestions.push(...own);
          const trusted = own.filter((s) => s.trusted && s.value);
          outcomes.push({
            file: file.name,
            label: existing.title || existing.kind,
            kind: existing.kind,
            uploadId: existing.sourceId,
            mimeType: file.type,
            note: 'already attached — re-read',
            answersQuestion: questionKey
              ? trusted.some((s) => s.key === questionKey)
              : undefined,
            fields: trusted.map((s) => ({
              key: s.key,
              label: s.label,
              value: s.value,
            })),
          });
        } finally {
          onProgress?.(index + 1, list.length);
        }
      }
      await applyReads(suggestions);
      await load();
      setDeferredDocs(false);
      return outcomes;
    } catch (err) {
      setError((err as Error).message);
      return outcomes;
    } finally {
      setBusy(false);
    }
  }

  async function attachVault(item: IntakeDocumentItem) {
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.selectIntakeDocuments(
        getToken,
        id,
        [{ source: item.source, sourceId: item.sourceId }],
        false,
      );
      setData(next);
      setDeferredDocs(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openManual() {
    const value = (key: string) =>
      sheet?.items.find((i) => i.key === key)?.value ?? '';
    setManualFirearm({
      firearm_type: value('firearm_type'),
      firearm_make: value('firearm_make'),
      firearm_model: value('firearm_model'),
      firearm_calibre: value('firearm_calibre'),
      firearm_serial: value('firearm_serial'),
    });
    setSourceMode('manual');
  }

  async function saveManualFirearm() {
    if (
      !manualFirearm.firearm_type ||
      !manualFirearm.firearm_make ||
      !manualFirearm.firearm_model ||
      !manualFirearm.firearm_calibre ||
      !manualFirearm.firearm_serial
    )
      return;
    setManualSaving(true);
    setError(null);
    try {
      await motivationsApi.saveAnswers(getToken, id, manualFirearm);
      await load();
      await refreshSheet();
      setSourceMode('menu');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setManualSaving(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.finishIntake(getToken, id);
      router.push(`/licence-centre/${id}/pack`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setDetail(key: string, value: string) {
    setDetailValues((prev) => ({ ...prev, [key]: value }));
  }

  function saveDetails() {
    if (!detailFor) return;
    void send({ value: 'Yes', fields: detailValues });
  }

  async function switchSection(licenceType: string) {    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.changeIntakeSection(
        getToken,
        id,
        licenceType,
      );
      setData(next);
    } catch (err) {
      setError((err as Error).message);
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


  /**
   * ⚠️ THE UPLOAD AFFORDANCE BELONGS TO BOTH CARDS, SO IT IS DEFINED ONCE.
   * The grouped card asks one question at a time; a document for this topic can
   * still prefill it, so the same control renders beside either card rather
   * than disappearing with the legacy one.
   */
  const documentButtons = (
    <DocumentAddButtons
      motivationId={id}
      busy={busy}
      onFiles={(files) => uploadDocument('', files)}
      onHandoffArrived={() => void load()}
      onPreview={(uploadId) =>
        motivationsApi.uploadBlobUrl(getToken, id, uploadId)
      }
      onApply={async (answers) => {
        await motivationsApi.saveAnswers(getToken, id, answers);
      }}
      onReviewComplete={() => void load()}
      unavailable={engine ? !engine.available : false}
      unavailableMessage={engine?.message}
      onNotify={() => {
        void motivationsApi
          .engineInterest(getToken, 'MOTIVATION_UPLOAD', id)
          .then(() => setError('We will email you as soon as it is back.'))
          .catch(() => setError('We could not save that request. Please try again.'));
      }}
    />
  );

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-5">
      <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {data.licenceTypeLabel} · guided interview
      </p>
      <h1 className="mt-1 font-[family-name:var(--font-head)] text-[23px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
        Let’s build your motivation
      </h1>
      <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
        {data.summary}
      </p>



      {group && group.questions.length ? (
        <>
          <IntakeGroupCard
            group={group}
            busy={busy}
            onSubmit={sendBatch}
            onStuck={(message) => setError(message)}
          />
          <div className="mt-3">
            <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Have a document for this?
            </p>
            {documentButtons}
          </div>
        </>
      ) : q ? (
        <div className="mt-4">
          <Progress q={q} />
          {q.progress.answered > 0 ? (
            <p className="mt-2 text-[12px] leading-5 text-[var(--text-tertiary)]">
              {q.progress.answered} of {q.progress.total} answers are already
              on this application from your documents, profile or earlier
              answers. The interview only asks what is still missing.
            </p>
          ) : null}
        </div>
      ) : null}

      {data.acknowledgement ? (
        <p className="mt-3 text-[13px] leading-5 text-[var(--text-secondary)]">
          {data.acknowledgement}
        </p>
      ) : null}

      {data.topic && !group && !historyTurn ? (
        <section
          className="mt-4 rounded-xl border px-4 py-3"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
            Step {data.topic.index} of {data.topic.total} · {data.topic.title}
          </p>
          {data.topic.have.length || data.topic.documents.some((d) => d.have) ? (
            <>
              <p className="m-0 mt-2 text-[12.5px] font-medium text-[var(--text-primary)]">
                We will use
              </p>
              <ul className="m-0 mt-1 list-disc pl-5 text-[12.5px] leading-5 text-[var(--text-secondary)]">
                {data.topic.have.map((item, index) => (
                  <li key={`${item.label}-${index}`}>
                    <span className="font-medium text-[var(--text-primary)]">
                      {item.label}:
                    </span>{' '}
                    {item.value}{' '}
                    <span className="text-[var(--text-tertiary)]">
                      ({item.from})
                    </span>
                  </li>
                ))}
                {data.topic.documents
                  .filter((document) => document.have)
                  .map((document) => (
                    <li key={document.kind}>{document.label}</li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="m-0 mt-2 text-[12.5px] leading-5 text-[var(--text-secondary)]">
              Nothing saved for this step yet. We will ask for it below.
            </p>
          )}
          {data.topic.documents.some((d) => d.required && !d.have) ? (
            <p className="m-0 mt-2 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
              Print-ready pack still needs:{' '}
              {data.topic.documents
                .filter((d) => d.required && !d.have)
                .map((d) => d.label)
                .join(', ')}
              .
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-5 flex flex-col gap-3">
        {historyTurn ? (
          <div
            className="rounded-2xl border p-4"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
          >
            <p className="m-0 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
              Previous question
            </p>
            <p className="mt-2 text-[15px] font-medium leading-6 text-[var(--text-primary)]">
              {historyTurn.question}
            </p>
            <p
              className="mt-3 rounded-xl px-3 py-2 text-[13px] leading-5"
              style={{
                background: 'var(--red-wash)',
                color: 'var(--text-primary)',
              }}
            >
              {historyTurn.answer}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setHistoryIndex((index) =>
                      index === null ? null : Math.max(0, index - 1),
                    )
                  }
                  disabled={historyIndex === 0}
                  className="rounded-lg border px-3 py-2 text-[13px] font-medium disabled:opacity-40"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryIndex((index) =>
                      index === null
                        ? null
                        : Math.min(turns.length - 1, index + 1),
                    )
                  }
                  disabled={historyIndex === null || historyIndex >= turns.length - 1}
                  className="rounded-lg border px-3 py-2 text-[13px] font-medium disabled:opacity-40"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Next
                </button>
              </div>
              <button
                type="button"
                onClick={() => setHistoryIndex(null)}
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-white"
                style={{ background: 'var(--red)' }}
              >
                Back to current question
              </button>
            </div>
          </div>
        ) : !group && q ? (
          <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <p className="m-0 text-[15px] font-medium leading-6 text-[var(--text-primary)]">
              {q.label}
            </p>
            {q.help ? (
              <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
                {q.help}
              </p>
            ) : null}
            {busy ? (
              <p
                role="status"
                className="mt-2 text-[12.5px] text-[var(--text-tertiary)]"
              >
                Got it — saving that and fetching the next question…
              </p>
            ) : null}

            <div className="mt-3">
              <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Have a document for this?
              </p>
              {documentButtons}
            </div>

            {choices.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {choices.map((c) => {
                  const on = selected.includes(c.value);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      disabled={busy}
                      onClick={() => tapChoice(c)}
                      className="rounded-full border px-3 py-2 text-left text-[12.5px] leading-4"
                      style={{
                        borderColor: on ? 'var(--red)' : 'var(--border)',
                        background: on ? 'var(--red-wash)' : 'var(--bg-inset)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {q.multi ? (
              <button
                type="button"
                disabled={busy || !selected.length}
                onClick={() => void send({ values: selected })}
                className="mt-3 rounded-lg px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--red)' }}
              >
                Continue with {selected.length || 0} selected
              </button>
            ) : null}

            {showCustom ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={text}
                  type={q.kind === 'date' ? 'date' : 'text'}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitText();
                  }}
                  placeholder={q.customPlaceholder}
                  className="min-h-[44px] flex-1 rounded-lg border px-3 text-[13.5px]"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
                />
                <button
                  type="button"
                  disabled={busy || !text.trim()}
                  onClick={submitText}
                  className="rounded-lg px-4 text-[13px] font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--red)' }}
                >
                  Send
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <p className="m-0 text-[15px] font-medium text-[var(--text-primary)]">
              {data.needsDetail?.length
                ? 'A few more details before I can write it.'
                : 'That’s everything I need.'}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
              {data.needsDetail?.length
                ? 'The motivation cannot be written until these are in, so the interview stays open.'
                : 'Review the answers on the sheet before you write. Anything the documents already answered is marked with its source.'}
            </p>
            {data.needsDetail?.length ? (
              <div
                className="mt-2 rounded-lg border px-3 py-2"
                style={{ borderColor: 'var(--red)', background: 'var(--red-wash)' }}
              >
                <ul className="m-0 list-disc pl-5 text-[12.5px] leading-5 text-[var(--text-primary)]">
                  {data.needsDetail.map((gap) => (
                    <li key={gap.code}>
                      <span className="font-medium">{gap.label}</span> — {gap.hint}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!motivationOnly && (missingDocs.length || sourceMissing) ? (
              <div className="mt-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }}>
                <p className="m-0 text-[12.5px] text-[var(--text-secondary)]">
                  {sourceMissing
                    ? 'Firearm source paperwork is still outstanding.'
                    : `${missingDocs.length} required document${missingDocs.length === 1 ? '' : 's'} still outstanding.`}{' '}
                  <button
                    type="button"
                    onClick={() => setDeferredDocs(false)}
                    className="underline"
                  >
                    Add now
                  </button>{' '}
                  or add it on the review sheet.
                </p>
              </div>
            ) : null}
            <button
              type="button"
              disabled={busy || Boolean(data.needsDetail?.length)}
              onClick={() => void finish()}
              className="mt-3 rounded-lg px-4 py-2.5 text-[13.5px] font-medium text-white disabled:opacity-60"
              style={{ background: 'var(--red)' }}
            >
              Review my answers
            </button>
          </div>
        )}
      </div>

      {showDocs ? (
        <details
          className="mt-4 rounded-xl border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              DFO documents
            </span>
            <span className="text-[11.5px] text-[var(--text-tertiary)]">
              {openDocCount} still to add
            </span>
          </summary>
          <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-[12.5px] leading-5 text-[var(--text-secondary)]">
                {data.documents.attached} attached. Upload a document and we
                read the fields off it; or enter the details yourself and the
                interview will ask for them.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDeferredDocs(true)}
              className="shrink-0 text-[12px] text-[var(--text-secondary)] underline"
            >
              Skip for now
            </button>
          </div>

          {sourceInTopic && (!motivationOnly || sourceMissing) ? (
            <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }}>
              <p className="m-0 text-[13px] font-medium text-[var(--text-primary)]">
                The firearm you are applying for
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                The dealer’s invoice or stamped SAPS 350(a), the current owner’s
                licence, or their signed consent.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={openManual}
                  className="rounded-lg border px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                >
                  Manual entry
                </button>
                <label
                  className="cursor-pointer rounded-lg border px-3 py-2 text-[12.5px] font-medium"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                >
                  Upload
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void uploadDocument(
                        'FIREARM_SOURCE_PROOF',
                        e.target.files,
                      );
                      e.target.value = '';
                    }}
                  />
                </label>
                <label
                  className="cursor-pointer rounded-lg border px-3 py-2 text-[12.5px] font-medium"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                >
                  Scan
                  <input
                    ref={sourceFile}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      void uploadDocument(
                        'FIREARM_SOURCE_PROOF',
                        e.target.files,
                      );
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setSourceMode((mode) =>
                      mode === 'consent' ? 'menu' : 'consent',
                    )
                  }
                  className="rounded-lg border px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                >
                  Send seller consent form
                </button>
              </div>

              {sourceMode === 'manual' ? (
                <div
                  className="mt-3 grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
                >
                  <label className="text-[12px] text-[var(--text-secondary)]">
                    Type
                    <select
                      value={manualFirearm.firearm_type ?? ''}
                      onChange={(e) =>
                        setManualFirearm((prev) => ({
                          ...prev,
                          firearm_type: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-lg border bg-transparent px-2 py-2 text-[13px]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <option value="">Choose…</option>
                      <option>Rifle</option>
                      <option>Shotgun</option>
                      <option>Handgun</option>
                      <option>Combination</option>
                    </select>
                  </label>
                  <label className="text-[12px] text-[var(--text-secondary)]">
                    Make
                    <input
                      value={manualFirearm.firearm_make ?? ''}
                      onChange={(e) =>
                        setManualFirearm((prev) => ({
                          ...prev,
                          firearm_make: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-lg border bg-transparent px-2 py-2 text-[13px]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                  </label>
                  <label className="text-[12px] text-[var(--text-secondary)]">
                    Model
                    <input
                      value={manualFirearm.firearm_model ?? ''}
                      onChange={(e) =>
                        setManualFirearm((prev) => ({
                          ...prev,
                          firearm_model: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-lg border bg-transparent px-2 py-2 text-[13px]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                  </label>
                  <label className="text-[12px] text-[var(--text-secondary)]">
                    Calibre
                    <input
                      value={manualFirearm.firearm_calibre ?? ''}
                      onChange={(e) =>
                        setManualFirearm((prev) => ({
                          ...prev,
                          firearm_calibre: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-lg border bg-transparent px-2 py-2 text-[13px]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                  </label>
                  <label className="text-[12px] text-[var(--text-secondary)] sm:col-span-2">
                    Serial number
                    <input
                      value={manualFirearm.firearm_serial ?? ''}
                      onChange={(e) =>
                        setManualFirearm((prev) => ({
                          ...prev,
                          firearm_serial: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-lg border bg-transparent px-2 py-2 text-[13px]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      manualSaving ||
                      !manualFirearm.firearm_type ||
                      !manualFirearm.firearm_make ||
                      !manualFirearm.firearm_model ||
                      !manualFirearm.firearm_calibre ||
                      !manualFirearm.firearm_serial
                    }
                    onClick={() => void saveManualFirearm()}
                    className="rounded-lg px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50 sm:col-span-2"
                    style={{ background: 'var(--red)' }}
                  >
                    {manualSaving ? 'Saving…' : 'Use these details'}
                  </button>
                </div>
              ) : null}

              {sourceMode === 'consent' ? (
                <div className="mt-3">
                  <ConsentCard
                    motivationId={id}
                    applicantName={applicantName}
                    firearm={consentFirearm}
                    signed={consentSigned}
                    onAdopt={async (fields) => {
                      await motivationsApi.saveAnswers(
                        getToken,
                        id,
                        fields,
                      );
                      await load();
                      await refreshSheet();
                    }}
                    onArrived={async (status) => {
                      setConsentSigned(status === 'COMPLETED');
                      await load();
                      await refreshSheet();
                    }}
                  />
                </div>
              ) : null}
              {vaultSourceDocs.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {vaultSourceDocs.map((d) => (
                    <button
                      key={keyOf(d)}
                      type="button"
                      disabled={busy}
                      onClick={() => void attachVault(d)}
                      className="rounded-full border px-3 py-1.5 text-[12px] disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
                    >
                      Use “{d.title}” from your Centre
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {dfoNeeds.length ? (
            <div className="mt-2 grid gap-2">
              {dfoNeeds.map((d) => (
                <div key={d.kind} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="m-0 text-[12.5px] font-medium text-[var(--text-primary)]">
                      {d.label}
                    </p>
                    <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                      {d.tier === 'required' ? 'Required' : 'DFO expects'}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                    {d.why}
                  </p>
                  {d.minFiles && d.minFiles > 1 ? (
                    <p className="mt-1 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
                      {d.minFilesNote ?? `Add at least ${d.minFiles} files.`}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <label
                      className="cursor-pointer rounded-lg border px-3 py-2 text-[12.5px] font-medium"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    >
                      Upload or scan
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          void uploadDocument(d.kind, e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setManualDocs((prev) => {
                          const next = new Set(prev);
                          next.add(d.kind);
                          return next;
                        })
                      }
                      className="rounded-lg border px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
                    >
                      Enter details instead
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          </div>
        </details>
      ) : null}

      {evidence.length && data.evidence.ready ? (
        <section className="mt-7">
          <h2 className="m-0 text-[14px] font-medium text-[var(--text-primary)]">
            Evidence for this application
          </h2>
          <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
            {data.evidence.note}
          </p>
          <div className="mt-2 grid gap-2">
            {evidence.map((item) => {
              const checked = evidenceSelected.has(keyOf(item));
              return (
                <label
                  key={keyOf(item)}
                  className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]"
                  style={{ borderColor: checked ? 'var(--red)' : 'var(--border)', background: checked ? 'var(--red-wash)' : 'var(--bg-card)' }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setEvidenceSelected((prev) => {
                        const next = new Set(prev);
                        const k = keyOf(item);
                        if (next.has(k)) next.delete(k);
                        else next.add(k);
                        return next;
                      })
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-[var(--text-primary)]">{item.title}</span>
                    <span className="block text-[12px] text-[var(--text-tertiary)]">
                      {item.tickReason ?? 'Suggested for this purpose.'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            disabled={busy || !evidenceSelected.size}
            onClick={() => void addEvidence()}
            className="mt-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
          >
            Add selected evidence
          </button>
        </section>
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p> : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-page)' }}>
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
          {turns.length && historyIndex === null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setHistoryIndex(turns.length - 1)}
              className="text-[13px] text-[var(--text-secondary)] underline"
            >
              Previous question
            </button>
          ) : (
            <span />
          )}
          {!q && !historyTurn ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="text-[13px] text-[var(--text-secondary)] underline"
            >
              Finish and write
            </button>
          ) : null}
          <span className="text-[11.5px] text-[var(--text-tertiary)]">
            Your answers are saved as you go.
          </span>
        </div>
      </div>
      {detailFor ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={detailFor.label}
            className="max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border p-4"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
          >
            <h2 className="m-0 text-[16px] font-medium text-[var(--text-primary)]">
              {detailFor.label}
            </h2>
            <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
              You answered Yes. Give the particulars the SAPS 271 asks for. They
              are typed here and never sent to the writing assistant.
            </p>
            <div className="mt-3 grid gap-3">
              {detailFor.details?.map((d) => {
                const value = detailValues[d.key] ?? '';
                const label = (
                  <span className="block text-[12.5px] font-medium text-[var(--text-primary)]">
                    {d.label}
                  </span>
                );
                if (
                  d.kind === 'choice' ||
                  d.kind === 'yesno' ||
                  d.kind === 'cards' ||
                  d.kind === 'multi'
                ) {
                  return (
                    <label key={d.key} className="block">
                      {label}
                      <select
                        multiple={d.multi}
                        value={d.multi ? value.split(',').filter(Boolean) : value}
                        onChange={(e) => {
                          const vals = Array.from(
                            e.currentTarget.selectedOptions,
                            (o) => o.value,
                          );
                          setDetail(d.key, d.multi ? vals.join(', ') : vals[0] ?? '');
                        }}
                        className="mt-1 min-h-[44px] w-full rounded-lg border px-2 text-[13px]"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
                      >
                        {!d.multi ? <option value="">Choose…</option> : null}
                        {d.choices.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (d.kind === 'long') {
                  return (
                    <label key={d.key} className="block">
                      {label}
                      <textarea
                        value={value}
                        onChange={(e) => setDetail(d.key, e.target.value)}
                        placeholder={d.customPlaceholder}
                        rows={3}
                        className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px]"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
                      />
                    </label>
                  );
                }
                return (
                  <label key={d.key} className="block">
                    {label}
                    <input
                      type={d.kind === 'date' ? 'date' : 'text'}
                      value={value}
                      onChange={(e) => setDetail(d.key, e.target.value)}
                      placeholder={d.customPlaceholder}
                      className="mt-1 min-h-[44px] w-full rounded-lg border px-2 text-[13px]"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
                    />
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDetailFor(null)}
                className="rounded-lg border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={saveDetails}
                className="rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
                style={{ background: 'var(--red)' }}
              >
                Save answer
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </main>
  );
}
