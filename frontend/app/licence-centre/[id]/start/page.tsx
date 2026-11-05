'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  motivationsApi,
  type IntakeDocumentItem,
  type IntakeMode,
  type DocumentEngineStatus,
  type IntakeState,
  type MotivationOutputMode,
} from '@/lib/motivations-api';
import IntakeBlocked from '@/components/licence-centre/intake-blocked';
import DocumentAddButtons, {
  type DocumentAddOutcome,
} from '@/components/motivation/document-add-buttons';

const keyOf = (i: IntakeDocumentItem) => `${i.source}:${i.sourceId}`;

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
              : 'Optional â€” add it if it belongs in your pack.')}
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

  const load = useCallback(async () => {
    try {
      const next = await motivationsApi.intake(getToken, id);
      setData(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
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
          setError((err as Error).message);
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
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setOutput(outputMode: MotivationOutputMode) {
    setBusy(true);
    setError(null);
    try {
      const next = await motivationsApi.setIntakeOutput(getToken, id, outputMode);
      setData(next);
    } catch (err) {
      setError((err as Error).message);
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
      setError((err as Error).message);
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
      setError((err as Error).message);
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
        <p className="text-[13.5px] text-[var(--text-tertiary)]">Loadingâ€¦</p>
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
    const motivationOnly = data.outputMode === 'MOTIVATION_ONLY';
    return (
      <main className="mx-auto w-full max-w-[760px] px-4 pb-12 pt-5">
        <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          {data.licenceTypeLabel} · {data.referenceNumber}
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-head)] text-[24px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
          What do you need today?
        </h1>
        <p className="mt-2 max-w-[58ch] text-[13.5px] leading-6 text-[var(--text-secondary)]">
          Choose the result first. We only ask for what that result needs.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void setOutput('MOTIVATION_ONLY')}
            className="rounded-xl border p-4 text-left"
            style={{
              borderColor: motivationOnly ? 'var(--red)' : 'var(--border)',
              background: motivationOnly ? 'var(--red-wash)' : 'var(--bg-card)',
            }}
          >
            <span className="block text-[15px] font-medium text-[var(--text-primary)]">
              Motivation letter only
            </span>
            <span className="mt-1 block text-[12.5px] leading-5 text-[var(--text-secondary)]">
              The legal motivation on its own — the document you sign and hand to
              the DFO. This is where most people start, and it needs no documents.
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void setOutput('PRINT_READY')}
            className="rounded-xl border p-4 text-left"
            style={{
              borderColor: !motivationOnly ? 'var(--red)' : 'var(--border)',
              background: !motivationOnly ? 'var(--red-wash)' : 'var(--bg-card)',
            }}
          >
            <span className="block text-[15px] font-medium text-[var(--text-primary)]">
              Print-ready pack
            </span>
            <span className="mt-1 block text-[12.5px] leading-5 text-[var(--text-secondary)]">
              The same motivation plus every annexure, lettered in the order the
              DFO works through, with the document checks done — the pack you walk
              in with. It needs your documents uploaded.
            </span>
          </button>
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

        <div className="mt-6">
          <button
            type="button"
            disabled={busy}
            onClick={() => void start('INTERVIEW')}
            className="w-full rounded-xl border p-4 text-left transition hover:border-[var(--red)]"
            style={{ borderColor: 'var(--red)', background: 'var(--red-wash)' }}
          >
            <span className="block text-[15px] font-medium text-[var(--text-primary)]">
              {busy ? 'Starting…' : 'Start the interview'}
            </span>
            <span className="mt-1 block text-[12.5px] leading-5 text-[var(--text-secondary)]">
              Upload whatever documentation you have first to eliminate repetitive questions, then answer only what’s still needed.
            </span>
          </button>
        </div>
        {error ? (
          <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p>
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
        {busy ? 'Starting…' : 'Start the interview'}
      </button>
      {error ? (
        <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p>
      ) : null}
    </main>
  );
}

