'use client';

// ────────────────────────────────────────────────────────────────────
// "SEND US THE WHOLE FOLDER. WE'LL WORK OUT WHAT EACH ONE IS."
//
// Ported from the old page's UploadPanel, which was inline in a 3,575-line
// file and therefore unreachable from the rebuilt wizard. The logic is that
// panel's, near enough verbatim — it had already learned things this would
// otherwise learn again.
//
// ⚠️ WHY IT MATTERS MORE THAN THE PER-STEP CAMERAS. Every capture card in the
// wizard is bound to ONE kind, so the member has to know which document is
// which before they can give us anything. That is the harassment the rebuild
// exists to remove: somebody with a folder of scans should be able to hand
// over the folder. The marker library and the model sort them; the dropdown
// below fixes what we get wrong.
//
// Three things carried over from the old panel, each of which was a bug once:
//
//   ONE AT A TIME. Each upload writes an encrypted file and makes a vision
//   call; firing eight at once races the per-minute limit and gives no usable
//   progress.
//
//   ⚠️ THE QUEUE IS MERGED, NOT REPLACED. `mergeReviewQueue` rather than
//   setFiled([]) — this is the only screen that asks a human to confirm what
//   each document is, and clearing it means a second batch wipes the first
//   batch's unconfirmed rows off the screen. The Document Centre lost six
//   licences that way, and the old motivation page grew the same bug
//   independently.
//
//   ONE BAD FILE MUST NOT ABANDON THE REST. A failure is collected and
//   reported by name; the remaining files still go up.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { mergeReviewQueue } from '@/lib/document-review-rules';
import { MotivationApiError } from '@/lib/motivations-api';
import type { AddedUpload, PickableKind } from '@/lib/motivations-api';

type Filed = { id: string; name: string; kind: string; confident: boolean };

export default function BulkCapture({
  pickable,
  onAdd,
  onRefile,
}: {
  pickable: PickableKind[];
  /** Kind is deliberately empty — this door never asks which document it is. */
  onAdd: (kind: string, file: File) => Promise<AddedUpload | undefined>;
  onRefile: (uploadId: string, kind: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [filed, setFiled] = useState<Filed[]>([]);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    setProgress({ done: 0, total: files.length });

    const named: Filed[] = [];
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        // ⚠️ ALWAYS AUTO-NAMED. This door does not ask which document
        // anything is — that is its entire purpose. Anything arriving here is
        // by definition unlabelled, and the dropdown below catches what the
        // classifier gets wrong.
        const added = await onAdd('', file);
        if (added?.autoFiled) {
          named.push({
            id: added.id,
            name: file.name,
            kind: added.kind,
            confident: added.confident === true,
          });
        }
      } catch (ex) {
        failed.push(
          `${file.name}: ${
            ex instanceof MotivationApiError ? ex.message : 'did not upload'
          }`,
        );
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setFiled((cur) => mergeReviewQueue(cur, named));
    setErr(failed.length ? failed.join(' · ') : null);
    setBusy(false);
    setProgress(null);
  }

  return (
    <div className="max-w-[560px]">
      <label
        className="gg-tile gg-tile-lift flex cursor-pointer items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3"
        style={busy ? { opacity: 0.6, cursor: 'wait' } : undefined}
      >
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={busy}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void uploadFiles(files);
          }}
        />
        <span className="text-[15px]" aria-hidden>
          📎
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold">
            Send everything at once
          </span>
          <span className="block text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
            No need to say which is which — we read each one to work out what
            it is, and show you what we made of them. JPG, PNG, WebP or PDF, up
            to 10 MB each. On an iPhone, choose from your photo library rather
            than from Files.
          </span>
        </span>
      </label>

      {progress && (
        <p className="mt-2 text-[12.5px]" aria-live="polite">
          Uploading {progress.done + 1} of {progress.total}…
        </p>
      )}

      {/* WHAT WE FILED EACH ONE AS.
          Shown because the required-documents list counts the TYPE, not the
          contents — so a document filed wrongly ticks a requirement the pack
          does not actually meet. Correcting it is one dropdown. */}
      {filed.length > 0 && (
        <div
          className="mt-3 rounded-[10px] border px-3.5 py-3"
          style={{
            borderColor: 'var(--gold-line)',
            background: 'var(--gold-wash)',
          }}
        >
          <p className="text-[13px] font-semibold">
            Here is what we made of them — change any that are wrong
          </p>
          <ul className="mt-2 space-y-2">
            {filed.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-2 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate" title={f.name}>
                  {f.name}
                  {/* "not sure" is the classifier's own confidence, and it is
                      the difference between a marker that IS the document and
                      a model's best guess. */}
                  {!f.confident && (
                    <span className="ml-2 text-[11.5px] text-[var(--gold-strong)]">
                      not sure
                    </span>
                  )}
                </span>
                <select
                  value={f.kind}
                  aria-label={`Document type for ${f.name}`}
                  className="rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-[13px]"
                  onChange={async (e) => {
                    const next = e.target.value;
                    setFiled((cur) =>
                      cur.map((x) =>
                        x.id === f.id ? { ...x, kind: next, confident: true } : x,
                      ),
                    );
                    await onRefile(f.id, next);
                  }}
                >
                  {pickable.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setFiled([])}
            className="mt-2 text-[12px] underline underline-offset-2"
          >
            These are right
          </button>
        </div>
      )}

      {err && (
        <p className="mt-2 text-[12.5px] text-[var(--red)]">{err}</p>
      )}
    </div>
  );
}
