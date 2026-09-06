'use client';

// ────────────────────────────────────────────────────────────────────
// WHAT YOU HAVE ALREADY GIVEN US, ON THE STEP THAT ASKED FOR IT.
//
// ⚠️ THE REBUILT WIZARD HAD NO LIST OF ATTACHED DOCUMENTS ANYWHERE.
// capture-cards.tsx is a camera and a file picker and nothing else — it does
// not know what is attached — so a member who photographed the wrong page, or
// filed their proof of address as their ID, had no way to see it and no way to
// undo it. removeUpload, refileUpload, rereadUpload and uploadBlobUrl all
// existed on the API with zero call sites in the new tree.
//
// The old page solved this with one long checklist carrying every requirement
// and its controls. The rebuilt design puts the question on the step that asks
// it, so this is the same controls in the new shape: under the capture cards,
// showing only the kinds THIS step is about.
//
// ⚠️ FOUR ACTIONS, AND THEY ARE NOT INTERCHANGEABLE.
//   View     open it, so "attached" can be checked rather than believed
//   Read again  the OCR failed; try it once more before typing by hand
//   Change type it IS a document, we filed it on the wrong line
//   Remove   it should not be in the pack at all
//
// Removing a document to re-upload it under the right name is the gesture
// "Change type" exists to prevent: it costs the member a photograph and costs
// us a second vision call for a document we have already read.
// ────────────────────────────────────────────────────────────────────

import { useId, useState } from 'react';
import type { PickableKind, UploadRow } from '@/lib/motivations-api';
// ⚠️ THE LIVE WIZARD'S OWN NOTES COMPONENT, NOT A SECOND ONE. Both screens
// have to say the same thing about the same document — an expiry read one way
// here and another way there is two answers to "may I still use this?".
import { UploadRowNotes, usableUpload } from '@/components/motivation/upload-panel';

export default function AttachedDocuments({
  documents,
  kinds,
  pickable,
  busyId,
  onView,
  onRemove,
  onReread,
  onRefile,
  onReplace,
}: {
  documents: UploadRow[];
  /** The kinds this step asks for. Anything else belongs to another step. */
  kinds: readonly string[];
  /** Every kind a document may be refiled as. */
  pickable: PickableKind[];
  busyId?: string | null;
  onView: (id: string) => void;
  onRemove: (id: string) => void;
  onReread: (id: string) => void;
  onRefile: (id: string, kind: string) => void;
  /**
   * Send them somewhere to attach a fresh copy, where there is somewhere.
   *
   * Only ever offered on a row whose Document Centre source has been deleted —
   * the one case where the member cannot fix the row from the row itself.
   */
  onReplace?: (kind: string) => void;
}) {
  const [refiling, setRefiling] = useState<string | null>(null);
  const selectId = useId();

  const mine = documents.filter((d) => kinds.includes(d.kind));
  if (!mine.length) return null;

  // ⚠️ COUNTED, BECAUSE "ATTACHED · 2" OVER TWO EXPIRED CERTIFICATES IS THE
  // GREEN TICK PROBLEM IN WORDS. A row the pack cannot use must not read as a
  // requirement met — see usableUpload.
  const unusable = mine.filter((d) => !usableUpload(d)).length;

  return (
    <div className="max-w-[560px]">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[.11em] text-[var(--text-tertiary)]">
        {mine.length === 1 ? 'Attached' : `Attached · ${mine.length}`}
        {unusable > 0 && (
          <span className="ml-2 normal-case tracking-normal text-[var(--warning)]">
            {unusable === 1
              ? '1 of these cannot answer its row'
              : `${unusable} of these cannot answer their rows`}
          </span>
        )}
      </p>

      <ul className="space-y-1.5">
        {mine.map((d) => {
          const busy = busyId === d.id;
          return (
            <li
              key={d.id}
              className="gg-tile rounded-[8px] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5"
              style={busy ? { opacity: 0.55 } : undefined}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[13.5px] font-medium">{d.label}</span>
                {d.annexure && (
                  <span className="text-[11.5px] text-[var(--text-tertiary)]">
                    Annexure {d.annexure}
                  </span>
                )}
                {/* ⚠️ THE BYTES CAN OUTLIVE NOTHING AND THE ROW CAN OUTLIVE
                    THE BYTES. A purged document still lists — it is a record
                    that it was submitted — but must not offer a View that
                    would fail after the member taps it. */}
                {!d.available && (
                  <span className="text-[11.5px] text-[var(--text-tertiary)]">
                    no longer stored
                  </span>
                )}
              </div>

              {/* Amber, not red. "We could not read this" is not a rejection
                  — the document may be perfectly good and simply hard to
                  photograph, and the member can still type the values. */}
              {d.suspect && (
                <p
                  className="mt-1 text-[11.5px]"
                  style={{ color: 'var(--gold-strong)' }}
                >
                  We could not read what this type of document usually carries.
                  Read it again, or change its type if we filed it wrong.
                </p>
              )}

              {/* ⚠️ THE DATE A DFO CHECKS FIRST, AND THIS LIST NEVER CARRIED
                  IT. The server has always sent `expiresOn`, `caution` and
                  `sourceRemovedAt` on the row; this screen rendered the kind
                  and the annexure letter and nothing else — so a complete-
                  looking step could be a letter of good standing that lapsed
                  in March, and the member found out at the counter. */}
              <UploadRowNotes
                row={d}
                onReplace={onReplace ? () => onReplace(d.kind) : undefined}
              />

              {/* ⚠️ 44px TARGETS. These were 12.5px underlined words about
                  18px tall, four of them in one row, and one of them deletes
                  a document. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                {d.available && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onView(d.id)}
                    className="min-h-[44px] px-1 underline underline-offset-2 text-[var(--text-secondary)]"
                  >
                    View
                  </button>
                )}
                {d.available && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReread(d.id)}
                    className="min-h-[44px] px-1 underline underline-offset-2 text-[var(--text-secondary)]"
                  >
                    Read again
                  </button>
                )}
                {d.available && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-expanded={refiling === d.id}
                    onClick={() =>
                      setRefiling((cur) => (cur === d.id ? null : d.id))
                    }
                    className="min-h-[44px] px-1 underline underline-offset-2 text-[var(--text-secondary)]"
                  >
                    Change type
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(d.id)}
                  className="min-h-[44px] px-1 underline underline-offset-2"
                  style={{ color: 'var(--red)' }}
                >
                  Remove
                </button>
              </div>

              {refiling === d.id && (
                <div className="mt-2">
                  <label
                    htmlFor={`${selectId}-${d.id}`}
                    className="block text-[11.5px] text-[var(--text-tertiary)]"
                  >
                    File it as
                  </label>
                  <select
                    id={`${selectId}-${d.id}`}
                    defaultValue={d.kind}
                    disabled={busy}
                    onChange={(e) => {
                      const next = e.target.value;
                      setRefiling(null);
                      // ⚠️ NO-OP ON THE SAME KIND. Refiling a document as
                      // what it already is costs a round trip and, on the
                      // server, re-runs the extraction — a paid call to learn
                      // nothing.
                      if (next && next !== d.kind) onRefile(d.id, next);
                    }}
                    className="mt-1 min-h-[44px] w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-[13px]"
                  >
                    {pickable.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
