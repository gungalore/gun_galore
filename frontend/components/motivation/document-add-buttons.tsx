'use client';

import { useEffect, useRef, useState } from 'react';
import ScanButton from '@/components/scan/scan-button';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export interface DocumentAddOutcome {
  file: string;
  label?: string;
  kind?: string;
  uploadId?: string;
  mimeType?: string;
  fields?: { key: string; label: string; value: string }[];
  /** SAQA codes read from a proficiency statement. */
  unitStandards?: string[];
  /** False when the document added facts but did not answer the question asked. */
  answersQuestion?: boolean;
  note?: string;
  error?: string;
}

function editsFor(outcome: DocumentAddOutcome | undefined) {
  const out: Record<string, string> = {};
  for (const field of outcome?.fields ?? []) out[field.key] = field.value;
  return out;
}

const UNIT_STANDARD_LABELS: Record<string, string> = {
  '117705': 'Knowledge of the Firearms Control Act',
  '119649': 'Handgun proficiency',
  '119650': 'Self-loading rifle proficiency',
  '119651': 'Manually operated rifle proficiency',
  '119652': 'Shotgun proficiency',
  '243200': 'Muzzle-loader proficiency',
};

function unitStandardsText(codes: readonly string[] | undefined) {
  return (codes ?? [])
    .map((code) => `${code} — ${UNIT_STANDARD_LABELS[code] ?? 'Unit standard'}`)
    .join(' · ');
}

/**
 * Upload and Scan, side by side, on every intake surface.
 *
 * The two files a member can add are the same whoever asks: a document they
 * already hold (Upload) or one they photograph now (Scan). Keeping them here
 * means the start screen and every interview question offer the same controls,
 * and the interview no longer strands a member who realises mid-question that
 * the answer is on a certificate in their bag.
 */
export default function DocumentAddButtons({
  motivationId,
  busy,
  onFiles,
  onHandoffArrived,
  onPreview,
  onApply,
  onReviewComplete,
  unavailable,
  unavailableMessage,
  onNotify,
}: {
  motivationId: string;
  busy: boolean;
  /** `kind` is always '' here: the server classifies the file. */
  onFiles: (
    files: File[],
    onProgress?: (done: number, total: number, file?: string) => void,
  ) => DocumentAddOutcome[] | Promise<DocumentAddOutcome[]>;
  onHandoffArrived: (count?: number) => void;
  /** Authenticated bytes for the review pane. The caller owns the blob URL. */
  onPreview: (uploadId: string) => Promise<string>;
  /** Persist the values the applicant confirmed or corrected. */
  onApply: (answers: Record<string, string>) => Promise<void>;
  /** Re-read the application after the last document has been reviewed. */
  onReviewComplete?: () => void;
  /** True while the document engine is down. */
  unavailable?: boolean;
  unavailableMessage?: string;
  onNotify?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingCount, setProcessingCount] = useState(0);
  const [processingDone, setProcessingDone] = useState(0);
  const [processingFile, setProcessingFile] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<DocumentAddOutcome[]>([]);

  const [reviewQueue, setReviewQueue] = useState<DocumentAddOutcome[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const currentReview = reviewQueue[reviewIndex];

  async function handOff(files: File[]) {
    setScanning(false);
    if (!files.length) return;
    setProcessing(true);
    setProcessingCount(files.length);
    setProcessingDone(0);
    setProcessingFile(files[0]?.name ?? null);
    setOutcomes([]);
    setReviewQueue([]);
    setReviewIndex(0);
    try {
      const result = await onFiles(files, (done, total, file) => {
        setProcessingCount(total);
        setProcessingDone(done);
        setProcessingFile(file ?? null);
      });
      setOutcomes(result);
      const reviewable = result.filter(
        (outcome) => !outcome.error && outcome.uploadId,
      );
      if (reviewable.length) {
        setReviewQueue(reviewable);
        setReviewIndex(0);
        setEdits(editsFor(reviewable[0]));
      }
    } catch (err) {
      setOutcomes([
        {
          file: files.map((f) => f.name).join(', '),
          error: (err as Error).message,
        },
      ]);
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    if (!currentReview?.uploadId) {
      setPreviewUrl(null);
      return;
    }
    let live = true;
    setPreviewUrl(null);
    setPreviewError(null);
    void onPreview(currentReview.uploadId)
      .then((url) => {
        if (live) setPreviewUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch((err) => {
        if (live) setPreviewError((err as Error).message);
      });
    return () => {
      live = false;
    };
    // The callback is intentionally not a dependency: the parent may recreate
    // it, which would refetch the same document on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentReview?.uploadId]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  async function finishReview() {
    if (!currentReview) return;
    setSavingReview(true);
    setReviewError(null);
    try {
      const answers: Record<string, string> = {};
      for (const field of currentReview.fields ?? []) {
        answers[field.key] = (edits[field.key] ?? '').trim();
      }
      if (Object.keys(answers).length) await onApply(answers);

      const next = reviewIndex + 1;
      if (next < reviewQueue.length) {
        setReviewIndex(next);
        setEdits(editsFor(reviewQueue[next]));
      } else {
        setReviewQueue([]);
        setReviewIndex(0);
        onReviewComplete?.();
      }
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setSavingReview(false);
    }
  }

  const buttonClass =
    'inline-flex min-h-[38px] items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium disabled:opacity-50';
  const buttonStyle = {
    borderColor: 'var(--red)',
    color: 'var(--red)',
    background: 'var(--red-wash)',
  } as const;
  const isPdf =
    currentReview?.mimeType === 'application/pdf' ||
    currentReview?.file.toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Clear first: choosing the same file twice would otherwise fire no
          // change event at all.
          event.target.value = '';
          if (files.length) void handOff(files);
        }}
      />

      <button
        type="button"
        disabled={busy || scanning || processing || unavailable}
        onClick={() => fileRef.current?.click()}
        className={buttonClass}
        style={buttonStyle}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
        </svg>
        Upload
      </button>

      <button
        type="button"
        disabled={busy || scanning || processing || unavailable}
        aria-expanded={scanning}
        onClick={() => setScanning(true)}
        className={buttonClass}
        style={buttonStyle}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
        Scan
      </button>

      {unavailable ? (
        <div className="mt-2 w-full rounded-lg border px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]" style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }}>
          <p className="m-0">
            {unavailableMessage ??
              'Document uploads are paused while the document engine is under maintenance.'}
          </p>
          {onNotify ? (
            <button
              type="button"
              onClick={onNotify}
              className="mt-1 font-medium text-[var(--red)] underline"
            >
              Email me when it is available so I can re-upload
            </button>
          ) : null}
        </div>
      ) : null}

      {scanning && (
        <ScanButton
          autoStart
          onClosed={() => setScanning(false)}
          title="Photograph a document"
          handoff={{ dest: 'motivation', motivationId }}
          onHandoffArrived={(count) => {
            setOutcomes([
              {
                file: 'Phone scan',
                label: 'Document received',
                fields: [],
                note: `${count ?? 0} file${count === 1 ? '' : 's'} sent from your phone`,
              },
            ]);
            onHandoffArrived(count);
          }}
          onFiles={handOff}
          disabled={busy}
          label="Scan"
          fallback={
            <span className="text-[12px] leading-5 text-[var(--text-secondary)]">
              The scanner is unavailable here. Use Upload instead.
            </span>
          }
        />
      )}

      {processing ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-[12.5px] leading-5 text-[var(--text-secondary)]"
        >
          Reading {Math.min(processingDone + 1, processingCount)} of{' '}
          {processingCount} document{processingCount === 1 ? '' : 's'}
          {processingFile ? ` — ${processingFile}` : '…'}
        </p>
      ) : null}

      {!processing && outcomes.length ? (
        <div
          className="mt-2 w-full rounded-lg border px-3 py-2"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-inset)',
          }}
          aria-live="polite"
        >
          <p className="m-0 text-[12.5px] font-medium text-[var(--text-primary)]">
            What we found
          </p>
          <ul className="mt-1 list-disc pl-5 text-[12px] leading-5">
            {outcomes.map((outcome, index) => (
              <li
                key={`${outcome.file}-${index}`}
                style={{
                  color: outcome.error
                    ? 'var(--red)'
                    : 'var(--text-secondary)',
                }}
              >
                {outcome.error ? (
                  <>
                    <strong>{outcome.file}</strong>: {outcome.error}
                  </>
                ) : (
                  <>
                    <strong>{outcome.label ?? outcome.kind ?? 'Document'}</strong>
                    {outcome.unitStandards?.length
                      ? ` — ${unitStandardsText(outcome.unitStandards)}`
                      : null}
                    {outcome.answersQuestion === false
                      ? outcome.fields?.length
                        ? ` — does not answer this question, but filled: ${outcome.fields
                            .slice(0, 4)
                            .map((field) => `${field.label}: ${field.value}`)
                            .join(' · ')}`
                        : ' — does not answer this question, and added no new facts'
                      : outcome.fields?.length
                        ? ` — ${outcome.fields
                            .slice(0, 4)
                            .map((field) => `${field.label}: ${field.value}`)
                            .join(' · ')}`
                        : ' — filed, no new fields found'}
                    {outcome.note ? ` (${outcome.note})` : ''}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {currentReview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Review the document you uploaded"
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border shadow-2xl"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-page)',
            }}
          >
            <div
              className="flex items-center justify-between gap-3 border-b px-4 py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <div>
                <p className="m-0 text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  Review document {reviewIndex + 1} of {reviewQueue.length}
                </p>
                <p className="m-0 text-[15px] font-medium text-[var(--text-primary)]">
                  {currentReview.label ?? currentReview.kind ?? currentReview.file}
                </p>
              </div>
              <button
                type="button"
                disabled={savingReview}
                onClick={() => {
                  setReviewQueue([]);
                  setReviewIndex(0);
                }}
                className="rounded-lg border px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              >
                Close
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-2">
              <div
                className="min-h-[260px] overflow-auto border-b p-3 md:border-b-0 md:border-r"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--bg-inset)',
                }}
              >
                {previewUrl ? (
                  isPdf ? (
                    <iframe
                      src={previewUrl}
                      title={currentReview.file}
                      className="h-[70vh] w-full rounded-lg border-0 bg-white"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt={currentReview.file}
                      className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                    />
                  )
                ) : (
                  <p className="text-[12.5px] text-[var(--text-secondary)]">
                    {previewError ?? 'Loading the document…'}
                  </p>
                )}
              </div>

              <div className="min-h-0 overflow-auto p-4">
                <p className="m-0 text-[13px] leading-5 text-[var(--text-secondary)]">
                  Check what we read. Correct anything that is wrong before you
                  continue.
                </p>
                {currentReview.unitStandards?.length ? (
                  <div
                    className="mt-3 rounded-lg border px-3 py-3"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--bg-inset)',
                    }}
                  >
                    <p className="m-0 text-[12px] font-medium text-[var(--text-primary)]">
                      Recognised proficiency
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-[12px] leading-5 text-[var(--text-secondary)]">
                      {currentReview.unitStandards.map((code) => (
                        <li key={code}>
                          <strong>{code}</strong> —{' '}
                          {UNIT_STANDARD_LABELS[code] ?? 'Unit standard'}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {currentReview.fields?.length ? (
                  <div className="mt-3 grid gap-3">
                    {currentReview.fields.map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                          {field.label}
                        </span>
                        <input
                          value={edits[field.key] ?? ''}
                          onChange={(event) =>
                            setEdits((prev) => ({
                              ...prev,
                              [field.key]: event.target.value,
                            }))
                          }
                          className="min-h-[42px] w-full rounded-lg border px-3 text-[13.5px]"
                          style={{
                            borderColor: 'var(--border)',
                            background: 'var(--bg-inset)',
                            color: 'var(--text-primary)',
                          }}
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg border px-3 py-3 text-[12.5px] leading-5 text-[var(--text-secondary)]" style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }}>
                    {currentReview.kind === 'PROFICIENCY_CERTIFICATE'
                      ? 'This is a proficiency or training certificate. We check its unit standards against your application, but it does not fill a licence question on its own.'
                      : 'We could not read any fields from this document. It is still attached to your application.'}
                  </p>
                )}

                {reviewError ? (
                  <p className="mt-3 text-[12.5px] text-[var(--red)]">
                    {reviewError}
                  </p>
                ) : null}

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={savingReview}
                    onClick={() => void finishReview()}
                    className="rounded-lg px-4 py-2.5 text-[13.5px] font-medium text-white disabled:opacity-60"
                    style={{ background: 'var(--red)' }}
                  >
                    {savingReview
                      ? 'Saving…'
                      : reviewIndex + 1 < reviewQueue.length
                        ? 'Done — next document'
                        : 'Done'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
