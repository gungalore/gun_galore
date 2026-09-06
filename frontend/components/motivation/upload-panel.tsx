'use client';

// ────────────────────────────────────────────────────────────────────
// THE UPLOAD-ALL PANEL, AND WHAT A DOCUMENT ROW HAS TO SAY FOR ITSELF.
//
// Lifted verbatim out of app/motivations/[id]/page.tsx on 2026-09-06, where it
// had grown to a fifth of a four-thousand-line file. Nothing about its
// behaviour changed in the move; the state it needs (`filed`) already lived on
// the page, because it has to survive a reload.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import { formatLong, parseIso, todayYmd } from '@/lib/date-picker-model';
import {
  AddedUpload,
  MotivationApiError,
  PickableKind,
  UploadRow,
} from '@/lib/motivations-api';
import { mergeReviewQueue } from '@/lib/document-review-rules';

/**
 * WHAT A ROW STILL HAS TO SAY FOR ITSELF: when it runs out, and whether the
 * document behind it is still there.
 *
 * ⚠️ THIS REPLACES `AttachedTo`, WHICH WAS DEAD CODE. That component rendered
 * a green "Attached ✓ · Annexure C" chip and nothing in this file — or any
 * other — ever mounted it; it also hard-coded rgba(47,158,107,…), the retired
 * dark-theme green, so had anything mounted it, it would have drawn a mint
 * chip on a white card beside dark-green ink. The confirmation it promised is
 * on the list rows themselves, where the expiry and the cautions now are.
 *
 * ⚠️ RED IS NOT AMBER. Amber is "this is close" and the member may still have
 * a good reason. Red is "this cannot answer the requirement any more", and a
 * red row must never tick a required checklist line — see `usableUpload`.
 */
export function UploadRowNotes({
  row,
  onReplace,
}: {
  row: UploadRow;
  /**
   * Where to send them for a fresh copy, when there is somewhere to send them.
   *
   * Omitted beside a field's own attachments, where the camera and the file
   * picker are already two inches above — a "Replace it" that scrolls the
   * member away from the control they were about to use is worse than none.
   */
  onReplace?: () => void;
}) {
  const expires = row.expiresOn ? new Date(row.expiresOn) : null;
  const valid = expires && !Number.isNaN(expires.getTime()) ? expires : null;
  const days = valid
    ? Math.floor((valid.getTime() - Date.now()) / 86_400_000)
    : null;
  // ⚠️ THE SERVER'S CAUTION WINS. It sees the requirement this document is
  // answering; the date on its own does not. The date-derived line below is
  // only for a row the server said nothing about.
  const tone: 'amber' | 'red' | null =
    row.caution?.tone ??
    (days === null ? null : days < 0 ? 'red' : days < 90 ? 'amber' : null);
  const text =
    row.caution?.text ??
    (days === null
      ? null
      : days < 0
        ? `Expired ${formatLong(parseIso(row.expiresOn!) ?? todayYmd())}`
        : `Expires ${formatLong(parseIso(row.expiresOn!) ?? todayYmd())}`);

  if (!tone && !text && !row.sourceRemovedAt) return null;

  return (
    <span className="mt-0.5 block text-xs">
      {text && (
        <span
          style={{
            color:
              tone === 'red'
                ? 'var(--red)'
                : tone === 'amber'
                  ? 'var(--warning)'
                  : 'var(--text-tertiary-on-card)',
          }}
        >
          {text}
        </span>
      )}
      {/* ⚠️ THE SOURCE IS GONE, NOT THE FILE. The bytes on THIS application may
          still be here, but the Document Centre copy behind them has been
          deleted — so nothing can be re-read, renewed or reused from it, and
          the member has to know before a DFO is the one who notices. */}
      {row.sourceRemovedAt && (
        <span className="mt-0.5 flex flex-wrap items-center gap-2">
          <span style={{ color: 'var(--warning)' }}>
            Deleted from your Document Centre
          </span>
          {onReplace && (
            <button
              type="button"
              className="min-h-[44px] px-1 underline"
              onClick={onReplace}
            >
              Replace it
            </button>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Can this document still answer a required line?
 *
 * ⚠️ A CHECKLIST THAT GOES GREEN ON AN EXPIRED CERTIFICATE IS WORSE THAN ONE
 * THAT STAYS AMBER, because it stops the member looking. Same for a row whose
 * source has been deleted from the Document Centre.
 */
export function usableUpload(u: UploadRow): boolean {
  return !u.sourceRemovedAt && u.caution?.tone !== 'red';
}

export default function UploadPanel({
  uploads,
  kinds,
  motivationId,
  filed,
  setFiled,
  onAdd,
  onRefile,
  onRemove,
  onView,
  onReplace,
  onHandoffArrived,
}: {
  uploads: UploadRow[];
  kinds: PickableKind[];
  motivationId: string;
  /** ⚠️ THE PAGE OWNS IT, so it survives a reload. See the state declaration. */
  filed: { id: string; name: string; kind: string; confident: boolean }[];
  setFiled: React.Dispatch<
    React.SetStateAction<
      { id: string; name: string; kind: string; confident: boolean }[]
    >
  >;
  /** Point the member at a fresh photograph for a source that has gone. */
  onReplace: (kind: string) => void;
  onAdd: (kind: string, file: File) => Promise<AddedUpload | undefined>;
  onRefile: (uploadId: string, kind: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Open one document, so "attached" can be checked rather than believed. */
  onView: (id: string) => Promise<void>;
  /** Re-read the pack after a phone sent something straight to the server. */
  onHandoffArrived: () => Promise<void>;
}) {
  // Empty string until the list arrives, and the file input stays disabled
  // until then — posting an empty kind would 400 with nothing useful to show.
  /**
   * THE UPLOAD PATH, lifted out of the file input.
   *
   * Named rather than inline so every source of a File — the themed
   * picker, the per-requirement rows, and next the camera — feeds one
   * code path with one set of checks.
   */
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    // ⚠️ NOT setFiled([]). This queue is the only screen that asks a human to
    // confirm what each document is, and the add panel closes after every
    // hand-off — so clearing here means a second batch wipes the first batch's
    // unconfirmed rows off the screen. The Document Centre lost six licences
    // this way; this page had grown the same bug independently.
    setProgress({ done: 0, total: files.length });

    // ONE AT A TIME, deliberately. Each upload writes an encrypted
    // file and makes a vision call; firing eight at once would race the
    // per-minute limit and give no usable progress.
    const named: typeof filed = [];
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        // ⚠️ ALWAYS AUTO-NAMED HERE, one file or eight. This panel no longer
        // asks which document anything is — that question moved to the
        // checklist above, where the member answers it by choosing a line.
        // Anything arriving through this path is by definition unlabelled,
        // and the correction dropdown below catches what we get wrong.
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
        // One bad file must not abandon the rest of the pack.
        failed.push(
          `${file.name}: ${
            ex instanceof MotivationApiError
              ? ex.message
              : 'did not upload'
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

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Per-file state while a pack is going up: "3 of 8 — competency…". */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  return (
    <div className="mt-3">
      {/* ⚠️ THE DOCUMENT-TYPE SELECT IS GONE FROM HERE. The checklist above is
          now a radio list of exactly these kinds — so this was a second
          control answering a question the member had already answered, three
          inches higher, and the two could disagree. This panel does one
          thing: take the whole pack and work out what each file is. */}
      <div className="flex flex-wrap items-center gap-2">
        <ScanButton
          // Follows the picker above; A4 while nothing is chosen, because a
          // motivation pack is mostly paper.
          // A pack is mostly paper, and this panel never names one document.
          shape="a4"
          // ⚠️ THIS IS THE UPLOAD-ALL. Somebody opening it is holding a pack —
          // a competency certificate, a licence card, a page of an ID book —
          // and scanning exactly one thing is the unusual case here, not the
          // default. "Different document" between shots lets the aim box
          // change with each one.
          multiDefault
          title="Photograph a document"
          onFiles={uploadFiles}
          disabled={busy}
          label="Photograph documents"
          handoff={{ dest: 'motivation', motivationId }}
          onHandoffArrived={() => void onHandoffArrived()}
          fallback={
            <FilePickerButton
              accept="image/jpeg,image/png,image/webp,application/pdf"
              // A PACK GOES UP IN ONE GO. Picking one file at a time and
              // choosing a type for each is the slowest possible way to hand
              // over documents somebody already has sitting in a folder.
              multiple
              disabled={busy}
              variant="primary"
              onFiles={uploadFiles}
            >
              Upload all my documents
            </FilePickerButton>
          }
        />
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
        Send the whole pack in one go and we read each document to work out
        what it is — no need to say which is which. We show you what we made of
        them afterwards, and one dropdown fixes anything we got wrong. JPG,
        PNG, WebP or PDF, up to 10 MB each. On an iPhone, choose the photos
        from your library rather than from Files.
      </p>

      {progress && (
        <p className="mt-2 text-sm" aria-live="polite">
          Uploading {progress.done + 1} of {progress.total}…
        </p>
      )}

      {/* WHAT WE FILED EACH DOCUMENT AS.
          Shown because the required-documents list counts the TYPE, not the
          contents — so a document filed wrongly would tick a requirement the
          pack does not actually meet. Correcting it is one dropdown. */}
      {filed.length > 0 && (
        <div className="mt-3 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3">
          <p className="text-sm font-medium">
            Here is what we made of them — change any that are wrong
          </p>
          <ul className="mt-2 space-y-2">
            {filed.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={f.name}>
                  {f.name}
                  {!f.confident && (
                    <span className="ml-2 text-xs text-[var(--warning)]">
                      not sure
                    </span>
                  )}
                </span>
                <select
                  className="rounded border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1 text-sm text-[var(--text-primary)] [&>option]:bg-[var(--bg-card)] [&>option]:text-[var(--text-primary)]"
                  value={f.kind}
                  aria-label={`Document type for ${f.name}`}
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
                  {kinds.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {/* ⚠️ IT CLEARS THE CONFIDENT ROWS ONLY, AND THAT IS THE WHOLE
              POINT. `setFiled([])` dismissed the not-sure rows along with the
              rest — so one tap on a button meaning "the ones you got right are
              right" also silently confirmed every document we had told the
              member we were unsure about, and the required-documents count
              went green on our own guess. The uncertain rows stay, with the
              dropdown that settles them. */}
          <button
            type="button"
            className="mt-2 min-h-[44px] px-1 text-xs underline"
            onClick={() => setFiled((cur) => cur.filter((f) => !f.confident))}
          >
            {filed.every((f) => f.confident)
              ? 'These are right'
              : 'The ones you are sure about are right'}
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}

      <ul className="mt-3 divide-y divide-[var(--border-divider)] rounded border border-[var(--border)]">
        {uploads.length === 0 && (
          <li className="p-3 text-sm text-[var(--text-tertiary-on-card)]">Nothing added yet.</li>
        )}
        {uploads.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1">
              {u.annexure && (
                <span className="mr-2 rounded bg-[var(--bg-inset)] px-1.5 py-0.5 text-xs">
                  Annexure {u.annexure}
                </span>
              )}
              {u.label}
              {!u.available && (
                <span className="ml-2 text-xs text-[var(--text-tertiary-on-card)]">
                  (deleted under our retention policy)
                </span>
              )}
              {/* ⚠️ WHEN IT RUNS OUT, ON THE ROW. A competency certificate and
                  a letter of good standing both expire, and a row that says
                  only "Annexure C · Competency certificate" reads as done
                  whether it runs out next year or ran out last March. The DFO
                  reads the date; the member never saw it. */}
              <UploadRowNotes row={u} onReplace={() => onReplace(u.kind)} />
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {u.available && (
                <button
                  type="button"
                  className="min-h-[44px] px-2 text-xs underline"
                  aria-label={`View ${u.label}`}
                  onClick={() => void onView(u.id)}
                >
                  View
                </button>
              )}
              {/* ⚠️ 44px. This was `text-xs underline` with no padding — an
                  11px word, roughly 50×16, and the one control on the page
                  that throws a document away. */}
              <button
                type="button"
                className="min-h-[44px] px-2 text-xs underline"
                aria-label={`Remove ${u.label}`}
                onClick={() => onRemove(u.id)}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
